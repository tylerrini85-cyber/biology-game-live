"""Analysis ingest (Spec §7) — turn real inputs into the cached analysis.

In the shipping app this is produced by the local AI sidecars (faster-whisper /
WhisperX for word timestamps, Silero VAD for speech, PySceneDetect for shots).
This module provides a dependency-free path that already works on real data:

  * word timestamps  <- a Whisper/WhisperX JSON or an .srt file
  * speech / silence  <- RMS analysis of a .wav (stdlib `wave`, no numpy)
  * emphasis          <- per-word loudness (RMS) + keyword boost

so you can produce a real `analysis.json` today, and later swap in the heavier
models behind the same output schema.
"""
from __future__ import annotations

import argparse
import array
import json
import math
import re
import wave

from .analysis import AssetAnalysis, Word

# ---- word timestamps -------------------------------------------------------

def words_from_whisper(path: str) -> tuple[list[Word], float]:
    """Parse OpenAI-whisper / whisper.cpp / WhisperX JSON (word-level)."""
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    words: list[Word] = []
    end = 0.0
    segments = data.get("segments", data if isinstance(data, list) else [])
    for seg in segments:
        for w in seg.get("words", []):
            text = (w.get("word") or w.get("text") or "").strip()
            if not text:
                continue
            s = float(w.get("start", w.get("from", 0.0)))
            e = float(w.get("end", w.get("to", s)))
            words.append(Word(text=text, start=s, dur=max(0.01, e - s)))
            end = max(end, e)
    return words, end


_SRT_TIME = re.compile(r"(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)")


def words_from_srt(path: str) -> tuple[list[Word], float]:
    """Parse an .srt. SRT has no word timings, so words are spread evenly
    within each cue (good enough for captions; precise word edits want JSON)."""
    with open(path, "r", encoding="utf-8") as fh:
        blocks = re.split(r"\n\s*\n", fh.read().strip())
    words: list[Word] = []
    end = 0.0
    for block in blocks:
        m = _SRT_TIME.search(block)
        if not m:
            continue
        g = list(map(int, m.groups()))
        start = g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000.0
        stop = g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000.0
        text = " ".join(block.split("\n")[2:]).strip()
        toks = text.split()
        if not toks:
            continue
        span = (stop - start) / len(toks)
        for i, tok in enumerate(toks):
            words.append(Word(text=tok, start=round(start + i * span, 3),
                              dur=round(span, 3)))
        end = max(end, stop)
    return words, end


# ---- speech / silence + emphasis from a WAV --------------------------------

def _read_wav_mono(path: str) -> tuple[list[float], int]:
    """Return (samples in -1..1, sample_rate). Mixes channels to mono."""
    with wave.open(path, "rb") as wf:
        rate = wf.getframerate()
        ch = wf.getnchannels()
        width = wf.getsampwidth()
        raw = wf.readframes(wf.getnframes())
    if width == 2:
        a = array.array("h"); a.frombytes(raw); norm = 32768.0
    elif width == 1:
        a = array.array("b"); a.frombytes(bytes(b - 128 for b in raw)); norm = 128.0
    elif width == 4:
        a = array.array("i"); a.frombytes(raw); norm = 2147483648.0
    else:
        raise ValueError(f"unsupported sample width {width}")
    samples = [x / norm for x in a]
    if ch > 1:  # downmix
        samples = [sum(samples[i:i + ch]) / ch for i in range(0, len(samples), ch)]
    return samples, rate


def _rms_windows(samples: list[float], rate: int, win_s: float):
    n = max(1, int(rate * win_s))
    out = []
    for i in range(0, len(samples), n):
        chunk = samples[i:i + n]
        if not chunk:
            break
        rms = math.sqrt(sum(x * x for x in chunk) / len(chunk))
        out.append((i / rate, rms))
    return out, n / rate


def _percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    k = min(len(s) - 1, max(0, int(p * (len(s) - 1))))
    return s[k]


def speech_from_wav(path: str, win_s: float = 0.03, min_speech_s: float = 0.2,
                    min_gap_s: float = 0.2, pad_s: float = 0.05):
    """Return (speech_ranges, duration, rms_at(t))."""
    samples, rate = _read_wav_mono(path)
    duration = len(samples) / rate
    windows, wlen = _rms_windows(samples, rate, win_s)
    levels = [r for _, r in windows]
    floor = _percentile(levels, 0.10)
    peak = max(levels) if levels else 0.0
    thresh = max(floor * 3.0, peak * 0.12)  # adaptive

    # mark speech windows, then merge into ranges
    ranges: list[tuple[float, float]] = []
    cur = None
    for t, r in windows:
        if r >= thresh:
            cur = (t, t + wlen) if cur is None else (cur[0], t + wlen)
        elif cur is not None:
            ranges.append(cur); cur = None
    if cur is not None:
        ranges.append(cur)

    # bridge short gaps, drop short blips, pad, clamp
    merged: list[tuple[float, float]] = []
    for s, e in ranges:
        if merged and s - merged[-1][1] < min_gap_s:
            merged[-1] = (merged[-1][0], e)
        else:
            merged.append((s, e))
    speech = [(max(0.0, s - pad_s), min(duration, e + pad_s))
              for s, e in merged if (e - s) >= min_speech_s]

    def rms_at(t: float) -> float:
        idx = min(len(levels) - 1, max(0, int(t / wlen))) if levels else 0
        return levels[idx] if levels else 0.0

    return speech, duration, rms_at, (floor, peak)


KEYWORDS = {"important", "biggest", "mistake", "never", "always", "best", "worst",
            "absolutely", "remember", "secret", "free", "now", "today", "you"}


def score_emphasis(words: list[Word], rms_at, peak: float) -> None:
    """Set word.emphasis in-place from normalized loudness + keyword boost."""
    for w in words:
        loud = rms_at(w.mid) / peak if peak else 0.0
        boost = 0.25 if re.sub(r"[^a-z]", "", w.text.lower()) in KEYWORDS else 0.0
        w.emphasis = round(min(1.0, 0.6 * loud + boost + 0.2), 3)


# ---- orchestration ---------------------------------------------------------

def analyze(asset_id: str, source_url: str, *, wav: str | None = None,
            transcript: str | None = None, scenes: list[float] | None = None) -> AssetAnalysis:
    words: list[Word] = []
    t_end = 0.0
    if transcript:
        if transcript.lower().endswith(".srt"):
            words, t_end = words_from_srt(transcript)
        else:
            words, t_end = words_from_whisper(transcript)

    if wav:
        speech, duration, rms_at, (floor, peak) = speech_from_wav(wav)
        if words:
            score_emphasis(words, rms_at, peak)
    else:
        # no audio: derive crude speech spans straight from word timings
        duration = t_end
        speech = [(w.start, w.end) for w in words]

    return AssetAnalysis(asset_id=asset_id, source_url=source_url,
                         duration=round(duration, 3), words=words,
                         speech=[(round(s, 3), round(e, 3)) for s, e in speech],
                         scenes=scenes or [])


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="vibecut.ingest",
                                 description="Build analysis.json from a wav and/or transcript.")
    ap.add_argument("--wav", help="audio .wav for speech/silence + emphasis")
    ap.add_argument("--transcript", help="word-level Whisper JSON or .srt")
    ap.add_argument("--asset-id", default="a1")
    ap.add_argument("--source-url", default="/footage/clip.mov")
    ap.add_argument("--out", default="analysis.json")
    args = ap.parse_args(argv)
    if not args.wav and not args.transcript:
        ap.error("need --wav and/or --transcript")
    a = analyze(args.asset_id, args.source_url, wav=args.wav, transcript=args.transcript)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump({"asset_id": a.asset_id, "source_url": a.source_url,
                   "duration": a.duration,
                   "speech": [list(s) for s in a.speech], "scenes": a.scenes,
                   "words": [{"text": w.text, "start": w.start, "dur": w.dur,
                              "emphasis": w.emphasis} for w in a.words]}, fh, indent=2)
    print(f"wrote {args.out}: {len(a.words)} words, {len(a.speech)} speech segments, "
          f"{a.duration:.2f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

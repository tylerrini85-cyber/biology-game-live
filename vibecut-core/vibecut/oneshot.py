"""One command: video file -> finished, vibe-edited MP4.

    python3 -m vibecut.oneshot myclip.mp4 "punchy under 60s, vertical for tiktok, bold captions"

Pipeline (all local): extract audio (FFmpeg) -> transcribe with word timestamps
(faster-whisper) -> build analysis -> vibe-edit -> render the MP4 (FFmpeg).

Requirements (one-time):
  * FFmpeg on PATH                      (mac: brew install ffmpeg)
  * pip install faster-whisper          (only needed if you don't pass --transcript)
Optional: --transcript clip.srt|clip.json to skip transcription entirely.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

from . import cli, ingest


def _need_ffmpeg() -> None:
    if shutil.which("ffmpeg") is None:
        sys.exit("error: FFmpeg not found on PATH. Install it: https://ffmpeg.org/download.html")


def _extract_wav(video: str, wav: str) -> None:
    subprocess.run(["ffmpeg", "-y", "-i", video, "-vn", "-ac", "1", "-ar", "16000", wav],
                   check=True, capture_output=True)


def _transcribe(wav: str, model_size: str, out_json: str, language: str | None = None) -> None:
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        sys.exit("error: faster-whisper not installed. Run:  pip install faster-whisper\n"
                 "       (or pass --transcript with an .srt / Whisper .json to skip this step)")
    print(f"  transcribing with faster-whisper ({model_size}"
          + (f", lang={language}" if language else ", auto-detect lang") + ")…")
    model = WhisperModel(model_size, device="auto", compute_type="int8")
    segments, _info = model.transcribe(wav, language=language, word_timestamps=True, vad_filter=True)
    segs = []
    for s in segments:
        words = [{"word": w.word, "start": w.start, "end": w.end}
                 for w in (s.words or []) if w.start is not None]
        if words:
            segs.append({"words": words})
    with open(out_json, "w", encoding="utf-8") as fh:
        json.dump({"segments": segs}, fh)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="vibecut.oneshot",
                                 description="Video file -> finished vibe-edited MP4 (one command).")
    ap.add_argument("video", help="your source video (mp4/mov/…)")
    ap.add_argument("prompt", help="what you want, e.g. 'punchy under 60s, vertical, bold captions'")
    ap.add_argument("--out", default="vibecut_edit.mp4", help="output MP4 (default vibecut_edit.mp4)")
    ap.add_argument("--transcript", help="existing .srt or Whisper .json (skips transcription)")
    ap.add_argument("--whisper", default="base", help="faster-whisper model size (tiny/base/small/medium/large-v3)")
    ap.add_argument("--language", help="force transcription language (e.g. en, es, fr); default auto-detect")
    ap.add_argument("--encoder", default="mac", choices=["mac", "nvidia", "intel", "amd"])
    ap.add_argument("--media-library", help="JSON of your own clips for b-roll")
    ap.add_argument("--broll-dir", help="folder of your clips/images for b-roll (filenames -> tags)")
    ap.add_argument("--reframe", metavar="ASPECT", help="subject-tracking reframe to ASPECT (e.g. 9:16)")
    ap.add_argument("--no-zooms", action="store_true")
    ap.add_argument("--keep-files", action="store_true", help="keep the intermediate wav/analysis")
    args = ap.parse_args(argv)

    if not os.path.exists(args.video):
        sys.exit(f"error: video not found: {args.video}")
    _need_ffmpeg()

    workdir = tempfile.mkdtemp(prefix="vibecut_")
    wav = os.path.join(workdir, "audio.wav")
    transcript = args.transcript
    analysis_path = os.path.join(workdir, "analysis.json")
    ass_path = os.path.splitext(args.out)[0] + ".ass"

    print(f"  [1/4] extracting audio -> {wav}")
    _extract_wav(args.video, wav)

    if not transcript:
        transcript = os.path.join(workdir, "transcript.json")
        print("  [2/4] transcribing")
        _transcribe(wav, args.whisper, transcript, language=args.language)
    else:
        print(f"  [2/4] using provided transcript: {transcript}")

    print("  [3/4] building analysis (speech/silence + emphasis)")
    analysis = ingest.analyze("a1", os.path.abspath(args.video), wav=wav, transcript=transcript)
    with open(analysis_path, "w", encoding="utf-8") as fh:
        json.dump({"asset_id": analysis.asset_id, "source_url": analysis.source_url,
                   "duration": analysis.duration,
                   "speech": [list(s) for s in analysis.speech], "scenes": analysis.scenes,
                   "words": [{"text": w.text, "start": w.start, "dur": w.dur,
                              "emphasis": w.emphasis} for w in analysis.words]}, fh)

    # optional: subject-tracking reframe + b-roll from a folder
    reframe_track = None
    if args.reframe:
        print(f"  [3b] subject-tracking reframe -> {args.reframe}")
        from .sidecars import reframe as _rf
        reframe_track = os.path.join(workdir, "reframe.json")
        with open(reframe_track, "w", encoding="utf-8") as fh:
            json.dump(_rf.analyze(args.video, args.reframe), fh)
    media_library_path = args.media_library
    if args.broll_dir:
        lib = []
        for fn in sorted(os.listdir(args.broll_dir)):
            if fn.lower().endswith((".mp4", ".mov", ".jpg", ".jpeg", ".png", ".webp")):
                tags = [t for t in re.split(r"[^a-z0-9]+", os.path.splitext(fn)[0].lower()) if t]
                lib.append({"id": fn, "url": os.path.join(args.broll_dir, fn), "duration": 2.5, "tags": tags})
        media_library_path = os.path.join(workdir, "broll.json")
        with open(media_library_path, "w", encoding="utf-8") as fh:
            json.dump(lib, fh)

    print(f"  [4/4] vibe-editing + rendering -> {args.out}")
    toggles = {"zooms": False} if args.no_zooms else {}
    res = cli.run(args.prompt, analysis_path, args.out, ass_path, args.encoder,
                  toggles, False, "qwen2.5:7b",
                  media_library_path=media_library_path, render_path=args.out,
                  reframe_track=reframe_track)

    ok, msg = res["render_result"]
    if not args.keep_files:
        shutil.rmtree(workdir, ignore_errors=True)
    if ok:
        print(f"\n  ✅ done -> {args.out}\n")
        return 0
    print(f"\n  ⚠️  edit planned but render failed:\n  {msg}\n"
          "  (the FFmpeg command above can be run manually)\n")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

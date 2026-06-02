"""Render targets (Spec §11/§12).

This reference produces:
  * an FFmpeg command (string) that performs the *deterministic* part of the
    export — trim the kept ranges, concat them, apply audio loudness/enhance,
    and burn in captions. Hardware encoders only (no x264/x265), per the
    finalized decisions.
  * an ASS subtitle file with karaoke word-highlight timing.

Note: time-varying effects (punch-in zoom, auto-reframe pan) are rendered by
the in-app GPU/wgpu compositor (Spec §11). They are carried in the EditModel;
here we annotate them rather than emit huge per-segment filter expressions, so
the generated command stays correct and runnable for the core cut+caption+audio.
"""
from __future__ import annotations

import os
import shlex
import shutil
import subprocess

from .editmodel import Captions, EditModel

# vendor -> hardware H.264 encoder (Spec §11: hardware encoders only)
HW_ENCODERS = {
    "mac": "h264_videotoolbox",
    "nvidia": "h264_nvenc",
    "intel": "h264_qsv",
    "amd": "h264_amf",
}


def _hex_to_ass(color: str) -> str:
    """#RRGGBB -> ASS &HBBGGRR& (ASS is BGR)."""
    c = color.lstrip("#")
    if len(c) != 6:
        return "&H00E0FF&"
    r, g, b = c[0:2], c[2:4], c[4:6]
    return f"&H{b}{g}{r}&".upper()


def _ts(t: float) -> str:
    """seconds -> ASS h:mm:ss.cs"""
    cs = int(round(t * 100))
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    s, cs = divmod(cs, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def build_ass(captions: Captions, width: int = 1080, height: int = 1920) -> str:
    primary = "&HFFFFFF&"
    highlight = _hex_to_ass(captions.highlight_color)
    bold = -1 if captions.style in ("bold-karaoke", "hype") else 0
    fontsize = 96 if captions.style in ("bold-karaoke", "hype") else 64
    margin_v = int(height * 0.18) if captions.position == "lower-mid" else 60

    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {width}", f"PlayResY: {height}",
        "",
        "[V4+ Styles]",
        ("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
         "OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, "
         "Shadow, Alignment, MarginL, MarginR, MarginV, Encoding"),
        (f"Style: Vibe,Arial,{fontsize},{primary},{highlight},&H000000&,"
         f"&H80000000&,{bold},0,1,4,2,2,40,40,{margin_v},1"),
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    for ev in captions.events:
        # karaoke: \kNN gives each word a highlight duration in centiseconds
        chunks = []
        for cw in ev.words:
            k = max(1, int(round(cw.d * 100)))
            chunks.append(f"{{\\kf{k}}}{cw.w} ")
        text = "".join(chunks).strip()
        lines.append(f"Dialogue: 0,{_ts(ev.start)},{_ts(ev.end)},Vibe,,0,0,0,,{text}")
    return "\n".join(lines) + "\n"


def _filtergraph(model: EditModel, ass_path: str) -> str:
    """Build the FFmpeg -filter_complex: trim kept ranges, concat, reframe,
    burn captions, and apply the audio chain (loudness/denoise)."""
    vt = model.video_track()
    at = model.audio_track()
    parts: list[str] = []
    n = len(vt.clips)
    for i, c in enumerate(vt.clips):
        parts.append(f"[0:v]trim=start={c.src_in:.3f}:end={c.src_out:.3f},"
                     f"setpts=PTS-STARTPTS[v{i}]")
    for i, c in enumerate(at.clips):
        parts.append(f"[0:a]atrim=start={c.src_in:.3f}:end={c.src_out:.3f},"
                     f"asetpts=PTS-STARTPTS[a{i}]")
    parts.append("".join(f"[v{i}][a{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=1[vc][ac]")

    # audio chain
    afilters = []
    for f in at.filters:
        if f.type == "loudnorm":
            p = f.params
            afilters.append(f"loudnorm=I={p['i']}:TP={p['tp']}:LRA={p['lra']}")
        elif f.type == "deepfilternet":
            afilters.append("anlmdn")  # stand-in; real build runs DeepFilterNet3
    parts.append("[ac]" + ",".join(afilters or ["anull"]) + "[aout]")

    # reframe (real center-crop + scale to the target aspect) then burn captions
    vlabel = "vc"
    if any(f.type == "auto_reframe" for f in vt.filters):
        w, h = model.profile.width, model.profile.height
        parts.append(f"[vc]crop='min(iw,ih*{w}/{h})':'min(ih,iw*{h}/{w})',"
                     f"scale={w}:{h},setsar=1[vr]")
        vlabel = "vr"
    parts.append(f"[{vlabel}]ass={ass_path}[vout]")
    return ";".join(parts)


def build_ffmpeg_args(model: EditModel, src_url: str, out_path: str,
                      ass_path: str = "captions.ass", encoder: str = "mac") -> list[str]:
    """The export command as an argv list (safe for subprocess)."""
    enc = HW_ENCODERS.get(encoder, HW_ENCODERS["mac"])
    return ["ffmpeg", "-y", "-i", src_url,
            "-filter_complex", _filtergraph(model, ass_path),
            "-map", "[vout]", "-map", "[aout]",
            "-c:v", enc, "-b:v", "12M", "-c:a", "aac", "-b:a", "192k", out_path]


def _notes(model: EditModel) -> list[str]:
    vt = model.video_track()
    notes = []
    if any(f.type == "transform" for f in vt.filters):
        notes.append("# note: punch-in zoom is applied by the in-app GPU compositor")
    bt = next((t for t in model.tracks if t.id == "V2"), None)
    if bt and bt.clips:
        notes.append(f"# note: {len(bt.clips)} b-roll overlays are composited in-app")
    return notes


def build_ffmpeg_command(model: EditModel, src_url: str, out_path: str,
                         ass_path: str = "captions.ass", encoder: str = "mac") -> str:
    """Human-readable, copy-pasteable export command (cuts + reframe + captions
    + audio). Hardware encoders only."""
    cmd = " ".join(shlex.quote(a) for a in
                   build_ffmpeg_args(model, src_url, out_path, ass_path, encoder))
    notes = _notes(model)
    return "\n".join(notes + [cmd]) if notes else cmd


def render_to_file(model: EditModel, src_url: str, out_path: str,
                   ass_path: str = "captions.ass", encoder: str = "mac") -> tuple[bool, str]:
    """Actually run FFmpeg to produce the MP4. Assumes the .ass file at
    `ass_path` was already written. Returns (ok, message)."""
    if shutil.which("ffmpeg") is None:
        return False, ("FFmpeg is not installed / not on PATH. Install it "
                       "(https://ffmpeg.org/download.html), or copy-paste the printed command.")
    if not os.path.exists(src_url):
        return False, f"Source video not found: {src_url}"
    args = build_ffmpeg_args(model, src_url, out_path, ass_path, encoder)
    proc = subprocess.run(args, capture_output=True, text=True)
    if proc.returncode != 0:
        return False, "FFmpeg failed:\n" + proc.stderr[-600:]
    return True, out_path

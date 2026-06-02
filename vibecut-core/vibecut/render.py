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


def build_ffmpeg_command(model: EditModel, src_url: str, out_path: str,
                         ass_path: str = "captions.ass", encoder: str = "mac") -> str:
    """Assemble an FFmpeg command for the deterministic export."""
    vt = model.video_track()
    at = model.audio_track()
    enc = HW_ENCODERS.get(encoder, HW_ENCODERS["mac"])

    parts: list[str] = []
    n = len(vt.clips)
    for i, c in enumerate(vt.clips):
        parts.append(f"[0:v]trim=start={c.src_in:.3f}:end={c.src_out:.3f},"
                     f"setpts=PTS-STARTPTS[v{i}]")
    for i, c in enumerate(at.clips):
        parts.append(f"[0:a]atrim=start={c.src_in:.3f}:end={c.src_out:.3f},"
                     f"asetpts=PTS-STARTPTS[a{i}]")
    concat_inputs = "".join(f"[v{i}][a{i}]" for i in range(n))
    parts.append(f"{concat_inputs}concat=n={n}:v=1:a=1[vc][ac]")

    # audio filter chain from track filters
    achain = ["[ac]"]
    afilters = []
    for f in at.filters:
        if f.type == "loudnorm":
            p = f.params
            afilters.append(f"loudnorm=I={p['i']}:TP={p['tp']}:LRA={p['lra']}")
        elif f.type == "deepfilternet":
            afilters.append("anlmdn")  # stand-in; real build runs DeepFilterNet3
    afilters = afilters or ["anull"]
    achain.append(",".join(afilters) + "[aout]")
    parts.append("".join(achain))

    # burn captions on top of the concatenated video
    parts.append(f"[vc]ass={ass_path}[vout]")

    filter_complex = ";".join(parts)
    # punch-in / reframe are compositor-side; note them for the operator
    notes = []
    if any(f.type == "transform" for f in vt.filters):
        notes.append("# note: punch-in zoom keyframes are applied by the in-app compositor")
    if any(f.type == "auto_reframe" for f in vt.filters):
        notes.append(f"# note: auto-reframe to {model.profile.width}x{model.profile.height} applied by the in-app compositor")

    cmd = (f'ffmpeg -i "{src_url}" '
           f'-filter_complex "{filter_complex}" '
           f'-map "[vout]" -map "[aout]" '
           f'-c:v {enc} -b:v 12M -c:a aac -b:a 192k '
           f'"{out_path}"')
    return ("\n".join(notes + [cmd])) if notes else cmd

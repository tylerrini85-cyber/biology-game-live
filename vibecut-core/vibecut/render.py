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

# LUT-style color grades -> FFmpeg filter chains
LOOK_FILTERS = {
    "warm": "eq=gamma_r=1.06:gamma_b=0.94:saturation=1.06",
    "cool": "eq=gamma_b=1.06:gamma_r=0.95:saturation=1.03",
    "vivid": "eq=saturation=1.4:contrast=1.1",
    "bw": "hue=s=0,eq=contrast=1.08",
    "film": "curves=preset=medium_contrast,eq=saturation=0.92",
    "bright": "eq=brightness=0.06:contrast=1.05",
    "none": "",
}

# Adobe audio crossfade curve -> ffmpeg afade/acrossfade curve
AUDIO_FF = {"constant-power": "qsin", "constant-gain": "tri", "exponential": "exp"}

# Adobe overlap transitions -> ffmpeg xfade transition name
XFADE_MAP = {
    "cross-dissolve": "dissolve", "film-dissolve": "dissolve", "additive-dissolve": "dissolve",
    "wipe-left": "wipeleft", "wipe-right": "wiperight", "wipe-up": "wipeup", "wipe-down": "wipedown",
    "slide-left": "slideleft", "slide-right": "slideright", "slide-up": "slideup", "slide-down": "slidedown",
    "iris": "circleopen", "zoom": "zoomin", "pixelize": "pixelize", "radial": "radial",
}

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


def build_ass(captions: Captions, width: int = 1080, height: int = 1920,
              titles: list | None = None) -> str:
    primary = "&HFFFFFF&"
    highlight = _hex_to_ass(captions.highlight_color)
    boldish = captions.style in ("bold-karaoke", "hype", "neon")
    bold = -1 if boldish else 0
    fontsize = captions.size if captions.size and captions.size > 0 else (96 if boldish else 64)
    font = captions.font or "Arial"
    outline = captions.outline if captions.outline and captions.outline > 0 else (2 if captions.style == "clean" else 4)
    shadow = captions.shadow
    border_style = 3 if captions.box else 1
    outline_col = "&H90000000&" if captions.box else "&H000000&"  # box uses outline colour as bg
    anim = ""  # per-event animation prefix
    if captions.animation == "fade":
        anim = "{\\fad(150,150)}"
    elif captions.animation == "pop":
        anim = "{\\fad(80,60)}"
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
        (f"Style: Vibe,{font},{fontsize},{primary},{highlight},{outline_col},"
         f"&H80000000&,{bold},0,{border_style},{outline},{shadow},2,40,40,{margin_v},1"),
        (f"Style: Title,{font},{int(fontsize * 1.4)},{primary},{primary},&H000000&,"
         f"&H80000000&,-1,0,1,5,3,8,60,60,{int(height * 0.10)},1"),
        (f"Style: Center,{font},{int(fontsize * 1.2)},{primary},{primary},&H000000&,"
         f"&H80000000&,-1,0,1,5,3,5,60,60,0,1"),
        (f"Style: Lower,{font},{int(fontsize * 0.8)},{primary},{primary},&H000000&,"
         f"&HA0000000&,-1,0,1,3,2,1,80,80,{int(height * 0.12)},1"),
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    _TSTYLE = {"intro": "Title", "center": "Center", "lower-third": "Lower"}
    for tt in (titles or []):
        text = (tt.get("text") or "").upper() if captions.uppercase else (tt.get("text") or "")
        st, en = float(tt.get("start", 0.0)), float(tt.get("start", 0.0)) + float(tt.get("dur", 2.5))
        style = _TSTYLE.get(tt.get("kind", "intro"), "Title")
        lines.append(f"Dialogue: 0,{_ts(st)},{_ts(en)},{style},,0,0,0,,{{\\fad(150,150)}}{text}")
    for ev in captions.events:
        # karaoke: \kNN gives each word a highlight duration in centiseconds
        chunks = []
        for cw in ev.words:
            k = max(1, int(round(cw.d * 100)))
            word = cw.w.upper() if captions.uppercase else cw.w
            chunks.append(f"{{\\kf{k}}}{word} ")
        text = "".join(chunks).strip()
        lines.append(f"Dialogue: 0,{_ts(ev.start)},{_ts(ev.end)},Vibe,,0,0,0,,{anim}{text}")
    return "\n".join(lines) + "\n"


def _zoom_expr(vt) -> str | None:
    """Build an FFmpeg time-expression for the punch-in zoom factor Z(t).

    Each punch-in is 3 keyframes (t0:1.0, t0+0.15:max, t0+dur:1.0). We turn
    them into a sum of non-overlapping triangular ramps; Z defaults to 1.0.
    Commas are safe because the expression sits inside single-quoted options.
    """
    tf = next((f for f in vt.filters if f.type == "transform"), None)
    if not tf:
        return None
    kf = tf.keyframes.get("scale", [])
    terms = []
    for i in range(0, len(kf) - 2, 3):
        a, b, c = kf[i].t, kf[i + 1].t, kf[i + 2].t
        peak = kf[i + 1].v - 1.0
        if b - a <= 0 or c - b <= 0 or peak <= 0:
            continue
        up = f"between(t,{a:.3f},{b:.3f})*((t-{a:.3f})/{b - a:.3f})"
        dn = f"between(t,{b:.3f},{c:.3f})*(({c:.3f}-t)/{c - b:.3f})"
        terms.append(f"{peak:.3f}*({up}+{dn})")
    return "1+" + "+".join(terms) if terms else None


def _broll_url(clip) -> str:
    for e in clip.effects:
        if e.type == "broll_overlay":
            return e.params.get("url", "")
    return ""


def _build(model: EditModel, ass_path: str):
    """Return (filter_complex, broll_input_paths, skipped_broll)."""
    vt, at = model.video_track(), model.audio_track()
    W, H = model.profile.width, model.profile.height
    parts: list[str] = []
    n = len(vt.clips)
    for i, c in enumerate(vt.clips):
        parts.append(f"[0:v]trim=start={c.src_in:.3f}:end={c.src_out:.3f},setpts=PTS-STARTPTS[v{i}]")
    for i, c in enumerate(at.clips):
        parts.append(f"[0:a]atrim=start={c.src_in:.3f}:end={c.src_out:.3f},asetpts=PTS-STARTPTS[a{i}]")
    # detect effects + b-roll first (the music input index depends on b-roll count)
    speed_f = next((f.params.get("factor", 1.0) for f in vt.filters if f.type == "speed"), 1.0)
    reframe = any(f.type == "auto_reframe" for f in vt.filters)
    zoom = _zoom_expr(vt)
    broll_clips = next((t.clips for t in model.tracks if t.id == "V2"), [])
    existing = [c for c in broll_clips if os.path.exists(_broll_url(c))]
    skipped = len(broll_clips) - len(existing)
    effects = reframe or zoom or existing
    tr = next((f for f in vt.filters if f.type == "transition"), None)
    style = tr.params.get("style") if tr else "none"
    overlap = (style in XFADE_MAP) and n > 1
    D = float(tr.params.get("overlap", tr.params.get("duration", 0.4))) if overlap else 0.0

    # ---- video assembly: xfade chain (overlap transitions) or plain concat ----
    if overlap:
        crop = (f"crop='min(iw,ih*{W}/{H})':'min(ih,iw*{H}/{W})'," if reframe else "")
        for i in range(n):
            parts.append(f"[v{i}]{crop}scale={W}:{H},setsar=1,fps=30,format=yuv420p[vn{i}]")
        xf, prev = XFADE_MAP[style], "vn0"
        for i in range(1, n):
            parts.append(f"[{prev}][vn{i}]xfade=transition={xf}:duration={D:.3f}:"
                         f"offset={vt.clips[i].timeline_start:.3f}[vx{i}]")
            prev = f"vx{i}"
        vlabel = prev
    else:
        parts.append("".join(f"[v{i}][a{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=1[vc][ac]")
        vlabel = "vc"

    # ---- audio assembly: acrossfade chain (overlap) or the concat's [ac] ----
    if overlap:
        curve = AUDIO_FF.get(tr.params.get("audio", "constant-power"), "qsin")
        aprev = "a0"
        for i in range(1, n):
            parts.append(f"[{aprev}][a{i}]acrossfade=d={D:.3f}:c1={curve}:c2={curve}[ax{i}]")
            aprev = f"ax{i}"
        audio_src = aprev
    else:
        audio_src = "ac"

    # voice chain
    afilters = []
    for f in at.filters:
        if f.type == "loudnorm":
            p = f.params
            afilters.append(f"loudnorm=I={p['i']}:TP={p['tp']}:LRA={p['lra']}")
        elif f.type == "deepfilternet":
            # ffmpeg-native speech denoise (DeepFilterNet is the desktop upgrade)
            afilters.append("afftdn=nf=-25,highpass=f=90,lowpass=f=12000")
    if abs(float(speed_f) - 1.0) > 1e-3:
        afilters += _atempo_chain(float(speed_f))
    vg = float(getattr(model, "voice_gain", 1.0) or 1.0)
    if abs(vg - 1.0) > 1e-3:
        afilters.append(f"volume={vg:.2f}")
    # fade-family audio crossfade curve at start/end (overlap uses acrossfade instead)
    if not overlap and tr and style in ("fade", "dip-to-black", "dip-to-white"):
        total_a = sum(c.src_out - c.src_in for c in vt.clips)
        d = float(tr.params.get("duration", 0.4))
        curve = AUDIO_FF.get(tr.params.get("audio", "constant-power"), "qsin")
        afilters.append(f"afade=t=in:st=0:d={d:.3f}:curve={curve}")
        afilters.append(f"afade=t=out:st={max(0.0, total_a - d):.3f}:d={d:.3f}:curve={curve}")
    parts.append(f"[{audio_src}]" + ",".join(afilters or ["anull"]) + "[voicepre]")

    # background music (+ optional sidechain ducking under the voice)
    music_path = None
    mus = getattr(model, "music", None)
    if mus and os.path.exists(mus.get("url", "")):
        midx = 1 + len(existing)
        parts.append(f"[{midx}:a]volume={float(mus.get('gain', 0.25)):.3f}[mv]")
        if mus.get("duck", True):
            ratio = round(2.0 + float(mus.get("duck_amount", 0.8)) * 8.0, 1)  # 0..1 -> 2..10
            parts.append("[voicepre]asplit=2[va][vb]")
            parts.append(f"[mv][vb]sidechaincompress=threshold=0.03:ratio={ratio}:attack=20:release=300[mvd]")
            parts.append("[va][mvd]amix=inputs=2:duration=first:weights=1 1:normalize=0[aout]")
        else:
            parts.append("[voicepre][mv]amix=inputs=2:duration=first:weights=1 1:normalize=0[aout]")
        music_path = mus["url"]
    else:
        parts.append("[voicepre]anull[aout]")

    if not overlap and reframe:  # center-crop to target aspect, normalize to WxH
        parts.append(f"[vc]crop='min(iw,ih*{W}/{H})':'min(ih,iw*{H}/{W})',"
                     f"scale={W}:{H},setsar=1[vr]")
        vlabel = "vr"
    elif not overlap and effects:  # normalize resolution so zoom/overlays line up
        parts.append(f"[vc]scale={W}:{H},setsar=1[vr]")
        vlabel = "vr"

    if zoom:  # time-based punch-in: crop a centered, shrinking window, scale back
        parts.append(f"[{vlabel}]crop=w='iw/({zoom})':h='ih/({zoom})':"
                     f"x='(iw-ow)/2':y='(ih-oh)/2',scale={W}:{H}[vz]")
        vlabel = "vz"

    broll_paths = []
    for idx, c in enumerate(existing):  # full-frame cutaways during their window
        s = c.timeline_start
        dur = c.src_out - c.src_in
        in_i = 1 + idx
        parts.append(f"[{in_i}:v]trim=0:{dur:.3f},setpts=PTS-STARTPTS+{s:.3f}/TB,"
                     f"scale={W}:{H}[bv{idx}]")
        parts.append(f"[{vlabel}][bv{idx}]overlay=enable='between(t,{s:.3f},{s + dur:.3f})':"
                     f"eof_action=pass[ov{idx}]")
        vlabel = f"ov{idx}"
        broll_paths.append(_broll_url(c))

    # color grade (LUT-style look)
    cl = next((f for f in vt.filters if f.type == "color_look"), None)
    if cl and LOOK_FILTERS.get(cl.params.get("look")):
        parts.append(f"[{vlabel}]{LOOK_FILTERS[cl.params['look']]}[vcol]")
        vlabel = "vcol"
    # manual color adjustments (brightness/contrast/saturation/temperature)
    ca = getattr(model, "color_adjust", None)
    if ca:
        b, c, s = float(ca.get("brightness", 0)), float(ca.get("contrast", 1)), float(ca.get("saturation", 1))
        t = float(ca.get("temperature", 0))
        parts.append(f"[{vlabel}]eq=brightness={b:.3f}:contrast={c:.3f}:saturation={s:.3f},"
                     f"colorbalance=rs={t * 0.3:.3f}:bs={-t * 0.3:.3f}[veq]")
        vlabel = "veq"
    # custom .cube LUT
    lut = getattr(model, "lut", None)
    if lut and os.path.exists(lut):
        parts.append(f"[{vlabel}]lut3d='{lut}'[vlut]")
        vlabel = "vlut"

    # burn captions
    parts.append(f"[{vlabel}]ass={ass_path}[vcap]")
    vlabel = "vcap"

    # fade family: fade in/out + (for dip styles) a dip-to-black/white at each cut
    if not overlap and tr and style in ("fade", "dip-to-black", "dip-to-white"):
        color = "white" if style == "dip-to-white" else "black"
        total = sum(c.src_out - c.src_in for c in vt.clips)
        d = float(tr.params.get("duration", 0.4))
        fades = [f"fade=t=in:st=0:d={d:.3f}:c={color}",
                 f"fade=t=out:st={max(0.0, total - d):.3f}:d={d:.3f}:c={color}"]
        if style in ("dip-to-black", "dip-to-white"):
            dh = min(d, 0.3) / 2.0  # short dip so cuts don't drag
            off = 0.0
            for c in vt.clips[:-1]:
                off += c.src_out - c.src_in  # cut boundary on the concat timeline
                fades.append(f"fade=t=out:st={max(0.0, off - dh):.3f}:d={dh:.3f}:c={color}")
                fades.append(f"fade=t=in:st={off:.3f}:d={dh:.3f}:c={color}")
        parts.append(f"[{vlabel}]{','.join(fades)}[vtr]")
        vlabel = "vtr"

    # speed / time-remap (applied last so captions + fades remap with the video)
    if abs(float(speed_f) - 1.0) > 1e-3:
        parts.append(f"[{vlabel}]setpts=PTS/{float(speed_f):.4f}[vout]")
    else:
        parts.append(f"[{vlabel}]null[vout]")
    return ";".join(parts), broll_paths, music_path, skipped


def _atempo_chain(factor: float) -> list[str]:
    """atempo accepts 0.5–2.0; chain for factors outside that range."""
    out = []
    f = factor
    while f > 2.0:
        out.append("atempo=2.0"); f /= 2.0
    while f < 0.5:
        out.append("atempo=0.5"); f *= 2.0
    out.append(f"atempo={f:.3f}")
    return out


def build_ffmpeg_args(model: EditModel, src_url: str, out_path: str,
                      ass_path: str = "captions.ass", encoder: str = "mac") -> list[str]:
    """The export command as an argv list (safe for subprocess)."""
    enc = HW_ENCODERS.get(encoder, HW_ENCODERS["mac"])
    fc, broll_paths, music_path, _ = _build(model, ass_path)
    args = ["ffmpeg", "-y", "-i", src_url]
    for p in broll_paths:
        args += ["-i", p]
    if music_path:
        args += ["-i", music_path]
    args += ["-filter_complex", fc, "-map", "[vout]", "-map", "[aout]",
             "-c:v", enc, "-b:v", "12M", "-c:a", "aac", "-b:a", "192k", out_path]
    return args


def build_ffmpeg_command(model: EditModel, src_url: str, out_path: str,
                         ass_path: str = "captions.ass", encoder: str = "mac") -> str:
    """Human-readable, copy-pasteable export command. Bakes in cuts, reframe,
    punch-in zoom, b-roll overlays, captions, and audio. Hardware encoders only."""
    cmd = " ".join(shlex.quote(a) for a in
                   build_ffmpeg_args(model, src_url, out_path, ass_path, encoder))
    _, _, _, skipped = _build(model, ass_path)
    notes = []
    if skipped:
        notes.append(f"# note: {skipped} suggested b-roll clip(s) skipped (file not found on disk)")
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

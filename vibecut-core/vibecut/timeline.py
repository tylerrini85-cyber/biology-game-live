"""ASCII timeline preview — a quick, human-readable view of the edit.

Renders which parts of the *original* footage survived (kept vs cut), so you
can see at a glance what the vibe did. Locked clips are marked distinctly.
A real UI draws this as the canvas timeline; this is the terminal stand-in.
"""
from __future__ import annotations

from .editmodel import EditModel

KEPT, CUT, LOCKED = "#", "·", "@"  # '#', '·', '@'


def render(model: EditModel, original_s: float, width: int = 56) -> str:
    if original_s <= 0:
        return "(empty)"
    cells = [CUT] * width

    def col(t: float) -> int:
        return max(0, min(width - 1, int(t / original_s * width)))

    kept = 0.0
    for c in model.video_track().clips:
        ch = LOCKED if c.locked else KEPT
        for x in range(col(c.src_in), col(c.src_out) + 1):
            cells[x] = ch
        kept += c.duration

    bar = "".join(cells)
    vt = model.video_track()
    zooms = sum(len(f.keyframes.get("scale", [])) // 3
                for f in vt.filters if f.type == "transform")
    locked_n = sum(1 for c in vt.clips if c.locked)
    pct = 100 * kept / original_s if original_s else 0

    lines = [
        f"  source 0s {'':<2}[{bar}] {original_s:.0f}s",
        f"  legend: {KEPT} kept  {CUT} cut  {LOCKED} locked",
        f"  kept {kept:.1f}s of {original_s:.1f}s ({pct:.0f}%)  ·  "
        f"clips {len(vt.clips)}  ·  captions {len(model.captions.events)}  ·  "
        f"zooms {zooms}  ·  locked {locked_n}  ·  "
        f"{model.profile.width}x{model.profile.height}",
    ]
    return "\n".join(lines)

"""Self-contained HTML for an edit — used by both the CLI (--html) and the
local web UI (vibecut.server). `STYLE` + `render_body()` are shared so the
server can embed an edit result inside its page; `render_html()` wraps the body
into a standalone document.
"""
from __future__ import annotations

import html

from .editmodel import EditModel

STYLE = """
  :root { --bg:#0f1115; --card:#171a21; --line:#262b36; --txt:#e6e9ef;
          --muted:#8b93a7; --kept:#37d399; --cut:#2a2f3a; --lock:#ffcf3a; --accent:#7aa2ff; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--txt);
         font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; }
  .wrap { max-width:880px; margin:0 auto; padding:28px 20px 64px; }
  h1 { font-size:22px; margin:0 0 4px; } .logo { color:var(--accent); }
  .prompt { background:var(--card); border:1px solid var(--line); border-radius:12px;
            padding:14px 16px; margin:16px 0; font-style:italic; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px;
          padding:18px; margin:14px 0; }
  .label { color:var(--muted); font-size:12px; text-transform:uppercase;
           letter-spacing:.06em; margin-bottom:10px; }
  .timeline { position:relative; height:34px; background:var(--cut);
              border-radius:7px; overflow:hidden; }
  .seg { position:absolute; top:0; height:100%; }
  .seg.kept { background:var(--kept); } .seg.locked { background:var(--lock); }
  .scale { display:flex; justify-content:space-between; color:var(--muted);
           font-size:12px; margin-top:6px; }
  .stats { display:flex; flex-wrap:wrap; gap:18px; margin-top:14px; }
  .stat b { font-size:20px; } .stat span { color:var(--muted); font-size:12px; display:block; }
  .chip { display:inline-block; background:#1e2430; border:1px solid var(--line);
          color:var(--accent); border-radius:999px; padding:4px 11px; margin:3px 4px 0 0;
          font-size:12.5px; }
  .cap { padding:6px 0; border-bottom:1px solid var(--line); }
  .cap .t { color:var(--muted); font-size:12px; margin-right:8px; }
  .muted { color:var(--muted); font-size:13px; padding-top:8px; }
  details { margin-top:8px; } summary { cursor:pointer; color:var(--muted); }
  pre { white-space:pre-wrap; word-break:break-all; background:#0b0d12;
        border:1px solid var(--line); border-radius:10px; padding:14px; font-size:12px; }
  .foot { color:var(--muted); font-size:12px; margin-top:24px; }
  /* form */
  form.vibe { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:18px; }
  form.vibe input[type=text], form.vibe input[type=number], form.vibe select {
    width:100%; background:#0b0d12; border:1px solid var(--line); color:var(--txt);
    border-radius:9px; padding:11px 12px; font-size:15px; }
  .row { display:flex; gap:12px; flex-wrap:wrap; margin-top:12px; }
  .toggles { display:flex; gap:14px; flex-wrap:wrap; margin-top:12px; color:var(--muted); font-size:14px; }
  .toggles label { display:flex; gap:6px; align-items:center; }
  button { margin-top:14px; background:var(--accent); color:#0b0d12; border:0;
           border-radius:10px; padding:11px 20px; font-size:15px; font-weight:700; cursor:pointer; }
"""


def _segments_html(model: EditModel, original_s: float) -> str:
    if original_s <= 0:
        return ""
    spans = []
    for c in model.video_track().clips:
        left = 100 * c.src_in / original_s
        width = 100 * (c.src_out - c.src_in) / original_s
        cls = "locked" if c.locked else "kept"
        title = f"{c.src_in:.1f}s-{c.src_out:.1f}s" + (" (locked)" if c.locked else "")
        spans.append(f'<div class="seg {cls}" style="left:{left:.2f}%;'
                     f'width:{width:.2f}%" title="{title}"></div>')
    return "".join(spans)


def _caption_preview(model: EditModel, limit: int = 8) -> str:
    cap = model.captions
    weight = 800 if cap.style in ("bold-karaoke", "hype") else 500
    out = []
    for ev in cap.events[:limit]:
        ws = []
        for i, w in enumerate(ev.words):
            color = f"color:{cap.highlight_color};" if i == 0 else ""
            ws.append(f'<span style="font-weight:{weight};{color}">{html.escape(w.w)}</span>')
        out.append(f'<div class="cap"><span class="t">{ev.start:0.1f}s</span> {" ".join(ws)}</div>')
    more = (f'<div class="muted">+{len(cap.events) - limit} more...</div>'
            if len(cap.events) > limit else "")
    return "".join(out) + more


def render_body(prompt: str, model: EditModel, report: dict, original_s: float,
                ffmpeg: str) -> str:
    chips = "".join(f'<span class="chip">{html.escape(list(o.keys())[0])}</span>'
                    for o in report.get("ops", []) if isinstance(o, dict))
    final_s = report.get("final_s", model.total_duration())
    pct = 100 * final_s / original_s if original_s else 0
    bt = next((t for t in model.tracks if t.id == "V2"), None)
    broll_n = len(bt.clips) if bt else 0
    return f"""
  <div class="prompt">&ldquo;{html.escape(prompt)}&rdquo;</div>
  <div class="card">
    <div class="label">Timeline &middot; original footage (green kept, gold locked, dark cut)</div>
    <div class="timeline">{_segments_html(model, original_s)}</div>
    <div class="scale"><span>0s</span><span>{original_s:.0f}s</span></div>
    <div class="stats">
      <div class="stat"><b>{original_s:.0f}s</b><span>original</span></div>
      <div class="stat"><b>{final_s:.0f}s</b><span>final ({pct:.0f}%)</span></div>
      <div class="stat"><b>{len(model.video_track().clips)}</b><span>clips</span></div>
      <div class="stat"><b>{len(model.captions.events)}</b><span>captions</span></div>
      <div class="stat"><b>{broll_n}</b><span>b-roll</span></div>
      <div class="stat"><b>{model.profile.width}&times;{model.profile.height}</b><span>frame</span></div>
    </div>
  </div>
  <div class="card"><div class="label">Edit plan</div>{chips}</div>
  <div class="card"><div class="label">Captions preview &middot; style: {html.escape(model.captions.style)}</div>
    {_caption_preview(model)}</div>
  <div class="card"><div class="label">Export</div>
    <details><summary>FFmpeg command (hardware encode)</summary><pre>{html.escape(ffmpeg)}</pre></details>
  </div>"""


def page(title: str, inner: str) -> str:
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title><style>{STYLE}</style></head>
<body><div class="wrap">{inner}
  <div class="foot">Generated locally by VibeCut &middot; no APIs &middot; no generative video.</div>
</div></body></html>
"""


def render_html(prompt: str, model: EditModel, report: dict, original_s: float,
                ffmpeg: str) -> str:
    header = '<h1><span class="logo">&#9670; VibeCut</span> &mdash; edit report</h1>'
    return page("VibeCut - edit report", header + render_body(prompt, model, report, original_s, ffmpeg))

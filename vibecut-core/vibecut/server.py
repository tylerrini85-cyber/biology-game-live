"""Local web UI for VibeCut — runs on http://localhost:8000, stdlib only.

    python3 -m vibecut.server          # then open the printed URL

Type a vibe prompt, tick effect options, pick a sample analysis, and see the
edit (timeline, plan, captions, export command) rendered live in your browser.
100% local: no installs, no network, no APIs. Optional --llm uses local Ollama.
"""
from __future__ import annotations

import argparse
import html
import json
import os
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .analysis import AssetAnalysis
from .editmodel import EditModel
from .engine import apply_plan
from .render import build_ffmpeg_command
from .report import page, render_body
from .vibe import OllamaProvider, RulesProvider

_HERE = os.path.dirname(__file__)
SAMPLES = os.path.normpath(os.path.join(_HERE, "..", "samples"))
OPTIONS = [("captions", "Captions"), ("zooms", "Auto-zoom"), ("broll", "B-roll"),
           ("reframe", "Vertical reframe"), ("enhance", "Enhance audio")]
DEFAULT_ON = {"captions", "zooms", "enhance"}


def _analyses() -> list[str]:
    out = []
    for fn in sorted(os.listdir(SAMPLES)) if os.path.isdir(SAMPLES) else []:
        if not fn.endswith(".json"):
            continue
        try:
            with open(os.path.join(SAMPLES, fn)) as fh:
                d = json.load(fh)
            if "words" in d and "speech" in d:
                out.append(fn)
        except (ValueError, OSError):
            pass
    return out


def _form(q: dict, submitted: bool) -> str:
    analyses = _analyses()
    prompt = html.escape(q.get("prompt", "punchy, under 60s, bold captions for tiktok"))
    chosen = q.get("analysis", analyses[0] if analyses else "")
    opts = ""
    for key, label in OPTIONS:
        on = (key in q) if submitted else (key in DEFAULT_ON)
        opts += (f'<label><input type="checkbox" name="{key}"'
                 f'{" checked" if on else ""}> {label}</label>')
    sel = "".join(f'<option{" selected" if a == chosen else ""}>{html.escape(a)}</option>'
                  for a in analyses)
    llm_on = "llm" in q if submitted else False
    return f"""
  <h1><span class="logo">&#9670; VibeCut</span> &mdash; local editor</h1>
  <form class="vibe" method="get" action="/">
    <input type="hidden" name="submitted" value="1">
    <div class="label">Describe the edit you want</div>
    <input type="text" name="prompt" value="{prompt}" autofocus>
    <div class="row">
      <div style="flex:2"><div class="label">Source clip (analysis)</div>
        <select name="analysis">{sel}</select></div>
    </div>
    <div class="toggles">{opts}
      <label><input type="checkbox" name="llm"{" checked" if llm_on else ""}> Use local LLM (Ollama)</label>
    </div>
    <button type="submit">Vibe it &#9654;</button>
  </form>"""


def _run(q: dict) -> str:
    analyses = _analyses()
    fn = q.get("analysis", analyses[0] if analyses else "")
    if fn not in analyses:  # path-safety: only bundled sample files
        return '<div class="card">Unknown analysis file.</div>'
    analysis = AssetAnalysis.load(os.path.join(SAMPLES, fn))

    toggles = {key: (key in q) for key, _ in OPTIONS}
    prompt = q.get("prompt", "")

    note = ""
    if "llm" in q:
        try:
            plan = OllamaProvider().plan(prompt, toggles)
            note = '<div class="muted">Used local Ollama model.</div>'
        except Exception as exc:  # noqa: BLE001 - graceful offline fallback
            plan = RulesProvider().plan(prompt, toggles)
            note = (f'<div class="muted">Ollama unavailable ({html.escape(str(exc)[:80])}); '
                    'used the offline rules parser.</div>')
    else:
        plan = RulesProvider().plan(prompt, toggles)

    library = None
    if toggles.get("broll"):
        lib_path = os.path.join(SAMPLES, "media_library.json")
        if os.path.exists(lib_path):
            with open(lib_path) as fh:
                library = json.load(fh)

    model, report = apply_plan(plan, analysis, media_library=library)
    cmd = build_ffmpeg_command(model, analysis.source_url, "out.mp4")
    return note + render_body(prompt, model, report, analysis.duration, cmd)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quieter console
        pass

    def do_GET(self):  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/favicon.ico":
            self.send_response(204); self.end_headers(); return
        if parsed.path != "/":
            self.send_response(404); self.end_headers(); return
        raw = urllib.parse.parse_qs(parsed.query)
        q = {k: v[0] for k, v in raw.items()}  # checkboxes present == on
        submitted = "submitted" in q
        body = _form(q, submitted)
        if submitted and q.get("prompt"):
            body += _run(q)
        out = page("VibeCut", body).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="vibecut.server", description="Local VibeCut web UI.")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args(argv)
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"\n  VibeCut is running.  Open  ->  http://{args.host}:{args.port}\n"
          "  (Ctrl+C to stop)\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  stopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

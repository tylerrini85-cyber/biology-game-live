# VibeCut Web — zero-install browser demo

A **single self-contained `index.html`** that runs the whole VibeCut vibe →
edit → preview loop **entirely in your browser**. No server, no install, no
terminal, no APIs, no video generation — the engine is ported to JavaScript and
the sample clip data is embedded.

## Use it

**Just open `index.html`** — double-click it, or drag it into any browser.
Type a prompt, tick effect options, click **Vibe it**, and see the edit
(timeline of kept-vs-cut, edit plan, caption preview, export command) instantly.

## Want a shareable link?

It's one static file, so any static host works:

- **Netlify Drop** — go to <https://app.netlify.com/drop> and drag `index.html`
  in. You get a public URL in seconds (easiest).
- **GitHub Pages** — enable Pages for this repo/branch and point it at this
  folder; the page renders at your `github.io` URL.

## What it does / doesn't do

- ✅ Full vibe parsing, silence/filler cutting, phrase-level trimming, captions,
  auto-zoom + reframe planning, b-roll matching, FFmpeg command generation —
  identical logic to `vibecut-core` (verified to match its outputs).
- ❌ It shows the **edit decisions and a preview**, not live video playback or a
  rendered MP4 — that's the desktop app's GPU/FFmpeg job (design spec §11).

## Files

| File | Role |
|------|------|
| `index.html` | the built, self-contained app (open this) |
| `vibecut.js` | the JS engine (port of `vibecut-core`), used by the build |
| `build.py`   | inlines `vibecut.js` + sample data + UI → `index.html` |

Rebuild after changing the engine:

```bash
python3 build.py
```

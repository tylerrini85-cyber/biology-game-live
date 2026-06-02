# VibeCut Web — zero-install browser apps

Two self-contained HTML files that run the whole VibeCut loop **in your
browser** — no server, install, terminal, APIs, or video generation:

- **`studio.html`** — the **interactive editor**: load your video + `.srt`,
  vibe-edit, **watch the edit play back live** (cuts + captions + punch-in
  zoom), **manually lock/delete clips**, and **re-vibe** keeping locked parts.
- **`index.html`** — a simpler demo (prompt → edit summary), good for a quick look.

## Use it

**Just open the file** — double-click it, or drag it into any browser. For the
Studio: optionally load a video (for live preview) and a captions `.srt` for it,
type a prompt, tick effects, **Vibe it**, press **Play edit**, fine-tune clips,
or **Re-vibe**. Without a video it previews the caption/zoom timing on a
placeholder using the built-in sample.

Rebuild after engine changes: `python3 build_studio.py` and `python3 build.py`.

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

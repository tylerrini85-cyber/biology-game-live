# VibeCut Desktop — Phase 0 spike (Tauri + Rust)

The starting point for the **native desktop app** from the design spec (§4–5,
§11): a Tauri shell (Rust backend + web UI) that will host **native video
playback** and the **wgpu GPU compositor**, while reusing the same engine and
edit-model as the browser Studio.

> Status: scaffold. It is **not built/compiled in the research sandbox** (needs
> a local Rust toolchain, the Tauri CLI, and a GPU). Build it on your machine.

## What this scaffold gives you
- A Tauri v2 project (`src-tauri/`) with:
  - `probe_ffmpeg` command — checks FFmpeg is installed (the export backend).
  - `run_export` command — shells out to FFmpeg with the command the engine
    generates (the same one the Studio/CLI produce) to render the final MP4.
  - A documented seam (`preview.rs`, TODO) where the **wgpu native preview
    surface** goes — the one piece a web page can't do (Spec §11).
- A web frontend (`src/`) that reuses `../vibecut-web/vibecut.js` (the JS engine)
  for the vibe → plan → edit-model loop.

## Build & run locally
```bash
# 1. install Rust (https://rustup.rs) and the Tauri CLI
cargo install create-tauri-app   # or: npm create tauri-app@latest
# 2. from this folder
npm install
npm run tauri dev
```

## Roadmap inside the spike (in order)
1. **Native preview surface** — render decoded frames to a `wgpu` surface beside
   the WebView (the `wry`/`tauri-wgpu` pattern; see spec §11). This is the #1
   technical unknown to de-risk first.
2. **FFmpeg hardware decode → GPU texture** (`ffmpeg-next`) for scrubbing.
3. **Proxy media + frame cache** for smooth 4K playback.
4. **Wire the edit-model** (shared JSON) so the same vibe/manual edits drive the
   native preview and the FFmpeg export.

## Files
| Path | Role |
|------|------|
| `src-tauri/Cargo.toml` | Rust deps (tauri, serde; later: wgpu, ffmpeg-next) |
| `src-tauri/tauri.conf.json` | app config |
| `src-tauri/src/main.rs` | Tauri commands (probe + export) + preview TODO |
| `src/index.html` | frontend shell (reuses the JS engine) |
| `package.json` | dev scripts |

The export path works as soon as FFmpeg is installed; the GPU preview is the
build-out target.

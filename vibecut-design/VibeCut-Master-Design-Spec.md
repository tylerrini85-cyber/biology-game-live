# VibeCut — Master Design Specification

*A local-first, AI-assisted desktop video editor that combines one-prompt "vibe" auto-editing (Captions-style) with a full manual timeline (Premiere-style).*

> **Working codename:** "VibeCut" (placeholder — rename freely).
> **Document status:** v1.0 design spec. Architecture + technology decisions are grounded in how proven open-source editors (Shotcut, Kdenlive, Olive, OpenShot) and local-AI tooling actually work, with commercial-licensing constraints baked in.
> **Date:** June 2026.

---

## 1. Vision

One application with **three ways to edit the same project**, sharing one timeline:

1. **Vibe** — Upload a clip, type what you want in plain language ("cut the dead air, add bold captions, punch in on the key lines, get it under 60 seconds, make it punchy"), optionally tick which effects/styles you want. The app auto-edits the whole thing.
2. **Manual** — Drop into a full Premiere-style multitrack timeline and refine by hand: trim, cut, effects, color, audio, keyframes, captions styling.
3. **Re-vibe** — At any point, type a new instruction ("actually make it calmer and longer, lose the zooms") and the AI re-edits from your current state — fast, because all the heavy analysis is cached.

**Hard constraints (from the brief):**
- ✅ Cross-platform **desktop** (macOS + Windows).
- ✅ **Local-first / no required external APIs** — transcription and the "vibe brain" run on-device. (A cloud API is an *optional, off-by-default* toggle behind a clean interface, never a dependency.)
- ✅ Scales from a **60-second vertical short** to a **30-minute horizontal long-form** edit (business use, both formats).
- ❌ **No generative video / no synthetic actors / no AI image or video generation.** B-roll is *retrieved from the user's own media*, never generated.
- ✅ **Commercial product** — every dependency is vetted for license compatibility (see §15).

---

## 2. The one architectural idea everything hangs on

Every serious non-linear editor (NLE) separates two things, and so do we:

| Layer | What it is | Who writes to it |
|---|---|---|
| **Edit Model (the EDL)** | A small, declarative, **non-destructive** JSON description of "what clip, where, with which effects, animated how." References media by path + in/out points. Never contains pixels. | The Vibe engine **and** the manual UI both write here. |
| **Render Engine** | Given the Edit Model + a time, produces a **frame** (fast, for preview) or a **file** (slow + max quality, for export). | Read-only consumer of the Edit Model. |

**Why this matters:**
- The **AI only manipulates data, never pixels.** "Auto-edit" = the AI writes edit decisions into the JSON model. This makes results deterministic, reproducible, undoable, and unit-testable.
- The **same model drives both a real-time GPU preview and the final export** — no divergence.
- Vibe and Manual modes are not two apps; they're two editors of **one shared document**. Re-vibe = regenerate decisions; manual edits = hand-written decisions; they coexist in the same JSON.

This is exactly how MLT/Kdenlive/Shotcut are built (UI → edit model → render engine), proven over 20 years.

---

## 3. The three modes, and how they share one timeline

```
                         ┌──────────────────────────────┐
                         │      ONE PROJECT (JSON EDL)    │
                         │  tracks · clips · effects ·    │
                         │  keyframes · captions · audio  │
                         └───────▲───────────────▲────────┘
            writes decisions     │               │   writes decisions
        ┌────────────────────────┘               └────────────────────────┐
        │                                                                  │
┌───────┴────────┐                                                ┌────────┴───────┐
│  VIBE ENGINE    │                                                │  MANUAL EDITOR  │
│ text → edit plan│   ◀── "Re-vibe" re-runs this on current state  │ timeline, tools │
│ → timeline ops  │                                                │ effects, color  │
└───────┬─────────┘                                                └────────┬────────┘
        │                                                                   │
        └───────────────────────────┐         ┌─────────────────────────────┘
                                     ▼         ▼
                         ┌──────────────────────────────┐
                         │       RENDER ENGINE (wgpu)     │ ── preview frame
                         │   reads model → composites     │ ── export file (FFmpeg)
                         └──────────────────────────────┘
```

**Conflict rule (FINALIZED — "lock to protect"):** by default, **re-vibe is free to re-edit the entire timeline** for the most powerful results. Anything you want preserved you **explicitly lock** (a clip/segment carries `origin: "vibe" | "manual"` plus a `locked: true|false` flag; only `locked` clips are untouchable on re-vibe). UX safeguards make this safe: (a) a one-click **"lock all my manual edits"** button, (b) a clear pre-run diff/preview of what re-vibe will change, and (c) full undo. This favors powerful, flexible re-vibes over auto-protection.

---

## 4. System architecture (layers)

```
┌─────────────────────────────────────────────────────────────────────┐
│  FRONTEND (React + react-konva)  — runs in Tauri WebView              │
│   • Timeline UI (canvas, virtualized)   • Vibe prompt bar             │
│   • Effect/inspector panels             • Caption style editor        │
│   • Source/Program monitors (pixels come from native surface, §11)    │
└───────────────▲───────────────────────────────────────▲──────────────┘
                │ Tauri IPC (commands/events)            │ native GPU surface
┌───────────────┴───────────────────────────────────────┴──────────────┐
│  RUST CORE (Tauri backend)                                            │
│  ┌──────────────┐ ┌───────────────┐ ┌──────────────┐ ┌─────────────┐ │
│  │ Project Store │ │ Render/        │ │ Analysis     │ │ Vibe         │ │
│  │ (JSON EDL,    │ │ Compositor     │ │ Orchestrator │ │ Orchestrator │ │
│  │ undo/redo)    │ │ (wgpu + FFmpeg)│ │ (cache)      │ │ (LLM client) │ │
│  └──────────────┘ └───────────────┘ └──────┬───────┘ └──────┬──────┘ │
└───────────────────────────────────────────┼────────────────┼────────┘
                                             │ spawn/IPC      │ local HTTP/embedded
┌────────────────────────────────────────────┴────────────────┴────────┐
│  LOCAL AI / MEDIA SIDECARS (bundled, on-device, no network)           │
│   • Whisper (whisper.cpp / faster-whisper / WhisperX)  → transcript   │
│   • Silero VAD → silence map      • PySceneDetect → shots             │
│   • MediaPipe/YOLO → subject tracks  • DeepFilterNet3 → denoise       │
│   • OpenCLIP + FAISS → b-roll search  • Ollama/llama.cpp → vibe LLM   │
│   • FFmpeg (LGPL build) → decode/encode/probe                          │
└───────────────────────────────────────────────────────────────────────┘
```

**Process model:** heavy/native work lives in the Rust core and bundled sidecars, **never in the WebView**. The frontend is pure UI + the timeline canvas; preview pixels are drawn on a native wgpu surface composited beside the WebView.

---

## 5. Technology stack (the commercial-safe stack)

| Concern | Choice | Why / license |
|---|---|---|
| **App shell** | **Tauri v2** (Rust backend, web frontend) | Small/fast, first-class native FFI to FFmpeg/wgpu/AI; precedent: **Cap**. MIT/Apache. |
| **Frontend** | **React + react-konva** (canvas timeline) | Interactive canvas timeline; virtualization for perf. Permissive. |
| **Preview compositor** | **Own wgpu/WGSL engine** (Metal on Mac, D3D12 on Win) | Owning it avoids GPL effect libs; linear-light float pipeline (Movit/Olive *technique*). You own = no license risk. |
| **Decode/Encode** | **FFmpeg, LGPL build, dynamically linked** (libav\* via `ffmpeg-next`, or `ffmpeg-sidecar`) | LGPL-safe. Hardware encoders (VideoToolbox/NVENC/QSV) avoid the x264/x265 GPL trap. |
| **Source-monitor playback** | **libmpv** (optional, LGPL, dynamic link) | Frame-accurate single-clip scrubbing. |
| **Color management** | **OpenColorIO** (+ 3D-LUT GPU lookups) | BSD/permissive — commercial-safe. |
| **Captions render** | **libass** (preview + burn-in, same renderer) → own Skia/wgpu text later | ASS does karaoke/word-highlight natively; verify libass license at ship. |
| **Transcription** | **WhisperX** (cross-platform) / **whisper.cpp** (Mac Metal+ANE) / **Parakeet-TDT** (NVIDIA/English) | Word-level timestamps; all local. MIT/BSD/CC-BY. |
| **VAD / silence** | **Silero VAD** | ~4× fewer errors than WebRTC; bundled in faster-whisper. MIT. |
| **Scene detection** | **PySceneDetect** (AdaptiveDetector default) | Robust to camera motion. BSD. |
| **Subject tracking / reframe** | **MediaPipe** (face/pose) + AutoFlip-style crop optimizer; **YOLO** optional multi-subject | Local, CPU-friendly. Apache/permissive (check YOLO variant license). |
| **Speech enhancement** | **DeepFilterNet3** (default), Resemble-Enhance (opt-in studio) | Full-band 48 kHz, real-time-capable. |
| **Loudness** | **FFmpeg `loudnorm`** two-pass, −16 LUFS | Standard EBU R128. |
| **B-roll search** | **OpenCLIP + FAISS** over user's own library | Local semantic retrieval, **no generation**. MIT. |
| **Vibe LLM** | **Qwen 2.5 7B** or **Llama 3.1 8B** via **Ollama**, **GBNF/JSON-schema constrained decoding** | Local, free, private; hard JSON guarantee. Permissive/community licenses. |
| **Project format** | **Own JSON** modeled on MLT semantics; command-pattern undo/redo | You own it; AI- and diff-friendly. |

**Pragmatic shortcut (if time-to-market beats licensing purity):** embed the **MLT framework core (LGPL)** as the render engine and wrap it from Rust — instant proven multitrack engine + Movit GPU preview + huge filter set — at the cost of C interop and having to keep GPL pieces (`frei0r`, `melt`) out of distribution. Recommended only for a fast prototype, not the long-term product.

---

## 6. The Edit Model (data model)

JSON, modeled directly on MLT's battle-tested semantics. **References only — never media bytes.**

```jsonc
{
  "version": "1.0",
  "profile": { "width": 1080, "height": 1920, "fps": 30, "colorspace": "rec709" },
  "assets": [
    {
      "id": "a1",
      "originalUrl": "/footage/talk.mov",   // export relinks here
      "proxyUrl": "/cache/proxies/a1.mp4",  // preview uses this
      "duration": 1830.0,
      "analysisRef": "a1.analysis.json"      // cached analysis (§7)
    }
  ],
  "tracks": [
    {
      "id": "V1", "type": "video",
      "clips": [
        {
          "id": "c1", "assetId": "a1",
          "in": 12.4, "out": 38.9,           // source in/out (non-destructive)
          "timelineStart": 0.0,
          "origin": "vibe",                   // vibe | manual | locked
          "effects": [
            { "type": "transform", "keyframes": {
                "scale":   [{ "t": 5.0, "v": 1.0, "interp": "bezier" },
                            { "t": 5.3, "v": 1.25 }, { "t": 6.0, "v": 1.0 }],
                "posX": [...], "posY": [...] } },
            { "type": "lut3d", "params": { "lut": "warm_01.cube", "amount": 0.6 } }
          ]
        }
      ]
    },
    { "id": "A1", "type": "audio", "clips": [ /* ... */ ],
      "filters": [ { "type": "loudnorm", "params": { "i": -16, "tp": -1.5 } } ] }
  ],
  "captions": {
    "trackId": "CAP1",
    "style": "bold-karaoke",
    "events": [ { "start": 0.10, "end": 0.62, "words": [ {"w":"Hey","t":0.10,"d":0.18}, ... ] } ]
  },
  "transitions": [ { "type": "dissolve", "trackA": "V1", "trackB": "V2", "at": 38.9, "duration": 0.5 } ]
}
```

**Properties:**
- **Non-destructive:** every clip is `{asset, in, out, timelineStart}` + effect stack. Source media untouched.
- **Keyframed parameters** stored as `{t, v, interp}` arrays (interp ∈ linear/constant/bezier), exactly like MLT/libopenshot.
- **`origin` flag** powers the re-vibe conflict rule (§3).
- **Optional one-way exporter to MLT XML** so you could render headlessly with `melt` if ever needed.
- **Undo/redo:** command pattern — every mutation is a reversible command on a stack.

---

## 7. The Analysis Layer (run once per asset, then cached)

This is the performance secret that makes **re-vibe instant**. When an asset is imported, we run all expensive analysis **once** and cache it to `*.analysis.json`. Re-vibing only re-runs the cheap deterministic edit functions, never the heavy models.

| Analysis | Tool | Output cached |
|---|---|---|
| **Transcript + word timestamps** | WhisperX / whisper.cpp / Parakeet | words `[{w, start, dur, speaker?}]` |
| **Silence / voice activity** | Silero VAD | speech/silence ranges |
| **Scene/shot boundaries** | PySceneDetect (AdaptiveDetector) | shot cut times |
| **Subject tracks** | MediaPipe face/pose (YOLO opt.) | per-frame subject bbox/center |
| **Emphasis score** | RMS + pitch + transcript keywords | per-word emphasis 0–1 |
| **Media embeddings** | OpenCLIP (frames @ shot boundaries) | vectors → FAISS index |
| *(optional)* **Speaker diarization** | pyannote 3.1 / WhisperX | speaker labels |

Caching is incremental and content-hashed (re-import of the same file reuses cache).

---

## 8. The Vibe pipeline (text → edit plan → timeline)

**The golden rule: the LLM maps intent → typed parameters. Deterministic algorithms do the actual editing.** A local 7–8B model is plenty for this because it never edits — it only fills in a constrained schema.

```
User text + effect toggles
        │
        ▼
┌─────────────────────────────────────────────┐
│ LOCAL LLM (Qwen2.5-7B / Llama3.1-8B, Ollama) │
│  System prompt + closed op enum + JSON schema│
│  GBNF / Ollama `format` CONSTRAINED DECODING  │ ← output literally cannot
│  → EDIT PLAN (typed op list)                  │   violate the schema
└───────────────────┬──────────────────────────┘
                    │ (params only)
                    ▼  + Pydantic/serde semantic validation + range clamps
┌─────────────────────────────────────────────┐
│ EDIT ENGINE — pure deterministic functions    │
│  each op = f(params, cached_analysis) → ops    │
│   cut_silence(p, vad)         remove_fillers(p, words)
│   auto_reframe(p, tracks)     punch_in(p, emphasis)
│   target_duration(p)          add_captions(p, words)
│   enhance_speech(p)           normalize_loudness(p)
│   suggest_broll(p, faiss)     color_look(p)
└───────────────────┬──────────────────────────┘
                    ▼
        Mutations applied to the JSON Edit Model
                    ▼
            Preview re-renders (cached, fast)
```

**Why constrained decoding (not "ask nicely for JSON"):** llama.cpp **GBNF grammars** (or Ollama's `format` JSON-schema parameter) constrain *every sampled token* so the model **cannot** emit an unknown operation, a misspelled field, or an out-of-range value. This turns "LLMs are flaky with JSON" into a non-issue. Pydantic/serde validation + parameter clamping is the second safety net for semantic (not just structural) correctness.

**Infeasible requests are resolved by the engine, deterministically — not the LLM.** Example: "make it 60s" on a 90s clip → the engine applies a priority ladder (cut silences → cut fillers → trim low-emphasis segments → as a last resort, speed-ramp) until the target is met, and reports what it did.

**Example mapping** — user types *"make it punchy and under 60s with bold captions"*:
```jsonc
{ "global": { "target_duration_s": 58, "aspect": "9:16" },
  "edit_plan": [
    { "op": "cut_silence",       "params": { "threshold_db": -30, "min_duration_s": 0.4, "padding_s": 0.1 } },
    { "op": "remove_fillers",    "params": { "lexicon": ["um","uh","er","you know"] } },
    { "op": "punch_in",          "params": { "frequency": "high", "max_scale": 1.3, "triggers": ["emphasis","keywords"] } },
    { "op": "add_captions",      "params": { "style": "bold-karaoke", "position": "lower-mid", "max_words_per_line": 4 } },
    { "op": "normalize_loudness","params": { "i": -16 } },
    { "op": "target_duration",   "params": { "max_seconds": 58, "strategy": "ladder" } }
  ] }
```

---

## 9. Edit Operations catalog (the closed set the LLM may use)

Each op is a pure function `f(params, analysis) → timeline mutations`. The enum + param ranges are encoded in the grammar so the model can't go off-script.

| Op | Params | Deterministic logic | Uses analysis |
|---|---|---|---|
| `cut_silence` | threshold_db, min_duration_s, padding_s | Mark sub-threshold ranges > min as cuts; keep padding around speech; ripple-delete | VAD / silence map |
| `remove_fillers` | lexicon[] | Match filler tokens, delete `[start,dur]` with micro-crossfade | word timestamps |
| `auto_reframe` | target_aspect, mode(pan/static), smoothness | Subject center → smoothed trajectory → crop+scale keyframes, snapped to shots | subject tracks, shots |
| `punch_in` | frequency, max_scale, triggers[] | Score moments → peak-pick → zoom keyframe pairs on word onsets; rate-limited | emphasis, shots |
| `add_captions` | style, position, max_words_per_line, highlight_color | Build caption events from words; group into lines; assign style | word timestamps |
| `target_duration` | max_seconds, strategy | Priority ladder of cuts until target met | all |
| `normalize_loudness` | i, tp, lra | Insert two-pass `loudnorm` audio filter | — |
| `enhance_speech` | strength | Insert DeepFilterNet3 denoise pass | — |
| `suggest_broll` | query \| auto, density | CLIP/keyword → FAISS top-k from user's library → place on B-track | embeddings, transcript |
| `color_look` | look, amount | Apply 3D-LUT effect | — |
| `trim_to_content` | head, tail | Trim leading/trailing silence | VAD |
| `reorder_by_topic` *(v2)* | — | Cluster by transcript semantics, reorder segments | transcript |

Effect **toggles in the UI** (the "options of adding what effects you want") simply pre-seed or constrain this plan (e.g. user unchecks "zooms" → `punch_in` removed from the allowed set for this run).

---

## 10. The Manual Editor (Premiere-grade feature set)

Once auto-edited, the user can refine everything by hand. Target parity with the core Premiere workflow:

- **Multitrack timeline:** unlimited V/A tracks, stacking = compositing order; drag/trim/ripple/roll/slip/slide; razor; insert/overwrite; three/four-point editing; snapping; markers; nesting; multicam (v2).
- **Source vs Program monitors:** set in/out on a clip vs preview the sequence (rendered on the native wgpu surface).
- **Effects pipeline:** GPU WGSL shaders (blur, glow, distortion, transitions), masking + tracking, transform (position/scale/rotation/anchor), opacity, speed/time-remap, stabilization (v2).
- **Color:** Lumetri-style panel — basic correction, curves, color wheels, HSL, LUTs, scopes (waveform/vectorscope/histogram/parade), all via OpenColorIO + GPU.
- **Audio:** per-track mixer, levels/pan, EQ/compression, auto-ducking, Essential-Sound-style role tagging (dialogue/music/sfx/ambience), loudness metering, DeepFilterNet enhance.
- **Captions:** full style editor — font, size, color, stroke, shadow, background, position, word-by-word/karaoke highlight, animation; saveable presets/templates.
- **Keyframing:** any parameter animatable with linear/constant/Bézier; keyframe lanes in the inspector.
- **Graphics/Titles:** text + shape layers, lower-thirds, template system (MOGRT-like, your own format).

Everything the manual editor does is just more entries/edits in the same JSON Edit Model — so re-vibe can read and respect them.

---

## 11. Render engine & real-time preview

**Preview (must feel like Premiere scrubbing):**
- **Native wgpu surface** (not an HTML `<video>` — that's a Tauri/WKWebView trap: no H.265, large-file failures on macOS). The compositor reads the Edit Model and composites frames in **linear-light float** (Movit/Olive technique) on the GPU.
- **Hardware decode** (FFmpeg `hwaccel`) directly into GPU textures → GPU composite → present (zero-copy).
- **Proxy media:** auto-transcode 4K/long-GOP sources to low-res all-intra proxies for editing; **relink to originals at export**. Highest-leverage performance feature — build early.
- **Two-level cache:** (a) decoded source frames, (b) composited timeline frames keyed by (timeline-hash, frame); invalidate on edit.
- **Background pre-render** of heavy sections during idle (Premiere's render-bar analog).

**Export:**
- FFmpeg **libav\*** in a dedicated Rust worker (or `ffmpeg-sidecar` for v1 simplicity), **LGPL build**.
- **Hardware encoders only (FINALIZED):** VideoToolbox (Mac), NVENC (NVIDIA), QSV (Intel), AMF (AMD) for H.264/HEVC, plus hardware AV1 where available. **No bundled software x264/x265** — this deliberately sidesteps the GPL/commercial-codec-license problem entirely and is why we can assume a capable GPU (§14). (If a future client demands software-encode quality, it can be added under a commercial codec license then.)
- **Render queue** with progress (parsed from FFmpeg) and cancel; export relinks to original media, not proxies.
- Caption burn-in via the **same libass path** used in preview (no preview-vs-export drift).

---

## 12. Captions system

- **Engine:** libass (ASS format) for both preview and burn-in — ASS natively supports karaoke/word-highlight (`\k`, `\kf` sweep). Same renderer in preview and export = pixel-identical.
- **Authoring:** caption events generated from Whisper **word timestamps** (so highlight syncs to speech); grouped into lines by `max_words_per_line`.
- **Styling:** presets (bold-karaoke, minimal, lower-third, "hype") + full manual control (font/color/stroke/shadow/bg/position/animation). User can save custom templates.
- **Translate (v2):** local NMT model (e.g. NLLB/Marian, on-device) to add translated caption tracks — still no API.
- **Export:** burn-in **or** sidecar **SRT/VTT/ASS**.
- **Upgrade path:** move signature animated styles to your own Skia/wgpu text renderer when you outgrow ASS.

---

## 13. Audio system

- **Enhance Speech:** DeepFilterNet3 (full-band denoise/dereverb) as default; Resemble-Enhance opt-in "studio" pass (generative — preview before commit).
- **Loudness:** two-pass FFmpeg `loudnorm` to −16 LUFS / −1.5 dBTP (web/voice standard).
- **Mixing:** per-track levels/pan, role tagging, auto-ducking music under dialogue.
- **Sync:** all cuts/filler-removal use word boundaries + micro-crossfades to avoid clicks.

---

## 14. Local AI models & hardware requirements

| Component | Model | Footprint | Notes |
|---|---|---|---|
| Transcription | Whisper large-v3-turbo (or small for low-end) | ~0.8–1.6 GB | 99 languages; word timestamps |
| Vibe LLM | Qwen 2.5 7B / Llama 3.1 8B, Q4_K_M | ~5–6 GB | Runs on 8 GB VRAM or 16 GB unified RAM |
| VAD | Silero | tiny | — |
| Tracking | MediaPipe face/pose | small | CPU-friendly |
| Denoise | DeepFilterNet3 | small | real-time-capable |
| B-roll search | OpenCLIP ViT-B/32 or L/14 + FAISS | ~0.3–1.5 GB | indexes user library |

**Target machine (FINALIZED — "assume capable"):** we design for **Apple Silicon (M-series, 16 GB+ unified)** or **Windows with a discrete GPU (8 GB+ VRAM) + 16 GB+ RAM** (32 GB for comfortable 4K + LLM). This is what justifies hardware-only encode (§11) and full-size Whisper + a 7–8B local LLM for the **best vibe quality**. A CPU-only / no-GPU "lite mode" (tiny Whisper + small or rules-based vibe) is **deprioritized** — a possible later addition for reach, not a v1 constraint.

**Model distribution:** bundle a default model set in the installer or first-run download; manage via Ollama (LLM) and bundled sidecar binaries (Whisper/VAD/etc.). Everything stays on disk; **nothing phones home.**

---

## 15. Licensing & commercial compliance (critical — this is a paid product)

The single most important non-obvious finding: **build your own compositor and own your project format so you never link GPL pixel code.**

| Component | License | Verdict for a closed commercial app |
|---|---|---|
| Tauri, wgpu, Skia, React, Konva, OpenColorIO, FAISS, OpenCLIP, Silero, PySceneDetect, Whisper(.cpp), Qwen/Llama (weights — check each) | Permissive (MIT/Apache/BSD/CC-BY) | ✅ Safe (verify each weight's license) |
| **MLT framework core** | **LGPL-2.1** | ✅ OK if **dynamically linked** & replaceable |
| **FFmpeg (LGPL build)** | LGPL-2.1+ | ✅ Dynamically linked; **avoid x264/x265 (GPL)** — use hardware encoders or license x264/x265 commercially |
| **libmpv** | LGPL-2.1+ | ✅ Dynamic link |
| **libass** | permissive (ISC-style) | ✅ likely — **verify LICENSE + transitive deps** |
| **frei0r** | **GPL** | ❌ Do **not** bundle — implement your own effects |
| **MLT `melt`/`melted` CLI** | **GPL-2** | ❌ Don't bundle/link in closed code |
| **Movit** | GPL (verify) | ❌ Reimplement the *technique*, don't link |
| **Shotcut / Kdenlive / Olive (apps)** | GPLv2/v3 | ❌ Study concepts; **never copy code** |
| **Remotion** | Free OSS **but paid company license** above team-size threshold | ⚠️ Avoid for the core, or buy the license |
| **pyannote** diarization weights | open code, **gated HF model** | ⚠️ Needs free token to fetch; check redistribution terms |

**Net commercial-safe stack:** Tauri + own wgpu compositor + LGPL FFmpeg (**hardware encoders only**, §11) + OpenColorIO + libass (verified) + own JSON model + permissive AI models. Avoid frei0r, melt, Movit-linking, GPL FFmpeg builds, and copying any GPL app's code.

**Business/license model (FINALIZED — "decide later, stay clean"):** the final open-vs-closed decision is **deferred**, so we **keep the architecture license-clean / closed-capable** from day one (the stack above). This preserves *both* doors: we can later ship closed-source commercial **or** flip to an open-core/GPL model — but we never paint ourselves into a GPL-only corner by accident. Practically: treat every dependency as if the product were closed-source until told otherwise.

---

## 16. Performance strategy (summary)

1. **Proxy media** for editing; relink originals at export.
2. **Cache analysis once** per asset → re-vibe is cheap.
3. **Two-level frame cache** (decoded + composited).
4. **GPU everything** in the hot path (decode → composite → present, zero-copy).
5. **Background pre-render** during idle.
6. **Virtualized timeline** (render only visible range × tracks; pre-computed waveform peaks + thumbnail sprite sheets).
7. **Native preview surface** (never the WebView).

---

## 17. Privacy & security

- **Local by default:** footage, transcripts, prompts, and analysis never leave the device. Strong selling point for businesses handling client/student footage.
- **Optional cloud toggle** (off by default) behind a provider interface; if enabled, clearly disclose what's sent.
- **Content Credentials (C2PA)** optional on export for provenance — but note we do **no** generative video, so this is informational, not a deepfake concern.

---

## 18. Phased build roadmap

**Phase 0 — Spike (2–4 wks):** Tauri shell + native wgpu surface rendering one decoded clip; FFmpeg decode→texture; prove the preview path. De-risks the #1 technical unknown.

**Phase 1 — MVP "Vibe → watch → export" (6–10 wks):**
- Import → analysis layer (Whisper + Silero + scene detect) with caching.
- Vibe bar → Ollama + constrained JSON → edit plan → 4 core ops: `cut_silence`, `remove_fillers`, `add_captions`, `normalize_loudness`.
- Single-track-ish timeline view (read-only-ish), caption styling presets, export via FFmpeg sidecar.
- *Deliverable: upload a 5-min clip, type a prompt, get a captioned, de-ummed, cut export.* (This already beats the original goal.)

**Phase 2 — Manual editor (8–12 wks):** Full multitrack timeline (react-konva), trim/cut/ripple, transform + keyframes, effect stack (GPU shaders), proxy pipeline, frame cache, undo/redo, the `origin`-flag conflict system for re-vibe.

**Phase 3 — Pro polish (ongoing):** `auto_reframe` + `punch_in` + `suggest_broll`, color panel + scopes + LUTs, audio mixer + DeepFilterNet, hardware encode, render queue, caption template editor, multicam, translation.

**Phase 4 — Optional:** cloud-API toggle, mobile companion, collaboration.

---

## 19. Risks & open decisions

**Risks:**
- **wgpu compositor is the hardest part** — mitigate with Phase 0 spike; fallback = embed MLT (LGPL) for v1.
- **Cross-platform WebView quirks** (macOS WKWebView) — mitigated by keeping all pixels on the native surface.
- **Local LLM quality variance** — mitigated by constrained decoding + the deterministic engine doing real work; rules-based fallback for low-end machines.
- **libass/Movit/weight licenses** — must be individually verified before shipping.
- **Hardware-encode quality** vs GPL x264 — decide per §15.

**Resolved decisions (locked in):**
1. **Re-vibe conflict:** ✅ **Lock-to-protect** — re-vibe may re-edit everything except explicitly **locked** clips, with a "lock all manual edits" button + change-preview + undo as safeguards (§3).
2. **Encoding:** ✅ **Hardware encoders only** — no bundled software x264/x265; sidesteps GPL/codec licensing (§11).
3. **Distribution license:** ✅ **Decide later** — keep the architecture **license-clean / closed-capable** so both closed-source and open-core remain possible (§15).
4. **Min-spec:** ✅ **Assume a capable machine** (Apple Silicon 16 GB+ / discrete GPU 8 GB+) → full-size models for best vibe quality; lite mode deprioritized (§14).

---

## 20. One-line summary

**VibeCut = a Tauri/Rust desktop app where a local LLM translates your plain-English instructions into a typed edit plan, deterministic algorithms (running on cached Whisper/VAD/scene/tracking analysis) execute that plan as non-destructive edits in a shared JSON timeline, a GPU wgpu compositor previews it in real time, you refine it by hand with Premiere-grade tools or just re-vibe, and FFmpeg exports it — all on-device, no APIs, no generative video, commercially licensable.**

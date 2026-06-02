# VibeCut Core (reference engine)

The platform-independent **"brain"** of VibeCut — a runnable, dependency-free
reference implementation of the pipeline in the
[Master Design Spec](../vibecut-design/VibeCut-Master-Design-Spec.md):

```
 vibe text ──▶ constrained EDIT PLAN ──▶ deterministic ENGINE
           ──▶ non-destructive EDIT MODEL ──▶ FFmpeg command + .ass captions
```

It proves the central thesis end-to-end: **a local model only maps intent →
typed parameters; deterministic algorithms do the actual editing.** No GPU, no
network, no AI model, and no FFmpeg binary are required to run or test it —
which is exactly why it's a clean target to port into the Rust core later.

> Status: Phase-1 logic prototype (Spec §18). Stdlib-only, Python 3.10+.

## Run it

```bash
cd vibecut-core
python3 -m vibecut.cli "make it punchy and under 60 seconds with bold captions for tiktok"
```

You'll get the parsed edit plan, a before/after report (92 s → ~60 s, silences
& fillers cut, captions/zooms/reframe applied), the generated FFmpeg command,
and a `captions.ass` karaoke file.

Useful flags: `--no-zooms`, `--no-captions`, `--encoder {mac,nvidia,intel,amd}`,
`--analysis path.json`, `--json`. Use `--llm` to route intent through a local
Ollama model instead of the offline rules parser — see
[docs/OLLAMA-SETUP.md](docs/OLLAMA-SETUP.md) for the one-time setup.

### Re-vibe with lock-to-protect (Spec §3)

The product's signature move — "vibe again, edit it differently" — while
preserving anything you've locked:

```bash
# 1) first vibe, lock video clip #2 (a hand-kept moment), save the project
python3 -m vibecut.cli "clean it up with captions" --lock-clip 2 --save-project proj.json

# 2) re-vibe aggressively — the locked clip survives untouched, the rest is re-edited
python3 -m vibecut.cli "cut it to 15s, punchy, vertical for tiktok" --revibe proj.json
```

Locked clips are never cut, never zoomed, and keep their effects/origin; the
report shows `protect_locked`. Everything else is regenerated from the new prompt.

### Edit a real file (analysis ingest)

Turn an actual audio track + transcript into the `analysis.json` the editor
consumes — no ML libraries required (stdlib `wave` + JSON/SRT parsing):

```bash
# from a Whisper/WhisperX word-level JSON (or an .srt) + the audio .wav
python3 -m vibecut.ingest --wav clip.wav --transcript clip.json \
        --source-url clip.mov --out analysis.json

python3 -m vibecut.cli "tighten the dead air, drop fillers, bold captions" \
        --analysis analysis.json
```

`ingest` derives speech/silence segments and per-word emphasis from the WAV's
RMS, and word timestamps from the transcript. In the shipping app this is
produced by faster-whisper / Silero VAD / PySceneDetect behind the same schema.

## Test it

```bash
python3 -m unittest discover -s tests -v   # 31 tests, ~0.02s
```

Every run also prints an **ASCII timeline** of the original footage so you can
see what was kept vs cut at a glance:

```
  source 0s   [············#·····######······############·····########·] 92s
  legend: # kept  · cut  @ locked
  kept 35.2s of 92.0s (38%)  ·  clips 6  ·  captions 6  ·  zooms 6  ·  1080x1920
```

## Layout

| File | Role (Spec §) |
|------|----------------|
| `vibecut/ranges.py`   | Time-range math + the non-destructive `KeepList` (§6) |
| `vibecut/analysis.py` | Cached analysis schema: words/VAD/scenes/emphasis (§7) |
| `vibecut/editplan.py` | Edit-plan schema, JSON Schema for Ollama `format=`, validation/clamping (§8) |
| `vibecut/vibe.py`     | Intent → plan: offline `RulesProvider` + optional `OllamaProvider` (§8) |
| `vibecut/engine.py`   | Deterministic ops: cut_silence, remove_fillers, target_duration, captions, punch_in, reframe, audio (§9) |
| `vibecut/editmodel.py`| The JSON EDL the engine writes and the renderer reads (§6) |
| `vibecut/render.py`   | EditModel → FFmpeg command (hardware encoders only) + karaoke `.ass` (§11/§12) |
| `vibecut/cli.py`      | End-to-end entry point |
| `samples/`            | A synthetic 92 s talking-head analysis + example caption output |

## How it maps to the full product

This is only the **edit logic**. In the shipping desktop app (Spec §4–5):

- The **analysis layer** (Whisper / Silero VAD / PySceneDetect / MediaPipe)
  produces the `analysis.json` this engine consumes — computed **once per
  asset and cached**, which is why re-vibe is instant.
- The **Rust/Tauri core + wgpu compositor** renders the same `EditModel` to a
  live GPU preview; FFmpeg handles export. Time-varying effects (punch-in zoom,
  auto-reframe) are applied by the compositor — this reference carries them in
  the model and annotates the FFmpeg command accordingly.
- The **manual editor** writes into the very same `EditModel`; `re-vibe`
  regenerates the vibe-owned ops while skipping `locked` clips.

## Design decisions baked in

- **No external APIs required** — rules parser runs offline; Ollama is opt-in.
- **No generative video** — `suggest_broll` (roadmap) retrieves the user's own
  media via CLIP+FAISS; nothing is synthesized.
- **Hardware encoders only** — no software x264/x265, avoiding GPL/codec
  licensing (keeps the product license-clean / closed-capable).
- **Untrusted-plan safety** — constrained decoding guarantees structure;
  `validate()` drops unknown ops and clamps every parameter.

## Known refinements (next iterations)

- **Scene-aware phrase trimming.** `target_duration` now trims whole
  lowest-emphasis *phrases* at pause boundaries (contiguous, not choppy). Next:
  also respect shot/scene boundaries so cuts never land mid-action.
- **Per-clip captions on lock.** Captions regenerate globally on re-vibe; a
  locked clip could optionally retain its own caption styling.
- **Real analysis layer.** Swap the sample JSON for live Whisper + Silero VAD
  + PySceneDetect output (the next sidecar to build).

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
Ollama model instead of the offline rules parser.

## Test it

```bash
python3 -m unittest discover -s tests -v   # 22 tests, ~0.01s
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

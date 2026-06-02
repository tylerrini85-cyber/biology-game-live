# Running the real local "vibe brain" (Ollama)

VibeCut works **offline with no model** thanks to the built-in rules parser.
To get the smarter, free-form "vibe" understanding, point it at a **local LLM**
via [Ollama](https://ollama.com). Everything stays on your machine — no API,
no account, no per-clip cost, and your footage/prompts never leave the device.

This is exactly the local-first path in the design spec (§2, §8): the model
only maps your sentence to a typed **edit plan**; the deterministic engine does
the actual editing.

---

## 1. Install Ollama

- **macOS / Windows:** download the installer from <https://ollama.com/download>.
- **Linux:** `curl -fsSL https://ollama.com/install.sh | sh`

Ollama runs a local server at `http://localhost:11434` (what VibeCut talks to).

## 2. Pull a model

```bash
ollama pull qwen2.5:7b      # recommended default
# alternatives:
ollama pull llama3.1:8b     # strong, built-in tool/JSON calling
ollama pull qwen2.5:3b      # lighter, for ~8 GB machines
```

| Model | Disk (Q4) | RAM/VRAM to run well | Notes |
|-------|-----------|----------------------|-------|
| `qwen2.5:7b`  | ~4.7 GB | 8 GB VRAM / 16 GB unified | best balance, recommended |
| `llama3.1:8b` | ~4.9 GB | 8 GB VRAM / 16 GB unified | great alternative |
| `qwen2.5:3b`  | ~2.0 GB | ~8 GB RAM | low-end fallback |

Runs on Apple Silicon (Metal) or any NVIDIA/AMD/Intel GPU; CPU-only works but
is slower. Intent parsing is a tiny generation (a few hundred tokens), so even
modest hardware responds in 1–3 seconds.

## 3. Verify it's working

```bash
ollama run qwen2.5:7b "say hi in 3 words"
```

Then confirm **structured output** (the feature VibeCut relies on) works — the
`format` field forces the model to emit JSON matching our schema:

```bash
curl http://localhost:11434/api/generate -d '{
  "model": "qwen2.5:7b",
  "prompt": "punchy, under 60s, bold captions for tiktok",
  "stream": false,
  "format": {
    "type": "object",
    "properties": {
      "aspect": {"type": "string", "enum": ["16:9","9:16","1:1","4:5"]},
      "ops": {"type": "array", "items": {"type":"object",
        "properties": {"op": {"type":"string"}}, "required":["op"]}}
    },
    "required": ["ops"]
  }
}'
```

You should get back a JSON `response` string that parses into `{aspect, ops:[...]}`.

## 4. Use it in VibeCut

```bash
# offline rules parser (default, no model needed)
python3 -m vibecut.cli "make it punchy under 60s with bold captions"

# real local LLM:
python3 -m vibecut.cli "make it punchy under 60s with bold captions" --llm
python3 -m vibecut.cli "..."  --llm --model llama3.1:8b   # pick a model
```

Under the hood VibeCut sends Ollama:
- your prompt,
- a system prompt listing the allowed operations + one example,
- `format` = VibeCut's full JSON Schema (so output is **structurally guaranteed**),
- `temperature` 0.2 (consistent, low-creativity parsing).

The reply is then run through `validate()`, which drops any unknown op and
clamps every parameter — so even a misbehaving model can't break the engine.

## 5. Troubleshooting

| Symptom | Fix |
|---|---|
| `connection refused` | Ollama isn't running. Launch the app, or `ollama serve`. |
| `model 'qwen2.5:7b' not found` | `ollama pull qwen2.5:7b` first. |
| Very slow / out of memory | Use a smaller model (`qwen2.5:3b`) or close other apps. |
| Odd/empty plan | The rules parser is always a safe fallback (drop `--llm`). |

## 6. Swapping in a cloud API later (optional, off by default)

The vibe layer is behind a provider interface (`vibecut/vibe.py`). Adding a
cloud provider is just another class with a `plan(text, toggles) -> EditPlan`
method using the same JSON Schema for structured output. It would be strictly
opt-in; the default stays 100% local.

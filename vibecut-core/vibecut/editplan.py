"""The Edit Plan — the typed, validated bridge between the LLM and the engine.

The local LLM emits ONLY this structure (Spec §8). Two safety nets:
  1. Structural: constrained decoding (llama.cpp GBNF / Ollama `format`) makes
     the model physically unable to emit an unknown op or malformed JSON. The
     `EDIT_PLAN_JSON_SCHEMA` below is exactly what you hand to Ollama `format=`.
  2. Semantic: `validate()` drops unknown ops and clamps every param to a sane
     range, so even a bad/jailbroken plan can't push the engine out of bounds.

The LLM never edits — it only fills in these parameters.
"""
from __future__ import annotations

from dataclasses import dataclass, field

ASPECTS = ["16:9", "9:16", "1:1", "4:5"]
FREQ = ["low", "medium", "high"]

# Allowed operations and their parameter spec: name -> {param: (default, lo, hi)}
# (string/enum params handled separately in _clamp).
OP_SPEC: dict[str, dict] = {
    "cut_silence":       {"threshold_db": (-30.0, -60.0, -10.0),
                          "min_duration_s": (0.5, 0.1, 5.0),
                          "padding_s": (0.12, 0.0, 0.5)},
    "remove_fillers":    {"lexicon": (["um", "uh", "er", "ah", "like", "you know"], None, None)},
    "target_duration":   {"max_seconds": (60.0, 1.0, 7200.0)},
    "punch_in":          {"frequency": ("medium", None, None),
                          "max_scale": (1.25, 1.05, 2.0),
                          "min_gap_s": (2.0, 0.5, 30.0)},
    "auto_reframe":      {"target_aspect": ("9:16", None, None),
                          "smoothness": (0.7, 0.0, 1.0)},
    "add_captions":      {"style": ("minimal", None, None),
                          "position": ("lower-mid", None, None),
                          "max_words_per_line": (4, 1, 12),
                          "highlight_color": ("#FFE000", None, None)},
    "normalize_loudness": {"i": (-16.0, -31.0, -9.0),
                           "tp": (-1.5, -9.0, 0.0),
                           "lra": (11.0, 1.0, 20.0)},
    "enhance_speech":    {"strength": (0.8, 0.0, 1.0)},
}

CAPTION_STYLES = ["minimal", "bold-karaoke", "lower-third", "hype"]


@dataclass
class Op:
    op: str
    params: dict = field(default_factory=dict)


@dataclass
class EditPlan:
    target_duration_s: float | None = None
    aspect: str = "16:9"
    ops: list[Op] = field(default_factory=list)

    def has(self, op: str) -> bool:
        return any(o.op == op for o in self.ops)


def _clamp(op: str, params: dict) -> dict:
    spec = OP_SPEC[op]
    out: dict = {}
    for name, (default, lo, hi) in spec.items():
        val = params.get(name, default)
        if isinstance(default, (int, float)) and not isinstance(default, bool):
            try:
                val = type(default)(val)
            except (TypeError, ValueError):
                val = default
            if lo is not None:
                val = max(lo, min(hi, val))
        out[name] = val
    # enum guards
    if op == "punch_in" and out["frequency"] not in FREQ:
        out["frequency"] = "medium"
    if op == "auto_reframe" and out["target_aspect"] not in ASPECTS:
        out["target_aspect"] = "9:16"
    if op == "add_captions" and out["style"] not in CAPTION_STYLES:
        out["style"] = "minimal"
    return out


def validate(raw: dict) -> EditPlan:
    """Normalize an untrusted plan dict into a safe EditPlan."""
    aspect = raw.get("aspect", "16:9")
    if aspect not in ASPECTS:
        aspect = "16:9"
    target = raw.get("target_duration_s")
    if target is not None:
        try:
            target = max(1.0, float(target))
        except (TypeError, ValueError):
            target = None
    ops: list[Op] = []
    seen: set[str] = set()
    for entry in raw.get("ops", []):
        name = entry.get("op")
        if name not in OP_SPEC or name in seen:  # drop unknown / duplicate
            continue
        seen.add(name)
        ops.append(Op(name, _clamp(name, entry.get("params", {}))))
    return EditPlan(target_duration_s=target, aspect=aspect, ops=ops)


def to_plain(plan: EditPlan) -> dict:
    return {
        "target_duration_s": plan.target_duration_s,
        "aspect": plan.aspect,
        "ops": [{"op": o.op, "params": o.params} for o in plan.ops],
    }


# JSON Schema handed to Ollama `format=` / converted to a GBNF grammar.
EDIT_PLAN_JSON_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "target_duration_s": {"type": ["number", "null"]},
        "aspect": {"type": "string", "enum": ASPECTS},
        "ops": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "op": {"type": "string", "enum": list(OP_SPEC.keys())},
                    "params": {"type": "object"},
                },
                "required": ["op"],
            },
        },
    },
    "required": ["ops"],
}

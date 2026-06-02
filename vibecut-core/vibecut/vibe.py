"""The vibe layer — natural language -> EditPlan (Spec §8).

Two providers behind one interface:

  * RulesProvider  (default): a deterministic keyword/intent parser. Needs no
    model and no network, so the whole pipeline runs and is testable offline.
    It is also the genuine low-end / fallback path from the spec (§14).

  * OllamaProvider (optional): the real "vibe brain". Calls a LOCAL Ollama
    server with the JSON schema as `format=` so output is grammar-constrained.
    Used only when explicitly enabled and reachable; never a dependency.

The provider seam is exactly where a cloud API could later slot in (off by
default), without touching the engine.
"""
from __future__ import annotations

import json
import re

from .editplan import EDIT_PLAN_JSON_SCHEMA, EditPlan, validate

# default ops every auto-edit applies unless toggled off
_DEFAULT_OPS = ["cut_silence", "remove_fillers", "add_captions", "normalize_loudness"]


def _find_duration(text: str) -> float | None:
    m = re.search(r"(?:under|below|max|to)?\s*(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds|m|min|mins|minutes)\b", text)
    if not m:
        return None
    val = float(m.group(1))
    if m.group(2).startswith("m"):
        val *= 60
    return val


class RulesProvider:
    """Deterministic intent parser. Maps phrases to ops + params."""

    name = "rules"

    def plan(self, text: str, toggles: dict | None = None) -> EditPlan:
        t = text.lower()
        toggles = toggles or {}
        ops: dict[str, dict] = {}

        def add(op: str, **params: object) -> None:
            ops.setdefault(op, {}).update(params)

        # sensible auto-edit defaults
        for op in _DEFAULT_OPS:
            ops.setdefault(op, {})

        # ---- captions style/intent
        if any(k in t for k in ("caption", "subtitle", "text on screen")):
            ops.setdefault("add_captions", {})
        if "bold" in t or "karaoke" in t or "word by word" in t or "word-by-word" in t:
            add("add_captions", style="bold-karaoke")
        elif "hype" in t or "punchy" in t:
            add("add_captions", style="hype")

        # ---- pacing / energy
        if any(k in t for k in ("punchy", "punch", "zoom", "energetic", "dynamic")):
            add("punch_in", frequency="high", max_scale=1.3)
        if any(k in t for k in ("calm", "subtle", "relaxed", "gentle", "minimal")):
            add("punch_in", frequency="low", max_scale=1.12)

        # ---- silence / fillers (already defaulted; allow emphasis)
        if "dead air" in t or "silence" in t or "pauses" in t or "tighten" in t:
            add("cut_silence", min_duration_s=0.35)
        if "aggressive" in t or "fast paced" in t or "fast-paced" in t:
            add("cut_silence", min_duration_s=0.25)

        # ---- format / aspect
        if any(k in t for k in ("vertical", "9:16", "reels", "tiktok", "shorts", "story")):
            add("auto_reframe", target_aspect="9:16")
            aspect = "9:16"
        elif "square" in t or "1:1" in t:
            add("auto_reframe", target_aspect="1:1")
            aspect = "1:1"
        elif "4:5" in t or "portrait" in t:
            add("auto_reframe", target_aspect="4:5")
            aspect = "4:5"
        else:
            aspect = "16:9"

        # ---- audio
        if any(k in t for k in ("enhance", "clean audio", "denoise", "noise", "clarity")):
            ops.setdefault("enhance_speech", {})
        if "loud" in t or "normalize" in t:
            ops.setdefault("normalize_loudness", {})

        # ---- duration
        dur = _find_duration(t)
        if dur is not None:
            ops.setdefault("target_duration", {})["max_seconds"] = dur

        # ---- explicit toggles from the UI checkboxes (override text)
        if toggles.get("zooms") is False:
            ops.pop("punch_in", None)
        if toggles.get("captions") is False:
            ops.pop("add_captions", None)
        if toggles.get("reframe") is False:
            ops.pop("auto_reframe", None)
            aspect = "16:9"
        if toggles.get("enhance") is True:
            ops.setdefault("enhance_speech", {})

        raw = {
            "aspect": aspect,
            "target_duration_s": dur,
            "ops": [{"op": k, "params": v} for k, v in ops.items()],
        }
        return validate(raw)


class OllamaProvider:
    """Local LLM provider using Ollama's constrained-JSON output.

    The `format` parameter is set to our JSON Schema, so Ollama constrains
    decoding and the model *cannot* emit anything outside the schema. A
    `transport` can be injected for testing (default uses stdlib urllib).
    """

    name = "ollama"

    SYSTEM = (
        "You translate a video editor's request into an edit plan as JSON. "
        "Use ONLY these operations; never invent new ones: cut_silence, "
        "remove_fillers, target_duration, punch_in, auto_reframe, add_captions, "
        "normalize_loudness, enhance_speech. Pick parameters that match the "
        "requested vibe (punchy -> frequent strong zooms; calm -> few subtle ones). "
        'Example: input "punchy, under 60s, bold captions for tiktok" -> '
        '{"target_duration_s":60,"aspect":"9:16","ops":['
        '{"op":"cut_silence","params":{}},{"op":"remove_fillers","params":{}},'
        '{"op":"punch_in","params":{"frequency":"high","max_scale":1.3}},'
        '{"op":"add_captions","params":{"style":"bold-karaoke"}},'
        '{"op":"auto_reframe","params":{"target_aspect":"9:16"}},'
        '{"op":"target_duration","params":{"max_seconds":60}}]}'
    )

    def __init__(self, model: str = "qwen2.5:7b", host: str = "http://localhost:11434",
                 transport=None):
        self.model = model
        self.url = f"{host}/api/generate"
        self._transport = transport or self._http

    def _payload(self, text: str, toggles: dict | None) -> dict:
        system = self.SYSTEM
        if toggles:
            system += f" Honor these UI toggles (they override the text): {json.dumps(toggles)}."
        return {
            "model": self.model,
            "system": system,
            "prompt": text,
            "stream": False,
            "format": EDIT_PLAN_JSON_SCHEMA,   # <- hard structural guarantee
            "options": {"temperature": 0.2},
        }

    @staticmethod
    def _http(url: str, payload: dict) -> dict:
        import urllib.request  # stdlib; only used on this path
        req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read())

    def plan(self, text: str, toggles: dict | None = None) -> EditPlan:
        response = self._transport(self.url, self._payload(text, toggles))
        return validate(json.loads(response["response"]))


def make_provider(use_llm: bool = False, **kw) -> object:
    return OllamaProvider(**kw) if use_llm else RulesProvider()

"""Cached analysis schema (Spec §7).

Everything expensive is computed ONCE per asset by the local AI sidecars
(Whisper word timestamps, Silero VAD speech segments, PySceneDetect shots,
emphasis scoring) and cached. The edit engine consumes this cache, which is
why re-vibe is instant. Here we model the cache and load it from JSON.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field


@dataclass
class Word:
    text: str
    start: float
    dur: float
    emphasis: float = 0.0  # 0..1, fused from RMS + pitch + keywords

    @property
    def end(self) -> float:
        return self.start + self.dur

    @property
    def mid(self) -> float:
        return self.start + self.dur / 2


@dataclass
class AssetAnalysis:
    asset_id: str
    source_url: str
    duration: float
    words: list[Word] = field(default_factory=list)
    speech: list[tuple[float, float]] = field(default_factory=list)  # VAD speech ranges
    scenes: list[float] = field(default_factory=list)  # shot-boundary times

    @classmethod
    def from_dict(cls, d: dict) -> "AssetAnalysis":
        return cls(
            asset_id=d["asset_id"],
            source_url=d["source_url"],
            duration=float(d["duration"]),
            words=[Word(w["text"], float(w["start"]), float(w["dur"]),
                        float(w.get("emphasis", 0.0))) for w in d.get("words", [])],
            speech=[(float(a), float(b)) for a, b in d.get("speech", [])],
            scenes=[float(t) for t in d.get("scenes", [])],
        )

    @classmethod
    def load(cls, path: str) -> "AssetAnalysis":
        with open(path, "r", encoding="utf-8") as fh:
            return cls.from_dict(json.load(fh))

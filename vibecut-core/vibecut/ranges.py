"""Time-range math — the foundation of non-destructive cutting.

The auto-editor never deletes media. It maintains a *keep list*: a set of
disjoint source-time ranges that survive. Every cut op subtracts ranges from
it; captions/zooms are then placed against the resulting source->timeline map.
"""
from __future__ import annotations

from dataclasses import dataclass

EPS = 1e-6
Range = tuple[float, float]


def subtract(keep: list[Range], cut: Range) -> list[Range]:
    """Remove `cut` from every range in `keep`, splitting where needed."""
    s, e = cut
    out: list[Range] = []
    for a, b in keep:
        if e <= a or s >= b:  # no overlap
            out.append((a, b))
            continue
        if a < s:  # left remainder
            out.append((a, s))
        if e < b:  # right remainder
            out.append((e, b))
    return [(a, b) for a, b in out if b - a > EPS]


def complement(segments: list[Range], lo: float, hi: float) -> list[Range]:
    """Return the gaps in [lo, hi] not covered by `segments` (e.g. silences)."""
    gaps: list[Range] = []
    cursor = lo
    for a, b in sorted(segments):
        a, b = max(a, lo), min(b, hi)
        if a > cursor:
            gaps.append((cursor, a))
        cursor = max(cursor, b)
    if cursor < hi:
        gaps.append((cursor, hi))
    return gaps


@dataclass
class KeepList:
    """A mutable, always-sorted, disjoint set of kept source ranges."""

    ranges: list[Range]

    @classmethod
    def whole(cls, duration: float) -> "KeepList":
        return cls([(0.0, duration)])

    def cut(self, rng: Range) -> None:
        new: list[Range] = []
        for r in self.ranges:
            new.extend(subtract([r], rng))
        self.ranges = sorted(new)

    def total(self) -> float:
        return sum(b - a for a, b in self.ranges)

    def contains(self, t: float) -> bool:
        return any(a - EPS <= t <= b + EPS for a, b in self.ranges)

    def map_to_timeline(self, t: float) -> float | None:
        """Map a source time to its position on the cut timeline (or None)."""
        off = 0.0
        for a, b in self.ranges:
            if t < a - EPS:
                return None  # falls inside a removed region
            if t <= b + EPS:
                return off + (t - a)
            off += b - a
        return None

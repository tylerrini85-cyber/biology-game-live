"""The Edit Model — the non-destructive JSON EDL (Spec §6).

References media by source in/out points; never holds pixels. Both the vibe
engine and the manual editor write here, and the render engine reads it.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict


@dataclass
class Profile:
    width: int = 1080
    height: int = 1920
    fps: int = 30
    colorspace: str = "rec709"


@dataclass
class Keyframe:
    t: float          # timeline seconds
    v: float          # value
    interp: str = "bezier"  # linear | constant | bezier


@dataclass
class Effect:
    type: str
    params: dict = field(default_factory=dict)
    keyframes: dict[str, list[Keyframe]] = field(default_factory=dict)


@dataclass
class Clip:
    id: str
    asset_id: str
    src_in: float
    src_out: float
    timeline_start: float
    origin: str = "vibe"     # vibe | manual
    locked: bool = False      # re-vibe skips locked clips (Spec §3)
    effects: list[Effect] = field(default_factory=list)

    @property
    def duration(self) -> float:
        return self.src_out - self.src_in

    @property
    def timeline_end(self) -> float:
        return self.timeline_start + self.duration


@dataclass
class Track:
    id: str
    kind: str  # video | audio
    clips: list[Clip] = field(default_factory=list)
    filters: list[Effect] = field(default_factory=list)


@dataclass
class CaptionWord:
    w: str
    t: float   # absolute timeline start
    d: float   # duration


@dataclass
class CaptionEvent:
    start: float
    end: float
    words: list[CaptionWord] = field(default_factory=list)

    @property
    def text(self) -> str:
        return " ".join(cw.w for cw in self.words)


@dataclass
class Captions:
    track_id: str = "CAP1"
    style: str = "minimal"
    position: str = "lower-mid"
    highlight_color: str = "#FFE000"
    font: str = "Arial"
    uppercase: bool = False
    size: int = 0  # 0 = auto from style
    events: list[CaptionEvent] = field(default_factory=list)


@dataclass
class EditModel:
    profile: Profile = field(default_factory=Profile)
    tracks: list[Track] = field(default_factory=list)
    captions: Captions = field(default_factory=Captions)
    notes: list[str] = field(default_factory=list)  # engine warnings / decisions

    def video_track(self) -> Track:
        for t in self.tracks:
            if t.kind == "video":
                return t
        t = Track(id="V1", kind="video")
        self.tracks.append(t)
        return t

    def broll_track(self) -> Track:
        for t in self.tracks:
            if t.kind == "video" and t.id == "V2":
                return t
        t = Track(id="V2", kind="video")
        self.tracks.append(t)
        return t

    def audio_track(self) -> Track:
        for t in self.tracks:
            if t.kind == "audio":
                return t
        t = Track(id="A1", kind="audio")
        self.tracks.append(t)
        return t

    def total_duration(self) -> float:
        return max((c.timeline_end for tr in self.tracks for c in tr.clips), default=0.0)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "EditModel":
        prof = Profile(**d.get("profile", {}))

        def eff(e: dict) -> Effect:
            kf = {k: [Keyframe(**x) for x in v] for k, v in e.get("keyframes", {}).items()}
            return Effect(type=e["type"], params=e.get("params", {}), keyframes=kf)

        tracks = []
        for t in d.get("tracks", []):
            clips = [Clip(id=c["id"], asset_id=c["asset_id"], src_in=c["src_in"],
                         src_out=c["src_out"], timeline_start=c["timeline_start"],
                         origin=c.get("origin", "vibe"), locked=c.get("locked", False),
                         effects=[eff(e) for e in c.get("effects", [])])
                     for c in t.get("clips", [])]
            tracks.append(Track(id=t["id"], kind=t["kind"], clips=clips,
                               filters=[eff(e) for e in t.get("filters", [])]))
        cap_d = d.get("captions", {})
        events = [CaptionEvent(start=ev["start"], end=ev["end"],
                              words=[CaptionWord(**w) for w in ev.get("words", [])])
                  for ev in cap_d.get("events", [])]
        captions = Captions(track_id=cap_d.get("track_id", "CAP1"),
                            style=cap_d.get("style", "minimal"),
                            position=cap_d.get("position", "lower-mid"),
                            highlight_color=cap_d.get("highlight_color", "#FFE000"),
                            font=cap_d.get("font", "Arial"),
                            uppercase=cap_d.get("uppercase", False),
                            size=cap_d.get("size", 0),
                            events=events)
        return cls(profile=prof, tracks=tracks, captions=captions,
                   notes=list(d.get("notes", [])))

    def save(self, path: str) -> None:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(self.to_dict(), fh, indent=2)

    @classmethod
    def load(cls, path: str) -> "EditModel":
        with open(path, "r", encoding="utf-8") as fh:
            return cls.from_dict(json.load(fh))

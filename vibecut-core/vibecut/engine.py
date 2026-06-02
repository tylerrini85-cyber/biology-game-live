"""The deterministic edit engine (Spec §8/§9).

Each op is a PURE function f(params, analysis, state) -> mutations. The LLM
chose the params; the algorithms here do the actual editing. This is what
makes results reproducible, testable, and undoable.

State during a run is a KeepList (surviving source ranges). After all cut ops,
we map source->timeline once and build the EditModel (clips, captions, zooms).
"""
from __future__ import annotations

import re

from .analysis import AssetAnalysis, Word
from .editmodel import (Captions, CaptionEvent, CaptionWord, Clip, Effect,
                        EditModel, Keyframe, Profile, Track)
from .editplan import EditPlan, OVERLAP_TRANSITIONS
from .ranges import KeepList, bridge_gaps, complement, split_at, subtract_all

_ASPECT_DIMS = {"16:9": (1920, 1080), "9:16": (1080, 1920),
                "1:1": (1080, 1080), "4:5": (1080, 1350)}
_FREQ_THRESH = {"high": 0.55, "medium": 0.7, "low": 0.82}
MIN_SEGMENT_S = 0.30  # kept ranges shorter than this are cut artifacts
BRIDGE_GAP_S = 0.25   # merge kept ranges separated by less than this


def _norm(text: str) -> str:
    return re.sub(r"[^a-z' ]", "", text.lower()).strip()


# ---- cut ops: mutate the KeepList -----------------------------------------
# `protect` is a list of source ranges that must never be cut (locked clips,
# Spec §3). Cuts are clipped around them so locked content is untouched.

def _safe_cut(keep: KeepList, rng: tuple, protect: list[tuple]) -> bool:
    pieces = subtract_all(rng, protect) if protect else [rng]
    did = False
    for piece in pieces:
        keep.cut(piece)
        did = True
    return did


def _protected(t: float, protect: list[tuple]) -> bool:
    return any(s <= t <= e for s, e in protect)


def cut_silence(p: dict, a: AssetAnalysis, keep: KeepList, protect: list[tuple]) -> int:
    cuts = 0
    for s, e in complement(a.speech, 0.0, a.duration):
        if (e - s) > p["min_duration_s"]:
            cs, ce = s + p["padding_s"], e - p["padding_s"]
            if ce > cs and _safe_cut(keep, (cs, ce), protect):
                cuts += 1
    return cuts


def remove_fillers(p: dict, a: AssetAnalysis, keep: KeepList, protect: list[tuple]) -> int:
    lex = {_norm(w) for w in p["lexicon"]}
    cuts = 0
    for w in a.words:
        if _norm(w.text) in lex and keep.contains(w.mid) and not _protected(w.mid, protect):
            keep.cut((w.start, w.end))
            cuts += 1
    return cuts


def _phrases(words: list[Word], pause_s: float = 0.6) -> list[dict]:
    """Group consecutive words into phrases, split on speech pauses."""
    out: list[dict] = []
    cur: list[Word] = []
    for w in sorted(words, key=lambda x: x.start):
        if cur and (w.start - cur[-1].end) > pause_s:
            out.append(_phrase(cur)); cur = []
        cur.append(w)
    if cur:
        out.append(_phrase(cur))
    return out


def _phrase(ws: list[Word]) -> dict:
    return {"start": ws[0].start, "end": ws[-1].end,
            "emphasis": sum(w.emphasis for w in ws) / len(ws), "n": len(ws)}


def target_duration(p: dict, a: AssetAnalysis, keep: KeepList, protect: list[tuple]) -> dict:
    """Ladder trim: drop whole lowest-emphasis PHRASES (not single words) so
    cuts land on natural pause boundaries and stay contiguous. Falls back to
    word-level only if phrase trimming can't reach the target."""
    target = p["max_seconds"]
    if keep.total() <= target:
        return {"trimmed_phrases": 0, "met": True}
    survivors = [w for w in a.words if keep.contains(w.mid) and not _protected(w.mid, protect)]
    phrases = sorted(_phrases(survivors), key=lambda ph: (ph["emphasis"], ph["end"] - ph["start"]))
    trimmed = 0
    for ph in phrases:
        if keep.total() <= target:
            break
        keep.cut((ph["start"], ph["end"]))
        trimmed += 1
    # fallback: if a few long protected/high-emphasis phrases keep us over,
    # shave remaining lowest-emphasis words
    if keep.total() > target:
        for w in sorted(survivors, key=lambda x: (x.emphasis, x.dur)):
            if keep.total() <= target:
                break
            if keep.contains(w.mid):
                keep.cut((w.start, w.end))
    return {"trimmed_phrases": trimmed, "met": keep.total() <= target + 1e-3}


# ---- build ops: write into the EditModel ----------------------------------

def _surviving_words(a: AssetAnalysis, keep: KeepList) -> list[Word]:
    return [w for w in a.words if keep.contains(w.mid)]


def add_captions(p: dict, a: AssetAnalysis, keep: KeepList, model: EditModel) -> int:
    maxw = int(p["max_words_per_line"])
    events: list[CaptionEvent] = []
    line: list[CaptionWord] = []

    def flush() -> None:
        if line:
            events.append(CaptionEvent(start=line[0].t,
                                       end=line[-1].t + line[-1].d,
                                       words=list(line)))
            line.clear()

    for w in _surviving_words(a, keep):
        tt = keep.map_to_timeline(w.start)
        if tt is None:
            continue
        line.append(CaptionWord(w=w.text, t=tt, d=w.dur))
        if len(line) >= maxw:
            flush()
    flush()
    model.captions = Captions(style=p["style"], position=p["position"],
                              highlight_color=p["highlight_color"],
                              font=p.get("font", "Arial"), uppercase=bool(p.get("uppercase", False)),
                              size=int(p.get("size", 0)), events=events)
    return len(events)


def color_look(p: dict, model: EditModel) -> None:
    model.video_track().filters.append(
        Effect(type="color_look", params={"look": p["look"], "amount": p["amount"]}))


def transitions(p: dict, model: EditModel) -> None:
    model.video_track().filters.append(
        Effect(type="transition", params={"style": p["style"], "duration": p["duration"],
                                          "audio": p.get("audio", "constant-power")}))


def speed(p: dict, model: EditModel) -> None:
    model.video_track().filters.append(Effect(type="speed", params={"factor": p["factor"]}))


def add_title(p: dict, model: EditModel) -> None:
    text = (p.get("text") or "").strip()
    if text:
        kind = p.get("kind", "intro")
        start = 0.0 if kind == "intro" else 1.0
        model.titles.append({"text": text, "start": start, "dur": p.get("duration", 2.5), "kind": kind})


def add_music(p: dict, model: EditModel) -> None:
    url = (p.get("url") or "").strip()
    if url:
        model.music = {"url": url, "gain": p.get("gain", 0.25), "duck": bool(p.get("duck", True))}
    else:
        model.notes.append("add_music: no music file given; skipped.")


def punch_in(p: dict, a: AssetAnalysis, keep: KeepList, model: EditModel,
             protect: list[tuple] | None = None) -> int:
    protect = protect or []
    thresh = _FREQ_THRESH[p["frequency"]]
    gap = p["min_gap_s"]
    scale = p["max_scale"]
    kf: list[Keyframe] = []
    last = -1e9
    count = 0
    for w in _surviving_words(a, keep):
        if w.emphasis < thresh or _protected(w.mid, protect):
            continue
        tt = keep.map_to_timeline(w.start)
        if tt is None or tt - last < gap:
            continue
        # zoom in over 0.15s, hold for the word, ease back
        kf.append(Keyframe(t=tt, v=1.0, interp="bezier"))
        kf.append(Keyframe(t=tt + 0.15, v=scale))
        kf.append(Keyframe(t=tt + max(0.3, w.dur), v=1.0))
        last = tt
        count += 1
    if kf:
        model.video_track().filters.append(
            Effect(type="transform", keyframes={"scale": kf}))
    return count


def suggest_broll(p: dict, a: AssetAnalysis, keep: KeepList, model: EditModel,
                  library: list[dict], protect: list[tuple]) -> int:
    """Retrieve matching clips from the user's OWN media (no generation).

    Reference matcher: transcript keyword -> library item tags. The shipping
    app swaps this for CLIP+FAISS semantic search over the same library; the
    output (overlay clips on the B-track) is identical.
    """
    if not library:
        model.notes.append("suggest_broll: no media library provided; skipped.")
        return 0
    gap = {"low": 8.0, "medium": 5.0, "high": 3.0}[p["density"]]
    track = model.broll_track()
    last = -1e9
    count = 0
    for w in _surviving_words(a, keep):
        if _protected(w.mid, protect):
            continue
        tt = keep.map_to_timeline(w.start)
        if tt is None or tt - last < gap:
            continue
        word = _norm(w.text)
        match = next((m for m in library if word in {_norm(t) for t in m.get("tags", [])}), None)
        if match:
            dur = min(2.0, float(match.get("duration", 2.0)))
            track.clips.append(Clip(id=f"b{count}", asset_id=match["id"], src_in=0.0,
                                    src_out=dur, timeline_start=round(tt, 3), origin="vibe"))
            track.clips[-1].effects.append(
                Effect(type="broll_overlay", params={"url": match.get("url", ""),
                                                     "matched_word": word}))
            last = tt
            count += 1
    return count


def auto_reframe(p: dict, a: AssetAnalysis, model: EditModel) -> None:
    asp = p["target_aspect"]
    w, h = _ASPECT_DIMS[asp]
    model.profile = Profile(width=w, height=h, fps=model.profile.fps)
    # Real reframe needs subject tracks (MediaPipe). Record intent for the
    # compositor; warn if the analysis lacks tracking data.
    model.video_track().filters.append(
        Effect(type="auto_reframe", params={"target_aspect": asp,
                                            "smoothness": p["smoothness"]}))
    model.notes.append(
        f"auto_reframe -> {asp}: subject-tracking keyframes are generated "
        "in-app from MediaPipe tracks (not present in this analysis sample).")


def normalize_loudness(p: dict, model: EditModel) -> None:
    model.audio_track().filters.append(
        Effect(type="loudnorm", params={"i": p["i"], "tp": p["tp"], "lra": p["lra"]}))


def enhance_speech(p: dict, model: EditModel) -> None:
    model.audio_track().filters.append(
        Effect(type="deepfilternet", params={"strength": p["strength"]}))


# ---- orchestration ---------------------------------------------------------

def _apply_overlap(plan: EditPlan, model: EditModel, report: dict) -> None:
    """For xfade-based transitions, shift the whole timeline left by the
    accumulated overlap so cross-fades line up and captions/zooms stay synced."""
    tparams = next((o.params for o in plan.ops if o.op == "transitions"), None)
    vt = model.video_track()
    if not tparams or tparams.get("style") not in OVERLAP_TRANSITIONS or len(vt.clips) < 2:
        return
    durs = [c.src_out - c.src_in for c in vt.clips]
    D = min(float(tparams.get("duration", 0.4)), 0.5 * min(durs))
    boundaries, acc = [], 0.0
    for d in durs[:-1]:
        acc += d
        boundaries.append(acc)

    def shift(t: float) -> float:
        cb = sum(1 for b in boundaries if b <= t + 1e-6)
        return max(0.0, t - cb * D)

    for tr in model.tracks:
        for c in tr.clips:
            c.timeline_start = shift(c.timeline_start)
    for ev in model.captions.events:
        ev.start, ev.end = shift(ev.start), shift(ev.end)
        for w in ev.words:
            w.t = shift(w.t)
    for f in vt.filters:
        if f.type == "transform":
            for k in f.keyframes.get("scale", []):
                k.t = shift(k.t)
        if f.type == "transition":
            f.params["overlap"] = round(D, 4)
    report["ops"].append({"transition_overlap_s": round(D, 3)})


def _locked_specs(prev: EditModel | None) -> list[Clip]:
    if prev is None:
        return []
    return [c for c in prev.video_track().clips if c.locked]


def apply_plan(plan: EditPlan, a: AssetAnalysis,
               prev_model: EditModel | None = None,
               media_library: list[dict] | None = None) -> tuple[EditModel, dict]:
    """Run a validated plan against cached analysis -> (EditModel, report).

    If `prev_model` is given (a RE-VIBE), source ranges covered by *locked*
    clips are protected: never cut, never zoomed, and their effects + origin
    are carried over. Everything else is freshly re-edited per the new plan.
    """
    keep = KeepList.whole(a.duration)
    model = EditModel()
    report: dict = {"original_s": round(a.duration, 2), "ops": [], "revibe": prev_model is not None}

    locked = _locked_specs(prev_model)
    protect = [(c.src_in, c.src_out) for c in locked]
    if locked:
        report["ops"].append({"protect_locked": {"clips": len(locked),
                                                 "seconds": round(sum(e - s for s, e in protect), 2)}})

    params = {o.op: o.params for o in plan.ops}

    # 1) cut ops first (order matters: silence -> fillers -> target)
    if "cut_silence" in params:
        n = cut_silence(params["cut_silence"], a, keep, protect)
        report["ops"].append({"cut_silence": {"silences_cut": n}})
    if "remove_fillers" in params:
        n = remove_fillers(params["remove_fillers"], a, keep, protect)
        report["ops"].append({"remove_fillers": {"fillers_cut": n}})

    # target duration can come from a dedicated op or the plan-level field
    target = None
    if "target_duration" in params:
        target = params["target_duration"]["max_seconds"]
    elif plan.target_duration_s is not None:
        target = plan.target_duration_s
    if target is not None:
        res = target_duration({"max_seconds": target}, a, keep, protect)
        report["ops"].append({"target_duration": {"target_s": round(target, 2), **res}})

    # smooth out choppiness: bridge micro inter-word gaps so kept words stay
    # contiguous (real silences are longer and stay cut), then drop slivers.
    # locked-boundary exactness is restored by split_at() below.
    keep.ranges = bridge_gaps(keep.ranges, BRIDGE_GAP_S)
    before = len(keep.ranges)
    keep.ranges = [(s, e) for s, e in keep.ranges
                   if (e - s) >= MIN_SEGMENT_S or _protected((s + e) / 2, protect)]
    if before - len(keep.ranges):
        report["ops"].append({"cleanup": {"slivers_dropped": before - len(keep.ranges)}})

    # split kept ranges at locked boundaries so each locked clip is its own segment
    if protect:
        keep.ranges = split_at(keep.ranges, [x for r in protect for x in r])

    # 2) build the timeline from the final keep list (one clip per kept range)
    vt = model.video_track()
    at = model.audio_track()
    locked_by_range = {(round(c.src_in, 3), round(c.src_out, 3)): c for c in locked}
    off = 0.0
    for i, (s, e) in enumerate(keep.ranges):
        spec = locked_by_range.get((round(s, 3), round(e, 3)))
        vclip = Clip(id=f"v{i}", asset_id=a.asset_id, src_in=s, src_out=e,
                     timeline_start=off, origin="vibe")
        if spec is not None:  # carry over the locked hand-edit
            vclip.locked = True
            vclip.origin = spec.origin
            vclip.effects = spec.effects
        vt.clips.append(vclip)
        at.clips.append(Clip(id=f"a{i}", asset_id=a.asset_id, src_in=s, src_out=e,
                             timeline_start=off, origin=vclip.origin, locked=vclip.locked))
        off += e - s

    # 3) build ops that need the timeline map
    if "add_captions" in params:
        n = add_captions(params["add_captions"], a, keep, model)
        report["ops"].append({"add_captions": {"events": n}})
    if "punch_in" in params:
        n = punch_in(params["punch_in"], a, keep, model, protect)
        report["ops"].append({"punch_in": {"zooms": n}})
    if "suggest_broll" in params:
        n = suggest_broll(params["suggest_broll"], a, keep, model, media_library or [], protect)
        report["ops"].append({"suggest_broll": {"clips": n}})
    if "auto_reframe" in params:
        auto_reframe(params["auto_reframe"], a, model)
        report["ops"].append({"auto_reframe": params["auto_reframe"]["target_aspect"]})
    if "color_look" in params:
        color_look(params["color_look"], model)
        report["ops"].append({"color_look": params["color_look"]["look"]})
    if "transitions" in params:
        transitions(params["transitions"], model)
        report["ops"].append({"transitions": params["transitions"]["style"]})
    if "speed" in params:
        speed(params["speed"], model)
        report["ops"].append({"speed": params["speed"]["factor"]})
    for o in plan.ops:  # support multiple titles (intro + lower-third)
        if o.op == "add_title":
            add_title(o.params, model)
    if model.titles:
        report["ops"].append({"add_title": [tt["text"] for tt in model.titles]})
    if "add_music" in params:
        add_music(params["add_music"], model)
        if model.music:
            report["ops"].append({"add_music": {"duck": model.music["duck"]}})
    if "normalize_loudness" in params:
        normalize_loudness(params["normalize_loudness"], model)
        report["ops"].append({"normalize_loudness": params["normalize_loudness"]["i"]})
    if "enhance_speech" in params:
        enhance_speech(params["enhance_speech"], model)
        report["ops"].append({"enhance_speech": True})

    # overlap transitions (xfade): compress the timeline so the cross-fades line
    # up AND captions / zooms stay synced (each cut overlaps by D).
    _apply_overlap(plan, model, report)

    report["final_s"] = round(model.total_duration(), 2)
    report["kept_segments"] = len(keep.ranges)
    report["notes"] = list(model.notes)
    return model, report

"""VibeCut CLI — the whole pipeline end to end.

    python -m vibecut.cli "make it punchy and under 60s with bold captions"

Loads cached analysis, turns your text into a validated edit plan, runs the
deterministic engine, and prints the plan + a report + the FFmpeg command,
writing the .ass caption file. Add --llm to use a local Ollama model instead
of the offline rules parser.
"""
from __future__ import annotations

import argparse
import json
import os

from .analysis import AssetAnalysis
from .editmodel import EditModel
from .editplan import to_plain
from .engine import apply_plan
from .render import build_ass, build_ffmpeg_command
from .timeline import render as render_timeline
from .vibe import make_provider

_HERE = os.path.dirname(__file__)
_DEFAULT_ANALYSIS = os.path.join(_HERE, "..", "samples", "sample_analysis.json")


def run(prompt: str, analysis_path: str, out_path: str, ass_path: str,
        encoder: str, toggles: dict, use_llm: bool, model: str,
        from_project: str | None = None, save_project: str | None = None,
        lock_clips: list[int] | None = None) -> dict:
    analysis = AssetAnalysis.load(analysis_path)
    provider = make_provider(use_llm=use_llm, model=model) if use_llm else make_provider()
    plan = provider.plan(prompt, toggles)

    prev_model = EditModel.load(from_project) if from_project else None
    edit_model, report = apply_plan(plan, analysis, prev_model=prev_model)

    # optionally lock clips by index (so a later --revibe protects them)
    for idx in (lock_clips or []):
        clips = edit_model.video_track().clips
        if 0 <= idx < len(clips):
            clips[idx].locked = True
            clips[idx].origin = "manual"

    if save_project:
        edit_model.save(save_project)

    ass = build_ass(edit_model.captions, edit_model.profile.width, edit_model.profile.height)
    with open(ass_path, "w", encoding="utf-8") as fh:
        fh.write(ass)
    cmd = build_ffmpeg_command(edit_model, analysis.source_url, out_path,
                               ass_path=ass_path, encoder=encoder)
    return {"provider": provider.name, "plan": to_plain(plan),
            "report": report, "ffmpeg": cmd, "ass_path": ass_path,
            "edit_model": edit_model, "original_s": analysis.duration}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="vibecut", description="Vibe-edit a clip from text.")
    ap.add_argument("prompt", help="what you want done, in plain language")
    ap.add_argument("--analysis", default=_DEFAULT_ANALYSIS, help="cached analysis JSON")
    ap.add_argument("--out", default="out.mp4", help="export path for the ffmpeg command")
    ap.add_argument("--ass", default="captions.ass", help="caption file to write")
    ap.add_argument("--encoder", default="mac", choices=["mac", "nvidia", "intel", "amd"])
    ap.add_argument("--no-zooms", action="store_true", help="disable punch-in zooms")
    ap.add_argument("--no-captions", action="store_true")
    ap.add_argument("--llm", action="store_true", help="use a local Ollama model")
    ap.add_argument("--model", default="qwen2.5:7b")
    ap.add_argument("--save-project", metavar="PATH", help="write the edit model JSON")
    ap.add_argument("--revibe", metavar="PROJECT", help="re-vibe an existing project (protects locked clips)")
    ap.add_argument("--lock-clip", type=int, action="append", default=[], metavar="N",
                    help="lock video clip #N before saving (repeatable)")
    ap.add_argument("--json", action="store_true", help="emit machine-readable JSON only")
    args = ap.parse_args(argv)

    toggles: dict = {}
    if args.no_zooms:
        toggles["zooms"] = False
    if args.no_captions:
        toggles["captions"] = False

    res = run(args.prompt, args.analysis, args.out, args.ass, args.encoder,
              toggles, args.llm, args.model, from_project=args.revibe,
              save_project=args.save_project, lock_clips=args.lock_clip)

    if args.json:
        out = {k: v for k, v in res.items() if k != "edit_model"}
        print(json.dumps(out, indent=2))
        return 0

    r = res["report"]
    print(f"\n  VibeCut  ·  provider: {res['provider']}")
    print(f"  prompt   : {args.prompt}")
    print("  " + "-" * 58)
    print("  EDIT PLAN:")
    print(json.dumps(res["plan"], indent=2).replace("\n", "\n  "))
    print("  " + "-" * 58)
    print(f"  original : {r['original_s']:.1f}s")
    print(f"  final    : {r['final_s']:.1f}s   ({r['kept_segments']} segments kept)")
    for op in r["ops"]:
        print(f"    - {json.dumps(op)}")
    if r["notes"]:
        for nte in r["notes"]:
            print(f"  note: {nte}")
    print(f"  captions : {len(res['edit_model'].captions.events)} events -> {res['ass_path']}")
    print("  " + "-" * 58)
    print("  TIMELINE (original footage: kept vs cut):")
    print(render_timeline(res["edit_model"], res["original_s"]))
    print("  " + "-" * 58)
    print("  FFMPEG (deterministic export):\n")
    print("  " + res["ffmpeg"].replace("\n", "\n  "))
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Stdlib unittest suite — proves the core logic without GPU/model/ffmpeg.

Run:  python -m unittest discover -s tests -v   (from vibecut-core/)
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vibecut.analysis import AssetAnalysis
from vibecut.editplan import validate, to_plain
from vibecut.engine import apply_plan
from vibecut.ranges import KeepList, subtract, complement
from vibecut.render import build_ass, build_ffmpeg_command
from vibecut.vibe import RulesProvider

SAMPLE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                      "samples", "sample_analysis.json")


class TestRanges(unittest.TestCase):
    def test_subtract_splits(self):
        self.assertEqual(subtract([(0, 10)], (3, 5)), [(0, 3), (5, 10)])

    def test_subtract_no_overlap(self):
        self.assertEqual(subtract([(0, 10)], (20, 30)), [(0, 10)])

    def test_complement_finds_silences(self):
        gaps = complement([(2, 20), (30, 68)], 0, 92)
        self.assertIn((0, 2), gaps)
        self.assertIn((20, 30), gaps)
        self.assertIn((68, 92), gaps)

    def test_keeplist_map_and_total(self):
        k = KeepList.whole(100)
        k.cut((10, 20))  # remove 10s
        self.assertAlmostEqual(k.total(), 90.0)
        # source t=25 -> timeline 15 (first range 0..10 = 10s, then 20..)
        self.assertAlmostEqual(k.map_to_timeline(25), 15.0)
        self.assertIsNone(k.map_to_timeline(15))  # inside the cut


class TestEditPlan(unittest.TestCase):
    def test_drops_unknown_ops(self):
        plan = validate({"ops": [{"op": "delete_universe"}, {"op": "cut_silence"}]})
        self.assertEqual([o.op for o in plan.ops], ["cut_silence"])

    def test_clamps_out_of_range(self):
        plan = validate({"ops": [{"op": "punch_in", "params": {"max_scale": 99}}]})
        self.assertLessEqual(plan.ops[0].params["max_scale"], 2.0)

    def test_bad_aspect_falls_back(self):
        self.assertEqual(validate({"aspect": "banana", "ops": []}).aspect, "16:9")


class TestVibe(unittest.TestCase):
    def setUp(self):
        self.p = RulesProvider()

    def test_duration_parsing(self):
        plan = self.p.plan("make it under 60 seconds")
        self.assertEqual(plan.target_duration_s, 60.0)

    def test_minutes_parsing(self):
        self.assertEqual(self.p.plan("trim to 2 minutes").target_duration_s, 120.0)

    def test_punchy_adds_zoom(self):
        self.assertTrue(self.p.plan("make it punchy").has("punch_in"))

    def test_no_zoom_toggle(self):
        plan = self.p.plan("make it punchy", toggles={"zooms": False})
        self.assertFalse(plan.has("punch_in"))

    def test_vertical_sets_aspect(self):
        plan = self.p.plan("cut this down for tiktok")
        self.assertEqual(plan.aspect, "9:16")
        self.assertTrue(plan.has("auto_reframe"))

    def test_defaults_present(self):
        plan = self.p.plan("clean it up")
        for op in ("cut_silence", "remove_fillers", "add_captions"):
            self.assertTrue(plan.has(op), op)


class TestEngine(unittest.TestCase):
    def setUp(self):
        self.a = AssetAnalysis.load(SAMPLE)

    def test_cut_silence_shortens(self):
        plan = RulesProvider().plan("remove the dead air")
        _, rep = apply_plan(plan, self.a)
        self.assertLess(rep["final_s"], rep["original_s"])
        # sample has big 20-30s and 68-78s silences -> meaningful reduction
        self.assertLess(rep["final_s"], 75.0)

    def test_fillers_excluded_from_captions(self):
        plan = RulesProvider().plan("add captions and clean it up")
        model, _ = apply_plan(plan, self.a)
        caption_words = [cw.w.lower() for ev in model.captions.events for cw in ev.words]
        for filler in ("um", "uh"):
            self.assertNotIn(filler, caption_words)

    def test_target_duration_met(self):
        plan = RulesProvider().plan("make it punchy under 40 seconds")
        model, rep = apply_plan(plan, self.a)
        self.assertLessEqual(model.total_duration(), 40.0 + 0.05)

    def test_captions_monotonic_timeline(self):
        plan = RulesProvider().plan("add bold captions")
        model, _ = apply_plan(plan, self.a)
        times = [cw.t for ev in model.captions.events for cw in ev.words]
        self.assertEqual(times, sorted(times))

    def test_clips_are_contiguous(self):
        plan = RulesProvider().plan("tighten it up")
        model, _ = apply_plan(plan, self.a)
        vt = model.video_track()
        for prev, nxt in zip(vt.clips, vt.clips[1:]):
            self.assertAlmostEqual(prev.timeline_end, nxt.timeline_start, places=3)

    def test_punch_in_creates_keyframes(self):
        plan = RulesProvider().plan("make it really punchy with lots of zoom")
        model, rep = apply_plan(plan, self.a)
        transforms = [f for f in model.video_track().filters if f.type == "transform"]
        self.assertTrue(transforms and transforms[0].keyframes.get("scale"))


class TestRender(unittest.TestCase):
    def setUp(self):
        self.a = AssetAnalysis.load(SAMPLE)
        self.model, _ = apply_plan(RulesProvider().plan("punchy bold captions under 50s"), self.a)

    def test_ffmpeg_has_core_filters(self):
        cmd = build_ffmpeg_command(self.model, self.a.source_url, "out.mp4")
        for token in ("trim=", "atrim=", "concat=", "loudnorm=", "ass=", "h264_videotoolbox"):
            self.assertIn(token, cmd, token)

    def test_encoder_selection(self):
        cmd = build_ffmpeg_command(self.model, self.a.source_url, "out.mp4", encoder="nvidia")
        self.assertIn("h264_nvenc", cmd)
        self.assertNotIn("libx264", cmd)  # no GPL software encoder

    def test_ass_has_karaoke(self):
        ass = build_ass(self.model.captions)
        self.assertIn("[Events]", ass)
        self.assertIn("Dialogue:", ass)
        self.assertIn("\\kf", ass)  # karaoke word-highlight timing


if __name__ == "__main__":
    unittest.main(verbosity=2)

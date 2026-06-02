"""Stdlib unittest suite — proves the core logic without GPU/model/ffmpeg.

Run:  python -m unittest discover -s tests -v   (from vibecut-core/)
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vibecut.analysis import AssetAnalysis
from vibecut.editmodel import EditModel, Effect
from vibecut.editplan import validate, to_plain
from vibecut.engine import apply_plan
from vibecut.ranges import KeepList, subtract, complement
from vibecut.render import build_ass, build_ffmpeg_command
from vibecut.vibe import RulesProvider, OllamaProvider

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


class TestOllamaProvider(unittest.TestCase):
    """Verify the LLM request shape + response parsing without a live server."""

    def test_payload_uses_constrained_schema(self):
        captured = {}

        def fake_transport(url, payload):
            captured["url"] = url
            captured["payload"] = payload
            return {"response": '{"ops":[{"op":"cut_silence","params":{}}]}'}

        prov = OllamaProvider(model="qwen2.5:7b", transport=fake_transport)
        prov.plan("tighten it up", toggles={"zooms": False})

        self.assertTrue(captured["url"].endswith("/api/generate"))
        p = captured["payload"]
        self.assertEqual(p["model"], "qwen2.5:7b")
        self.assertFalse(p["stream"])
        # the JSON schema is sent as `format` -> Ollama constrains decoding
        self.assertEqual(p["format"]["properties"]["ops"]["items"]["properties"]
                         ["op"]["enum"][0], "cut_silence")
        self.assertIn("toggles", p["system"])  # toggles forwarded to the model

    def test_parses_model_response_into_valid_plan(self):
        model_json = ('{"target_duration_s":60,"aspect":"9:16","ops":['
                      '{"op":"cut_silence","params":{"min_duration_s":0.4}},'
                      '{"op":"delete_universe","params":{}},'      # bogus -> dropped
                      '{"op":"punch_in","params":{"max_scale":99}}]}')  # clamped
        prov = OllamaProvider(transport=lambda url, payload: {"response": model_json})
        plan = prov.plan("make it punchy and short for reels")
        ops = [o.op for o in plan.ops]
        self.assertIn("cut_silence", ops)
        self.assertIn("punch_in", ops)
        self.assertNotIn("delete_universe", ops)              # validate() dropped it
        self.assertEqual(plan.aspect, "9:16")
        scale = next(o for o in plan.ops if o.op == "punch_in").params["max_scale"]
        self.assertLessEqual(scale, 2.0)                       # validate() clamped it


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

    def test_phrase_level_trim_stays_contiguous(self):
        # phrase-level trimming should NOT shatter the clip into many fragments
        plan = RulesProvider().plan("under 40 seconds")
        model, rep = apply_plan(plan, self.a)
        self.assertLessEqual(model.total_duration(), 40.05)
        self.assertLessEqual(len(model.video_track().clips), 8)

    def test_punch_in_creates_keyframes(self):
        plan = RulesProvider().plan("make it really punchy with lots of zoom")
        model, rep = apply_plan(plan, self.a)
        transforms = [f for f in model.video_track().filters if f.type == "transform"]
        self.assertTrue(transforms and transforms[0].keyframes.get("scale"))


class TestColorAndTransitions(unittest.TestCase):
    def setUp(self):
        self.a = AssetAnalysis.load(SAMPLE)

    def test_vibe_detects_look_and_transition(self):
        plan = RulesProvider().plan("warm cinematic look with fades, uppercase captions")
        self.assertTrue(plan.has("color_look"))
        self.assertTrue(plan.has("transitions"))
        cl = next(o for o in plan.ops if o.op == "color_look")
        self.assertEqual(cl.params["look"], "warm")

    def test_color_look_baked_into_export(self):
        from vibecut.render import build_ffmpeg_args
        model, _ = apply_plan(RulesProvider().plan("vivid colors"), self.a)
        fc = build_ffmpeg_args(model, self.a.source_url, "out.mp4")[
            build_ffmpeg_args(model, self.a.source_url, "out.mp4").index("-filter_complex") + 1]
        self.assertIn("saturation=1.4", fc)  # vivid grade

    def test_fade_baked_into_export(self):
        from vibecut.render import build_ffmpeg_args
        model, _ = apply_plan(RulesProvider().plan("add fades"), self.a)
        args = build_ffmpeg_args(model, self.a.source_url, "out.mp4")
        fc = args[args.index("-filter_complex") + 1]
        self.assertIn("fade=t=in", fc)
        self.assertIn("fade=t=out", fc)

    def test_caption_uppercase_and_style(self):
        model, _ = apply_plan(RulesProvider().plan("neon uppercase captions"), self.a)
        self.assertEqual(model.captions.style, "neon")
        self.assertTrue(model.captions.uppercase)
        ass = build_ass(model.captions)
        # at least one word should be rendered upper-cased
        self.assertTrue(any(cw.w.upper() in ass for ev in model.captions.events for cw in ev.words))


class TestSpeedTitleAudio(unittest.TestCase):
    def setUp(self):
        self.a = AssetAnalysis.load(SAMPLE)

    def test_vibe_detects_speed(self):
        self.assertEqual(next(o for o in RulesProvider().plan("slow motion").ops if o.op == "speed").params["factor"], 0.5)
        self.assertEqual(next(o for o in RulesProvider().plan("speed it up").ops if o.op == "speed").params["factor"], 1.5)

    def test_speed_baked_into_export(self):
        from vibecut.render import build_ffmpeg_args
        model, _ = apply_plan(RulesProvider().plan("slow motion"), self.a)
        args = build_ffmpeg_args(model, self.a.source_url, "out.mp4")
        fc = args[args.index("-filter_complex") + 1]
        self.assertIn("setpts=PTS/0.5", fc)   # video time-remap
        self.assertIn("atempo=", fc)           # audio time-remap

    def test_title_renders_in_ass(self):
        model, _ = apply_plan(RulesProvider().plan("add captions"), self.a)
        model.titles.append({"text": "My Channel", "start": 0.0, "dur": 2.5})
        ass = build_ass(model.captions, titles=model.titles)
        self.assertIn("Style: Title", ass)
        self.assertIn("My Channel", ass)

    def test_enhance_uses_afftdn(self):
        from vibecut.render import build_ffmpeg_args
        model, _ = apply_plan(RulesProvider().plan("clean up the audio noise"), self.a)
        args = build_ffmpeg_args(model, self.a.source_url, "out.mp4")
        self.assertIn("afftdn", args[args.index("-filter_complex") + 1])


class TestBroll(unittest.TestCase):
    def setUp(self):
        self.a = AssetAnalysis.load(SAMPLE)
        self.library = [
            {"id": "b_growth", "url": "/b/g.mov", "duration": 4.0,
             "tags": ["important", "biggest", "works"]},
            {"id": "b_mistake", "url": "/b/m.mov", "duration": 3.0,
             "tags": ["mistake", "give"]},
        ]

    def test_broll_matches_keywords_from_own_library(self):
        plan = RulesProvider().plan("add some b-roll and captions")
        self.assertTrue(plan.has("suggest_broll"))
        model, rep = apply_plan(plan, self.a, media_library=self.library)
        bt = model.broll_track()
        self.assertTrue(bt.clips, "should place at least one b-roll overlay")
        # placed clips reference the user's own library assets, not generated ones
        self.assertTrue(all(c.asset_id in ("b_growth", "b_mistake") for c in bt.clips))

    def test_no_library_is_safe(self):
        plan = RulesProvider().plan("add b-roll")
        model, rep = apply_plan(plan, self.a, media_library=None)
        self.assertEqual(model.broll_track().clips, [])
        self.assertTrue(any("media library" in n for n in model.notes))

    def test_broll_toggle_off(self):
        plan = RulesProvider().plan("add b-roll", toggles={"broll": False})
        self.assertFalse(plan.has("suggest_broll"))


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

    def test_reframe_bakes_crop_and_scale(self):
        from vibecut.render import build_ffmpeg_command
        # vertical request -> the export actually crops + scales, not just a note
        model, _ = apply_plan(RulesProvider().plan("vertical for tiktok"), self.a)
        cmd = build_ffmpeg_command(model, self.a.source_url, "out.mp4")
        self.assertIn("crop=", cmd)
        self.assertIn("scale=1080:1920", cmd)

    def test_ffmpeg_args_are_argv_list(self):
        from vibecut.render import build_ffmpeg_args
        args = build_ffmpeg_args(self.model, self.a.source_url, "out.mp4", encoder="nvidia")
        self.assertEqual(args[0], "ffmpeg")
        self.assertIn("-filter_complex", args)
        self.assertIn("[vout]", args)
        self.assertIn("h264_nvenc", args)

    def test_render_to_file_reports_missing_ffmpeg_or_source(self):
        from vibecut.render import render_to_file
        ok, msg = render_to_file(self.model, "/no/such/clip.mov", "out.mp4")
        self.assertFalse(ok)
        self.assertTrue("FFmpeg" in msg or "not found" in msg)

    def test_zoom_baked_into_export(self):
        from vibecut.render import build_ffmpeg_args
        model, _ = apply_plan(RulesProvider().plan("really punchy with lots of zoom"), self.a)
        args = build_ffmpeg_args(model, self.a.source_url, "out.mp4")
        fc = args[args.index("-filter_complex") + 1]   # raw, unescaped filtergraph
        self.assertIn("between(t,", fc)                  # time-based zoom expression
        self.assertIn("crop=w='iw/(", fc)                # animated centered crop

    def test_broll_overlay_added_as_input(self):
        from vibecut.render import build_ffmpeg_args
        with tempfile.TemporaryDirectory() as d:
            clip = os.path.join(d, "welcome_broll.mp4")
            open(clip, "wb").write(b"\x00")  # a real (dummy) file so it isn't skipped
            lib = [{"id": "bw", "url": clip, "duration": 2.0, "tags": ["welcome"]}]
            model, _ = apply_plan(RulesProvider().plan("add b-roll"), self.a, media_library=lib)
            args = build_ffmpeg_args(model, self.a.source_url, "out.mp4")
            self.assertIn(clip, args)                      # b-roll added as an extra input
            fc = args[args.index("-filter_complex") + 1]
            self.assertIn("overlay=enable='between(t,", fc)  # timed cutaway


class TestReVibe(unittest.TestCase):
    def setUp(self):
        self.a = AssetAnalysis.load(SAMPLE)
        self.model1, _ = apply_plan(RulesProvider().plan("clean it up"), self.a)
        # lock the middle clip and give it a hand-applied effect
        self.locked = self.model1.video_track().clips[2]
        self.locked.locked = True
        self.locked.origin = "manual"
        self.locked.effects.append(Effect(type="color_look", params={"look": "warm"}))
        self.src = (self.locked.src_in, self.locked.src_out)

    def test_locked_clip_survives_aggressive_revibe(self):
        plan2 = RulesProvider().plan("cut it way down to 12 seconds, super punchy")
        model2, rep = apply_plan(plan2, self.a, prev_model=self.model1)
        self.assertTrue(rep["revibe"])
        matches = [c for c in model2.video_track().clips
                   if abs(c.src_in - self.src[0]) < 1e-3 and abs(c.src_out - self.src[1]) < 1e-3]
        self.assertEqual(len(matches), 1, "locked source range must survive re-vibe")
        self.assertTrue(matches[0].locked)
        self.assertEqual(matches[0].origin, "manual")
        self.assertTrue(any(e.type == "color_look" for e in matches[0].effects),
                        "hand-applied effect must be preserved")

    def test_revibe_still_reedits_unlocked(self):
        # without the lock, the same aggressive prompt cuts much more
        plan2 = RulesProvider().plan("cut it way down to 12 seconds")
        model_free, _ = apply_plan(plan2, self.a)              # fresh, no locks
        model_lock, _ = apply_plan(plan2, self.a, prev_model=self.model1)
        self.assertGreaterEqual(model_lock.total_duration(), model_free.total_duration())

    def test_no_zoom_inside_locked(self):
        plan2 = RulesProvider().plan("make it really punchy with lots of zoom")
        model2, _ = apply_plan(plan2, self.a, prev_model=self.model1)
        # locate the surviving locked clip's timeline span in the new model
        survivor = next(c for c in model2.video_track().clips
                        if abs(c.src_in - self.src[0]) < 1e-3 and abs(c.src_out - self.src[1]) < 1e-3)
        lo, hi = survivor.timeline_start, survivor.timeline_end
        for f in model2.video_track().filters:
            if f.type != "transform":
                continue
            for k in f.keyframes.get("scale", []):
                self.assertFalse(lo <= k.t <= hi, "no auto-zoom should be placed inside a locked clip")


class TestIngest(unittest.TestCase):
    def _make_wav(self, path):
        import array as _array
        import math as _math
        import wave as _wave
        rate = 8000
        data = _array.array("h")
        data.extend([0] * rate)                       # 1s silence
        for i in range(rate):                          # 1s tone (speech stand-in)
            data.append(int(10000 * _math.sin(2 * _math.pi * 220 * i / rate)))
        data.extend([0] * rate)                       # 1s silence
        with _wave.open(path, "wb") as wf:
            wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(rate)
            wf.writeframes(data.tobytes())

    def test_speech_from_wav(self):
        from vibecut.ingest import speech_from_wav
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "a.wav")
            self._make_wav(p)
            speech, dur, rms_at, (floor, peak) = speech_from_wav(p)
        self.assertAlmostEqual(dur, 3.0, places=1)
        self.assertTrue(speech, "should detect the loud region")
        # one detected speech range should cover the middle second
        self.assertTrue(any(s <= 1.2 and e >= 1.8 for s, e in speech))
        # silence at t=0.2 quieter than speech at t=1.5
        self.assertLess(rms_at(0.2), rms_at(1.5))

    def test_whisper_json(self):
        from vibecut.ingest import words_from_whisper
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "t.json")
            with open(p, "w") as fh:
                fh.write('{"segments":[{"words":['
                         '{"word":"hello","start":0.0,"end":0.5},'
                         '{"word":"world","start":0.6,"end":1.0}]}]}')
            words, end = words_from_whisper(p)
        self.assertEqual([w.text for w in words], ["hello", "world"])
        self.assertAlmostEqual(end, 1.0)

    def test_srt(self):
        from vibecut.ingest import words_from_srt
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "t.srt")
            with open(p, "w") as fh:
                fh.write("1\n00:00:00,000 --> 00:00:02,000\nhello there friend\n")
            words, end = words_from_srt(p)
        self.assertEqual([w.text for w in words], ["hello", "there", "friend"])
        self.assertAlmostEqual(end, 2.0)

    def test_analyze_end_to_end_feeds_engine(self):
        # ingest a synthesized wav + transcript, then run the real engine on it
        from vibecut.ingest import analyze
        with tempfile.TemporaryDirectory() as d:
            wav = os.path.join(d, "a.wav"); self._make_wav(wav)
            tj = os.path.join(d, "t.json")
            with open(tj, "w") as fh:
                fh.write('{"segments":[{"words":['
                         '{"word":"this","start":1.0,"end":1.3},'
                         '{"word":"is","start":1.3,"end":1.5},'
                         '{"word":"important","start":1.5,"end":1.9}]}]}')
            a = analyze("a1", "/clip.mov", wav=wav, transcript=tj)
        self.assertGreater(a.duration, 2.9)
        self.assertEqual(len(a.words), 3)
        self.assertTrue(all(0.0 <= w.emphasis <= 1.0 for w in a.words))
        # the engine consumes this real analysis unchanged
        model, rep = apply_plan(RulesProvider().plan("add captions"), a)
        self.assertTrue(model.captions.events)


class TestReport(unittest.TestCase):
    def test_html_report_contains_key_sections(self):
        from vibecut.report import render_html
        a = AssetAnalysis.load(SAMPLE)
        model, rep = apply_plan(RulesProvider().plan("punchy bold captions under 45s for tiktok"), a)
        h = render_html("punchy bold captions under 45s for tiktok", model, rep, a.duration, "ffmpeg ...")
        self.assertIn("<!doctype html>", h)
        self.assertIn("VibeCut", h)
        self.assertIn("class=\"timeline\"", h)
        self.assertIn("class=\"seg kept\"", h)      # a kept segment is drawn
        self.assertIn("Edit plan", h)
        self.assertIn("Captions preview", h)


class TestPersistence(unittest.TestCase):
    def test_roundtrip(self):
        a = AssetAnalysis.load(SAMPLE)
        model, _ = apply_plan(RulesProvider().plan("punchy bold captions for tiktok under 50s"), a)
        model.video_track().clips[1].locked = True
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "project.json")
            model.save(path)
            back = EditModel.load(path)
        self.assertAlmostEqual(back.total_duration(), model.total_duration(), places=3)
        self.assertEqual(len(back.video_track().clips), len(model.video_track().clips))
        self.assertTrue(back.video_track().clips[1].locked)
        self.assertEqual(len(back.captions.events), len(model.captions.events))
        self.assertEqual(back.profile.width, model.profile.width)


if __name__ == "__main__":
    unittest.main(verbosity=2)

/* VibeCut browser engine — a faithful JS port of vibecut-core's logic so the
 * whole vibe -> plan -> edit -> preview loop runs entirely in the browser
 * (no server, no install, no APIs). Pure functions; no DOM here.
 * Mirrors: ranges.py, vibe.py (RulesProvider), engine.py, render.py, report.py.
 */
(function (root) {
  "use strict";
  var EPS = 1e-6, MIN_SEG = 0.30, BRIDGE = 0.25;

  function norm(s) { return s.toLowerCase().replace(/[^a-z' ]/g, "").trim(); }

  function subtract(keep, cut) {
    var s = cut[0], e = cut[1], out = [];
    keep.forEach(function (r) {
      var a = r[0], b = r[1];
      if (e <= a || s >= b) { out.push([a, b]); return; }
      if (a < s) out.push([a, s]);
      if (e < b) out.push([e, b]);
    });
    return out.filter(function (r) { return r[1] - r[0] > EPS; });
  }
  function complement(segs, lo, hi) {
    var gaps = [], cur = lo;
    segs.slice().sort(function (x, y) { return x[0] - y[0]; }).forEach(function (r) {
      var a = Math.max(r[0], lo), b = Math.min(r[1], hi);
      if (a > cur) gaps.push([cur, a]);
      cur = Math.max(cur, b);
    });
    if (cur < hi) gaps.push([cur, hi]);
    return gaps;
  }
  function bridge(ranges, maxGap) {
    if (!ranges.length) return ranges;
    var o = [ranges[0].slice()];
    for (var i = 1; i < ranges.length; i++) {
      var a = ranges[i][0], b = ranges[i][1], last = o[o.length - 1];
      if (a - last[1] < maxGap) last[1] = Math.max(last[1], b); else o.push([a, b]);
    }
    return o;
  }
  function KeepList(dur) { this.ranges = [[0, dur]]; }
  KeepList.prototype.cut = function (rng) {
    var nw = [];
    this.ranges.forEach(function (r) { nw = nw.concat(subtract([r], rng)); });
    this.ranges = nw.sort(function (x, y) { return x[0] - y[0]; });
  };
  KeepList.prototype.total = function () {
    return this.ranges.reduce(function (s, r) { return s + (r[1] - r[0]); }, 0);
  };
  KeepList.prototype.contains = function (t) {
    return this.ranges.some(function (r) { return r[0] - EPS <= t && t <= r[1] + EPS; });
  };
  KeepList.prototype.mapTL = function (t) {
    var off = 0;
    for (var i = 0; i < this.ranges.length; i++) {
      var a = this.ranges[i][0], b = this.ranges[i][1];
      if (t < a - EPS) return null;
      if (t <= b + EPS) return off + (t - a);
      off += b - a;
    }
    return null;
  };

  var FILLERS = ["um", "uh", "er", "ah", "like", "you know"];
  var FREQ = { high: 0.55, medium: 0.7, low: 0.82 };
  var DIMS = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350] };

  function findDuration(t) {
    var m = t.match(/(?:under|below|max|to)?\s*(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds|m|min|mins|minutes)\b/);
    if (!m) return null;
    var v = parseFloat(m[1]);
    return m[2][0] === "m" ? v * 60 : v;
  }

  // ---- RulesProvider.plan ----
  function planFromText(text, toggles) {
    var t = (text || "").toLowerCase();
    toggles = toggles || {};
    var ops = {}, aspect = "16:9";
    function set(op, p) { ops[op] = Object.assign(ops[op] || {}, p || {}); }
    ["cut_silence", "remove_fillers", "add_captions", "normalize_loudness"].forEach(function (o) { ops[o] = ops[o] || {}; });

    if (/caption|subtitle|text on screen/.test(t)) ops.add_captions = ops.add_captions || {};
    if (/bold|karaoke|word by word|word-by-word/.test(t)) set("add_captions", { style: "bold-karaoke" });
    else if (/hype|punchy/.test(t)) set("add_captions", { style: "hype" });

    if (/punchy|punch|zoom|energetic|dynamic/.test(t)) set("punch_in", { frequency: "high", max_scale: 1.3 });
    if (/calm|subtle|relaxed|gentle|minimal/.test(t)) set("punch_in", { frequency: "low", max_scale: 1.12 });

    if (/dead air|silence|pauses|tighten/.test(t)) set("cut_silence", { min_duration_s: 0.35 });
    if (/aggressive|fast paced|fast-paced/.test(t)) set("cut_silence", { min_duration_s: 0.25 });

    if (/vertical|9:16|reels|tiktok|shorts|story/.test(t)) { set("auto_reframe", { target_aspect: "9:16" }); aspect = "9:16"; }
    else if (/square|1:1/.test(t)) { set("auto_reframe", { target_aspect: "1:1" }); aspect = "1:1"; }
    else if (/4:5|portrait/.test(t)) { set("auto_reframe", { target_aspect: "4:5" }); aspect = "4:5"; }

    if (/b-roll|broll|b roll|cutaway|cutaways|add visuals|stock footage/.test(t)) ops.suggest_broll = ops.suggest_broll || {};
    if (/enhance|clean audio|denoise|noise|clarity/.test(t)) ops.enhance_speech = ops.enhance_speech || {};

    var dur = findDuration(t);
    if (dur != null) (ops.target_duration = ops.target_duration || {}).max_seconds = dur;

    // authoritative UI toggles
    function tog(name, op, on, asp) {
      var v = toggles[name];
      if (v === true) { ops[op] = ops[op] || (on || {}); if (asp) aspect = asp; }
      else if (v === false) { delete ops[op]; if (asp) aspect = "16:9"; }
    }
    tog("zooms", "punch_in", { frequency: "high", max_scale: 1.3 });
    tog("captions", "add_captions");
    tog("broll", "suggest_broll");
    tog("reframe", "auto_reframe", null, "9:16");
    if (toggles.reframe === true) ops.auto_reframe = ops.auto_reframe || { target_aspect: "9:16" };
    tog("enhance", "enhance_speech");

    return { aspect: aspect, target: dur, ops: ops };
  }

  // ---- engine ----
  function phrases(words, pause) {
    pause = pause || 0.6;
    var out = [], cur = [];
    words.slice().sort(function (a, b) { return a.start - b.start; }).forEach(function (w) {
      if (cur.length && (w.start - (cur[cur.length - 1].start + cur[cur.length - 1].dur)) > pause) { out.push(cur); cur = []; }
      cur.push(w);
    });
    if (cur.length) out.push(cur);
    return out.map(function (ws) {
      var emph = ws.reduce(function (s, w) { return s + (w.emphasis || 0); }, 0) / ws.length;
      return { start: ws[0].start, end: ws[ws.length - 1].start + ws[ws.length - 1].dur, emphasis: emph };
    });
  }

  function edit(analysis, plan, library) {
    var keep = new KeepList(analysis.duration);
    var words = analysis.words.map(function (w) {
      return { text: w.text, start: w.start, dur: w.dur, emphasis: w.emphasis || 0,
               mid: w.start + w.dur / 2, end: w.start + w.dur };
    });
    var P = plan.ops, report = { original: analysis.duration, ops: [] };

    if (P.cut_silence) {
      var md = P.cut_silence.min_duration_s != null ? P.cut_silence.min_duration_s : 0.5;
      var pad = P.cut_silence.padding_s != null ? P.cut_silence.padding_s : 0.12, n = 0;
      complement(analysis.speech, 0, analysis.duration).forEach(function (g) {
        if (g[1] - g[0] > md) { var cs = g[0] + pad, ce = g[1] - pad; if (ce > cs) { keep.cut([cs, ce]); n++; } }
      });
      report.ops.push(["cut_silence", n + " cut"]);
    }
    if (P.remove_fillers) {
      var lex = {}; (P.remove_fillers.lexicon || FILLERS).forEach(function (f) { lex[norm(f)] = 1; });
      var nf = 0;
      words.forEach(function (w) { if (lex[norm(w.text)] && keep.contains(w.mid)) { keep.cut([w.start, w.end]); nf++; } });
      report.ops.push(["remove_fillers", nf + " cut"]);
    }
    var target = (P.target_duration && P.target_duration.max_seconds) || plan.target || null;
    if (target != null && keep.total() > target) {
      // phrases are built from SURVIVING words, so removed fillers/silences
      // split them into finer phrases (matches engine.py, avoids overshoot)
      var survivors = words.filter(function (w) { return keep.contains(w.mid); });
      var ph = phrases(survivors)
        .sort(function (a, b) { return (a.emphasis - b.emphasis) || ((a.end - a.start) - (b.end - b.start)); });
      var tp = 0;
      for (var i = 0; i < ph.length && keep.total() > target; i++) { keep.cut([ph[i].start, ph[i].end]); tp++; }
      report.ops.push(["target_duration", "to " + target + "s (" + tp + " phrases)"]);
    } else if (target != null) {
      report.ops.push(["target_duration", "to " + target + "s"]);
    }

    keep.ranges = bridge(keep.ranges, BRIDGE).filter(function (r) { return r[1] - r[0] >= MIN_SEG; });

    var clips = keep.ranges.map(function (r) { return { src_in: r[0], src_out: r[1], locked: false }; });
    var profile = { width: 1920, height: 1080 };
    var model = { profile: profile, clips: clips, broll: [], notes: [],
                  captions: { style: "minimal", highlight: "#FFE000", events: [] } };

    if (P.add_captions) {
      var style = P.add_captions.style || "minimal", maxw = 4;
      var events = [], line = [];
      function flush() { if (line.length) { events.push({ start: line[0].t, words: line.slice() }); line = []; } }
      words.filter(function (w) { return keep.contains(w.mid); }).forEach(function (w) {
        var tt = keep.mapTL(w.start); if (tt == null) return;
        line.push({ w: w.text, t: tt, d: w.dur }); if (line.length >= maxw) flush();
      });
      flush();
      model.captions = { style: style, highlight: "#FFE000", events: events };
      report.ops.push(["add_captions", events.length + " events"]);
    }
    if (P.punch_in) {
      var thr = FREQ[P.punch_in.frequency || "medium"], last = -1e9, z = 0;
      words.filter(function (w) { return keep.contains(w.mid); }).forEach(function (w) {
        if (w.emphasis < thr) return; var tt = keep.mapTL(w.start);
        if (tt == null || tt - last < 2.0) return; last = tt; z++;
      });
      model.zooms = z; report.ops.push(["punch_in", z + " zooms"]);
    }
    if (P.suggest_broll) {
      if (!library || !library.length) { model.notes.push("No media library provided."); }
      else {
        var lastb = -1e9;
        words.filter(function (w) { return keep.contains(w.mid); }).forEach(function (w) {
          var tt = keep.mapTL(w.start); if (tt == null || tt - lastb < 5.0) return;
          var word = norm(w.text);
          var m = library.find(function (it) { return (it.tags || []).map(norm).indexOf(word) >= 0; });
          if (m) { model.broll.push({ asset_id: m.id, timeline_start: tt, matched: word }); lastb = tt; }
        });
        report.ops.push(["suggest_broll", model.broll.length + " clips"]);
      }
    }
    if (P.auto_reframe) {
      var d = DIMS[P.auto_reframe.target_aspect || "9:16"];
      model.profile = { width: d[0], height: d[1] };
      report.ops.push(["auto_reframe", P.auto_reframe.target_aspect || "9:16"]);
      model.notes.push("Reframe pan/zoom is generated in-app from subject tracking.");
    }
    if (P.normalize_loudness) report.ops.push(["normalize_loudness", "-16 LUFS"]);
    if (P.enhance_speech) report.ops.push(["enhance_speech", "on"]);

    report.final = clips.reduce(function (s, c) { return s + (c.src_out - c.src_in); }, 0);
    return { model: model, report: report };
  }

  function ffmpeg(model, src, enc) {
    enc = enc || "h264_videotoolbox";
    var parts = [];
    model.clips.forEach(function (c, i) {
      parts.push("[0:v]trim=start=" + c.src_in.toFixed(3) + ":end=" + c.src_out.toFixed(3) + ",setpts=PTS-STARTPTS[v" + i + "]");
    });
    model.clips.forEach(function (c, i) {
      parts.push("[0:a]atrim=start=" + c.src_in.toFixed(3) + ":end=" + c.src_out.toFixed(3) + ",asetpts=PTS-STARTPTS[a" + i + "]");
    });
    var cc = model.clips.map(function (_, i) { return "[v" + i + "][a" + i + "]"; }).join("");
    parts.push(cc + "concat=n=" + model.clips.length + ":v=1:a=1[vc][ac]");
    parts.push("[ac]loudnorm=I=-16:TP=-1.5:LRA=11[aout]");
    parts.push("[vc]ass=captions.ass[vout]");
    return 'ffmpeg -i "' + src + '" -filter_complex "' + parts.join(";") +
           '" -map "[vout]" -map "[aout]" -c:v ' + enc + ' -b:v 12M -c:a aac -b:a 192k "out.mp4"';
  }

  root.VibeCut = { planFromText: planFromText, edit: edit, ffmpeg: ffmpeg,
                   KeepList: KeepList, subtract: subtract, complement: complement };
  if (typeof module !== "undefined" && module.exports) module.exports = root.VibeCut;
})(typeof globalThis !== "undefined" ? globalThis : this);

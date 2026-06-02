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
  function subtractAll(rng, holes) {
    var pieces = [rng];
    holes.forEach(function (h) {
      var nx = []; pieces.forEach(function (p) { nx = nx.concat(subtract([p], h)); }); pieces = nx;
    });
    return pieces;
  }
  function splitAt(ranges, points) {
    var out = [];
    ranges.forEach(function (r) {
      var cuts = points.filter(function (p) { return r[0] + EPS < p && p < r[1] - EPS; })
                       .sort(function (x, y) { return x - y; });
      var prev = r[0];
      cuts.forEach(function (p) { out.push([prev, p]); prev = p; });
      out.push([prev, r[1]]);
    });
    return out;
  }
  function protectedAt(t, protect) {
    return protect.some(function (p) { return p[0] <= t && t <= p[1]; });
  }
  function safeCut(keep, rng, protect) {
    (protect.length ? subtractAll(rng, protect) : [rng]).forEach(function (p) { keep.cut(p); });
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
    if (/enhance|clean.{0,6}audio|denoise|noise|clarity/.test(t)) ops.enhance_speech = ops.enhance_speech || {};

    // color grade / look
    if (/warm/.test(t)) set("color_look", { look: "warm" });
    else if (/cool|moody/.test(t)) set("color_look", { look: "cool" });
    else if (/black and white|b&w|grayscale|monochrome/.test(t)) set("color_look", { look: "bw" });
    else if (/vivid|saturated|vibrant/.test(t)) set("color_look", { look: "vivid" });
    else if (/film|cinematic|vintage|filmic/.test(t)) set("color_look", { look: "film" });
    else if (/bright/.test(t)) set("color_look", { look: "bright" });
    // transitions
    if (/crossfade|cross dissolve|dissolve/.test(t)) ops.transitions = { style: "dissolve" };
    else if (/fade|cinematic/.test(t)) ops.transitions = { style: "fade" };
    // caption tweaks
    if (/uppercase|all caps|all-caps/.test(t)) set("add_captions", { uppercase: true });
    if (/neon/.test(t)) set("add_captions", { style: "neon" });
    // speed / time-remap
    if (/slow motion|slow-mo|slomo|slo-mo|slow it down/.test(t)) ops.speed = { factor: 0.5 };
    else if (/double speed|2x|twice as fast/.test(t)) ops.speed = { factor: 2.0 };
    else if (/speed up|speed it up|sped up|faster|fast paced/.test(t)) ops.speed = { factor: 1.5 };

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
    // value toggles from Studio controls
    if (toggles.look && toggles.look !== "none") set("color_look", { look: toggles.look });
    else if (toggles.look === "none") delete ops.color_look;
    if (toggles.transition === true) ops.transitions = ops.transitions || { style: "fade" };
    else if (toggles.transition === false) delete ops.transitions;
    if (toggles.capStyle) set("add_captions", { style: toggles.capStyle });
    if (toggles.upper === true) set("add_captions", { uppercase: true });
    if (toggles.speed && +toggles.speed !== 1) ops.speed = { factor: +toggles.speed };
    else if (+toggles.speed === 1) delete ops.speed;

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

  function edit(analysis, plan, library, prev) {
    var keep = new KeepList(analysis.duration);
    var words = analysis.words.map(function (w) {
      return { text: w.text, start: w.start, dur: w.dur, emphasis: w.emphasis || 0,
               mid: w.start + w.dur / 2, end: w.start + w.dur };
    });
    var P = plan.ops, report = { original: analysis.duration, ops: [], revibe: !!prev };

    // re-vibe: protect source ranges covered by LOCKED clips (Spec §3)
    var locked = prev ? prev.clips.filter(function (c) { return c.locked; }) : [];
    var protect = locked.map(function (c) { return [c.src_in, c.src_out]; });
    if (locked.length) report.ops.push(["protect_locked", locked.length + " clips"]);

    if (P.cut_silence) {
      var md = P.cut_silence.min_duration_s != null ? P.cut_silence.min_duration_s : 0.5;
      var pad = P.cut_silence.padding_s != null ? P.cut_silence.padding_s : 0.12, n = 0;
      complement(analysis.speech, 0, analysis.duration).forEach(function (g) {
        if (g[1] - g[0] > md) { var cs = g[0] + pad, ce = g[1] - pad; if (ce > cs) { safeCut(keep, [cs, ce], protect); n++; } }
      });
      report.ops.push(["cut_silence", n + " cut"]);
    }
    if (P.remove_fillers) {
      var lex = {}; (P.remove_fillers.lexicon || FILLERS).forEach(function (f) { lex[norm(f)] = 1; });
      var nf = 0;
      words.forEach(function (w) {
        if (lex[norm(w.text)] && keep.contains(w.mid) && !protectedAt(w.mid, protect)) { keep.cut([w.start, w.end]); nf++; }
      });
      report.ops.push(["remove_fillers", nf + " cut"]);
    }
    var target = (P.target_duration && P.target_duration.max_seconds) || plan.target || null;
    if (target != null && keep.total() > target) {
      var survivors = words.filter(function (w) { return keep.contains(w.mid) && !protectedAt(w.mid, protect); });
      var ph = phrases(survivors)
        .sort(function (a, b) { return (a.emphasis - b.emphasis) || ((a.end - a.start) - (b.end - b.start)); });
      var tp = 0;
      for (var i = 0; i < ph.length && keep.total() > target; i++) { keep.cut([ph[i].start, ph[i].end]); tp++; }
      report.ops.push(["target_duration", "to " + target + "s (" + tp + " phrases)"]);
    } else if (target != null) {
      report.ops.push(["target_duration", "to " + target + "s"]);
    }

    keep.ranges = bridge(keep.ranges, BRIDGE).filter(function (r) {
      return r[1] - r[0] >= MIN_SEG || protectedAt((r[0] + r[1]) / 2, protect);
    });
    if (protect.length) {
      var pts = []; protect.forEach(function (p) { pts.push(p[0], p[1]); });
      keep.ranges = splitAt(keep.ranges, pts);
    }

    // build clips with timeline positions; carry over locked hand-edits
    var off = 0, clips = [];
    keep.ranges.forEach(function (r) {
      var lk = locked.find(function (c) { return Math.abs(c.src_in - r[0]) < 1e-3 && Math.abs(c.src_out - r[1]) < 1e-3; });
      clips.push({ src_in: r[0], src_out: r[1], timeline_start: off, locked: !!lk });
      off += r[1] - r[0];
    });
    var model = { profile: { width: 1920, height: 1080 }, clips: clips, broll: [], notes: [],
                  titles: [], speed: 1, enhance: false, zoomKeyframes: [],
                  captions: { style: "minimal", highlight: "#FFE000", events: [] } };

    decorate(model, analysis, P, library, protect, report);
    if (P.normalize_loudness) report.ops.push(["normalize_loudness", "-16 LUFS"]);
    if (P.enhance_speech) report.ops.push(["enhance_speech", "on"]);

    report.final = clips.reduce(function (s, c) { return s + (c.src_out - c.src_in); }, 0);
    return { model: model, report: report };
  }

  // (re)compute captions, punch-in zooms, b-roll, reframe from model.clips.
  // Called by edit() and again after manual edits (delete) so the preview stays
  // consistent. Idempotent: resets these fields each call.
  function decorate(model, analysis, P, library, protect, report) {
    protect = protect || [];
    var clips = model.clips;
    var words = analysis.words.map(function (w) {
      return { text: w.text, start: w.start, dur: w.dur, emphasis: w.emphasis || 0, mid: w.start + w.dur / 2, end: w.start + w.dur };
    });
    function mapTL(t) {
      for (var k = 0; k < clips.length; k++) {
        var c = clips[k];
        if (t < c.src_in - EPS) return null;
        if (t <= c.src_out + EPS) return c.timeline_start + (t - c.src_in);
      }
      return null;
    }
    function survivor(w) { return clips.some(function (c) { return c.src_in - EPS <= w.mid && w.mid <= c.src_out + EPS; }); }
    function push(op, info) { if (report) report.ops.push([op, info]); }

    model.captions = { style: "minimal", highlight: "#FFE000", events: [], uppercase: false, font: "Arial" };
    model.zoomKeyframes = []; model.broll = []; model.colorLook = null; model.transition = null;

    if (P.add_captions) {
      var style = P.add_captions.style || "minimal", maxw = 4, events = [], line = [];
      function flush() { if (line.length) { events.push({ start: line[0].t, end: line[line.length - 1].t + line[line.length - 1].d, words: line.slice() }); line = []; } }
      words.filter(survivor).forEach(function (w) {
        var tt = mapTL(w.start); if (tt == null) return;
        line.push({ w: w.text, t: tt, st: w.start, d: w.dur }); if (line.length >= maxw) flush();
      });
      flush();
      model.captions = { style: style, highlight: "#FFE000", events: events,
                         uppercase: !!P.add_captions.uppercase, font: P.add_captions.font || "Arial" };
      push("add_captions", events.length + " events");
    }
    if (P.punch_in) {
      var thr = FREQ[P.punch_in.frequency || "medium"], maxs = P.punch_in.max_scale || 1.25, last = -1e9;
      words.filter(survivor).forEach(function (w) {
        if (w.emphasis < thr || protectedAt(w.mid, protect)) return;
        var tt = mapTL(w.start); if (tt == null || tt - last < 2.0) return;
        model.zoomKeyframes.push({ a: tt, b: tt + 0.15, c: tt + Math.max(0.3, w.dur), max: maxs });
        last = tt;
      });
      push("punch_in", model.zoomKeyframes.length + " zooms");
    }
    if (P.suggest_broll) {
      if (!library || !library.length) { model.notes.push("No media library provided."); }
      else {
        var lastb = -1e9;
        words.filter(survivor).forEach(function (w) {
          var tt = mapTL(w.start); if (tt == null || tt - lastb < 5.0) return;
          var word = norm(w.text);
          var m = library.find(function (it) { return (it.tags || []).map(norm).indexOf(word) >= 0; });
          if (m) { model.broll.push({ asset_id: m.id, url: m.url || "", dur: Math.min(2.0, m.duration || 2.0), timeline_start: tt, matched: word }); lastb = tt; }
        });
        push("suggest_broll", model.broll.length + " clips");
      }
    }
    if (P.auto_reframe) {
      var d = DIMS[P.auto_reframe.target_aspect || "9:16"];
      model.profile = { width: d[0], height: d[1] };
      push("auto_reframe", P.auto_reframe.target_aspect || "9:16");
    }
    if (P.color_look) { model.colorLook = P.color_look.look || "warm"; push("color_look", model.colorLook); }
    if (P.transitions) { model.transition = P.transitions.style || "fade"; push("transitions", model.transition); }
    model.speed = P.speed ? (P.speed.factor || 1) : 1;
    model.enhance = !!P.enhance_speech;
    if (P.speed) push("speed", model.speed + "x");
  }

  var LOOK_FILTERS = {
    warm: "eq=gamma_r=1.06:gamma_b=0.94:saturation=1.06", cool: "eq=gamma_b=1.06:gamma_r=0.95:saturation=1.03",
    vivid: "eq=saturation=1.4:contrast=1.1", bw: "hue=s=0,eq=contrast=1.08",
    film: "curves=preset=medium_contrast,eq=saturation=0.92", bright: "eq=brightness=0.06:contrast=1.05"
  };
  var LOOK_CSS = {
    warm: "saturate(1.1) sepia(.12)", cool: "saturate(1.05) hue-rotate(-8deg) brightness(1.02)",
    vivid: "saturate(1.5) contrast(1.1)", bw: "grayscale(1) contrast(1.08)",
    film: "sepia(.18) saturate(.92) contrast(1.05)", bright: "brightness(1.08) contrast(1.05)"
  };

  function splitClip(model, i, atTimeline) {
    var c = model.clips[i], dur = c.src_out - c.src_in;
    var cut = (atTimeline != null) ? c.src_in + (atTimeline - c.timeline_start) : c.src_in + dur / 2;
    cut = Math.max(c.src_in + 0.05, Math.min(c.src_out - 0.05, cut));
    var b = { src_in: cut, src_out: c.src_out, timeline_start: 0, locked: c.locked };
    c.src_out = cut; model.clips.splice(i + 1, 0, b); relayout(model);
  }
  function trimClip(model, i, side, delta) {
    var c = model.clips[i];
    if (side === "in") c.src_in = Math.max(0, Math.min(c.src_out - 0.1, c.src_in + delta));
    else c.src_out = Math.max(c.src_in + 0.1, c.src_out + delta);
    relayout(model);
  }

  // recompute timeline_start after manual edits (delete/reorder)
  function relayout(model) {
    var off = 0;
    model.clips.forEach(function (c) { c.timeline_start = off; off += c.src_out - c.src_in; });
    return off;
  }
  function zoomScaleAt(model, tl) {  // live punch-in scale at timeline time tl
    var z = 1.0;
    (model.zoomKeyframes || []).forEach(function (k) {
      if (tl >= k.a && tl <= k.b) z = Math.max(z, 1 + (k.max - 1) * (tl - k.a) / (k.b - k.a));
      else if (tl > k.b && tl <= k.c) z = Math.max(z, 1 + (k.max - 1) * (k.c - tl) / (k.c - k.b));
    });
    return z;
  }
  // build analysis from an .srt (no audio): words spread per cue, default emphasis
  function analysisFromSRT(srt, sourceUrl) {
    var blocks = srt.replace(/\r/g, "").trim().split(/\n\s*\n/);
    var re = /(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/;
    var KEY = { important:1, biggest:1, mistake:1, never:1, always:1, best:1, secret:1, free:1, now:1, today:1 };
    var words = [], end = 0;
    blocks.forEach(function (b) {
      var m = b.match(re); if (!m) return;
      var g = m.slice(1).map(Number);
      var s = g[0]*3600+g[1]*60+g[2]+g[3]/1000, e = g[4]*3600+g[5]*60+g[6]+g[7]/1000;
      var toks = b.split("\n").slice(2).join(" ").trim().split(/\s+/).filter(Boolean);
      if (!toks.length) return;
      var span = (e - s) / toks.length;
      toks.forEach(function (tok, i) {
        words.push({ text: tok, start: +(s + i*span).toFixed(3), dur: +span.toFixed(3),
                     emphasis: KEY[norm(tok)] ? 0.75 : 0.4 });
      });
      end = Math.max(end, e);
    });
    return { asset_id: "a1", source_url: sourceUrl || "clip.mp4", duration: +end.toFixed(3),
             words: words, speech: words.map(function (w) { return [w.start, w.start + w.dur]; }), scenes: [] };
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
    var af = ["loudnorm=I=-16:TP=-1.5:LRA=11"];
    if (model.enhance) af.push("afftdn=nf=-25,highpass=f=90,lowpass=f=12000");
    var sp = model.speed || 1;
    if (Math.abs(sp - 1) > 1e-3) { var f = sp; while (f > 2) { af.push("atempo=2.0"); f /= 2; } while (f < 0.5) { af.push("atempo=0.5"); f *= 2; } af.push("atempo=" + f.toFixed(3)); }
    parts.push("[ac]" + af.join(",") + "[aout]");
    var vl = "vc";
    if (model.colorLook && LOOK_FILTERS[model.colorLook]) { parts.push("[" + vl + "]" + LOOK_FILTERS[model.colorLook] + "[vcol]"); vl = "vcol"; }
    parts.push("[" + vl + "]ass=captions.ass[vcap]"); vl = "vcap";
    if (model.transition) {
      var total = model.clips.reduce(function (s, c) { return s + (c.src_out - c.src_in); }, 0);
      var d = 0.4, st = Math.max(0, total - d);
      parts.push("[" + vl + "]fade=t=in:st=0:d=" + d + ",fade=t=out:st=" + st.toFixed(3) + ":d=" + d + "[vtr]"); vl = "vtr";
    }
    if (Math.abs(sp - 1) > 1e-3) parts.push("[" + vl + "]setpts=PTS/" + sp.toFixed(4) + "[vout]");
    else parts.push("[" + vl + "]null[vout]");
    return 'ffmpeg -i "' + src + '" -filter_complex "' + parts.join(";") +
           '" -map "[vout]" -map "[aout]" -c:v ' + enc + ' -b:v 12M -c:a aac -b:a 192k "out.mp4"';
  }

  root.VibeCut = { planFromText: planFromText, edit: edit, decorate: decorate, ffmpeg: ffmpeg,
                   relayout: relayout, zoomScaleAt: zoomScaleAt, analysisFromSRT: analysisFromSRT,
                   splitClip: splitClip, trimClip: trimClip, LOOK_CSS: LOOK_CSS,
                   KeepList: KeepList, subtract: subtract, complement: complement };
  if (typeof module !== "undefined" && module.exports) module.exports = root.VibeCut;
})(typeof globalThis !== "undefined" ? globalThis : this);

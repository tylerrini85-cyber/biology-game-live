"""Build a single self-contained index.html (engine + data + UI inlined).

Run:  python3 build.py        # writes index.html next to this script
The output is one portable file: double-click it, or host it on any static
host (GitHub Pages, Netlify drop, etc.). No server, no install, no APIs.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
CORE = os.path.normpath(os.path.join(HERE, "..", "vibecut-core", "samples"))

CSS = """
  :root{--bg:#0f1115;--card:#171a21;--line:#262b36;--txt:#e6e9ef;--muted:#8b93a7;
        --kept:#37d399;--cut:#2a2f3a;--lock:#ffcf3a;--accent:#7aa2ff;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--txt);
       font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
  .wrap{max-width:880px;margin:0 auto;padding:28px 20px 64px}
  h1{font-size:22px;margin:0 0 4px}.logo{color:var(--accent)}
  .sub{color:var(--muted);font-size:13px;margin:0 0 16px}
  .prompt{background:var(--card);border:1px solid var(--line);border-radius:12px;
          padding:14px 16px;margin:16px 0;font-style:italic}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;margin:14px 0}
  .label{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px}
  .timeline{position:relative;height:34px;background:var(--cut);border-radius:7px;overflow:hidden}
  .seg{position:absolute;top:0;height:100%}.seg.kept{background:var(--kept)}.seg.locked{background:var(--lock)}
  .scale{display:flex;justify-content:space-between;color:var(--muted);font-size:12px;margin-top:6px}
  .stats{display:flex;flex-wrap:wrap;gap:18px;margin-top:14px}
  .stat b{font-size:20px}.stat span{color:var(--muted);font-size:12px;display:block}
  .chip{display:inline-block;background:#1e2430;border:1px solid var(--line);color:var(--accent);
        border-radius:999px;padding:4px 11px;margin:3px 4px 0 0;font-size:12.5px}
  .cap{padding:6px 0;border-bottom:1px solid var(--line)}.cap .t{color:var(--muted);font-size:12px;margin-right:8px}
  .muted{color:var(--muted);font-size:13px;padding-top:8px}
  details{margin-top:8px}summary{cursor:pointer;color:var(--muted)}
  pre{white-space:pre-wrap;word-break:break-all;background:#0b0d12;border:1px solid var(--line);
      border-radius:10px;padding:14px;font-size:12px}
  .foot{color:var(--muted);font-size:12px;margin-top:24px}
  form.vibe{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px}
  form.vibe input[type=text],form.vibe select{width:100%;background:#0b0d12;border:1px solid var(--line);
      color:var(--txt);border-radius:9px;padding:11px 12px;font-size:15px}
  .toggles{display:flex;gap:14px;flex-wrap:wrap;margin-top:14px;color:var(--muted);font-size:14px}
  .toggles label{display:flex;gap:6px;align-items:center;cursor:pointer}
  button{margin-top:16px;background:var(--accent);color:#0b0d12;border:0;border-radius:10px;
         padding:11px 22px;font-size:15px;font-weight:700;cursor:pointer}
  .examples{margin-top:12px;font-size:13px;color:var(--muted)}
  .examples a{color:var(--accent);cursor:pointer;margin-right:12px;text-decoration:none}
"""

UI = """
  var A = ANALYSES, LIB = LIBRARY;
  var qs = function (s) { return document.querySelector(s); };
  var OPTS = [["captions","Captions"],["zooms","Auto-zoom"],["broll","B-roll"],
              ["reframe","Vertical reframe"],["enhance","Enhance audio"]];
  function esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML;}

  function go() {
    var prompt = qs('#prompt').value;
    var toggles = {};
    OPTS.forEach(function (o) { toggles[o[0]] = qs('#t_' + o[0]).checked; });
    var key = qs('#analysis').value, a = A[key];
    var plan = VibeCut.planFromText(prompt, toggles);
    var r = VibeCut.edit(a, plan, LIB);
    qs('#result').innerHTML = renderResult(prompt, r.model, r.report, a);
    qs('#result').scrollIntoView({behavior:'smooth', block:'start'});
  }

  function renderResult(prompt, model, report, a) {
    var W = 1.0 * a.duration;
    var segs = model.clips.map(function (c) {
      var cls = c.locked ? 'locked' : 'kept';
      return '<div class="seg '+cls+'" style="left:'+(100*c.src_in/W)+'%;width:'+(100*(c.src_out-c.src_in)/W)+'%"></div>';
    }).join('');
    var chips = report.ops.map(function (o) { return '<span class="chip">'+o[0]+'</span>'; }).join('');
    var weight = (model.captions.style==='bold-karaoke'||model.captions.style==='hype')?800:500;
    var caps = model.captions.events.slice(0,8).map(function (ev) {
      var ws = ev.words.map(function (w,i) {
        var col = i===0 ? ('color:'+model.captions.highlight+';') : '';
        return '<span style="font-weight:'+weight+';'+col+'">'+esc(w.w)+'</span>';
      }).join(' ');
      return '<div class="cap"><span class="t">'+ev.start.toFixed(1)+'s</span> '+ws+'</div>';
    }).join('');
    if (model.captions.events.length>8) caps += '<div class="muted">+'+(model.captions.events.length-8)+' more...</div>';
    var ff = VibeCut.ffmpeg(model, a.source_url || 'clip.mov');
    var pct = report.original ? (100*report.final/report.original) : 0;
    var notes = model.notes.map(function(n){return '<div class="muted">note: '+esc(n)+'</div>';}).join('');
    return ''
      + '<div class="prompt">“'+esc(prompt)+'”</div>'
      + '<div class="card"><div class="label">Timeline · original footage (green kept, dark cut)</div>'
      +   '<div class="timeline">'+segs+'</div>'
      +   '<div class="scale"><span>0s</span><span>'+report.original.toFixed(0)+'s</span></div>'
      +   '<div class="stats">'
      +     '<div class="stat"><b>'+report.original.toFixed(0)+'s</b><span>original</span></div>'
      +     '<div class="stat"><b>'+report.final.toFixed(0)+'s</b><span>final ('+pct.toFixed(0)+'%)</span></div>'
      +     '<div class="stat"><b>'+model.clips.length+'</b><span>clips</span></div>'
      +     '<div class="stat"><b>'+model.captions.events.length+'</b><span>captions</span></div>'
      +     '<div class="stat"><b>'+model.broll.length+'</b><span>b-roll</span></div>'
      +     '<div class="stat"><b>'+model.profile.width+'×'+model.profile.height+'</b><span>frame</span></div>'
      +   '</div></div>'
      + '<div class="card"><div class="label">Edit plan</div>'+chips+'</div>'
      + '<div class="card"><div class="label">Captions preview · style: '+esc(model.captions.style)+'</div>'+caps+notes+'</div>'
      + '<div class="card"><div class="label">Export</div>'
      +   '<details><summary>FFmpeg command (hardware encode)</summary><pre>'+esc(ff)+'</pre></details></div>';
  }

  function setExample(s){ qs('#prompt').value = s; go(); }

  function boot() {
    var sel = qs('#analysis');
    Object.keys(A).forEach(function (k) {
      var o = document.createElement('option'); o.value = k; o.textContent = A[k].label || k; sel.appendChild(o);
    });
    var box = qs('#toggles');
    OPTS.forEach(function (o) {
      var on = (o[0]==='captions'||o[0]==='zooms'||o[0]==='enhance');
      box.insertAdjacentHTML('beforeend',
        '<label><input type="checkbox" id="t_'+o[0]+'"'+(on?' checked':'')+'> '+o[1]+'</label>');
    });
    qs('#vibe').addEventListener('click', go);
    qs('#prompt').addEventListener('keydown', function(e){ if(e.key==='Enter') go(); });
    go();
  }
  if (document.readyState !== 'loading') boot();
  else window.addEventListener('DOMContentLoaded', boot);
"""

TEMPLATE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VibeCut</title><style>__CSS__</style></head>
<body><div class="wrap">
  <h1><span class="logo">&#9670; VibeCut</span> &mdash; vibe editor</h1>
  <p class="sub">Type what you want, pick effects, see the edit instantly. Runs entirely
     in your browser &mdash; no server, no install, no APIs, no video generation.</p>
  <form class="vibe" onsubmit="return false">
    <div class="label">Describe the edit you want</div>
    <input type="text" id="prompt" value="punchy, under 45 seconds, bold captions for tiktok, clean audio">
    <div style="margin-top:12px"><div class="label">Source clip</div><select id="analysis"></select></div>
    <div class="toggles" id="toggles"></div>
    <button type="button" id="vibe">Vibe it &#9654;</button>
    <div class="examples">Try:
      <a onclick="setExample('calm professional explainer, clean up dead air and umms, minimal captions')">calm explainer</a>
      <a onclick="setExample('punchy under 30s with bold karaoke captions and b-roll for tiktok')">viral short</a>
      <a onclick="setExample('tighten it up, keep it under 2 minutes')">light cleanup</a>
    </div>
  </form>
  <div id="result"></div>
  <div class="foot">VibeCut reference UI &middot; the edit decisions + preview shown here are produced
     locally; the desktop app adds live video playback &amp; final MP4 export.</div>
</div>
<script>__ENGINE__</script>
<script>
  var ANALYSES = __ANALYSES__;
  var LIBRARY = __LIBRARY__;
__UI__
</script>
</body></html>
"""


def main():
    with open(os.path.join(HERE, "vibecut.js"), encoding="utf-8") as fh:
        engine = fh.read()
    with open(os.path.join(CORE, "sample_analysis.json"), encoding="utf-8") as fh:
        sample = json.load(fh)
    sample["label"] = "Sample — 92s talking-head (with pauses & fillers)"
    with open(os.path.join(CORE, "media_library.json"), encoding="utf-8") as fh:
        library = json.load(fh)

    analyses = {"sample": sample}
    html = (TEMPLATE
            .replace("__CSS__", CSS)
            .replace("__ENGINE__", engine)
            .replace("__ANALYSES__", json.dumps(analyses))
            .replace("__LIBRARY__", json.dumps(library))
            .replace("__UI__", UI))
    out = os.path.join(HERE, "index.html")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(html)
    print(f"wrote {out} ({len(html)} bytes)")


if __name__ == "__main__":
    main()

"""Build studio.html — the interactive VibeCut editor (single self-contained file).

Load your video + captions (.srt), vibe-edit, watch the edit play back live
(cuts + captions + punch-in zoom), manually lock/delete clips, and re-vibe.
Entirely in the browser; no server, install, APIs, or video generation.

    python3 build_studio.py    # writes studio.html
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
CORE = os.path.normpath(os.path.join(HERE, "..", "vibecut-core", "samples"))

CSS = """
  :root{--bg:#0f1115;--card:#171a21;--line:#262b36;--txt:#e6e9ef;--muted:#8b93a7;
        --kept:#37d399;--cut:#2a2f3a;--lock:#ffcf3a;--accent:#7aa2ff;--danger:#ff6b6b}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--txt);font:15px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
  .wrap{max-width:960px;margin:0 auto;padding:24px 18px 80px}
  h1{font-size:21px;margin:0 0 2px}.logo{color:var(--accent)}.sub{color:var(--muted);font-size:13px;margin:0 0 16px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:12px 0}
  .label{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px}
  input[type=text]{width:100%;background:#0b0d12;border:1px solid var(--line);color:var(--txt);border-radius:9px;padding:11px 12px;font-size:15px}
  textarea{width:100%;min-height:64px;background:#0b0d12;border:1px solid var(--line);color:var(--txt);border-radius:9px;padding:10px;font:13px ui-monospace,Menlo,monospace}
  .row{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
  .toggles{display:flex;gap:14px;flex-wrap:wrap;margin-top:12px;color:var(--muted);font-size:14px}
  .toggles label{display:flex;gap:6px;align-items:center;cursor:pointer}
  button{background:var(--accent);color:#0b0d12;border:0;border-radius:9px;padding:10px 16px;font-size:14px;font-weight:700;cursor:pointer}
  button.ghost{background:#1e2430;color:var(--txt);border:1px solid var(--line)}
  button.sm{padding:3px 8px;font-size:12px;font-weight:600}
  .preview{position:relative;background:#000;border-radius:10px;overflow:hidden;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center}
  .preview.vert{aspect-ratio:9/16;max-height:520px;margin:0 auto}
  #vwrap{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;transition:transform .05s linear}
  #video{max-width:100%;max-height:100%;background:#000}
  #placeholder{color:#444;font-size:14px;text-align:center;padding:20px}
  #broll{position:absolute;inset:0;background:#101418 center/cover no-repeat;display:none;align-items:center;justify-content:center;color:var(--accent);font-weight:700}
  #caps{position:absolute;left:0;right:0;bottom:9%;text-align:center;padding:0 8%;pointer-events:none}
  #caps span{display:inline-block;margin:0 .12em;text-shadow:0 2px 6px #000,0 0 2px #000}
  #title{position:absolute;left:0;right:0;top:10%;display:none;align-items:center;justify-content:center;text-align:center;padding:0 8%;font-weight:800;color:#fff;font-size:5vw;text-shadow:0 3px 10px #000;pointer-events:none}
  .pv-controls{display:flex;gap:10px;align-items:center;margin-top:10px}
  .seg{position:absolute;top:0;height:100%}.seg.kept{background:var(--kept)}.seg.locked{background:var(--lock)}
  .timeline{position:relative;height:30px;background:var(--cut);border-radius:6px;overflow:hidden;margin-top:6px}
  #playhead{position:absolute;top:0;width:2px;height:100%;background:#fff;left:0}
  .clips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
  .clip{background:#0b0d12;border:1px solid var(--line);border-radius:8px;padding:6px 8px;font-size:12px;display:flex;gap:6px;align-items:center}
  .clip.locked{border-color:var(--lock)}
  .caprow{display:flex;gap:8px;align-items:center;padding:3px 0}
  .caprow .t{color:var(--muted);font-size:12px;min-width:42px}
  .caprow input{flex:1;background:#0b0d12;border:1px solid var(--line);color:var(--txt);border-radius:7px;padding:6px 8px;font-size:13px}
  .chip{display:inline-block;background:#1e2430;border:1px solid var(--line);color:var(--accent);border-radius:999px;padding:3px 10px;margin:3px 4px 0 0;font-size:12px}
  .stat b{font-size:18px}.stat span{color:var(--muted);font-size:12px;display:block}
  .stats{display:flex;gap:18px;flex-wrap:wrap;margin-top:6px}
  pre{white-space:pre-wrap;word-break:break-all;background:#0b0d12;border:1px solid var(--line);border-radius:9px;padding:12px;font-size:11.5px}
  .muted{color:var(--muted);font-size:13px}.foot{color:var(--muted);font-size:12px;margin-top:22px}
  a.btn{color:var(--accent);text-decoration:none;font-weight:700}
"""

UI = r"""
var A = SAMPLE, LIB = LIBRARY;
var state = { analysis: A, model: null, report: null, plan: null, hasVideo: false };
var OPTS = [["captions","Captions"],["zooms","Auto-zoom"],["broll","B-roll"],["reframe","Vertical"],["enhance","Enhance audio"]];
var $ = function(s){ return document.querySelector(s); };
function esc(s){ var d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

window.addEventListener('DOMContentLoaded', function(){
  var box=$('#toggles');
  OPTS.forEach(function(o){ var on=(o[0]==='captions'||o[0]==='zooms');
    box.insertAdjacentHTML('beforeend','<label><input type="checkbox" id="t_'+o[0]+'"'+(on?' checked':'')+'> '+o[1]+'</label>'); });
  $('#video').addEventListener('change', loadVideo);
  $('#srt').addEventListener('change', loadSRT);
  if($('#music')) $('#music').addEventListener('change', function(e){ var f=e.target.files[0]; if(f){ state.musicName=f.name; $('#mstatus').textContent='music: '+f.name; doVibe(null); } });
  $('#vibe').addEventListener('click', function(){ doVibe(null); });
  $('#revibe').addEventListener('click', function(){ doVibe(state.model); });
  $('#play').addEventListener('click', togglePlay);
  $('#dlsrt').addEventListener('click', downloadSRT);
  $('#copyff').addEventListener('click', copyFfmpeg);
  $('#undo').addEventListener('click', undo);
  $('#redo').addEventListener('click', redo);
  $('#saveproj').addEventListener('click', saveProject);
  $('#loadbtn').addEventListener('click', function(){ $('#loadproj').click(); });
  $('#loadproj').addEventListener('change', loadProject);
  ['#voicegain','#musicgain','#duckamt'].forEach(function(id){ if($(id)) $(id).addEventListener('input', audioMix); });
  ['#cb','#cc','#cs','#ct'].forEach(function(id){ if($(id)) $(id).addEventListener('input', colorAdjust); });
  if($('#lutfile')) $('#lutfile').addEventListener('change', loadLut);
  doVibe(null);  // initial edit on the sample
});

function toggles(){ var t={}; OPTS.forEach(function(o){ t[o[0]]=$('#t_'+o[0]).checked; });
  if($('#look')) t.look=$('#look').value;
  if($('#transition')) t.transition=$('#transition').value;
  if($('#audiocurve')) t.audioCurve=$('#audiocurve').value;
  if($('#capstyle')) t.capStyle=$('#capstyle').value;
  if($('#t_upper')) t.upper=$('#t_upper').checked;
  if($('#speed')) t.speed=$('#speed').value;
  return t; }

function loadVideo(e){
  var f=e.target.files[0]; if(!f) return;
  var v=$('#videoEl'); v.src=URL.createObjectURL(f); state.hasVideo=true;
  $('#placeholder').style.display='none'; v.style.display='block';
  v.addEventListener('loadedmetadata', function(){ $('#vstatus').textContent='video loaded ('+v.duration.toFixed(1)+'s)'; }, {once:true});
}
function loadSRT(e){
  var f=e.target.files[0]; if(!f) return;
  var r=new FileReader();
  r.onload=function(){ state.analysis=VibeCut.analysisFromSRT(r.result, f.name);
    $('#sstatus').textContent='captions loaded ('+state.analysis.words.length+' words, '+state.analysis.duration.toFixed(0)+'s)';
    doVibe(null); };
  r.readAsText(f);
}

function doVibe(prev){
  stopPlay();
  state.plan = VibeCut.planFromText($('#prompt').value, toggles());
  var r = VibeCut.edit(state.analysis, state.plan, LIB, prev);
  state.model=r.model; state.report=r.report;
  var tt=$('#titletext')?$('#titletext').value.trim():'';
  if(tt) state.model.titles.push({text:tt,start:0,dur:2.5,kind:'intro'});
  var lt=$('#lowerthird')?$('#lowerthird').value.trim():'';
  if(lt) state.model.titles.push({text:lt,start:1,dur:3,kind:'lower-third'});
  if(state.musicName) state.model.music={url:state.musicName,gain:0.25,duck:true};
  undoStack=[]; redoStack=[];
  applyAspect(); render();
}
function applyAspect(){
  var vert = state.model.profile.height > state.model.profile.width;
  $('#preview').classList.toggle('vert', vert);
}

function render(){
  var m=state.model, rep=state.report, W=state.analysis.duration;
  // timeline strip (source kept/cut)
  var segs=m.clips.map(function(c){ var cls=c.locked?'locked':'kept';
    return '<div class="seg '+cls+'" style="left:'+(100*c.src_in/W)+'%;width:'+(100*(c.src_out-c.src_in)/W)+'%"></div>'; }).join('');
  $('#timeline').innerHTML=segs+'<div id="playhead"></div>';
  // clip chips with lock/delete
  $('#clips').innerHTML=m.clips.map(function(c,i){
    return '<div class="clip'+(c.locked?' locked':'')+'">#'+(i+1)+' '+(c.src_out-c.src_in).toFixed(1)+'s '
      +'<button class="ghost sm" title="move left" onclick="moveClip('+i+',-1)">◀</button>'
      +'<button class="ghost sm" title="move right" onclick="moveClip('+i+',1)">▶</button>'
      +'<button class="ghost sm" title="trim start" onclick="trimC('+i+',\'in\')">[+</button>'
      +'<button class="ghost sm" title="trim end" onclick="trimC('+i+',\'out\')">+]</button>'
      +'<button class="ghost sm" title="split" onclick="splitC('+i+')">⤲</button>'
      +'<button class="ghost sm" onclick="toggleLock('+i+')">'+(c.locked?'🔒':'🔓')+'</button>'
      +'<button class="ghost sm" onclick="delClip('+i+')">✕</button></div>'; }).join('');
  // persistent color preview filter (look + manual adjustments)
  $('#vwrap').style.filter=previewFilter(m);
  // plan + stats
  $('#plan').innerHTML=rep.ops.map(function(o){return '<span class="chip">'+o[0]+'</span>';}).join('');
  var pct=rep.original?100*rep.final/rep.original:0;
  $('#stats').innerHTML=
    '<div class="stat"><b>'+rep.original.toFixed(0)+'s</b><span>original</span></div>'+
    '<div class="stat"><b>'+rep.final.toFixed(0)+'s</b><span>final ('+pct.toFixed(0)+'%)</span></div>'+
    '<div class="stat"><b>'+m.clips.length+'</b><span>clips</span></div>'+
    '<div class="stat"><b>'+m.captions.events.length+'</b><span>captions</span></div>'+
    '<div class="stat"><b>'+m.zoomKeyframes.length+'</b><span>zooms</span></div>'+
    '<div class="stat"><b>'+m.profile.width+'×'+m.profile.height+'</b><span>frame</span></div>';
  $('#ffmpeg').textContent=VibeCut.ffmpeg(m, state.analysis.source_url||'clip.mp4');
  // editable captions
  $('#capeditor').innerHTML=m.captions.events.map(function(ev,i){
    return '<div class="caprow"><span class="t">'+ev.start.toFixed(1)+'-'+ev.end.toFixed(1)+'s</span>'
      +'<button class="ghost sm" title="start -" onclick="capNudge('+i+',\'start\',-0.1)">⟨</button>'
      +'<button class="ghost sm" title="start +" onclick="capNudge('+i+',\'start\',0.1)">⟩</button>'
      +'<input type="text" value="'+escAttr(ev.words.map(function(w){return w.w;}).join(" "))
      +'" onchange="editCap('+i+',this.value)">'
      +'<button class="ghost sm" title="end -" onclick="capNudge('+i+',\'end\',-0.1)">−</button>'
      +'<button class="ghost sm" title="end +" onclick="capNudge('+i+',\'end\',0.1)">+</button></div>'; }).join('') || '<span class="muted">no captions</span>';
  updUndo();
}
function escAttr(s){ return String(s).replace(/&/g,"&amp;").replace(/"/g,"&quot;"); }
function previewFilter(m){
  var p=[];
  if(m.colorLook && VibeCut.LOOK_CSS[m.colorLook]) p.push(VibeCut.LOOK_CSS[m.colorLook]);
  if(m.color_adjust){ var ca=m.color_adjust;
    p.push("brightness("+(1+(+ca.brightness||0)).toFixed(2)+")");
    p.push("contrast("+(+ca.contrast||1).toFixed(2)+")");
    p.push("saturate("+(+ca.saturation||1).toFixed(2)+")");
    var t=+ca.temperature||0; if(t) p.push(t>0?("sepia("+(t*0.3).toFixed(2)+")"):("hue-rotate("+(t*20).toFixed(0)+"deg)")); }
  return p.length?p.join(" "):"none";
}
function colorAdjust(){ if(!state.model) return;
  state.model.color_adjust={brightness:parseFloat($('#cb').value),contrast:parseFloat($('#cc').value),saturation:parseFloat($('#cs').value),temperature:parseFloat($('#ct').value)};
  $('#vwrap').style.filter=previewFilter(state.model);
  $('#ffmpeg').textContent=VibeCut.ffmpeg(state.model, state.analysis.source_url||'clip.mp4'); }
function loadLut(e){ var f=e.target.files[0]; if(f && state.model){ state.model.lut=f.name; $('#ffmpeg').textContent=VibeCut.ffmpeg(state.model, state.analysis.source_url||'clip.mp4'); } }
function audioMix(){
  if(!state.model) return;
  state.model.voice_gain=parseFloat($('#voicegain').value);
  if(state.model.music){ state.model.music.gain=parseFloat($('#musicgain').value); state.model.music.duck_amount=parseFloat($('#duckamt').value); }
  $('#ffmpeg').textContent=VibeCut.ffmpeg(state.model, state.analysis.source_url||'clip.mp4');
}
function editCap(i, text){
  var ev=state.model.captions.events[i]; if(!ev) return;
  pushUndo();
  var toks=text.trim().split(/\s+/).filter(Boolean);
  if(!toks.length){ state.model.captions.events.splice(i,1); }
  else { var span=(ev.end-ev.start)/toks.length;
    ev.words=toks.map(function(w,j){ return {w:w, t:ev.start+j*span, d:span, st:0}; }); }
  $('#ffmpeg').textContent=VibeCut.ffmpeg(state.model, state.analysis.source_url||'clip.mp4');
}

function recount(){ state.report.final=state.model.clips.reduce(function(m,c){return Math.max(m,c.timeline_start+(c.src_out-c.src_in));},0); }
function rederive(){ VibeCut.decorate(state.model, state.analysis, state.plan.ops, LIB); recount(); render(); }
// undo/redo
var undoStack=[], redoStack=[];
function clone(o){ return JSON.parse(JSON.stringify(o)); }
function pushUndo(){ undoStack.push(clone(state.model)); if(undoStack.length>60) undoStack.shift(); redoStack=[]; updUndo(); }
function undo(){ if(!undoStack.length) return; redoStack.push(clone(state.model)); state.model=undoStack.pop(); render(); updUndo(); }
function redo(){ if(!redoStack.length) return; undoStack.push(clone(state.model)); state.model=redoStack.pop(); render(); updUndo(); }
function updUndo(){ if($("#undo")) $("#undo").disabled=!undoStack.length; if($("#redo")) $("#redo").disabled=!redoStack.length; }
function toggleLock(i){ pushUndo(); state.model.clips[i].locked=!state.model.clips[i].locked; render(); }
function delClip(i){ pushUndo(); state.model.clips.splice(i,1); VibeCut.relayout(state.model); rederive(); }
function splitC(i){ pushUndo(); VibeCut.splitClip(state.model, i); rederive(); }
function trimC(i, side){ pushUndo(); VibeCut.trimClip(state.model, i, side, side==='in'?0.2:-0.2); rederive(); }
function moveClip(i, dir){ var j=i+dir, cs=state.model.clips; if(j<0||j>=cs.length) return; pushUndo();
  var tmp=cs[i]; cs[i]=cs[j]; cs[j]=tmp; VibeCut.relayout(state.model); rederive(); }
function capNudge(i, side, delta){ pushUndo(); var ev=state.model.captions.events[i]; if(!ev) return;
  if(side==='start') ev.start=Math.max(0, Math.min(ev.end-0.1, ev.start+delta)); else ev.end=Math.max(ev.start+0.1, ev.end+delta);
  $('#ffmpeg').textContent=VibeCut.ffmpeg(state.model, state.analysis.source_url||'clip.mp4'); render(); }
// project save / load
function saveProject(){ var blob=new Blob([JSON.stringify({analysis:state.analysis, model:state.model, prompt:$('#prompt').value})],{type:'application/json'});
  var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='vibecut-project.json'; a.click(); }
function loadProject(e){ var f=e.target.files[0]; if(!f) return; var r=new FileReader();
  r.onload=function(){ try{ var d=JSON.parse(r.result); state.analysis=d.analysis; state.model=d.model;
    if(d.prompt) $('#prompt').value=d.prompt; state.plan=VibeCut.planFromText(d.prompt||'', toggles());
    undoStack=[]; redoStack=[]; applyAspect(); render(); }catch(err){ alert('Bad project file'); } };
  r.readAsText(f); }

/* ---- live preview: play kept ranges, overlay captions + punch-in zoom ---- */
var playing=false, segIdx=0, raf=null, vt0=0, vstart=0;
function togglePlay(){ playing?stopPlay():startPlay(); }
function startPlay(){
  var m=state.model; if(!m.clips.length) return;
  playing=true; segIdx=0; $('#play').textContent='⏸ Pause';
  var v=$('#videoEl');
  if(state.hasVideo){ v.playbackRate=m.speed||1; v.currentTime=m.clips[0].src_in; v.play(); }
  else { vt0=performance.now(); vstart=0; }   // virtual clock (no video)
  loop();
}
function stopPlay(){ playing=false; $('#play').textContent='▶ Play edit'; var v=$('#videoEl'); if(v) v.pause(); if(raf) cancelAnimationFrame(raf); $('#vwrap').style.transform='scale(1)'; $('#caps').innerHTML=''; $('#broll').style.display='none'; $('#title').style.display='none'; $('#vwrap').style.opacity=1; $('#playhead').style.left='0'; }
function loop(){
  if(!playing) return;
  var m=state.model, clips=m.clips, c=clips[segIdx], v=$('#videoEl'), tl;
  if(state.hasVideo){
    if(v.currentTime>=c.src_out-0.03){ segIdx++; if(segIdx>=clips.length){ stopPlay(); return; } v.currentTime=clips[segIdx].src_in; c=clips[segIdx]; }
    tl=c.timeline_start+Math.max(0, v.currentTime-c.src_in);
  } else {
    tl=((performance.now()-vt0)/1000)*(m.speed||1); if(tl>=m.clips[clips.length-1].timeline_start+(clips[clips.length-1].src_out-clips[clips.length-1].src_in)){ stopPlay(); return; }
  }
  overlay(tl); raf=requestAnimationFrame(loop);
}
function overlay(tl){
  var m=state.model;
  // playhead position over source timeline: find clip then source time
  var c=m.clips[Math.min(segIdx,m.clips.length-1)];
  var srcT=c?c.src_in+(tl-c.timeline_start):0;
  $('#playhead').style.left=(100*srcT/state.analysis.duration)+'%';
  // zoom
  $('#vwrap').style.transform='scale('+VibeCut.zoomScaleAt(m,tl).toFixed(3)+')';
  // captions
  var ev=m.captions.events.find(function(e){return tl>=e.start-0.05 && tl<=e.end+0.05;});
  if(ev){ var weight=(m.captions.style==='bold-karaoke'||m.captions.style==='hype')?800:600;
    var size=(m.profile.height>m.profile.width)?6:4;
    $('#caps').innerHTML=ev.words.map(function(w,i){
      var active=(tl>=w.t && tl<=w.t+w.d);
      return '<span style="font-weight:'+weight+';font-size:'+size+'vw;color:'+(active?m.captions.highlight:'#fff')+'">'+esc(w.w)+'</span>';
    }).join(' ');
  } else $('#caps').innerHTML='';
  // b-roll cutaway
  var b=m.broll.find(function(x){return tl>=x.timeline_start && tl<=x.timeline_start+x.dur;});
  var bd=$('#broll');
  if(b){ bd.style.display='flex'; bd.textContent='B-ROLL: '+b.asset_id; } else bd.style.display='none';
  // intro title
  var ttl=m.titles && m.titles[0]; var td=$('#title');
  if(ttl && tl<=ttl.dur){ td.style.display='flex'; td.textContent=m.captions.uppercase?ttl.text.toUpperCase():ttl.text; } else td.style.display='none';
  // transition fade / dip preview (opacity)
  var op=1;
  if(m.transition){ var d=0.4, total=state.report.final;
    if(tl<d) op=tl/d; else if(tl>total-d) op=Math.max(0,(total-tl)/d);
    if(m.transition!=="fade"){ var dh=Math.min(d,0.3)/2;  // dip/overlap: dim near each cut boundary
      for(var k=1;k<m.clips.length;k++){ var cut=m.clips[k].timeline_start; if(Math.abs(tl-cut)<dh) op=Math.min(op, Math.abs(tl-cut)/dh); } }
  }
  $('#vwrap').style.opacity=op;
}

/* ---- export ---- */
function srtTime(t){ var h=Math.floor(t/3600),m=Math.floor(t%3600/60),s=Math.floor(t%60),ms=Math.round((t%1)*1000);
  return (h<10?'0':'')+h+':'+(m<10?'0':'')+m+':'+(s<10?'0':'')+s+','+('00'+ms).slice(-3); }
function downloadSRT(){
  var evs=state.model.captions.events, out='';
  evs.forEach(function(e,i){ out+=(i+1)+'\n'+srtTime(e.start)+' --> '+srtTime(e.end)+'\n'+e.words.map(function(w){return w.w;}).join(' ')+'\n\n'; });
  var blob=new Blob([out],{type:'text/plain'}); var a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download='captions.srt'; a.click();
}
function copyFfmpeg(){ navigator.clipboard && navigator.clipboard.writeText($('#ffmpeg').textContent); $('#copyff').textContent='Copied ✓'; setTimeout(function(){$('#copyff').textContent='Copy FFmpeg command';},1500); }
"""

TEMPLATE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>VibeCut Studio</title><style>__CSS__</style></head>
<body><div class="wrap">
  <h1><span class="logo">&#9670; VibeCut Studio</span></h1>
  <p class="sub">Load a clip + captions, vibe-edit, watch it play back, fine-tune by hand, or re-vibe.
     Runs fully in your browser &mdash; no server, install, APIs, or generation.</p>

  <div class="card">
    <div class="row">
      <div style="flex:1;min-width:200px"><div class="label">1 &middot; Your video (optional, for live preview)</div>
        <input type="file" id="video" accept="video/*"> <span class="muted" id="vstatus"></span></div>
      <div style="flex:1;min-width:200px"><div class="label">2 &middot; Captions .srt (for your video)</div>
        <input type="file" id="srt" accept=".srt"> <span class="muted" id="sstatus">using built-in sample</span></div>
    </div>
    <div style="margin-top:14px"><div class="label">3 &middot; Describe the edit</div>
      <input type="text" id="prompt" value="punchy, under 45 seconds, bold captions for tiktok, clean audio"></div>
    <div class="toggles" id="toggles"></div>
    <div class="toggles" style="margin-top:6px">
      <label>Look <select id="look"><option>none</option><option>warm</option><option>cool</option><option>vivid</option><option>bw</option><option>film</option><option>bright</option></select></label>
      <label>Transition <select id="transition"><option selected>none</option><option>fade</option><option>dip-to-black</option><option>dip-to-white</option><option>cross-dissolve</option><option>film-dissolve</option><option>additive-dissolve</option><option>wipe-left</option><option>wipe-right</option><option>wipe-up</option><option>wipe-down</option><option>slide-left</option><option>slide-right</option><option>slide-up</option><option>slide-down</option><option>iris</option><option>zoom</option><option>pixelize</option><option>radial</option></select></label>
      <label>Audio fade <select id="audiocurve"><option>constant-power</option><option>constant-gain</option><option>exponential</option></select></label>
      <label>Caption style <select id="capstyle"><option>minimal</option><option selected>bold-karaoke</option><option>hype</option><option>neon</option><option>clean</option><option>lower-third</option></select></label>
      <label><input type="checkbox" id="t_upper"> UPPERCASE</label>
      <label>Speed <select id="speed"><option>0.5</option><option selected>1</option><option>1.5</option><option>2</option></select></label>
    </div>
    <div class="toggles" style="margin-top:8px">
      <label>Bright <input type="range" id="cb" min="-0.3" max="0.3" step="0.02" value="0"></label>
      <label>Contrast <input type="range" id="cc" min="0.6" max="1.6" step="0.05" value="1"></label>
      <label>Saturate <input type="range" id="cs" min="0" max="2" step="0.05" value="1"></label>
      <label>Temp <input type="range" id="ct" min="-1" max="1" step="0.1" value="0"></label>
      <label>LUT <input type="file" id="lutfile" accept=".cube"></label>
    </div>
    <div class="row" style="margin-top:10px">
      <div style="flex:1;min-width:180px"><div class="label">Intro title (optional)</div>
        <input type="text" id="titletext" placeholder="e.g. My Channel"></div>
      <div style="flex:1;min-width:180px"><div class="label">Lower-third (optional)</div>
        <input type="text" id="lowerthird" placeholder="e.g. Jane Doe — Founder"></div>
    </div>
    <div style="margin-top:10px"><div class="label">Background music (optional, auto-ducked)</div>
      <input type="file" id="music" accept="audio/*"> <span class="muted" id="mstatus"></span></div>
    <div class="toggles" style="margin-top:10px">
      <label>Voice vol <input type="range" id="voicegain" min="0.5" max="2" step="0.05" value="1"></label>
      <label>Music vol <input type="range" id="musicgain" min="0" max="1" step="0.05" value="0.25"></label>
      <label>Duck <input type="range" id="duckamt" min="0" max="1" step="0.05" value="0.8"></label>
    </div>
    <div class="row" style="margin-top:14px">
      <button id="vibe">Vibe it &#9654;</button>
      <button id="revibe" class="ghost">Re-vibe (keeps 🔒 locked)</button>
    </div>
  </div>

  <div class="card">
    <div class="label">Preview</div>
    <div class="preview" id="preview">
      <div id="vwrap"><video id="videoEl" playsinline></video><div id="placeholder">Load a video above to preview your edit.<br>(Without one, Play shows the captions/zoom timing on this placeholder.)</div></div>
      <div id="broll"></div><div id="title"></div><div id="caps"></div>
    </div>
    <div class="pv-controls"><button id="play">&#9654; Play edit</button>
      <span class="muted">plays only the kept parts, with live captions + punch-in zoom</span></div>
    <div class="timeline" id="timeline"></div>
    <div class="clips" id="clips"></div>
    <div class="row" style="margin-top:10px">
      <button id="undo" class="ghost sm">↶ Undo</button>
      <button id="redo" class="ghost sm">↷ Redo</button>
      <button id="saveproj" class="ghost sm">💾 Save project</button>
      <button id="loadbtn" class="ghost sm">📂 Load project</button>
      <input type="file" id="loadproj" accept=".json" style="display:none">
    </div>
  </div>

  <div class="card"><div class="label">Edit plan</div><div id="plan"></div>
    <div class="stats" id="stats"></div></div>

  <div class="card"><div class="label">Captions &mdash; edit the words by hand</div>
    <div id="capeditor"></div></div>

  <div class="card"><div class="label">Export</div>
    <div class="row" style="margin-bottom:10px">
      <button id="dlsrt" class="ghost">Download captions (.srt)</button>
      <button id="copyff" class="ghost">Copy FFmpeg command</button>
    </div>
    <div class="muted">To render the finished MP4, run the FFmpeg command (or use
      <code>python -m vibecut.oneshot</code>). Browser preview shows the edit; the desktop app / CLI exports it.</div>
    <pre id="ffmpeg"></pre>
  </div>

  <div class="foot">VibeCut Studio &middot; interactive reference editor &middot; no APIs, no generation.</div>
</div>
<script>__ENGINE__</script>
<script>
  var SAMPLE = __SAMPLE__;
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
    with open(os.path.join(CORE, "media_library.json"), encoding="utf-8") as fh:
        library = json.load(fh)
    html = (TEMPLATE.replace("__CSS__", CSS).replace("__ENGINE__", engine)
            .replace("__SAMPLE__", json.dumps(sample)).replace("__LIBRARY__", json.dumps(library))
            .replace("__UI__", UI))
    out = os.path.join(HERE, "studio.html")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(html)
    print(f"wrote {out} ({len(html)} bytes)")


if __name__ == "__main__":
    main()

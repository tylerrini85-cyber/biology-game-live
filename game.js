// Geometry Dash-style cellular respiration game
// Death-question flow: die → answer biology question → correct=resume / wrong=restart
// 20-question bank per level, refreshed only on full restart

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = 1280;
canvas.height = 720;

// ---------- Global state ----------
const state = {
  screen: 'TITLE', // TITLE | INTRO | PLAYING | DEATH | DEATH_QUESTION | NO_QUESTIONS | LEVEL_COMPLETE | GAME_COMPLETE
  levelIndex: 0,
  player: { x: 280, y: 600, vy: 0, form: 'glucose', onGround: true, gravity: 1, rotation: 0 },
  attempts: 1,
  totalATP: 0,
  scrollX: 0,
  elapsed: 0,
  dead: false,
  completed: false,
  obstacles: [],
  particles: [],
  trail: [],
  flashTimer: 0,
  flashText: '',
  input: { jumpPressed: false, jumpHeld: false },
  lastTime: 0,
  deathTimer: 0,

  // Second-chance bank
  questionBank: [],   // remaining questions for this level run
  bankSize: 10,
  questionsUsed: 0,
  currentQuestion: null,
  questionAnswered: false,
  lastDeathScrollX: 0,

  // Per-level stats
  levelDeathCount: 0,
  levelCorrectAnswers: 0,

  // Countdown
  countdownTimer: 0,
  lastCountdownTick: -1,

  // Game timer (wall-clock from "Start Journey" to game complete)
  gameStartTime: null,
  gameEndTime: null,

  // Inter-level quiz state (3 correct to advance)
  interQuizPool: [],
  interQuizCorrect: 0,
  interQuizAsked: 0,
  interQuizAnswered: false,
  currentInterQuestion: null,

  // Tracks question texts asked this level (both death + inter-quiz) — avoids repeats
  askedThisLevel: [],

  // Per-level ATP earned (matches real biology: ETC produces most ATP)
  atpByLevel: [0, 0, 0, 0],
  // Inter-level quiz ATP per correct answer — total 30 (low end of 30-32 real range)
  // 3 quiz questions per level: 2*3 + 2*3 + 2*3 + 4*3 = 30 ATP if perfect
  atpPerCorrect: [2, 2, 2, 4],

  // Heat lost as a byproduct — real biology: ~60% of glucose energy becomes heat
  heat: 0,

  // ATP-spending end scene state
  spending: null
};

// ---------- Countdown (3-2-1-GO before each playable spawn) ----------
function startCountdown() {
  state.screen = 'COUNTDOWN';
  state.countdownTimer = 2700; // 3s of "3,2,1" + 700ms "GO!"
  state.lastCountdownTick = -1;
}

function renderCountdown(dt) {
  const lvl = LEVELS[state.levelIndex];
  // Render the frozen level scene
  lvl.render(ctx, state);

  // Tick down
  state.countdownTimer -= dt;
  const elapsed = 2700 - state.countdownTimer;
  let num, tickIdx, color;
  if (elapsed < 800) { num = '3'; tickIdx = 0; color = '#ff9a9a'; }
  else if (elapsed < 1600) { num = '2'; tickIdx = 1; color = '#ffe27a'; }
  else if (elapsed < 2400) { num = '1'; tickIdx = 2; color = '#b6ff7a'; }
  else { num = 'GO!'; tickIdx = 3; color = '#7ec8ff'; }

  if (tickIdx !== state.lastCountdownTick) {
    state.lastCountdownTick = tickIdx;
    state.sfx(tickIdx === 3 ? 'complete' : 'beat');
  }

  // Dimmed overlay
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Pulse scale based on phase progress
  const phaseStart = tickIdx === 0 ? 0 : tickIdx === 1 ? 800 : tickIdx === 2 ? 1600 : 2400;
  const phaseDur = tickIdx === 3 ? 300 : 800;
  const phaseT = Math.max(0, Math.min(1, (elapsed - phaseStart) / phaseDur));
  const scale = 0.7 + (1 - phaseT) * 0.5; // shrinks over each phase
  const alpha = tickIdx === 3 ? 1 : (1 - phaseT * 0.4);

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 60;
  ctx.font = 'bold 240px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(num, 0, 0);
  ctx.shadowBlur = 0;
  // Stroke for crispness
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.strokeText(num, 0, 0);
  ctx.restore();

  // "Get ready..." subtitle
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(tickIdx === 3 ? '' : 'GET READY...', canvas.width / 2, canvas.height / 2 + 150);

  if (state.countdownTimer <= 0) {
    state.screen = 'PLAYING';
  }
}

// ---------- AUDIO SYSTEM (WebAudio synthesis — no external files) ----------
state.audioMuted = false;
state.music = {
  isPlaying: false,
  nextMelodyTime: 0,
  nextBassTime: 0,
  nextDrumTime: 0,
  melodyIdx: 0,
  bassIdx: 0,
  drumBeat: 0,
  masterGain: null,
  schedulerId: null
};
state.slideSound = { active: false, source: null, gain: null };

function getAudioContext() {
  try {
    if (!state.audioCtx) {
      state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (state.audioCtx.state === 'suspended') state.audioCtx.resume();
    return state.audioCtx;
  } catch (e) { return null; }
}

// Improved per-event sound effects (sweeps, envelopes — more satisfying than flat tones)
state.sfx = (kind) => {
  if (state.audioMuted) return;
  const ac = getAudioContext();
  if (!ac) return;
  const t = ac.currentTime;

  const playTone = (startFreq, endFreq, dur, type = 'square', vol = 0.07) => {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.connect(g); g.connect(ac.destination);
    o.type = type;
    o.frequency.setValueAtTime(startFreq, t);
    if (endFreq != null && endFreq !== startFreq) {
      o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    }
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o.stop(t + dur + 0.02);
  };

  const playNoise = (dur, vol = 0.12, filterFreq = 1000) => {
    const buf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = ac.createBufferSource();
    s.buffer = buf;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filterFreq;
    const g = ac.createGain();
    g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(ac.destination);
    s.start();
  };

  switch (kind) {
    case 'jump':
      // Quick upward sweep — classic platformer hop
      playTone(220, 540, 0.09, 'square', 0.09);
      break;
    case 'collect':
      // Two-tone pickup
      playTone(660, 990, 0.08, 'triangle', 0.08);
      break;
    case 'beat':
      playTone(660, 660, 0.05, 'square', 0.06);
      break;
    case 'correct':
      playTone(660, 880, 0.08, 'triangle', 0.09);
      setTimeout(() => playTone(880, 1320, 0.12, 'triangle', 0.09), 80);
      break;
    case 'wrong':
      playTone(220, 90, 0.4, 'sawtooth', 0.08);
      break;
    case 'complete':
      // Little fanfare
      playTone(523, 523, 0.1, 'triangle', 0.08);
      setTimeout(() => playTone(659, 659, 0.1, 'triangle', 0.08), 110);
      setTimeout(() => playTone(784, 784, 0.12, 'triangle', 0.08), 220);
      setTimeout(() => playTone(1047, 1047, 0.2, 'triangle', 0.09), 340);
      break;
    case 'death':
      // Descending sawtooth + noise burst
      playTone(440, 60, 0.5, 'sawtooth', 0.1);
      playNoise(0.35, 0.1, 1500);
      break;
    default:
      playTone(440, 440, 0.1, 'square', 0.07);
  }
};

// ---------- BACKGROUND MUSIC — Old jazz / blues style ----------
// Sine wave lead (warm horn tone) with swung 8ths + walking triangle bass + brush drums.
// 4-bar I-IV-V-I blues progression in C. 120 BPM medium swing.
// Swung 8ths: 0.667 + 0.333 beats (triplet feel) instead of straight 0.5 + 0.5.
const MUSIC_MELODY = [
  // Bar 1 (C7) — bluesy ascending lick with swing
  [329.63, 0.667], [392.00, 0.333],   // E (long), G (short)
  [466.16, 0.667], [523.25, 0.333],   // Bb (blue 7th, long), C (short)
  [466.16, 0.667], [440.00, 0.333],   // Bb (long), A (short)
  [392.00, 0.667], [329.63, 0.333],   // G (long), E (short)
  // Bar 2 (F7) — moves up to F-major flavor, longer notes
  [349.23, 1.0],                       // F
  [466.16, 1.0],                       // Bb
  [523.25, 0.667], [466.16, 0.333],   // C, Bb (swing)
  [440.00, 1.0],                       // A
  // Bar 3 (G7) — bluesy turnaround with blue notes
  [261.63, 0.667], [311.13, 0.333],   // C, Eb (blue 3rd)
  [329.63, 0.667], [392.00, 0.333],   // E, G
  [493.88, 0.667], [466.16, 0.333],   // B, Bb (chromatic)
  [440.00, 1.0],                       // A
  // Bar 4 (C) — resolution
  [392.00, 0.667], [329.63, 0.333],   // G, E
  [261.63, 2.0],                       // C (hold)
  [196.00, 1.0]                        // G (low) - ride out
];
const MUSIC_BASS = [
  // Bar 1: C7 — walking C-E-G-A (chromatic walkup to F)
  [130.81, 1], [164.81, 1], [196.00, 1], [220.00, 1],
  // Bar 2: F7 — F-A-C-D
  [174.61, 1], [220.00, 1], [261.63, 1], [293.66, 1],
  // Bar 3: G7 — G-B-D-F
  [196.00, 1], [246.94, 1], [293.66, 1], [349.23, 1],
  // Bar 4: C — walking down C-G-E-G to set up loop
  [261.63, 1], [196.00, 1], [164.81, 1], [196.00, 1]
];
const MUSIC_BPM = 120;

// Real jazz / ragtime track from the HTML5 <audio> element.
// We try URLs one by one in JS so 404s / CORS issues fall back gracefully.
const JAZZ_TRACKS = [
  'jazz.mp3', // local file if user added one
  'https://upload.wikimedia.org/wikipedia/commons/1/1b/The_Entertainer_-_Scott_Joplin.ogg',
  'https://upload.wikimedia.org/wikipedia/commons/f/fe/Maple_Leaf_Rag.ogg',
  'https://upload.wikimedia.org/wikipedia/commons/2/2d/Tiger_Rag_-_Dixie_Players_-_United_States_Air_Force_Heritage_of_America_Band.mp3'
];
state.musicTrackIdx = 0;

function tryNextTrack() {
  const audio = document.getElementById('bg-music');
  if (!audio) return;
  if (state.musicTrackIdx >= JAZZ_TRACKS.length) {
    console.warn('All jazz tracks failed to load.');
    return;
  }
  const url = JAZZ_TRACKS[state.musicTrackIdx++];
  console.log('Loading jazz track:', url);
  audio.src = url;
  audio.load();
}

function startMusic() {
  if (state.audioMuted) return;
  const audio = document.getElementById('bg-music');
  if (!audio) return;
  audio.volume = 0.30;
  state.music.isPlaying = true;
  // Set up listeners ONCE
  if (!audio._wiredJazz) {
    audio._wiredJazz = true;
    audio.addEventListener('error', () => {
      console.warn('Jazz track failed:', audio.src);
      tryNextTrack();
    });
    audio.addEventListener('canplay', () => {
      if (!state.audioMuted && state.music.isPlaying) {
        audio.play().catch((err) => {
          console.log('Music will start when you interact with the page.', err && err.name);
        });
      }
    });
  }
  // If audio has no source yet, load the first track
  if (!audio.src) {
    state.musicTrackIdx = 0;
    tryNextTrack();
  } else {
    // Already loaded — just (re)start playback
    audio.play().catch(() => {});
  }
}

function stopMusic() {
  state.music.isPlaying = false;
  const audio = document.getElementById('bg-music');
  if (audio) {
    try { audio.pause(); } catch (e) {}
  }
  if (state.music.schedulerId) {
    clearTimeout(state.music.schedulerId);
    state.music.schedulerId = null;
  }
  if (state.music.masterGain) {
    try { state.music.masterGain.disconnect(); } catch (e) {}
    state.music.masterGain = null;
  }
}

function musicScheduler() {
  if (!state.music.isPlaying) return;
  const ac = getAudioContext();
  if (!ac) return;
  const beat = 60 / MUSIC_BPM;
  const lookahead = ac.currentTime + 0.3;

  // Melody — sine wave (warm horn/sax tone, old jazz feel)
  while (state.music.nextMelodyTime < lookahead) {
    const [freq, beats] = MUSIC_MELODY[state.music.melodyIdx];
    scheduleMusicNote(freq, state.music.nextMelodyTime, beats * beat, 'sine', 0.35);
    state.music.nextMelodyTime += beats * beat;
    state.music.melodyIdx = (state.music.melodyIdx + 1) % MUSIC_MELODY.length;
  }
  // Walking bass — triangle wave (warm upright-bass feel)
  while (state.music.nextBassTime < lookahead) {
    const [freq, beats] = MUSIC_BASS[state.music.bassIdx];
    scheduleMusicNote(freq, state.music.nextBassTime, beats * beat, 'triangle', 0.55);
    state.music.nextBassTime += beats * beat;
    state.music.bassIdx = (state.music.bassIdx + 1) % MUSIC_BASS.length;
  }
  // Brush drums — soft ride pattern, accent on 2 and 4 (jazz backbeat)
  while (state.music.nextDrumTime < lookahead) {
    const isBackbeat = (state.music.drumBeat % 2 === 1); // beats 2 and 4
    if (isBackbeat) {
      scheduleSnare(state.music.nextDrumTime); // brush snap
    } else {
      scheduleKick(state.music.nextDrumTime);  // soft ride/brush sweep
    }
    state.music.nextDrumTime += beat;
    state.music.drumBeat = (state.music.drumBeat + 1) % 16;
  }
  state.music.schedulerId = setTimeout(musicScheduler, 50);
}

// Jazz brush "ride" — soft noise sweep, lowpass filtered. Plays on beats 1 and 3.
function scheduleKick(time) {
  const ac = getAudioContext();
  if (!ac || !state.music.masterGain) return;
  const len = Math.floor(ac.sampleRate * 0.10);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const env = Math.exp(-i / (len * 0.4));
    d[i] = (Math.random() * 2 - 1) * env;
  }
  const s = ac.createBufferSource();
  s.buffer = buf;
  const f = ac.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 2500;
  const g = ac.createGain();
  g.gain.value = 0.08;
  s.connect(f); f.connect(g); g.connect(state.music.masterGain);
  s.start(time);
}

// Jazz brush "slap" — slightly louder noise burst with bandpass, on beats 2 and 4.
function scheduleSnare(time) {
  const ac = getAudioContext();
  if (!ac || !state.music.masterGain) return;
  const len = Math.floor(ac.sampleRate * 0.13);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const env = Math.exp(-i / (len * 0.35));
    d[i] = (Math.random() * 2 - 1) * env;
  }
  const s = ac.createBufferSource();
  s.buffer = buf;
  const f = ac.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 3000;
  f.Q.value = 0.6;
  const g = ac.createGain();
  g.gain.value = 0.18;
  s.connect(f); f.connect(g); g.connect(state.music.masterGain);
  s.start(time);
}

function scheduleMusicNote(freq, time, dur, type, vol) {
  const ac = getAudioContext();
  if (!ac || !state.music.masterGain) return;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.value = freq;
  o.connect(g);
  g.connect(state.music.masterGain);
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(vol, time + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, time + dur * 0.92);
  o.start(time);
  o.stop(time + dur + 0.02);
}

// ---------- CONTINUOUS SLIDE/RUN SOUND (while on ground) ----------
function startSlideSound() {
  if (state.audioMuted || state.slideSound.active) return;
  const ac = getAudioContext();
  if (!ac) return;

  // Looped brown noise filtered to a soft rush
  const bufferSize = ac.sampleRate * 1;
  const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
  const data = buffer.getChannelData(0);
  let lastOut = 0;
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    lastOut = (lastOut + 0.02 * white) / 1.02;
    data[i] = lastOut * 3;
  }
  const src = ac.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 500;
  filter.Q.value = 0.7;
  const g = ac.createGain();
  g.gain.value = 0.025;

  src.connect(filter);
  filter.connect(g);
  g.connect(ac.destination);
  src.start();

  state.slideSound.source = src;
  state.slideSound.gain = g;
  state.slideSound.active = true;
}

function stopSlideSound() {
  if (!state.slideSound.active) return;
  try { state.slideSound.source.stop(); } catch (e) {}
  try { state.slideSound.source.disconnect(); } catch (e) {}
  try { state.slideSound.gain.disconnect(); } catch (e) {}
  state.slideSound.active = false;
}

function setMuted(muted) {
  state.audioMuted = muted;
  if (muted) {
    stopMusic();
    stopSlideSound();
  } else {
    startMusic();
  }
  if (hud.mute) hud.mute.textContent = muted ? '🔇' : '🔊';
}
window.setMuted = setMuted;

// ---------- Death + question flow ----------
state.onDeath = () => {
  // Record death scroll position (the level's update already set state.dead = true)
  state.lastDeathScrollX = state.scrollX;
  state.levelDeathCount += 1;
  // Death penalty: -1 ATP. Correct answer to the next question will refund it.
  state.totalATP -= 1;
  state.atpByLevel[state.levelIndex] = (state.atpByLevel[state.levelIndex] || 0) - 1;
  state.screen = 'DEATH';
  state.deathTimer = 700; // particle animation duration
  state.sfx('death');
};

state.completeLevelFromEnd = () => {
  state.screen = 'LEVEL_COMPLETE';
  state.sfx('complete');
  showLevelComplete();
};

function shuffleQuestions(arr) {
  return arr.map(q => ({ ...q })).sort(() => Math.random() - 0.5);
}

// Reset the GLOBAL question pool — called only when starting a new game.
// During level restarts (death-wrong) the pool stays as-is so questions never repeat in a game.
function freshGlobalQuestionPool() {
  state.questionBank = shuffleQuestions(QUESTIONS || []);
  state.questionsUsed = 0;
  state.askedThisLevel = [];
}

// Legacy name kept for any leftover calls — now a no-op for level restarts
function freshQuestionBank() {
  // Intentionally does NOT reset the pool on level restart, only on new game.
  // Pool persists for the entire game per user requirement: "questions should never repeat in a game".
}

// Called after the death particle animation finishes
function triggerDeathQuestion() {
  if (state.questionBank.length === 0) {
    // Bank empty — no more second chances
    state.screen = 'NO_QUESTIONS';
    showOverlay(`
      <div class="panel">
        <h2>💀 No more questions left this game</h2>
        <p>You've answered all 40 questions this game. Restart the level to keep going (the pool will reshuffle if you start a brand new game).</p>
        <button class="btn" onclick="restartLevelFromStart()">↺ Restart Level</button>
      </div>
    `);
    return;
  }
  state.currentQuestion = state.questionBank.shift();
  state.questionsUsed += 1;
  state.questionAnswered = false;
  state.askedThisLevel.push(state.currentQuestion.q);
  state.screen = 'DEATH_QUESTION';
  showDeathQuestion();
}

function showDeathQuestion() {
  const q = state.currentQuestion;
  const remaining = state.questionBank.length;
  const used = state.questionsUsed;
  showOverlay(`
    <div class="panel">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <h2 style="margin:0; color:#ff9a9a;">💀 Second chance</h2>
        <div style="color:#7ec8ff; font-size:13px;">Q ${used} · Bank: ${remaining} left</div>
      </div>
      <p style="font-size:14px; color:#aac; margin-bottom:14px;">Answer correctly to resume just before where you died. Wrong = restart from the beginning.</p>
      <p style="font-size:18px;">${q.q}</p>
      <div class="choices" id="choices">
        ${q.choices.map((c, i) => `
          <div class="choice" data-idx="${i}" onclick="answerDeathQuestion(${i})">
            <span class="key">${i + 1}</span>
            <span>${c}</span>
          </div>
        `).join('')}
      </div>
      <div id="feedback"></div>
    </div>
  `);
}

function answerDeathQuestion(idx) {
  if (state.questionAnswered) return;
  state.questionAnswered = true;
  const q = state.currentQuestion;
  const correct = idx === q.correct;
  const choices = document.querySelectorAll('.choice');
  choices.forEach((c, i) => {
    if (i === q.correct) c.classList.add('correct');
    else if (i === idx) c.classList.add('incorrect');
    c.style.pointerEvents = 'none';
  });
  if (correct) {
    // Refund the 1 ATP lost on death — net zero ATP change for this death cycle
    state.totalATP += 1;
    state.atpByLevel[state.levelIndex] = (state.atpByLevel[state.levelIndex] || 0) + 1;
    state.levelCorrectAnswers += 1;
    state.sfx('correct');
  } else {
    // Penalty stays — player has now lost 1 ATP from the death
    state.sfx('wrong');
  }
  document.getElementById('feedback').innerHTML = `
    <div class="feedback ${correct ? 'correct' : 'incorrect'}">
      <strong>${correct ? '✓ Correct! +1 ATP refunded · Resuming near checkpoint...' : '✗ Wrong! −1 ATP lost · Restarting level from the start...'}</strong><br>
      ${q.explain}
    </div>
    <button class="btn" onclick="${correct ? 'resumeFromCheckpoint()' : 'restartLevelFromStart()'}">▶ Continue</button>
  `;
}

function resumeFromCheckpoint() {
  hideOverlay();
  state.questionAnswered = false;
  state.attempts += 1;
  const lvl = LEVELS[state.levelIndex];
  lvl.init(state);

  // Find a SAFE spawn position past the killer obstacle.
  // Strategy: start a bit ahead of death, then push forward until no obstacle
  // sits in the player's danger zone (just under + just ahead of spawn point).
  const PLAYER_SCREEN_X = 280;
  const LOOKBACK = 50;    // how close behind player is too close
  const LOOKAHEAD = 280;  // how much clear ground ahead player needs to react
  let resumeX = state.lastDeathScrollX + 80;
  for (let i = 0; i < 30; i++) {
    const playerWorldX = resumeX + PLAYER_SCREEN_X;
    let conflict = null;
    for (const ob of state.obstacles) {
      if (ob.type === 'end') continue;
      // Approximate obstacle X range
      const obX = ob.x;
      const obW = (ob.type === 'block') ? ob.w : 40;
      // Inside the danger window?
      if (obX + obW > playerWorldX - LOOKBACK && obX < playerWorldX + LOOKAHEAD) {
        conflict = ob;
        break;
      }
    }
    if (!conflict) break;
    // Push past this obstacle (its right edge + buffer)
    const obRight = conflict.x + ((conflict.type === 'block') ? conflict.w : 40);
    resumeX = obRight + 80 - PLAYER_SCREEN_X;
  }
  // Cap so we never skip past the end marker
  resumeX = Math.min(resumeX, Math.max(0, lvl.length - 600));
  state.scrollX = Math.max(0, resumeX);
  startCountdown();
}

function restartLevelFromStart() {
  hideOverlay();
  state.questionAnswered = false;
  state.attempts += 1;
  freshQuestionBank();
  const lvl = LEVELS[state.levelIndex];
  lvl.init(state);
  state.scrollX = 0;
  startCountdown();
}

// ---------- HUD ----------
const hud = {
  level: document.getElementById('hud-level'),
  location: document.getElementById('hud-location'),
  attempts: document.getElementById('hud-attempts'),
  atp: document.getElementById('hud-atp'),
  bank: document.getElementById('hud-bank'),
  timer: document.getElementById('hud-timer'),
  heat: document.getElementById('hud-heat'),
  mute: document.getElementById('hud-mute')
};

window.__getMuted = () => state.audioMuted;

function updateHUD() {
  const lvl = LEVELS[state.levelIndex];
  if (lvl && hud.level) {
    hud.level.textContent = `LEVEL ${state.levelIndex + 1}: ${lvl.name}`;
    hud.location.textContent = lvl.location;
  }
  if (hud.attempts) hud.attempts.textContent = state.attempts;
  if (hud.atp) hud.atp.textContent = state.totalATP;
  if (hud.heat) hud.heat.textContent = Math.round(state.heat);
  if (hud.bank) hud.bank.textContent = `${state.questionBank.length}/${state.bankSize}`;
  if (hud.timer) {
    if (state.gameStartTime) {
      const now = state.gameEndTime || Date.now();
      hud.timer.textContent = formatTime(now - state.gameStartTime);
    } else {
      hud.timer.textContent = '00:00';
    }
  }
}

// ---------- Overlay ----------
const overlay = document.getElementById('overlay');
const overlayContent = document.getElementById('overlay-content');

function showOverlay(html) {
  overlayContent.innerHTML = html;
  overlay.classList.add('active');
}

function hideOverlay() {
  overlay.classList.remove('active');
  overlayContent.innerHTML = '';
}

// ---------- Screens ----------
function showTitle() {
  state.screen = 'TITLE';
  state.levelIndex = 0;
  state.totalATP = 0;
  state.attempts = 1;
  state.heat = 0;
  state.atpByLevel = [0, 0, 0, 0];
  state.questionBank = [];
  state.gameStartTime = null;
  state.gameEndTime = null;
  showOverlay(`
    <div class="panel" id="title-screen">
      <h1>Cellular Respiration</h1>
      <div class="subtitle">The Glucose Journey</div>
      <p style="font-size:14px; color:#aac; background:rgba(126,200,255,0.08); padding:10px; border-left:3px solid #7ec8ff; border-radius:4px; text-align:left;">
        <strong>The story:</strong> You ate carbs. Digestion broke them into <strong>glucose</strong> (sugar). Glucose entered your bloodstream and reached a cell. Now it's about to be burned for energy through 4 stages.
      </p>
      <p>You are that glucose molecule. Auto-run through <strong>Glycolysis → Pyruvate Oxidation → Krebs Cycle → ETC</strong>. Each level matches a real stage in your cells.</p>
      <p style="font-size:13px; color:#aac;">
        <strong>Quiz ATP per correct answer:</strong> Lv 1 = +2, Lv 2 = +2, Lv 3 = +2, <strong>Lv 4 = +4</strong>. Ace all 12 questions → exactly 30 ATP (the real biology number).
      </p>
      <p style="font-size:13px; color:#ff9a9a; background:rgba(255,154,154,0.08); padding:8px; border-left:3px solid #ff9a9a; border-radius:4px;">
        <strong>💀 Death cost:</strong> Each death = −1 ATP. Answer the death question correctly to refund it. Wrong = stay −1 AND restart the level.
      </p>
      <button class="btn" onclick="startGame()">▶ Start Journey</button>
      <button class="btn secondary" onclick="showCodex()">📖 Bio-Codex</button>
    </div>
  `);
}

function startGame() {
  state.levelIndex = 0;
  state.totalATP = 0;
  state.attempts = 1;
  state.heat = 0;
  state.atpByLevel = [0, 0, 0, 0];
  state.gameStartTime = Date.now();
  state.gameEndTime = null;
  // Fresh shuffle of all 40 questions — no repeats this game
  freshGlobalQuestionPool();
  startMusic();
  hideOverlay();
  showLevelIntro();
}

function formatTime(ms) {
  if (ms == null || ms < 0) return '00:00';
  const total = Math.floor(ms / 1000);
  const mm = Math.floor(total / 60).toString().padStart(2, '0');
  const ss = (total % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

function showLevelIntro() {
  state.screen = 'INTRO';
  const lvl = LEVELS[state.levelIndex];
  state.attempts = 1;
  state.levelDeathCount = 0;
  state.levelCorrectAnswers = 0;
  freshQuestionBank();
  showOverlay(`
    <div class="panel">
      <h2>Level ${state.levelIndex + 1}: ${lvl.name}</h2>
      <p style="color:#7ec8ff; font-size:14px; letter-spacing:1px;">📍 ${lvl.location}</p>
      <p>${lvl.description}</p>
      <p style="background:rgba(255,226,122,0.1); border-left:3px solid #ffe27a; padding:10px; font-size:14px;">
        <strong>Controls:</strong> Hold or tap <strong>SPACE</strong> (or click) to jump. Avoid spikes. Land on top of blocks. Pass through orbs and press SPACE for a mid-air jump.
      </p>
      <p style="background:rgba(126,200,255,0.1); border-left:3px solid #7ec8ff; padding:10px; font-size:14px;">
        <strong>Second-chance bank:</strong> 20 fresh questions loaded. Each death pulls one.
      </p>
      <button class="btn" onclick="beginLevel()">▶ Begin</button>
    </div>
  `);
}

function beginLevel() {
  hideOverlay();
  const lvl = LEVELS[state.levelIndex];
  state.attempts = 1;
  state.levelDeathCount = 0;
  state.levelCorrectAnswers = 0;
  lvl.init(state);
  startCountdown();
}

function showLevelComplete() {
  const lvl = LEVELS[state.levelIndex];
  const deaths = state.levelDeathCount;
  const correct = state.levelCorrectAnswers;
  const perfect = deaths === 0;
  showOverlay(`
    <div class="panel">
      <h2>✓ Level ${state.levelIndex + 1} Complete</h2>
      <h2 style="color:#ffe27a;">${lvl.name}</h2>
      <div style="display:flex; justify-content:space-around; margin:18px 0; text-align:center;">
        <div><div style="font-size:28px; color:#ff9a9a;">${deaths}</div><div style="font-size:12px; color:#aac;">DEATHS</div></div>
        <div><div style="font-size:28px; color:#6cf06c;">${correct}</div><div style="font-size:12px; color:#aac;">CORRECT</div></div>
        <div><div style="font-size:28px; color:#ffe27a;">${state.totalATP}</div><div style="font-size:12px; color:#aac;">TOTAL ATP</div></div>
      </div>
      ${perfect ? `<p style="text-align:center; color:#ffe27a; font-weight:bold;">⭐ PERFECT RUN — no deaths!</p>` : ''}
      <p style="margin-top:14px; background:rgba(126,200,255,0.1); border-left:3px solid #7ec8ff; padding:10px; font-size:14px;">
        <strong>Knowledge check:</strong> answer <strong>3 questions correctly</strong> about ${lvl.name} to advance. Wrong answers don't stop you — just keep going.
      </p>
      <button class="btn" onclick="startInterLevelQuiz()">▶ Begin Quiz</button>
    </div>
  `);
}

function startInterLevelQuiz() {
  state.screen = 'INTER_LEVEL_QUIZ';
  // Pull from the GLOBAL question bank — questions already used this game are excluded
  let pool = (state.questionBank || []).slice();
  if (pool.length < 3) {
    // Last-resort fallback: reshuffle full set if we've exhausted the pool
    pool = shuffleQuestions(QUESTIONS.filter(q => !state.askedThisLevel.includes(q.q)));
    if (pool.length < 3) pool = shuffleQuestions(QUESTIONS);
  }
  state.interQuizPool = shuffleQuestions(pool);
  state.interQuizCorrect = 0;
  state.interQuizAsked = 0;
  state.interQuizAnswered = false;
  showInterLevelQuestion();
}

function showInterLevelQuestion() {
  if (state.interQuizPool.length === 0) {
    // Refill: prefer unseen across the ENTIRE game, fall back to all if truly exhausted
    let pool = QUESTIONS.filter(q => !state.askedThisLevel.includes(q.q));
    if (pool.length < 1) pool = QUESTIONS.slice();
    state.interQuizPool = shuffleQuestions(pool);
  }
  state.currentInterQuestion = state.interQuizPool.shift();
  state.interQuizAsked += 1;
  state.interQuizAnswered = false;
  // Track in the GLOBAL asked list so death + future quizzes don't repeat this question
  state.askedThisLevel.push(state.currentInterQuestion.q);
  // Also drop it from the shared bank so death questions don't pull it again
  state.questionBank = state.questionBank.filter(q => q.q !== state.currentInterQuestion.q);
  const q = state.currentInterQuestion;
  const lvl = LEVELS[state.levelIndex];
  showOverlay(`
    <div class="panel">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <h2 style="margin:0;">Quiz: ${lvl.name}</h2>
        <div style="color:#7ec8ff; font-size:14px;">Correct: <strong style="color:#6cf06c;">${state.interQuizCorrect}/3</strong> · Q${state.interQuizAsked}</div>
      </div>
      <p style="font-size:14px; color:#aac; margin-bottom:14px;">Get 3 right to advance to the next level. Wrong answers don't penalize you.</p>
      <p style="font-size:18px;">${q.q}</p>
      <div class="choices" id="choices">
        ${q.choices.map((c, i) => `
          <div class="choice" data-idx="${i}" onclick="answerInterLevelQuiz(${i})">
            <span class="key">${i + 1}</span>
            <span>${c}</span>
          </div>
        `).join('')}
      </div>
      <div id="feedback"></div>
    </div>
  `);
}

function answerInterLevelQuiz(idx) {
  if (state.interQuizAnswered) return;
  state.interQuizAnswered = true;
  const q = state.currentInterQuestion;
  const correct = idx === q.correct;
  const choices = document.querySelectorAll('.choice');
  choices.forEach((c, i) => {
    if (i === q.correct) c.classList.add('correct');
    else if (i === idx) c.classList.add('incorrect');
    c.style.pointerEvents = 'none';
  });
  const atpReward = state.atpPerCorrect[state.levelIndex] || 1;
  if (correct) {
    state.interQuizCorrect += 1;
    state.totalATP += atpReward;
    state.atpByLevel[state.levelIndex] += atpReward;
    state.heat += atpReward * 1.5;
    state.sfx('correct');
  } else {
    state.sfx('wrong');
  }
  const done = state.interQuizCorrect >= 3;
  const isLast = state.levelIndex >= LEVELS.length - 1;
  document.getElementById('feedback').innerHTML = `
    <div class="feedback ${correct ? 'correct' : 'incorrect'}">
      <strong>${correct ? `✓ Correct! +${atpReward} ATP · Progress: ${state.interQuizCorrect}/3` : `✗ Not quite. Still need ${3 - state.interQuizCorrect} more correct.`}</strong><br>
      ${q.explain}
    </div>
    <button class="btn" onclick="${done ? 'advanceToNextLevel()' : 'showInterLevelQuestion()'}">${done ? (isLast ? '🏁 See Final Score' : '▶ Advance to Level ' + (state.levelIndex + 2)) : '▶ Next Question'}</button>
  `;
}

function advanceToNextLevel() {
  hideOverlay();
  state.levelIndex += 1;
  if (state.levelIndex >= LEVELS.length) {
    startATPSpendingScene();
  } else {
    showLevelIntro();
  }
}

// ============================================================
// ATP SPENDING SCENE — shows where the cell would spend each ATP
// ============================================================

function startATPSpendingScene() {
  hideOverlay();
  state.screen = 'ATP_SPENDING';

  const totalATP = state.totalATP || 0;
  // Distribute ATP across 5 cellular work zones (illustrative real ratios)
  const distribution = {
    brain:   Math.round(totalATP * 0.20),
    muscle:  Math.round(totalATP * 0.25),
    protein: Math.round(totalATP * 0.20),
    pumps:   Math.round(totalATP * 0.20),
    other:   0
  };
  distribution.other = totalATP - distribution.brain - distribution.muscle - distribution.protein - distribution.pumps;

  // 5 zones positioned around the canvas
  state.spending = {
    totalATP,
    remainingToSpawn: totalATP,
    delivered: { brain: 0, muscle: 0, protein: 0, pumps: 0, other: 0 },
    targets:   distribution,
    flying: [],
    nextSpawn: 0,
    spawnIntervalMs: Math.max(120, Math.min(450, 6000 / Math.max(1, totalATP))),
    zones: [
      { id: 'brain',   icon: '🧠', label: 'Brain (neurons firing)',   x: 240,  y: 200, color: '#ff9ad8', pulse: 0 },
      { id: 'muscle',  icon: '💪', label: 'Muscle (contraction)',     x: 1040, y: 200, color: '#ff6c6c', pulse: 0 },
      { id: 'protein', icon: '🧬', label: 'Protein synthesis',         x: 1040, y: 520, color: '#b6ff7a', pulse: 0 },
      { id: 'pumps',   icon: '⚡', label: 'Ion pumps (Na⁺/K⁺)',         x: 240,  y: 520, color: '#7ec8ff', pulse: 0 },
      { id: 'other',   icon: '🔬', label: 'Everything else',           x: 640,  y: 600, color: '#ffe27a', pulse: 0 }
    ],
    startTime: Date.now(),
    finishedAt: 0,
    canContinue: false
  };
}

function pickSpendingTarget() {
  const s = state.spending;
  // Pick the zone with the largest deficit relative to target
  let best = null;
  let bestDeficit = -Infinity;
  for (const z of s.zones) {
    const deficit = s.targets[z.id] - s.delivered[z.id];
    if (deficit > bestDeficit) {
      bestDeficit = deficit;
      best = z;
    }
  }
  return best;
}

function renderATPSpending(dt) {
  const s = state.spending;
  if (!s) return;
  const W = canvas.width;
  const H = canvas.height;

  // Background — dark with subtle glow
  ctx.fillStyle = '#070a14';
  ctx.fillRect(0, 0, W, H);

  // Title
  ctx.fillStyle = '#ffe27a';
  ctx.font = 'bold 32px sans-serif';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(255,226,122,0.5)';
  ctx.shadowBlur = 16;
  ctx.fillText('💥 ATP SPENT POWERING YOUR CELL', W / 2, 60);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '14px sans-serif';
  ctx.fillText(`${s.totalATP} ATP earned. Watch them fly out to power real cellular work.`, W / 2, 92);

  // Source: glowing ATP pile in the center
  const sourceX = W / 2;
  const sourceY = H / 2;
  const pulse = 1 + Math.sin(Date.now() * 0.005) * 0.15;
  ctx.save();
  ctx.shadowColor = '#ffe27a';
  ctx.shadowBlur = 60 * pulse;
  ctx.fillStyle = `rgba(255,226,122,${0.5 + 0.3 * Math.sin(Date.now() * 0.004)})`;
  ctx.beginPath();
  ctx.arc(sourceX, sourceY, 70 * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(`${s.remainingToSpawn}`, sourceX, sourceY - 5);
  ctx.font = '11px sans-serif';
  ctx.fillText('ATP left', sourceX, sourceY + 12);
  ctx.restore();

  // Spawn new ATP molecules
  if (s.remainingToSpawn > 0) {
    s.nextSpawn -= dt;
    if (s.nextSpawn <= 0) {
      const target = pickSpendingTarget();
      if (target && s.delivered[target.id] < s.targets[target.id]) {
        const angle = Math.atan2(target.y - sourceY, target.x - sourceX);
        const jitter = (Math.random() - 0.5) * 0.6;
        s.flying.push({
          x: sourceX,
          y: sourceY,
          tx: target.x,
          ty: target.y,
          target: target.id,
          color: target.color,
          age: 0,
          duration: 900 + Math.random() * 400,
          curveOffset: (Math.random() - 0.5) * 120
        });
        s.remainingToSpawn -= 1;
        s.nextSpawn = s.spawnIntervalMs;
      } else {
        s.nextSpawn = 30;
      }
    }
  }

  // Update + draw flying ATP molecules
  for (let i = s.flying.length - 1; i >= 0; i--) {
    const m = s.flying[i];
    m.age += dt;
    const t = Math.min(1, m.age / m.duration);
    // Bezier-ish curve: midpoint pulled perpendicular for arc
    const mx = (m.x + m.tx) / 2;
    const my = (m.y + m.ty) / 2;
    const dx = m.tx - m.x;
    const dy = m.ty - m.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const px = -dy / len * m.curveOffset;
    const py =  dx / len * m.curveOffset;
    const cx = mx + px;
    const cy = my + py;
    // Quadratic bezier
    const u = 1 - t;
    const x = u * u * m.x + 2 * u * t * cx + t * t * m.tx;
    const y = u * u * m.y + 2 * u * t * cy + t * t * m.ty;

    // Draw glow trail
    ctx.save();
    ctx.shadowColor = m.color;
    ctx.shadowBlur = 18;
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ATP', x, y);
    ctx.restore();

    if (t >= 1) {
      // Arrived at zone — credit it, pulse it, remove
      s.delivered[m.target] = (s.delivered[m.target] || 0) + 1;
      const z = s.zones.find(z => z.id === m.target);
      if (z) z.pulse = 700;
      state.sfx && state.sfx('collect');
      s.flying.splice(i, 1);
    }
  }

  // Draw zones
  for (const z of s.zones) {
    z.pulse = Math.max(0, z.pulse - dt);
    const pulseScale = 1 + (z.pulse / 700) * 0.25;
    const r = 70 * pulseScale;

    ctx.save();
    // Zone background
    ctx.shadowColor = z.color;
    ctx.shadowBlur = 24 * pulseScale;
    ctx.fillStyle = `${z.color}33`;
    ctx.beginPath();
    ctx.arc(z.x, z.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = z.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(z.x, z.y, r, 0, Math.PI * 2);
    ctx.stroke();
    // Icon
    ctx.font = '36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(z.icon, z.x, z.y - 8);
    // Counter
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText(`${s.delivered[z.id]} / ${s.targets[z.id]}`, z.x, z.y + 24);
    // Label below
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(z.label, z.x, z.y + r + 18);
    ctx.restore();
  }

  // Check completion
  if (s.remainingToSpawn === 0 && s.flying.length === 0 && !s.canContinue) {
    s.canContinue = true;
    s.finishedAt = Date.now();
    showSpendingContinueButton();
  }

  // Progress sentence under the title
  const delivered = Object.values(s.delivered).reduce((a, b) => a + b, 0);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`Delivered: ${delivered} / ${s.totalATP} ATP`, W / 2, 116);
}

function showSpendingContinueButton() {
  // Overlay only the button — keep canvas animation visible behind
  const html = `
    <div class="panel" style="background:rgba(10,15,28,0.92); border:2px solid #ffe27a;">
      <h2 style="color:#ffe27a;">✓ Every ATP spent</h2>
      <p style="font-size:14px;">Your cell just powered: thinking, moving, breathing, and staying alive. Every glucose molecule you eat does this — in trillions of cells, every second, your whole life.</p>
      <button class="btn" onclick="showGameComplete()">▶ See Final Score</button>
    </div>
  `;
  showOverlay(html);
}

function showGameComplete() {
  hideOverlay();
  state.screen = 'GAME_COMPLETE';
  state.gameEndTime = Date.now();
  const totalATP = state.totalATP;
  const totalTime = formatTime(state.gameEndTime - state.gameStartTime);
  const heatLost = Math.round(state.heat);
  const grade = totalATP >= 40 ? 'S — Cellular Mastery' :
                totalATP >= 30 ? 'A — Strong understanding' :
                totalATP >= 20 ? 'B — Solid knowledge' :
                totalATP >= 10 ? 'C — Some learning' :
                'D — Review the material';
  const [l1, l2, l3, l4] = state.atpByLevel;
  // Where ATP would actually get spent in a real cell (illustrative split)
  const muscleATP = Math.round(totalATP * 0.25);
  const brainATP = Math.round(totalATP * 0.20);
  const proteinATP = Math.round(totalATP * 0.20);
  const pumpATP = Math.round(totalATP * 0.20);
  const otherATP = totalATP - muscleATP - brainATP - proteinATP - pumpATP;
  showOverlay(`
    <div class="panel" style="max-width:720px;">
      <h1>🏁 Respiration Complete!</h1>
      <p>You guided one glucose molecule from cytoplasm to the inner mitochondrial membrane. Here's what your cell just produced:</p>

      <div style="display:flex; justify-content:space-around; margin:20px 0; text-align:center;">
        <div>
          <div style="font-size:34px; color:#ffe27a; text-shadow:0 0 24px rgba(255,226,122,0.6);">${totalATP}</div>
          <div style="font-size:12px; color:#aac;">ATP EARNED</div>
        </div>
        <div>
          <div style="font-size:34px; color:#ff8866; text-shadow:0 0 24px rgba(255,136,102,0.6);">${heatLost}</div>
          <div style="font-size:12px; color:#aac;">🔥 HEAT LOST</div>
        </div>
        <div>
          <div style="font-size:34px; color:#7ec8ff; text-shadow:0 0 24px rgba(126,200,255,0.6);">${totalTime}</div>
          <div style="font-size:12px; color:#aac;">TIME</div>
        </div>
      </div>

      <p style="text-align:center; font-size:16px; color:#7ec8ff;">${grade}</p>

      <h2 style="margin-top:18px; font-size:18px; color:#ffe27a;">ATP by stage (real biology in parentheses)</h2>
      <div style="font-size:14px; line-height:1.7;">
        <div>Lv 1 — Glycolysis: <strong>${l1} ATP</strong> <span style="color:#aac;">(real: ~2 ATP)</span></div>
        <div>Lv 2 — Pyruvate Oxidation: <strong>${l2} ATP</strong> <span style="color:#aac;">(real: 0 direct — but 2 NADH worth ~5 later)</span></div>
        <div>Lv 3 — Krebs Cycle: <strong>${l3} ATP</strong> <span style="color:#aac;">(real: ~2 direct, plus carriers worth ~22 later)</span></div>
        <div>Lv 4 — ETC: <strong>${l4} ATP</strong> <span style="color:#aac;">(real: ~26-28 ATP — the big one)</span></div>
      </div>

      <h2 style="margin-top:18px; font-size:18px; color:#ffe27a;">Where your cell would SPEND ${totalATP} ATP</h2>
      <div style="font-size:14px; line-height:1.7;">
        <div>💪 Muscle contraction: <strong>~${muscleATP} ATP</strong></div>
        <div>🧠 Brain / nerve impulses: <strong>~${brainATP} ATP</strong></div>
        <div>🧬 Building proteins: <strong>~${proteinATP} ATP</strong></div>
        <div>⚡ Ion pumps (sodium/potassium): <strong>~${pumpATP} ATP</strong></div>
        <div>🔬 Everything else (DNA, transport, etc.): <strong>~${otherATP} ATP</strong></div>
      </div>

      <p style="margin-top:14px; font-size:13px; color:#aac;">
        <strong>The master equation:</strong> C₆H₁₂O₆ + 6 O₂ → 6 CO₂ + 6 H₂O + ~32 ATP + heat<br>
        Every cell in your body does this every second of your life. Right now, in fact. 🧬
      </p>

      <button class="btn" onclick="showTitle()">▶ Play Again</button>
      <button class="btn secondary" onclick="showCodex()">📖 Bio-Codex</button>
    </div>
  `);
}

function showCodex() {
  showOverlay(`
    <div class="panel">
      <h2>📖 Bio-Codex</h2>
      <p style="font-size:14px; color:#aac;">What each game element actually is</p>
      <div class="codex-list">
        ${CODEX.map(c => `<div class="codex-item"><strong>${c.name}</strong><br>${c.body}</div>`).join('')}
      </div>
      <button class="btn" onclick="hideCodex()">▶ Back</button>
    </div>
  `);
}

function hideCodex() {
  if (state.screen === 'PLAYING') hideOverlay();
  else if (state.screen === 'GAME_COMPLETE') showGameComplete();
  else showTitle();
}

// Expose for inline onclick handlers
window.startGame = startGame;
window.beginLevel = beginLevel;
window.answerDeathQuestion = answerDeathQuestion;
window.resumeFromCheckpoint = resumeFromCheckpoint;
window.restartLevelFromStart = restartLevelFromStart;
window.startInterLevelQuiz = startInterLevelQuiz;
window.showInterLevelQuestion = showInterLevelQuestion;
window.answerInterLevelQuiz = answerInterLevelQuiz;
window.advanceToNextLevel = advanceToNextLevel;
window.startATPSpendingScene = startATPSpendingScene;
window.showGameComplete = showGameComplete;
window.showTitle = showTitle;
window.showCodex = showCodex;
window.hideCodex = hideCodex;

// ---------- Input ----------
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.key === ' ') {
    if (!e.repeat) state.input.jumpPressed = true;
    state.input.jumpHeld = true;
    e.preventDefault();
  }
  if (e.key === 'p' || e.key === 'P') {
    if (state.screen === 'PLAYING') showCodex();
  }
  if (e.key === 'm' || e.key === 'M') {
    setMuted(!state.audioMuted);
  }
  if (state.screen === 'DEATH_QUESTION' && !state.questionAnswered) {
    const num = parseInt(e.key);
    if (num >= 1 && num <= 4) answerDeathQuestion(num - 1);
  }
  if (state.screen === 'INTER_LEVEL_QUIZ' && !state.interQuizAnswered) {
    const num = parseInt(e.key);
    if (num >= 1 && num <= 4) answerInterLevelQuiz(num - 1);
  }
});

document.addEventListener('keyup', (e) => {
  if (e.code === 'Space' || e.key === ' ') {
    state.input.jumpHeld = false;
  }
});

canvas.addEventListener('mousedown', () => {
  if (state.screen === 'PLAYING') {
    state.input.jumpPressed = true;
    state.input.jumpHeld = true;
  }
});
canvas.addEventListener('mouseup', () => {
  state.input.jumpHeld = false;
});

// ---------- Main loop ----------
function gameLoop(t) {
  const dt = Math.min(48, t - state.lastTime || 16);
  state.lastTime = t;

  if (state.screen === 'PLAYING') {
    const lvl = LEVELS[state.levelIndex];
    lvl.update(dt, state.input, state);
    lvl.render(ctx, state);
    // Slide/run sound while on ground
    if (state.player.onGround && !state.audioMuted) {
      if (!state.slideSound.active) startSlideSound();
    } else if (state.slideSound.active) {
      stopSlideSound();
    }
  } else if (state.screen === 'COUNTDOWN') {
    renderCountdown(dt);
  } else if (state.screen === 'ATP_SPENDING') {
    renderATPSpending(dt);
  } else if (state.screen === 'DEATH') {
    if (state.slideSound.active) stopSlideSound();
    const lvl = LEVELS[state.levelIndex];
    lvl.render(ctx, state); // particles keep animating
    state.deathTimer -= dt;
    if (state.deathTimer <= 0) {
      triggerDeathQuestion();
    }
  } else {
    if (state.slideSound.active) stopSlideSound();
    state.elapsed = (state.elapsed || 0) + dt;
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < 14; i++) {
      const x = (i * 130 + state.elapsed * 0.03) % (canvas.width + 200) - 100;
      const y = 120 + (i * 50) % 480 + Math.sin(state.elapsed * 0.001 + i) * 30;
      ctx.fillStyle = `rgba(120,180,255,${0.04 + (i % 3) * 0.02})`;
      ctx.beginPath();
      ctx.arc(x, y, 60 + (i % 4) * 20, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.font = 'bold 80px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CELLULAR RESPIRATION', canvas.width/2, canvas.height/2);
  }

  updateHUD();
  state.input.jumpPressed = false;
  requestAnimationFrame(gameLoop);
}

window.addEventListener('load', () => {
  showTitle();
  requestAnimationFrame(gameLoop);
});

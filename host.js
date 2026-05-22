// Host UI: PIN entry → lobby → live dashboard → game over

const stepPin = document.getElementById('step-pin');
const stepLobby = document.getElementById('step-lobby');
const stepDash = document.getElementById('step-dashboard');
const stepOver = document.getElementById('step-over');
const pinInput = document.getElementById('pin-input');
const pinSubmit = document.getElementById('pin-submit');
const pinError = document.getElementById('pin-error');
const gameCodeEl = document.getElementById('game-code');
const joinUrlEl = document.getElementById('join-url');
const playerCountEl = document.getElementById('player-count');
const lobbyPlayersEl = document.getElementById('lobby-players');
const startBtn = document.getElementById('start-btn');
const dashboardRows = document.getElementById('dashboard-rows');
const podiumEl = document.getElementById('podium');
const finalRowsEl = document.getElementById('final-rows');

let ws = null;
let gameCode = null;

function show(step) {
  for (const s of [stepPin, stepLobby, stepDash, stepOver]) s.style.display = 'none';
  step.style.display = 'block';
}

function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/`);
  ws.onopen = () => console.log('WS connected');
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    handleMessage(msg);
  };
  ws.onclose = () => console.log('WS closed');
  ws.onerror = (e) => console.error('WS error', e);
}

function handleMessage(msg) {
  if (msg.type === 'host:created') {
    gameCode = msg.code;
    gameCodeEl.textContent = gameCode;
    const host = location.host;
    joinUrlEl.textContent = `http://${host}/join`;
    show(stepLobby);
  } else if (msg.type === 'lobby:update') {
    renderLobby(msg.players || []);
  } else if (msg.type === 'game:started') {
    show(stepDash);
  } else if (msg.type === 'dashboard:update') {
    renderDashboard(msg.players || []);
  } else if (msg.type === 'game:over') {
    renderGameOver(msg.finishers || [], msg.all || []);
  } else if (msg.type === 'error') {
    pinError.textContent = msg.message || 'Error';
    pinInput.value = '';
  }
}

function renderLobby(players) {
  playerCountEl.textContent = players.length;
  if (players.length === 0) {
    lobbyPlayersEl.innerHTML = `<div class="h-empty">Waiting for players...</div>`;
    return;
  }
  lobbyPlayersEl.innerHTML = players.map((p, i) => `
    <div class="h-player-row">
      <div>👤 ${escapeHtml(p.name)}</div>
      <div style="color:#7a8aa8; font-size:13px;">#${i + 1}</div>
    </div>`).join('');
}

function renderDashboard(players) {
  const top5 = players.slice(0, 5);
  if (top5.length === 0) {
    dashboardRows.innerHTML = `<div class="h-empty">No players yet.</div>`;
    return;
  }
  dashboardRows.innerHTML = top5.map((p, i) => {
    const placeBadge = p.finished && p.place
      ? `<span class="place-badge place-${p.place}">${p.place === 1 ? '🥇 1st' : p.place === 2 ? '🥈 2nd' : '🥉 3rd'}</span>`
      : '';
    return `
      <div class="dash-row ${p.finished ? 'finished' : ''}">
        <div class="rank">${i + 1}</div>
        <div class="name">${escapeHtml(p.name)} ${placeBadge}</div>
        <div class="pct">${p.percent.toFixed(0)}%</div>
        <div class="atp">${p.atp} ATP</div>
        <div class="bar-wrap"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, p.percent))}%"></div></div>
      </div>`;
  }).join('');
}

function renderGameOver(finishers, all) {
  podiumEl.innerHTML = finishers.map(f => {
    const emoji = f.place === 1 ? '🥇' : f.place === 2 ? '🥈' : '🥉';
    const timeS = (f.time / 1000).toFixed(1);
    return `<div class="dash-row finished" style="font-size:20px;">
      <div class="rank">${emoji}</div>
      <div class="name">${escapeHtml(f.name)}</div>
      <div class="pct">${timeS}s</div>
      <div class="atp">${f.atp} ATP</div>
    </div>`;
  }).join('');
  finalRowsEl.innerHTML = all.map((p, i) => `
    <div class="dash-row ${p.finished ? 'finished' : ''}">
      <div class="rank">${i + 1}</div>
      <div class="name">${escapeHtml(p.name)}</div>
      <div class="pct">${p.percent.toFixed(0)}%</div>
      <div class="atp">${p.atp} ATP</div>
    </div>`).join('');
  show(stepOver);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

pinSubmit.addEventListener('click', submitPin);
pinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitPin(); });
function submitPin() {
  const pin = pinInput.value.trim();
  if (!pin) return;
  pinError.textContent = '';
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    connectWs();
    setTimeout(() => ws.send(JSON.stringify({ type: 'host:create', pin })), 250);
  } else {
    ws.send(JSON.stringify({ type: 'host:create', pin }));
  }
}

startBtn.addEventListener('click', () => {
  if (ws && ws.readyState === WebSocket.OPEN && gameCode) {
    ws.send(JSON.stringify({ type: 'host:start', code: gameCode }));
  }
});

window.addEventListener('load', () => connectWs());

// Biology-game-live — multiplayer wrapper around the existing single-player game.
// Adds: WebSocket session manager + landing/host/join pages.
// The game itself (game.js, levels.js, questions.js) is unchanged.
//
// Run with: node server.js   (defaults to port 8002)

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8002;
const HOST_PIN = '123';
const FINISHES_NEEDED = 3;     // first N players to finish ends the game
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.mp3':  'audio/mpeg', '.ogg':  'audio/ogg', '.wav':  'audio/wav',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8',
  '.md':   'text/markdown; charset=utf-8'
};

// ----- Routing for the HTML pages -----
const ROUTE_TO_FILE = {
  '/':         '/landing.html',
  '/host':     '/host.html',
  '/join':     '/join.html',
  '/play':     '/play.html',
  // VibeCut Studio (served from the vibecut-web folder)
  '/vibecut':      '/vibecut-web/studio.html',
  '/vibecut/':     '/vibecut-web/studio.html',
  '/vibecut/demo': '/vibecut-web/index.html'
};

// ----- Sessions (in-memory) -----
const sessions = new Map();

function newGameCode() {
  let code;
  for (let i = 0; i < 50; i++) {
    code = String(Math.floor(1000 + Math.random() * 9000));
    if (!sessions.has(code)) return code;
  }
  return String(Math.floor(10000 + Math.random() * 90000));
}

function newId() { return crypto.randomBytes(6).toString('hex'); }

function createSession(hostWs) {
  const code = newGameCode();
  const session = {
    code, hostWs,
    players: new Map(),
    started: false, gameOver: false,
    finishOrder: [],
    startedAt: 0
  };
  sessions.set(code, session);
  return session;
}

function broadcastToPlayers(session, msg) {
  const str = JSON.stringify(msg);
  for (const p of session.players.values()) {
    if (p.ws && p.ws.readyState === WebSocket.OPEN) p.ws.send(str);
  }
}
function sendToHost(session, msg) {
  if (session.hostWs && session.hostWs.readyState === WebSocket.OPEN) {
    session.hostWs.send(JSON.stringify(msg));
  }
}
function sendToWs(ws, msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function lobbySnapshot(session) {
  return Array.from(session.players.values()).map(p => ({
    playerId: p.id, name: p.name, joinedAt: p.joinedAt
  }));
}
function dashboardSnapshot(session) {
  const arr = Array.from(session.players.values()).map(p => ({
    playerId: p.id, name: p.name,
    atp: p.atp || 0, percent: p.percent || 0,
    finished: p.finished || false, place: p.place || null
  }));
  arr.sort((a, b) => {
    if (a.finished && b.finished) return a.place - b.place;
    if (a.finished) return -1;
    if (b.finished) return 1;
    if (b.percent !== a.percent) return b.percent - a.percent;
    return b.atp - a.atp;
  });
  return arr;
}

function checkGameEnd(session) {
  if (session.gameOver) return;
  if (session.finishOrder.length >= FINISHES_NEEDED) {
    session.gameOver = true;
    const finishers = session.finishOrder.map((pid, i) => {
      const p = session.players.get(pid);
      return p ? { name: p.name, place: i + 1, atp: p.atp, time: p.finishTime - session.startedAt } : null;
    }).filter(Boolean);
    const all = dashboardSnapshot(session);
    broadcastToPlayers(session, { type: 'game:over', finishers, all });
    sendToHost(session, { type: 'game:over', finishers, all });
  }
}

// ----- HTTP server (static + routes) -----
const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

  // Tiny JSON API: check if a game code is valid before joining.
  if (urlPath === '/api/check-code') {
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const code = String(u.searchParams.get('code') || '').trim();
    const s = sessions.get(code);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify({
      exists: !!s,
      gameOver: s ? !!s.gameOver : false,
      started: s ? !!s.started : false
    }));
  }

  if (ROUTE_TO_FILE[urlPath]) urlPath = ROUTE_TO_FILE[urlPath];

  const safePath = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(ROOT, safePath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});

// ----- WebSocket server -----
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  ws.role = null;
  ws.sessionCode = null;
  ws.playerId = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    try { handleMessage(ws, msg); }
    catch (err) {
      console.error('Message error:', err);
      sendToWs(ws, { type: 'error', message: String(err.message || err) });
    }
  });

  ws.on('close', () => {
    if (ws.role === 'host' && ws.sessionCode) {
      const s = sessions.get(ws.sessionCode);
      if (s && s.hostWs === ws) {
        broadcastToPlayers(s, { type: 'host:disconnected' });
        setTimeout(() => {
          if (s.hostWs === ws) sessions.delete(s.code);
        }, 30000);
      }
    } else if (ws.role === 'player' && ws.sessionCode && ws.playerId) {
      const s = sessions.get(ws.sessionCode);
      if (s) {
        s.players.delete(ws.playerId);
        sendToHost(s, { type: 'dashboard:update', players: dashboardSnapshot(s) });
        if (!s.started) sendToHost(s, { type: 'lobby:update', players: lobbySnapshot(s) });
      }
    }
  });
});

function handleMessage(ws, msg) {
  if (msg.type === 'host:create') {
    if (String(msg.pin) !== HOST_PIN) {
      sendToWs(ws, { type: 'error', message: 'Wrong PIN' });
      return;
    }
    const s = createSession(ws);
    ws.role = 'host';
    ws.sessionCode = s.code;
    sendToWs(ws, { type: 'host:created', code: s.code });
    sendToWs(ws, { type: 'lobby:update', players: lobbySnapshot(s) });
    return;
  }
  if (msg.type === 'guest:join') {
    const code = String(msg.code || '').trim();
    const name = String(msg.name || '').trim().slice(0, 24) || 'Anonymous';
    const s = sessions.get(code);
    if (!s) { sendToWs(ws, { type: 'error', message: 'Game code not found' }); return; }
    const pid = newId();
    const player = {
      id: pid, name, ws,
      atp: 0, level: 0, progress: 0, percent: 0,
      finished: false, finishTime: 0, place: null,
      joinedAt: Date.now()
    };
    s.players.set(pid, player);
    ws.role = 'player';
    ws.sessionCode = code;
    ws.playerId = pid;
    sendToWs(ws, {
      type: 'guest:joined', playerId: pid, name,
      state: s.started ? (s.gameOver ? 'game-over' : 'playing') : 'lobby'
    });
    sendToHost(s, { type: 'lobby:update', players: lobbySnapshot(s) });
    sendToHost(s, { type: 'dashboard:update', players: dashboardSnapshot(s) });
    if (s.started && !s.gameOver) {
      sendToWs(ws, { type: 'game:start' });
    }
    return;
  }
  if (msg.type === 'host:start') {
    const s = sessions.get(ws.sessionCode);
    if (!s || s.hostWs !== ws) return;
    s.started = true;
    s.startedAt = Date.now();
    broadcastToPlayers(s, { type: 'game:start' });
    sendToHost(s, { type: 'game:started' });
    sendToHost(s, { type: 'dashboard:update', players: dashboardSnapshot(s) });
    return;
  }
  if (msg.type === 'player:progress') {
    const s = sessions.get(ws.sessionCode);
    if (!s || !ws.playerId) return;
    const p = s.players.get(ws.playerId);
    if (!p || p.finished) return;
    if (typeof msg.level === 'number')    p.level = msg.level;
    if (typeof msg.progress === 'number') p.progress = msg.progress;
    if (typeof msg.atp === 'number')      p.atp = msg.atp;
    if (typeof msg.percent === 'number')  p.percent = msg.percent;
    sendToHost(s, { type: 'dashboard:update', players: dashboardSnapshot(s) });
    return;
  }
  if (msg.type === 'player:finished') {
    const s = sessions.get(ws.sessionCode);
    if (!s || s.gameOver || !ws.playerId) return;
    const p = s.players.get(ws.playerId);
    if (!p || p.finished) return;
    p.finished = true;
    p.finishTime = Date.now();
    p.percent = 100;
    s.finishOrder.push(p.id);
    p.place = s.finishOrder.length;
    sendToHost(s, { type: 'dashboard:update', players: dashboardSnapshot(s) });
    sendToWs(ws, { type: 'you:finished', place: p.place });
    checkGameEnd(s);
    return;
  }
}

server.listen(PORT, () => {
  console.log(`Biology-game-live multiplayer server`);
  console.log(`  HTTP:      http://localhost:${PORT}/`);
  console.log(`  Landing:   /`);
  console.log(`  Host:      /host  (PIN ${HOST_PIN})`);
  console.log(`  Join:      /join`);
  console.log(`  WebSocket: ws://localhost:${PORT}/`);
});

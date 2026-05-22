// Multiplayer wrapper that sits ON TOP of the existing single-player game.
// Does NOT modify game.js, levels.js, or questions.js.
// - Reads URL params (code, name)
// - Connects to WebSocket server
// - Blocks the title screen "Start" button until host starts the game
// - Reports progress (level, scrollX, ATP, percent) every 500ms
// - Detects "finished" when state.screen transitions to ATP_SPENDING / GAME_COMPLETE
// - Listens for game:over and freezes the game with a final results overlay

(function () {
  // ---------- Setup ----------
  const params = new URLSearchParams(location.search);
  const code = params.get('code') || '';
  const name = params.get('name') || 'Anonymous';

  const waitOverlay  = document.getElementById('mp-wait-overlay');
  const waitTitle    = document.getElementById('mp-wait-title');
  const waitSub      = document.getElementById('mp-wait-sub');
  const placeBanner  = document.getElementById('mp-place-banner');
  document.getElementById('mp-name').textContent = name;
  document.getElementById('mp-code').textContent = code;

  let ws = null;
  let playerId = null;
  let gameStarted = false;
  let gameOverFinal = false;
  let finishedReported = false;
  let myPlace = null;

  function showWait(title, sub) {
    waitTitle.textContent = title;
    waitSub.textContent = sub;
    waitOverlay.style.display = 'flex';
  }
  function hideWait() {
    waitOverlay.style.display = 'none';
  }

  // ---------- Hijack startGame so the player can't bypass the host ----------
  // The existing game.js calls showTitle() on load. That shows the START button.
  // We replace window.startGame with a wrapper that blocks until host:start arrives.
  const originalStartGame = window.startGame;
  window.startGame = function () {
    if (!gameStarted) {
      // Re-show wait overlay if the player tries to start solo
      showWait('⏳ Waiting for host', 'The host hasn\'t started the game yet.');
      return;
    }
    originalStartGame();
  };

  // ---------- WebSocket ----------
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'guest:join', code, name }));
    };
    ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      handleMessage(msg);
    };
    ws.onerror = (e) => console.error('WS error', e);
    ws.onclose = () => {
      if (!gameOverFinal) {
        showWait('⚠ Disconnected', 'Lost connection to the game server.');
      }
    };
  }

  function handleMessage(msg) {
    if (msg.type === 'guest:joined') {
      playerId = msg.playerId;
      if (msg.state === 'lobby') {
        showWait('⏳ In lobby', 'Waiting for the host to start the game...');
      } else if (msg.state === 'playing') {
        // Game already started before we joined — go directly in
        gameStarted = true;
        hideWait();
        originalStartGame();
      } else if (msg.state === 'game-over') {
        showWait('Game already over', 'This game session has already finished.');
      }
    } else if (msg.type === 'game:start') {
      gameStarted = true;
      hideWait();
      originalStartGame();
    } else if (msg.type === 'you:finished') {
      myPlace = msg.place;
      const medal = msg.place === 1 ? '🥇' : msg.place === 2 ? '🥈' : msg.place === 3 ? '🥉' : '✓';
      const placeText = msg.place === 1 ? '1st' : msg.place === 2 ? '2nd' : msg.place === 3 ? '3rd' : `${msg.place}th`;
      placeBanner.innerHTML = `${medal} You finished ${placeText}!`;
      placeBanner.style.display = 'block';
    } else if (msg.type === 'game:over') {
      gameOverFinal = true;
      showGameOverScreen(msg.finishers || [], msg.all || []);
    } else if (msg.type === 'host:disconnected') {
      showWait('⚠ Host left', 'The host disconnected.');
    } else if (msg.type === 'error') {
      showWait('⚠ ' + (msg.message || 'Error'), 'Please go back and try again.');
    }
  }

  // ---------- Progress reporter (runs every 500ms) ----------
  // Game state and LEVELS array are exposed via the bridge <script> in play.html as
  // window.__gameState and window.__gameLevels.
  function computePercent() {
    const s = window.__gameState;
    const LV = window.__gameLevels;
    if (!s) return 0;
    const screen = s.screen;
    const levelIdx = s.levelIndex || 0;
    const LEVELS_COUNT = (LV && LV.length) || 4;
    const pctPerLevel = 100 / LEVELS_COUNT;

    if (screen === 'TITLE' || screen === 'INTRO') return levelIdx * pctPerLevel;
    if (screen === 'PLAYING' || screen === 'COUNTDOWN' || screen === 'DEATH' || screen === 'DEATH_QUESTION' || screen === 'NO_QUESTIONS') {
      const lvl = LV && LV[levelIdx];
      const scroll = s.scrollX || 0;
      const len = (lvl && lvl.length) || 1;
      const within = Math.max(0, Math.min(1, scroll / len));
      return levelIdx * pctPerLevel + within * pctPerLevel;
    }
    if (screen === 'LEVEL_COMPLETE' || screen === 'INTER_LEVEL_QUIZ') {
      return (levelIdx + 1) * pctPerLevel - 0.5;
    }
    if (screen === 'ATP_SPENDING' || screen === 'GAME_COMPLETE') return 100;
    return 0;
  }

  function reportProgress() {
    if (!ws || ws.readyState !== WebSocket.OPEN || !playerId) return;
    const s = window.__gameState;
    if (!s) return;
    if (gameOverFinal) return;

    const LV = window.__gameLevels;
    const percent = computePercent();
    const level = s.levelIndex || 0;
    const atp = s.totalATP || 0;
    const lvl = LV && LV[level];
    const scroll = s.scrollX || 0;
    const len = (lvl && lvl.length) || 1;
    const progress = Math.max(0, Math.min(1, scroll / len));

    ws.send(JSON.stringify({
      type: 'player:progress',
      level, progress, atp, percent
    }));

    if (!finishedReported && (s.screen === 'ATP_SPENDING' || s.screen === 'GAME_COMPLETE')) {
      finishedReported = true;
      ws.send(JSON.stringify({ type: 'player:finished' }));
    }
  }
  setInterval(reportProgress, 500);

  // ---------- Game-over screen ----------
  function showGameOverScreen(finishers, all) {
    // Stop the game by overlaying a final results panel.
    // We don't touch the game's state directly — just cover it.
    const overlay = document.getElementById('overlay');
    const content = document.getElementById('overlay-content');
    if (!overlay || !content) return;

    const podiumHtml = finishers.map(f => {
      const medal = f.place === 1 ? '🥇' : f.place === 2 ? '🥈' : '🥉';
      const time = (f.time / 1000).toFixed(1);
      return `<div style="display:flex; justify-content:space-between; padding:10px 14px; background:rgba(108,240,108,0.18); border:1px solid #6cf06c; border-radius:6px; margin-bottom:6px;">
        <span><strong>${medal} ${escapeHtml(f.name)}</strong></span>
        <span>${time}s · ${f.atp} ATP</span>
      </div>`;
    }).join('');

    const myRow = all.find(p => p.playerId === playerId);
    const myRank = myRow ? all.indexOf(myRow) + 1 : '—';
    const allHtml = all.slice(0, 10).map((p, i) => {
      const me = (p.playerId === playerId);
      return `<div style="display:flex; justify-content:space-between; padding:6px 10px; background:${me ? 'rgba(126,200,255,0.15)' : 'rgba(40,70,120,0.4)'}; border-radius:4px; margin-bottom:4px; font-size:14px;">
        <span>${i + 1}. ${escapeHtml(p.name)} ${me ? '<strong>(you)</strong>' : ''} ${p.finished ? '✓' : ''}</span>
        <span>${p.percent.toFixed(0)}% · ${p.atp} ATP</span>
      </div>`;
    }).join('');

    content.innerHTML = `
      <div class="panel">
        <h1 style="color:#ffe27a; text-align:center;">🏁 GAME OVER</h1>
        <h2 style="text-align:center; color:#7ec8ff;">${myPlace ? `You finished ${myPlace === 1 ? '1st' : myPlace === 2 ? '2nd' : myPlace === 3 ? '3rd' : myPlace + 'th'}` : `You placed #${myRank}`}</h2>
        <h3 style="margin-top:18px; color:#ffe27a;">🏆 Podium</h3>
        ${podiumHtml || '<p>No one finished.</p>'}
        <h3 style="margin-top:18px; color:#ffe27a;">All players</h3>
        ${allHtml}
        <button class="btn" style="width:100%; margin-top:16px;" onclick="location.href='/'">▶ Back to landing</button>
      </div>`;
    overlay.classList.add('active');
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Connect once the page is fully loaded
  if (code && name) {
    connect();
  } else {
    showWait('⚠ Missing info', 'No game code or name. Please go back and join again.');
  }
})();

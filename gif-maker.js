// AI GIF Maker — client side.
// 1) Ask the server to generate an image from the user's text prompt (OpenAI).
// 2) Turn that still image into a seamless, looping 2-second animated GIF
//    by encoding a sine-driven "float + pulse" motion entirely in the browser.

const GIF_WORKER = 'https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js';

// GIF timing: 20 frames x 100ms = 2000ms (exactly 2 seconds), looping forever.
const OUT_SIZE   = 512;   // output GIF dimensions (square)
const FRAMES     = 20;
const FRAME_MS   = 100;
const PAN        = 0.035;  // pan radius as a fraction of size
const SCALE_BASE = 1.10;   // zoom so there's room to pan without showing edges
const SCALE_AMP  = 0.05;   // pulse amount

const form     = document.getElementById('gm-form');
const promptEl = document.getElementById('gm-prompt');
const goBtn    = document.getElementById('gm-go');
const statusEl = document.getElementById('gm-status');
const resultEl = document.getElementById('gm-result');
const imgEl    = document.getElementById('gm-img');
const dlEl     = document.getElementById('gm-download');
const againBtn = document.getElementById('gm-again');
const canvas   = document.getElementById('work');

function setStatus(text, isError, spinner) {
  statusEl.className = 'gm-status' + (isError ? ' error' : '');
  statusEl.innerHTML = (spinner ? '<span class="gm-spinner"></span>' : '') + text;
}

function setBusy(busy) {
  goBtn.disabled = busy;
  promptEl.disabled = busy;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const prompt = promptEl.value.trim();
  if (!prompt) { setStatus('Please describe the GIF you want first.', true); return; }

  setBusy(true);
  resultEl.classList.remove('show');
  setStatus('Generating image with AI…', false, true);

  try {
    const res = await fetch('/api/generate-gif', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status})`);
    if (!data.b64_json) throw new Error('No image was returned.');

    setStatus('Animating into a looping GIF…', false, true);
    const img = await loadImage('data:image/png;base64,' + data.b64_json);
    const blob = await buildLoopingGif(img);

    const url = URL.createObjectURL(blob);
    imgEl.src = url;
    dlEl.href = url;
    dlEl.download = slugify(prompt) + '.gif';
    resultEl.classList.add('show');
    setStatus('Done! Your 2-second GIF loops forever. 🎉');
  } catch (err) {
    setStatus(err.message || String(err), true);
  } finally {
    setBusy(false);
  }
});

againBtn.addEventListener('click', () => {
  resultEl.classList.remove('show');
  setStatus('');
  promptEl.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load the generated image.'));
    img.src = src;
  });
}

// Encode a seamless looping GIF. Motion uses sin/cos over a full period so the
// last frame matches the first — the replay is invisible.
function buildLoopingGif(img) {
  return new Promise((resolve, reject) => {
    if (typeof GIF === 'undefined') {
      reject(new Error('GIF encoder failed to load (check your connection).'));
      return;
    }
    canvas.width = OUT_SIZE;
    canvas.height = OUT_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const gif = new GIF({
      workers: 2,
      quality: 8,
      width: OUT_SIZE,
      height: OUT_SIZE,
      repeat: 0,                // 0 = loop forever
      workerScript: GIF_WORKER
    });

    const panPx = OUT_SIZE * PAN;
    for (let i = 0; i < FRAMES; i++) {
      const phase = (i / FRAMES) * Math.PI * 2;          // 0 .. 2π
      const scale = SCALE_BASE + SCALE_AMP * Math.sin(phase);
      const dx = panPx * Math.sin(phase);
      const dy = panPx * (Math.cos(phase) - 1) * 0.5;    // gentle drift, returns to start

      const drawW = OUT_SIZE * scale;
      const drawH = OUT_SIZE * scale;
      const ox = (OUT_SIZE - drawW) / 2 + dx;
      const oy = (OUT_SIZE - drawH) / 2 + dy;

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, OUT_SIZE, OUT_SIZE);
      ctx.drawImage(img, ox, oy, drawW, drawH);
      gif.addFrame(ctx, { copy: true, delay: FRAME_MS });
    }

    gif.on('finished', (blob) => resolve(blob));
    gif.on('abort', () => reject(new Error('GIF encoding was aborted.')));
    gif.render();
  });
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'ai-gif';
}

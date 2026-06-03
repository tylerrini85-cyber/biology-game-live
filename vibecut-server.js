// VibeCut standalone server — serves the self-contained VibeCut Studio at "/".
// Zero dependencies (Node stdlib only). This is its OWN app, independent of any
// other project: the root URL is VibeCut Studio.
//
// Run:  node vibecut-server.js   (defaults to port 8080 / $PORT)

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const WEB = path.join(ROOT, 'vibecut-web');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg', '.jpeg': 'image/jpeg',
  '.ico':  'image/x-icon',
  '.md':   'text/markdown; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8'
};

// Root + a couple of aliases all serve the full Studio.
const ROUTES = {
  '/':         path.join(WEB, 'studio.html'),
  '/vibecut':  path.join(WEB, 'studio.html'),
  '/studio':   path.join(WEB, 'studio.html'),
  '/demo':     path.join(WEB, 'index.html')
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

  // health check for Railway
  if (urlPath === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }

  let filePath = ROUTES[urlPath];
  if (!filePath) {
    // static files out of vibecut-web only (no traversal)
    const safe = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
    filePath = path.join(WEB, safe);
    if (!filePath.startsWith(WEB)) {
      res.writeHead(403); return res.end('Forbidden');
    }
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // never cache the app so updates show immediately
      'Cache-Control': 'no-store, max-age=0'
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`VibeCut Studio running on http://localhost:${PORT}/`);
});

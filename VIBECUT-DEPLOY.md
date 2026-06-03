# VibeCut Studio — standalone Railway deploy

This branch (`vibecut-app`) is a **standalone VibeCut deployment**. The repo root
runs `vibecut-server.js`, which serves the self-contained VibeCut Studio at the
**root URL** (`/`). It is completely independent of the biology game — nothing
on this branch starts that app.

- Start command: `node vibecut-server.js` (Node stdlib only, **zero dependencies**)
- Routes: `/` and `/vibecut` and `/studio` → the editor; `/demo` → simple demo;
  `/healthz` → health check.

## Deploy on Railway (new project)
1. Go to **railway.app → New Project → Deploy from GitHub repo**.
2. Pick **`tylerrini85-cyber/biology-game-live`**.
3. In the service **Settings → Source**, set **Branch = `vibecut-app`**.
   (Leave Root Directory blank — the app is at the repo root.)
4. Railway auto-detects Node and runs `npm start` → `node vibecut-server.js`.
5. **Settings → Networking → Generate Domain** to get a public URL.

Open that URL → VibeCut Studio loads directly. No Root Directory, no biology game.

# Deploy VibeCut Studio on Railway (from GitHub)

This folder is a self-contained, zero-dependency web service: `serve.py` serves
`studio.html` (the full editor) on `$PORT`. Railway runs it via `railway.json`
(start command `python serve.py`) / `Procfile`.

## One-time setup in Railway
1. Go to **https://railway.app** → **New Project** → **Deploy from GitHub repo**.
2. Pick **`tylerrini85-cyber/biology-game-live`** (authorize GitHub if asked).
3. Open the service **Settings**:
   - **Branch:** `claude/ai-video-editing-research-CnktZ`
   - **Root Directory:** `vibecut-web`   ← important (this folder, not the repo root)
4. Railway auto-detects Python (via `requirements.txt`) and runs `python serve.py`.
5. Under **Settings → Networking → Generate Domain** to get a public URL like
   `https://vibecut-production.up.railway.app`.

Open that URL → VibeCut Studio. `…/demo` serves the simpler one-screen version.

## Notes
- No dependencies are installed (Python stdlib only), so builds are fast.
- The app runs entirely client-side; the server only hosts the static file.
- Auto-deploys on every push to the selected branch.

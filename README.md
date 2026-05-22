# Cellular Respiration — Live Multiplayer

A Kahoot-style live host wrapper around the [single-player biology game](https://github.com/tylerrini85-cyber/biology-game). One person hosts, classmates join with a 4-digit code, and the first 3 to finish the final Level-4 quiz win the podium.

**Architecture:**
- Node HTTP server serves static pages (landing / host / join / play)
- WebSocket server (`ws`) manages live sessions in memory
- The gameplay engine (`game.js`, `levels.js`, `questions.js`) is unchanged — `multiplayer.js` is a thin client-side wrapper that reports progress every 500ms

**Routes:**
| Path | Purpose |
|------|---------|
| `/` | Landing — Host or Join |
| `/host` | PIN `123` → lobby → live dashboard |
| `/join` | Code + name → waiting room |
| `/play` | The actual game (player only) |

**Run locally:**
```bash
npm install
node server.js
```
Defaults to port 8002. Open http://localhost:8002

**Deployment:**
- Designed for Railway / Render / Fly.io — they auto-detect Node + run `npm start`
- WebSocket and HTTP share the same port (Railway-friendly)

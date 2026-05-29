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
| `/gif` | AI GIF Maker — type a prompt → looping 2-second GIF |

**Run locally:**
```bash
npm install
node server.js
```
Defaults to port 8002. Open http://localhost:8002

## AI GIF Maker

Visit `/gif`. Type what you want and it generates a still image with OpenAI's
most recent image model (`gpt-image-1`), then animates it in the browser into a
seamless **2-second looping GIF** you can download.

The server keeps your ChatGPT API key secret — set it as an environment variable
before starting:

```bash
export OPENAI_API_KEY=sk-...        # your OpenAI / ChatGPT API key
node server.js
```

- `POST /api/generate-gif` `{ "prompt": "..." }` proxies to OpenAI and returns the image.
- Override the model with `OPENAI_IMAGE_MODEL` if you want a different one.
- The looping animation (frame timing + motion) is built client-side with `gif.js`.

**Deployment:**
- Designed for Railway / Render / Fly.io — they auto-detect Node + run `npm start`
- WebSocket and HTTP share the same port (Railway-friendly)

// Voice WS server — the "websocket sidecar" upgrade path for richer NLU.
//
// SCAFFOLD STATUS: the browser ships with Web Speech recognition that needs
// no server (src/voice/speech.ts). This server is the optional Gemini-backed
// path — server-side key, better transcription of loose phrasing. Run it with
// `npm run server`; point the client at it later.
//
// Protocol (JSON over WebSocket):
//   client → server : { type: "utterance", audio: <base64>, mime: "audio/webm" }
//   client → server : { type: "ping" }
//   server → client : { type: "transcript", text: string }
//   server → client : { type: "error", message: string }
//   server → client : { type: "pong" }
//
// One generateContent call per utterance — push-to-talk = one turn = one
// request. Simpler + more stable than a streaming Live session, and it
// matches the "session per turn" guidance in docs/gemini-live-notes.md.

import { createServer } from "node:http";
import { config as loadEnv } from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { WebSocketServer } from "ws";

loadEnv({ path: new URL("./.env", import.meta.url).pathname });

const PORT = Number(process.env.VOICE_PORT ?? 8787);
const API_KEY = process.env.GEMINI_API_KEY ?? "";
const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";

const TRANSCRIBE_PROMPT =
  "You are the speech-to-text layer of a MOBA. Transcribe the spoken " +
  "command. Reply with ONLY the words spoken — no punctuation notes, no " +
  "commentary. If nothing intelligible was said, reply with an empty line.";

const ai = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;
if (!ai) {
  console.warn("[voice] GEMINI_API_KEY missing — server runs but will error " +
    "on utterances. Copy a key into server/.env (see .env.example).");
}

const http = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(ai ? "ok" : "ok (no api key)");
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: http });

wss.on("connection", (ws) => {
  console.log("[voice] client connected");
  ws.on("message", async (raw) => {
    let msg: { type?: string; audio?: string; mime?: string };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "invalid JSON" }));
      return;
    }

    if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
      return;
    }

    if (msg.type === "utterance") {
      if (!ai) {
        ws.send(JSON.stringify({ type: "error", message: "no api key" }));
        return;
      }
      if (!msg.audio) {
        ws.send(JSON.stringify({ type: "error", message: "no audio" }));
        return;
      }
      try {
        const result = await ai.models.generateContent({
          model: MODEL,
          contents: [
            {
              role: "user",
              parts: [
                { text: TRANSCRIBE_PROMPT },
                {
                  inlineData: {
                    mimeType: msg.mime ?? "audio/webm",
                    data: msg.audio,
                  },
                },
              ],
            },
          ],
        });
        const text = (result.text ?? "").trim();
        ws.send(JSON.stringify({ type: "transcript", text }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[voice] transcription failed:", message);
        ws.send(JSON.stringify({ type: "error", message }));
      }
      return;
    }

    ws.send(JSON.stringify({ type: "error", message: `unknown type: ${msg.type}` }));
  });
  ws.on("close", () => console.log("[voice] client disconnected"));
});

http.listen(PORT, () => {
  console.log(`[voice] websocket sidecar listening on ws://localhost:${PORT}`);
});

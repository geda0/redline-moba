# Gemini Live — non-negotiable setup

Transferred from the Unity prototype's verified findings. These cost real
debugging time to discover; do not re-derive them.

## The three setup requirements

1. **Model ID = `gemini-3.1-flash-live-preview`** (note the `.1`).
   `gemini-3-flash-live-preview` returns "model not found / not supported for
   bidiGenerateContent."

2. **API version must be `v1alpha`.** The SDK default (`v1beta`) does not route
   Live for this model. In the JS SDK (`@google/genai`), pass
   `apiVersion: "v1alpha"` in the client http options.

3. **Exactly one response modality per session.** AUDIO + TEXT combined makes
   the upstream silently reject `setupComplete` — surfaces as a 45-60s hang.
   Pick AUDIO for voice, TEXT for text-only. For voice with running
   transcripts, add `inputAudioTranscription` / `outputAudioTranscription` to
   the config — not a second modality.

## Turn behavior

- **Tool calls are atomic per turn.** Mid-utterance streaming is not available
  on this model — every tool call arrives after `audioStreamEnd`, never during.
  Tested across three VAD configs; result is locked.
- **Design implication:** the voice grammar is "speak a complete beat → get a
  response → speak again," not a continuously-refined stream. Short, complete
  commands. *"Blade, push top."* [pause] *"Pyre, hold mid."*
- **Session-per-turn for tool-only flows.** AUDIO modality streams TTS frames
  for several seconds after the tool response; reusing one session bleeds the
  prior turn's trailing frames into the next turn's receive loop. Open one
  session per logical turn. Costs ~300ms connect overhead — cheap vs. leakage.

## MOBA-specific note

The MOBA wants "live ongoing command of the 4 AI heroes." That does NOT mean
one infinite session — it means low-friction repeated turns. Each hold-to-talk
release is one turn = one session = one set of commands. The *feeling* of a
continuous session comes from fast turns, not from a literally-persistent
socket. Keep the session-per-turn pattern; just keep the connect path warm.

## Voice server

The Node WS backend (`server/index.ts`) owns the Gemini key and the Live
sessions. The browser never sees the API key. Browser sends mic PCM frames over
a WebSocket to the Node server; the server runs the Live turn and sends back
resolved hero commands as JSON.

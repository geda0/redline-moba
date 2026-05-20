# REDLINE MOBA — design

> **The AI is the game.** You pilot one hero. You *command* the other four by
> voice. Your team is only as good as the orders you give and the programs you
> write — the AI executes; you direct.

Web 5v5 MOBA. TypeScript + three.js + Vite. This doc is the consolidated
knowledge transfer from the prior Unity prototype and the RTS slice — only the
parts that survive into the MOBA.

## 1. The pitch

A MOBA where four of your five teammates are AI you command with natural
language, live, mid-fight. You mouse-pilot one hero LoL-style; you switch which
one at will; the rest obey your voice. The differentiator is not "a MOBA with
voice chat" — it's that **commanding the AI well is the skill ceiling**.

Genre handle, external: **AI-MOBA**. Never "a MOBA you can talk to."

## 2. The match

Standard MOBA shape:

- **5v5.** Blue team (player) vs Red team (AI).
- **3 lanes** — Top, Mid, Bot — plus jungle quadrants between them.
- **Structures:** 3 towers per lane per side + 2 nexus towers per side; one
  Nexus per side. Destroy the enemy Nexus to win.
- **Minions:** waves spawn from each Nexus every 30s, march their lane, fight.
- **Map:** 200×200 units, Summoner's-Rift diagonal — Blue base bottom-left,
  Red base top-right.

## 3. Control model

**Pilot one, switch five, voice the rest.**

- The player directly **mouse-pilots one hero** (LoL controls):
  right-click move, right-click-enemy attack, A+left-click attack-move,
  Q/W/E/R abilities, S stop.
- **Keys 1-5** switch which of the five blue heroes is piloted. The camera
  follows the piloted hero.
- The **four non-piloted heroes are AI.** They lane, last-hit, retreat when
  low — and obey voice commands.
- **Voice** is the command channel for the four AI heroes. Hold-to-talk; speak
  a beat ("Blade, push top"; "Pyre, fall back, then ward the river"); the AI
  hero executes. Programs (persistent conditional rules) can be attached by
  voice too — "Warden, if an ally drops below half, heal them."

### Why this works as a skill axis

Three sub-skills, like the RTS prototype proved out:

1. **Mechanics** — piloting your hero well (the LoL skill).
2. **Command clarity** — issuing voice orders the AI parses cleanly.
3. **Delegation/economy** — writing good programs so the AI heroes need less
   micromanagement, freeing attention for your piloted hero.

## 4. The roster (5 heroes, both teams field all 5)

| Hero | Role | HP | Range | Notes |
| --- | --- | --- | --- | --- |
| Vanguard | Tank | high | melee | frontline, soak |
| Blade | Fighter | mid | melee | high sustained DPS |
| Pyre | Mage | low | long | burst |
| Hawk | Marksman | low | long | sustained ranged |
| Warden | Support | mid | mid | heal/utility |

Ability kits (Q/W/E/R) land in build phase M3.

## 5. Atlas — the AI XO

Atlas is the team's AI commander voice — a persistent character, not a UI
sound. He greets at match start, gives sitreps mid-match ("Red is grouping
mid"), confirms your orders, and debriefs at the end. One consistent TTS voice
(`Charon`). Full persona contract in `atlas-persona.md`.

Atlas is distinct from the four AI *heroes*: Atlas is the strategic narrator +
the parser-facing personality; the heroes are the units that act.

## 6. Tech architecture

The hard rule: **the simulation is pure and headless.** `src/sim/` has zero
three.js, zero DOM. It can be fully unit-tested with vitest. Rendering reads
sim state; it never owns state.

```
src/
  sim/        pure game logic — World, units, stepWorld(). HEADLESS-TESTABLE.
  render/     three.js — reads World each frame, syncs meshes. No game logic.
  input/      mouse pilot + switch-control → writes hero command state.
  voice/      voice client — mic capture, WS to the voice server, NLU results.
  main.ts     entry — wires sim + render + input + the rAF loop.
server/
  index.ts    Node WS backend — holds the Gemini Live session, serves NLU.
test/         vitest — headless sim + resolver tests.
```

### Sim/render contract

- `World` is plain data: units, time, match state.
- `stepWorld(world, dt)` advances it. Pure-ish (mutates `world`, no I/O).
- Player/AI input writes `unit.moveGoal` / `unit.attackTargetId` *before* the
  step. The step just executes whatever state is on each unit. This is what
  lets the same hero be mouse-driven one tick and voice/AI-driven the next.
- `Renderer.sync(world)` is called each frame after the step.

### Voice pipeline

The Unity prototype used a Python sidecar over localhost WebSocket. The web
port replaces it with a **Node WS server** (`server/`) that holds the Gemini
Live session. Browser ↔ Node ↔ Gemini. The Node server also serves the built
client, so the whole thing is one deployable.

Voice → transcript + tool calls → resolved into hero commands → applied to the
4 AI heroes' command state. Same "order is the contract" principle as the RTS
prototype: only resolved commands cross the wire.

See `gemini-live-notes.md` for the non-negotiable Gemini Live setup.

## 7. Build plan

Each phase is a working, tested increment.

| Phase | Deliverable | Status |
| --- | --- | --- |
| **M1** | Sim foundation — map, lanes, towers, nexus, minion waves, win condition. Headless-tested. + a three.js renderer that shows it. | ✅ done |
| **M2** | Heroes — 5v5 spawn, mouse pilot, 1-5 switch, follow camera. | ✅ done |
| **M3** | Ability kits — Q/W/E/R per hero, cooldowns. | ✅ done |
| **M4** | AI teammates + voice — lane AI for the 4, Node voice server, live command. | ✅ done |
| **M5** | Jungle + objectives — neutral camps, buffs, an epic monster. | ✅ done |

## 8. What carried over from the prior prototype

- **Atlas persona + voice-feedback design** — `atlas-persona.md`.
- **Gemini Live constraints** — `gemini-live-notes.md`. Model id, api version,
  one-modality rule, atomic-turn / speak-in-beats grammar.
- **"Order is the contract"** — voice + gesture resolve client-side (or in the
  voice server); only structured commands drive the sim.
- **The sim/driver split** — units hold command state; drivers (mouse, AI,
  voice) write it; the step executes it. Proven clean in the Unity slice.

## 9. What was dropped

The RTS (squads, scope hierarchy, domination capture points, programmable RTS
rules), the turn-based "chess with troops" variant, the Commander-Sim framing.
The MOBA is the committed direction.

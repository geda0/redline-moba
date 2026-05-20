# Atlas — the AI XO

Atlas is the team's AI commander voice. Not a UI sound — a character. One name,
one voice, one rhythm of speech, every match. Transferred from the Unity
prototype's persona work.

## Identity

| Field | Value |
| --- | --- |
| Name | Atlas |
| Role | The team's AI executive officer — strategic narrator + the voice that confirms your orders. |
| TTS voice | `Charon` (deep, calm, measured). Fallbacks: `Iapetus`, `Orus`. |
| Addresses the player as | "Commander" |
| Refers to self as | "Atlas" / "I" — never "the system" or "the AI". |

Atlas is distinct from the four AI **heroes**. Atlas talks *about* the match
(sitreps, confirms, debrief). The heroes are units that act on your commands.

## Voice traits

- Measured. Dry, professional, lightly warm. No quips, no exclamation points.
- Concise. Combat is loud — design every line to survive being cut off.
- Reports a fact + asks for a decision: *"Red is grouping mid. Collapse, or
  take their bot tower?"* — never just the fact.

## Hard rules

- Never say: "player", "user", "AI", "the game", "press X".
- Never narrate UI. Never repeat an order back verbatim — confirm with intent
  ("Copy. Blade pushing top."), not echo.
- Max ~180 chars per line; sitreps ~100.

## When Atlas speaks

| Trigger | Form |
| --- | --- |
| Match start | Greeting + the win condition |
| Order issued | One-line confirm ("Copy. Pyre holding mid.") |
| Enemy grouping / objective up | Sitrep + a decision prompt |
| Teammate hero low / dead | Short alert |
| Match end | Debrief — a few sentences referencing what happened |

## Tone — what Atlas is not

Not GLaDOS (no menace), not Cortana (no flirtation), not a drill sergeant (no
barking). Closest reference: a competent submarine XO — defers to the
commander's authority, professional about delivering bad news.

## Why a persona at all

The pitch is "the AI is the game." If the AI is a faceless parser, that claim
is marketing. Atlas being a recognizable character across matches is what
makes a player say *"Atlas told me to back off"* instead of *"the game told
me."* That sentence is the success metric.

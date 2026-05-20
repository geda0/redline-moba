// Command resolver — turns a natural-ish command string into a structured
// Command (which heroes + what Directive), and applies it.
//
// M4b-1: keyword parser, no LLM. M4b-2 swaps the Gemini Live voice front-end
// in — but it produces the SAME Command shape, so this file stays the
// contract. "Order is the contract": only resolved Commands touch the sim.

import { ROSTER } from "./roster";
import type { Directive, Lane, World } from "./types";

export interface Command {
  /** Blue hero unit ids the command applies to (never the piloted hero). */
  heroIds: string[];
  directive: Directive;
  /** Human-readable echo, for HUD feedback / Atlas confirm. */
  summary: string;
}

const ALL_WORDS = new Set(["all", "everyone", "team", "squad", "everybody"]);
const SELF_WORDS = new Set(["me", "my", "myself"]);

const LANE_WORDS: Record<string, Lane> = {
  top: "top", mid: "mid", middle: "mid", bot: "bot", bottom: "bot", lane: "mid",
};

// Verb → directive kind. First match wins.
const VERBS: { words: string[]; kind: Directive["kind"] }[] = [
  { words: ["retreat", "back", "fall", "home", "recall", "disengage"], kind: "retreat" },
  { words: ["defend", "hold", "guard", "protect"], kind: "defend" },
  { words: ["group", "regroup", "gather", "collapse", "rally", "grp"], kind: "group" },
  { words: ["follow", "escort", "stay"], kind: "follow" },
  { words: ["push", "advance", "take", "go", "move", "split"], kind: "push" },
];

const HERO_IDS = new Set(ROSTER.map((h) => h.id));

/**
 * Parse a command string. Returns null when no hero target or no verb is
 * found. `pilotedId` is excluded from "all" and is the default follow target.
 */
export function resolveCommand(
  text: string, world: World, pilotedId: string | null,
): Command | null {
  const tokens = text.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return null;

  const blueHeroIds = world.units
    .filter((u) => u.kind === "hero" && u.team === "blue")
    .map((u) => u.id);

  // ── target heroes ───────────────────────────────────────────────────────
  let targets: string[] = [];
  if (tokens.some((t) => ALL_WORDS.has(t))) {
    targets = blueHeroIds.filter((id) => id !== pilotedId);
  } else {
    for (const t of tokens) {
      if (HERO_IDS.has(t)) {
        const id = blueHeroIds.find((bid) => bid.endsWith(`-${t}`));
        if (id && id !== pilotedId) targets = [id];
        break;
      }
    }
  }
  if (targets.length === 0) return null;

  // ── verb ────────────────────────────────────────────────────────────────
  let kind: Directive["kind"] | null = null;
  for (const v of VERBS) {
    if (tokens.some((t) => v.words.includes(t))) { kind = v.kind; break; }
  }
  if (kind === null) return null;

  // ── lane ────────────────────────────────────────────────────────────────
  let lane: Lane = "mid";
  for (const t of tokens) {
    if (LANE_WORDS[t]) { lane = LANE_WORDS[t]; break; }
  }

  let directive: Directive;
  switch (kind) {
    case "retreat": directive = { kind: "retreat" }; break;
    case "defend": directive = { kind: "defend", lane }; break;
    case "group": directive = { kind: "group", lane }; break;
    case "push": directive = { kind: "push", lane }; break;
    case "follow": {
      // Follow the piloted hero by default; or a named ally.
      let targetId = pilotedId;
      if (!tokens.some((t) => SELF_WORDS.has(t))) {
        for (const t of tokens) {
          if (HERO_IDS.has(t)) {
            const id = blueHeroIds.find((bid) => bid.endsWith(`-${t}`));
            if (id && !targets.includes(id)) { targetId = id; break; }
          }
        }
      }
      if (!targetId) return null;
      directive = { kind: "follow", targetId };
      break;
    }
  }

  return { heroIds: targets, directive, summary: describe(targets, directive) };
}

/** Write the directive onto each targeted hero. A lane change also resets
 * the hero's march progress so it rejoins the new lane cleanly. */
export function applyCommand(world: World, cmd: Command): void {
  const d = cmd.directive;
  for (const id of cmd.heroIds) {
    const hero = world.units.find((u) => u.id === id);
    if (!hero || hero.kind !== "hero") continue;
    hero.directive = d;
    if (
      (d.kind === "push" || d.kind === "group" || d.kind === "defend") &&
      hero.assignedLane !== d.lane
    ) {
      hero.assignedLane = d.lane;
      hero.waypointIndex = undefined;
    }
  }
}

function nameOf(unitId: string): string {
  const m = ROSTER.find((h) => unitId.endsWith(`-${h.id}`));
  return m ? m.name : unitId;
}

function describe(heroIds: string[], d: Directive): string {
  const who = heroIds.length > 1 ? "Team" : nameOf(heroIds[0]);
  switch (d.kind) {
    case "push": return `${who} → push ${d.lane}`;
    case "defend": return `${who} → defend ${d.lane}`;
    case "group": return `${who} → group ${d.lane}`;
    case "retreat": return `${who} → retreat`;
    case "follow": return `${who} → follow ${nameOf(d.targetId)}`;
  }
}

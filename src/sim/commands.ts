// Command resolver — turns a natural-ish command string into a structured
// Command (which heroes + what Directive), and applies it.
//
// Keyword parser, no LLM. The Gemini voice front-end produces the SAME
// Command shape, so this file stays the contract. "Order is the contract":
// only resolved Commands touch the sim.

import { ROSTER } from "./roster";
import type { Directive, Lane, Unit, World } from "./types";

export interface Command {
  /** Blue hero unit ids the command applies to (never the piloted hero). */
  heroIds: string[];
  directive: Directive;
  /** Human-readable echo, for HUD feedback / Atlas confirm. */
  summary: string;
}

const ALL_WORDS = new Set(["all", "everyone", "team", "squad", "everybody"]);
const SELF_WORDS = new Set(["me", "my", "myself"]);
const OBJECTIVE_WORDS = new Set([
  "epic", "dragon", "drake", "baron", "boss", "monster", "objective",
]);

const LANE_WORDS: Record<string, Lane> = {
  top: "top", mid: "mid", middle: "mid", center: "mid",
  bot: "bot", bottom: "bot", lane: "mid",
};

// Role aliases → roster id, so "focus their mage" works like "focus pyre".
const ROLE_WORDS: Record<string, string> = {
  tank: "vanguard", fighter: "blade", bruiser: "blade",
  mage: "pyre", caster: "pyre",
  marksman: "hawk", adc: "hawk", carry: "hawk", archer: "hawk",
  support: "warden", healer: "warden",
};

// Verb → directive kind. First list with a token hit wins, so order matters:
// the specific verbs (focus) sit above the catch-all push synonyms.
const VERBS: { words: string[]; kind: Directive["kind"] }[] = [
  { words: ["retreat", "back", "fall", "home", "recall", "disengage", "bail"], kind: "retreat" },
  { words: ["defend", "hold", "guard", "protect", "cover"], kind: "defend" },
  { words: ["group", "regroup", "gather", "collapse", "rally", "grp", "stack"], kind: "group" },
  { words: ["follow", "escort", "stay", "with"], kind: "follow" },
  { words: ["focus", "kill", "hunt", "burst", "gank", "eliminate", "assassinate"], kind: "focus" },
  { words: ["push", "advance", "take", "go", "move", "split", "siege", "pressure"], kind: "push" },
];

const HERO_NAMES = new Set(ROSTER.map((h) => h.id));

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean);
}

function heroIdsOf(world: World, team: "blue" | "red"): string[] {
  return world.units
    .filter((u) => u.kind === "hero" && u.team === team)
    .map((u) => u.id);
}

/** Map a token to a roster id name, via direct name or a role alias. */
function heroNameFromToken(token: string): string | null {
  if (HERO_NAMES.has(token)) return token;
  return ROLE_WORDS[token] ?? null;
}

/** First token that names a hero present in `pool`, skipping `exclude`d
 * roster names (so a second name in the sentence resolves to a new hero). */
function firstNamedHero(
  tokens: string[], pool: string[], exclude?: Set<string>,
): { id: string; name: string } | null {
  for (const t of tokens) {
    const name = heroNameFromToken(t);
    if (!name || exclude?.has(name)) continue;
    const id = pool.find((pid) => pid.endsWith(`-${name}`));
    if (id) return { id, name };
  }
  return null;
}

function epicCamp(world: World): Unit | undefined {
  return world.units.find(
    (u) => u.kind === "camp" && u.campTier === "epic" && u.alive,
  );
}

/**
 * Parse a command string. Returns null when no hero target or no
 * understandable order is found. `pilotedId` is excluded from "all" and is
 * the default follow target ("follow me").
 */
export function resolveCommand(
  text: string, world: World, pilotedId: string | null,
): Command | null {
  const tokens = tokenize(text);
  if (tokens.length === 0) return null;

  const blue = heroIdsOf(world, "blue");
  const red = heroIdsOf(world, "red");

  // ── who executes (our heroes) ───────────────────────────────────────────
  let targets: string[] = [];
  const used = new Set<string>(); // roster names already consumed
  if (tokens.some((t) => ALL_WORDS.has(t))) {
    targets = blue.filter((id) => id !== pilotedId);
  } else {
    const ally = firstNamedHero(tokens, blue);
    if (ally && ally.id !== pilotedId) {
      targets = [ally.id];
      used.add(ally.name);
    }
  }
  if (targets.length === 0) return null;

  const finish = (directive: Directive): Command => ({
    heroIds: targets, directive, summary: describe(targets, directive),
  });

  // ── objective — an epic/dragon noun routes straight to the monster ──────
  if (tokens.some((t) => OBJECTIVE_WORDS.has(t))) {
    const epic = epicCamp(world);
    if (epic) return finish({ kind: "objective", targetId: epic.id });
  }

  // ── verb ────────────────────────────────────────────────────────────────
  let kind: Directive["kind"] | null = null;
  for (const v of VERBS) {
    if (tokens.some((t) => v.words.includes(t))) { kind = v.kind; break; }
  }
  if (kind === null) return null;

  if (kind === "retreat") return finish({ kind: "retreat" });

  if (kind === "focus") {
    const enemy = firstNamedHero(tokens, red, used);
    if (!enemy) return null; // "focus" with nobody to focus
    return finish({ kind: "focus", targetId: enemy.id });
  }

  if (kind === "follow") {
    let targetId: string | null = pilotedId;
    if (!tokens.some((t) => SELF_WORDS.has(t))) {
      const ally = firstNamedHero(tokens, blue, used);
      if (ally) targetId = ally.id;
    }
    if (!targetId) return null;
    return finish({ kind: "follow", targetId });
  }

  // push / defend / group — pick a lane (default mid).
  let lane: Lane = "mid";
  for (const t of tokens) {
    if (LANE_WORDS[t]) { lane = LANE_WORDS[t]; break; }
  }
  return finish({ kind, lane } as Directive);
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
    case "focus": return `${who} → focus ${nameOf(d.targetId)}`;
    case "objective": return `${who} → take the epic`;
  }
}

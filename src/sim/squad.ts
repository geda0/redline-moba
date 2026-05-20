// Squad coordinator — the team-level brain that sits above the per-hero AI.
// Once per step it reads the whole battlefield for one team and decides two
// things the individual heroes cannot see on their own:
//
//   focusId  — the single enemy the team should collapse onto, so kills land
//              fast instead of damage smearing across five health bars.
//   fallBack — whether the squad is collectively losing its fight and should
//              disengage together rather than feed in one hero at a time.
//
// Pure + headless-testable: planSquad is a function of World, nothing else.

import { dist } from "./lanes";
import type { Team, Unit, World } from "./types";

/** Heroes within this range of one another are "in the same fight". */
export const FIGHT_RADIUS = 48;

export interface SquadPlan {
  /** Enemy id the whole team should focus-fire, or null when not fighting. */
  focusId: string | null;
  /** True when the squad is outgunned in its current fight — heroes near
   * the fight disengage together. */
  fallBack: boolean;
}

/** Effective hp — a shield is just more hp to chew through. */
function effHp(u: Unit): number {
  return u.hp + (u.shieldHp ?? 0);
}

function liveHeroes(world: World, team: Team, enemy: boolean): Unit[] {
  return world.units.filter(
    (u) =>
      u.kind === "hero" && u.alive && !u.isDead &&
      (enemy ? u.team !== team && u.team !== "neutral" : u.team === team),
  );
}

/** Compute this step's plan for `team`. */
export function planSquad(world: World, team: Team): SquadPlan {
  const allies = liveHeroes(world, team, false);
  const foes = liveHeroes(world, team, true);

  // Foes touching our line — the only valid focus candidates.
  const contested = foes.filter((f) =>
    allies.some((a) => dist(a.pos, f.pos) <= FIGHT_RADIUS),
  );

  // Focus = the contested foe with the least effective hp: the fastest kill.
  let focusId: string | null = null;
  let bestHp = Infinity;
  for (const f of contested) {
    const e = effHp(f);
    if (e < bestHp) { bestHp = e; focusId = f.id; }
  }

  // Measure the two sides actually committed to the fight.
  const inFight = allies.filter((a) =>
    foes.some((f) => dist(a.pos, f.pos) <= FIGHT_RADIUS),
  );
  const allyStrength = inFight.reduce((s, u) => s + effHp(u), 0);
  const foeStrength = contested.reduce((s, u) => s + effHp(u), 0);

  // Fall back only when genuinely behind: at least as many foes as allies
  // in the fight, and clearly less surviving strength on our side.
  const fallBack =
    contested.length > 0 &&
    inFight.length > 0 &&
    contested.length >= inFight.length &&
    allyStrength < foeStrength * 0.7;

  return { focusId, fallBack };
}

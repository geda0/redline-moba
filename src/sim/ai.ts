// Hero AI. Drives every hero that isn't being mouse-piloted — the 4 blue
// teammates and all 5 red heroes. The AI writes the SAME command state
// (moveGoal / attackTargetId) and calls the SAME castAbility() the mouse
// driver uses. One execution path; the AI is just another driver.
//
// Behavior: retreat when low → engage a nearby enemy (+ cast ready
// abilities) → otherwise push the assigned lane.

import { castAbility, cooldownRemaining, kitFor } from "./abilities";
import { LANE_PATHS, nexusPos } from "./config";
import { nearestEnemy } from "./combat";
import { dist } from "./lanes";
import type { AbilitySlot } from "./abilities";
import type { Unit, World } from "./types";

const RETREAT_HP_FRAC = 0.3;
const ENGAGE_PADDING = 28; // how far past attack range the AI will commit

/** Write `hero`'s command state for this step. Called from stepHero before
 * the hero executes its state. */
export function stepHeroAI(world: World, hero: Unit): void {
  if (hero.isDead) return;

  // 1. Retreat when low — break off and head home.
  if (hero.hp < hero.maxHp * RETREAT_HP_FRAC) {
    hero.attackTargetId = null;
    hero.moveGoal = { ...nexusPos(hero.team) };
    return;
  }

  // 2. Engage the nearest enemy within a generous commit range.
  const foe = nearestEnemy(world, hero, hero.attackRange + ENGAGE_PADDING);
  if (foe) {
    hero.attackTargetId = foe.id;
    hero.moveGoal = null;
    castReadyAbilities(world, hero, foe);
    return;
  }

  // 3. Push the assigned lane toward the enemy nexus.
  hero.attackTargetId = null;
  hero.moveGoal = laneAdvance(hero);
}

/** Cast any off-cooldown ability that makes sense on the current foe. */
function castReadyAbilities(world: World, hero: Unit, foe: Unit): void {
  if (!hero.heroId) return;
  const kit = kitFor(hero.heroId);
  const d = dist(hero.pos, foe.pos);
  for (const ability of kit) {
    if (cooldownRemaining(world, hero, ability.slot) > 0) continue;
    // Only spend an ability if its target band is roughly reachable.
    const usable =
      ability.kind === "shield" || ability.kind === "heal"
        ? true
        : d <= ability.range + ability.radius + 4;
    if (!usable) continue;
    castAbility(world, hero, ability.slot as AbilitySlot, foe.pos);
  }
}

/** Next lane waypoint for a pushing hero. Advances `waypointIndex` as the
 * hero reaches each point; past the end it marches the enemy nexus. */
function laneAdvance(hero: Unit): { x: number; z: number } {
  const lane = hero.assignedLane ?? "mid";
  const path = LANE_PATHS[lane];
  const forward = hero.team === "blue" ? 1 : -1;
  if (hero.waypointIndex === undefined) {
    hero.waypointIndex = hero.team === "blue" ? 0 : path.length - 1;
  }
  let idx = hero.waypointIndex;
  if (idx < 0 || idx >= path.length) return { ...nexusPos(enemyTeamNexus(hero)) };
  const wp = path[idx];
  if (dist(hero.pos, wp) < 6) {
    idx += forward;
    hero.waypointIndex = idx;
    if (idx < 0 || idx >= path.length) return { ...nexusPos(enemyTeamNexus(hero)) };
    return { ...path[idx] };
  }
  return { ...wp };
}

function enemyTeamNexus(hero: Unit): Unit["team"] {
  return hero.team === "blue" ? "red" : "blue";
}

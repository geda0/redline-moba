// Hero AI. Drives every hero that isn't being mouse-piloted — the 4 blue
// teammates and all 5 red heroes. The AI writes the same command state and
// calls the same castAbility() the mouse uses: one execution path.
//
// Priority each step: retreat when low / ordered → engage a nearby enemy
// (+ cast) → otherwise carry out the standing Directive (push / defend /
// group / follow) → default: push the assigned lane.

import { castAbility, cooldownRemaining, kitFor } from "./abilities";
import { LANE_PATHS, enemyOf, nexusPos } from "./config";
import { nearestEnemy } from "./combat";
import { dist, lanePointAt } from "./lanes";
import type { AbilitySlot } from "./abilities";
import type { Lane, Unit, Vec2, World } from "./types";

const RETREAT_HP_FRAC = 0.3;
const ENGAGE_PADDING = 28;

/** Write `hero`'s command state for this step. */
export function stepHeroAI(world: World, hero: Unit): void {
  if (hero.isDead) return;
  const d = hero.directive ?? null;

  // 1. Retreat — ordered, or a low-hp safety override.
  if ((d && d.kind === "retreat") || hero.hp < hero.maxHp * RETREAT_HP_FRAC) {
    hero.attackTargetId = null;
    hero.moveGoal = { ...nexusPos(hero.team) };
    return;
  }

  // 2. Engage — fight anything nearby, regardless of directive.
  const foe = nearestEnemy(world, hero, hero.attackRange + ENGAGE_PADDING);
  if (foe) {
    hero.attackTargetId = foe.id;
    hero.moveGoal = null;
    castReadyAbilities(world, hero, foe);
    return;
  }
  hero.attackTargetId = null;

  // 3. Carry out the standing directive.
  if (d) {
    if (d.kind === "follow") {
      const tgt = world.units.find((u) => u.id === d.targetId);
      if (tgt && tgt.alive && !tgt.isDead) {
        hero.moveGoal = { ...tgt.pos };
        return;
      }
      // target gone — fall through to default push
    } else if (d.kind === "defend") {
      hero.moveGoal = defendPoint(hero, d.lane);
      return;
    } else if (d.kind === "group") {
      const rally = lanePointAt(d.lane, 0.5);
      hero.moveGoal = dist(hero.pos, rally) > 8
        ? rally
        : laneAdvance(hero, d.lane);
      return;
    } else if (d.kind === "push") {
      hero.moveGoal = laneAdvance(hero, d.lane);
      return;
    }
  }

  // 4. Default — push the assigned lane.
  hero.moveGoal = laneAdvance(hero, hero.assignedLane ?? "mid");
}

function castReadyAbilities(world: World, hero: Unit, foe: Unit): void {
  if (!hero.heroId) return;
  const d = dist(hero.pos, foe.pos);
  for (const ability of kitFor(hero.heroId)) {
    if (cooldownRemaining(world, hero, ability.slot) > 0) continue;
    const usable =
      ability.kind === "shield" || ability.kind === "heal"
        ? true
        : d <= ability.range + ability.radius + 4;
    if (usable) castAbility(world, hero, ability.slot as AbilitySlot, foe.pos);
  }
}

/** A forward defensive hold position on a lane, on the hero's own side. */
function defendPoint(hero: Unit, lane: Lane): Vec2 {
  return lanePointAt(lane, hero.team === "blue" ? 0.42 : 0.58);
}

/** Next lane waypoint for a pushing hero. `waypointIndex` advances as the
 * hero reaches each point; it re-initializes to the nearest waypoint so a
 * lane switch joins the lane cleanly. */
function laneAdvance(hero: Unit, lane: Lane): Vec2 {
  const path = LANE_PATHS[lane];
  const forward = hero.team === "blue" ? 1 : -1;
  if (hero.waypointIndex === undefined) {
    hero.waypointIndex = nearestWaypointIndex(hero.pos, path);
  }
  let idx = hero.waypointIndex;
  if (idx < 0 || idx >= path.length) return { ...nexusPos(enemyOf(hero.team)) };
  const wp = path[idx];
  if (dist(hero.pos, wp) < 6) {
    idx += forward;
    hero.waypointIndex = idx;
    if (idx < 0 || idx >= path.length) return { ...nexusPos(enemyOf(hero.team)) };
    return { ...path[idx] };
  }
  return { ...wp };
}

function nearestWaypointIndex(pos: Vec2, path: Vec2[]): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = dist(pos, path[i]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// Hero AI. Drives every hero that isn't being mouse-piloted — the 4 blue
// teammates and all 5 red heroes. The AI writes the same command state and
// calls the same castAbility() the mouse uses: one execution path.
//
// Priority each step: retreat (ordered / low-hp / the squad is losing) →
// engage — collapse onto the team focus, focus-firing it down → carry out
// the standing Directive → default: push the assigned lane. The squad
// coordinator (squad.ts) supplies the focus + fall-back signals; ability
// use is role-aware (heal the wounded, dash to escape or gap-close).

import { castAbility, cooldownRemaining, kitFor } from "./abilities";
import { LANE_PATHS, enemyOf, nexusPos } from "./config";
import { nearestEnemy } from "./combat";
import { dist, lanePointAt } from "./lanes";
import { findUnit } from "./world";
import type { Ability, AbilitySlot } from "./abilities";
import type { SquadPlan } from "./squad";
import type { Lane, Unit, Vec2, World } from "./types";

const RETREAT_HP_FRAC = 0.3;
const ENGAGE_PADDING = 28;
/** A hero within this range of the team focus collapses onto it. */
const COLLAPSE_RADIUS = 90;

/** Write `hero`'s command state for this step, given the team's squad plan. */
export function stepHeroAI(world: World, hero: Unit, plan: SquadPlan): void {
  if (hero.isDead) return;
  const d = hero.directive ?? null;

  const foeNear = nearestEnemy(world, hero, hero.attackRange + ENGAGE_PADDING);
  const ordered = !!d && d.kind === "retreat";
  const lowHp = hero.hp < hero.maxHp * RETREAT_HP_FRAC;
  // A squad fall-back only pulls heroes who are themselves in danger — a
  // healthy split-pusher keeps pushing while mid disengages.
  const squadLosing =
    plan.fallBack && foeNear !== null && hero.hp < hero.maxHp * 0.85;

  // 1. Retreat — ordered, a low-hp safety override, or a squad fall-back.
  if (ordered || lowHp || squadLosing) {
    hero.attackTargetId = null;
    hero.moveGoal = { ...nexusPos(hero.team) };
    escapeWithDash(world, hero);
    return;
  }

  // 2. Engage — collapse on the team focus, else fight whatever is on us.
  const target = pickTarget(world, hero, plan, foeNear);
  if (target) {
    hero.attackTargetId = target.id;
    hero.moveGoal = null;
    useAbilities(world, hero, target);
    return;
  }
  hero.attackTargetId = null;

  // 2b. Out of combat — a support tops up a badly wounded ally anyway.
  supportUpkeep(world, hero);

  // 3. Carry out the standing directive.
  if (d) {
    if (d.kind === "follow") {
      const tgt = findUnit(world, d.targetId);
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

/** Choose this step's attack target: the team focus when it is within
 * collapse range, otherwise whatever enemy wandered into threat range. */
function pickTarget(
  world: World, hero: Unit, plan: SquadPlan, foeNear: Unit | null,
): Unit | null {
  if (plan.focusId) {
    const focus = findUnit(world, plan.focusId);
    if (
      focus && focus.alive && !focus.isDead &&
      dist(hero.pos, focus.pos) <= COLLAPSE_RADIUS
    ) {
      return focus;
    }
  }
  return foeNear;
}

// ── ability use ─────────────────────────────────────────────────────────────

/** In a fight: spend every ready ability sensibly for this hero's role. */
function useAbilities(world: World, hero: Unit, foe: Unit): void {
  if (!hero.heroId) return;
  const d = dist(hero.pos, foe.pos);
  for (const a of kitFor(hero.heroId)) {
    if (cooldownRemaining(world, hero, a.slot) > 0) continue;
    castInFight(world, hero, a, foe, d);
  }
}

function castInFight(
  world: World, hero: Unit, a: Ability, foe: Unit, d: number,
): void {
  const slot = a.slot as AbilitySlot;
  if (a.kind === "heal" || a.kind === "shield") {
    // Patch the most wounded ally in range (self counts).
    const ally = lowestAlly(world, hero, Math.max(a.range, 1));
    if (ally && ally.hp < ally.maxHp * 0.85) {
      castAbility(world, hero, slot, ally.pos);
    }
    return;
  }
  if (a.kind === "dash") {
    // Gap-close onto the foe, but only when out of attack range.
    if (d > hero.attackRange) castAbility(world, hero, slot, foe.pos);
    return;
  }
  // nuke — fire when the blast can actually reach the foe.
  if (d <= a.range + a.radius + 4) castAbility(world, hero, slot, foe.pos);
}

/** Out of combat, a support pre-emptively heals a critically wounded ally. */
function supportUpkeep(world: World, hero: Unit): void {
  if (!hero.heroId) return;
  for (const a of kitFor(hero.heroId)) {
    if (a.kind !== "heal") continue;
    if (cooldownRemaining(world, hero, a.slot) > 0) continue;
    const ally = lowestAlly(world, hero, Math.max(a.range, 1));
    if (ally && ally.hp < ally.maxHp * 0.55) {
      castAbility(world, hero, a.slot as AbilitySlot, ally.pos);
    }
  }
}

/** Burn a ready dash toward home — turns a retreat into a real escape. */
function escapeWithDash(world: World, hero: Unit): void {
  if (!hero.heroId) return;
  const home = nexusPos(hero.team);
  for (const a of kitFor(hero.heroId)) {
    if (a.kind !== "dash") continue;
    if (cooldownRemaining(world, hero, a.slot) > 0) continue;
    castAbility(world, hero, a.slot as AbilitySlot, home);
  }
}

/** Most-wounded friendly hero/minion within `range` of the hero. */
function lowestAlly(world: World, hero: Unit, range: number): Unit | null {
  let best: Unit | null = null;
  let bestFrac = Infinity;
  for (const u of world.units) {
    if (u.team !== hero.team || !u.alive || u.isDead) continue;
    if (u.kind !== "hero" && u.kind !== "minion") continue;
    if (dist(hero.pos, u.pos) > range) continue;
    const frac = u.hp / u.maxHp;
    if (frac < bestFrac) { bestFrac = frac; best = u; }
  }
  return best;
}

// ── movement helpers ────────────────────────────────────────────────────────

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

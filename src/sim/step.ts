// stepWorld — the simulation tick. Pure-ish: mutates `world`, no I/O.
// This is the whole game loop; rendering just reads the result.

import {
  LANE_PATHS, LANES, MINIONS_PER_LANE, TUNING, WAVE_INTERVAL, enemyOf, nexusPos,
} from "./config";
import { stepHeroAI } from "./ai";
import { fireAt, inRange, nearestEnemy } from "./combat";
import { dist, moveToward } from "./lanes";
import { spawnMinion } from "./world";
import type { Unit, World } from "./types";

const HERO_RESPAWN_SECONDS = 8;

/** Advance the world by `dt` seconds. */
export function stepWorld(world: World, dt: number): void {
  world.events = [];
  if (world.matchOver) return;

  world.time += dt;

  // ── minion waves ────────────────────────────────────────────────────────
  if (world.time >= world.nextWaveAt) {
    world.waveCount++;
    world.nextWaveAt += WAVE_INTERVAL;
    for (const team of ["blue", "red"] as const) {
      for (const lane of LANES) {
        for (let i = 0; i < MINIONS_PER_LANE; i++) spawnMinion(world, team, lane);
      }
    }
    world.events.push({ kind: "wave_spawned", unitId: `wave-${world.waveCount}` });
  }

  // ── per-unit behavior ───────────────────────────────────────────────────
  for (const u of world.units) {
    if (!u.alive && u.kind !== "hero") continue;
    switch (u.kind) {
      case "minion": stepMinion(world, u, dt); break;
      case "tower": stepTower(world, u, dt); break;
      case "hero": stepHero(world, u, dt); break;
      case "nexus": break; // inert objective
    }
  }

  // ── death resolution ────────────────────────────────────────────────────
  for (const u of world.units) {
    if (u.alive) continue;
    if (u.kind === "nexus") {
      world.matchOver = true;
      world.winner = enemyOf(u.team);
      world.events.push({ kind: "nexus_destroyed", unitId: u.id, team: u.team });
    } else if (u.kind === "hero" && !u.isDead) {
      u.isDead = true;
      u.respawnAt = world.time + HERO_RESPAWN_SECONDS;
      u.moveGoal = null;
      u.attackTargetId = null;
    }
  }
  // Remove dead minions/towers; heroes/nexuses persist.
  world.units = world.units.filter(
    (u) => u.alive || u.kind === "hero" || u.kind === "nexus",
  );
}

// ── minion ──────────────────────────────────────────────────────────────────
function stepMinion(world: World, m: Unit, dt: number): void {
  const foe = nearestEnemy(world, m, TUNING.minion.aggro);
  if (foe) {
    if (inRange(m, foe)) { fireAt(world, m, foe, dt); return; }
    m.pos = moveToward(m.pos, foe.pos, m.moveSpeed * dt);
    return;
  }
  // March the lane.
  const path = LANE_PATHS[m.lane!];
  const idx = m.waypointIndex ?? 0;
  if (idx < 0 || idx >= path.length) {
    m.pos = moveToward(m.pos, nexusPos(enemyOf(m.team)), m.moveSpeed * dt);
    return;
  }
  const wp = path[idx];
  if (dist(m.pos, wp) < 4) {
    m.waypointIndex = idx + (m.team === "blue" ? 1 : -1);
    return;
  }
  m.pos = moveToward(m.pos, wp, m.moveSpeed * dt);
}

// ── tower ───────────────────────────────────────────────────────────────────
function stepTower(world: World, t: Unit, dt: number): void {
  const target = nearestEnemy(world, t, t.attackRange, (u) => u.kind === "minion");
  if (target) fireAt(world, t, target, dt);
}

// ── hero (mouse pilot / AI / voice all write moveGoal + attackTargetId) ──────
function stepHero(world: World, h: Unit, dt: number): void {
  // AI heroes get their command state written by the hero AI each step,
  // before they execute it. The piloted hero (aiControlled=false) keeps
  // whatever the mouse driver last wrote.
  if (h.aiControlled && !h.isDead) stepHeroAI(world, h);

  if (h.isDead) {
    if (world.time >= (h.respawnAt ?? 0)) {
      h.isDead = false;
      h.alive = true;
      h.hp = h.maxHp;
      h.pos = { ...nexusPos(h.team) };
    }
    return;
  }

  // 1. Explicit attack target.
  if (h.attackTargetId) {
    const target = world.units.find((u) => u.id === h.attackTargetId);
    if (target && target.alive && !target.isDead) {
      if (inRange(h, target)) { fireAt(world, h, target, dt); return; }
      h.pos = moveToward(h.pos, target.pos, h.moveSpeed * dt);
      return;
    }
    h.attackTargetId = null;
  }

  // 2. Move goal.
  if (h.moveGoal) {
    if (dist(h.pos, h.moveGoal) < 2.5) {
      h.moveGoal = null;
    } else {
      h.pos = moveToward(h.pos, h.moveGoal, h.moveSpeed * dt);
      const opportune = nearestEnemy(world, h, h.attackRange);
      if (opportune) fireAt(world, h, opportune, dt);
      return;
    }
  }

  // 3. Idle — auto-defend.
  const foe = nearestEnemy(world, h, h.attackRange + 6);
  if (foe) {
    if (inRange(h, foe)) fireAt(world, h, foe, dt);
    else h.pos = moveToward(h.pos, foe.pos, h.moveSpeed * dt);
  }
}

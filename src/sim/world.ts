// World construction — builds the initial map state (towers, nexuses) and
// provides spawn helpers for minions and heroes.

import {
  BLUE_NEXUS_TOWER_OFFSETS, BLUE_TOWER_T, FIRST_WAVE_AT, LANES,
  RED_NEXUS_TOWER_OFFSETS, RED_TOWER_T, TUNING, nexusPos,
} from "./config";
import { lanePointAt } from "./lanes";
import type { HeroDef } from "./roster";
import type { Lane, Team, Unit, Vec2, World } from "./types";

let _nextId = 1;
function uid(prefix: string): string {
  return `${prefix}-${_nextId++}`;
}

function makeUnit(p: Partial<Unit> & Pick<Unit, "team" | "kind" | "pos">): Unit {
  const maxHp = p.maxHp ?? 100;
  return {
    // Defaults first; the spread of `p` overrides any it provides.
    moveSpeed: 0,
    attackRange: 0,
    dps: 0,
    ...p,
    // Derived / required fields, set AFTER the spread so they always win.
    id: p.id ?? uid(p.kind),
    hp: maxHp,
    maxHp,
    pos: { ...p.pos },
    alive: true,
    lastFireAt: -1,
  };
}

export function spawnTower(world: World, team: Team, xz: Vec2, id: string): Unit {
  const t = makeUnit({
    id, team, kind: "tower", pos: xz,
    maxHp: TUNING.tower.hp, attackRange: TUNING.tower.range, dps: TUNING.tower.dps,
  });
  world.units.push(t);
  return t;
}

export function spawnNexus(world: World, team: Team): Unit {
  const n = makeUnit({
    id: `nexus-${team}`, team, kind: "nexus", pos: nexusPos(team),
    maxHp: TUNING.nexus.hp,
  });
  world.units.push(n);
  return n;
}

/** Lane polylines all have 5 points; blue minions start at index 0 and walk
 * up, red minions start at the last index and walk down. */
const LANE_LAST_INDEX = 4;

export function spawnMinion(world: World, team: Team, lane: Lane): Unit {
  const base = nexusPos(team);
  const jitter = (): number => (Math.random() - 0.5) * 6;
  const m = makeUnit({
    team, kind: "minion", lane,
    pos: { x: base.x + jitter(), z: base.z + jitter() },
    maxHp: TUNING.minion.hp, moveSpeed: TUNING.minion.moveSpeed,
    attackRange: TUNING.minion.range, dps: TUNING.minion.dps,
    waypointIndex: team === "blue" ? 0 : LANE_LAST_INDEX,
  });
  world.units.push(m);
  return m;
}

export function spawnHero(
  world: World, team: Team, def: HeroDef, rosterIndex: number, pos: Vec2,
): Unit {
  const h = makeUnit({
    id: `${team}-${def.id}`, team, kind: "hero", pos,
    maxHp: def.maxHp, moveSpeed: def.moveSpeed,
    attackRange: def.attackRange, dps: def.dps,
    heroId: def.id, rosterIndex,
    moveGoal: null, attackTargetId: null, isDead: false, respawnAt: 0,
  });
  world.units.push(h);
  return h;
}

/** Build a fresh match world — map structures placed, no units yet. */
export function createWorld(): World {
  const world: World = {
    time: 0,
    units: [],
    nextWaveAt: FIRST_WAVE_AT,
    waveCount: 0,
    matchOver: false,
    winner: null,
    events: [],
  };

  spawnNexus(world, "blue");
  spawnNexus(world, "red");

  for (const lane of LANES) {
    for (let i = 0; i < BLUE_TOWER_T.length; i++) {
      spawnTower(world, "blue", lanePointAt(lane, BLUE_TOWER_T[i]),
        `tower-blue-${lane}-${i + 1}`);
      spawnTower(world, "red", lanePointAt(lane, RED_TOWER_T[i]),
        `tower-red-${lane}-${i + 1}`);
    }
  }

  const bBase = nexusPos("blue");
  const rBase = nexusPos("red");
  BLUE_NEXUS_TOWER_OFFSETS.forEach((o, i) =>
    spawnTower(world, "blue", { x: bBase.x + o.x, z: bBase.z + o.z },
      `tower-blue-nexus-${i + 1}`));
  RED_NEXUS_TOWER_OFFSETS.forEach((o, i) =>
    spawnTower(world, "red", { x: rBase.x + o.x, z: rBase.z + o.z },
      `tower-red-nexus-${i + 1}`));

  return world;
}

export function findUnit(world: World, id: string): Unit | undefined {
  return world.units.find((u) => u.id === id);
}

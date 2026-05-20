// MOBA map geometry + tuning. Pure data — no three.js, no DOM.
// 200×200 map, Summoner's-Rift diagonal: Blue bottom-left, Red top-right.

import type { Lane, Team, Vec2 } from "./types";

export const MAP_SIZE = 200;

export const BLUE_BASE: Vec2 = { x: 28, z: 28 };
export const RED_BASE: Vec2 = { x: 172, z: 172 };

// Lane polylines, blue→red. Minions walk these forward (blue) or reversed (red).
export const LANE_PATHS: Record<Lane, Vec2[]> = {
  top: [
    { x: 28, z: 36 }, { x: 24, z: 110 }, { x: 28, z: 172 },
    { x: 110, z: 176 }, { x: 172, z: 172 },
  ],
  mid: [
    { x: 36, z: 36 }, { x: 70, z: 70 }, { x: 100, z: 100 },
    { x: 130, z: 130 }, { x: 164, z: 164 },
  ],
  bot: [
    { x: 36, z: 28 }, { x: 110, z: 24 }, { x: 172, z: 28 },
    { x: 176, z: 110 }, { x: 172, z: 172 },
  ],
};

export const LANES: Lane[] = ["top", "mid", "bot"];

// Tower positions along each lane, as fraction t of the polyline.
// Blue owns low-t, Red owns high-t.
export const BLUE_TOWER_T = [0.18, 0.34, 0.47];
export const RED_TOWER_T = [0.82, 0.66, 0.53];

// Two nexus towers flank each base.
export const BLUE_NEXUS_TOWER_OFFSETS: Vec2[] = [
  { x: 14, z: -4 }, { x: -4, z: 14 },
];
export const RED_NEXUS_TOWER_OFFSETS: Vec2[] = [
  { x: -14, z: 4 }, { x: 4, z: -14 },
];

// Minion waves.
export const FIRST_WAVE_AT = 15;
export const WAVE_INTERVAL = 30;
export const MINIONS_PER_LANE = 6;
export const MINION_SPAWN_STAGGER = 0.45;

// Tuning.
export const TUNING = {
  tower: { hp: 1600, range: 26, dps: 110 },
  nexus: { hp: 5000 },
  minion: { hp: 90, moveSpeed: 16, range: 12, dps: 14, aggro: 22 },
  fireInterval: 0.18, // throttle for tracer/visual events
};

export function nexusPos(team: Team): Vec2 {
  return team === "blue" ? BLUE_BASE : RED_BASE;
}

export function enemyOf(team: Team): Team {
  return team === "blue" ? "red" : "blue";
}

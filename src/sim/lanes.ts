// Lane polyline math.

import { LANE_PATHS } from "./config";
import type { Lane, Vec2 } from "./types";

export function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

/** Point at fraction t (0..1) along a lane polyline. */
export function lanePointAt(lane: Lane, t: number): Vec2 {
  const path = LANE_PATHS[lane];
  t = Math.min(1, Math.max(0, t));
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) total += dist(path[i], path[i + 1]);
  const target = total * t;
  let acc = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = dist(path[i], path[i + 1]);
    if (acc + seg >= target) {
      const local = seg > 0.001 ? (target - acc) / seg : 0;
      return lerp(path[i], path[i + 1], local);
    }
    acc += seg;
  }
  return { ...path[path.length - 1] };
}

/** Move `pos` toward `goal` by at most `maxStep`. Returns a new Vec2. */
export function moveToward(pos: Vec2, goal: Vec2, maxStep: number): Vec2 {
  const dx = goal.x - pos.x;
  const dz = goal.z - pos.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d <= maxStep || d < 1e-5) return { x: goal.x, z: goal.z };
  return { x: pos.x + (dx / d) * maxStep, z: pos.z + (dz / d) * maxStep };
}

// Targeting + damage. Pure functions over World state.

import { TUNING } from "./config";
import { dist } from "./lanes";
import type { SimEvent, Unit, World } from "./types";

/** Nearest living enemy of `self` within `range`. `prefer` lets towers
 * prioritize minions: a preferred match wins over a closer non-preferred. */
export function nearestEnemy(
  world: World,
  self: Unit,
  range: number,
  prefer?: (u: Unit) => boolean,
): Unit | null {
  let best: Unit | null = null;
  let bestD = Infinity;
  let bestPref: Unit | null = null;
  let bestPrefD = Infinity;
  const r2 = range * range;
  for (const u of world.units) {
    if (u === self || !u.alive || u.team === self.team) continue;
    if (u.isDead) continue; // dead-but-respawning hero
    const dx = u.pos.x - self.pos.x;
    const dz = u.pos.z - self.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > r2) continue;
    if (d2 < bestD) { bestD = d2; best = u; }
    if (prefer && prefer(u) && d2 < bestPrefD) { bestPrefD = d2; bestPref = u; }
  }
  return bestPref ?? best;
}

/** Apply continuous DPS from `source` to `target` for `dt` seconds. Emits a
 * throttled `fire` event and, on a kill, a `death` event. */
export function fireAt(
  world: World,
  source: Unit,
  target: Unit,
  dt: number,
): void {
  if (!target.alive || target.isDead) return;
  target.hp = Math.max(0, target.hp - source.dps * dt);

  if (world.time - source.lastFireAt >= TUNING.fireInterval) {
    source.lastFireAt = world.time;
    world.events.push({
      kind: "fire",
      unitId: source.id,
      targetId: target.id,
      team: source.team,
      from: { ...source.pos },
      to: { ...target.pos },
    });
  }

  if (target.hp <= 0 && target.alive) {
    target.alive = false;
    const death: SimEvent = {
      kind: "death",
      unitId: target.id,
      team: target.team,
      from: { ...target.pos },
    };
    world.events.push(death);
  }
}

/** True if a target is within `self`'s attack range. */
export function inRange(self: Unit, target: Unit): boolean {
  return dist(self.pos, target.pos) <= self.attackRange;
}

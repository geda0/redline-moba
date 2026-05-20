// Targeting + damage. Pure functions over World state.

import { BUFF, TUNING } from "./config";
import { dist } from "./lanes";
import type { Buff, SimEvent, Unit, World } from "./types";

/** Combined outgoing-damage multiplier for an attacker: a personal jungle
 * buff times a team-wide epic buff. Both go inert once world.time passes
 * their expiresAt. Returns 1 for anything without buffs (towers, minions,
 * camps). The single place buffs touch damage. */
export function damageMultiplier(world: World, source: Unit): number {
  let mul = 1;
  if (source.buff && world.time < source.buff.expiresAt) {
    mul *= source.buff.dmgMul;
  }
  const tb =
    source.team === "blue" ? world.teamBuff.blue
    : source.team === "red" ? world.teamBuff.red
    : null;
  if (tb && world.time < tb.expiresAt) mul *= tb.dmgMul;
  return mul;
}

/** Grant the kill reward for a downed camp. Small camp → the killer alone
 * (personal buff + heal); epic → the killer's whole team. */
function grantCampBuff(world: World, camp: Unit, killer: Unit): void {
  if (camp.campTier === "epic") {
    const buff: Buff = {
      dmgMul: BUFF.epic.dmgMul,
      expiresAt: world.time + BUFF.epic.duration,
    };
    if (killer.team === "blue") world.teamBuff.blue = buff;
    else if (killer.team === "red") world.teamBuff.red = buff;
  } else {
    killer.buff = {
      dmgMul: BUFF.small.dmgMul,
      expiresAt: world.time + BUFF.small.duration,
    };
    killer.hp = Math.min(killer.maxHp, killer.hp + BUFF.small.heal);
  }
}

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

/** Apply a flat damage amount to a unit. Shield is consumed before hp.
 * Emits a `death` event on a kill. `source` (the attacker) is optional —
 * when present and the kill is a jungle camp, the killer earns its buff.
 * The single damage path — fireAt and ability nukes both route through here. */
export function dealDamage(
  world: World, target: Unit, amount: number, source?: Unit,
): void {
  if (!target.alive || target.isDead || amount <= 0) return;
  let remaining = amount;
  if (target.shieldHp && target.shieldHp > 0) {
    const absorbed = Math.min(target.shieldHp, remaining);
    target.shieldHp -= absorbed;
    remaining -= absorbed;
  }
  if (remaining > 0) target.hp = Math.max(0, target.hp - remaining);
  if (target.hp <= 0 && target.alive) {
    target.alive = false;
    const death: SimEvent = {
      kind: "death",
      unitId: target.id,
      team: target.team,
      from: { ...target.pos },
    };
    world.events.push(death);
    if (target.kind === "camp" && source && source.kind === "hero") {
      grantCampBuff(world, target, source);
    }
  }
}

/** Apply continuous DPS from `source` to `target` for `dt` seconds. Emits a
 * throttled `fire` event; damage routes through dealDamage (shield-aware). */
export function fireAt(
  world: World,
  source: Unit,
  target: Unit,
  dt: number,
): void {
  if (!target.alive || target.isDead) return;
  dealDamage(world, target, source.dps * dt * damageMultiplier(world, source),
    source);

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
}

/** True if a target is within `self`'s attack range. */
export function inRange(self: Unit, target: Unit): boolean {
  return dist(self.pos, target.pos) <= self.attackRange;
}

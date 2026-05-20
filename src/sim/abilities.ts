// Hero ability kits — Q/W/E/R per hero. Pure sim logic: castAbility resolves
// instantly into world state. Cooldown-gated; a resource (energy) is a later
// tuning pass. Drivers (mouse / AI / voice) all call castAbility — the same
// path, so it is fully headless-testable.

import { damageMultiplier, dealDamage } from "./combat";
import { dist } from "./lanes";
import type { Unit, Vec2, World } from "./types";

export type AbilitySlot = "q" | "w" | "e" | "r";
export type AbilityKind = "nuke" | "dash" | "heal" | "shield";

export interface Ability {
  slot: AbilitySlot;
  name: string;
  kind: AbilityKind;
  cooldown: number; // seconds
  range: number;    // max cast distance from the hero (0 = self-cast)
  radius: number;   // effect radius
  amount: number;   // damage / heal / shield
}

function ab(
  slot: AbilitySlot, name: string, kind: AbilityKind,
  cooldown: number, range: number, radius: number, amount: number,
): Ability {
  return { slot, name, kind, cooldown, range, radius, amount };
}

/** Per-hero kits, keyed by roster id. Each kit is [Q, W, E, R]. */
export const KITS: Record<string, Ability[]> = {
  vanguard: [
    ab("q", "Crush", "nuke", 5, 12, 8, 90),
    ab("w", "Bulwark", "shield", 14, 0, 0, 280),
    ab("e", "Charge", "dash", 9, 35, 0, 0),
    ab("r", "Quake", "nuke", 70, 14, 18, 240),
  ],
  blade: [
    ab("q", "Slash", "nuke", 4, 11, 6, 110),
    ab("w", "Lunge", "dash", 7, 30, 0, 0),
    ab("e", "Riposte", "nuke", 8, 11, 6, 150),
    ab("r", "Execute", "nuke", 65, 12, 6, 420),
  ],
  pyre: [
    ab("q", "Ember", "nuke", 4, 40, 7, 130),
    ab("w", "Cinder Field", "nuke", 9, 42, 16, 180),
    ab("e", "Blink", "dash", 16, 32, 0, 0),
    ab("r", "Meteor", "nuke", 80, 50, 24, 520),
  ],
  hawk: [
    ab("q", "Power Shot", "nuke", 5, 46, 5, 150),
    ab("w", "Scatter", "nuke", 8, 40, 12, 120),
    ab("e", "Tumble", "dash", 12, 26, 0, 0),
    ab("r", "Snipe", "nuke", 60, 90, 4, 460),
  ],
  warden: [
    ab("q", "Mend", "heal", 5, 30, 8, 160),
    ab("w", "Sanctuary", "heal", 12, 30, 18, 130),
    ab("e", "Aegis", "shield", 10, 28, 0, 240),
    ab("r", "Rally", "heal", 70, 0, 40, 300),
  ],
};

export function kitFor(heroId: string): Ability[] {
  return KITS[heroId] ?? KITS.vanguard;
}

export function abilityOf(heroId: string, slot: AbilitySlot): Ability | null {
  return kitFor(heroId).find((a) => a.slot === slot) ?? null;
}

/** Remaining cooldown for a hero's slot, in seconds (0 = ready). */
export function cooldownRemaining(
  world: World, hero: Unit, slot: AbilitySlot,
): number {
  const readyAt = hero.abilityReadyAt?.[slot] ?? 0;
  return Math.max(0, readyAt - world.time);
}

/** Clamp `point` to within `range` of `origin`. */
function clampToRange(origin: Vec2, point: Vec2, range: number): Vec2 {
  const d = dist(origin, point);
  if (d <= range || d < 1e-5) return { ...point };
  return {
    x: origin.x + ((point.x - origin.x) / d) * range,
    z: origin.z + ((point.z - origin.z) / d) * range,
  };
}

/**
 * Cast a hero's ability at a target point. Returns true if it fired.
 * Fails (returns false) when the hero is dead or the slot is on cooldown.
 */
export function castAbility(
  world: World, hero: Unit, slot: AbilitySlot, rawPoint: Vec2,
): boolean {
  if (!hero.alive || hero.isDead || hero.kind !== "hero" || !hero.heroId) {
    return false;
  }
  const ability = abilityOf(hero.heroId, slot);
  if (!ability) return false;
  if (cooldownRemaining(world, hero, slot) > 0) return false;

  // Self-cast abilities (range 0) resolve at the hero.
  const point = ability.range > 0
    ? clampToRange(hero.pos, rawPoint, ability.range)
    : { ...hero.pos };

  switch (ability.kind) {
    case "nuke": {
      const dmg = ability.amount * damageMultiplier(world, hero);
      for (const u of world.units) {
        if (!u.alive || u.isDead || u.team === hero.team) continue;
        if (dist(u.pos, point) <= ability.radius) {
          dealDamage(world, u, dmg, hero);
          world.events.push({
            kind: "damage", unitId: u.id,
            to: { ...u.pos }, note: `${Math.round(dmg)}`,
          });
        }
      }
      break;
    }
    case "dash":
      hero.pos = { ...point };
      break;
    case "heal":
      for (const u of world.units) {
        if (!u.alive || u.isDead || u.team !== hero.team) continue;
        if (u.kind !== "hero" && u.kind !== "minion") continue;
        if (dist(u.pos, point) <= ability.radius) {
          const healed = Math.min(u.maxHp, u.hp + ability.amount) - u.hp;
          u.hp += healed;
          if (healed > 0) {
            world.events.push({
              kind: "damage", unitId: u.id,
              to: { ...u.pos }, note: `+${Math.round(healed)}`,
            });
          }
        }
      }
      break;
    case "shield": {
      // Shield the friendliest unit nearest the cast point (self included).
      let target = hero;
      let bestD = dist(hero.pos, point);
      for (const u of world.units) {
        if (u.team !== hero.team || u.kind !== "hero" || !u.alive || u.isDead) {
          continue;
        }
        const d = dist(u.pos, point);
        if (d < bestD) { bestD = d; target = u; }
      }
      target.shieldHp = (target.shieldHp ?? 0) + ability.amount;
      break;
    }
  }

  if (!hero.abilityReadyAt) hero.abilityReadyAt = {};
  hero.abilityReadyAt[slot] = world.time + ability.cooldown;
  world.events.push({
    kind: "ability",
    unitId: hero.id,
    team: hero.team,
    from: { ...hero.pos },
    to: point,
    note: `${ability.kind}:${ability.name}`,
  });
  return true;
}

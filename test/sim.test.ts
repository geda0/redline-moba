// Headless simulation tests. No browser, no three.js — the whole point of the
// sim/render split is that this file fully exercises the game logic.

import { describe, expect, it } from "vitest";
import { castAbility, cooldownRemaining } from "../src/sim/abilities";
import { applyCommand, resolveCommand } from "../src/sim/commands";
import { FIRST_WAVE_AT, MINIONS_PER_LANE, nexusPos } from "../src/sim/config";
import { dealDamage, fireAt, inRange, nearestEnemy } from "../src/sim/combat";
import { dist, lanePointAt } from "../src/sim/lanes";
import { ROSTER } from "../src/sim/roster";
import { stepWorld } from "../src/sim/step";
import type { World } from "../src/sim/types";
import {
  blueHeroes, createWorld, findUnit, spawnHero, spawnMinion,
} from "../src/sim/world";

function bareWorld(): World {
  return {
    time: 0, units: [], nextWaveAt: 1e9, waveCount: 0,
    matchOver: false, winner: null, events: [],
  };
}

describe("map construction", () => {
  it("createWorld places 2 nexuses and 22 towers", () => {
    const w = createWorld();
    expect(w.units.filter((u) => u.kind === "nexus")).toHaveLength(2);
    // 3 lanes x 3 per side x 2 sides = 18 lane towers + 4 nexus towers.
    expect(w.units.filter((u) => u.kind === "tower")).toHaveLength(22);
  });

  it("lanePointAt endpoints match the polyline", () => {
    const start = lanePointAt("mid", 0);
    const end = lanePointAt("mid", 1);
    expect(start.x).toBeCloseTo(36);
    expect(end.x).toBeCloseTo(164);
  });
});

describe("minion waves", () => {
  it("spawns a full wave at FIRST_WAVE_AT", () => {
    const w = createWorld();
    expect(w.units.filter((u) => u.kind === "minion")).toHaveLength(0);
    stepWorld(w, FIRST_WAVE_AT + 0.1);
    // 2 teams x 3 lanes x MINIONS_PER_LANE.
    const expected = 2 * 3 * MINIONS_PER_LANE;
    expect(w.units.filter((u) => u.kind === "minion")).toHaveLength(expected);
    expect(w.events.some((e) => e.kind === "wave_spawned")).toBe(true);
  });

  it("a blue minion marches toward the red base", () => {
    const w = bareWorld();
    const m = spawnMinion(w, "blue", "mid");
    const startDist = dist(m.pos, nexusPos("red"));
    for (let i = 0; i < 300; i++) stepWorld(w, 0.1); // 30s of sim
    expect(dist(m.pos, nexusPos("red"))).toBeLessThan(startDist - 60);
  });
});

describe("combat", () => {
  it("nearestEnemy finds an enemy and ignores allies", () => {
    const w = bareWorld();
    const blue = spawnMinion(w, "blue", "mid");
    const ally = spawnMinion(w, "blue", "mid");
    const red = spawnMinion(w, "red", "mid");
    ally.pos = { x: blue.pos.x + 2, z: blue.pos.z };
    red.pos = { x: blue.pos.x + 5, z: blue.pos.z };
    expect(nearestEnemy(w, blue, 50)).toBe(red);
  });

  it("fireAt drains hp and kills at zero", () => {
    const w = bareWorld();
    const a = spawnMinion(w, "blue", "mid");
    const b = spawnMinion(w, "red", "mid");
    const hp0 = b.hp;
    fireAt(w, a, b, 1.0);
    expect(b.hp).toBeCloseTo(hp0 - a.dps);
    fireAt(w, a, b, 100); // overkill
    expect(b.alive).toBe(false);
    expect(w.events.some((e) => e.kind === "death" && e.unitId === b.id)).toBe(true);
  });

  it("towers prioritize minions over heroes", () => {
    const w = createWorld();
    const tower = w.units.find((u) => u.kind === "tower" && u.team === "blue")!;
    const hero = spawnHero(w, "red", ROSTER[0], 0, { ...tower.pos });
    const minion = spawnMinion(w, "red", "mid");
    minion.pos = { x: tower.pos.x + 5, z: tower.pos.z };
    hero.pos = { x: tower.pos.x + 2, z: tower.pos.z };
    const target = nearestEnemy(w, tower, tower.attackRange,
      (u) => u.kind === "minion");
    expect(target).toBe(minion); // minion wins despite hero being closer
  });
});

describe("win condition", () => {
  it("destroying a nexus ends the match for the other team", () => {
    const w = createWorld();
    const redNexus = w.units.find((u) => u.kind === "nexus" && u.team === "red")!;
    const blueTower = w.units.find((u) => u.kind === "tower" && u.team === "blue")!;
    redNexus.hp = 50;
    fireAt(w, blueTower, redNexus, 1.0); // 110 dps > 50 hp
    stepWorld(w, 0.01); // death resolution runs inside the step
    expect(w.matchOver).toBe(true);
    expect(w.winner).toBe("blue");
  });
});

describe("heroes", () => {
  it("a killed hero respawns after the timer", () => {
    const w = bareWorld();
    const hero = spawnHero(w, "blue", ROSTER[1], 1, { x: 50, z: 50 });
    const enemy = spawnHero(w, "red", ROSTER[1], 1, { x: 999, z: 999 });
    hero.hp = 1;
    fireAt(w, enemy, hero, 100); // kill
    stepWorld(w, 0.01); // marks isDead + respawnAt
    expect(hero.isDead).toBe(true);
    expect(findUnit(w, hero.id)).toBeDefined(); // heroes persist while dead
    stepWorld(w, 9); // past the 8s respawn timer
    expect(hero.isDead).toBe(false);
    expect(hero.alive).toBe(true);
    expect(hero.hp).toBe(hero.maxHp);
  });

  it("an idle hero auto-attacks an enemy in range", () => {
    const w = bareWorld();
    spawnHero(w, "blue", ROSTER[3], 3, { x: 100, z: 100 });
    const foe = spawnMinion(w, "red", "mid");
    foe.pos = { x: 105, z: 100 }; // within Hawk's 38 range
    const hp0 = foe.hp;
    stepWorld(w, 0.5);
    expect(foe.hp).toBeLessThan(hp0);
  });

  it("inRange respects attack range", () => {
    const w = bareWorld();
    const a = spawnHero(w, "blue", ROSTER[0], 0, { x: 0, z: 0 }); // melee, range 9
    const b = spawnMinion(w, "red", "mid");
    b.pos = { x: 5, z: 0 };
    expect(inRange(a, b)).toBe(true);
    b.pos = { x: 20, z: 0 };
    expect(inRange(a, b)).toBe(false);
  });
});

describe("hero roster (M2)", () => {
  it("createWorld spawns 5 heroes per team", () => {
    const w = createWorld();
    const blue = w.units.filter((u) => u.kind === "hero" && u.team === "blue");
    const red = w.units.filter((u) => u.kind === "hero" && u.team === "red");
    expect(blue).toHaveLength(5);
    expect(red).toHaveLength(5);
  });

  it("blueHeroes returns the 5 in roster order", () => {
    const heroes = blueHeroes(createWorld());
    expect(heroes).toHaveLength(5);
    expect(heroes.map((h) => h.rosterIndex)).toEqual([0, 1, 2, 3, 4]);
  });

  it("a hero executes a moveGoal a driver writes", () => {
    const w = bareWorld();
    const h = spawnHero(w, "blue", ROSTER[0], 0, { x: 50, z: 50 });
    h.moveGoal = { x: 92, z: 50 }; // mouse/AI/voice would write this
    const d0 = dist(h.pos, h.moveGoal);
    for (let i = 0; i < 60; i++) stepWorld(w, 0.1); // 6s
    expect(dist(h.pos, { x: 92, z: 50 })).toBeLessThan(d0 - 20);
  });

  it("a hero chases and kills an explicit attack target", () => {
    const w = bareWorld();
    const h = spawnHero(w, "blue", ROSTER[1], 1, { x: 50, z: 50 });
    const foe = spawnMinion(w, "red", "mid");
    foe.pos = { x: 70, z: 50 };
    h.attackTargetId = foe.id;
    for (let i = 0; i < 200 && foe.alive; i++) stepWorld(w, 0.1);
    expect(foe.alive).toBe(false);
  });
});

describe("abilities (M3)", () => {
  it("a nuke damages enemies inside its radius", () => {
    const w = bareWorld();
    const pyre = spawnHero(w, "blue", ROSTER[2], 2, { x: 50, z: 50 }); // Pyre
    const foe = spawnHero(w, "red", ROSTER[0], 0, { x: 60, z: 50 });
    const hp0 = foe.hp;
    const cast = castAbility(w, pyre, "q", { x: 60, z: 50 });
    expect(cast).toBe(true);
    expect(foe.hp).toBeLessThan(hp0); // Ember hit
  });

  it("an ability on cooldown will not re-cast", () => {
    const w = bareWorld();
    const pyre = spawnHero(w, "blue", ROSTER[2], 2, { x: 50, z: 50 });
    spawnHero(w, "red", ROSTER[0], 0, { x: 60, z: 50 });
    expect(castAbility(w, pyre, "q", { x: 60, z: 50 })).toBe(true);
    expect(castAbility(w, pyre, "q", { x: 60, z: 50 })).toBe(false); // still cooling
    expect(cooldownRemaining(w, pyre, "q")).toBeGreaterThan(0);
    stepWorld(w, 5); // Ember cd is 4s
    expect(castAbility(w, pyre, "q", { x: 60, z: 50 })).toBe(true);
  });

  it("Warden's heal restores ally hp", () => {
    const w = bareWorld();
    const warden = spawnHero(w, "blue", ROSTER[4], 4, { x: 50, z: 50 });
    const ally = spawnHero(w, "blue", ROSTER[0], 0, { x: 54, z: 50 });
    ally.hp = 100;
    castAbility(w, warden, "q", { x: 54, z: 50 });
    expect(ally.hp).toBeGreaterThan(100);
  });

  it("a shield absorbs damage before hp", () => {
    const w = bareWorld();
    const warden = spawnHero(w, "blue", ROSTER[4], 4, { x: 50, z: 50 });
    castAbility(w, warden, "e", { x: 50, z: 50 }); // Aegis — 240 shield on self
    expect(warden.shieldHp).toBe(240);
    const hp0 = warden.hp;
    dealDamage(w, warden, 100);
    expect(warden.shieldHp).toBe(140);
    expect(warden.hp).toBe(hp0); // hp untouched while shield holds
    dealDamage(w, warden, 200);
    expect(warden.shieldHp).toBe(0);
    expect(warden.hp).toBe(hp0 - 60); // overflow hit hp
  });

  it("a dash relocates the hero", () => {
    const w = bareWorld();
    const vanguard = spawnHero(w, "blue", ROSTER[0], 0, { x: 10, z: 10 });
    castAbility(w, vanguard, "e", { x: 40, z: 10 }); // Charge — range 35
    expect(vanguard.pos.x).toBeCloseTo(40); // within range, lands on point
  });

  it("a dead hero cannot cast", () => {
    const w = bareWorld();
    const h = spawnHero(w, "blue", ROSTER[0], 0, { x: 10, z: 10 });
    h.isDead = true;
    expect(castAbility(w, h, "q", { x: 12, z: 10 })).toBe(false);
  });
});

describe("hero AI (M4a)", () => {
  it("an AI hero pushes its assigned lane toward the enemy nexus", () => {
    const w = bareWorld();
    const h = spawnHero(w, "blue", ROSTER[0], 0, { x: 30, z: 30 });
    h.aiControlled = true;
    h.assignedLane = "mid";
    const d0 = dist(h.pos, nexusPos("red"));
    for (let i = 0; i < 300; i++) stepWorld(w, 0.1); // 30s
    expect(dist(h.pos, nexusPos("red"))).toBeLessThan(d0 - 60);
  });

  it("an AI hero engages an enemy that comes close", () => {
    const w = bareWorld();
    const h = spawnHero(w, "blue", ROSTER[1], 1, { x: 100, z: 100 });
    h.aiControlled = true;
    const foe = spawnMinion(w, "red", "mid");
    foe.pos = { x: 108, z: 100 };
    const hp0 = foe.hp;
    stepWorld(w, 0.5);
    expect(foe.hp).toBeLessThan(hp0);
  });

  it("an AI hero retreats home when low", () => {
    const w = bareWorld();
    const h = spawnHero(w, "blue", ROSTER[2], 2, { x: 120, z: 120 });
    h.aiControlled = true;
    h.hp = h.maxHp * 0.2;
    const d0 = dist(h.pos, nexusPos("blue"));
    for (let i = 0; i < 120; i++) stepWorld(w, 0.1);
    expect(dist(h.pos, nexusPos("blue"))).toBeLessThan(d0 - 20);
  });

  it("a full 5v5 AI match runs and draws first blood on a structure", () => {
    const w = createWorld();
    for (let i = 0; i < 900 && !w.matchOver; i++) stepWorld(w, 0.1); // up to 90s
    expect(w.time).toBeGreaterThan(60);
    const towerHurt = w.units.some(
      (u) => u.kind === "tower" && u.hp < u.maxHp,
    );
    expect(towerHurt).toBe(true);
  });
});

describe("commands (M4b-1)", () => {
  it("parses a hero + verb + lane", () => {
    const cmd = resolveCommand("blade push top", createWorld(), null);
    expect(cmd).not.toBeNull();
    expect(cmd!.heroIds).toEqual(["blue-blade"]);
    expect(cmd!.directive).toEqual({ kind: "push", lane: "top" });
  });

  it("'all retreat' targets the 4 teammates, excluding the piloted hero", () => {
    const w = createWorld();
    const cmd = resolveCommand("all retreat", w, "blue-vanguard");
    expect(cmd).not.toBeNull();
    expect(cmd!.heroIds).toHaveLength(4);
    expect(cmd!.heroIds).not.toContain("blue-vanguard");
    expect(cmd!.directive.kind).toBe("retreat");
  });

  it("'warden follow me' follows the piloted hero", () => {
    const w = createWorld();
    const cmd = resolveCommand("warden follow me", w, "blue-pyre");
    expect(cmd!.heroIds).toEqual(["blue-warden"]);
    expect(cmd!.directive).toEqual({ kind: "follow", targetId: "blue-pyre" });
  });

  it("returns null for an unparseable command", () => {
    expect(resolveCommand("hello there", createWorld(), null)).toBeNull();
  });

  it("a retreat directive overrides default push even at full hp", () => {
    const w = bareWorld();
    const h = spawnHero(w, "blue", ROSTER[0], 0, { x: 100, z: 100 });
    h.aiControlled = true;
    h.directive = { kind: "retreat" };
    const d0 = dist(h.pos, nexusPos("blue"));
    for (let i = 0; i < 100; i++) stepWorld(w, 0.1);
    expect(dist(h.pos, nexusPos("blue"))).toBeLessThan(d0 - 20);
  });

  it("applyCommand routes a push-bot directive and the hero pushes bot", () => {
    const w = bareWorld();
    const h = spawnHero(w, "blue", ROSTER[3], 3, { x: 30, z: 30 });
    h.aiControlled = true;
    // Resolve against a createWorld so the hero ids line up, then retarget.
    applyCommand(w, {
      heroIds: [h.id], directive: { kind: "push", lane: "bot" },
      summary: "test",
    });
    expect(h.directive).toEqual({ kind: "push", lane: "bot" });
    const d0 = dist(h.pos, nexusPos("red"));
    for (let i = 0; i < 300; i++) stepWorld(w, 0.1);
    expect(dist(h.pos, nexusPos("red"))).toBeLessThan(d0 - 60);
  });
});

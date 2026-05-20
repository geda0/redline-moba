// Headless simulation tests. No browser, no three.js — the whole point of the
// sim/render split is that this file fully exercises the game logic.

import { describe, expect, it } from "vitest";
import { FIRST_WAVE_AT, MINIONS_PER_LANE, nexusPos } from "../src/sim/config";
import { fireAt, inRange, nearestEnemy } from "../src/sim/combat";
import { dist, lanePointAt } from "../src/sim/lanes";
import { ROSTER } from "../src/sim/roster";
import { stepWorld } from "../src/sim/step";
import type { World } from "../src/sim/types";
import { createWorld, findUnit, spawnHero, spawnMinion } from "../src/sim/world";

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

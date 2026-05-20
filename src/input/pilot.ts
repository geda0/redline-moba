// Mouse + keyboard pilot for the player's currently-piloted hero.
// LoL-style: RMB move / RMB-enemy attack / A+LMB attack-move / S stop /
// keys 1-5 switch which blue hero is piloted.
//
// Decoupled from the renderer: it raycasts the GROUND plane only, then finds
// the nearest enemy in the sim near the click point — no mesh picking.

import * as THREE from "three";
import { dist } from "../sim/lanes";
import type { Unit, Vec2, World } from "../sim/types";
import { blueHeroes } from "../sim/world";

const CLICK_ENEMY_RADIUS = 9; // click within this of an enemy → attack it

export class PilotController {
  private pilotedIndex = 0;
  private heroes: Unit[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private aHeld = false;

  constructor(
    private readonly canvas: HTMLElement,
    private readonly camera: THREE.Camera,
    private readonly world: World,
  ) {
    this.heroes = blueHeroes(world);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("mousedown", (e) => this.onMouseDown(e));
    addEventListener("keydown", (e) => this.onKeyDown(e));
    addEventListener("keyup", (e) => {
      if (e.key.toLowerCase() === "a") this.aHeld = false;
    });
  }

  /** The hero the player is currently piloting (may be dead/respawning). */
  current(): Unit | null {
    return this.heroes[this.pilotedIndex] ?? null;
  }

  pilotedRosterIndex(): number {
    return this.pilotedIndex;
  }

  private onKeyDown(e: KeyboardEvent): void {
    const k = e.key.toLowerCase();
    if (k === "a") { this.aHeld = true; return; }
    if (k >= "1" && k <= "5") {
      const idx = Number(k) - 1;
      if (idx < this.heroes.length) this.pilotedIndex = idx;
      return;
    }
    if (k === "s") {
      const h = this.current();
      if (h) { h.moveGoal = null; h.attackTargetId = null; }
    }
  }

  private onMouseDown(e: MouseEvent): void {
    const hero = this.current();
    if (!hero || hero.isDead) return;

    // Right-click → move or attack. A + left-click → attack-move.
    const isRight = e.button === 2;
    const isAttackMove = e.button === 0 && this.aHeld;
    if (!isRight && !isAttackMove) return;

    const ground = this.screenToGround(e);
    if (!ground) return;

    const foe = this.nearestEnemyNear(ground, hero.team, CLICK_ENEMY_RADIUS);
    if (foe) {
      hero.attackTargetId = foe.id;
      hero.moveGoal = null;
    } else if (isAttackMove) {
      // Attack-move with nothing clicked: walk there, engage en route.
      hero.moveGoal = ground;
      hero.attackTargetId = null;
    } else {
      hero.moveGoal = ground;
      hero.attackTargetId = null;
    }
  }

  private screenToGround(e: MouseEvent): Vec2 | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera as THREE.PerspectiveCamera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    return { x: hit.x, z: hit.z };
  }

  private nearestEnemyNear(p: Vec2, team: string, radius: number): Unit | null {
    let best: Unit | null = null;
    let bestD = radius;
    for (const u of this.world.units) {
      if (!u.alive || u.isDead || u.team === team) continue;
      const d = dist(u.pos, p);
      if (d < bestD) { bestD = d; best = u; }
    }
    return best;
  }
}

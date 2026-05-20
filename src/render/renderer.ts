// three.js render layer. Reads World each frame and syncs meshes.
// Owns ZERO game state — if it vanished, the sim would run identically.

import * as THREE from "three";
import { LANE_PATHS, LANES, MAP_SIZE, nexusPos } from "../sim/config";
import type { Unit, World } from "../sim/types";

const TEAM_HEX: Record<string, number> = { blue: 0x4a86ff, red: 0xff5b5b };

interface Tracer {
  line: THREE.Line;
  deadAt: number;
}

export class Renderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly meshes = new Map<string, THREE.Object3D>();
  private readonly tracers: Tracer[] = [];
  private clock = 0;

  constructor(container: HTMLElement) {
    this.scene.background = new THREE.Color(0x0a0d12);

    this.camera = new THREE.PerspectiveCamera(
      52, window.innerWidth / window.innerHeight, 1, 2000,
    );
    this.camera.position.set(100, 215, 28);
    this.camera.lookAt(100, 0, 112);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(60, 120, 40);
    this.scene.add(sun);

    this.buildMap();
    addEventListener("resize", () => this.resize());
  }

  private buildMap(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE),
      new THREE.MeshStandardMaterial({ color: 0x1f3018 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(MAP_SIZE / 2, 0, MAP_SIZE / 2);
    this.scene.add(ground);

    // Lane strips.
    for (const lane of LANES) {
      const path = LANE_PATHS[lane];
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z) + 14;
        const strip = new THREE.Mesh(
          new THREE.BoxGeometry(len, 0.2, 16),
          new THREE.MeshStandardMaterial({ color: 0x554a33 }),
        );
        strip.position.set((a.x + b.x) / 2, 0.12, (a.z + b.z) / 2);
        strip.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
        this.scene.add(strip);
      }
    }

    // River — diagonal band through center.
    const river = new THREE.Mesh(
      new THREE.BoxGeometry(250, 0.2, 26),
      new THREE.MeshStandardMaterial({ color: 0x2a5a8a }),
    );
    river.position.set(100, 0.14, 100);
    river.rotation.y = Math.PI / 4;
    this.scene.add(river);

    // Base platforms.
    for (const team of ["blue", "red"] as const) {
      const p = nexusPos(team);
      const plat = new THREE.Mesh(
        new THREE.CylinderGeometry(40, 40, 0.4, 32),
        new THREE.MeshStandardMaterial({ color: TEAM_HEX[team] }),
      );
      plat.material.color.multiplyScalar(0.35);
      plat.position.set(p.x, 0.18, p.z);
      this.scene.add(plat);
    }
  }

  /** Advance render state and draw. Call once per frame after stepWorld. */
  frame(world: World, dt: number): void {
    this.clock += dt;
    this.syncUnits(world);
    this.consumeEvents(world);
    this.updateTracers();
    this.renderer.render(this.scene, this.camera);
  }

  private syncUnits(world: World): void {
    const seen = new Set<string>();
    for (const u of world.units) {
      if (u.kind === "hero" && u.isDead) continue;
      seen.add(u.id);
      let mesh = this.meshes.get(u.id);
      if (!mesh) {
        mesh = this.buildUnitMesh(u);
        this.meshes.set(u.id, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(u.pos.x, mesh.userData.yOffset ?? 0, u.pos.z);
      // HP dim.
      const frac = Math.max(0.25, u.hp / u.maxHp);
      const mat = (mesh as THREE.Mesh).material as THREE.MeshStandardMaterial;
      if (mat && mat.color && mesh.userData.baseColor !== undefined) {
        mat.color.setHex(mesh.userData.baseColor as number);
        mat.color.multiplyScalar(frac);
      }
    }
    // Cull meshes whose units are gone.
    for (const [id, mesh] of this.meshes) {
      if (seen.has(id)) continue;
      this.scene.remove(mesh);
      this.meshes.delete(id);
    }
  }

  private buildUnitMesh(u: Unit): THREE.Mesh {
    let geo: THREE.BufferGeometry;
    let yOffset: number;
    switch (u.kind) {
      case "minion":
        geo = new THREE.BoxGeometry(2.4, 3, 2.4); yOffset = 1.5; break;
      case "tower":
        geo = new THREE.CylinderGeometry(2.6, 3.6, 14, 12); yOffset = 7; break;
      case "nexus":
        geo = new THREE.BoxGeometry(10, 10, 10); yOffset = 6; break;
      case "hero":
      default:
        geo = new THREE.CapsuleGeometry(2, 3.4, 4, 8); yOffset = 4; break;
    }
    const baseColor = TEAM_HEX[u.team];
    const mesh = new THREE.Mesh(
      geo, new THREE.MeshStandardMaterial({ color: baseColor }),
    );
    mesh.userData.yOffset = yOffset;
    mesh.userData.baseColor = baseColor;
    return mesh;
  }

  private consumeEvents(world: World): void {
    for (const e of world.events) {
      if (e.kind === "fire" && e.from && e.to) {
        const pts = [
          new THREE.Vector3(e.from.x, 2, e.from.z),
          new THREE.Vector3(e.to.x, 2, e.to.z),
        ];
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({
            color: e.team === "blue" ? 0xffe066 : 0xff7a4d,
          }),
        );
        this.scene.add(line);
        this.tracers.push({ line, deadAt: this.clock + 0.12 });
      }
    }
  }

  private updateTracers(): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      if (this.clock >= this.tracers[i].deadAt) {
        this.scene.remove(this.tracers[i].line);
        this.tracers[i].line.geometry.dispose();
        this.tracers.splice(i, 1);
      }
    }
  }

  private resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

// three.js render layer. Reads World each frame and syncs meshes. Owns ZERO
// game state — if it vanished, the sim would run identically.
//
// Game-feel pass: bloom + tone-mapped lighting, role-distinct hero models,
// billboard health bars, floating damage/heal numbers, hit flashes and
// death bursts. All of it is pure presentation driven off World + events.

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { LANE_PATHS, LANES, MAP_SIZE, nexusPos } from "../sim/config";
import { heroDef } from "../sim/roster";
import type { Unit, Vec2, World } from "../sim/types";

const TEAM_HEX: Record<string, number> = {
  blue: 0x4a86ff, red: 0xff5b5b, neutral: 0x9a8fb0,
};
const CAMP_HEX = { small: 0x9a8fb0, epic: 0xb066d6 };
const ABILITY_HEX: Record<string, number> = {
  nuke: 0xff7a33, heal: 0x5ad17a, shield: 0x66ccff, dash: 0xdddddd,
};

// Per-role hero silhouette — body proportions + the crest shape on top.
type CrestKind = "cone" | "box" | "sphere" | "oct";
const ROLE_SHAPE: Record<string, { r: number; h: number; crest: CrestKind }> = {
  Tank: { r: 2.7, h: 2.6, crest: "box" },
  Fighter: { r: 2.0, h: 3.8, crest: "oct" },
  Mage: { r: 1.7, h: 4.3, crest: "cone" },
  Marksman: { r: 1.7, h: 4.0, crest: "cone" },
  Support: { r: 2.1, h: 3.4, crest: "sphere" },
};

interface Tracer { line: THREE.Line; deadAt: number; }
interface Pulse { ring: THREE.Mesh; bornAt: number; dieAt: number; endRadius: number; }
interface Burst { mesh: THREE.Mesh; bornAt: number; dieAt: number; }
interface Popup { sprite: THREE.Sprite; bornAt: number; dieAt: number; }
interface Bar {
  group: THREE.Group;
  fill: THREE.Mesh;
  width: number;
  lift: number;
}

export class Renderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly meshes = new Map<string, THREE.Object3D>();
  private readonly bars = new Map<string, Bar>();
  private readonly tracers: Tracer[] = [];
  private readonly pulses: Pulse[] = [];
  private readonly bursts: Burst[] = [];
  private readonly popups: Popup[] = [];
  private clock = 0;
  private readonly camOffset = new THREE.Vector3(0, 96, -64);
  private pilotRing: THREE.Mesh | null = null;

  constructor(container: HTMLElement) {
    this.scene.background = new THREE.Color(0x05070c);
    this.scene.fog = new THREE.Fog(0x05070c, 150, 420);

    this.camera = new THREE.PerspectiveCamera(
      52, window.innerWidth / window.innerHeight, 1, 2000,
    );
    this.camera.position.set(100, 215, 28);
    this.camera.lookAt(100, 0, 112);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    container.appendChild(this.renderer.domElement);

    // Post chain — render, then a restrained bloom so tracers, crests and
    // the nexuses glow without washing the scene out.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.45, 0.82,
    );
    this.composer.addPass(bloom);

    this.scene.add(new THREE.AmbientLight(0x8090b0, 0.6));
    const sun = new THREE.DirectionalLight(0xfff0d8, 1.15);
    sun.position.set(60, 140, 40);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x4060a0, 0.5);
    rim.position.set(-40, 60, -80);
    this.scene.add(rim);

    this.buildMap();
    addEventListener("resize", () => this.resize());
  }

  /** The WebGL canvas — input listeners attach here. */
  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  private buildMap(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE),
      new THREE.MeshStandardMaterial({ color: 0x141d12, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(MAP_SIZE / 2, 0, MAP_SIZE / 2);
    this.scene.add(ground);

    // Faint grid for scale.
    const grid = new THREE.GridHelper(MAP_SIZE, 20, 0x2a3a26, 0x1c2618);
    grid.position.set(MAP_SIZE / 2, 0.05, MAP_SIZE / 2);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    this.scene.add(grid);

    // Lane strips.
    for (const lane of LANES) {
      const path = LANE_PATHS[lane];
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z) + 14;
        const strip = new THREE.Mesh(
          new THREE.BoxGeometry(len, 0.2, 16),
          new THREE.MeshStandardMaterial({
            color: 0x6a5a3a, emissive: 0x352a14, roughness: 0.9,
          }),
        );
        strip.position.set((a.x + b.x) / 2, 0.12, (a.z + b.z) / 2);
        strip.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
        this.scene.add(strip);
      }
    }

    // River — a glowing diagonal band through the center.
    const river = new THREE.Mesh(
      new THREE.BoxGeometry(250, 0.2, 26),
      new THREE.MeshStandardMaterial({
        color: 0x1c4a78, emissive: 0x12325a, roughness: 0.4,
      }),
    );
    river.position.set(100, 0.14, 100);
    river.rotation.y = Math.PI / 4;
    this.scene.add(river);

    // Base platforms — a dark disc with a thin glowing team-colored rim.
    for (const team of ["blue", "red"] as const) {
      const p = nexusPos(team);
      const plat = new THREE.Mesh(
        new THREE.CylinderGeometry(38, 38, 0.5, 44),
        new THREE.MeshStandardMaterial({ color: 0x10141c, roughness: 0.9 }),
      );
      plat.position.set(p.x, 0.18, p.z);
      this.scene.add(plat);

      const rim = new THREE.Mesh(
        new THREE.RingGeometry(36, 39, 56),
        new THREE.MeshBasicMaterial({
          color: TEAM_HEX[team], transparent: true, opacity: 0.7,
          side: THREE.DoubleSide,
        }),
      );
      rim.rotation.x = -Math.PI / 2;
      rim.position.set(p.x, 0.32, p.z);
      this.scene.add(rim);
    }
  }

  /** Advance render state and draw. Call once per frame after stepWorld. */
  frame(world: World, dt: number, focus?: Vec2, pilotedId?: string): void {
    this.clock += dt;
    if (focus) this.followCamera(focus, dt);
    this.syncUnits(world);
    this.syncBars(world);
    this.updatePilotRing(world, pilotedId);
    this.consumeEvents(world);
    this.updateTracers();
    this.updatePulses();
    this.updateBursts();
    this.updatePopups();
    this.composer.render();
  }

  private followCamera(focus: Vec2, dt: number): void {
    const want = new THREE.Vector3(
      focus.x + this.camOffset.x, this.camOffset.y, focus.z + this.camOffset.z,
    );
    const a = 1 - Math.exp(-8 * dt);
    this.camera.position.lerp(want, a);
    this.camera.lookAt(focus.x, 0, focus.z);
  }

  private updatePilotRing(world: World, pilotedId?: string): void {
    if (!this.pilotRing) {
      this.pilotRing = new THREE.Mesh(
        new THREE.RingGeometry(4.5, 6, 28),
        new THREE.MeshBasicMaterial({
          color: 0xffe066, side: THREE.DoubleSide, transparent: true, opacity: 0.9,
        }),
      );
      this.pilotRing.rotation.x = -Math.PI / 2;
      this.scene.add(this.pilotRing);
    }
    const hero = pilotedId
      ? world.units.find((u) => u.id === pilotedId)
      : undefined;
    if (hero && !hero.isDead) {
      this.pilotRing.visible = true;
      this.pilotRing.position.set(hero.pos.x, 0.3, hero.pos.z);
      const s = 1 + 0.05 * Math.sin(this.clock * 6);
      this.pilotRing.scale.set(s, s, s);
    } else {
      this.pilotRing.visible = false;
    }
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

      // Idle motion — nexuses spin, hero crests turn and bob.
      if (mesh.userData.spin) mesh.rotation.y = this.clock * 0.6;
      const crest = mesh.userData.crest as THREE.Object3D | undefined;
      if (crest) {
        crest.userData.baseY ??= crest.position.y;
        crest.rotation.y = this.clock * 1.6;
        crest.position.y =
          (crest.userData.baseY as number) + Math.sin(this.clock * 2.4) * 0.4;
      }

      // Hit flash — flare the body emissive when hp drops since last frame.
      const lastHp = mesh.userData.lastHp ?? u.hp;
      if (u.hp < lastHp - 0.5) mesh.userData.flashUntil = this.clock + 0.13;
      mesh.userData.lastHp = u.hp;
      const flashMat = mesh.userData.flashMat as
        THREE.MeshStandardMaterial | undefined;
      if (flashMat) {
        const flashing = this.clock < (mesh.userData.flashUntil ?? 0);
        flashMat.emissiveIntensity = flashing
          ? 1.6
          : (mesh.userData.baseEmissive ?? 0.25);
      }
    }
    for (const [id, mesh] of this.meshes) {
      if (seen.has(id)) continue;
      this.scene.remove(mesh);
      this.meshes.delete(id);
    }
  }

  private buildUnitMesh(u: Unit): THREE.Object3D {
    if (u.kind === "hero") return this.buildHeroMesh(u);

    let geo: THREE.BufferGeometry;
    let yOffset: number;
    let color: number;
    let emissive = 0x000000;
    let emissiveIntensity = 0;
    switch (u.kind) {
      case "minion":
        geo = new THREE.BoxGeometry(2.4, 3, 2.4); yOffset = 1.5;
        color = TEAM_HEX[u.team];
        break;
      case "tower":
        geo = new THREE.CylinderGeometry(2.6, 3.8, 15, 14); yOffset = 7.5;
        color = TEAM_HEX[u.team];
        emissive = TEAM_HEX[u.team]; emissiveIntensity = 0.3;
        break;
      case "nexus":
        geo = new THREE.OctahedronGeometry(8, 0); yOffset = 9;
        color = TEAM_HEX[u.team];
        emissive = TEAM_HEX[u.team]; emissiveIntensity = 0.85;
        break;
      case "camp":
      default: {
        const epic = u.campTier === "epic";
        geo = new THREE.OctahedronGeometry(epic ? 6.5 : 4, 0);
        yOffset = epic ? 7 : 4.5;
        color = CAMP_HEX[u.campTier ?? "small"];
        emissive = color; emissiveIntensity = epic ? 0.7 : 0.35;
        break;
      }
    }
    const mat = new THREE.MeshStandardMaterial({
      color, emissive, emissiveIntensity, roughness: 0.55, metalness: 0.2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.yOffset = yOffset;
    mesh.userData.flashMat = mat;
    mesh.userData.baseEmissive = emissiveIntensity;
    if (u.kind === "nexus") mesh.userData.spin = true;
    return mesh;
  }

  /** Heroes are small groups: a team-colored body + a glowing role crest. */
  private buildHeroMesh(u: Unit): THREE.Group {
    const def = heroDef(u.heroId ?? "vanguard");
    const shape = ROLE_SHAPE[def.role] ?? ROLE_SHAPE.Fighter;
    const group = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({
      color: TEAM_HEX[u.team], emissive: TEAM_HEX[u.team],
      emissiveIntensity: 0.2, roughness: 0.45, metalness: 0.45,
    });
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(shape.r, shape.h, 5, 12), bodyMat,
    );
    body.position.y = shape.r + shape.h / 2;
    group.add(body);

    // Role crest — accent-colored, emissive so bloom picks it up.
    const crestGeo =
      shape.crest === "cone" ? new THREE.ConeGeometry(1.5, 3, 12)
      : shape.crest === "box" ? new THREE.BoxGeometry(2.6, 2.6, 2.6)
      : shape.crest === "sphere" ? new THREE.SphereGeometry(1.7, 14, 12)
      : new THREE.OctahedronGeometry(1.9, 0);
    const crest = new THREE.Mesh(
      crestGeo,
      new THREE.MeshStandardMaterial({
        color: def.accent, emissive: def.accent, emissiveIntensity: 0.9,
        roughness: 0.3,
      }),
    );
    crest.position.y = shape.h + 2 * shape.r + 1.4;
    group.add(crest);
    group.userData.crest = crest;
    group.userData.yOffset = 0;
    group.userData.flashMat = bodyMat;
    group.userData.baseEmissive = 0.2;
    return group;
  }

  // ── health bars ────────────────────────────────────────────────────────
  private syncBars(world: World): void {
    const seen = new Set<string>();
    for (const u of world.units) {
      if (u.kind === "minion") continue; // too many, too small
      if (u.kind === "hero" && u.isDead) continue;
      seen.add(u.id);
      let bar = this.bars.get(u.id);
      if (!bar) {
        bar = this.buildBar(u);
        this.bars.set(u.id, bar);
        this.scene.add(bar.group);
      }
      bar.group.position.set(u.pos.x, bar.lift, u.pos.z);
      bar.group.quaternion.copy(this.camera.quaternion);
      const frac = Math.max(0, Math.min(1, u.hp / u.maxHp));
      bar.fill.scale.x = frac || 0.0001;
      const mat = bar.fill.material as THREE.MeshBasicMaterial;
      mat.color.setHex(
        frac > 0.5 ? 0x5ad17a : frac > 0.25 ? 0xffcc44 : 0xff5b5b,
      );
    }
    for (const [id, bar] of this.bars) {
      if (seen.has(id)) continue;
      this.scene.remove(bar.group);
      this.bars.delete(id);
    }
  }

  private buildBar(u: Unit): Bar {
    const width =
      u.kind === "nexus" ? 18
      : u.kind === "tower" ? 9
      : u.kind === "camp" ? (u.campTier === "epic" ? 13 : 8)
      : 8;
    const lift =
      u.kind === "nexus" ? 22
      : u.kind === "tower" ? 19
      : u.kind === "camp" ? (u.campTier === "epic" ? 17 : 12)
      : 13;
    const h = 1.1;
    const group = new THREE.Group();

    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(width + 0.7, h + 0.7),
      new THREE.MeshBasicMaterial({ color: 0x05070c }),
    );
    bg.position.z = -0.02;
    group.add(bg);

    const fillGeo = new THREE.PlaneGeometry(width, h);
    fillGeo.translate(width / 2, 0, 0); // origin at the left edge
    const fill = new THREE.Mesh(
      fillGeo, new THREE.MeshBasicMaterial({ color: 0x5ad17a }),
    );
    fill.position.x = -width / 2;
    group.add(fill);

    return { group, fill, width, lift };
  }

  // ── events → tracers / pulses / bursts / popups ─────────────────────────
  private consumeEvents(world: World): void {
    for (const e of world.events) {
      if (e.kind === "fire" && e.from && e.to) {
        this.spawnTracer(e.from, e.to, e.team === "blue" ? 0xffe066 : 0xff7a4d);
      } else if (e.kind === "ability" && e.to) {
        const kind = (e.note ?? "nuke:").split(":")[0];
        this.spawnPulse(e.to, ABILITY_HEX[kind] ?? 0xffffff,
          kind === "heal" || kind === "shield" ? 10 : 14);
      } else if (e.kind === "damage" && e.to) {
        const heal = (e.note ?? "").startsWith("+");
        this.spawnPopup(e.to, e.note ?? "", heal ? 0x6af09a : 0xffb24d);
      } else if (e.kind === "death" && e.from) {
        const col = e.team === "blue" ? 0x4a86ff
          : e.team === "red" ? 0xff5b5b : 0xb066d6;
        this.spawnBurst(e.from, col);
      } else if (e.kind === "nexus_destroyed") {
        const pos = nexusPos(e.team ?? "blue");
        this.spawnBurst(pos, 0xffffff);
      }
    }
  }

  private spawnTracer(from: Vec2, to: Vec2, color: number): void {
    const pts = [
      new THREE.Vector3(from.x, 3, from.z),
      new THREE.Vector3(to.x, 3, to.z),
    ];
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color, transparent: true }),
    );
    this.scene.add(line);
    this.tracers.push({ line, deadAt: this.clock + 0.12 });
  }

  private spawnPulse(at: Vec2, color: number, endRadius: number): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 1.4, 32),
      new THREE.MeshBasicMaterial({
        color, side: THREE.DoubleSide, transparent: true, opacity: 0.85,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(at.x, 0.5, at.z);
    this.scene.add(ring);
    this.pulses.push({
      ring, bornAt: this.clock, dieAt: this.clock + 0.45, endRadius,
    });
  }

  private spawnBurst(at: Vec2, color: number): void {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }),
    );
    mesh.position.set(at.x, 4, at.z);
    this.scene.add(mesh);
    this.bursts.push({ mesh, bornAt: this.clock, dieAt: this.clock + 0.5 });
  }

  private spawnPopup(at: Vec2, text: string, color: number): void {
    const cv = document.createElement("canvas");
    cv.width = 128; cv.height = 64;
    const ctx = cv.getContext("2d");
    if (ctx) {
      ctx.font = "bold 44px ui-monospace, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 7;
      ctx.strokeStyle = "#05070c";
      ctx.strokeText(text, 64, 34);
      ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
      ctx.fillText(text, 64, 34);
    }
    const tex = new THREE.CanvasTexture(cv);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
    );
    sprite.scale.set(11, 5.5, 1);
    sprite.position.set(at.x, 9, at.z);
    this.scene.add(sprite);
    this.popups.push({ sprite, bornAt: this.clock, dieAt: this.clock + 0.95 });
  }

  private updatePulses(): void {
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      const t = (this.clock - p.bornAt) / (p.dieAt - p.bornAt);
      if (t >= 1) {
        this.scene.remove(p.ring);
        p.ring.geometry.dispose();
        this.pulses.splice(i, 1);
        continue;
      }
      const s = 1 + t * p.endRadius;
      p.ring.scale.set(s, s, s);
      (p.ring.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - t);
    }
  }

  private updateBursts(): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      const t = (this.clock - b.bornAt) / (b.dieAt - b.bornAt);
      if (t >= 1) {
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        this.bursts.splice(i, 1);
        continue;
      }
      const s = 1 + t * 11;
      b.mesh.scale.set(s, s, s);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
    }
  }

  private updatePopups(): void {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      const t = (this.clock - p.bornAt) / (p.dieAt - p.bornAt);
      if (t >= 1) {
        this.scene.remove(p.sprite);
        p.sprite.material.map?.dispose();
        p.sprite.material.dispose();
        this.popups.splice(i, 1);
        continue;
      }
      p.sprite.position.y = 9 + t * 9;
      p.sprite.material.opacity = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
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
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }
}

// Minimap — a DOM canvas, bottom-right. Pure view: it redraws the whole
// board from World every frame and owns no state. Gives the player the
// god's-eye read they need to shotcall the AI squad.

import { LANE_PATHS, LANES, MAP_SIZE } from "../sim/config";
import type { World } from "../sim/types";

const SIZE = 188;
const TEAM_HEX: Record<string, string> = {
  blue: "#4a86ff", red: "#ff5b5b", neutral: "#b89ad0",
};

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    Object.assign(this.canvas.style, {
      position: "fixed", right: "8px", bottom: "8px",
      border: "1px solid #2a3242", background: "#070a10ee",
      pointerEvents: "none",
    });
    container.appendChild(this.canvas);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("minimap: no 2d context");
    this.ctx = ctx;
  }

  /** World (x,z) → canvas (px,py). Blue base sits bottom-left. */
  private project(x: number, z: number): [number, number] {
    return [(x / MAP_SIZE) * SIZE, SIZE - (z / MAP_SIZE) * SIZE];
  }

  update(world: World, pilotedId?: string): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, SIZE, SIZE);

    // Lanes.
    ctx.strokeStyle = "#3a3526";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    for (const lane of LANES) {
      const path = LANE_PATHS[lane];
      ctx.beginPath();
      path.forEach((p, i) => {
        const [px, py] = this.project(p.x, p.z);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }

    // River — the center diagonal.
    ctx.strokeStyle = "#1c3a5a";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(...this.project(0, MAP_SIZE));
    ctx.lineTo(...this.project(MAP_SIZE, 0));
    ctx.stroke();

    for (const u of world.units) {
      if (!u.alive && u.kind !== "hero") continue;
      if (u.kind === "hero" && u.isDead) continue;
      const [px, py] = this.project(u.pos.x, u.pos.z);
      const color = u.kind === "camp"
        ? (u.campTier === "epic" ? "#c77adb" : "#b89ad0")
        : TEAM_HEX[u.team] ?? "#999";

      switch (u.kind) {
        case "minion":
          dot(ctx, px, py, 1.5, color, 0.5);
          break;
        case "tower":
          square(ctx, px, py, 4, color);
          break;
        case "nexus":
          square(ctx, px, py, 9, color);
          break;
        case "camp":
          dot(ctx, px, py, u.campTier === "epic" ? 5 : 3, color, 1);
          break;
        case "hero":
          dot(ctx, px, py, 4, color, 1);
          if (u.id === pilotedId) {
            ctx.strokeStyle = "#ffe066";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(px, py, 6.5, 0, Math.PI * 2);
            ctx.stroke();
          }
          break;
      }
    }
  }
}

function dot(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, r: number, color: string, alpha: number,
): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function square(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, s: number, color: string,
): void {
  ctx.fillStyle = color;
  ctx.fillRect(x - s / 2, y - s / 2, s, s);
}

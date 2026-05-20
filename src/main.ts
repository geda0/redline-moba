// Entry point. Wires the sim + renderer + the requestAnimationFrame loop.

import { Renderer } from "./render/renderer";
import { createWorld } from "./sim/world";
import { stepWorld } from "./sim/step";

const container = document.getElementById("app");
if (!container) throw new Error("missing #app container");

const world = createWorld();
const renderer = new Renderer(container);

let lastT = performance.now();

function loop(now: number): void {
  // Clamp dt so an alt-tab pause doesn't teleport the sim.
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  stepWorld(world, dt);
  renderer.frame(world, dt);

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

// Expose for console poking during dev.
(window as unknown as { redline: unknown }).redline = { world };

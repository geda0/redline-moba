// Entry point. Wires sim + renderer + pilot input + HUD + the rAF loop.

import { PilotController } from "./input/pilot";
import { Hud } from "./render/hud";
import { Renderer } from "./render/renderer";
import { applyCommand, resolveCommand } from "./sim/commands";
import { stepWorld } from "./sim/step";
import { createWorld } from "./sim/world";

const container = document.getElementById("app");
if (!container) throw new Error("missing #app container");

const world = createWorld();
const renderer = new Renderer(container);
const pilot = new PilotController(renderer.domElement, renderer.camera, world);

// Text command bar → resolver → directives on the 4 AI teammates. M4b-2
// swaps Gemini Live voice in front of this exact same resolveCommand path.
const hud = new Hud(container, (text: string): string => {
  const cmd = resolveCommand(text, world, pilot.current()?.id ?? null);
  if (!cmd) return `not understood: "${text}"`;
  applyCommand(world, cmd);
  return cmd.summary;
});

let lastT = performance.now();

function loop(now: number): void {
  // Clamp dt so an alt-tab pause doesn't teleport the sim.
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  pilot.update();        // piloted hero → manual; the other four → AI
  stepWorld(world, dt);

  const current = pilot.current();
  renderer.frame(world, dt, current?.pos, current?.id);
  hud.update(world, pilot.pilotedRosterIndex());

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

// Expose for console poking during dev.
(window as unknown as { redline: unknown }).redline = { world, pilot };

// Entry point. Wires sim + renderer + pilot input + HUD + the rAF loop.

import { PilotController } from "./input/pilot";
import { Hud } from "./render/hud";
import { Minimap } from "./render/minimap";
import { Renderer } from "./render/renderer";
import { applyCommand, resolveCommand } from "./sim/commands";
import { stepWorld } from "./sim/step";
import { createWorld } from "./sim/world";
import { Atlas } from "./voice/atlas";
import { VoiceInput } from "./voice/speech";

const container = document.getElementById("app");
if (!container) throw new Error("missing #app container");

const world = createWorld();
const renderer = new Renderer(container);
const minimap = new Minimap(container);
const pilot = new PilotController(renderer.domElement, renderer.camera, world);

const hud = new Hud(container, runCommand);

// Atlas — the AI XO. Confirms orders and calls out the battlefield, speaking
// in-browser. Lines also mirror to the HUD feed.
const atlas = new Atlas((line) => hud.atlasLog(line));

// One command path. The text bar and voice both call runCommand — voice is
// just another front-end on the same resolver, exactly as designed. Every
// resolved order is echoed back by Atlas.
function runCommand(text: string): string {
  const cmd = resolveCommand(text, world, pilot.current()?.id ?? null);
  if (!cmd) return `not understood: "${text}"`;
  applyCommand(world, cmd);
  atlas.confirm(cmd);
  return cmd.summary;
}

// V — speak a command. Web Speech transcribes in-browser; transcript flows
// through the same runCommand path.
const voice = new VoiceInput(
  (text) => hud.showCommandResult(`🎙 "${text}" → ${runCommand(text)}`),
  (listening) => hud.setVoiceState(listening),
);
if (!voice.supported) {
  hud.showCommandResult("voice unavailable in this browser — use the text bar");
}

atlas.greet();

let lastT = performance.now();

function loop(now: number): void {
  // Clamp dt so an alt-tab pause doesn't teleport the sim.
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  pilot.update();        // piloted hero → manual; the other four → AI
  stepWorld(world, dt);
  atlas.observe(world);  // callouts from this step's events

  const current = pilot.current();
  renderer.frame(world, dt, current?.pos, current?.id);
  minimap.update(world, current?.id);
  hud.update(world, pilot.pilotedRosterIndex());

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

// Expose for console poking during dev.
(window as unknown as { redline: unknown }).redline = { world, pilot };

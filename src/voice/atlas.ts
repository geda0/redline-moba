// Atlas — the AI executive officer. Speaks order confirmations and live
// battlefield callouts in-browser via the Web Speech synthesis API. Pure
// presentation: Atlas reads World + resolved Commands, never mutates the sim.
//
// "The AI is the game": commanding the squad should feel like talking to an
// XO who answers back. Atlas is that voice — it confirms what it heard and
// reports what it sees so the player can shotcall without watching every unit.

import type { Command } from "../sim/commands";
import { ROSTER } from "../sim/roster";
import type { World } from "../sim/types";

type Priority = "low" | "med" | "high";

function heroName(id: string): string {
  const m = ROSTER.find((h) => id.endsWith(`-${h.id}`));
  return m ? m.name : id;
}

function pick<T>(xs: T[]): T {
  return xs[(Math.random() * xs.length) | 0];
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const pool = en.length ? en : voices;
  return (
    pool.find((v) => /daniel|arthur|google uk english male|\bmale\b/i.test(v.name)) ??
    pool[0] ??
    null
  );
}

/** A spoken order confirmation, varied so it never sounds canned. */
function confirmLine(cmd: Command): string {
  const d = cmd.directive;
  const who = cmd.heroIds.length > 1 ? "the squad" : heroName(cmd.heroIds[0]);
  switch (d.kind) {
    case "push":
      return pick([
        `Copy. ${cap(who)} pushing ${d.lane}.`,
        `Affirmative — ${who} on ${d.lane} lane.`,
        `${cap(who)} advancing ${d.lane}.`,
      ]);
    case "defend":
      return pick([
        `Understood. ${cap(who)} holding ${d.lane}.`,
        `${cap(who)} on defense, ${d.lane} lane.`,
      ]);
    case "group":
      return pick([
        `Copy. ${cap(who)} grouping ${d.lane}.`,
        `Regrouping ${d.lane}. On it.`,
      ]);
    case "retreat":
      return pick([
        `Falling back. ${cap(who)} disengaging.`,
        `Copy — ${who} pulling out.`,
      ]);
    case "follow":
      return `Copy. ${cap(who)} escorting ${heroName(d.targetId)}.`;
    case "focus":
      return pick([
        `Target locked — ${heroName(d.targetId)}. Collapsing now.`,
        `Copy. ${cap(who)} focusing ${heroName(d.targetId)}.`,
      ]);
    case "objective":
      return pick([
        `Moving on the epic. ${cap(who)} committed.`,
        `Copy — taking the epic monster.`,
      ]);
  }
}

export class Atlas {
  private readonly synth =
    typeof speechSynthesis !== "undefined" ? speechSynthesis : null;
  private voice: SpeechSynthesisVoice | null = null;
  private lastAt = -1e9;
  private readonly seenDeaths = new Set<string>();
  private greeted = false;
  private announcedOver = false;

  /** @param onLine mirrors every spoken line to the HUD transcript. */
  constructor(private readonly onLine: (text: string) => void) {
    if (this.synth) {
      const load = (): void => {
        this.voice = pickVoice(this.synth!.getVoices());
      };
      load();
      this.synth.addEventListener("voiceschanged", load);
    }
  }

  /** Opening line — spoken once when the match starts. */
  greet(): void {
    if (this.greeted) return;
    this.greeted = true;
    this.say("Atlas online. The squad is yours, Commander.", "high");
  }

  /** Confirm a resolved order back to the player. */
  confirm(cmd: Command): void {
    this.say(confirmLine(cmd), "high");
  }

  /** Scan this step's events for things worth a callout. Call once per
   * frame, after stepWorld, before the events are cleared. */
  observe(world: World): void {
    for (const e of world.events) {
      if (e.kind === "death") {
        this.onDeath(world, e.unitId);
      } else if (e.kind === "nexus_destroyed" && !this.announcedOver) {
        this.announcedOver = true;
        // e.team is the destroyed nexus's team — the other side wins.
        const won = e.team === "red";
        this.say(
          won
            ? "Enemy nexus destroyed. Victory, Commander."
            : "Our nexus has fallen. Stand down.",
          "high",
        );
      }
    }
  }

  private onDeath(world: World, id: string): void {
    if (this.seenDeaths.has(id)) return;
    this.seenDeaths.add(id);

    const unit = world.units.find((u) => u.id === id);
    if (unit && unit.kind === "hero") {
      const name = heroName(id);
      if (unit.team === "blue") {
        this.say(
          pick([
            `We lost ${name}.`,
            `${name} is down — cover the gap.`,
            `${name} down. Hold the line.`,
          ]),
          "med",
        );
      } else {
        this.say(
          pick([
            `${name} is down! Press the advantage.`,
            `Enemy ${name} eliminated.`,
            `That's ${name} — keep the pressure on.`,
          ]),
          "med",
        );
      }
      return;
    }

    if (id === "camp-epic") {
      const b = world.teamBuff.blue;
      const ours = b !== null && world.time < b.expiresAt;
      this.say(
        ours
          ? "Epic monster down — we're empowered. Force a fight."
          : "Enemy claimed the epic. Play it safe.",
        "high",
      );
    }
  }

  private say(text: string, prio: Priority): void {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    // Throttle chatter — high-priority lines always speak.
    if (prio === "low" && now - this.lastAt < 5000) return;
    if (prio === "med" && now - this.lastAt < 1800) return;
    this.lastAt = now;

    this.onLine(text);

    if (!this.synth) return;
    if (prio === "high") this.synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.rate = 1.04;
    u.pitch = 0.9;
    this.synth.speak(u);
  }
}

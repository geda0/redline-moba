// DOM HUD overlay — roster panel, match status, controls hint. Pure view:
// reads World each frame, owns no game state.

import { cooldownRemaining, kitFor } from "../sim/abilities";
import { heroDef } from "../sim/roster";
import type { Unit, World } from "../sim/types";
import { blueHeroes } from "../sim/world";

const STYLE = `
#hud { position: fixed; inset: 0; pointer-events: none;
  font: 13px/1.4 ui-monospace, Menlo, monospace; color: #dfe6f0; }
#hud .status { position: absolute; top: 8px; left: 8px;
  background: #0c0f16cc; padding: 6px 12px; border: 1px solid #2a3242; }
#hud .roster { position: absolute; top: 44px; left: 8px;
  display: flex; flex-direction: column; gap: 4px; }
#hud .hero { background: #0c0f16cc; border: 1px solid #2a3242;
  padding: 4px 8px; width: 224px; }
#hud .hero.piloted { border-color: #ffe066; }
#hud .hero .name { display: flex; justify-content: space-between; }
#hud .hero .bar { height: 5px; background: #20242e; margin-top: 3px; }
#hud .hero .bar > i { display: block; height: 100%; background: #5ad17a; }
#hud .hero.dead { opacity: 0.5; }
#hud .hint { position: absolute; bottom: 8px; left: 50%;
  transform: translateX(-50%); background: #0c0f16cc; padding: 4px 12px;
  border: 1px solid #2a3242; color: #aab4c2; }
#hud .banner { position: absolute; top: 38%; left: 0; right: 0;
  text-align: center; font-size: 44px; font-weight: 700; }
#hud .cmdbar { position: absolute; bottom: 124px; left: 50%;
  transform: translateX(-50%); display: flex; flex-direction: column;
  align-items: center; gap: 4px; }
#hud .cmdbar input { pointer-events: auto; width: 380px; padding: 6px 10px;
  background: #0c0f16ee; border: 1px solid #2a3242; color: #dfe6f0;
  font: 13px ui-monospace, Menlo, monospace; outline: none; }
#hud .cmdbar input:focus { border-color: #ffe066; }
#hud .cmdbar .fb { color: #9fd8ff; min-height: 16px; }
#hud .cmdbar .voice { color: #ff9c6b; min-height: 14px; font-weight: 700; }
#hud .atlasfeed { position: absolute; top: 8px; right: 8px; width: 312px;
  display: flex; flex-direction: column; gap: 3px; align-items: flex-end; }
#hud .atlasfeed .line { background: #100c1ad8; border: 1px solid #3a3055;
  border-left: 3px solid #c8a8ff; padding: 4px 9px; color: #ddccf4;
  animation: atlasIn 0.18s ease-out; }
#hud .atlasfeed .line .tag { color: #c8a8ff; font-weight: 700;
  letter-spacing: 0.5px; margin-right: 6px; }
@keyframes atlasIn { from { opacity: 0; transform: translateX(12px); }
  to { opacity: 1; transform: none; } }
#hud .abilities { position: absolute; bottom: 38px; left: 50%;
  transform: translateX(-50%); display: flex; gap: 6px; }
#hud .ability { width: 86px; background: #0c0f16dd; border: 1px solid #2a3242;
  padding: 4px 6px; text-align: center; position: relative; }
#hud .ability .key { font-weight: 700; color: #ffe066; }
#hud .ability .nm { font-size: 11px; color: #c2cad6; }
#hud .ability .cd { position: absolute; inset: 0; background: #000000bb;
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-size: 16px; font-weight: 700; }
`;

export class Hud {
  private readonly root: HTMLDivElement;
  private readonly statusEl: HTMLDivElement;
  private readonly rosterEl: HTMLDivElement;
  private readonly bannerEl: HTMLDivElement;
  private readonly abilityEl: HTMLDivElement;
  private readonly atlasEl: HTMLDivElement;
  private readonly cmdInput: HTMLInputElement;
  private readonly cmdFeedback: HTMLDivElement;
  private readonly voiceEl: HTMLDivElement;

  /** @param onCommand resolves+applies a command string, returns HUD feedback. */
  constructor(container: HTMLElement, onCommand: (text: string) => string) {
    const style = document.createElement("style");
    style.textContent = STYLE;
    document.head.appendChild(style);

    this.root = el("div");
    this.root.id = "hud";
    this.statusEl = el("div", "status");
    this.rosterEl = el("div", "roster");
    this.bannerEl = el("div", "banner");
    this.abilityEl = el("div", "abilities");
    this.atlasEl = el("div", "atlasfeed");

    // Command bar — type or speak an order to the 4 AI teammates. Enter
    // focuses it from anywhere; Enter again submits. V speaks a command.
    const cmdWrap = el("div", "cmdbar");
    this.voiceEl = el("div", "voice");
    this.cmdFeedback = el("div", "fb");
    this.cmdInput = document.createElement("input");
    this.cmdInput.placeholder = 'order your team — e.g. "blade push top"';
    cmdWrap.append(this.voiceEl, this.cmdFeedback, this.cmdInput);
    this.cmdInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key !== "Enter") return;
      const text = this.cmdInput.value.trim();
      if (text) this.cmdFeedback.textContent = onCommand(text);
      this.cmdInput.value = "";
      this.cmdInput.blur();
    });
    addEventListener("keydown", (e) => {
      if (e.key === "Enter" && document.activeElement !== this.cmdInput) {
        e.preventDefault();
        this.cmdInput.focus();
      }
    });

    const hint = el("div", "hint");
    hint.textContent =
      "1-5 switch · RMB move · A+LMB attack-move · Q/W/E/R abilities · " +
      "S stop · ENTER order (push/defend/focus/take epic) · V speak";
    this.root.append(
      this.statusEl, this.rosterEl, this.atlasEl, cmdWrap, this.abilityEl,
      hint, this.bannerEl,
    );
    container.appendChild(this.root);
  }

  /** Display a command result (text bar submit or voice transcript). */
  showCommandResult(text: string): void {
    this.cmdFeedback.textContent = text;
  }

  /** Append an Atlas line to the callout feed (keeps the last 3, ~8s each). */
  atlasLog(text: string): void {
    const line = el("div", "line");
    const tag = el("span", "tag");
    tag.textContent = "ATLAS";
    line.append(tag, document.createTextNode(text));
    this.atlasEl.prepend(line);
    while (this.atlasEl.childElementCount > 3) {
      this.atlasEl.lastElementChild?.remove();
    }
    setTimeout(() => line.remove(), 8000);
  }

  /** Voice listening indicator. */
  setVoiceState(listening: boolean): void {
    this.voiceEl.textContent = listening ? "🎙 listening…" : "";
  }

  update(world: World, pilotedIndex: number): void {
    const mm = Math.floor(world.time / 60);
    const ss = Math.floor(world.time % 60);
    const minions = world.units.filter((u) => u.kind === "minion").length;
    let status =
      `${pad(mm)}:${pad(ss)}   minions ${minions}   wave ${world.waveCount}`;
    const epic = epicBuffLabel(world);
    if (epic) status += `   ${epic}`;
    this.statusEl.textContent = status;

    const heroes = blueHeroes(world);
    this.syncRoster(heroes, pilotedIndex, world);
    this.syncAbilities(heroes[pilotedIndex], world);

    if (world.matchOver) {
      const won = world.winner === "blue";
      this.bannerEl.textContent = won ? "VICTORY" : "DEFEAT";
      this.bannerEl.style.color = won ? "#5ad17a" : "#ff6b6b";
    } else {
      this.bannerEl.textContent = "";
    }
  }

  private syncAbilities(hero: Unit | undefined, world: World): void {
    if (!hero || !hero.heroId) {
      this.abilityEl.replaceChildren();
      return;
    }
    const kit = kitFor(hero.heroId);
    if (this.abilityEl.childElementCount !== kit.length) {
      this.abilityEl.replaceChildren();
      for (const a of kit) {
        const cell = el("div", "ability");
        cell.innerHTML =
          `<div class="key">${a.slot.toUpperCase()}</div>` +
          `<div class="nm">${a.name}</div>` +
          `<div class="cd"></div>`;
        this.abilityEl.appendChild(cell);
      }
    }
    kit.forEach((a, i) => {
      const cell = this.abilityEl.children[i] as HTMLElement;
      const cd = cell.querySelector(".cd") as HTMLElement;
      const remain = cooldownRemaining(world, hero, a.slot);
      if (remain > 0.05) {
        cd.style.display = "flex";
        cd.textContent = remain >= 1 ? `${Math.ceil(remain)}` : remain.toFixed(1);
      } else {
        cd.style.display = "none";
      }
    });
  }

  private syncRoster(heroes: Unit[], pilotedIndex: number, world: World): void {
    // Rebuild only if the row count changed; otherwise update in place.
    if (this.rosterEl.childElementCount !== heroes.length) {
      this.rosterEl.replaceChildren();
      for (let i = 0; i < heroes.length; i++) {
        const row = el("div", "hero");
        const name = el("div", "name");
        const bar = el("div", "bar");
        bar.appendChild(el("i"));
        row.append(name, bar);
        this.rosterEl.appendChild(row);
      }
    }
    heroes.forEach((h, i) => {
      const row = this.rosterEl.children[i] as HTMLElement;
      const def = heroDef(h.heroId ?? "vanguard");
      row.classList.toggle("piloted", i === pilotedIndex);
      row.classList.toggle("dead", !!h.isDead);
      const name = row.firstElementChild as HTMLElement;
      const buffed = h.buff && world.time < h.buff.expiresAt;
      const right = h.isDead
        ? `respawn ${Math.ceil((h.respawnAt ?? 0) - world.time)}s`
        : `${Math.round(h.hp)}/${h.maxHp}`;
      const buff = buffed
        ? ` <span style="color:#ffb84d">⚡${Math.ceil(
            (h.buff!.expiresAt - world.time))}s</span>`
        : "";
      name.innerHTML =
        `<span>${i + 1}. ${def.name} <small>${def.role}</small>${buff}</span>` +
        `<span>${right}</span>`;
      const fill = row.querySelector("i") as HTMLElement;
      fill.style.width = `${Math.max(0, (h.hp / h.maxHp) * 100)}%`;
    });
  }
}

function el(tag: string, cls?: string): HTMLDivElement {
  const e = document.createElement(tag) as HTMLDivElement;
  if (cls) e.className = cls;
  return e;
}

/** Status-bar label for any active epic (team-wide) buff. */
function epicBuffLabel(world: World): string {
  const parts: string[] = [];
  for (const team of ["blue", "red"] as const) {
    const b = world.teamBuff[team];
    if (b && world.time < b.expiresAt) {
      parts.push(`⚡${team.toUpperCase()} EPIC ${Math.ceil(b.expiresAt - world.time)}s`);
    }
  }
  return parts.join("  ");
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

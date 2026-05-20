// DOM HUD overlay — roster panel, match status, controls hint. Pure view:
// reads World each frame, owns no game state.

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
`;

export class Hud {
  private readonly root: HTMLDivElement;
  private readonly statusEl: HTMLDivElement;
  private readonly rosterEl: HTMLDivElement;
  private readonly bannerEl: HTMLDivElement;

  constructor(container: HTMLElement) {
    const style = document.createElement("style");
    style.textContent = STYLE;
    document.head.appendChild(style);

    this.root = el("div");
    this.root.id = "hud";
    this.statusEl = el("div", "status");
    this.rosterEl = el("div", "roster");
    this.bannerEl = el("div", "banner");
    const hint = el("div", "hint");
    hint.textContent =
      "1-5 switch hero · RMB move · A+LMB attack-move · S stop";
    this.root.append(this.statusEl, this.rosterEl, hint, this.bannerEl);
    container.appendChild(this.root);
  }

  update(world: World, pilotedIndex: number): void {
    const mm = Math.floor(world.time / 60);
    const ss = Math.floor(world.time % 60);
    const minions = world.units.filter((u) => u.kind === "minion").length;
    this.statusEl.textContent =
      `${pad(mm)}:${pad(ss)}   minions ${minions}   wave ${world.waveCount}`;

    const heroes = blueHeroes(world);
    this.syncRoster(heroes, pilotedIndex, world);

    if (world.matchOver) {
      const won = world.winner === "blue";
      this.bannerEl.textContent = won ? "VICTORY" : "DEFEAT";
      this.bannerEl.style.color = won ? "#5ad17a" : "#ff6b6b";
    } else {
      this.bannerEl.textContent = "";
    }
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
      const right = h.isDead
        ? `respawn ${Math.ceil((h.respawnAt ?? 0) - world.time)}s`
        : `${Math.round(h.hp)}/${h.maxHp}`;
      name.innerHTML =
        `<span>${i + 1}. ${def.name} <small>${def.role}</small></span>` +
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

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

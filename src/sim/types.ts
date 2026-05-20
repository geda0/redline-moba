// Core simulation types. Pure data — the whole sim is testable without a
// browser. Rendering reads these; it never owns them.

export type Team = "blue" | "red" | "neutral";
export type Lane = "top" | "mid" | "bot";
export type UnitKind = "minion" | "tower" | "nexus" | "hero" | "camp";

/** A temporary damage multiplier — from a jungle camp (personal) or the
 * epic monster (team-wide). Inert once world.time passes expiresAt. */
export interface Buff {
  dmgMul: number;
  expiresAt: number;
}

export interface Vec2 {
  x: number;
  z: number;
}

/** A standing order issued to an AI teammate. The resolver (text or voice)
 * produces these; the hero AI consumes them. Same structure either way —
 * the Directive is the contract between command input and the sim.
 *
 *   push/defend/group — lane intents
 *   retreat           — disengage to base
 *   follow            — escort an ally
 *   focus             — hunt + kill one named enemy (commandable focus fire)
 *   objective         — go take a neutral target (the epic monster) */
export type Directive =
  | { kind: "push"; lane: Lane }
  | { kind: "defend"; lane: Lane }
  | { kind: "group"; lane: Lane }
  | { kind: "retreat" }
  | { kind: "follow"; targetId: string }
  | { kind: "focus"; targetId: string }
  | { kind: "objective"; targetId: string };

export interface Unit {
  id: string;
  team: Team;
  kind: UnitKind;
  pos: Vec2;

  hp: number;
  maxHp: number;
  moveSpeed: number; // world units / second
  attackRange: number;
  dps: number;
  alive: boolean;

  /** Throttle stamp for fire events (visual tracers). */
  lastFireAt: number;

  // ── minion ────────────────────────────────────────────────────────────
  lane?: Lane;
  /** Index into the lane polyline; walk direction depends on team. */
  waypointIndex?: number;

  // ── hero (M2) ─────────────────────────────────────────────────────────
  heroId?: string;
  rosterIndex?: number;
  /** When true, the hero AI writes this hero's command state each step.
   * The piloted hero has this false — the mouse driver owns it instead.
   * Voice (M4b) commands AI heroes by writing the same state. */
  aiControlled?: boolean;
  /** Lane this hero is assigned to push when not fighting. */
  assignedLane?: Lane;
  /** Standing order from the player (text/voice command). The hero AI reads
   * this each step. Null/undefined → default push behavior. */
  directive?: Directive | null;
  /** Driver-written command state. Mouse / AI / voice all write these; the
   * step just executes whatever is set. */
  moveGoal?: Vec2 | null;
  attackTargetId?: string | null;
  /** Respawn timestamp (world.time) while dead. */
  respawnAt?: number;
  isDead?: boolean;

  // ── abilities (M3) ────────────────────────────────────────────────────
  /** Ability slot ("q"/"w"/"e"/"r") → world.time when it's castable again. */
  abilityReadyAt?: Record<string, number>;
  /** Damage-absorbing shield; consumed before hp. */
  shieldHp?: number;

  // ── jungle (M5) ───────────────────────────────────────────────────────
  /** Personal damage buff (from killing a jungle camp). */
  buff?: Buff;
  /** Camp tier — small camps buff the killer, the epic buffs the team. */
  campTier?: "small" | "epic";
  /** A camp's home position — it leashes here and never roams. */
  leashHome?: Vec2;
}

export type SimEventKind =
  | "fire"
  | "death"
  | "wave_spawned"
  | "nexus_destroyed"
  | "ability";

export interface SimEvent {
  kind: SimEventKind;
  /** Acting unit (shooter, the unit that died, the caster). */
  unitId: string;
  /** Target unit, when relevant (fire). */
  targetId?: string;
  team?: Team;
  /** World positions captured at event time, for the renderer. */
  from?: Vec2;
  to?: Vec2;
  /** Free-text tag — ability kind, ability name, etc. */
  note?: string;
}

export interface World {
  /** Seconds since match start. */
  time: number;
  units: Unit[];
  nextWaveAt: number;
  waveCount: number;
  matchOver: boolean;
  winner: Team | null;
  /** Team-wide damage buff from the epic monster. */
  teamBuff: { blue: Buff | null; red: Buff | null };
  /** Events produced by the most recent stepWorld call. The renderer and
   * voice layers consume + clear this each frame. */
  events: SimEvent[];
}

// Core simulation types. Pure data — the whole sim is testable without a
// browser. Rendering reads these; it never owns them.

export type Team = "blue" | "red";
export type Lane = "top" | "mid" | "bot";
export type UnitKind = "minion" | "tower" | "nexus" | "hero";

export interface Vec2 {
  x: number;
  z: number;
}

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
  /** Driver-written command state. Mouse / AI / voice all write these; the
   * step just executes whatever is set. */
  moveGoal?: Vec2 | null;
  attackTargetId?: string | null;
  /** Respawn timestamp (world.time) while dead. */
  respawnAt?: number;
  isDead?: boolean;
}

export type SimEventKind =
  | "fire"
  | "death"
  | "wave_spawned"
  | "nexus_destroyed";

export interface SimEvent {
  kind: SimEventKind;
  /** Acting unit (shooter, the unit that died, the nexus). */
  unitId: string;
  /** Target unit, when relevant (fire). */
  targetId?: string;
  team?: Team;
  /** World positions captured at event time, for the renderer. */
  from?: Vec2;
  to?: Vec2;
}

export interface World {
  /** Seconds since match start. */
  time: number;
  units: Unit[];
  nextWaveAt: number;
  waveCount: number;
  matchOver: boolean;
  winner: Team | null;
  /** Events produced by the most recent stepWorld call. The renderer and
   * voice layers consume + clear this each frame. */
  events: SimEvent[];
}

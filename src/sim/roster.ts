// The five hero archetypes. Both teams field the same roster.
// Stats are M2 baseline; ability kits arrive in M3.

export interface HeroDef {
  id: string;
  name: string;
  role: "Tank" | "Fighter" | "Mage" | "Marksman" | "Support";
  maxHp: number;
  moveSpeed: number;
  attackRange: number;
  dps: number;
  /** Accent color (hex) for the role marker. */
  accent: number;
}

export const ROSTER: HeroDef[] = [
  {
    id: "vanguard", name: "Vanguard", role: "Tank",
    maxHp: 720, moveSpeed: 20, attackRange: 9, dps: 26, accent: 0xf2cc59,
  },
  {
    id: "blade", name: "Blade", role: "Fighter",
    maxHp: 520, moveSpeed: 23, attackRange: 9, dps: 52, accent: 0xf2734d,
  },
  {
    id: "pyre", name: "Pyre", role: "Mage",
    maxHp: 360, moveSpeed: 21, attackRange: 34, dps: 46, accent: 0xb273ff,
  },
  {
    id: "hawk", name: "Hawk", role: "Marksman",
    maxHp: 340, moveSpeed: 22, attackRange: 38, dps: 50, accent: 0x66f2b3,
  },
  {
    id: "warden", name: "Warden", role: "Support",
    maxHp: 470, moveSpeed: 21, attackRange: 24, dps: 22, accent: 0x80d9ff,
  },
];

export function heroDef(id: string): HeroDef {
  return ROSTER.find((h) => h.id === id) ?? ROSTER[0];
}

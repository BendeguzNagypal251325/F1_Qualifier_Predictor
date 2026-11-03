export type PartId = "front-wing" | "nose" | "cockpit" | "sidepods" | "floor" | "power-unit" | "rear-wing" | "wheels";

export const PART_LABEL: Record<PartId, string> = {
  "front-wing": "Front wing",
  nose: "Nose & chassis",
  cockpit: "Cockpit & halo",
  sidepods: "Sidepods",
  floor: "Floor",
  "power-unit": "Power unit",
  "rear-wing": "Rear wing",
  wheels: "Tyres & suspension",
};
export const PART_ORDER: PartId[] = ["front-wing", "nose", "cockpit", "sidepods", "floor", "power-unit", "rear-wing", "wheels"];

// Public FIA technical-regulation figures per era.
export const ERA_SPECS: Record<string, { width: string; wheelbase: string; weight: string; wheels: string; extra: string }> = {
  "2017-2021": { width: "2.0 m", wheelbase: "not capped (~3.6–3.7 m)", weight: "746–752 kg", wheels: "13-inch", extra: "Bargeboards, DRS" },
  "2022-2025": { width: "2.0 m", wheelbase: "≤ 3.6 m", weight: "798–800 kg", wheels: "18-inch with covers", extra: "Venturi floor, DRS" },
  "2026-": { width: "1.9 m", wheelbase: "≤ 3.4 m", weight: "768 kg", wheels: "18-inch, narrower", extra: "Active front and rear wings, no DRS" },
};

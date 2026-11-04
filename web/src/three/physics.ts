import type { PartId } from "./parts";

// Physics facts for each car and each part. The numbers are worked out from the season's public
// rules (minimum weight, tyre size) with simple formulas, and every fact says how it was
// calculated. They describe the rules' car, not a team's measured data, which nobody publishes.

/** FIA minimum car weight with driver, without fuel (kg). */
export const MIN_WEIGHT: Record<number, number> = {
  2020: 746, 2021: 752, 2022: 798, 2023: 798, 2024: 798, 2025: 800, 2026: 768,
};
/** Approximate tyre outside diameter per era (m). */
const TYRE_DIAMETER: Record<string, number> = { "2017-2021": 0.67, "2022-2025": 0.72, "2026-": 0.708 };

const G = 9.81;
const kmh = (v: number) => v / 3.6;
const round = (x: number, step = 1) => Math.round(x / step) * step;
const n = (x: number) => x.toLocaleString("en-GB");

export interface Fact { label: string; value: string; how: string }

const weightOf = (season: number) => MIN_WEIGHT[season] ?? (season < 2022 ? 752 : season < 2026 ? 800 : 768);

/** Facts for a whole car; ``paceGap`` is its average gap to pole in %. */
export function carPhysics(season: number, era: string, paceGap: number | null): Fact[] {
  const m = weightOf(season), v = kmh(300);
  const energy = 0.5 * m * v * v;
  const facts: Fact[] = [
    { label: "Minimum weight", value: `${m} kg`, how: `FIA limit for ${season}, with the driver and without fuel.` },
    {
      label: "Energy at 300 km/h", value: `${(energy / 1e6).toFixed(2)} MJ`,
      how: `Kinetic energy ½·m·v² = ½ × ${m} kg × (83.3 m/s)². The brakes turn this into heat when the car slows down; the same energy would lift the car ${round(v * v / (2 * G))} m.`,
    },
    {
      label: "Sideways force at 5 g", value: `${(m * 5 * G / 1000).toFixed(1)} kN`,
      how: `F = m·a = ${m} kg × 5 × 9.81 m/s². In a 5 g corner the tyres push this hard sideways, like holding up ${round(m * 5 / 1000, 0.1).toFixed(1)} tonnes.`,
    },
  ];
  if (paceGap != null) {
    const lap = 90, avg = kmh(220);
    const t = (paceGap / 100) * lap;
    facts.push({
      label: "Gap to pole on a lap", value: `${t.toFixed(2)} s ≈ ${round(t * avg)} m`,
      how: `${paceGap.toFixed(2)}% of a 90-second lap; at a 220 km/h average that is the distance behind the pole car at the line.`,
    });
  }
  if (era === "2026-") {
    facts.push({
      label: "Drag vs 2025", value: "−55%",
      how: "FIA target for the 2026 rules (downforce −30%). The power needed to push through the air at a given speed falls by the same 55%.",
    });
  }
  return facts;
}

/** Physics facts for one part of a car of ``season``. */
export function partPhysics(part: PartId, season: number, era: string): Fact[] {
  const m = weightOf(season);
  switch (part) {
    case "front-wing":
      return [{
        label: "Downforce grows with speed²", value: "2× speed = 4× force",
        how: "Wing downforce is F = ½·ρ·v²·A·C_L (air density, speed, wing area, lift coefficient). At 300 km/h a wing pushes down four times as hard as at 150 km/h.",
      }];
    case "nose": {
      const e = 0.5 * m * kmh(100) ** 2;
      return [{
        label: "Crash energy at 100 km/h", value: `${round(e / 1000)} kJ`,
        how: `½·m·v² = ½ × ${m} kg × (27.8 m/s)². The nose crash structure absorbs it by crushing, so the survival cell around the driver stays intact.`,
      }];
    }
    case "cockpit":
      return [{
        label: "Load on the driver's neck at 5 g", value: "≈ 30 kg",
        how: "Head and helmet weigh about 6–7 kg; at 5 g sideways the neck has to hold about five times that. The halo above the driver weighs about 7 kg.",
      }];
    case "sidepods":
      return [{
        label: "Heat to remove", value: "≈ as much as the power",
        how: "The power unit turns about half of its fuel energy into work; most of the rest leaves as heat through the radiators in the sidepods and the exhaust. Bigger inlets cool better but add drag.",
      }];
    case "floor":
      return [{
        label: "Faster air, lower pressure", value: era === "2022-2025" ? "most of the downforce" : era === "2026-" ? "less than 2022–25" : "part of the downforce",
        how: "Air squeezed through a narrower gap speeds up (A₁v₁ = A₂v₂), and faster air has lower pressure (Bernoulli: p + ½ρv² stays constant). The low pressure under the car pulls it down."
          + (era === "2022-2025" ? " Running too low can stall the flow: the car rises, the downforce comes back and it drops again, which is porpoising." : ""),
      }];
    case "power-unit":
      return [{
        label: "+10% power at top speed", value: "≈ +3% speed",
        how: "At top speed all power goes into drag, and the power needed rises with speed³ (P = ½·ρ·C_d·A·v³). So 10% more power gives only ∛1.1 ≈ 3.2% more top speed.",
      }];
    case "rear-wing":
      return [{
        label: "Drag costs power", value: "P = F·v",
        how: era === "2026-"
          ? "The wing's drag force times the speed is the power it costs. In 2026 the wing flattens on every straight, cutting that cost, and closes again for the corners."
          : "The wing's drag force times the speed is the power it costs. DRS opens a flap on the straights to cut drag when a car is within a second of the car ahead.",
      }];
    case "wheels": {
      const d = TYRE_DIAMETER[era] ?? 0.72, rpm = (kmh(300) / (Math.PI * d)) * 60;
      return [
        {
          label: "Tyre speed at 300 km/h", value: `≈ ${n(round(rpm, 10))} rpm`,
          how: `Wheel speed = v / (π·d) = 83.3 m/s / (π × ${d} m). ${era === "2017-2021" ? "13-inch rims with tall tyres" : "18-inch rims"}.`,
        },
        {
          label: "Grip above 1 g", value: "μ × (weight + downforce)",
          how: "Tyre grip is friction times the force pressing the tyre down. Downforce adds to the weight at speed, which is why the car can corner at several g.",
        },
      ];
    }
  }
}

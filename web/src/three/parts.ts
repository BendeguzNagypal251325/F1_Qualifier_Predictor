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

// What each part does, and the main public regulation points for it per era (FIA technical rules).
// General facts only: the model has no data on any team's own parts.
export const PART_INFO: Record<PartId, { what: string; eras: Record<string, string> }> = {
  "front-wing": {
    what: "The first surface the air meets. It makes front downforce and sends the air around the front tyres and under the car.",
    eras: {
      "2017-2021": "Wide (2.0 m) wing with simplified endplates since 2019, so the air spills less outwards around the tyres.",
      "2022-2025": "Up to four elements blended into the nose; designed to throw less turbulent air at a car behind.",
      "2026-": "About 10 cm narrower, with flaps that move: a high-downforce setting for corners, a low-drag setting on straights.",
    },
  },
  nose: {
    what: "The survival cell around the driver and the nose crash structure. Its shape guides air towards the floor and sidepods.",
    eras: {
      "2017-2021": "High, narrow noses so as much air as possible reaches the floor and bargeboards underneath.",
      "2022-2025": "Lower, wider noses; the front wing attaches straight to the nose.",
      "2026-": "Stronger front and side crash structures on a shorter, narrower car.",
    },
  },
  cockpit: {
    what: "Where the driver sits, protected by the halo. The driver's own skill is measured separately by the driver features.",
    eras: {
      "2017-2021": "Halo mandatory since 2018: a titanium hoop that protects the driver's head.",
      "2022-2025": "Halo carried over; stronger roll-hoop tests from 2023 after a roll-hoop failure in 2022.",
      "2026-": "Halo carried over, with stricter safety tests.",
    },
  },
  sidepods: {
    what: "They hold the radiators. Their inlet size sets how much the car can be cooled, their shape where the air goes next.",
    eras: {
      "2017-2021": "Low sidepods behind large bargeboards that steered the air around them.",
      "2022-2025": "The area teams differed on most: from very slim sidepods to big downwash ramps feeding the rear.",
      "2026-": "Repackaged around the new power unit and its bigger battery.",
    },
  },
  floor: {
    what: "The underside of the car. Air sped up under the floor sucks the car to the ground (downforce).",
    eras: {
      "2017-2021": "Mostly flat floor with a diffuser at the back; most downforce came from the wings and bargeboards.",
      "2022-2025": "Two Venturi tunnels under the car make most of the downforce (ground effect). Running too low causes bouncing (porpoising).",
      "2026-": "Flatter floor with smaller tunnels: less ground effect, so less sensitive to ride height.",
    },
  },
  "power-unit": {
    what: "Engine plus hybrid system, built by the engine supplier. It decides straight-line speed and how much electric boost is available.",
    eras: {
      "2017-2021": "1.6-litre V6 turbo hybrid with two electric motors (MGU-K on the crankshaft, MGU-H on the turbo).",
      "2022-2025": "Same V6 turbo hybrid; E10 fuel from 2022 and an engine development freeze.",
      "2026-": "New units: about half the power is electric (350 kW MGU-K), no MGU-H, and fully sustainable fuel.",
    },
  },
  "rear-wing": {
    what: "Rear downforce, and the drag the car pays for it on the straights.",
    eras: {
      "2017-2021": "Wide, low rear wing with DRS: a flap that opens on the straights within one second of the car ahead.",
      "2022-2025": "Rolled-over wing tips and a beam wing below; DRS kept.",
      "2026-": "No DRS: the wing flattens on the straights for every car (active aero), and an electric boost is used for overtaking instead.",
    },
  },
  wheels: {
    what: "Tyres, rims and suspension: how well the car uses its tyres over one fast lap. Qualifying is usually done on the softest tyre.",
    eras: {
      "2017-2021": "13-inch rims with tall-sidewall tyres; wider tyres from 2017.",
      "2022-2025": "18-inch rims with low-profile tyres and wheel covers.",
      "2026-": "18-inch rims with narrower tyres (front about 25 mm, rear about 30 mm narrower).",
    },
  },
};

// Rule changes in a single season that the era text does not cover.
export const SEASON_NOTES: Record<number, Partial<Record<PartId, string>>> = {
  2021: { floor: "2021: the floor was cut back in a diagonal in front of the rear tyres to reduce downforce (shown on the model)." },
  2023: { floor: "2023: the floor edges were raised by 15 mm to reduce porpoising (too small to see on the model)." },
};

export const partInfo = (part: PartId, era: string, season: number) => ({
  what: PART_INFO[part].what,
  rules: PART_INFO[part].eras[era] ?? "",
  note: SEASON_NOTES[season]?.[part] ?? null,
});

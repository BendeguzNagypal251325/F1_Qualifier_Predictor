"""Car facts per team and season, used by the car schematics in the web app.

Chassis names and livery colours are public facts. The schematics themselves are drawn by the
front end from this table (original SVG drawings, not copies of team or F1 artwork). Engine
suppliers are not repeated here: they come from F1DB (``engine`` column of the entries table).

Livery = (primary, secondary, accent) colours as hex. They are approximations of each car's main
colours, good enough to recognise the car in a schematic.
"""

from __future__ import annotations

# Technical-regulation eras. The schematic changes shape with the era.
ERAS = {
    "2017-2021": {
        "label": "Wide-body, bargeboard era (2017–2021)",
        "summary": "Wide cars with complex bargeboards and front wings that steered air around the "
        "front wheels. Most downforce came from the upper body, so cars lost grip when following.",
    },
    "2022-2025": {
        "label": "Ground-effect era (2022–2025)",
        "summary": "Venturi tunnels under the floor make most of the downforce. Simpler wings, 18-inch "
        "wheels with covers, and no bargeboards. Ride height and porpoising control became key.",
    },
    "2026-": {
        "label": "Active-aero, 50/50 hybrid era (2026–)",
        "summary": "Smaller, lighter cars with movable front and rear wings (low-drag straight-line "
        "mode) and power units with about half their power from the electric motor. No DRS.",
    },
}


def era_for(season: int) -> str:
    if season <= 2021:
        return "2017-2021"
    if season <= 2025:
        return "2022-2025"
    return "2026-"


# (season, constructor_id) -> (chassis, (primary, secondary, accent))
CARS: dict[tuple[int, str], tuple[str, tuple[str, str, str]]] = {
    # 2020
    (2020, "mercedes"): ("W11", ("#16181b", "#00d2be", "#c0c4c8")),
    (2020, "ferrari"): ("SF1000", ("#c00018", "#1a1a1a", "#ffffff")),
    (2020, "red-bull"): ("RB16", ("#1e2a52", "#e10600", "#ffc906")),
    (2020, "mclaren"): ("MCL35", ("#ff8000", "#47c7fc", "#1a1a1a")),
    (2020, "renault"): ("R.S.20", ("#fff200", "#1a1a1a", "#ffffff")),
    (2020, "alphatauri"): ("AT01", ("#f2f2f2", "#1f3554", "#c8102e")),
    (2020, "racing-point"): ("RP20", ("#f596c8", "#1b3d8f", "#ffffff")),
    (2020, "alfa-romeo"): ("C39", ("#9b0000", "#ffffff", "#1a1a1a")),
    (2020, "haas"): ("VF-20", ("#2a2a2a", "#b8babd", "#c8102e")),
    (2020, "williams"): ("FW43", ("#0b1f4a", "#ffffff", "#00a3e0")),
    # 2021
    (2021, "mercedes"): ("W12", ("#16181b", "#00d2be", "#c0c4c8")),
    (2021, "ferrari"): ("SF21", ("#c00018", "#6b0a1a", "#ffffff")),
    (2021, "red-bull"): ("RB16B", ("#1e2a52", "#e10600", "#ffc906")),
    (2021, "mclaren"): ("MCL35M", ("#ff8000", "#47c7fc", "#1a1a1a")),
    (2021, "alpine"): ("A521", ("#0a5ad6", "#ffffff", "#e4002b")),
    (2021, "alphatauri"): ("AT02", ("#1f3554", "#f2f2f2", "#c8102e")),
    (2021, "aston-martin"): ("AMR21", ("#00594f", "#cedc00", "#f596c8")),
    (2021, "alfa-romeo"): ("C41", ("#9b0000", "#ffffff", "#1a1a1a")),
    (2021, "haas"): ("VF-21", ("#ffffff", "#0039a6", "#d52b1e")),
    (2021, "williams"): ("FW43B", ("#0b1f4a", "#ffffff", "#00a3e0")),
    # 2022
    (2022, "mercedes"): ("W13", ("#b9bcc0", "#16181b", "#00d2be")),
    (2022, "ferrari"): ("F1-75", ("#d40018", "#1a1a1a", "#ffffff")),
    (2022, "red-bull"): ("RB18", ("#1e2a52", "#e10600", "#ffc906")),
    (2022, "mclaren"): ("MCL36", ("#ff8000", "#47c7fc", "#1a1a1a")),
    (2022, "alpine"): ("A522", ("#0a5ad6", "#f596c8", "#ffffff")),
    (2022, "alphatauri"): ("AT03", ("#1f3554", "#f2f2f2", "#c8102e")),
    (2022, "aston-martin"): ("AMR22", ("#00594f", "#cedc00", "#1a1a1a")),
    (2022, "alfa-romeo"): ("C42", ("#9b0000", "#ffffff", "#1a1a1a")),
    (2022, "haas"): ("VF-22", ("#ffffff", "#1a1a1a", "#c8102e")),
    (2022, "williams"): ("FW44", ("#0b1f4a", "#00a3e0", "#ffffff")),
    # 2023
    (2023, "mercedes"): ("W14", ("#16181b", "#00d2be", "#c0c4c8")),
    (2023, "ferrari"): ("SF-23", ("#d40018", "#1a1a1a", "#ffffff")),
    (2023, "red-bull"): ("RB19", ("#1e2a52", "#e10600", "#ffc906")),
    (2023, "mclaren"): ("MCL60", ("#ff8000", "#1a1a1a", "#47c7fc")),
    (2023, "alpine"): ("A523", ("#0a5ad6", "#f596c8", "#1a1a1a")),
    (2023, "alphatauri"): ("AT04", ("#1f3554", "#f2f2f2", "#c8102e")),
    (2023, "aston-martin"): ("AMR23", ("#00594f", "#cedc00", "#1a1a1a")),
    (2023, "alfa-romeo"): ("C43", ("#9b0000", "#1a1a1a", "#ffffff")),
    (2023, "haas"): ("VF-23", ("#1a1a1a", "#ffffff", "#c8102e")),
    (2023, "williams"): ("FW45", ("#0b1f4a", "#00a3e0", "#ffffff")),
    # 2024
    (2024, "mercedes"): ("W15", ("#16181b", "#b9bcc0", "#00d2be")),
    (2024, "ferrari"): ("SF-24", ("#d40018", "#ffffff", "#ffd800")),
    (2024, "red-bull"): ("RB20", ("#1e2a52", "#e10600", "#ffc906")),
    (2024, "mclaren"): ("MCL38", ("#ff8000", "#1a1a1a", "#47c7fc")),
    (2024, "alpine"): ("A524", ("#0a5ad6", "#f596c8", "#1a1a1a")),
    (2024, "rb"): ("VCARB 01", ("#f2f2f2", "#1634cc", "#e10600")),
    (2024, "aston-martin"): ("AMR24", ("#00594f", "#cedc00", "#1a1a1a")),
    (2024, "kick-sauber"): ("C44", ("#1a1a1a", "#52e252", "#ffffff")),
    (2024, "haas"): ("VF-24", ("#ffffff", "#1a1a1a", "#c8102e")),
    (2024, "williams"): ("FW46", ("#0b1f4a", "#00a3e0", "#ffffff")),
    # 2025
    (2025, "mercedes"): ("W16", ("#16181b", "#b9bcc0", "#00d2be")),
    (2025, "ferrari"): ("SF-25", ("#d40018", "#ffffff", "#1a1a1a")),
    (2025, "red-bull"): ("RB21", ("#1e2a52", "#e10600", "#ffc906")),
    (2025, "mclaren"): ("MCL39", ("#ff8000", "#1a1a1a", "#47c7fc")),
    (2025, "alpine"): ("A525", ("#f596c8", "#0a5ad6", "#1a1a1a")),
    (2025, "racing-bulls"): ("VCARB 02", ("#f2f2f2", "#1634cc", "#e10600")),
    (2025, "aston-martin"): ("AMR25", ("#00594f", "#cedc00", "#1a1a1a")),
    (2025, "kick-sauber"): ("C45", ("#1a1a1a", "#52e252", "#ffffff")),
    (2025, "haas"): ("VF-25", ("#ffffff", "#1a1a1a", "#c8102e")),
    (2025, "williams"): ("FW47", ("#0b1f4a", "#00a3e0", "#ffffff")),
    # 2026
    (2026, "mercedes"): ("W17", ("#b9bcc0", "#16181b", "#00d2be")),
    (2026, "ferrari"): ("SF-26", ("#d40018", "#ffffff", "#1a1a1a")),
    (2026, "red-bull"): ("RB22", ("#1e2a52", "#e10600", "#ffc906")),
    (2026, "mclaren"): ("MCL40", ("#ff8000", "#1a1a1a", "#47c7fc")),
    (2026, "alpine"): ("A526", ("#f596c8", "#0a5ad6", "#1a1a1a")),
    (2026, "racing-bulls"): ("VCARB 03", ("#f2f2f2", "#1634cc", "#e10600")),
    (2026, "aston-martin"): ("AMR26", ("#00594f", "#cedc00", "#1a1a1a")),
    (2026, "audi"): ("R26", ("#b5b8bc", "#1a1a1a", "#ff4f1f")),
    (2026, "cadillac"): ("MAC-26", ("#1a1a1a", "#ffffff", "#c8a45a")),
    (2026, "haas"): ("VF-26", ("#ffffff", "#1a1a1a", "#c8102e")),
    (2026, "williams"): ("FW48", ("#0b1f4a", "#00a3e0", "#ffffff")),
}

# Schematic parts (hotspots). Each part says which model feature group it relates to, so the app
# can show the car-level numbers next to it. The model has no component-level data: the numbers are
# team-level measures, and the parts explain what each area of the car does.
PARTS = {
    "front-wing": "Front wing: first surface the air meets; sets front grip and conditions the airflow for the rest of the car.",
    "nose": "Nose and chassis: the survival cell; its shape guides air to the floor and sidepods.",
    "cockpit": "Cockpit and halo: where the driver sits. The driver's own skill is measured by the driver features.",
    "sidepods": "Sidepods: radiators and cooling inlets; their shape sends air to the rear of the car.",
    "floor": "Floor: the biggest source of downforce since 2022 (Venturi tunnels under the car).",
    "power-unit": "Power unit: engine and hybrid system, built by the engine supplier.",
    "rear-wing": "Rear wing and beam wing: rear downforce, and the drag the car pays for it on the straights.",
    "wheels": "Tyres and suspension: how well the car uses the tyres over one fast lap.",
}


def car_info(season: int, constructor_id: str) -> dict:
    chassis, livery = CARS.get((season, constructor_id), (None, ("#888888", "#444444", "#cccccc")))
    era = era_for(season)
    return {"chassis": chassis, "livery": list(livery), "era": era, **{f"era_{k}": v for k, v in ERAS[era].items()}}

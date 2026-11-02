"""Build the interactive results dashboard (one self-contained HTML file).

Every prediction in the dashboard is out-of-sample: it comes from the walk-forward run,
where the model is retrained before each session on earlier sessions only.

    uv run f1qp-dashboard                 # -> reports/dashboard.html
    uv run f1qp-dashboard --fragment out.html   # body-only version for embedding/hosting
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from . import model as M
from .data import ROOT, load_entries
from .features import build_features
from .train import walk_forward

TEMPLATE = Path(__file__).with_name("dashboard_template.html")
OUT = ROOT / "reports" / "dashboard.html"

CIRCUIT_NAMES = {
    "austin": "Circuit of the Americas",
    "bahrain": "Bahrain",
    "baku": "Baku",
    "catalunya": "Barcelona-Catalunya",
    "hungaroring": "Hungaroring",
    "imola": "Imola",
    "interlagos": "Interlagos",
    "istanbul": "Istanbul Park",
    "jeddah": "Jeddah",
    "las-vegas": "Las Vegas",
    "lusail": "Lusail",
    "madring": "Madring (Madrid)",
    "marina-bay": "Marina Bay",
    "melbourne": "Albert Park",
    "mexico-city": "Mexico City",
    "miami": "Miami",
    "monaco": "Monaco",
    "montreal": "Montréal",
    "monza": "Monza",
    "mugello": "Mugello",
    "nurburgring": "Nürburgring",
    "paul-ricard": "Paul Ricard",
    "portimao": "Portimão",
    "sepang": "Sepang",
    "shanghai": "Shanghai",
    "silverstone": "Silverstone",
    "sirius": "Sochi",
    "spa-francorchamps": "Spa-Francorchamps",
    "spielberg": "Red Bull Ring",
    "suzuka": "Suzuka",
    "yas-marina": "Yas Marina",
    "zandvoort": "Zandvoort",
}

TEAM_NAMES = {
    "alfa-romeo": "Alfa Romeo",
    "alphatauri": "AlphaTauri",
    "alpine": "Alpine",
    "audi": "Audi",
    "aston-martin": "Aston Martin",
    "cadillac": "Cadillac",
    "ferrari": "Ferrari",
    "haas": "Haas",
    "kick-sauber": "Kick Sauber",
    "mclaren": "McLaren",
    "mercedes": "Mercedes",
    "racing-bulls": "Racing Bulls",
    "racing-point": "Racing Point",
    "rb": "RB",
    "red-bull": "Red Bull",
    "renault": "Renault",
    "williams": "Williams",
}

# Team swatches (used only as small colour markers next to names).
TEAM_COLORS = {
    "alfa-romeo": "#9b0000",
    "alphatauri": "#2b4562",
    "alpine": "#2293d1",
    "audi": "#bb0a30",
    "aston-martin": "#229971",
    "cadillac": "#c8a45a",
    "ferrari": "#e8002d",
    "haas": "#9c9fa2",
    "kick-sauber": "#52e252",
    "mclaren": "#ff8000",
    "mercedes": "#27f4d2",
    "racing-bulls": "#6692ff",
    "racing-point": "#f596c8",
    "rb": "#6692ff",
    "red-bull": "#3671c6",
    "renault": "#fff500",
    "williams": "#64c4ff",
}

DRIVER_NAME_FIXES = {"carlos-sainz-jr": "Carlos Sainz", "nyck-de-vries": "Nyck de Vries", "guanyu-zhou": "Zhou Guanyu"}

GP_NAME_FIXES = {
    "united-states": "United States",
    "70th-anniversary": "70th Anniversary",
    "sao-paulo": "São Paulo",
    "emilia-romagna": "Emilia-Romagna",
}


def _title(slug: str) -> str:
    return " ".join(w.capitalize() for w in slug.split("-"))


def _metrics(r: dict) -> dict:
    return {k: (round(v, 3) if isinstance(v, float) else v) for k, v in r.items()}


def build_payload() -> dict:
    feat = build_features(load_entries())
    pred = walk_forward(feat)
    data = feat.loc[pred.index]
    seasons_list = sorted(int(s) for s in data["season"].unique())
    latest = seasons_list[-1]
    wf = data.loc[pred.index].copy()
    wf["p"] = pred.loc[wf.index]  # predicted qualifying position (lower = better)
    wf["picked"] = M.pick_top10(wf, wf["p"])
    wf["pred_rank"] = M.predicted_grid(wf, wf["p"])

    seasons = {str(s): _metrics(M.evaluate(wf[wf["season"] == s], wf.loc[wf["season"] == s, "p"])) for s in seasons_list}
    baselines_by_season = {
        str(s): {k: round(v["correct_per_10"], 3) for k, v in M.evaluate_baselines(wf[wf["season"] == s]).items()}
        for s in seasons_list
    }
    overall = _metrics(M.evaluate(wf, wf["p"]))
    baselines = {k: _metrics(v) for k, v in M.evaluate_baselines(wf).items()}
    per_session = M.session_scores(wf, wf["picked"])

    # Feature importance: model trained on everything before the test season, scored on it.
    imp = M.feature_importance(M.fit(feat[feat["season"] < latest]), data[data["season"] == latest])

    drivers = sorted(wf["driver_id"].unique())
    circuits = sorted(wf["circuit"].unique())
    teams = sorted(wf["constructor_id"].unique())
    d_idx = {d: i for i, d in enumerate(drivers)}
    c_idx = {c: i for i, c in enumerate(circuits)}
    t_idx = {t: i for i, t in enumerate(teams)}

    sessions = (
        wf.drop_duplicates("race_key")[["race_key", "season", "round", "grand_prix", "circuit", "date", "sprint_weekend"]]
        .sort_values(["season", "round"])
        .reset_index(drop=True)
    )
    s_idx = {k: i for i, k in enumerate(sessions["race_key"])}

    # Compact rows: [session, driver, team, quali_pos, top10, predicted position(x1000), picked, pred_rank, status]
    rows = [
        [
            s_idx[r.race_key],
            d_idx[r.driver_id],
            t_idx[r.constructor_id],
            int(r.quali_pos),
            int(r.top10),
            int(round(r.p * 1000)),
            int(bool(r.picked)),
            int(r.pred_rank),
            r.quali_status if not str(r.quali_status).isdigit() else "",
        ]
        for r in wf.itertuples()
    ]

    return {
        "range": f"{seasons_list[0]}–{str(latest)[2:]}",
        "latest": latest,
        "overall": overall,
        "baselines": baselines,
        "seasons": seasons,
        "baselinesBySeason": baselines_by_season,
        "sessionHistogram": {int(k): int(v) for k, v in per_session.value_counts().sort_index().items()},
        "importance": [[k, round(float(v), 3)] for k, v in imp.head(10).items()],
        "drivers": [DRIVER_NAME_FIXES.get(d, _title(d)) for d in drivers],
        "circuits": [CIRCUIT_NAMES.get(c, _title(c)) for c in circuits],
        "teams": [TEAM_NAMES.get(t, _title(t)) for t in teams],
        "teamColors": [TEAM_COLORS.get(t, "#888888") for t in teams],
        "sessions": [
            {
                "season": int(s.season),
                "round": int(s.round),
                "gp": GP_NAME_FIXES.get(s.grand_prix, _title(s.grand_prix)),
                "circuit": c_idx[s.circuit],
                "date": str(s.date)[:10],
                "sprint": bool(s.sprint_weekend),
                "correct": int(per_session[s.race_key]),
            }
            for s in sessions.itertuples()
        ],
        "rows": rows,
    }


def render(payload: dict, standalone: bool = True) -> str:
    body = TEMPLATE.read_text().replace("/*__DATA__*/null", json.dumps(payload, separators=(",", ":")))
    if not standalone:
        return body
    return (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        "<style>*,*::before,*::after{box-sizing:border-box}body{margin:0;font-size:14px}[hidden]{display:none!important}</style>\n"
        f"</head>\n<body>\n{body}\n</body>\n</html>\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=OUT)
    parser.add_argument("--fragment", type=Path, help="Also write a body-only version (no <html>/<head>) here")
    args = parser.parse_args()
    np.seterr(all="ignore")
    payload = build_payload()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(render(payload))
    print(f"Dashboard written to {args.out}")
    if args.fragment:
        args.fragment.parent.mkdir(parents=True, exist_ok=True)
        args.fragment.write_text(render(payload, standalone=False))
        print(f"Fragment written to {args.fragment}")


if __name__ == "__main__":
    main()

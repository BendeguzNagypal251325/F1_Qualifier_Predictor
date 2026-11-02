"""Predict the qualifying top 10 for one 2020-2025 Grand Prix and compare with what happened.

The model is retrained on every session *before* the chosen one, so the prediction only
uses information that was available on that weekend before qualifying.

    python -m f1qp.predict 2024 monaco
    python -m f1qp.predict 2025 7
"""

from __future__ import annotations

import argparse

import pandas as pd

from . import SEASONS
from . import model as M
from .data import load_entries
from .features import build_features


def find_session(feat: pd.DataFrame, season: int, race: str) -> str:
    rows = feat[feat["season"] == season]
    if rows.empty:
        raise SystemExit(f"No data for {season}; choose one of {SEASONS}")
    if race.isdigit():
        match = rows[rows["round"] == int(race)]
    else:
        key = race.lower().replace(" ", "-")
        match = rows[rows["grand_prix"].str.contains(key) | rows["circuit"].str.contains(key)]
    keys = match["race_key"].unique()
    if len(keys) != 1:
        options = ", ".join(rows.drop_duplicates("race_key").apply(lambda r: f"{r['round']}={r['grand_prix']}", axis=1))
        raise SystemExit(f"Could not identify '{race}' in {season} ({len(keys)} matches). Options: {options}")
    return keys[0]


def predict_session(feat: pd.DataFrame, race_key: str, kind: str = "logreg") -> pd.DataFrame:
    session = feat[feat["race_key"] == race_key]
    train = feat[feat["date"] < session["date"].iloc[0]]
    model = M.fit(train, kind)
    out = session[["driver_id", "constructor_id", "quali_pos", "top10"]].copy()
    out["p_top10"] = M.predict_proba(model, session)
    out = out.sort_values("p_top10", ascending=False).reset_index(drop=True)
    out.index += 1
    out["predicted_top10"] = out.index <= 10
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("season", type=int)
    parser.add_argument("race", help="Round number or Grand Prix/circuit name, e.g. 'monaco'")
    parser.add_argument("--model", choices=M.MODEL_KINDS, default="logreg")
    args = parser.parse_args()

    feat = build_features(load_entries())
    race_key = find_session(feat, args.season, args.race)
    out = predict_session(feat, race_key, args.model)

    correct = int((out["predicted_top10"] & (out["top10"] == 1)).sum())
    print(f"\n{race_key}  —  predicted grid order by P(top 10)\n")
    for rank, r in out.iterrows():
        mark = "✓" if r["predicted_top10"] == bool(r["top10"]) else "✗"
        line = f"{rank:>2}. {r['driver_id']:<22} {r['constructor_id']:<14} P(top10)={r['p_top10']:.2f}   actual P{r['quali_pos']:<2} {mark}"
        print(line)
        if rank == 10:
            print("    " + "-" * 70)
    print(f"\nCorrect top-10 picks: {correct}/10")


if __name__ == "__main__":
    main()

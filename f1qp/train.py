"""Train, evaluate and save the top-10 qualifying model.

Evaluation protocols
  1. Hold-out: train on 2020-2023, validate on 2024, test on 2025 (model choice uses 2024 only).
  2. Walk-forward: before every 2020-2025 session, retrain on all earlier sessions
     (2019 included as extra history) and predict that session, i.e. a simulated "live" season.
Writes ``reports/evaluation.md`` and saves the final model (trained on 2020-2025) to ``models/``.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from . import SEASONS
from . import model as M
from .data import ROOT, load_entries
from .features import FEATURES, build_features

REPORT = ROOT / "reports" / "evaluation.md"
MODEL_PATH = ROOT / "models" / "top10_model.joblib"


def walk_forward(feat: pd.DataFrame, kind: str = "logreg", seasons=SEASONS) -> pd.DataFrame:
    """Probability for each row of ``seasons``, using a model trained only on earlier sessions."""
    sessions = feat.loc[feat["season"].isin(seasons)].drop_duplicates("race_key")[["race_key", "date"]]
    parts = []
    for race_key, date in sessions.itertuples(index=False):
        train = feat[feat["date"] < date]
        test = feat[feat["race_key"] == race_key]
        model = M.fit(train, kind)
        parts.append(pd.Series(M.predict_proba(model, test), index=test.index))
    return pd.concat(parts)


def _fmt(results: dict[str, dict]) -> str:
    rows = ["| Method | Correct / 10 | Perfect sessions | Worst session | ROC AUC | Log loss |", "|---|---|---|---|---|---|"]
    for name, r in results.items():
        auc = f"{r['roc_auc']:.3f}" if "roc_auc" in r else "-"
        ll = f"{r['log_loss']:.3f}" if "log_loss" in r else "-"
        rows.append(
            f"| {name} | {r['correct_per_10']:.2f} | {r['perfect_sessions']}/{r['sessions']} | {r['worst_session']} | {auc} | {ll} |"
        )
    return "\n".join(rows)


def run(kind: str | None = None, skip_walk_forward: bool = False) -> str:
    feat = build_features(load_entries())
    data = feat[feat["season"].isin(SEASONS)]
    train, val, test = data[data["season"] <= 2023], data[data["season"] == 2024], data[data["season"] == 2025]

    lines = ["# Evaluation: F1 top-10 qualifying predictor (2020-2025)", ""]
    lines += [
        "Each session the model picks the 10 drivers with the highest probability of reaching Q3. ",
        "**Correct / 10** is the average number of those picks that actually qualified top 10.",
        "",
        f"Data: {data['race_key'].nunique()} qualifying sessions, {len(data)} driver entries.",
        "",
    ]

    # 1. Model selection on 2024.
    val_results = {}
    for k in M.MODEL_KINDS:
        val_results[k] = M.evaluate(val, M.predict_proba(M.fit(train, k), val))
    chosen = kind or max(val_results, key=lambda k: (val_results[k]["correct_per_10"], val_results[k]["roc_auc"]))
    lines += ["## 1. Hold-out (train 2020-2023)", "", "### Validation: 2024", ""]
    lines += [_fmt({**val_results, **M.evaluate_baselines(val)}), "", f"Selected model: **{chosen}**", ""]

    model = M.fit(train, chosen)
    lines += ["### Test: 2025 (untouched until now)", ""]
    lines += [_fmt({chosen: M.evaluate(test, M.predict_proba(model, test)), **M.evaluate_baselines(test)}), ""]

    # 2. Walk-forward.
    if not skip_walk_forward:
        proba = walk_forward(feat, chosen)
        wf = data.loc[proba.index]
        lines += ["## 2. Walk-forward (retrained before every session)", ""]
        per_season = {}
        for season in SEASONS:
            idx = wf.index[wf["season"] == season]
            per_season[str(season)] = M.evaluate(wf.loc[idx], proba.loc[idx].to_numpy())
        per_season["**2020-2025**"] = M.evaluate(wf, proba.loc[wf.index].to_numpy())
        lines += [_fmt(per_season), "", "Baselines over the same 2020-2025 sessions:", ""]
        lines += [_fmt(M.evaluate_baselines(wf)), ""]

    # Feature importance on the 2025 test set.
    imp = M.feature_importance(model, test)
    lines += [
        "## Feature importance (permutation, 2025 test set)",
        "",
        "Drop in correct picks per 10 when the feature is shuffled.",
        "",
        "| Feature | Drop |",
        "|---|---|",
    ]
    lines += [f"| {f} | {v:+.3f} |" for f, v in imp.head(12).items()]
    lines.append("")

    # Final model on all of 2020-2025 for future use.
    final = M.fit(data, chosen)
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": final, "kind": chosen, "features": FEATURES}, MODEL_PATH)

    report = "\n".join(lines)
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(report)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", choices=M.MODEL_KINDS, help="Force a model instead of selecting on 2024")
    parser.add_argument("--skip-walk-forward", action="store_true")
    args = parser.parse_args()
    np.set_printoptions(precision=3)
    print(run(args.model, args.skip_walk_forward))
    print(f"\nReport written to {REPORT}\nModel saved to {MODEL_PATH}")


if __name__ == "__main__":
    main()

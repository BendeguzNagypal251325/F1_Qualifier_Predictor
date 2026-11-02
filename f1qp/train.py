"""Walk-forward evaluation of the Ridge top-10 model, and the final saved model.

Before every qualifying session the model is retrained on all earlier sessions (training rows
from 2019 on), then predicts that session. So within a season, each race's real result is added
to the training data before the next race is predicted.

Writes ``reports/evaluation.md`` and saves the final model (trained on all data from 2019) to ``models/``.
"""

from __future__ import annotations

import argparse

import joblib
import pandas as pd

from . import SEASONS, TRAIN_FROM
from . import model as M
from .data import ROOT, load_entries
from .features import FEATURES, build_features

REPORT = ROOT / "reports" / "evaluation.md"
MODEL_PATH = ROOT / "models" / "top10_model.joblib"


def walk_forward(feat: pd.DataFrame, seasons=SEASONS) -> pd.Series:
    """Predicted position for each row of ``seasons``, from a model trained only on earlier sessions."""
    sessions = feat.loc[feat["season"].isin(seasons) & feat["quali_pos"].notna()].drop_duplicates("race_key").sort_values("date")
    parts = []
    for race_key, date in sessions[["race_key", "date"]].itertuples(index=False):
        train = feat[feat["date"] < date]
        test = feat[feat["race_key"] == race_key]
        parts.append(pd.Series(M.predict_position(M.fit(train), test), index=test.index))
    return pd.concat(parts)


NAMES = {
    "previous_quali": "Previous quali order",
    "rolling_form_3": "Rolling form (last 3 qualis)",
    "championship": "Championship order",
    "last_practice": "Last practice order",
}


def _fmt(results: dict[str, dict]) -> str:
    rows = [
        "| Method | Correct / 10 | Perfect sessions | Worst session | MAE (all) | MAE (top 10) |",
        "|---|---|---|---|---|---|",
    ]
    for name, r in results.items():
        rows.append(
            f"| {name} | {r['correct_per_10']:.2f} | {r['perfect_sessions']}/{r['sessions']} | "
            f"{r['worst_session']} | {r['mae_all']:.2f} | {r['mae_top10']:.2f} |"
        )
    return "\n".join(rows)


def run() -> str:
    feat = build_features(load_entries())
    pred = walk_forward(feat)
    wf = feat.loc[pred.index]
    seasons = sorted(int(s) for s in wf["season"].unique())
    latest = seasons[-1]
    test = wf[wf["season"] == latest]

    lines = [
        "# Evaluation: F1 top-10 qualifying predictor (Ridge regression)",
        "",
        "Ridge regression predicts each driver's qualifying position; the 10 best predicted drivers are the",
        "predicted Q3. Walk-forward: before every session the model is retrained on all earlier sessions",
        f"(training rows from {TRAIN_FROM} on), so each real result is added before the next race is predicted.",
        "",
        "**Correct / 10** = how many of the 10 picks really reached Q3.",
        "**MAE** = average number of places the predicted position is off.",
        "",
        f"## {latest} season ({test['race_key'].nunique()} races so far)",
        "",
        _fmt({"**Ridge regression**": M.evaluate(test, pred.loc[test.index]),
              **{NAMES[k]: v for k, v in M.evaluate_baselines(test).items()}}),
        "",
        "## All seasons (same walk-forward)",
        "",
    ]
    per_season = {str(s): M.evaluate(wf[wf["season"] == s], pred.loc[wf.index[wf["season"] == s]]) for s in seasons}
    per_season[f"**{seasons[0]}-{seasons[-1]}**"] = M.evaluate(wf, pred.loc[wf.index])
    lines += [_fmt(per_season), ""]

    # Feature importance: model trained on everything before the latest season, scored on it.
    imp = M.feature_importance(M.fit(feat[feat["season"] < latest]), test)
    lines += [
        f"## Feature importance (permutation, {latest})",
        "",
        "Drop in correct picks per 10 when the feature is shuffled.",
        "",
        "| Feature | Drop |",
        "|---|---|",
    ]
    lines += [f"| {f} | {v:+.3f} |" for f, v in imp.head(12).items()]
    lines.append("")

    final = M.fit(feat[feat["quali_pos"].notna()])
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": final, "kind": "ridge", "features": FEATURES}, MODEL_PATH)

    report = "\n".join(lines)
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(report)
    return report


def main() -> None:
    argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter).parse_args()
    print(run())
    print(f"\nReport written to {REPORT}\nModel saved to {MODEL_PATH}")


if __name__ == "__main__":
    main()

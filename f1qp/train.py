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

    lines += _calibration(wf.assign(pred=pred.loc[wf.index]), seasons)

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


def _calibration(wf: pd.DataFrame, seasons: list[int]) -> list[str]:
    """Reliability table and Brier scores for the Q3 probability (walk-forward, earlier races only)."""
    wf = wf.copy()
    wf["pred_rank"] = M.predicted_grid(wf, wf["pred"])
    wf["q3_prob"] = M.walk_forward_q3(wf)
    d = wf.dropna(subset=["q3_prob", "quali_pos"])
    y = (d["quali_pos"] <= 10).astype(float)
    field = d.groupby("race_key")["race_key"].transform("size")
    champ = M.pick_top10(d, d["driver_champ_pos_before"]).astype(float)
    bucket = pd.cut(d["q3_prob"], [i / 10 for i in range(11)], include_lowest=True)
    lines = [
        f"## Q3 probability: calibration ({seasons[0]}-{seasons[-1]})",
        "",
        "Each driver's chance of reaching Q3: the share of earlier races' residuals (real position minus",
        "predicted grid position, grouped by predicted position P1-3, 4-6, 7-9, 10-12, 13-15, 16+) that",
        "would still put the driver in the top 10. Only races before the predicted one are used, starting",
        f"once {M.MIN_PRIOR_RACES} earlier races exist ({d['race_key'].nunique()} races, {len(d)} driver entries).",
        "",
        "| Predicted probability | Entries | Mean predicted | Observed Q3 rate |",
        "|---|---|---|---|",
    ]
    for b, g in d.groupby(bucket, observed=True):
        lines.append(f"| {max(b.left, 0):.0%}-{b.right:.0%} | {len(g)} | {g['q3_prob'].mean():.2f} | {y.loc[g.index].mean():.2f} |")
    lines += [
        "",
        "Brier score (mean squared error of the probability against reaching Q3 or not; lower is better):",
        "",
        "| Forecast | Brier |",
        "|---|---|",
        f"| **Q3 probability (this model)** | **{M.brier(d['q3_prob'], y):.3f}** |",
        f"| Model's yes/no picks (top 10 predicted = 1) | {M.brier((d['pred_rank'] <= 10).astype(float), y):.3f} |",
        f"| Championship order picks (top 10 = 1) | {M.brier(champ, y):.3f} |",
        f"| Base rate (10 / field size for everyone) | {M.brier(10 / field, y):.3f} |",
        "",
    ]
    return lines


def main() -> None:
    argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter).parse_args()
    print(run())
    print(f"\nReport written to {REPORT}\nModel saved to {MODEL_PATH}")


if __name__ == "__main__":
    main()

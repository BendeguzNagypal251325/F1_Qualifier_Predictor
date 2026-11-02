"""Models, baselines and per-session evaluation for top-10 qualifying prediction.

A session prediction always picks exactly 10 drivers: the 10 with the highest predicted
probability of reaching Q3. The headline metric is therefore "correct picks out of 10"
(precision@10, which equals recall@10 because every session has exactly 10 Q3 drivers).
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from .features import FEATURES, TARGET


def make_model(kind: str = "logreg"):
    if kind == "logreg":
        return make_pipeline(
            SimpleImputer(strategy="median", add_indicator=True, keep_empty_features=True),
            StandardScaler(),
            LogisticRegression(C=0.3, max_iter=2000),
        )
    if kind == "gbm":
        return HistGradientBoostingClassifier(
            learning_rate=0.05,
            max_iter=300,
            max_leaf_nodes=15,
            min_samples_leaf=30,
            l2_regularization=1.0,
            early_stopping=False,
            random_state=0,
        )
    raise ValueError(f"unknown model kind: {kind}")


MODEL_KINDS = ("logreg", "gbm")


def fit(train: pd.DataFrame, kind: str = "logreg"):
    model = make_model(kind)
    model.fit(train[FEATURES], train[TARGET])
    return model


def predict_proba(model, df: pd.DataFrame) -> np.ndarray:
    return model.predict_proba(df[FEATURES])[:, 1]


def pick_top10(df: pd.DataFrame, score: pd.Series | np.ndarray, higher_is_better: bool = True) -> pd.Series:
    """Boolean Series: the 10 best-scored drivers in each session (NaN scores rank last)."""
    s = pd.Series(np.asarray(score, dtype=float), index=df.index)
    if not higher_is_better:
        s = -s
    s = s.fillna(-np.inf)
    rank = s.groupby(df["race_key"]).rank(method="first", ascending=False)
    return rank <= 10


# Baselines: simple heuristics a fan might use. Lower value = better for all of them.
BASELINES = {
    "previous_quali": "drv_pos_last",
    "rolling_form_3": "drv_pos_mean3",
    "championship": "driver_champ_pos_before",
    "last_practice": "fp_last_pos",
}


def session_scores(df: pd.DataFrame, picked: pd.Series) -> pd.Series:
    """Correct picks (out of 10) per session."""
    return (picked & (df[TARGET] == 1)).groupby(df["race_key"]).sum()


def evaluate(df: pd.DataFrame, proba: np.ndarray | None = None, picked: pd.Series | None = None) -> dict:
    if picked is None:
        picked = pick_top10(df, proba)
    per_session = session_scores(df, picked)
    out = {
        "sessions": int(per_session.size),
        "correct_per_10": float(per_session.mean()),
        "perfect_sessions": int((per_session == 10).sum()),
        "worst_session": int(per_session.min()),
    }
    if proba is not None:
        out["roc_auc"] = float(roc_auc_score(df[TARGET], proba))
        out["log_loss"] = float(log_loss(df[TARGET], np.clip(proba, 1e-6, 1 - 1e-6)))
    return out


def evaluate_baselines(df: pd.DataFrame) -> dict[str, dict]:
    return {
        name: evaluate(df, picked=pick_top10(df, df[col], higher_is_better=False))
        for name, col in BASELINES.items()
    }


def feature_importance(model, df: pd.DataFrame, n_repeats: int = 5, seed: int = 0) -> pd.Series:
    """Permutation importance measured as drop in correct picks per 10."""
    rng = np.random.default_rng(seed)
    base = evaluate(df, predict_proba(model, df))["correct_per_10"]
    drops = {}
    for feat in FEATURES:
        scores = []
        for _ in range(n_repeats):
            shuffled = df.copy()
            shuffled[feat] = rng.permutation(shuffled[feat].to_numpy())
            scores.append(evaluate(shuffled, predict_proba(model, shuffled))["correct_per_10"])
        drops[feat] = base - float(np.mean(scores))
    return pd.Series(drops).sort_values(ascending=False)

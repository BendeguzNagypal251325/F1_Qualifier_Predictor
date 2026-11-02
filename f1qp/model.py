"""Ridge regression model, baselines and per-session evaluation.

The model predicts each driver's qualifying position. Sorting the predictions per session
gives the predicted grid; the 10 best-placed drivers are the predicted Q3 (top 10).

Metrics per session:
  * correct picks out of 10 (how many predicted top-10 drivers really reached Q3)
  * MAE: average number of places the predicted grid position is off (all drivers, and
    only the drivers who really qualified top 10)
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from . import TRAIN_FROM
from .features import FEATURES, TARGET


def make_model():
    return make_pipeline(
        SimpleImputer(strategy="median", add_indicator=True, keep_empty_features=True),
        StandardScaler(),
        Ridge(alpha=10.0),
    )


# Used before a weekend's first practice session, when there are no practice results yet.
PRACTICE_FEATURES = ["fp_last_pos", "fp_last_gap_pct", "fp_best_pos", "fp_mean_gap_pct", "fp_sessions"]
PRE_WEEKEND_FEATURES = [f for f in FEATURES if f not in PRACTICE_FEATURES]


def fit(train: pd.DataFrame, features: list[str] = FEATURES):
    """Fit on training rows from TRAIN_FROM onwards (earlier rows only serve as feature history)."""
    train = train[(train["season"] >= TRAIN_FROM) & train[TARGET].notna()]
    model = make_model()
    model.fit(train[features], train[TARGET])
    return model


def predict_position(model, df: pd.DataFrame) -> np.ndarray:
    """Raw predicted qualifying position (lower = better). Uses the features the model was fitted on."""
    return model.predict(df[list(model.feature_names_in_)])


def predicted_grid(df: pd.DataFrame, score) -> pd.Series:
    """Positions 1..N per session from scores (lower = better). Missing scores go last."""
    s = pd.Series(np.asarray(score, dtype=float), index=df.index).fillna(np.inf)
    return s.groupby(df["race_key"]).rank(method="first").astype(int)


def pick_top10(df: pd.DataFrame, score) -> pd.Series:
    """Boolean Series: the 10 best-scored drivers in each session (lower score = better)."""
    return predicted_grid(df, score) <= 10


# Baselines: simple rules a fan might use. Lower value = better for all of them.
BASELINES = {
    "previous_quali": "drv_pos_last",
    "rolling_form_3": "drv_pos_mean3",
    "championship": "driver_champ_pos_before",
    "last_practice": "fp_last_pos",
}


def session_scores(df: pd.DataFrame, picked: pd.Series) -> pd.Series:
    """Correct picks (out of 10) per session."""
    return (picked & (df["top10"] == 1)).groupby(df["race_key"]).sum()


def evaluate(df: pd.DataFrame, score) -> dict:
    grid = predicted_grid(df, score)
    per_session = session_scores(df, grid <= 10)
    err = (grid - df[TARGET]).abs()
    return {
        "sessions": int(per_session.size),
        "correct_per_10": float(per_session.mean()),
        "perfect_sessions": int((per_session == 10).sum()),
        "worst_session": int(per_session.min()),
        "mae_all": float(err.groupby(df["race_key"]).mean().mean()),
        "mae_top10": float(err[df["top10"] == 1].mean()),
    }


def evaluate_baselines(df: pd.DataFrame) -> dict[str, dict]:
    return {name: evaluate(df, df[col]) for name, col in BASELINES.items()}


def feature_importance(model, df: pd.DataFrame, n_repeats: int = 5, seed: int = 0) -> pd.Series:
    """Permutation importance measured as drop in correct picks per 10."""
    rng = np.random.default_rng(seed)
    base = evaluate(df, predict_position(model, df))["correct_per_10"]
    drops = {}
    for feat in FEATURES:
        scores = []
        for _ in range(n_repeats):
            shuffled = df.copy()
            shuffled[feat] = rng.permutation(shuffled[feat].to_numpy())
            scores.append(evaluate(shuffled, predict_position(model, shuffled))["correct_per_10"])
        drops[feat] = base - float(np.mean(scores))
    return pd.Series(drops).sort_values(ascending=False)

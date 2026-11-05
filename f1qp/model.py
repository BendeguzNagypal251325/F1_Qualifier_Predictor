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
from .features import CAR_FEATURES, FEATURE_GROUP, FEATURE_GROUPS, FEATURES, TARGET


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



# ---------------------------------------------------------------- Q3 probability
# How sure is a predicted Q3 place? Empirically: take the walk-forward residuals of earlier races
# (actual position minus predicted grid position) and count how often a driver at this predicted
# position would still end up in the top 10. Residuals are grouped by predicted position, because
# their spread depends on it: drivers predicted near the front can only lose places, those near the
# back can only gain, and the spread is widest around the cut-off. No extra model is fitted.

Q3_BIN_EDGES = (3, 6, 9, 12, 15)  # predicted grid groups: P1-3, P4-6, P7-9, P10-12, P13-15, P16+
MIN_PRIOR_RACES = 10              # races of residuals needed before a probability is given
CLOSE_CALL = (0.3, 0.7)           # "too close to call" band shown in the app


def q3_bin(pred_rank) -> np.ndarray:
    """Group index (0-5) of each predicted grid position."""
    return np.searchsorted(Q3_BIN_EDGES, np.asarray(pred_rank, dtype=float), side="left")


def q3_probability(pred_rank, past_rank, past_pos) -> np.ndarray:
    """P(qualifying in the top 10) for each predicted grid position, from earlier races' residuals.

    ``past_rank`` / ``past_pos`` are the predicted grid positions and real positions of earlier races
    only (the caller guarantees that). The probability is the share of residuals r from the same group
    with ``pred_rank + r <= 10``.
    """
    pred_rank = np.asarray(pred_rank, dtype=float)
    past_rank, past_pos = np.asarray(past_rank, dtype=float), np.asarray(past_pos, dtype=float)
    res, past_bin = past_pos - past_rank, q3_bin(past_rank)
    out = np.full(len(pred_rank), np.nan)
    for b in np.unique(q3_bin(pred_rank)):
        pool = np.sort(res[past_bin == b])
        if len(pool) == 0:
            continue
        mine = q3_bin(pred_rank) == b
        # count of residuals r <= 10 - rank, via the sorted pool
        out[mine] = np.searchsorted(pool, 10 - pred_rank[mine], side="right") / len(pool)
    return out


def walk_forward_q3(wf: pd.DataFrame) -> pd.Series:
    """Q3 probability for every walk-forward row, using only races strictly before that row's race.

    Needs columns race_key, date, pred_rank and quali_pos. Races with fewer than MIN_PRIOR_RACES
    earlier races get NaN.
    """
    done = wf[wf["quali_pos"].notna()]
    races = wf.drop_duplicates("race_key").sort_values("date")[["race_key", "date"]]
    out = pd.Series(np.nan, index=wf.index, dtype=float)
    for key, date in races.itertuples(index=False):
        past = done[done["date"] < date]
        if past["race_key"].nunique() < MIN_PRIOR_RACES:
            continue
        rows = wf.index[wf["race_key"] == key]
        out.loc[rows] = q3_probability(wf.loc[rows, "pred_rank"], past["pred_rank"], past["quali_pos"])
    return out


def brier(prob, outcome) -> float:
    """Mean squared error of probabilities against 0/1 outcomes (lower is better)."""
    prob, outcome = np.asarray(prob, dtype=float), np.asarray(outcome, dtype=float)
    return float(np.mean((prob - outcome) ** 2))

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


# ---------------------------------------------------------------- explanations ----------------------------------------


def contributions(model, df: pd.DataFrame) -> pd.DataFrame:
    """Exact additive split of each prediction into feature-group contributions (in grid places).

    The pipeline is imputer -> scaler -> ridge, so prediction = intercept + sum(coef * scaled value).
    Each scaled column (including the imputer's "was missing" indicators) is credited to the group
    of the feature it came from. A negative contribution moves the driver up the grid; zero means
    "like the average entry in the training data". Columns: one per group plus ``baseline``.
    """
    imputer, scaler, ridge = (model.named_steps[k] for k in ("simpleimputer", "standardscaler", "ridge"))
    names = list(model.feature_names_in_)
    X = scaler.transform(imputer.transform(df[names]))
    cols = list(imputer.get_feature_names_out(names))
    out = pd.DataFrame(0.0, index=df.index, columns=list(FEATURE_GROUPS))
    for j, col in enumerate(cols):
        base = col.removeprefix("missingindicator_")
        out[FEATURE_GROUP[base]] += X[:, j] * ridge.coef_[j]
    out["baseline"] = float(ridge.intercept_)
    return out


SWAP_WEEKEND = FEATURE_GROUPS["weekend"]


def swap_rows(session: pd.DataFrame, driver_id: str, team_id: str) -> pd.DataFrame:
    """Rows for ``driver_id`` placed in ``team_id``'s car at this session (a what-if).

    Driver features come from the driver's own row. Car features, and this weekend's practice
    results (which mostly reflect the car), come from the target team's entries: the average of its
    drivers. ``drv_team_sessions`` is set to 0 when the team is new for the driver.
    """
    me = session[session["driver_id"] == driver_id]
    team = session[session["team_id"] == team_id]
    if me.empty or team.empty:
        raise KeyError("driver or team not in this session")
    row = me.iloc[[0]].copy()
    for col in CAR_FEATURES + SWAP_WEEKEND:
        row[col] = team[col].mean()
    if row["team_id"].iloc[0] != team_id:
        row["drv_team_sessions"] = 0
    row["team_id"] = team_id
    row["constructor_id"] = team["constructor_id"].iloc[0]
    return row

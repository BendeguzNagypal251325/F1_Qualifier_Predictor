"""Pre-qualifying features.

Every feature for a session uses only:
  * results of *earlier* sessions (rolling form, circuit history, teammate battle), or
  * information published before qualifying of the same weekend (practice, standings
    after the previous round, sprint-weekend flag, circuit type).
History is computed over rows sorted by date and shifted by one session, so the session
being predicted never leaks into its own features.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

FEATURES = [
    # driver form
    "drv_pos_last",
    "drv_pos_mean3",
    "drv_pos_mean5",
    "drv_top10_rate5",
    "drv_pace_gap_mean3",
    "drv_season_pos_mean",
    "drv_vs_teammate5",
    "drv_circuit_last_pos",
    "drv_career_sessions",
    "drv_team_sessions",
    # constructor form
    "con_pos_mean3",
    "con_top10_rate3",
    "con_pace_gap_mean3",
    "con_season_pos_mean",
    # championship before this round
    "driver_champ_pos_before",
    "driver_points_before",
    "constructor_champ_pos_before",
    "constructor_points_before",
    # this weekend's practice
    "fp_last_pos",
    "fp_last_gap_pct",
    "fp_best_pos",
    "fp_mean_gap_pct",
    "fp_sessions",
    # event context
    "sprint_weekend",
    "street_circuit",
]

TARGET = "top10"


def _pace_gap(df: pd.DataFrame) -> pd.Series:
    """Driver's best lap in qualifying as % slower than the session's best lap."""
    best = df[["q1_s", "q2_s", "q3_s"]].min(axis=1)
    pole = best.groupby(df["race_key"]).transform("min")
    return (best - pole) / pole * 100


def _rolling_past(df: pd.DataFrame, by: str, col: str, window: int, how: str = "mean") -> pd.Series:
    """Rolling statistic of ``col`` over the previous ``window`` sessions per ``by`` (excludes current)."""
    g = df.groupby(by, sort=False)[col]
    shifted = g.shift(1)
    roll = shifted.groupby(df[by], sort=False).rolling(window, min_periods=1)
    out = getattr(roll, how)()
    return out.reset_index(level=0, drop=True).reindex(df.index)


def build_features(entries: pd.DataFrame) -> pd.DataFrame:
    df = entries.copy()
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values(["date", "quali_pos"]).reset_index(drop=True)
    df["pace_gap"] = _pace_gap(df)

    # Driver rolling form across seasons.
    df["drv_pos_last"] = df.groupby("driver_id")["quali_pos"].shift(1)
    df["drv_pos_mean3"] = _rolling_past(df, "driver_id", "quali_pos", 3)
    df["drv_pos_mean5"] = _rolling_past(df, "driver_id", "quali_pos", 5)
    df["drv_top10_rate5"] = _rolling_past(df, "driver_id", "top10", 5)
    df["drv_pace_gap_mean3"] = _rolling_past(df, "driver_id", "pace_gap", 3)
    df["drv_career_sessions"] = df.groupby("driver_id").cumcount()
    df["drv_team_sessions"] = df.groupby(["driver_id", "constructor_id"]).cumcount()

    ds = ["driver_id", "season"]
    prev = df.groupby(ds)["quali_pos"].shift(1)
    df["drv_season_pos_mean"] = prev.groupby([df["driver_id"], df["season"]]).expanding().mean().reset_index(
        level=[0, 1], drop=True
    )

    # Teammate battle: my position minus my teammate's best position, last 5 sessions.
    team_count = df.groupby(["race_key", "constructor_id"])["quali_pos"].transform("size")
    team_sum = df.groupby(["race_key", "constructor_id"])["quali_pos"].transform("sum")
    teammate_pos = np.where(team_count > 1, (team_sum - df["quali_pos"]) / (team_count - 1).clip(lower=1), np.nan)
    df["vs_teammate"] = df["quali_pos"] - teammate_pos
    df["drv_vs_teammate5"] = _rolling_past(df, "driver_id", "vs_teammate", 5)

    # Last qualifying position for this driver at this circuit (previous visits only).
    df["drv_circuit_last_pos"] = df.groupby(["driver_id", "circuit"])["quali_pos"].shift(1)

    # Constructor form: aggregate per (race, team) first, then roll over the team's sessions.
    team = (
        df.groupby(["race_key", "constructor_id", "season"], sort=False)
        .agg(date=("date", "first"), pos=("quali_pos", "mean"), top10=("top10", "mean"), gap=("pace_gap", "min"))
        .reset_index()
        .sort_values("date")
        .reset_index(drop=True)
    )
    team["con_pos_mean3"] = _rolling_past(team, "constructor_id", "pos", 3)
    team["con_top10_rate3"] = _rolling_past(team, "constructor_id", "top10", 3)
    team["con_pace_gap_mean3"] = _rolling_past(team, "constructor_id", "gap", 3)
    prev_t = team.groupby(["constructor_id", "season"])["pos"].shift(1)
    team["con_season_pos_mean"] = prev_t.groupby([team["constructor_id"], team["season"]]).expanding().mean().reset_index(
        level=[0, 1], drop=True
    )
    df = df.merge(
        team[["race_key", "constructor_id", "con_pos_mean3", "con_top10_rate3", "con_pace_gap_mean3", "con_season_pos_mean"]],
        on=["race_key", "constructor_id"],
        how="left",
    )

    # Practice: latest available session (FP3 > FP2 > FP1), best position, mean gap.
    pos_cols = ["fp3_pos", "fp2_pos", "fp1_pos"]
    gap_cols = ["fp3_gap_pct", "fp2_gap_pct", "fp1_gap_pct"]
    df["fp_last_pos"] = df[pos_cols].bfill(axis=1).iloc[:, 0]
    df["fp_last_gap_pct"] = df[gap_cols].bfill(axis=1).iloc[:, 0]
    df["fp_best_pos"] = df[pos_cols].min(axis=1)
    df["fp_mean_gap_pct"] = df[gap_cols].mean(axis=1)
    df["fp_sessions"] = df[pos_cols].notna().sum(axis=1)

    df["sprint_weekend"] = df["sprint_weekend"].astype(int)
    df["street_circuit"] = (df["circuit_type"] == "STREET").astype(int)
    return df.sort_values(["season", "round", "quali_pos"]).reset_index(drop=True)

"""Precompute everything the web app serves, so the server starts in a second.

    uv run f1qp-build        # -> artifacts/state.pkl

The state holds the walk-forward predictions (every session predicted by a model trained only on
earlier sessions) with the car / driver / weekend / context split of each prediction, plus the
summary metrics. The server rebuilds it by itself when the data file is newer than the artifact.
"""

from __future__ import annotations

import argparse
import pickle
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from . import SEASONS
from . import model as M
from .data import ENTRIES_CSV, LIVE_DIR, ROOT, load_entries
from .features import FEATURE_GROUPS, FEATURES, build_features

ARTIFACT = ROOT / "artifacts" / "state.pkl"
GROUPS = list(FEATURE_GROUPS)
STATE_VERSION = 3  # 2: q3_prob column; 3: q3_calibration in the overview


@dataclass
class State:
    wf: pd.DataFrame  # one row per driver per predicted session
    feat: pd.DataFrame  # all feature rows (history included), for what-if refits
    overview: dict
    built_at: str
    data_version: str  # date of the newest session in the data
    version: int = STATE_VERSION
    timings: dict = field(default_factory=dict)


def _round(d: dict) -> dict:
    return {k: (round(v, 3) if isinstance(v, float) else v) for k, v in d.items()}


def walk_forward_explained(feat: pd.DataFrame, seasons=SEASONS) -> pd.DataFrame:
    """Walk-forward predictions with the per-group contributions of each prediction."""
    sessions = (
        feat.loc[feat["season"].isin(seasons) & feat["quali_pos"].notna()]
        .drop_duplicates("race_key")
        .sort_values("date")
    )
    parts = []
    for race_key, date in sessions[["race_key", "date"]].itertuples(index=False):
        test = feat[feat["race_key"] == race_key]
        model = M.fit(feat[feat["date"] < date])
        part = M.contributions(model, test).add_prefix("contrib_")
        part["pred"] = M.predict_position(model, test)
        parts.append(part)
    out = pd.concat(parts)
    wf = feat.loc[out.index].join(out)
    wf["pred_rank"] = M.predicted_grid(wf, wf["pred"])
    wf["picked"] = wf["pred_rank"] <= 10
    wf["right"] = wf["picked"] == (wf["top10"] == 1)
    wf["q3_prob"] = M.walk_forward_q3(wf)  # from earlier races' residuals only
    return wf.sort_values(["season", "round", "pred_rank"])


def overview(feat: pd.DataFrame, wf: pd.DataFrame) -> dict:
    seasons = sorted(int(s) for s in wf["season"].unique())
    latest = seasons[-1]
    per_session = M.session_scores(wf, wf["picked"])
    imp = M.feature_importance(M.fit(feat[feat["season"] < latest]), wf[wf["season"] == latest], n_repeats=3)
    group_size = {g: float(wf[f"contrib_{g}"].abs().mean()) for g in GROUPS}
    return {
        "seasons": seasons,
        "latest": latest,
        "overall": _round(M.evaluate(wf, wf["pred"])),
        "by_season": {str(s): _round(M.evaluate(wf[wf["season"] == s], wf.loc[wf["season"] == s, "pred"])) for s in seasons},
        "baselines": {k: _round(v) for k, v in M.evaluate_baselines(wf).items()},
        "baselines_by_season": {
            str(s): {k: round(v["correct_per_10"], 3) for k, v in M.evaluate_baselines(wf[wf["season"] == s]).items()}
            for s in seasons
        },
        "histogram": {str(int(k)): int(v) for k, v in per_session.value_counts().sort_index().items()},
        "importance": [[k, round(float(v), 3)] for k, v in imp.items()],
        "group_size": {g: round(v, 3) for g, v in group_size.items()},
        "feature_groups": FEATURE_GROUPS,
        "n_features": len(FEATURES),
        "q3_calibration": _q3_calibration(wf),
    }


def _q3_calibration(wf: pd.DataFrame) -> dict:
    """Brier scores of the Q3 probability vs simpler forecasts (lower is better), for the How it works page."""
    d = wf.dropna(subset=["q3_prob", "quali_pos"])
    y = (d["quali_pos"] <= 10).astype(float)
    field = d.groupby("race_key")["race_key"].transform("size")
    return {"races": int(d["race_key"].nunique()), "brier": round(M.brier(d["q3_prob"], y), 3),
            "brier_picks": round(M.brier(d["picked"].astype(float), y), 3), "brier_base_rate": round(M.brier(10 / field, y), 3)}


def data_mtime() -> float:
    files = [ENTRIES_CSV, *LIVE_DIR.glob("*.csv")] if LIVE_DIR.exists() else [ENTRIES_CSV]
    return max(f.stat().st_mtime for f in files if f.exists())


def compute_state(entries: pd.DataFrame | None = None) -> State:
    t0 = time.perf_counter()
    entries = load_entries() if entries is None else entries
    feat = build_features(entries)
    t1 = time.perf_counter()
    wf = walk_forward_explained(feat)
    t2 = time.perf_counter()
    ov = overview(feat, wf)
    t3 = time.perf_counter()
    return State(
        wf=wf,
        feat=feat,
        overview=ov,
        built_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        data_version=str(feat.loc[feat["quali_pos"].notna(), "date"].max())[:10],
        timings={"features_s": round(t1 - t0, 2), "walk_forward_s": round(t2 - t1, 2), "overview_s": round(t3 - t2, 2)},
    )


def save_state(state: State, path: Path = ARTIFACT) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(pickle.dumps(state, protocol=pickle.HIGHEST_PROTOCOL))
    tmp.replace(path)


def load_state(path: Path = ARTIFACT, rebuild_if_stale: bool = True) -> State:
    """Load the artifact; rebuild it if missing, from an older version, or older than the data."""
    if path.exists():
        try:
            state = pickle.loads(path.read_bytes())
            fresh = path.stat().st_mtime >= data_mtime()
            if getattr(state, "version", None) == STATE_VERSION and (fresh or not rebuild_if_stale):
                return state
        except Exception:  # noqa: BLE001 - a corrupt or incompatible artifact is simply rebuilt
            pass
    state = compute_state()
    save_state(state, path)
    return state


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=ARTIFACT)
    args = parser.parse_args()
    # Import by module name, so the pickled class is f1qp.build.State even under ``python -m``.
    from f1qp import build as B

    state = B.compute_state()
    B.save_state(state, args.out)
    o = state.overview["overall"]
    print(f"Built {args.out}: {o['sessions']} sessions, {o['correct_per_10']:.2f} correct / 10, timings {state.timings}")


if __name__ == "__main__":
    main()

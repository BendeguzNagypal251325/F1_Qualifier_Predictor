"""Q3 probability: no leakage, sensible ordering, valid range."""

import numpy as np
import pandas as pd
import pytest

from f1qp import model as M
from f1qp.build import compute_state
from f1qp.data import load_entries


def _synthetic_wf(n_races=30, field=20, seed=0):
    rng = np.random.default_rng(seed)
    rows = []
    for i in range(n_races):
        actual = rng.permutation(field) + 1
        noisy = actual + rng.normal(0, 3, field)
        rank = pd.Series(noisy).rank(method="first").astype(int).to_numpy()
        for a, r in zip(actual, rank):
            rows.append({"race_key": f"r{i:02d}", "date": pd.Timestamp("2024-01-01") + pd.Timedelta(days=7 * i),
                         "pred_rank": int(r), "quali_pos": float(a)})
    return pd.DataFrame(rows)


def test_probability_ignores_later_races_synthetic():
    wf = _synthetic_wf()
    full = M.walk_forward_q3(wf)
    cut = wf[wf["date"] <= wf.loc[wf["race_key"] == "r20", "date"].iloc[0]]
    part = M.walk_forward_q3(cut)
    rows = wf.index[wf["race_key"] == "r20"]
    assert full.loc[rows].notna().all()
    assert np.allclose(full.loc[rows], part.loc[rows])
    # not enough earlier races yet: no probability rather than a guess
    assert full[wf["race_key"] == "r05"].isna().all()


@pytest.fixture(scope="module")
def state():
    return compute_state()


def test_probability_ignores_later_races_real_data(state):
    """Rebuild everything (features, walk-forward, probabilities) without the races after race N."""
    wf = state.wf
    key = wf[wf["season"] == 2023].sort_values("date")["race_key"].iloc[5]
    date = wf.loc[wf["race_key"] == key, "date"].iloc[0]
    entries = load_entries()
    truncated = compute_state(entries[pd.to_datetime(entries["date"]) <= date])
    a = wf[wf["race_key"] == key].set_index("driver_id")["q3_prob"]
    b = truncated.wf[truncated.wf["race_key"] == key].set_index("driver_id")["q3_prob"]
    assert a.notna().all()
    pd.testing.assert_series_equal(a.sort_index(), b.sort_index())


def test_inside_beats_outside_and_range(state):
    wf = state.wf
    done = wf[wf["quali_pos"].notna()]
    p = M.q3_probability([3, 8, 10, 12, 17], done["pred_rank"], done["quali_pos"])
    assert p[0] > p[1] > p[3] > p[4]          # P3 > P8 > P12 > P17
    assert p[0] > 0.9 and p[4] < 0.1
    probs = wf["q3_prob"].dropna()
    assert len(probs) > 2000 and probs.between(0, 1).all()


def test_probabilities_are_calibrated(state):
    """Observed Q3 rate per probability bucket stays close to the bucket's mean probability."""
    wf = state.wf.dropna(subset=["q3_prob", "quali_pos"])
    y = (wf["quali_pos"] <= 10).astype(float)
    bucket = pd.cut(wf["q3_prob"], np.linspace(0, 1, 6), include_lowest=True)
    gap = (wf["q3_prob"].groupby(bucket, observed=True).mean() - y.groupby(bucket, observed=True).mean()).abs()
    assert gap.max() < 0.1
    assert M.brier(wf["q3_prob"], y) < M.brier(wf["picked"].astype(float), y)

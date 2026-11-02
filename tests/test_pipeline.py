import numpy as np
import pandas as pd
import pytest

from f1qp import SEASONS
from f1qp import model as M
from f1qp.data import load_entries, parse_laptime
from f1qp.features import FEATURES, build_features


@pytest.fixture(scope="module")
def entries():
    return load_entries()


@pytest.fixture(scope="module")
def feat(entries):
    return build_features(entries)


def test_parse_laptime():
    assert parse_laptime("1:29.179") == pytest.approx(89.179)
    assert parse_laptime("59.5") == pytest.approx(59.5)
    assert np.isnan(parse_laptime(None))
    assert np.isnan(parse_laptime(""))


def test_every_session_has_exactly_ten_top10(entries):
    counts = entries.groupby("race_key")["top10"].sum()
    assert (counts == 10).all()
    assert set(SEASONS) <= set(entries["season"])


def test_features_do_not_use_future_sessions(entries, feat):
    """Features of a session must be identical when all later sessions are removed."""
    key = "2023-07-spain"
    cutoff = entries.loc[entries["race_key"] == key, "date"].iloc[0]
    truncated = build_features(entries[entries["date"] <= cutoff])
    a = feat[feat["race_key"] == key].set_index("driver_id")[FEATURES].sort_index()
    b = truncated[truncated["race_key"] == key].set_index("driver_id")[FEATURES].sort_index()
    pd.testing.assert_frame_equal(a, b)


def test_features_do_not_use_own_result(entries, feat):
    """Changing a session's result must not change that session's features."""
    key = "2022-05-miami"
    shuffled = entries.copy()
    mask = shuffled["race_key"] == key
    shuffled.loc[mask, ["quali_pos", "top10", "q1_s", "q2_s", "q3_s"]] = (
        shuffled.loc[mask, ["quali_pos", "top10", "q1_s", "q2_s", "q3_s"]].iloc[::-1].to_numpy()
    )
    other = build_features(shuffled)
    a = feat[feat["race_key"] == key].set_index("driver_id")[FEATURES].sort_index()
    b = other[other["race_key"] == key].set_index("driver_id")[FEATURES].sort_index()
    pd.testing.assert_frame_equal(a, b)


def test_pick_top10_picks_ten_per_session(feat):
    data = feat[feat["season"] == 2024]
    picked = M.pick_top10(data, np.random.default_rng(0).random(len(data)))
    assert (picked.groupby(data["race_key"]).sum() == 10).all()


def test_model_beats_coin_flip(feat):
    data = feat[feat["season"].isin(SEASONS)]
    train, test = data[data["season"] <= 2023], data[data["season"] == 2025]
    result = M.evaluate(test, M.predict_proba(M.fit(train), test))
    assert result["roc_auc"] > 0.8
    assert result["correct_per_10"] > 7

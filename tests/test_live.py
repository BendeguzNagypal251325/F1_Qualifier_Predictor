"""Offline tests for f1qp.live: a finished weekend is replayed through a fake OpenF1 API.

The fake API serves the 2026 Mexico weekend from data/qualifying_entries.csv. The live code must
rebuild the same rows (practice, qualifying, standings) and give the same prediction as the
normal history-based pipeline.
"""

from datetime import date, datetime, timezone

import numpy as np
import pandas as pd
import pytest
import yaml

from f1qp import live
from f1qp import model as M
from f1qp.data import load_entries
from f1qp.features import FEATURES, build_features

KEY = "2026-19-mexico"
TEAM_NAMES = {v: k.title() for k, v in live.TEAM_IDS.items()}


@pytest.fixture(scope="module")
def entries():
    return load_entries(include_live=False)


@pytest.fixture()
def weekend_dir(tmp_path, entries):
    """Minimal F1DB-like folder: the Mexico race.yml and the standings after the previous round."""
    rows = entries[entries["race_key"] == KEY]
    races = tmp_path / "2026" / "races"
    prev, this = races / "18-united-states", races / "19-mexico"
    prev.mkdir(parents=True)
    this.mkdir()
    r = rows.iloc[0]
    this.joinpath("race.yml").write_text(yaml.safe_dump({
        "round": int(r["round"]), "date": r["date"], "grandPrixId": r["grand_prix"], "circuitId": r["circuit"],
        "circuitType": r["circuit_type"], "qualifyingFormat": r["qualifying_format"],
    }))
    prev.joinpath("driver-standings.yml").write_text(yaml.safe_dump([
        {"driverId": x.driver_id, "position": int(x.driver_champ_pos_before), "points": float(x.driver_points_before)}
        for x in rows.itertuples() if not np.isnan(x.driver_champ_pos_before)
    ]))
    teams = rows.drop_duplicates("constructor_id")
    prev.joinpath("constructor-standings.yml").write_text(yaml.safe_dump([
        {"constructorId": x.constructor_id, "position": int(x.constructor_champ_pos_before),
         "points": float(x.constructor_points_before)}
        for x in teams.itertuples() if not np.isnan(x.constructor_champ_pos_before)
    ]))
    return this


def fake_openf1(entries):
    """A stand-in for openf1_get that serves the Mexico weekend in OpenF1's JSON shape."""
    rows = entries[entries["race_key"] == KEY]
    day = rows["date"].iloc[0]
    names = {"Practice 1": 1, "Practice 2": 2, "Practice 3": 3, "Qualifying": 4, "Race": 5}
    sessions = [{"meeting_key": 1, "session_key": k, "session_name": n,
                 "date_start": f"{day}T{10 + k}:00:00+00:00", "date_end": f"{day}T{11 + k}:00:00+00:00"}
                for n, k in names.items()]

    def get(endpoint, **params):
        if endpoint == "sessions":
            return sessions
        if endpoint == "drivers":
            return [{"driver_number": int(x.driver_number), "first_name": x.driver_id.split("-")[0].title(),
                     "last_name": x.driver_id.split("-")[1].title(), "team_name": TEAM_NAMES[x.constructor_id]}
                    for x in rows.itertuples()]
        k = params["session_key"]
        if k in (1, 2, 3):
            pos, gap = rows[f"fp{k}_pos"], rows[f"fp{k}_gap_pct"]
            return [{"driver_number": int(n), "position": None if np.isnan(p) else int(p),
                     "duration": None if np.isnan(g) else 80 * (1 + g / 100)}
                    for n, p, g in zip(rows["driver_number"], pos, gap)]
        return [{"driver_number": int(x.driver_number), "position": int(x.quali_pos),
                 "duration": [None if np.isnan(t) else t for t in (x.q1_s, x.q2_s, x.q3_s)], "dsq": False}
                for x in rows.itertuples()]

    return get


def test_finds_weekend_sessions(entries):
    sessions = live.weekend_sessions(2026, date.fromisoformat(entries.loc[entries["race_key"] == KEY, "date"].iloc[0]),
                                     fake_openf1(entries))
    assert set(sessions) == {"Practice 1", "Practice 2", "Practice 3", "Qualifying", "Race"}


def test_live_rows_match_f1db(entries, weekend_dir):
    get = fake_openf1(entries)
    sessions = live.weekend_sessions(2026, date(2026, 11, 1), get)
    history = entries[entries["race_key"] != KEY]
    weekend, used = live.build_weekend(history, weekend_dir, sessions, get, now=datetime(2030, 1, 1, tzinfo=timezone.utc))
    assert used == ["Practice 1", "Practice 2", "Practice 3", "Qualifying"]
    want = entries[entries["race_key"] == KEY].set_index("driver_id").sort_index()
    got = weekend.set_index("driver_id").sort_index()
    assert list(got.index) == list(want.index)
    assert (got["constructor_id"] == want["constructor_id"]).all()
    for col in ("fp1_pos", "fp2_pos", "fp3_pos", "quali_pos", "driver_champ_pos_before", "constructor_points_before"):
        np.testing.assert_allclose(got[col].astype(float), want[col].astype(float))
    np.testing.assert_allclose(got["fp3_gap_pct"], want["fp3_gap_pct"], atol=1e-9)


def test_live_prediction_matches_history_pipeline(entries, weekend_dir):
    get = fake_openf1(entries)
    sessions = live.weekend_sessions(2026, date(2026, 11, 1), get)
    history = entries[entries["race_key"] != KEY]
    weekend, _ = live.build_weekend(history, weekend_dir, sessions, get, now=datetime(2030, 1, 1, tzinfo=timezone.utc))
    pred = live.predict_weekend(history, weekend).set_index("driver_id")["pred_score"].sort_index()

    feat = build_features(entries)
    this = feat[feat["race_key"] == KEY]
    model = M.fit(feat[feat["date"] < this["date"].iloc[0]], FEATURES)
    want = pd.Series(M.predict_position(model, this), index=this["driver_id"]).sort_index()
    np.testing.assert_allclose(pred.to_numpy(), want.to_numpy(), atol=1e-6)


def test_before_fp1_uses_pre_weekend_model(entries, weekend_dir):
    get = fake_openf1(entries)
    sessions = live.weekend_sessions(2026, date(2026, 11, 1), get)
    history = entries[entries["race_key"] != KEY]
    weekend, used = live.build_weekend(history, weekend_dir, sessions, get, now=datetime(2026, 10, 30, tzinfo=timezone.utc))
    assert used == [] and weekend["fp1_pos"].isna().all() and weekend["quali_pos"].isna().all()
    pred = live.predict_weekend(history, weekend)
    assert sorted(pred["pred_pos"]) == list(range(1, len(pred) + 1))

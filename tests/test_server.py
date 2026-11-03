"""Tests for the car/driver split, the picture manifest and the web API."""

import asyncio

import numpy as np
import pytest
from fastapi.testclient import TestClient

from f1qp import model as M
from f1qp.build import compute_state, save_state
from f1qp.cars import CARS, car_info, era_for
from f1qp.data import load_entries
from f1qp.features import FEATURE_GROUP, FEATURES, build_features
from f1qp.server import Settings, create_app
from f1qp.tracks import outlines

KEY = "2026-19-mexico"


@pytest.fixture(scope="module")
def feat():
    return build_features(load_entries(include_live=False))


@pytest.fixture(scope="module")
def artifact(tmp_path_factory):
    path = tmp_path_factory.mktemp("art") / "state.pkl"
    save_state(compute_state(load_entries(include_live=False)), path)
    return path


@pytest.fixture(scope="module")
def client(artifact, tmp_path_factory):
    live_calls = []

    def fake_live():
        live_calls.append(1)
        return {"race_key": KEY, "rows": []}

    settings = Settings(live_interval=0, admin_token="secret", artifact=artifact,
                        static_dir=tmp_path_factory.mktemp("nostatic"))
    with TestClient(create_app(settings, live_fetch=fake_live)) as c:
        c.live_calls = live_calls
        yield c


# ---------------------------------------------------------------- model explanations


def test_every_feature_has_one_group():
    assert set(FEATURE_GROUP) == set(FEATURES)


def test_contributions_add_up_to_prediction(feat):
    session = feat[feat["race_key"] == KEY]
    model = M.fit(feat[feat["date"] < session["date"].iloc[0]])
    contrib = M.contributions(model, session)
    np.testing.assert_allclose(contrib.sum(axis=1), M.predict_position(model, session), atol=1e-9)


def test_swap_takes_car_features_from_new_team(feat):
    session = feat[feat["race_key"] == KEY]
    row = M.swap_rows(session, "max-verstappen", "williams")
    williams = session[session["team_id"] == "williams"]
    assert row["con_pos_mean3"].iloc[0] == pytest.approx(williams["con_pos_mean3"].mean())
    assert row["fp_last_pos"].iloc[0] == pytest.approx(williams["fp_last_pos"].mean())
    me = session[session["driver_id"] == "max-verstappen"]
    assert row["drv_pos_mean5"].iloc[0] == me["drv_pos_mean5"].iloc[0]
    assert row["drv_team_sessions"].iloc[0] == 0


# ---------------------------------------------------------------- pictures, cars, tracks


def test_every_car_and_circuit_in_the_data_is_covered(feat):
    rows = feat[feat["season"] >= 2020].drop_duplicates(["season", "constructor_id"])
    missing = [(r.season, r.constructor_id) for r in rows.itertuples() if (r.season, r.constructor_id) not in CARS]
    assert missing == []
    assert set(feat.loc[feat["season"] >= 2020, "circuit"]) <= set(outlines())
    assert era_for(2021) == "2017-2021" and era_for(2022) == "2022-2025" and era_for(2026) == "2026-"
    assert car_info(2026, "audi")["chassis"] == "R26"


# ---------------------------------------------------------------- API


def test_health_and_meta(client):
    assert client.get("/api/health").json()["status"] == "ok"
    meta = client.get("/api/meta").json()
    assert 2020 in meta["seasons"] and meta["latest"] >= 2026
    ver = next(d for d in meta["drivers"] if d["id"] == "max-verstappen")
    assert ver["name"] == "Max Verstappen"
    ham = next(d for d in meta["drivers"] if d["id"] == "lewis-hamilton")
    assert ham["teams"]["2024"] == "mercedes" and ham["teams"]["2025"] == "ferrari"  # colour follows the season
    monaco = next(c for c in meta["circuits"] if c["id"] == "monaco")
    assert monaco["outline"].startswith("M") and "map" not in monaco


def test_overview_matches_walk_forward(client):
    o = client.get("/api/overview").json()
    assert 7.5 < o["overall"]["correct_per_10"] < 9
    assert set(o["group_size"]) == {"driver", "car", "weekend", "context"}


def test_session_rows_are_ordered_and_explained(client):
    s = client.get(f"/api/sessions/{KEY}").json()
    ranks = [r["pred_rank"] for r in s["rows"]]
    assert ranks == sorted(ranks) and ranks[0] == 1
    r = s["rows"][0]
    assert r["pred"] == pytest.approx(sum(r["contrib"].values()) + r["baseline"], abs=0.05)
    assert 0 <= s["correct"] <= 10


def test_driver_track_and_car_pages(client):
    d = client.get("/api/drivers/lewis-hamilton?seasons=2024,2025").json()
    assert {t["team"] for t in d["teams"]} == {"mercedes", "ferrari"}
    assert all(r["season"] in (2024, 2025) for t in d["tracks"] for r in t["results"])
    t = client.get("/api/tracks/monaco").json()
    assert t["drivers"] and t["sessions"]
    cars = client.get("/api/cars?season=2026").json()["cars"]
    assert len(cars) == 11 and [c["pace_gap"] for c in cars] == sorted(c["pace_gap"] for c in cars)
    car = client.get("/api/cars/2026/mclaren").json()
    assert car["chassis"] == "MCL40" and car["engine"] == "mercedes" and car["trend"]
    assert [l["team"] for l in car["lineage"] if l["season"] == 2020] == ["mclaren"]


def test_swap_endpoint(client):
    s = client.get(f"/api/swap?race_key={KEY}&driver=max-verstappen&team=williams").json()
    assert s["from_team"] == "red-bull"
    assert s["grid"] > s["own_grid"]  # a Williams is slower than a Red Bull
    assert client.get(f"/api/swap?race_key={KEY}&driver=nobody&team=williams").status_code == 404


def test_errors(client):
    assert client.get("/api/drivers/nobody").status_code == 404
    assert client.get("/api/cars/2019/mclaren").status_code == 404
    assert client.get("/api/drivers/max-verstappen?seasons=abc").status_code == 400


def test_live_refresh_needs_token(client):
    assert client.post("/api/live/refresh").status_code == 401
    assert client.post("/api/live/refresh", headers={"Authorization": "Bearer secret"}).status_code == 202


def test_live_service_reports_errors(artifact, tmp_path):
    def boom():
        raise SystemExit("No upcoming race left in this season.")

    app = create_app(Settings(live_interval=0, artifact=artifact, static_dir=tmp_path), live_fetch=boom)
    with TestClient(app):
        live = app.state.live
        asyncio.run(live.refresh())
        assert live.snapshot is None and "No upcoming race" in live.error

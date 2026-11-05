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
    assert meta["cars"]["2026"]["mclaren"]["chassis"] == "MCL40" and len(meta["cars"]["2026"]["mclaren"]["livery"]) == 3
    assert meta["cars"]["2021"]["red-bull"]["era"] == "2017-2021"
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
    assert [x["team"] for x in car["lineage"] if x["season"] == 2020] == ["mclaren"]


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


def test_teams(client):
    teams = client.get("/api/teams").json()
    rb = next(t for t in teams if t["id"] == "racing-bulls")
    assert rb["names"][-1] == "Racing Bulls" and "AlphaTauri" in rb["names"]
    t = client.get("/api/teams/racing-bulls").json()
    assert [s["season"] for s in t["seasons"]] == sorted(s["season"] for s in t["seasons"])
    for s in t["seasons"]:
        assert 1 <= s["pace_rank"] <= s["teams_in_season"]
        wins = sum(d["h2h_wins"] for d in s["drivers"])
        assert wins <= s["races"]
    assert t["best_tracks"] and t["best_tracks"][0]["avg_pos"] <= t["worst_tracks"][0]["avg_pos"]
    assert client.get("/api/teams/nobody").status_code == 404


def test_live_errors_are_readable(artifact, tmp_path):
    from urllib.error import URLError

    def offline():
        raise URLError("Name or service not known")

    app = create_app(Settings(live_interval=0, artifact=artifact, static_dir=tmp_path), live_fetch=offline)
    with TestClient(app):
        live = app.state.live
        asyncio.run(live.refresh())
        assert "OpenF1" in live.error and "URLError" not in live.error


def test_api_cache_serves_identical_gzipped_responses(client):
    path = "/api/drivers/max-verstappen"
    first = client.get(path, headers={"Accept-Encoding": "gzip"})
    second = client.get(path, headers={"Accept-Encoding": "gzip"})
    assert second.headers["x-cache"] == "hit"
    assert first.json() == second.json()  # TestClient decodes gzip; garbled bytes would fail here
    plain = client.get(path, headers={"Accept-Encoding": "identity"})
    assert plain.json() == first.json()
    assert "x-cache" not in client.get("/api/health").headers


def test_versioned_models_are_cached(artifact, tmp_path):
    (tmp_path / "models").mkdir()
    (tmp_path / "models" / "car.json").write_text('{"wheelbase": 3.4}')
    (tmp_path / "index.html").write_text("<!doctype html>")
    (tmp_path / "assets").mkdir()
    app = create_app(Settings(live_interval=0, artifact=artifact, static_dir=tmp_path))
    with TestClient(app) as c:
        versioned = c.get("/models/car.json?v=1")
        assert versioned.status_code == 200 and "immutable" in versioned.headers["cache-control"]
        assert "immutable" not in c.get("/models/car.json").headers.get("cache-control", "")


def test_track_segments(client):
    seg = client.get("/api/tracks/monza").json()["segments"]
    assert set(seg) == {"q1", "q2", "q3"}
    for k, (field_min, through) in {"q1": (19, 15), "q2": (14, 10), "q3": (10, 1)}.items():
        for s in seg[k]["sessions"]:
            assert s["field"] >= field_min
            if k != "q3":
                assert all(o["pos"] > through for o in s["out"])          # knocked out here
                assert s["cutoff"]["pos"] <= through                        # the slowest who got through
            if s["gap_s"] is not None:
                assert s["gap_s"] >= 0 and s["fastest"]["time"] <= s["cutoff"]["time"]
        for d in seg[k]["drivers"]:
            assert 0 <= d["through"] <= d["reached"]
    # everyone who reached Q3 also reached Q2
    q2 = {d["driver"]: d["reached"] for d in seg["q2"]["drivers"]}
    assert all(q2[d["driver"]] >= d["reached"] for d in seg["q3"]["drivers"])


def test_track_sectors(client, tmp_path, monkeypatch):
    from f1qp import sectors
    from tests.test_sectors import _fake_trace

    monkeypatch.setattr(sectors, "SECTOR_DIR", tmp_path)
    assert client.get("/api/tracks/monza").json()["sectors"]["sessions"] == []  # nothing downloaded yet
    trace, _ = _fake_trace("monza")
    key = next(s["race_key"] for s in client.get("/api/tracks/monza").json()["sessions"] if s["season"] == 2025)
    sectors.save({"race_key": key, "session_key": 1, "trace": {"driver": "max-verstappen", "points": trace}, "drivers": [
        {"driver": "max-verstappen", "number": 1, "s1": 26.0, "s2": 27.1, "s3": 26.2, "lap": 79.3, "speed": 350},
        {"driver": "lando-norris", "number": 4, "s1": 26.2, "s2": 26.9, "s3": 26.3, "lap": 79.4, "speed": 347},
        {"driver": None, "number": 99, "s1": 20.0, "s2": 20.0, "s3": 20.0, "lap": 60.0, "speed": 400},  # not in F1DB: ignored
    ]})
    sec = client.get("/api/tracks/monza").json()["sectors"]  # new file: the response cache must not serve the old answer
    s = sec["sessions"][0]
    assert s["season"] == 2025 and s["best"]["s1"]["driver"] == "max-verstappen" and s["best"]["s2"]["driver"] == "lando-norris"
    assert s["ideal"] == round(26.0 + 26.9 + 26.2, 3) and s["top_speed"]["time"] == 350 and s["pole_lap"]["driver"] == "max-verstappen"
    assert sec["records"]["s3"]["season"] == 2025 and sec["map"]["season"] == 2025 and len(sec["map"]["paths"]) == 3


def test_q3_probability_in_session_and_live(client, artifact):
    from f1qp.build import load_state
    from f1qp.server import with_q3_prob

    s = client.get("/api/sessions").json()[-1]
    rows = client.get(f"/api/sessions/{s['race_key']}").json()["rows"]
    probs = [r["q3_prob"] for r in rows]
    assert all(0 <= p <= 1 for p in probs) and probs[0] > probs[-1]
    st = load_state(artifact, rebuild_if_stale=False)
    snap = {"date": "2026-12-06", "rows": [{"pred_pos": 1}, {"pred_pos": 10}, {"pred_pos": 20}]}
    live = with_q3_prob(snap, st.wf)
    p = [r["q3_prob"] for r in live["rows"]]
    assert p[0] > p[1] > p[2] and live["close_call"] == [0.3, 0.7]
    assert with_q3_prob(None, st.wf) is None


def test_track_record_matches_manual_recount(client, artifact, tmp_path, monkeypatch):
    from f1qp import snapshots
    from f1qp.build import load_state

    monkeypatch.setattr(snapshots, "SNAP_DIR", tmp_path)
    assert client.get("/api/snapshots?season=2025").json()["races"] == []
    st = load_state(artifact, rebuild_if_stale=False)
    race = st.wf[st.wf["season"] == 2025].sort_values("date")["race_key"].iloc[3]
    rows = st.wf[st.wf["race_key"] == race].sort_values("fp_last_pos")  # a "frozen" order: practice order
    snap = {"race_key": race, "season": 2025, "round": int(rows["round"].iloc[0]), "grand_prix": rows["grand_prix"].iloc[0],
            "circuit": rows["circuit"].iloc[0], "date": "2025-01-01", "sessions_used": ["Practice 1"], "qualifying_done": False,
            "qualifying_start": "2099-01-01T00:00:00+00:00",
            "rows": [{"pred_pos": i + 1, "driver_id": d, "constructor_id": t} for i, (d, t) in enumerate(zip(rows["driver_id"], rows["constructor_id"]))]}
    assert snapshots.freeze(snap) is not None
    # manual recount: frozen top 10 vs the drivers who really qualified top 10
    top10 = set(rows["driver_id"].iloc[:10])
    real = set(rows.loc[rows["quali_pos"] <= 10, "driver_id"])
    expected = len(top10 & real)
    summary = client.get("/api/snapshots?season=2025").json()  # new file: not served from the cache
    assert summary["races"][0]["race_key"] == race and summary["races"][0]["correct"] == expected
    assert summary["totals"] == {"races": 1, "scored": 1, "correct_per_10": float(expected)}
    detail = client.get(f"/api/snapshots/{race}").json()
    assert detail["snapshots"][0]["score"]["correct"] == expected and len(detail["result"]) == len(rows)
    assert client.get("/api/snapshots/2025-99-nowhere").status_code == 404


def test_live_season_over_has_a_reason_code(artifact, tmp_path):
    from f1qp.live import LiveUnavailable

    def over():
        raise LiveUnavailable("No upcoming race left in this season.", code="season_over")

    app = create_app(Settings(live_interval=0, artifact=artifact, static_dir=tmp_path), live_fetch=over)
    with TestClient(app) as c:
        live = app.state.live
        asyncio.run(live.refresh())
        status = live.status()
        assert status["error_code"] == "season_over" and "No upcoming race" in status["error"]
        assert c.get("/api/live").json()["status"]["error_code"] == "season_over"


def test_overview_reports_q3_calibration(client):
    cal = client.get("/api/overview").json()["q3_calibration"]
    assert cal["races"] > 100 and cal["brier"] < cal["brier_picks"] < cal["brier_base_rate"]

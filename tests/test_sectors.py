"""Sector data: OpenF1 parsing (fake responses) and fitting a lap trace onto a track outline."""

from datetime import date, datetime, timedelta, timezone

import numpy as np

from f1qp import sectors
from f1qp.tracks import outline_points


def _fake_trace(circuit: str, start_frac=0.3, angle=0.65, mirror=True, reverse=False):
    """A lap trace made from the outline itself: rotated, scaled, mirrored, starting part-way round."""
    P = np.asarray(outline_points(circuit))
    R, _ = sectors._resample(P, 400, closed=True)
    k = int(start_frac * len(R))
    R = np.roll(R, -k, axis=0)
    if reverse:
        R = R[::-1]
    c, s = np.cos(angle), np.sin(angle)
    T = (R - 50) @ np.array([[c, -s], [s, c]]) * 73.0 + [1200, -800]
    if mirror:
        T[:, 1] *= -1
    T += np.random.default_rng(1).normal(0, 2.0, T.shape)  # GPS-like noise
    lab = np.repeat([1, 2, 3], [140, 120, 140])
    return np.c_[T, lab].tolist(), R


def test_trace_fits_outline_and_splits_it_into_three_sectors():
    for circuit, rev in (("monza", False), ("suzuka", True), ("marina-bay", False)):
        trace, R = _fake_trace(circuit, reverse=rev)
        out = sectors.sector_paths(outline_points(circuit), trace)
        assert out is not None, circuit
        assert out["fit"] < 0.02, (circuit, out["fit"])
        assert all(p.startswith("M") for p in out["paths"])
        # the start/finish point lands where the trace started
        assert np.hypot(*(np.asarray(out["start"]) - R[0])) < 3.0, circuit
        # sector lengths in the same proportion as the trace's
        lens = [len(p.split(" L")) for p in out["paths"]]
        assert lens[0] > lens[1] < lens[2]


def test_wrong_track_is_rejected():
    trace, _ = _fake_trace("monza")
    assert sectors.sector_paths(outline_points("marina-bay"), trace) is None


def test_fetch_session_parses_openf1(tmp_path, monkeypatch):
    t0 = datetime(2025, 9, 6, 14, 30, tzinfo=timezone.utc)
    laps = [
        {"driver_number": 1, "lap_duration": 79.0, "duration_sector_1": 26.0, "duration_sector_2": 27.0, "duration_sector_3": 26.0,
         "st_speed": 340, "date_start": t0.isoformat()},
        {"driver_number": 1, "lap_duration": 79.5, "duration_sector_1": 25.8, "duration_sector_2": 27.5, "duration_sector_3": 26.2,
         "st_speed": 345, "date_start": (t0 + timedelta(minutes=3)).isoformat()},
        {"driver_number": 16, "lap_duration": 79.2, "duration_sector_1": 26.1, "duration_sector_2": 26.9, "duration_sector_3": 26.2,
         "st_speed": None, "date_start": t0.isoformat()},
        {"driver_number": 16, "lap_duration": None, "duration_sector_1": 25.9, "duration_sector_2": None, "duration_sector_3": None,
         "date_start": t0.isoformat()},  # aborted lap: still a sector time
    ]
    loc = [{"date": (t0 + timedelta(seconds=i * 0.5)).isoformat(), "x": float(np.cos(i / 25)), "y": float(np.sin(i / 25))} for i in range(158)]
    calls = []

    def get(endpoint, raw="", **params):
        calls.append((endpoint, raw, params))
        if endpoint == "sessions":
            return [{"meeting_key": 7, "session_key": 99, "session_name": "Qualifying", "date_start": "2025-09-06T14:00:00+00:00", "date_end": "2025-09-06T15:00:00+00:00"},
                    {"meeting_key": 7, "session_key": 100, "session_name": "Race", "date_start": "2025-09-07T13:00:00+00:00", "date_end": "2025-09-07T15:00:00+00:00"}]
        return {"laps": laps, "drivers": [{"driver_number": 1, "name_acronym": "VER", "full_name": "Max VERSTAPPEN", "team_name": "Red Bull Racing"}],
                "location": loc}[endpoint]

    d = sectors.fetch_session("2025-16-italy", 2025, date(2025, 9, 7), {1: "max-verstappen", 16: "charles-leclerc"}, get)
    by = {x["driver"]: x for x in d["drivers"]}
    assert by["max-verstappen"]["s1"] == 25.8 and by["max-verstappen"]["lap"] == 79.0 and by["max-verstappen"]["speed"] == 345
    assert by["charles-leclerc"]["s1"] == 25.9 and by["charles-leclerc"]["s2"] == 26.9
    # trace of the fastest lap (Verstappen, 79.0 s) split at 26.0 s and 53.0 s
    assert d["trace"]["driver"] == "max-verstappen"
    labels = [p[2] for p in d["trace"]["points"]]
    assert labels[0] == 1 and labels[-1] == 3 and labels.count(1) == 52 and labels.count(2) == 54
    raw = [c[1] for c in calls if c[0] == "location"][0]
    assert raw.startswith("date>=2025-09-06T14:30:00") and "+" not in raw

    monkeypatch.setattr(sectors, "SECTOR_DIR", tmp_path)
    sectors.save(d)
    assert sectors.load("2025-16-italy")["session_key"] == 99 and sectors.version() > 0


def test_paced_requests_and_rate_limit_handling(tmp_path, monkeypatch):
    import urllib.error

    import pandas as pd

    monkeypatch.setattr(sectors, "SECTOR_DIR", tmp_path)
    clock = {"t": 0.0}
    sleeps = []

    def sleep(s):
        sleeps.append(s)
        clock["t"] += s

    calls = []

    def get(endpoint, raw="", **params):
        calls.append((endpoint, clock["t"]))
        clock["t"] += 0.1
        if endpoint == "sessions":
            return [{"meeting_key": m, "session_key": 10 + m, "session_name": n, "date_start": f"2024-0{m}-0{d}T14:00:00+00:00",
                     "date_end": f"2024-0{m}-0{d}T15:00:00+00:00"} for m in (1, 2) for n, d in (("Qualifying", 2), ("Race", 3))]
        if endpoint == "laps" and params["session_key"] == 11:
            raise urllib.error.HTTPError("u", 429, "Too Many Requests", {}, None)  # this session keeps failing
        if endpoint == "laps":
            return [{"driver_number": 1, "lap_duration": 80.0, "duration_sector_1": 26.0, "duration_sector_2": 27.0, "duration_sector_3": 27.0}]
        return []

    entries = pd.DataFrame({"race_key": ["2024-01-a", "2024-02-b"], "season": [2024, 2024], "date": ["2024-01-03", "2024-02-03"],
                            "driver_number": [1, 1], "driver_id": ["max-verstappen", "max-verstappen"]})
    paced = sectors.Paced(get, interval=2.2, sleep=sleep, clock=lambda: clock["t"])
    n = sectors.fetch_missing(entries, get=paced, sleep=sleep)
    assert n == 1 and (tmp_path / "2024-02-b.json").exists() and not (tmp_path / "2024-01-a.json").exists()
    assert [c[0] for c in calls].count("sessions") == 1  # the season's session list is fetched once
    gaps = [b[1] - a[1] for a, b in zip(calls, calls[1:])]
    assert min(gaps) >= 2.2 - 1e-9  # paced
    # OpenF1 refusing everything: stops after a few failures instead of crashing
    def refuse(endpoint, raw="", **params):
        raise urllib.error.HTTPError("u", 429, "Too Many Requests", {}, None)
    many = pd.DataFrame({"race_key": [f"2024-0{i}-x" for i in range(1, 7)], "season": [2024] * 6, "date": [f"2024-0{i}-03" for i in range(1, 7)],
                         "driver_number": [1] * 6, "driver_id": ["max-verstappen"] * 6})
    tried = []
    assert sectors.fetch_missing(many, get=lambda *a, **k: (tried.append(1), refuse(*a, **k))[1], sleep=lambda s: None, interval=0) == 0
    assert len(tried) == 3


def test_openf1_get_waits_on_429(monkeypatch):
    import io
    import urllib.error

    from f1qp import live

    waits, n = [], {"i": 0}

    def urlopen(url, timeout):
        n["i"] += 1
        if n["i"] < 3:
            raise urllib.error.HTTPError(url, 429, "Too Many Requests", {"Retry-After": "7"}, None)
        return io.BytesIO(b'[{"ok": 1}]')

    monkeypatch.setattr(live.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(live.time, "sleep", waits.append)
    assert live.openf1_get("laps", session_key=1) == [{"ok": 1}]
    assert waits == [7.0, 7.0]


def test_only_one_downloader(tmp_path, monkeypatch):
    import pandas as pd
    import pytest

    monkeypatch.setattr(sectors, "SECTOR_DIR", tmp_path)
    empty = pd.DataFrame({"race_key": [], "season": [], "date": [], "driver_number": [], "driver_id": []})
    with sectors._one_downloader():
        with pytest.raises(sectors.Busy):
            sectors.fetch_missing(empty, get=lambda *a, **k: [])
    assert sectors.fetch_missing(empty, get=lambda *a, **k: []) == 0  # free again

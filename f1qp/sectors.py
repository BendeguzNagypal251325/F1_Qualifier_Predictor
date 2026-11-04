"""Sector times (S1 / S2 / S3) of every qualifying session from OpenF1, and the sectors on the track map.

OpenF1 (https://openf1.org) publishes every lap's three sector times and speed-trap speed, and the cars'
positions, from 2023 on. For each qualifying session this module keeps each driver's best sectors, best
lap and top speed, plus the position trace of the session's fastest lap, in
``data/live/sectors/<race_key>.json``. The trace is fitted onto the track outline (rotation, scale, start
point and direction) so the outline can be drawn in its three real sectors.

    uv run f1qp-sectors            # download every missing session (2023 onwards)
    uv run f1qp-sectors --season 2026

The web server also fills in missing sessions slowly in the background (see ``SectorFetcher``).
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import threading
import time
from contextlib import contextmanager
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from .live import _parse_time, finished, openf1_get, weekend_sessions

log = logging.getLogger("f1qp.sectors")

ROOT = Path(__file__).resolve().parent.parent
SECTOR_DIR = Path(os.environ.get("F1QP_SECTOR_DIR", str(ROOT / "data" / "live" / "sectors")))
FIRST_SEASON = 2023  # OpenF1 has sector and position data from 2023


def _num(x) -> float | None:
    return float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) and x > 0 else None


def fetch_session(race_key: str, season: int, race_date: date, numbers: dict[int, str], get=openf1_get) -> dict | None:
    """Best sectors per driver for one qualifying session, or None if OpenF1 has no finished session."""
    q = weekend_sessions(season, race_date, get).get("Qualifying")
    if not finished(q):
        return None
    key = q["session_key"]
    laps = get("laps", session_key=key)
    if not laps:
        return None
    info = {d.get("driver_number"): d for d in get("drivers", session_key=key)}
    best: dict[int, dict] = {}
    fastest = None
    for lap in laps:
        n = lap.get("driver_number")
        secs = [_num(lap.get(f"duration_sector_{i}")) for i in (1, 2, 3)]
        lt, speed = _num(lap.get("lap_duration")), _num(lap.get("st_speed"))
        b = best.setdefault(n, {"s1": None, "s2": None, "s3": None, "lap": None, "speed": None})
        for i, s in enumerate(secs, start=1):
            if s is not None and (b[f"s{i}"] is None or s < b[f"s{i}"]):
                b[f"s{i}"] = s
        if lt is not None and (b["lap"] is None or lt < b["lap"]):
            b["lap"] = lt
        if speed is not None and (b["speed"] is None or speed > b["speed"]):
            b["speed"] = speed
        if lt is not None and all(s is not None for s in secs) and lap.get("date_start") and (fastest is None or lt < fastest["lap_duration"]):
            fastest = {**lap, "lap_duration": lt, "sectors": secs}
    drivers = []
    for n, b in best.items():
        d = info.get(n, {})
        drivers.append({"driver": numbers.get(int(n)) if n is not None else None, "number": n, "acronym": d.get("name_acronym"),
                        "name": d.get("full_name"), "team_name": d.get("team_name"), **b})
    trace = None
    if fastest:
        start = _parse_time(fastest["date_start"])
        end = start + timedelta(seconds=fastest["lap_duration"] + 0.3)
        fmt = "%Y-%m-%dT%H:%M:%S.%f"
        loc = get("location", raw=f"date>={start.strftime(fmt)}&date<={end.strftime(fmt)}",
                  session_key=key, driver_number=fastest["driver_number"])
        t1 = start + timedelta(seconds=fastest["sectors"][0])
        t2 = t1 + timedelta(seconds=fastest["sectors"][1])
        pts = []
        for p in loc:
            t = _parse_time(p.get("date"))
            x, y = p.get("x"), p.get("y")
            if t is None or x is None or y is None:
                continue
            pts.append([float(x), float(y), 1 if t < t1 else 2 if t < t2 else 3])
        if len(pts) >= 30:
            trace = {"driver": numbers.get(int(fastest["driver_number"])), "points": pts}
    return {"race_key": race_key, "session_key": key, "drivers": drivers, "trace": trace}


# ---------------------------------------------------------------- files

def path_for(race_key: str) -> Path:
    return SECTOR_DIR / f"{race_key}.json"


def load(race_key: str) -> dict | None:
    p = path_for(race_key)
    try:
        return json.loads(p.read_text()) if p.exists() else None
    except (OSError, ValueError):
        return None


def version() -> float:
    """Changes whenever a session is added (used in the API response cache key)."""
    try:
        return max((p.stat().st_mtime for p in SECTOR_DIR.glob("*.json")), default=0.0)
    except OSError:
        return 0.0


def missing_sessions(entries: pd.DataFrame, season: int | None = None) -> list[tuple[str, int, date, dict[int, str]]]:
    """(race_key, season, race date, driver_number -> driver_id) of qualifying sessions without a file."""
    rows = entries[entries["season"] >= FIRST_SEASON]
    if season is not None:
        rows = rows[rows["season"] == season]
    out = []
    for key, g in rows.groupby("race_key"):
        if path_for(key).exists():
            continue
        numbers = {int(n): d for n, d in zip(g["driver_number"], g["driver_id"]) if pd.notna(n)}
        out.append((key, int(g["season"].iloc[0]), pd.Timestamp(g["date"].iloc[0]).date(), numbers))
    return sorted(out)


def save(data: dict) -> None:
    SECTOR_DIR.mkdir(parents=True, exist_ok=True)
    tmp = path_for(data["race_key"]).with_suffix(".tmp")
    tmp.write_text(json.dumps(data, separators=(",", ":")))
    tmp.replace(path_for(data["race_key"]))


class Paced:
    """Wraps an OpenF1 getter: at most one request every ``interval`` seconds (OpenF1's free tier allows
    about 30 a minute), and the season's session list fetched once instead of once per race."""

    def __init__(self, get, interval: float = 2.2, sleep=time.sleep, clock=time.monotonic):
        self.get, self.interval, self.sleep, self.clock = get, interval, sleep, clock
        self.last = -1e9
        self.seasons: dict[int, list] = {}

    def __call__(self, endpoint: str, **params):
        if endpoint == "sessions" and set(params) == {"year"} and params["year"] in self.seasons:
            return self.seasons[params["year"]]
        wait = self.last + self.interval - self.clock()
        if wait > 0:
            self.sleep(wait)
        try:
            out = self.get(endpoint, **params)
        finally:
            self.last = self.clock()
        if endpoint == "sessions" and set(params) == {"year"}:
            self.seasons[params["year"]] = out
        return out


class Busy(RuntimeError):
    """Another downloader (the web server's background one, or a second command) is already running."""


@contextmanager
def _one_downloader():
    """Only one downloader at a time: two would together exceed OpenF1's rate limit."""
    SECTOR_DIR.mkdir(parents=True, exist_ok=True)
    with open(SECTOR_DIR / ".download.lock", "a+") as f:
        try:
            import fcntl
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except ImportError:  # Windows without Docker: no lock, just go ahead
            pass
        except OSError as e:
            raise Busy("another sector download is already running") from e
        yield


def fetch_missing(entries: pd.DataFrame, season: int | None = None, get=openf1_get, stop: threading.Event | None = None,
                  interval: float = 2.2, sleep=time.sleep, max_failures: int = 3) -> int:
    with _one_downloader():
        return _fetch_missing(entries, season, get, stop, interval, sleep, max_failures)


def _fetch_missing(entries, season, get, stop, interval, sleep, max_failures) -> int:
    """Download every missing session; returns how many were saved.

    Requests are paced to stay within OpenF1's rate limit. A session that still fails (rate limit,
    network) is skipped and picked up by the next run; after ``max_failures`` failures in a row the run
    stops, since OpenF1 is then unavailable for a while."""
    paced = get if isinstance(get, Paced) else Paced(get, interval, sleep)
    saved = failures = 0
    for key, yr, day, numbers in missing_sessions(entries, season):
        if stop is not None and stop.is_set():
            break
        if day > date.today():
            continue
        try:
            data = fetch_session(key, yr, day, numbers, paced)
        except Exception as e:  # noqa: BLE001 - any OpenF1 / network problem: skip, retry next run
            failures += 1
            log.warning("sectors: %s skipped (%s)", key, _why(e))
            if failures >= max_failures:
                log.warning("sectors: OpenF1 keeps refusing; stopping for now. Run again later to fetch the rest.")
                break
            sleep(30 * failures)
            continue
        failures = 0
        if data:
            save(data)
            saved += 1
            log.info("sectors: saved %s", key)
    return saved


def _why(e: Exception) -> str:
    code = getattr(e, "code", None)
    return "rate limit, too many requests" if code == 429 else f"HTTP {code}" if code else type(e).__name__


class SectorFetcher:
    """Background thread: fills in missing sessions, then checks again every few hours."""

    def __init__(self, entries_fn, interval_s: float = 6 * 3600, get=openf1_get):
        self.entries_fn, self.interval_s, self.get = entries_fn, interval_s, get
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self._run, name="sectors", daemon=True)

    def start(self):
        self.thread.start()

    def _run(self):
        while not self.stop.is_set():
            try:
                fetch_missing(self.entries_fn(), get=self.get, stop=self.stop)
            except Busy:
                pass  # someone runs `f1qp-sectors` right now; try again next round
            except Exception as e:  # network down or OpenF1 unavailable: try again later
                log.info("sectors: OpenF1 not reachable (%s); retrying later", type(e).__name__)
            self.stop.wait(self.interval_s)


# ---------------------------------------------------------------- the sectors on the track outline

def _resample(P: np.ndarray, n: int, closed: bool) -> tuple[np.ndarray, np.ndarray]:
    """n points evenly spaced along a polyline; also returns the arc-length position (0..1) of each input point."""
    Q = np.vstack([P, P[:1]]) if closed else P
    seg = np.linalg.norm(np.diff(Q, axis=0), axis=1)
    s = np.r_[0, np.cumsum(seg)]
    t = np.linspace(0, s[-1], n, endpoint=not closed)
    out = np.c_[np.interp(t, s, Q[:, 0]), np.interp(t, s, Q[:, 1])]
    return out, s[: len(P)] / s[-1]


def _normalise(P: np.ndarray) -> np.ndarray:
    P = P - P.mean(0)
    return P / np.sqrt((P ** 2).sum(1).mean())


def sector_paths(outline: list[tuple[float, float]], trace: list[list[float]], n: int = 240) -> dict | None:
    """Fit the lap trace onto the outline; returns the outline split into its three sectors as SVG paths."""
    Pout = np.asarray(outline, dtype=float)
    T = np.asarray(trace, dtype=float)
    if len(Pout) < 10 or len(T) < 30:
        return None
    Ro, _ = _resample(Pout, n, closed=True)
    Rt, pos = _resample(T[:, :2], n, closed=False)
    # sector of each resampled trace point (from the sector of the raw samples around it)
    lab = T[:, 2].astype(int)
    tt = np.linspace(0, 1, n)
    sec = lab[np.clip(np.searchsorted(pos, tt, side="right") - 1, 0, len(lab) - 1)]
    A = _normalise(Rt)
    best = None
    for mirror in (False, True):
        B0 = _normalise(Ro * ([1, -1] if mirror else [1, 1]))
        for direction in (1, -1):
            for shift in range(n):
                idx = (shift + direction * np.arange(n)) % n
                B = B0[idx]
                # best rotation of the trace onto this outline order (orthogonal Procrustes, no reflection)
                U, S, Vt = np.linalg.svd(A.T @ B)
                d = np.sign(np.linalg.det(U @ Vt))
                R = U @ np.diag([1, d]) @ Vt
                err = ((A @ R - B) ** 2).sum(1).mean()
                if best is None or err < best[0]:
                    best = (err, idx, direction)
    err, idx, direction = best
    if err > 0.08:  # the trace does not match this outline (layout change, bad data)
        return None
    paths = {1: [], 2: [], 3: []}
    for i in range(n):
        paths[int(sec[i])].append(idx[i])
    out = []
    for k in (1, 2, 3):
        ids = paths[k]
        if not ids:
            out.append("")
            continue
        # contiguous run along the outline, plus the next point so the sectors join up
        ids = ids + [(ids[-1] + direction) % n]
        out.append("M" + " L".join(f"{Ro[j, 0]:.1f},{Ro[j, 1]:.1f}" for j in ids))
    return {"paths": out, "start": [round(float(Ro[idx[0], 0]), 1), round(float(Ro[idx[0], 1]), 1)], "fit": round(float(err), 4)}


def main() -> None:
    from .data import load_entries

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--season", type=int)
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        n = fetch_missing(load_entries(), a.season)
    except Busy:
        print("The app is already downloading sector times in the background (watch its log for 'sectors: saved').\n"
              "Wait for it to finish, or run this again in a few minutes.")
        return
    left = len([m for m in missing_sessions(load_entries(), a.season) if m[2] <= date.today()])
    print(f"saved {n} session(s) to {SECTOR_DIR}" + (f"; {left} still missing (OpenF1 had no data or refused). Run again later." if left else "; all sessions done."))


if __name__ == "__main__":
    main()

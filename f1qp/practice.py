"""Practice lap data from OpenF1 (2023 onwards): best sectors and tyre compound per driver and session.

For every free-practice session (FP1-FP3) this keeps, per driver: the best time in each sector, the
best lap, the "ideal lap" (best S1 + best S2 + best S3, from any laps), and the same on soft tyres only.
Laps out of the pit lane are skipped. One file per race weekend in ``data/live/practice/<race_key>.json``.
Used to test whether a cleaner practice pace (no traffic, no mistakes) predicts qualifying better.

    uv run python -m f1qp.practice              # download every missing weekend (resumes where it stopped)
    uv run python -m f1qp.practice --season 2026

Requests are paced to OpenF1's free limit (about 30 a minute), so a full download takes 20-30 minutes.
"""

from __future__ import annotations

import argparse
import json
import logging
import time
from datetime import date
from pathlib import Path

import pandas as pd

from .live import finished, openf1_get, weekend_sessions
from .sectors import FIRST_SEASON, SECTOR_DIR, Busy, Paced, _num, _one_downloader

log = logging.getLogger("f1qp.practice")

PRACTICE_DIR = SECTOR_DIR.parent / "practice"
SESSIONS = ("Practice 1", "Practice 2", "Practice 3")


def _best(laps: list[tuple[list[float | None], float | None]]) -> dict:
    """Best sectors, best lap and ideal lap from (sectors, lap time) pairs."""
    out: dict = {"s1": None, "s2": None, "s3": None, "lap": None, "laps": len(laps)}
    for secs, lt in laps:
        for i, s in enumerate(secs, start=1):
            if s is not None and (out[f"s{i}"] is None or s < out[f"s{i}"]):
                out[f"s{i}"] = s
        if lt is not None and (out["lap"] is None or lt < out["lap"]):
            out["lap"] = lt
    out["ideal"] = round(out["s1"] + out["s2"] + out["s3"], 3) if None not in (out["s1"], out["s2"], out["s3"]) else None
    return out


def session_summary(session_key: int, numbers: dict[int, str], get=openf1_get) -> dict[str, dict] | None:
    """driver_id -> {all: best/ideal on any tyre, soft: the same on soft tyres only}."""
    laps = get("laps", session_key=session_key)
    if not laps:
        return None
    stints = get("stints", session_key=session_key)
    compound: dict[tuple[int, int], str] = {}
    for s in stints:
        for lap in range(int(s.get("lap_start") or 0), int(s.get("lap_end") or 0) + 1):
            compound[(s.get("driver_number"), lap)] = str(s.get("compound") or "").upper()
    per: dict[int, dict[str, list]] = {}
    for lap in laps:
        if lap.get("is_pit_out_lap"):
            continue
        n = lap.get("driver_number")
        secs = [_num(lap.get(f"duration_sector_{i}")) for i in (1, 2, 3)]
        item = (secs, _num(lap.get("lap_duration")))
        d = per.setdefault(n, {"all": [], "soft": []})
        d["all"].append(item)
        if compound.get((n, lap.get("lap_number"))) == "SOFT":
            d["soft"].append(item)
    return {numbers.get(int(n), str(n)): {"all": _best(d["all"]), "soft": _best(d["soft"])}
            for n, d in per.items() if n is not None}


def fetch_weekend(race_key: str, season: int, race_date: date, numbers: dict[int, str], get=openf1_get) -> dict | None:
    sessions = weekend_sessions(season, race_date, get)
    out = {}
    for name in SESSIONS:
        s = sessions.get(name)
        if finished(s):
            summary = session_summary(s["session_key"], numbers, get)
            if summary:
                out[name] = summary
    return {"race_key": race_key, "sessions": out} if out else None


def path_for(race_key: str) -> Path:
    return PRACTICE_DIR / f"{race_key}.json"


def missing(entries: pd.DataFrame, season: int | None = None) -> list[tuple[str, int, date, dict[int, str]]]:
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


def fetch_missing(entries: pd.DataFrame, season: int | None = None, get=openf1_get) -> int:
    paced, saved = Paced(get), 0
    todo = [m for m in missing(entries, season) if m[2] <= date.today()]
    with _one_downloader():
        for i, (key, yr, day, numbers) in enumerate(todo, start=1):
            started = time.monotonic()
            try:
                data = fetch_weekend(key, yr, day, numbers, paced)
            except Exception as e:  # network trouble or OpenF1 refusing: skip, the next run retries it
                log.warning("practice: %s failed (%s)", key, e)
                continue
            if data:
                PRACTICE_DIR.mkdir(parents=True, exist_ok=True)
                path_for(key).write_text(json.dumps(data, separators=(",", ":")))
                saved += 1
            log.info("practice: %d/%d %s %s (%.0fs)", i, len(todo), key, "saved" if data else "no data", time.monotonic() - started)
    return saved


def main() -> None:
    from .data import load_entries

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--season", type=int)
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        n = fetch_missing(load_entries(), a.season)
    except Busy:
        print("Another download (the app's sector downloader) is running. Stop the app or wait, then run this again.")
        return
    left = len([m for m in missing(load_entries(), a.season) if m[2] <= date.today()])
    print(f"saved {n} weekend(s) to {PRACTICE_DIR}" + (f"; {left} still missing. Run again to retry them." if left else "; all done."))


if __name__ == "__main__":
    main()

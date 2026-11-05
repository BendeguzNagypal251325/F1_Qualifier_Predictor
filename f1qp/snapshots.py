"""Frozen live predictions: a verifiable record that each prediction existed before qualifying.

After each finished practice session the web server writes the live prediction (with Q3 chances and a UTC
timestamp) to ``data/live/snapshots/<race_key>/<fp1|fp2|fp3>.json``, on the same named volume as the
other live data. Files are write-once: an existing file is never replaced, and no file is written once
OpenF1's qualifying start time has passed. The Track record page compares them with the real results.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from .data import ROOT
from .live import _parse_time

log = logging.getLogger("f1qp.snapshots")

SNAP_DIR = Path(os.environ.get("F1QP_SNAPSHOT_DIR", str(ROOT / "data" / "live" / "snapshots")))
PRACTICE = {"Practice 1": "fp1", "Practice 2": "fp2", "Practice 3": "fp3"}
ORDER = list(PRACTICE.values())


def freeze(snap: dict | None, now: datetime | None = None) -> Path | None:
    """Save the prediction made after the newest finished practice session; returns the new file or None.

    Never overwrites an existing snapshot, and refuses (with a log message) once qualifying has started or
    when its start time is unknown.
    """
    if not snap or not snap.get("rows"):
        return None
    practice = [s for s in snap.get("sessions_used", []) if s in PRACTICE]
    if not practice:
        return None  # before FP1: nothing to freeze yet
    session = PRACTICE[practice[-1]]
    path = SNAP_DIR / snap["race_key"] / f"{session}.json"
    if path.exists():
        return None  # already frozen (the normal case on every later refresh)
    now = now or datetime.now(timezone.utc)
    quali = _parse_time(snap.get("qualifying_start"))
    where = f"{snap['race_key']}/{session}"
    if quali is None:
        log.warning("snapshot %s not saved: the qualifying start time is unknown", where)
        return None
    if snap.get("qualifying_done") or now >= quali:
        log.warning("snapshot %s refused: qualifying started at %s (now %s)", where, quali.isoformat(), now.isoformat(timespec="seconds"))
        return None
    data = {
        "race_key": snap["race_key"], "season": snap.get("season"), "round": snap.get("round"),
        "grand_prix": snap.get("grand_prix"), "circuit": snap.get("circuit"), "date": snap.get("date"),
        "session": session, "after": practice[-1], "sessions_used": snap.get("sessions_used", []), "model": snap.get("model"),
        "created_at": now.astimezone(timezone.utc).isoformat(timespec="seconds"),
        "qualifying_start": quali.astimezone(timezone.utc).isoformat(timespec="seconds"),
        "rows": [{"pred_pos": r["pred_pos"], "driver_id": r["driver_id"], "constructor_id": r.get("constructor_id"),
                  "q3_prob": r.get("q3_prob")} for r in snap["rows"]],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    # write to a temporary file, then hard-link it into place: the link fails if the file exists, so a
    # snapshot can never be replaced, even by two writers at once
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=1)
        os.link(tmp, path)
    except FileExistsError:
        return None
    finally:
        os.unlink(tmp)
    log.info("snapshot %s frozen at %s", where, data["created_at"])
    return path


def load_race(race_key: str) -> list[dict]:
    """The race's snapshots, FP1 first."""
    d = SNAP_DIR / race_key
    out = []
    for name in ORDER:
        p = d / f"{name}.json"
        if p.exists():
            try:
                out.append(json.loads(p.read_text()))
            except (OSError, ValueError):
                log.warning("snapshot %s is unreadable; skipped", p)
    return out


def races() -> list[str]:
    try:
        return sorted(p.name for p in SNAP_DIR.iterdir() if p.is_dir() and any(p.glob("fp*.json")))
    except OSError:
        return []


def version() -> float:
    """Changes whenever a snapshot is added (used in the API response cache key)."""
    try:
        return max((p.stat().st_mtime for p in SNAP_DIR.glob("*/fp*.json")), default=0.0)
    except OSError:
        return 0.0


def score(rows: list[dict], actual: dict[str, int]) -> dict | None:
    """Correct Q3 picks of a frozen prediction against the real qualifying result (driver -> position)."""
    if not actual:
        return None
    picked = {r["driver_id"] for r in rows if r["pred_pos"] <= 10}
    q3 = {d for d, pos in actual.items() if pos <= 10}
    return {"correct": len(picked & q3), "missed": sorted(picked - q3), "surprises": sorted(q3 - picked)}

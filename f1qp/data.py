"""Download the open F1DB dataset and flatten it into one row per driver per qualifying session.

Source: https://github.com/f1db/f1db (CC BY 4.0). Only the season folders we need are
fetched, via a sparse, blob-less git clone, so the download stays small.

Every column in the output table is something that is known *before* qualifying starts
(practice results, standings after the previous round) except the target columns
(``quali_pos``, ``quali_status``, ``q1_s``/``q2_s``/``q3_s``).
"""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

from . import HISTORY_SEASONS

F1DB_REPO = "https://github.com/f1db/f1db"
ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw" / "f1db"
ENTRIES_CSV = ROOT / "data" / "qualifying_entries.csv"


def fetch_f1db(dest: Path = RAW_DIR, seasons: list[int] = HISTORY_SEASONS) -> Path:
    """Sparse-clone (or update) F1DB with only the requested season folders."""
    paths = [f"src/data/seasons/{s}" for s in seasons]
    if not (dest / ".git").exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["git", "clone", "--depth", "1", "--filter=blob:none", "--sparse", F1DB_REPO, str(dest)],
            check=True,
        )
    else:
        subprocess.run(["git", "-C", str(dest), "pull", "--ff-only", "-q"], check=True)
    subprocess.run(["git", "-C", str(dest), "sparse-checkout", "set", *paths], check=True)
    return dest / "src" / "data" / "seasons"


def parse_laptime(value) -> float:
    """'1:29.179' -> 89.179 seconds; empty -> NaN."""
    if value is None or value == "":
        return np.nan
    text = str(value)
    if ":" in text:
        minutes, seconds = text.split(":", 1)
        return int(minutes) * 60 + float(seconds)
    return float(text)


def _load(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open() as fh:
        return yaml.safe_load(fh) or []


def _practice(race_dir: Path, n: int) -> dict[str, tuple[float, float]]:
    """driverId -> (position, gap to session-fastest in %) for free practice ``n``."""
    rows = _load(race_dir / f"free-practice-{n}-results.yml")
    times = {r["driverId"]: parse_laptime(r.get("time")) for r in rows}
    valid = [t for t in times.values() if not np.isnan(t)]
    best = min(valid) if valid else np.nan
    out = {}
    for r in rows:
        pos = r.get("position")
        pos = float(pos) if isinstance(pos, int) else np.nan
        t = times[r["driverId"]]
        gap = (t - best) / best * 100 if not np.isnan(t) and best else np.nan
        out[r["driverId"]] = (pos, gap)
    return out


def _standings(race_dir: Path | None, kind: str) -> dict[str, tuple[float, float]]:
    """id -> (championship position, points) after the race in ``race_dir``."""
    if race_dir is None:
        return {}
    key = "driverId" if kind == "driver" else "constructorId"
    out = {}
    for r in _load(race_dir / f"{kind}-standings.yml"):
        pos = r.get("position")
        out[r[key]] = (float(pos) if isinstance(pos, int) else np.nan, float(r.get("points") or 0))
    return out


def build_entries(seasons_dir: Path, seasons: list[int] = HISTORY_SEASONS) -> pd.DataFrame:
    records = []
    for season in seasons:
        race_dirs = sorted((seasons_dir / str(season) / "races").iterdir())
        prev_dir = None
        for race_dir in race_dirs:
            race = _load(race_dir / "race.yml")
            quali = _load(race_dir / "qualifying-results.yml")
            if not quali:
                prev_dir = race_dir
                continue
            fp = {n: _practice(race_dir, n) for n in (1, 2, 3)}
            d_stand = _standings(prev_dir, "driver")
            c_stand = _standings(prev_dir, "constructor")
            sprint = (race_dir / "sprint-race-results.yml").exists()
            # F1DB lists qualifying rows in classification order (NC/DSQ/EX at the end),
            # so row order gives a complete 1..N ranking.
            for rank, r in enumerate(quali, start=1):
                drv, con = r["driverId"], r["constructorId"]
                q = [parse_laptime(r.get(k)) for k in ("q1", "q2", "q3")]
                rec = {
                    "season": season,
                    "round": int(race["round"]),
                    "race_key": f"{season}-{race_dir.name}",
                    "date": str(race["date"]),
                    "grand_prix": race["grandPrixId"],
                    "circuit": race["circuitId"],
                    "circuit_type": race.get("circuitType"),
                    "qualifying_format": race.get("qualifyingFormat"),
                    "sprint_weekend": sprint,
                    "driver_id": drv,
                    "driver_number": r.get("driverNumber"),
                    "constructor_id": con,
                    "engine": r.get("engineManufacturerId"),
                    "quali_status": str(r.get("position")),
                    "quali_pos": rank,
                    "q1_s": q[0],
                    "q2_s": q[1],
                    "q3_s": q[2],
                    "driver_champ_pos_before": d_stand.get(drv, (np.nan, np.nan))[0],
                    "driver_points_before": d_stand.get(drv, (np.nan, np.nan))[1],
                    "constructor_champ_pos_before": c_stand.get(con, (np.nan, np.nan))[0],
                    "constructor_points_before": c_stand.get(con, (np.nan, np.nan))[1],
                }
                for n in (1, 2, 3):
                    pos, gap = fp[n].get(drv, (np.nan, np.nan))
                    rec[f"fp{n}_pos"] = pos
                    rec[f"fp{n}_gap_pct"] = gap
                records.append(rec)
            prev_dir = race_dir
    df = pd.DataFrame.from_records(records)
    df["top10"] = (df["quali_pos"] <= 10).astype(int)
    return df.sort_values(["season", "round", "quali_pos"]).reset_index(drop=True)


LIVE_DIR = ROOT / "data" / "live"


def load_entries(path: Path = ENTRIES_CSV, include_live: bool = True) -> pd.DataFrame:
    """F1DB entries, plus live weekends (from ``f1qp-live``) that F1DB does not have yet.

    A live weekend is only added once its qualifying is done, so it can be used for training.
    """
    df = pd.read_csv(path)
    if include_live and LIVE_DIR.exists():
        known = set(df["race_key"])
        extra = [pd.read_csv(f) for f in sorted(LIVE_DIR.glob("*.csv"))]
        extra = [e for e in extra if len(e) and e["race_key"].iloc[0] not in known and e["quali_pos"].notna().all()]
        if extra:
            df = pd.concat([df, *extra], ignore_index=True)
            df = df.sort_values(["season", "round", "quali_pos"]).reset_index(drop=True)
    return df


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ENTRIES_CSV)
    parser.add_argument("--seasons-dir", type=Path, help="Use an existing F1DB checkout instead of cloning")
    args = parser.parse_args()
    seasons_dir = args.seasons_dir or fetch_f1db()
    df = build_entries(seasons_dir)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.out, index=False)
    print(f"Wrote {len(df)} rows ({df['race_key'].nunique()} qualifying sessions) to {args.out}")


if __name__ == "__main__":
    main()

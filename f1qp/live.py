"""Predict the next qualifying with live data from the current weekend.

Run it again after every session (FP1, FP2, FP3, qualifying):

    uv run f1qp-live                  # next race of the current season
    uv run f1qp-live --race 21        # a specific round (or name, e.g. --race las-vegas)
    uv run f1qp-live --no-update      # skip the F1DB download (faster, uses data/qualifying_entries.csv)

What it does:
  1. Updates the history from F1DB (all finished race weekends) and rebuilds the data file.
  2. Downloads the results of every finished session of this weekend from the free OpenF1 API
     (https://openf1.org). OpenF1's free API has a session's data once the session has ended.
  3. Predicts the qualifying order with everything known right now:
       * before FP1: the pre-weekend model (form, standings, track history; no practice),
       * after each practice session: the full model, with the newest practice results.
  4. After qualifying: shows the real result next to the prediction and saves the weekend in
     ``data/live/``. That weekend is then used for training, even before F1DB has it, so the
     next race's prediction already includes it.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

from . import CURRENT_SEASON, HISTORY_SEASONS
from . import model as M
from .data import ENTRIES_CSV, LIVE_DIR, RAW_DIR, _standings, build_entries, fetch_f1db, load_entries
from .features import build_features

OPENF1 = "https://api.openf1.org/v1"

# OpenF1 team names -> F1DB constructor ids. Unknown names fall back to the driver's last F1DB team.
TEAM_IDS = {
    "red bull racing": "red-bull",
    "ferrari": "ferrari",
    "mercedes": "mercedes",
    "mclaren": "mclaren",
    "aston martin": "aston-martin",
    "alpine": "alpine",
    "williams": "williams",
    "haas f1 team": "haas",
    "haas": "haas",
    "racing bulls": "racing-bulls",
    "rb": "rb",
    "kick sauber": "kick-sauber",
    "audi": "audi",
    "cadillac": "cadillac",
}

COLUMNS = [
    "season", "round", "race_key", "date", "grand_prix", "circuit", "circuit_type", "qualifying_format",
    "sprint_weekend", "driver_id", "driver_number", "constructor_id", "engine", "quali_status", "quali_pos",
    "q1_s", "q2_s", "q3_s", "driver_champ_pos_before", "driver_points_before", "constructor_champ_pos_before",
    "constructor_points_before", "fp1_pos", "fp1_gap_pct", "fp2_pos", "fp2_gap_pct", "fp3_pos", "fp3_gap_pct", "top10",
]


# ---------------------------------------------------------------- OpenF1 ----------------------------------------------


def openf1_get(endpoint: str, raw: str = "", **params) -> list[dict]:
    """GET an OpenF1 endpoint; retries a few times on rate limits / network errors.

    ``raw`` is appended to the query as-is, for OpenF1's comparison filters (``date>=...``), which must
    not be URL-encoded."""
    url = f"{OPENF1}/{endpoint}?{urllib.parse.urlencode(params)}" + (f"&{raw}" if raw else "")
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=30) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 404:  # OpenF1 answers 404 when there is no data yet
                return []
            if attempt == 3:
                raise
            if e.code == 429:  # rate limited: wait as long as OpenF1 asks (or a growing pause)
                time.sleep(_retry_after(e, default=15 * (attempt + 1)))
                continue
        except urllib.error.URLError:
            if attempt == 3:
                raise
        time.sleep(2 * (attempt + 1))
    return []


def _retry_after(e: urllib.error.HTTPError, default: float) -> float:
    try:
        return min(120.0, max(1.0, float(e.headers.get("Retry-After", default))))
    except (TypeError, ValueError):
        return default


def _parse_time(text: str | None) -> datetime | None:
    if not text:
        return None
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def weekend_sessions(season: int, race_date: date, get=openf1_get) -> dict[str, dict]:
    """OpenF1 sessions of the meeting whose race is on ``race_date`` (±1 day), by session name."""
    sessions = get("sessions", year=season)
    meetings = {}
    for s in sessions:
        meetings.setdefault(s["meeting_key"], []).append(s)
    for items in meetings.values():
        for s in items:
            start = _parse_time(s.get("date_start"))
            if s.get("session_name") == "Race" and start and abs((start.date() - race_date).days) <= 1:
                return {x["session_name"]: x for x in items}
    return {}


def finished(session: dict | None, now: datetime | None = None) -> bool:
    if not session:
        return False
    end = _parse_time(session.get("date_end"))
    return end is not None and end < (now or datetime.now(timezone.utc))


def _num(x) -> float:
    return float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) else np.nan


def practice_results(session_key: int, get=openf1_get) -> dict[int, tuple[float, float]]:
    """driver_number -> (position, gap to fastest lap in %)."""
    rows = get("session_result", session_key=session_key)
    times = {r["driver_number"]: _num(r.get("duration")) for r in rows}
    valid = [t for t in times.values() if not np.isnan(t)]
    best = min(valid) if valid else np.nan
    return {
        r["driver_number"]: (_num(r.get("position")), (times[r["driver_number"]] - best) / best * 100 if valid else np.nan)
        for r in rows
    }


def quali_results(session_key: int, get=openf1_get) -> list[dict]:
    """Qualifying classification in order: driver_number, status, q1/q2/q3 in seconds."""
    rows = get("session_result", session_key=session_key)
    rows = sorted(rows, key=lambda r: (r.get("position") is None, r.get("position") or 99))
    out = []
    for r in rows:
        dur = r.get("duration")
        q = list(dur) if isinstance(dur, list) else [dur, None, None]
        q = (q + [None, None, None])[:3]
        status = str(r["position"]) if r.get("position") else ("DSQ" if r.get("dsq") else "NC")
        out.append({"driver_number": r["driver_number"], "status": status, "q": [_num(x) for x in q]})
    return out


def lineup(session_key: int, get=openf1_get) -> dict[int, dict]:
    return {d["driver_number"]: d for d in get("drivers", session_key=session_key)}


# ---------------------------------------------------------------- F1DB calendar ---------------------------------------


def seasons_dir() -> Path:
    return RAW_DIR / "src" / "data" / "seasons"


def find_race_dir(season_dir: Path, race: str | None) -> Path:
    """The requested round/name, or the first race of the season without a qualifying result."""
    dirs = sorted((season_dir / "races").iterdir())
    if race:
        key = race.lower().replace(" ", "-")
        match = [d for d in dirs if (key.isdigit() and int(d.name[:2]) == int(key)) or key in d.name]
        if len(match) != 1:
            raise SystemExit(f"Could not identify '{race}'. Options: {', '.join(d.name for d in dirs)}")
        return match[0]
    for d in dirs:
        if (d / "qualifying-results.yml").exists():
            continue  # F1DB already has this qualifying
        live = LIVE_DIR / f"{season_dir.name}-{d.name}.csv"
        if live.exists() and pd.read_csv(live)["quali_pos"].notna().all():
            continue  # qualifying already done (saved by an earlier live run)
        return d
    raise LiveUnavailable("No upcoming race left in this season. Live predictions start again with next season's first weekend.")


# ---------------------------------------------------------------- weekend table ---------------------------------------


def _slug(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def _driver_id(number: int, info: dict, past: pd.DataFrame, by_number: pd.DataFrame) -> str:
    """Match an OpenF1 driver to an F1DB driver id: by car number, else by surname, else a new slug."""
    last = _slug(str(info.get("last_name") or ""))
    if number in by_number.index:
        known = by_number.loc[number, "driver_id"]
        if not last or last in known:
            return known
    if last:
        same = past.loc[past["driver_id"].str.contains(rf"(?:^|-){re.escape(last)}(?:-|$)", regex=True), "driver_id"]
        if len(same):
            return same.iloc[-1]
    return _slug(f"{info.get('first_name', '')} {info.get('last_name', number)}")


def build_weekend(entries: pd.DataFrame, race_dir: Path, sessions: dict[str, dict], get=openf1_get,
                  now: datetime | None = None) -> tuple[pd.DataFrame, list[str]]:
    """One row per driver for this weekend, in the same format as data/qualifying_entries.csv.

    Returns the rows and the list of finished sessions that were used.
    """
    season = int(race_dir.parent.parent.name)
    race = yaml.safe_load((race_dir / "race.yml").read_text())
    dirs = sorted(race_dir.parent.iterdir())
    prev_dir = dirs[dirs.index(race_dir) - 1] if dirs.index(race_dir) > 0 else None
    d_stand, c_stand = _standings(prev_dir, "driver"), _standings(prev_dir, "constructor")

    done = [name for name in ("Practice 1", "Practice 2", "Practice 3", "Qualifying") if finished(sessions.get(name), now)]
    past = entries[entries["date"] < str(race["date"])].sort_values("date")

    # Who is driving: OpenF1 line-up of the newest finished session, else the last race's line-up.
    drivers: dict[int, dict] = {}
    for name in reversed(done):
        drivers = lineup(sessions[name]["session_key"], get)
        if drivers:
            break
    last_race = past[past["race_key"] == past["race_key"].iloc[-1]]
    if not drivers:
        drivers = {int(r.driver_number): {"driver_number": int(r.driver_number)} for r in last_race.itertuples()}

    by_number = past.dropna(subset=["driver_number"]).drop_duplicates("driver_number", keep="last").set_index("driver_number")
    rows = []
    for number, info in drivers.items():
        driver_id = _driver_id(number, info, past, by_number)
        team = TEAM_IDS.get(str(info.get("team_name", "")).lower())
        if team is None:
            prev = past.loc[past["driver_id"] == driver_id, "constructor_id"]
            team = prev.iloc[-1] if len(prev) else _slug(str(info.get("team_name", "unknown")))
        engine = last_race.loc[last_race["constructor_id"] == team, "engine"]
        rows.append({
            "season": season, "round": int(race["round"]), "race_key": f"{season}-{race_dir.name}",
            "date": str(race["date"]), "grand_prix": race["grandPrixId"], "circuit": race["circuitId"],
            "circuit_type": race.get("circuitType"), "qualifying_format": race.get("qualifyingFormat"),
            "sprint_weekend": "sprintRaceDate" in race, "driver_id": driver_id, "driver_number": number,
            "constructor_id": team, "engine": engine.iloc[0] if len(engine) else None,
            "driver_champ_pos_before": d_stand.get(driver_id, (np.nan, np.nan))[0],
            "driver_points_before": d_stand.get(driver_id, (np.nan, np.nan))[1],
            "constructor_champ_pos_before": c_stand.get(team, (np.nan, np.nan))[0],
            "constructor_points_before": c_stand.get(team, (np.nan, np.nan))[1],
        })
    df = pd.DataFrame(rows)

    for n in (1, 2, 3):
        res = practice_results(sessions[f"Practice {n}"]["session_key"], get) if f"Practice {n}" in done else {}
        df[f"fp{n}_pos"] = df["driver_number"].map(lambda x: res.get(x, (np.nan, np.nan))[0])
        df[f"fp{n}_gap_pct"] = df["driver_number"].map(lambda x: res.get(x, (np.nan, np.nan))[1])

    df["quali_status"], df["quali_pos"] = "", np.nan
    df["q1_s"] = df["q2_s"] = df["q3_s"] = np.nan
    if "Qualifying" in done:
        result = quali_results(sessions["Qualifying"]["session_key"], get)
        if result:
            order = {r["driver_number"]: (i + 1, r) for i, r in enumerate(result)}
            for i, row in df.iterrows():
                if row["driver_number"] in order:
                    pos, r = order[row["driver_number"]]
                    df.loc[i, ["quali_pos", "q1_s", "q2_s", "q3_s"]] = [pos, *r["q"]]
                    df.loc[i, "quali_status"] = r["status"]
        else:
            done.remove("Qualifying")
    df["top10"] = np.where(df["quali_pos"].notna(), (df["quali_pos"] <= 10).astype(float), np.nan)
    return df[COLUMNS], done


# ---------------------------------------------------------------- prediction ------------------------------------------


def predict_weekend(entries: pd.DataFrame, weekend: pd.DataFrame) -> pd.DataFrame:
    key = weekend["race_key"].iloc[0]
    history = entries[entries["race_key"] != key]
    feat = build_features(pd.concat([history, weekend], ignore_index=True))
    this = feat[feat["race_key"] == key].copy()
    train = feat[feat["date"] < this["date"].iloc[0]]
    has_practice = this["fp_sessions"].max() > 0
    model = M.fit(train, M.FEATURES if has_practice else M.PRE_WEEKEND_FEATURES)
    this["pred_score"] = M.predict_position(model, this)
    contrib = M.contributions(model, this)
    for col in contrib.columns:
        this[f"contrib_{col}"] = contrib[col]
    this = this.sort_values("pred_score").reset_index(drop=True)
    this["pred_pos"] = np.arange(1, len(this) + 1)
    return this


def report(pred: pd.DataFrame, used: list[str]) -> str:
    title = f"{pred['race_key'].iloc[0]}  —  predicted qualifying"
    basis = ", ".join(used) if used else "no sessions yet (pre-weekend model, no practice data)"
    lines = [f"\n{title}", f"Based on: {basis}\n"]
    actual = pred["quali_pos"].notna().all()
    for r in pred.itertuples():
        line = f"{r.pred_pos:>2}. {r.driver_id:<22} {r.constructor_id:<14} model={r.pred_score:5.1f}"
        if actual:
            ok = "✓" if (r.pred_pos <= 10) == (r.quali_pos <= 10) else "✗"
            line += f"   actual P{int(r.quali_pos):<2} {ok}"
        lines.append(line)
        if r.pred_pos == 10:
            lines.append("    " + "-" * 60)
    if actual:
        correct = int(((pred["pred_pos"] <= 10) & (pred["quali_pos"] <= 10)).sum())
        mae = float((pred["pred_pos"] - pred["quali_pos"]).abs().mean())
        lines.append(f"\nCorrect top-10 picks: {correct}/10   MAE: {mae:.2f}")
    return "\n".join(lines)


class LiveUnavailable(RuntimeError):
    """A live prediction cannot be made right now; the message is meant for people, not logs."""


def _prepare(race: str | None, season: int, update: bool, get):
    """Shared by the CLI and the web server: (entries, prediction table, finished sessions used)."""
    sdir = seasons_dir()
    if update:
        try:
            sdir = fetch_f1db(seasons=HISTORY_SEASONS)
            entries = build_entries(sdir, HISTORY_SEASONS)
            entries.to_csv(ENTRIES_CSV, index=False)
        except (subprocess.CalledProcessError, OSError) as e:
            # No network or no git: carry on with the copy we already have, if any.
            if not (sdir / str(season)).exists():
                raise LiveUnavailable(
                    "Could not download the race calendar (F1DB on GitHub). Check that the server can reach "
                    "github.com and that git is installed."
                ) from e
    if not (sdir / str(season)).exists():
        raise LiveUnavailable(f"No race calendar for {season} yet. Run once with network access to download it.")
    entries = load_entries()

    race_dir = find_race_dir(sdir / str(season), race)
    race_date = date.fromisoformat(str(yaml.safe_load((race_dir / "race.yml").read_text())["date"]))
    sessions = weekend_sessions(season, race_date, get)
    weekend, used = build_weekend(entries, race_dir, sessions, get)

    LIVE_DIR.mkdir(parents=True, exist_ok=True)
    weekend.to_csv(LIVE_DIR / f"{weekend['race_key'].iloc[0]}.csv", index=False)
    return entries, predict_weekend(entries, weekend), used


def run(race: str | None = None, season: int = CURRENT_SEASON, update: bool = True, get=openf1_get) -> str:
    _, pred, used = _prepare(race, season, update, get)
    return report(pred, used)


def snapshot(pred: pd.DataFrame, used: list[str]) -> dict:
    """JSON-ready live prediction (what the web app shows on its Live page)."""
    first = pred.iloc[0]
    done = bool(pred["quali_pos"].notna().all())
    rows = []
    for r in pred.itertuples():
        rows.append({
            "pred_pos": int(r.pred_pos), "score": round(float(r.pred_score), 2), "driver_id": r.driver_id,
            "constructor_id": r.constructor_id, "fp_last_pos": None if pd.isna(r.fp_last_pos) else int(r.fp_last_pos),
            "quali_pos": int(r.quali_pos) if done else None,
            "contrib": {g: round(float(getattr(r, f"contrib_{g}")), 2) for g in ("driver", "car", "weekend", "context")},
        })
    out = {
        "race_key": first["race_key"], "season": int(first["season"]), "round": int(first["round"]),
        "grand_prix": first["grand_prix"], "circuit": first["circuit"], "date": str(first["date"])[:10],
        "sessions_used": used, "qualifying_done": done, "rows": rows,
        "model": "full (with practice)" if pred["fp_sessions"].max() > 0 else "pre-weekend (no practice yet)",
    }
    if done:
        out["correct"] = int(((pred["pred_pos"] <= 10) & (pred["quali_pos"] <= 10)).sum())
        out["mae"] = round(float((pred["pred_pos"] - pred["quali_pos"]).abs().mean()), 2)
    return out


def live_snapshot(race: str | None = None, season: int = CURRENT_SEASON, update: bool = True, get=openf1_get) -> dict:
    _, pred, used = _prepare(race, season, update, get)
    return snapshot(pred, used)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--race", help="Round number or name (default: next race without a qualifying result)")
    parser.add_argument("--season", type=int, default=CURRENT_SEASON)
    parser.add_argument("--no-update", action="store_true", help="Do not re-download F1DB first")
    args = parser.parse_args()
    print(run(args.race, args.season, update=not args.no_update))


if __name__ == "__main__":
    main()

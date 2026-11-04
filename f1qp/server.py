"""Web server: JSON API + the built web app (web/dist).

    uv run f1qp-serve                    # http://localhost:8000  (API docs at /api/docs)
    uv run f1qp-serve --reload           # development

Configuration (environment variables):
    F1QP_LIVE_INTERVAL   seconds between live refreshes (default 900; 0 turns live updates off)
    F1QP_LIVE_UPDATE     1 = also re-download F1DB on each live refresh (default 1)
    F1QP_ADMIN_TOKEN     token for POST /api/live/refresh (no token = endpoint disabled)
    F1QP_STATIC_DIR      built front end (default web/dist)
    F1QP_CORS_ORIGINS    comma-separated origins for a separately hosted front end
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import secrets
from collections import OrderedDict
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import cars as C
from . import model as M
from . import names as N
from .build import GROUPS, State, compute_state, data_mtime, load_state, save_state, ARTIFACT
from .data import ROOT
from .tracks import outlines

log = logging.getLogger("f1qp")


# ---------------------------------------------------------------- settings ----------------------------------------------


@dataclass
class Settings:
    live_interval: int = int(os.environ.get("F1QP_LIVE_INTERVAL", "900"))
    live_update_f1db: bool = os.environ.get("F1QP_LIVE_UPDATE", "1") == "1"
    admin_token: str = os.environ.get("F1QP_ADMIN_TOKEN", "")
    static_dir: Path = Path(os.environ.get("F1QP_STATIC_DIR", str(ROOT / "web" / "dist")))
    cors_origins: tuple[str, ...] = tuple(o for o in os.environ.get("F1QP_CORS_ORIGINS", "").split(",") if o)
    artifact: Path = ARTIFACT


# ---------------------------------------------------------------- live service ------------------------------------------


def _friendly(e: BaseException) -> str:
    """A sentence for the Live page; technical details go to the server log."""
    from urllib.error import URLError

    from .live import LiveUnavailable

    if isinstance(e, (LiveUnavailable, SystemExit)):
        return str(e)
    if isinstance(e, URLError | TimeoutError | ConnectionError):
        return "Could not reach the OpenF1 timing service. Retrying automatically."
    return "The live update failed. Retrying automatically; details are in the server log."


class LiveService:
    """Refreshes the live prediction in the background and reloads the data when it changes."""

    def __init__(self, app_state: "AppState", settings: Settings, fetch=None):
        self.app_state, self.settings = app_state, settings
        self.fetch = fetch  # injectable for tests: () -> snapshot dict
        self.snapshot: dict | None = None
        self.error: str | None = None
        self.last_run: str | None = None
        self.running = False
        self._task: asyncio.Task | None = None
        self._lock = asyncio.Lock()

    def status(self) -> dict:
        return {
            "enabled": self.settings.live_interval > 0,
            "interval_s": self.settings.live_interval,
            "last_run": self.last_run,
            "running": self.running,
            "error": self.error,
        }

    def _fetch(self) -> dict:
        if self.fetch:
            return self.fetch()
        from .live import live_snapshot  # imported lazily: network code

        return live_snapshot(update=self.settings.live_update_f1db)

    async def refresh(self) -> None:
        async with self._lock:
            self.running = True
            try:
                self.snapshot = await asyncio.to_thread(self._fetch)
                self.error = None
            except BaseException as e:  # noqa: BLE001 - SystemExit from the CLI code means "no race"
                if isinstance(e, asyncio.CancelledError):
                    raise
                self.error = _friendly(e)
                log.warning("live refresh failed: %s: %s", type(e).__name__, e)
            finally:
                self.last_run = datetime.now(timezone.utc).isoformat(timespec="seconds")
                self.running = False
            await self.app_state.reload_if_stale()

    async def _loop(self) -> None:
        while True:
            await self.refresh()
            await asyncio.sleep(self.settings.live_interval)

    def start(self) -> None:
        if self.settings.live_interval > 0 and self._task is None:
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None


class AppState:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.state: State | None = None
        self._models: dict[str, object] = {}

    def model_before(self, race_key: str):
        """Model trained on every session before ``race_key`` (the same one the walk-forward used)."""
        if race_key not in self._models:
            feat = self.state.feat
            date = feat.loc[feat["race_key"] == race_key, "date"].iloc[0]
            if len(self._models) > 64:
                self._models.clear()
            self._models[race_key] = M.fit(feat[feat["date"] < date])
        return self._models[race_key]

    async def load(self) -> None:
        self.state = await asyncio.to_thread(load_state, self.settings.artifact)

    async def reload_if_stale(self) -> None:
        """Rebuild after new data arrived (F1DB update or a finished live qualifying)."""
        if self.settings.artifact.exists() and self.settings.artifact.stat().st_mtime >= data_mtime():
            return
        state = await asyncio.to_thread(compute_state)
        await asyncio.to_thread(save_state, state, self.settings.artifact)
        self.state = state
        self._models.clear()


# ---------------------------------------------------------------- helpers -----------------------------------------------


def _f(x, nd: int = 2):
    """JSON-safe float."""
    if x is None or (isinstance(x, float) and np.isnan(x)) or pd.isna(x):
        return None
    return round(float(x), nd)


def _seasons(arg: str | None, available: list[int]) -> list[int]:
    if not arg:
        return available
    try:
        picked = [int(s) for s in arg.split(",") if s.strip()]
    except ValueError:
        raise HTTPException(400, "seasons must be a comma-separated list of years, e.g. 2024,2025")
    return [s for s in picked if s in available] or available


def _result(r) -> dict:
    return {
        "season": int(r.season), "round": int(r.round), "race_key": r.race_key, "gp": N.gp_name(r.grand_prix),
        "circuit": r.circuit, "team": r.constructor_id, "pos": int(r.quali_pos),
        "status": r.quali_status if not str(r.quali_status).isdigit() else None,
        "pred": _f(r.pred), "pred_rank": int(r.pred_rank), "picked": bool(r.picked), "right": bool(r.right),
    }


def _stats(df: pd.DataFrame) -> dict:
    n = len(df)
    return {
        "sessions": n,
        "avg_pos": _f(df["quali_pos"].mean()),
        "best": int(df["quali_pos"].min()) if n else None,
        "q3_rate": _f(df["top10"].mean(), 3),
        "poles": int((df["quali_pos"] == 1).sum()),
        "avg_pred": _f(df["pred"].mean()),
        "right": int(df["right"].sum()),
        **{f"contrib_{g}": _f(df[f"contrib_{g}"].mean()) for g in GROUPS},
    }


# ---------------------------------------------------------------- app ---------------------------------------------------


async def _warm(app: FastAPI) -> None:
    """Fill the response cache with the pages people open first, so the first visit is fast too."""
    import httpx

    st = app.state.app_state.state
    if st is None:
        return
    latest = st.overview["latest"]
    paths = ["/api/meta", "/api/overview", "/api/sessions", f"/api/sessions?season={latest}", "/api/teams",
             f"/api/cars?season={latest}", "/api/heatmap?min_sessions=20"]
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://warm") as client:
            for path in paths:
                await client.get(path)
    except Exception as e:  # noqa: BLE001 - warming is best effort
        log.info("cache warm-up skipped: %s", e)


def _q_cut(field: int) -> dict[int, int]:
    """Positions that take part in each qualifying session: everyone in Q1, the top 15 in Q2 (16 with 22
    cars, from 2026), the top 10 in Q3."""
    return {1: field, 2: 16 if field >= 22 else 15, 3: 10}


def _segments(rows: pd.DataFrame) -> dict:
    """Q1 / Q2 / Q3 at one track: fastest lap, the cut-off to get through, who was knocked out, and a
    record per driver. Sessions are assigned by final position (the official rule), so a driver who
    set no time in a session they reached still counts as having reached it."""
    out: dict[str, dict] = {}
    for seg in (1, 2, 3):
        col = f"q{seg}_s"
        sessions, per_driver = [], {}
        for key, g in rows.groupby("race_key"):
            g = g.dropna(subset=["quali_pos"])
            if g.empty:
                continue
            cut = _q_cut(len(g))
            inside = g[g["quali_pos"] <= cut[seg]].sort_values("quali_pos")
            through = cut.get(seg + 1, 1)  # Q3: "through" means pole
            timed = inside.dropna(subset=[col]).sort_values(col)
            fastest = timed.iloc[0] if len(timed) else None
            # Q1/Q2: the slowest driver who still made the next session; Q3: the slowest lap (top-10 spread)
            nxt = inside[inside["quali_pos"] <= through] if seg < 3 else inside
            cut_row = nxt.sort_values(col).dropna(subset=[col]).iloc[-1] if nxt[col].notna().any() else None
            knocked = inside[inside["quali_pos"] > through] if seg < 3 else inside.iloc[0:0]

            def who(r):
                return None if r is None else {"driver": r.driver_id, "name": N.driver_name(r.driver_id), "team": r.constructor_id,
                                               "time": _f(getattr(r, col), 3), "pos": int(r.quali_pos)}

            sessions.append({
                "race_key": key, "season": int(g["season"].iloc[0]), "field": int(len(inside)),
                "fastest": who(fastest), "cutoff": who(cut_row),
                "gap_s": _f(cut_row[col] - fastest[col], 3) if fastest is not None and cut_row is not None else None,
                "out": [who(r) for r in knocked.itertuples()] if seg < 3 else [who(r) for r in inside.head(3).itertuples()],
            })
            best = fastest[col] if fastest is not None else None
            for r in inside.itertuples():
                d = per_driver.setdefault(r.driver_id, {"driver": r.driver_id, "name": N.driver_name(r.driver_id), "team": r.constructor_id,
                                                        "reached": 0, "through": 0, "best_pos": 99, "gaps": []})
                d["team"] = r.constructor_id
                d["reached"] += 1
                d["through"] += int(r.quali_pos <= through)
                d["best_pos"] = min(d["best_pos"], int(r.quali_pos))
                t = getattr(r, col)
                if best is not None and pd.notna(t):
                    d["gaps"].append((t - best) / best * 100)
        drivers = []
        for d in per_driver.values():
            gaps = d.pop("gaps")
            drivers.append({**d, "avg_gap_pct": _f(sum(gaps) / len(gaps), 3) if gaps else None})
        # most often through (Q3: most appearances), then closest to the fastest lap
        drivers.sort(key=lambda d: (-(d["reached"] if seg == 3 else d["through"]), -d["through"],
                                    d["avg_gap_pct"] if d["avg_gap_pct"] is not None else 99))
        sessions.sort(key=lambda x: x["season"])
        out[f"q{seg}"] = {"sessions": sessions, "drivers": drivers}
    return out


def create_app(settings: Settings | None = None, live_fetch=None) -> FastAPI:
    settings = settings or Settings()
    app_state = AppState(settings)
    live = LiveService(app_state, settings, fetch=live_fetch)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await app_state.load()
        live.start()
        asyncio.create_task(_warm(app))
        yield
        await live.stop()

    app = FastAPI(
        title="Gridcast API",
        version="1.0.0",
        description="Out-of-sample F1 qualifying predictions (2020 to now), car/driver split, live weekend updates.",
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )
    # Every GET answer except live/health depends only on the data version, so it is computed once
    # and served from memory until the data changes (the version is part of the key).
    cache: OrderedDict[tuple[str, str], tuple[int, bytes, str]] = OrderedDict()
    uncached = ("/api/live", "/api/health", "/api/docs", "/api/openapi.json")

    @app.middleware("http")
    async def response_cache(request: Request, call_next):
        path = request.url.path
        if request.method != "GET" or not path.startswith("/api/") or path.startswith(uncached) or app_state.state is None:
            response = await call_next(request)
            if response.status_code == 200 and (path.startswith("/assets/") or (path.startswith("/models/") and request.url.query.startswith("v="))):
                # /assets: file names are content hashes; /models: the app adds a version (?v=) it bumps when they change
                response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            return response
        key = (app_state.state.built_at, str(request.url.path) + "?" + str(request.url.query))
        hit = cache.get(key)
        if hit:
            cache.move_to_end(key)
            status, body, ctype = hit
            return Response(body, status_code=status, media_type=ctype, headers={"X-Cache": "hit", "Cache-Control": "no-cache"})
        response = await call_next(request)
        body = b"".join([chunk async for chunk in response.body_iterator])
        if response.status_code == 200:
            cache[key] = (200, body, response.media_type or "application/json")
            while len(cache) > 600:
                cache.popitem(last=False)
        headers = {k: v for k, v in response.headers.items() if k.lower() != "content-length"}
        headers["X-Cache"] = "miss"
        return Response(body, status_code=response.status_code, headers=headers, media_type=response.media_type)

    # Added after the cache so it wraps it: the cache stores plain JSON, compression happens per request.
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    if settings.cors_origins:
        app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins), allow_methods=["GET", "POST"])
    app.state.live = live
    app.state.app_state = app_state

    def S() -> State:
        if app_state.state is None:
            raise HTTPException(503, "Data is still loading")
        return app_state.state

    # ---------------------------------------------------------------- meta

    @app.get("/api/health", tags=["meta"])
    def health():
        st = app_state.state
        return {"status": "ok" if st else "loading", "data_version": st.data_version if st else None,
                "built_at": st.built_at if st else None, "live": live.status()}

    @app.get("/api/meta", tags=["meta"])
    def meta():
        st = S()
        wf = st.wf
        last = wf.sort_values("date").groupby("driver_id").tail(1).set_index("driver_id")
        counts = wf.groupby("driver_id").size()
        # Team per season (the last team of that season), so initials can take that season's colour.
        by_season = wf.sort_values("date").groupby(["driver_id", "season"])["constructor_id"].last()
        drivers = [
            {"id": d, "name": N.driver_name(d), "team": last.loc[d, "constructor_id"], "last_season": int(last.loc[d, "season"]),
             "number": None if pd.isna(last.loc[d, "driver_number"]) else int(last.loc[d, "driver_number"]),
             "sessions": int(counts[d]),
             "teams": {str(y): t for y, t in by_season.loc[d].items()}}
            for d in sorted(counts.index, key=lambda d: (-counts[d], d))
        ]
        teams = sorted(wf["constructor_id"].unique())
        circuits = sorted(wf["circuit"].unique())
        outl = outlines()
        return {
            "seasons": st.overview["seasons"], "latest": st.overview["latest"], "data_version": st.data_version,
            "built_at": st.built_at,
            "drivers": drivers,
            "teams": [{"id": t, "name": N.team_name(t), "color": N.team_color(t)} for t in teams],
            # season -> team -> {chassis, livery [primary, secondary, accent], era}: for 3D cars and helmets
            "cars": {str(y): {t: {"chassis": c, "livery": list(liv), "era": C.era_for(y)} for (yy, t), (c, liv) in C.CARS.items() if yy == y}
                     for y in st.overview["seasons"]},
            "circuits": [{"id": c, "name": N.circuit_name(c), "outline": outl.get(c, {}).get("path"),
                          "length_m": outl.get(c, {}).get("length_m")} for c in circuits],
            "groups": st.overview["feature_groups"],
            "live": live.status(),
        }

    @app.get("/api/overview", tags=["results"])
    def overview():
        return S().overview

    # ---------------------------------------------------------------- drivers

    @app.get("/api/drivers/{driver_id}", tags=["drivers"])
    def driver(driver_id: str, seasons: str | None = Query(None, description="e.g. 2024,2025")):
        st = S()
        rows = st.wf[st.wf["driver_id"] == driver_id]
        if rows.empty:
            raise HTTPException(404, f"Unknown driver '{driver_id}'")
        rows = rows[rows["season"].isin(_seasons(seasons, st.overview["seasons"]))]
        tracks = []
        for c, g in rows.groupby("circuit"):
            g = g.sort_values(["season", "round"])
            tracks.append({"circuit": c, "name": N.circuit_name(c), **_stats(g), "results": [_result(r) for r in g.itertuples()]})
        tracks.sort(key=lambda t: (t["avg_pos"] is None, t["avg_pos"]))
        stints = (rows.groupby(["constructor_id", "season"]).size().reset_index(name="n").sort_values("season"))
        return {
            "id": driver_id, "name": N.driver_name(driver_id), **_stats(rows),
            "teams": [{"team": t.constructor_id, "season": int(t.season), "sessions": int(t.n)} for t in stints.itertuples()],
            "tracks": tracks,
        }

    # ---------------------------------------------------------------- tracks

    @app.get("/api/tracks/{circuit_id}", tags=["tracks"])
    def track(circuit_id: str, seasons: str | None = None):
        st = S()
        rows = st.wf[st.wf["circuit"] == circuit_id]
        if rows.empty:
            raise HTTPException(404, f"Unknown track '{circuit_id}'")
        rows = rows[rows["season"].isin(_seasons(seasons, st.overview["seasons"]))]
        drivers = []
        for d, g in rows.groupby("driver_id"):
            g = g.sort_values(["season", "round"])
            drivers.append({"driver": d, "name": N.driver_name(d), "team": g["constructor_id"].iloc[-1], **_stats(g),
                            "results": [_result(r) for r in g.itertuples()]})
        drivers.sort(key=lambda t: t["avg_pos"])
        sess = M.session_scores(rows, rows["picked"])
        sessions = [{"race_key": k, "season": int(k[:4]), "correct": int(v),
                     "pole": N.driver_name(rows.loc[(rows["race_key"] == k) & (rows["quali_pos"] == 1), "driver_id"].iloc[0])}
                    for k, v in sess.sort_index().items()]
        return {"id": circuit_id, "name": N.circuit_name(circuit_id), "sessions": sessions,
                "model_correct": _f(sess.mean()) if len(sess) else None, "drivers": drivers,
                "segments": _segments(rows)}

    # ---------------------------------------------------------------- heatmap

    @app.get("/api/heatmap", tags=["results"])
    def heatmap(seasons: str | None = None, min_sessions: int = Query(20, ge=1)):
        st = S()
        rows = st.wf[st.wf["season"].isin(_seasons(seasons, st.overview["seasons"]))]
        counts = rows.groupby("driver_id").size()
        keep = counts[counts >= min_sessions].index
        rows = rows[rows["driver_id"].isin(keep)]
        avg = rows.groupby("driver_id")["quali_pos"].mean().sort_values()
        cells = rows.groupby(["driver_id", "circuit"]).agg(avg=("quali_pos", "mean"), n=("quali_pos", "size"),
                                                           best=("quali_pos", "min"), right=("right", "sum"))
        circuits = sorted(rows["circuit"].unique(), key=N.circuit_name)
        return {
            "circuits": circuits,
            "drivers": [{"driver": d, "avg": _f(a), "team": rows.loc[rows["driver_id"] == d, "constructor_id"].iloc[-1]} for d, a in avg.items()],
            "cells": [{"driver": d, "circuit": c, "avg": _f(r.avg), "n": int(r.n), "best": int(r.best), "right": int(r.right)}
                      for (d, c), r in cells.iterrows()],
        }

    # ---------------------------------------------------------------- sessions

    @app.get("/api/sessions", tags=["sessions"])
    def sessions(season: int | None = None):
        st = S()
        rows = st.wf if season is None else st.wf[st.wf["season"] == season]
        sc = M.session_scores(rows, rows["picked"])
        first = rows.drop_duplicates("race_key").sort_values(["season", "round"])
        return [{"race_key": r.race_key, "season": int(r.season), "round": int(r.round), "gp": N.gp_name(r.grand_prix),
                 "circuit": r.circuit, "date": str(r.date)[:10], "sprint": bool(r.sprint_weekend), "correct": int(sc[r.race_key])}
                for r in first.itertuples()]

    @app.get("/api/sessions/{race_key}", tags=["sessions"])
    def session(race_key: str):
        st = S()
        rows = st.wf[st.wf["race_key"] == race_key].sort_values("pred_rank")
        if rows.empty:
            raise HTTPException(404, f"Unknown session '{race_key}'")
        r0 = rows.iloc[0]
        return {
            "race_key": race_key, "season": int(r0.season), "round": int(r0["round"]), "gp": N.gp_name(r0.grand_prix),
            "circuit": r0.circuit, "date": str(r0.date)[:10], "sprint": bool(r0.sprint_weekend),
            "correct": int((rows["picked"] & (rows["top10"] == 1)).sum()),
            "mae": _f((rows["pred_rank"] - rows["quali_pos"]).abs().mean()),
            "rows": [{**_result(r), "driver": r.driver_id, "fp_last_pos": _f(r.fp_last_pos, 0),
                      "contrib": {g: _f(getattr(r, f"contrib_{g}")) for g in GROUPS}, "baseline": _f(r.contrib_baseline)}
                     for r in rows.itertuples()],
        }

    # ---------------------------------------------------------------- cars

    @app.get("/api/cars", tags=["cars"])
    def cars(season: int):
        st = S()
        rows = st.wf[st.wf["season"] == season]
        if rows.empty:
            raise HTTPException(404, f"No data for {season}")
        out = []
        for t, g in rows.groupby("constructor_id"):
            team_best = g.groupby("race_key")["pace_gap"].min()
            out.append({"team": t, "name": N.team_name(t), "engine": g["engine"].mode().iloc[0], **C.car_info(season, t),
                        "avg_pos": _f(g["quali_pos"].mean()),
                        "pace_gap": _f(team_best.mean(), 3), "car_contrib": _f(g["contrib_car"].mean()),
                        "q3_rate": _f(g["top10"].mean(), 3), "drivers": sorted(g["driver_id"].unique())})
        out.sort(key=lambda c: c["pace_gap"] if c["pace_gap"] is not None else 9)
        return {"season": season, "era": C.era_for(season), "cars": out, "parts": C.PARTS}

    @app.get("/api/cars/{season}/{team}", tags=["cars"])
    def car(season: int, team: str):
        st = S()
        rows = st.wf[(st.wf["season"] == season) & (st.wf["constructor_id"] == team)]
        if rows.empty:
            raise HTTPException(404, f"No {team} car in {season}")
        field_ = st.wf[st.wf["season"] == season]
        team_best = field_.groupby(["race_key", "constructor_id"])["pace_gap"].min().unstack()
        rank = team_best.rank(axis=1)
        races = rows.drop_duplicates("race_key").sort_values("round")
        trend = [{"race_key": r.race_key, "round": int(r.round), "gp": N.gp_name(r.grand_prix),
                  "gap": _f(team_best.loc[r.race_key, team], 3), "rank": _f(rank.loc[r.race_key, team], 0),
                  "best_pos": int(rows.loc[rows["race_key"] == r.race_key, "quali_pos"].min()),
                  "car_contrib": _f(rows.loc[rows["race_key"] == r.race_key, "contrib_car"].mean())} for r in races.itertuples()]
        drivers = []
        for d, g in rows.groupby("driver_id"):
            drivers.append({"driver": d, "name": N.driver_name(d), **_stats(g), "vs_teammate": _f(g["vs_teammate"].mean())})
        drivers.sort(key=lambda x: -x["sessions"])
        lineage_id = rows["team_id"].iloc[0]
        lineage = (st.wf[st.wf["team_id"] == lineage_id].drop_duplicates("season")[["season", "constructor_id"]].sort_values("season"))
        return {"season": season, "team": team, "name": N.team_name(team), "engine": rows["engine"].mode().iloc[0],
                "lineage": [{"season": int(r.season), "team": r.constructor_id, "name": N.team_name(r.constructor_id)} for r in lineage.itertuples()],
                **C.car_info(season, team), "parts": C.PARTS,
                **_stats(rows), "pace_gap": _f(team_best[team].mean(), 3),
                "pace_rank": _f(rank[team].mean(), 1), "teams_in_season": int(team_best.shape[1]),
                "trend": trend, "drivers": drivers}

    # ---------------------------------------------------------------- teams (lineages: one team across renames)

    def _team_rows(st: State, team_id: str) -> pd.DataFrame:
        rows = st.wf[st.wf["team_id"] == team_id]
        if rows.empty:
            raise HTTPException(404, f"Unknown team '{team_id}'")
        return rows

    def _season_ranks(st: State) -> pd.DataFrame:
        """Per race and lineage: best pace gap of the team's two cars, and its rank in the field."""
        best = st.wf.groupby(["season", "race_key", "team_id"])["pace_gap"].min().reset_index()
        best["rank"] = best.groupby("race_key")["pace_gap"].rank()
        return best

    @app.get("/api/teams", tags=["teams"])
    def teams():
        st = S()
        ranks = _season_ranks(st)
        out = []
        for tid, g in st.wf.groupby("team_id"):
            last = g.sort_values("date").iloc[-1]
            names = list(dict.fromkeys(g.sort_values("date")["constructor_id"]))
            r = ranks[ranks["team_id"] == tid]
            out.append({
                "id": tid, "name": N.team_name(last.constructor_id), "constructor": last.constructor_id,
                "color": N.team_color(last.constructor_id), "names": [N.team_name(n) for n in names],
                "seasons": sorted(int(x) for x in g["season"].unique()), "last_season": int(last.season),
                "livery": C.car_info(int(last.season), last.constructor_id)["livery"], "era": C.era_for(int(last.season)),
                "avg_pos": _f(g["quali_pos"].mean()), "q3_rate": _f(g["top10"].mean(), 3),
                "poles": int((g["quali_pos"] == 1).sum()), "pace_rank": _f(r["rank"].mean(), 1),
                "drivers": int(g["driver_id"].nunique()),
            })
        out.sort(key=lambda t: (-t["last_season"], t["pace_rank"] if t["pace_rank"] is not None else 99))
        return out

    @app.get("/api/teams/{team_id}", tags=["teams"])
    def team(team_id: str):
        st = S()
        rows = _team_rows(st, team_id)
        ranks = _season_ranks(st)
        mine = ranks[ranks["team_id"] == team_id]
        last = rows.sort_values("date").iloc[-1]
        seasons = []
        for y, g in rows.groupby("season"):
            con = g["constructor_id"].mode().iloc[0]
            r = mine[mine["season"] == y]
            # Teammate battle: who out-qualified whom, race by race (only races with both cars).
            h2h: dict[str, int] = {}
            for _, race in g.groupby("race_key"):
                if len(race) == 2:
                    w = race.sort_values("quali_pos").iloc[0]["driver_id"]
                    h2h[w] = h2h.get(w, 0) + 1
            drivers = []
            for d, dg in g.groupby("driver_id"):
                drivers.append({"driver": d, "name": N.driver_name(d), "sessions": int(len(dg)), "avg_pos": _f(dg["quali_pos"].mean()),
                                "q3_rate": _f(dg["top10"].mean(), 3), "h2h_wins": int(h2h.get(d, 0)),
                                "contrib_driver": _f(dg["contrib_driver"].mean())})
            drivers.sort(key=lambda x: -x["sessions"])
            info = C.car_info(int(y), con)
            seasons.append({
                "season": int(y), "constructor": con, "name": N.team_name(con), "chassis": info["chassis"], "livery": info["livery"],
                "era": info["era"], "engine": g["engine"].mode().iloc[0], "races": int(g["race_key"].nunique()),
                "avg_pos": _f(g["quali_pos"].mean()), "best": int(g["quali_pos"].min()), "q3_rate": _f(g["top10"].mean(), 3),
                "poles": int((g["quali_pos"] == 1).sum()), "pace_gap": _f(r["pace_gap"].mean(), 3), "pace_rank": _f(r["rank"].mean(), 1),
                "teams_in_season": int(ranks.loc[ranks["season"] == y, "team_id"].nunique()),
                "contrib_car": _f(g["contrib_car"].mean()), "right": _f(g["right"].mean(), 3), "drivers": drivers,
            })
        races = mine.merge(st.wf.drop_duplicates("race_key")[["race_key", "round", "grand_prix", "date"]], on="race_key").sort_values("date")
        trend = [{"race_key": r.race_key, "season": int(r.season), "round": int(r.round), "gp": N.gp_name(r.grand_prix),
                  "gap": _f(r.pace_gap, 3), "rank": _f(r.rank, 0)} for r in races.itertuples()]
        by_track = rows.groupby("circuit").agg(avg=("quali_pos", "mean"), n=("quali_pos", "size"), q3=("top10", "mean"), poles=("quali_pos", lambda x: int((x == 1).sum())))
        by_track = by_track[by_track["n"] >= 4].sort_values("avg")

        def track(c, r):
            return {"circuit": c, "name": N.circuit_name(c), "avg_pos": _f(r.avg), "entries": int(r.n), "q3_rate": _f(r.q3, 3), "poles": int(r.poles)}

        return {
            "id": team_id, "name": N.team_name(last.constructor_id), "constructor": last.constructor_id, "color": N.team_color(last.constructor_id),
            "names": [N.team_name(n) for n in dict.fromkeys(rows.sort_values("date")["constructor_id"])],
            **_stats(rows), "pace_rank": _f(mine["rank"].mean(), 1),
            "seasons": seasons, "trend": trend,
            "best_tracks": [track(c, r) for c, r in by_track.head(5).iterrows()],
            "worst_tracks": [track(c, r) for c, r in by_track.tail(5).iloc[::-1].iterrows()],
        }

    # ---------------------------------------------------------------- what-if

    @app.get("/api/swap", tags=["what-if"])
    def swap(race_key: str, driver: str, team: str):
        """Predict ``driver`` in ``team``'s car at ``race_key`` (team = F1DB constructor id)."""
        st = S()
        session_rows = st.feat[st.feat["race_key"] == race_key]
        if session_rows.empty:
            raise HTTPException(404, f"Unknown session '{race_key}'")
        team_rows = session_rows[session_rows["constructor_id"] == team]
        if team_rows.empty:
            raise HTTPException(404, f"{team} did not take part in {race_key}")
        try:
            row = M.swap_rows(session_rows, driver, team_rows["team_id"].iloc[0])
        except KeyError:
            raise HTTPException(404, f"{driver} did not take part in {race_key}")
        model = app_state.model_before(race_key)
        score = float(M.predict_position(model, row)[0])
        contrib = M.contributions(model, row).iloc[0]
        others = session_rows[session_rows["driver_id"] != driver]
        other_scores = M.predict_position(model, others)
        own = session_rows[session_rows["driver_id"] == driver]
        own_score = float(M.predict_position(model, own)[0])
        own_contrib = M.contributions(model, own).iloc[0]
        return {
            "race_key": race_key, "driver": driver, "team": team,
            "from_team": own["constructor_id"].iloc[0],
            "score": round(score, 2), "grid": int((other_scores < score).sum() + 1),
            "own_score": round(own_score, 2), "own_grid": int((other_scores < own_score).sum() + 1),
            "actual": None if pd.isna(own["quali_pos"].iloc[0]) else int(own["quali_pos"].iloc[0]),
            "contrib": {g: round(float(contrib[g]), 2) for g in GROUPS},
            "own_contrib": {g: round(float(own_contrib[g]), 2) for g in GROUPS},
            "baseline": round(float(contrib["baseline"]), 2),
        }

    # ---------------------------------------------------------------- live

    @app.get("/api/live", tags=["live"])
    def live_get():
        return {"status": live.status(), "prediction": live.snapshot}

    @app.post("/api/live/refresh", tags=["live"])
    async def live_refresh(authorization: str = Header("")):
        if not settings.admin_token:
            raise HTTPException(403, "Set F1QP_ADMIN_TOKEN to enable manual refreshes")
        if not secrets.compare_digest(authorization.removeprefix("Bearer "), settings.admin_token):
            raise HTTPException(401, "Bad token")
        if live.running:
            return JSONResponse({"status": live.status()}, status_code=202)
        asyncio.create_task(live.refresh())
        return JSONResponse({"status": "started"}, status_code=202)

    # ---------------------------------------------------------------- front end

    static = settings.static_dir
    if (static / "index.html").exists():
        app.mount("/assets", StaticFiles(directory=static / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str, request: Request):
            if path.startswith("api/"):
                raise HTTPException(404)
            f = (static / path).resolve()
            if path and f.is_file() and static.resolve() in f.parents:
                return FileResponse(f)
            return FileResponse(static / "index.html", headers={"Cache-Control": "no-cache"})

    return app


def main() -> None:
    import uvicorn

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    uvicorn.run("f1qp.server:create_app", factory=True, host=args.host, port=args.port, reload=args.reload)


if __name__ == "__main__":
    main()

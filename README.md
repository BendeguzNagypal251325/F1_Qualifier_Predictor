# F1 Qualifier Predictor

Predicts which 10 drivers reach Q3 (qualify in the top 10) for every Formula 1 Grand Prix, using only
information available **before** qualifying starts. It can also run live during a race weekend: after
every practice session and after qualifying (see [Live weekend predictions](#live-weekend-predictions)).

The results are served as a **web app** (FastAPI back end + React front end, one Docker image): driver
and car pages, track outlines, interactive car schematics for every team and season, a
"what if this driver drove that car" tool, and a live page for the current weekend. See
[Web app](#web-app) and [Deployment](#deployment).

## Results

Ridge regression predicts each driver's qualifying position. The 10 best predicted drivers are the
predicted Q3. The model goes through each season race by race: before each race it is retrained on all
earlier sessions, so every real result is added before the next race is predicted.

| Method | 2026 picks / 10 | 2026 MAE (top 10) | 2025 picks / 10 | 2025 MAE (top 10) |
|---|---|---|---|---|
| **Ridge regression (this model)** | **8.95** | **2.02** | **7.96** | **2.70** |
| Last practice session order | 8.63 | 2.08 | 7.71 | 3.41 |
| Championship order | 8.53 | 2.19 | 7.17 | 3.33 |
| Rolling form (last 3 qualis) | 8.42 | 2.55 | 7.71 | 2.95 |
| Previous qualifying order | 8.26 | 3.02 | 7.58 | 3.55 |

2026 = the 19 races up to Mexico. MAE = average number of places the predicted position is off (here for
the drivers who really qualified top 10). Full tables, all seasons and feature importance are in
[`reports/evaluation.md`](reports/evaluation.md).

The top 6–7 cars are easy to call. Nearly all of the misses come from the midfield fight for P8–P12,
where the gaps are often under a tenth.

### Choices we tested

- **Training start year:** tested every start from 2007 to 2024, scored on 2025 and 2026. Any start from
  2016 to 2020 was about equally good (within 1–2 picks per season); 2019 was best on 2026. Starting in
  2023 or later was clearly worse, and going back before 2014 did not help. **We train from 2019.**
- **History for the features:** with training fixed at 2019, history from 2010 gave the best results
  (2026: 8.95 picks vs 8.84 with history from 2018). It gives veterans their full experience and track
  record. Going back further than 2010 added nothing.
- **Season weights** (less weight on old seasons): did not help, so not used.
- **Models:** logistic regression, linear and ridge regression, random forest, gradient boosting, XGBoost
  and a LightGBM ranker. Simple linear models did as well as or better than the complex ones;
  ridge regression was best (all three linear models were within about 1 pick over a season).
- **Practice results:** without them the model loses about 0.2–0.3 correct picks per race and is only
  as good as the best simple rule. Practice is the most important information.
- **Renamed teams** (Racing Point → Aston Martin, Renault → Alpine, Toro Rosso/AlphaTauri/RB → Racing Bulls,
  Alfa Romeo/Sauber → Audi) are tracked as one team (`TEAM_LINEAGE` in `features.py`), so team form
  carries over a rebrand. This lowered MAE slightly.

## Live weekend predictions

```bash
uv run f1qp-live                  # next race: run before FP1, after FP1, FP2, FP3 and after qualifying
uv run f1qp-live --race las-vegas # a specific race (round number or name)
uv run f1qp-live --no-update      # skip the F1DB download (faster)
```

Each run:

1. updates the history from [F1DB](https://github.com/f1db/f1db) (all finished race weekends),
2. downloads every **finished** session of the current weekend from the free
   [OpenF1 API](https://openf1.org) (practice classification and gaps, the qualifying result),
3. predicts the qualifying order with everything known at that moment:
   before FP1 it uses the pre-weekend model (form, standings, track history); after each practice
   session it uses the full model with the newest practice results,
4. after qualifying, prints the real result next to the prediction (correct picks and MAE) and saves
   the weekend in `data/live/`. That weekend is used for training straight away, even before F1DB has
   it, so the next race's prediction already includes it.

The free OpenF1 API has a session's results once the session has ended (live data during a session
needs a paid OpenF1 account, and is not used). Drivers are matched to F1DB by car number and surname;
OpenF1 team names are mapped in `TEAM_IDS` in `live.py`. New teams or name changes may need a line there.

## Quick start (uv)

The project is managed with [uv](https://docs.astral.sh/uv/) (Python) and npm (front end).

```bash
uv sync                            # Python env from uv.lock (incl. pytest)
uv run f1qp-train                  # walk-forward evaluation -> reports/evaluation.md
uv run f1qp-predict 2024 monaco    # one race, predicted vs actual (terminal)
uv run f1qp-live                   # live prediction for the next race (terminal)
uv run pytest
```

Run the web app locally:

```bash
cd web && npm ci && npm run build && cd ..   # build the front end into web/dist
uv run f1qp-build                            # precompute predictions -> artifacts/state.pkl
uv run f1qp-serve                            # http://127.0.0.1:8000   (API docs: /api/docs)
```

For front-end development, run `uv run f1qp-serve` and `cd web && npm run dev` side by side. Vite
serves the app on http://localhost:5173 and forwards `/api` to the Python server.

To add a Python dependency, run `uv add <package>` and commit `pyproject.toml` and `uv.lock`.

Example output (`uv run f1qp-predict 2024 monaco`). ✓ means the driver was correctly placed
inside or outside the top 10:

```
 1. max-verstappen         red-bull       model=  1.7   actual P6  ✓
 2. charles-leclerc        ferrari        model=  3.2   actual P1  ✓
 ...
10. yuki-tsunoda           rb             model= 10.5   actual P8  ✓
    ----------------------------------------------------------------
11. lance-stroll           aston-martin   model= 12.1   actual P13 ✓
...
Correct top-10 picks: 8/10
```

## Web app

| Page | What it shows |
|---|---|
| **Overview** | correct picks per season vs the simple rules, how much car / driver / practice decide a prediction, most useful inputs |
| **Live** | this weekend's predicted qualifying order, rebuilt after every finished session; after qualifying, the real result next to it |
| **Drivers** | every driver as initials in their team colour; each profile has the driver's record at every track, team history, and the driver-vs-car split |
| **Cars** | every car of a season ranked by pace; each car has an interactive schematic, pace through the season, its drivers, and a power-unit comparison |
| **Tracks** | track outlines and maps; every driver's record at that track, and the model's score at each session there |
| **What if** | put any driver in any car at any race and see the predicted grid slot |
| **Sessions** | predicted order vs result for any race, with the reason behind each prediction |
| **Heatmap** | average qualifying position per driver × track |

All of it comes from the walk-forward run, so every prediction shown is out-of-sample.

### Car and driver features

Every feature belongs to one group (`FEATURE_GROUPS` in `features.py`):

- **Car**: team form (average quali, Q3 rate, pace gap to pole, season average) and team standings.
  It is tracked per team lineage, so it stays with the car when a driver changes team and carries
  over a rebrand.
- **Driver**: the driver's own results, teammate head-to-head, track record, experience and standings.
  It follows the driver to a new team. A driver's past results also contain the cars they had, so
  the split is not perfectly clean.
- **Practice**: this weekend's practice order and gaps, which reflect car and driver together.
- **Event**: sprint weekend, street circuit.

Ridge regression is linear, so every prediction splits exactly into one contribution per group
(`model.contributions`, tested to add up to the prediction). The app shows these as places gained or
lost compared with an average entry. The **What if** tool (`model.swap_rows`) keeps the driver's
features and takes the car features and practice pace from the other team's entries.

We also tested extra features to separate car and driver further: a driver's career average gap to
teammates, a driver's gap to their own car's best lap, engine-supplier pace, and an in-season
development trend. None changed walk-forward accuracy by more than ±0.03 picks per race, which is
noise, so the model itself is unchanged.

### Car schematics

The schematics are our own SVG drawings (`web/src/components/CarSchematic.tsx`). They are built from
the public regulation dimensions of each era: 2017–2021 (wide cars with bargeboards), 2022–2025
(ground effect) and 2026 (narrower, shorter, active aero). Each one is coloured in that car's livery
(`f1qp/cars.py` has the chassis name and colours for every team and season since 2020). Every part is
clickable and shows what it does, plus the car-level numbers the model uses. The data has no
measurements of individual parts, and the app says so.

### Driver and track graphics

The app uses no photos. Drivers are shown as their initials on their team's colour. The colour follows
the season (`/api/meta` gives each driver's team per season), so Hamilton is Mercedes teal up to 2024
and Ferrari red from 2025. Each driver card and profile has a season strip in those colours. Tracks are
drawn from the outlines in [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) (MIT,
bundled in `f1qp/assets/`). All graphics are our own or openly licensed.

## Deployment

One Docker image holds the API, the built front end and the precomputed predictions:

```bash
docker compose up --build          # http://localhost:8000
```

or:

```bash
docker build -t f1qp .
docker run -p 8000:8000 f1qp
```

| Variable | Default | Meaning |
|---|---|---|
| `F1QP_LIVE_INTERVAL` | `900` | seconds between live refreshes; `0` turns live updates off |
| `F1QP_LIVE_UPDATE` | `1` | also pull the latest F1DB results on each refresh |
| `F1QP_ADMIN_TOKEN` | empty | enables `POST /api/live/refresh` with `Authorization: Bearer <token>` |
| `F1QP_CORS_ORIGINS` | empty | comma-separated origins, if the front end is hosted elsewhere |
| `PORT` / `HOST` | `8000` / `0.0.0.0` | where the server listens |

**Live service:** every `F1QP_LIVE_INTERVAL` seconds the server runs the same code as `f1qp-live`
(F1DB update plus OpenF1 sessions) in a background thread. When new results arrive (a new F1DB round,
or a finished qualifying saved in `data/live/`), it rebuilds the predictions and swaps them in without
a restart. The compose file keeps `data/live`, the F1DB checkout and the artifacts on volumes. The
image runs as a non-root user and has a health check (`GET /api/health`).

It runs on any container host (Fly.io, Render, Railway, Google Cloud Run, a VM). Live updates need
outbound HTTPS to `api.openf1.org` and `github.com`. Plan for about 1 GB of memory.

Behind a TLS-intercepting corporate proxy, build with the proxy's CA as a build secret (see the
comment at the top of the `Dockerfile`). If Docker Hub rate-limits you, pass
`--build-arg REGISTRY=mirror.gcr.io/library`.

CI (`.github/workflows/ci.yml`) runs the Python tests, builds the front end, then builds the Docker
image and smoke-tests it. The API reference is at `/api/docs` on a running server.

## Data

**Is this FastF1?** No. FastF1 reads the F1 live-timing API, which the cloud environment this was built
in cannot reach. F1DB has every session result, practice classification and standings table we need.
FastF1 adds telemetry and sector times, so it would be a good next step on a machine with normal
internet access.

[F1DB](https://github.com/f1db/f1db) (CC BY 4.0). `data/qualifying_entries.csv` is committed, so
no download is needed. To rebuild it from the latest F1DB (sparse git clone, seasons 2010 to now):

```bash
uv run f1qp-data
```

One row per driver per qualifying session: classification, Q1–Q3 times, FP1–FP3 position and gap
to fastest, and driver and constructor standings after the previous round. Seasons 2010–2018 are used only as history for the features
(experience, past results at each track, rolling form). Training rows start in 2019.

## Features (`f1qp/features.py`)

| Group | Features |
|---|---|
| Driver form | last quali position, rolling mean of last 3/5, top-10 rate (last 5), quali pace gap to pole (last 3), season average, teammate head-to-head (last 5), last result at this circuit, experience overall and with current team |
| Constructor form | team average position, top-10 rate and best pace gap (last 3), season average |
| Championship | driver/constructor position and points before this round |
| This weekend's practice | latest session position and gap (FP3 → FP2 → FP1), best position, mean gap, number of sessions (sprint weekends only have FP1) |
| Context | sprint weekend, street circuit |

All history features are shifted by one session. Two tests in `tests/test_pipeline.py` check this:
removing future sessions, or scrambling a session's own result, must leave that session's features
unchanged.

## Model (`f1qp/model.py`)

- **Model:** Ridge regression (median imputation with missing-indicators, standardised, alpha = 10).
- **Target:** qualifying position (`quali_pos`).
- **Per-session pick:** sort the predicted positions; the 10 lowest are the predicted top 10.
- **Training data:** sessions from 2019 on, and only sessions before the one being predicted.
- **Before FP1** (live only): the same model without the practice features.

## Project layout

```
f1qp/data.py        download F1DB + build data/qualifying_entries.csv
f1qp/features.py    leakage-free pre-qualifying features, car/driver feature groups
f1qp/model.py       Ridge model, baselines, metrics, contributions, what-if swap
f1qp/train.py       walk-forward evaluation report
f1qp/predict.py     predict any past GP vs. the actual result (terminal)
f1qp/live.py        live predictions for the next race (F1DB + OpenF1)
f1qp/build.py       precompute everything the web app serves -> artifacts/state.pkl
f1qp/server.py      FastAPI app: JSON API, live background service, serves web/dist
f1qp/cars.py        chassis names, liveries and regulation eras per team and season
f1qp/tracks.py      track outlines as SVG paths (MIT GeoJSON in f1qp/assets/)
f1qp/names.py       display names and team colours
web/                React + TypeScript front end (Vite)
data/               F1DB entries table, data/live/ weekends
Dockerfile, docker-compose.yml, .github/workflows/ci.yml
tests/              data sanity, leakage, live (fake OpenF1), API and explanation tests
```

## Ideas for next steps

- Data on which team brought upgrades to which race, as a car feature, to separate car from driver
  more cleanly.

- Predict the exact grid order (ranking model, e.g. LightGBM LambdaRank) instead of only top 10.
- Add weather (wet qualifying is where the model fails most), long-run vs. short-run practice pace and
  car upgrade timing.
- Use FastF1 telemetry for practice sector times, if your environment can reach the F1 live-timing API.

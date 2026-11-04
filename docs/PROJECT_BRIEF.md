# Gridcast: project brief

**Gridcast** (repo `BendeguzNagypal251325/F1_Qualifier_Predictor`) predicts which ten drivers reach Q3, the
top 10 in qualifying, at every Formula 1 Grand Prix. It covers 2020 to the current 2026 season and is
served as a web dashboard. Every prediction uses only information available before qualifying starts.
The app can also predict live during a race weekend, refreshing after each practice session.

Team project (BUas). Main branch `main`. Work arrives through pull requests from feature branches.

---

## 1. What it does

- **Prediction:** a Ridge regression model predicts each driver's qualifying position. The 10 drivers
  with the best predicted positions are the predicted Q3.
- **Walk-forward evaluation:** seasons are processed race by race. Before each race the model is
  retrained on all earlier sessions only, so every number shown is out-of-sample.
- **Results (2020–26):** 8.06 of 10 Q3 picks right on average; 8.95/10 in 2026 so far.
  - The best simple rule, championship order, gets 7.81/10.
  - Average position error for the real top 10 is 2.47 places.
  - Misses come almost entirely from the P8–P12 midfield fight.
- **Driver vs car:** features are split into groups: driver, car (team), practice and context. Each
  prediction is broken down into how much each group contributed.
- **What if:** put any driver in any car at any race and see the predicted grid slot.
- **Live weekend:** pulls practice and qualifying sessions from OpenF1 and rebuilds the prediction after
  each finished session.

## 2. Data

| Source | What | Where |
|---|---|---|
| **F1DB** (github.com/f1db/f1db, CC BY 4.0) | Results, qualifying positions and Q1/Q2/Q3 lap times, practice results, championship standings, 2010–2026 | Built into `data/qualifying_entries.csv` (one row per driver per session). **Do not change it by hand.** |
| **OpenF1** (api.openf1.org, free tier ≈30 requests/min) | Live sessions; sector times, speed traps and car positions (2023+) | `data/live/` (live weekends) and `data/live/sectors/<race_key>.json` |
| **bacinger/f1-circuits** (MIT) | Track outline GeoJSON | `f1qp/assets/` |
| **Sketchfab models** (CC BY 4.0) | 3D cars and helmet (see §6) | Prepared into `web/public/models/` |

Training uses sessions from 2019 on. Feature history goes back to 2010.

## 3. Model

- **Features** (`f1qp/features.py`):
  - Driver form: last quali, rolling means of the last 3 and 5, top-10 rate, pace gap to pole, season
    average, teammate head-to-head, last result at this circuit, experience.
  - Team form.
  - Championship position and points before the round.
  - This weekend's practice: latest session's position and gap, best position, mean gap.
  - Context: sprint weekend, street circuit.
- **No leakage:** every history feature is shifted by one session. Tests check that removing future
  sessions, or scrambling a session's own result, leaves its features unchanged.
- **Team renames** (AlphaTauri → RB → Racing Bulls, Alfa Romeo → Kick Sauber → Audi, and so on) are one
  team lineage (`TEAM_LINEAGE`).
- **Model** (`f1qp/model.py`): Ridge, alpha = 10, median imputation with missing-value indicators,
  standardised features, target `quali_pos`. Before FP1 it runs without the practice features.
- **Tested and rejected:** logistic regression, random forest, gradient boosting, XGBoost, LightGBM
  ranker, and season weights. Simple linear models did as well or better.

## 4. Tech stack

- **Python 3.13** with **uv** (`pyproject.toml`, `uv.lock`). Dependencies: numpy, pandas, scikit-learn,
  FastAPI, uvicorn, httpx, joblib, pyyaml. pytest for tests; ruff 0.8.4 for lint (run as `uvx`).
- **Back end:** FastAPI (`f1qp/server.py`).
  - Everything is precomputed into `artifacts/state.pkl` (`f1qp/build.py`).
  - In-memory API response cache, keyed by data version and sector-data version.
  - GZip compression, plus a warm-up of the main pages at start.
  - Hashed assets and versioned model files (`?v=`) are cached for a year.
  - Serves the built front end from `web/dist`.
- **Front end:** React 18.3 + TypeScript 5.6 + Vite 5.4, react-router-dom 6.28, three.js 0.169.
  - The 3D code is lazy-loaded and only fetched on pages with 3D.
  - Fonts are self-hosted with @fontsource: Saira Condensed (headings and wordmark), Barlow (body),
    Roboto Mono (numbers), Mrs Saint Delafield (handwritten-style driver names, a font, not real
    signatures).
- **3D asset pipeline** (`tools/models/`):
  - `blend2glb.py` uses Blender as a Python module (bpy 4.2, Python 3.11) to export the Blender file.
  - `prepare_models.py` (usd-core and trimesh) prepares the models: see §6.
  - `optimize.sh` runs `@gltf-transform/cli` 4.1.1 (meshoptimizer simplify + meshopt compression).
- **Deployment:**
  - Docker multi-stage image with `docker-compose.yml`, port 8000.
  - Named volumes for `data/live`, `data/raw` and `artifacts`.
  - `docker-entrypoint.sh` fixes volume ownership, then drops to a non-root user.
  - `start.sh` / `start.ps1` run the app without Docker.
- **CI** (`.github/workflows/ci.yml`): Python tests, web build, then a Docker build and smoke test, plus
  a Playwright click-through of every page (`web/scripts/check-navigation.cjs`).

## 5. Repository layout

```
f1qp/                 Python package
  data.py             download F1DB, build data/qualifying_entries.csv
  features.py         leakage-free features, feature groups, team lineage
  model.py            Ridge model, baselines, metrics, contributions, what-if swap
  train.py            walk-forward evaluation -> reports/evaluation.md
  predict.py          predict any past GP vs the real result (terminal)
  build.py            precompute everything the app serves -> artifacts/state.pkl
  server.py           FastAPI app: JSON API + front end; live service; sector fetcher
  live.py             live weekend predictions (F1DB + OpenF1), OpenF1 client (paced, handles 429)
  sectors.py          OpenF1 sector times + fitting the fastest lap's trace onto the track outline
  cars.py             chassis names, liveries (primary/secondary/accent) and regulation eras per team/season
  tracks.py           track outlines as SVG paths (+ points for the sector fit)
  names.py            display names, team colours
web/                  React front end (Vite)
  index.html          start-lights loading screen (full sequence on first visit only), favicon links
  public/             favicon.svg/.ico, icons, site.webmanifest, models/ (prepared 3D models)
  src/pages/          Overview, Live, Drivers, Teams, Cars, Tracks, WhatIf, Sessions, Heatmap
  src/components/     ui.tsx (tiles, chips, Info popovers, tables), Charts, Search (Ctrl+K),
                      QualiBreakdown (Q1/Q2/Q3), TrackSectors (sector map + times), ThreeViews (3D),
                      PredictionTable, Brand (logo/wordmark), SpeedLines (background), ErrorBoundary
  src/three/          models.ts (car models + livery painting), helmet.ts, car.ts (fallback car),
                      stage.ts (renderer + thumbnail cache), assets.ts / modelFiles.ts (loading), credits.ts
  scripts/            check-navigation.cjs (browser click-through used in CI)
tools/models/         blend2glb.py, prepare_models.py, optimize.sh (3D asset pipeline)
tests/                test_pipeline (data, leakage), test_server (API), test_live, test_sectors
data/                 qualifying_entries.csv, live/ (weekends, sectors), raw/ (F1DB checkout)
reports/evaluation.md full evaluation tables
Dockerfile, docker-compose.yml, docker-entrypoint.sh, start.sh, start.ps1, README.md
```

## 6. 3D cars and helmets

- **Sources** (all CC BY 4.0 on Sketchfab; credited in the README, the app footer and under each car):
  - **2026 cars:** "2026 Redbull RB22" by Dave Love SketchFab.
  - **2022–2025 cars:** "2025 alpine A525" by Abu Saif (the car only; the file is a whole pit scene).
  - **2020–2021 cars:** "Formula 1 2022 Car" by Luis Adrian V., reshaped to the 2017–21 rules: 13-inch
    wheels, no wheel covers or front-wheel winglets, 3.65 m wheelbase, full-width front wing.
  - **Helmets:** "Helmet Redbull - Max Verstappen" by Maubian.
  - "Scuderia Ferrari F1 SF23 2023" by Redgrund was used only to check proportions.
- **Preparation** (`prepare_models.py`):
  - Align each model to the app's axes from its tyres (x forward from the rear axle, y up, z sideways)
    and scale it to the era's width.
  - Split every triangle into one of eight clickable parts: front wing, nose, cockpit, sidepods, floor,
    power unit, rear wing, wheels.
  - Give every material a paint slot (primary/secondary/accent colour, carbon, rubber, metal, chrome,
    glass, light).
  - Drop all sponsor decals, numbers and original textures.
  - Turn painted textures into colour-zone masks with lettering and logos filtered out.
  - Compute a helmet seat per car.
- **In the app:** each team's livery is painted onto the shared model per era. Each driver's helmet
  design (`helmetRefs.ts`, colours and motif types from published descriptions; the artwork is our own)
  is mapped onto the reference helmet shell. Helmets are always shown from the front.
- **Rules:** no sponsor logos, no real signatures, and the cars are not presented as replicas of each
  team's actual car.

## 7. Web app pages

| Page | Shows |
|---|---|
| Overview | correct picks per season vs simple rules, driver/car/practice split, most useful inputs, histogram |
| Live | this weekend's predicted order, rebuilt after each session; latest completed weekend as fallback |
| Drivers | cards with 3D helmets; profile: record at every track, teams, driver-vs-car split |
| Teams | per team across renames: pace rank, cars and engines, teammate battles, best and worst tracks |
| Cars | every car of a season with an interactive 3D model, clickable parts, pace through the season |
| Tracks | sector map (S1/S2/S3 in red/blue/yellow) and fastest holders, sector-times table, Q1/Q2/Q3 breakdown (fastest, cut-off, knocked out, per-driver record), every driver's record there |
| What if | any driver in any car at any race |
| Sessions | season strip, predicted order vs result for any race, with reasons |
| Heatmap | average qualifying position, driver × track |

**UX:** quick search (Ctrl/⌘+K or `/`); Info "i" popovers instead of small grey text; skip-to-content
link; animated count-ups; honours reduced-motion settings; works at phone width.

## 8. Design system

- **Theme:** dark carbon background (`#09090d`) with neon accents. Brand red `#ff2a3a`; contribution
  groups driver `#1594e0`, car `#f5304f`, practice `#9b5cff`.
- **Timing colours:** pole purple `#a77bff`, Q3 green `#2fb36a`, Q2 yellow `#d6a01f`, Q1-out grey
  `#4a4a57`. Fastest times are shown in purple. Sectors: red `#f5304f`, blue `#1594e0`, yellow `#ffc906`.
- **Brand:** the name is Gridcast; the wordmark is GRID (white) CAST (red), Saira Condensed 800.
  - The logo is a forward-leaning red plate with two staggered white grid-slot brackets and speed lines.
  - The favicon uses the same mark, with a simplified 16 px version.
- **Race touches:** faint red speed streaks drift behind the pages; a solid red line under the top bar;
  a chequered flag in the footer; a start-lights loading screen.
- **Style rules:** avoid "AI-looking" touches, such as coloured edge or highlight lines on cards, glows
  on every control, and lots of small grey text. Prefer compact layouts with no half-empty panels.

## 9. Running it

```bash
docker compose up --build                       # http://localhost:8000
docker compose exec -u f1qp app f1qp-sectors    # optional: download sector data now
```

Without Docker: `./start.sh` or `.\start.ps1`. Development:

```bash
uv sync
uv run f1qp-build
uv run f1qp-serve
cd web && npm install && npm run dev
```

Other commands:
- `uv run f1qp-data`: refresh F1DB.
- `uv run f1qp-train`: evaluation report.
- `uv run f1qp-predict`: predict a past GP in the terminal.
- `uv run f1qp-live`: live weekend in the terminal.
- `uv run f1qp-sectors`: download sector data.

Environment variables:

| Variable | Meaning |
|---|---|
| `F1QP_LIVE_INTERVAL` | Seconds between live refreshes (default 900; 0 = off) |
| `F1QP_LIVE_UPDATE` | Also pull F1DB results on each refresh |
| `F1QP_SECTORS` | Background sector download (on while live updates are on) |
| `F1QP_SECTOR_DIR` | Where sector files are kept |
| `F1QP_ADMIN_TOKEN` | Enables `POST /api/live/refresh` |
| `F1QP_CORS_ORIGINS` | Allowed origins, if the front end is hosted elsewhere |
| `F1QP_STATIC_DIR` | Where the built front end is |
| `PORT` / `HOST` | Where the server listens |

**API:** `/api/meta`, `/api/overview`, `/api/drivers/{id}`, `/api/teams`, `/api/teams/{id}`, `/api/cars`,
`/api/cars/{season}/{team}`, `/api/tracks/{id}` (includes `segments` for Q1/Q2/Q3 and `sectors`),
`/api/sessions`, `/api/sessions/{race_key}`, `/api/heatmap`, `/api/swap`, `/api/live`,
`/api/live/refresh`, `/api/health`. Interactive docs at `/api/docs`.

## 10. Checks before committing

```bash
uv run pytest -q
uvx ruff@0.8.4 check f1qp tests tools
cd web && npx tsc -b && npm run build
node web/scripts/check-navigation.cjs http://127.0.0.1:8000   # with a server running; needs Playwright
```

**Conventions:**
- Keep the walk-forward and no-leakage guarantees.
- Don't edit `data/qualifying_entries.csv` by hand.
- Bump `MODELS_VERSION` (`web/src/three/modelFiles.ts`) when model files change, and `SNAP_VERSION`
  (`web/src/three/stage.ts`) when 3D rendering changes.
- Respect OpenF1's rate limit: all requests go through the paced client, and only one downloader runs
  at a time.

## 11. Known limits

- **Sector data** exists only from 2023, and only once it has been downloaded from OpenF1.
- **Shared car shapes:** every team in an era uses the same car shape in its own colours.
- **2020–21 cars:** they keep the 2022 bargeboard-free shape and lower nose.
- **Liveries:** the 2022–25 and 2020–21 cars are mostly one colour, because their source models have a
  single body material.

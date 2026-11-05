# Gridcast

**Gridcast** is a Formula 1 qualifying forecaster: it calls the grid before the cars go out. The logo is
a red, forward-leaning plate with two staggered grid-slot brackets (the painted boxes on a starting
grid) and speed lines behind it; the wordmark is GRID in white and CAST in red, set in Saira Condensed.

Predicts which 10 drivers reach Q3 (qualify in the top 10) for every Formula 1 Grand Prix, using only
information available **before** qualifying starts. It can also run live during a race weekend: after
every practice session and after qualifying (see [Live weekend predictions](#live-weekend-predictions)).

The results are served as a **web app** (FastAPI back end + React front end, one Docker image) in a
dark red-and-black theme: driver pages with 3D helmets, team breakdowns, interactive 3D cars for every
team and season,
track outlines, a
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

**Q3 chance.** Each driver also gets a probability of reaching Q3: how often drivers at the same
predicted grid position (grouped P1–3, 4–6, 7–9, 10–12, 13–15, 16+) still reached Q3 in earlier races,
from the walk-forward misses of races before this one only (`q3_probability` in `f1qp/model.py`). The
Live and Sessions pages show it in the timing colours, with 30–70% marked as too close to call. Over
2020–26 it is well calibrated (Brier score 0.136, against 0.195 for the plain yes/no picks; see
[`reports/evaluation.md`](reports/evaluation.md)).

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

## Sector times

Sector times, speed traps and car positions come from [OpenF1](https://openf1.org), which has them from
2023 on (F1DB, the main data source, has only lap times per qualifying session). For each qualifying
session `f1qp/sectors.py` keeps each driver's best S1 / S2 / S3, best lap and top speed, plus the
position trace of the session's fastest lap, in `data/live/sectors/` (a Docker volume). The trace is
fitted onto the track outline (rotation, scale, start point and direction), so the outline can be drawn in
its three real sectors; a trace that does not fit (layout change, bad data) is not drawn.

```bash
uv run f1qp-sectors               # download every missing session now
uv run f1qp-sectors --season 2026
```

Requests are paced to stay within OpenF1's free rate limit (about 30 a minute), so a full download from
2023 takes roughly 10 to 12 minutes; if OpenF1 still refuses, the session is skipped and fetched by the
next run (already saved sessions are never downloaded again). While live updates are on, the web server
also fills in missing sessions in the background (`F1QP_SECTORS=0` turns that off, `F1QP_SECTOR_DIR` moves the folder).
Tracks without downloaded sessions show the plain outline.

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

### Run the web app (no Docker needed)

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) and [Node.js LTS](https://nodejs.org), then
from the project folder run:

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

on Windows, or

```bash
./start.sh
```

on macOS/Linux. The script builds the front end when needed, prepares the Python environment, starts the
server and (on Windows) opens http://127.0.0.1:8000. Add `-NoLive` / `--no-live` to skip the live
weekend updates, or `-Port 8080` / `PORT=8080` for another port. The first start computes the
predictions, which takes about 10 seconds.

Step by step instead:

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
| **Teams** | one page per team across renames (Toro Rosso → AlphaTauri → RB → Racing Bulls…): pace rank per season and race by race, every car with its engine, teammate head-to-heads per season, strongest and weakest tracks |
| **Cars** | every car of a season ranked by pace; each car has an interactive 3D model where each part can be shown on its own with what it does and its rules, pace through the season, its drivers, and a power-unit comparison; **Compare** puts up to three cars (or one part of each) side by side |
| **Tracks** | the track map in its three timing sectors with the fastest time in each (all-time or per season), every driver's best sectors, ideal lap and top speed; every driver's record at that track, the model's score at each session there, and a Q1 / Q2 / Q3 breakdown (pick a session: fastest lap, the slowest lap that still got through, who was knocked out, and each driver's record in that session there), coloured like the position chips |
| **What if** | put any driver in any car at any race and see the predicted grid slot |
| **Sessions** | a season strip (one cell per race, shaded by correct picks) and the predicted order vs result for any race, with the reason behind each prediction |
| **Heatmap** | average qualifying position per driver × track |

All of it comes from the walk-forward run, so every prediction shown is out-of-sample.

**Quick search** (Ctrl+K, ⌘K or `/`, or the search button in the top bar) jumps to any driver, team,
track, car or page; it works with the keyboard (↑ ↓ Enter Esc).

Charts link to the detail behind them: click a season on the overview to open its sessions, a
histogram bar to list the sessions with that score, or a group (driver / car / practice) to highlight
its inputs. Numbers count up, sections and charts animate in, and cards respond to hover; all motion is
switched off for visitors who ask their system for reduced motion.

Look and feel: on a visitor's first visit the app opens with the full start sequence (five red lights
come on one by one, hold, then "lights out"); after that the start lights only show for as long as the
data takes to load, usually a split second. It is plain HTML and CSS in `index.html`, so it shows before
any JavaScript arrives, and it is skipped for visitors who ask their system for reduced motion. Behind
the pages, faint red speed streaks glide slowly and continuously across the screen (`SpeedLines.tsx`); a
red line runs under the top bar and the footer carries a chequered flag. The logo mark is also the
favicon (`public/favicon.svg`, with PNG versions for older browsers and phone home screens).
Explanations of how a chart was made sit behind small **i** buttons next to each title (hover or
focus), so the pages are not cluttered with small print.

Fonts, all self-hosted through `@fontsource` (no Google Fonts request at runtime): **Saira Condensed**
for headings, the wordmark and labels (a squared, condensed face in the style of motorsport timing
graphics), **Barlow** for body text (a slightly rounded grotesk built on the look of road signage) and
**Roboto Mono** for numbers, so positions and times line up like a timing screen.

Colours: a dark carbon background with neon accents. The three contribution groups use electric blue
(driver), neon red (car) and violet (practice), checked with a colour-vision-deficiency validator on
the dark background (blue and violet are never placed next to each other). Red also marks the model's
own numbers, against grey for the simple rules. Position chips keep the F1 timing colours (purple
pole, green Q3, yellow Q2).

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

### 3D cars

Every car is adapted from a detailed reference model (see [3D references](#3d-references)): the Alpine
A525 for the ground-effect era (2022–2025), the Red Bull RB22 for 2026, and a 2022 car reshaped
towards the 2017–2021 rules for 2020 and 2021. `tools/models/` turns them into
the app's assets (`web/public/models/`, about 0.8 MB per car):

1. keep only the car (the A525 file is a whole pit scene with a driver, mechanics' tools and a laptop);
2. line it up with the app's axes from the four tyres (rear axle at x = 0, ground at y = 0) and scale it
   to the era's width; the resulting wheelbases (3.58 m and 3.39 m) match the regulations;
3. split every triangle into one of the eight clickable parts by where it sits on the car;
4. give every material a paint slot (team primary, secondary or accent colour, carbon, rubber, metal,
   chrome, glass, light) and drop sponsor decals, numbers and the original textures;
5. turn painted textures into colour-zone masks (primary / secondary / accent / carbon) with lettering
   and logos filtered out, so the app can paint every team's livery onto the same model;
6. for 2020–2021 only, reshape the 2022 car to that era's rules: 13-inch wheels (330 mm rims, 660 mm
   tyres instead of 457 mm and 720 mm), no wheel covers and no winglets over the front wheels, the
   wheelbase stretched to 3.65 m, and the front wing widened to the full 2.0 m. That era's bargeboards
   and higher noses are not added;
7. simplify and compress with meshoptimizer (`tools/models/optimize.sh`).

```bash
bpyenv/bin/python tools/models/blend2glb.py "<refs>/f2022/source/Ferrari Mission Winnow.blend" <refs>/f2022/f2022.glb
uv run tools/models/prepare_models.py --refs <unpacked models> --out build/models
tools/models/optimize.sh build/models web/public/models
```

Each car is painted in its team's colours for that season (`f1qp/cars.py`) and carries the driver's
helmet in the cockpit. You can rotate and zoom it, jump to front, side, top or rear views, and click any
of eight parts: front wing, nose, cockpit and halo, sidepods, floor, power unit, rear wing, and tyres
and suspension. A selected part is shown solid while the rest of the car fades to a see-through outline;
the camera stays on the whole car. Click the part again to show the whole car. The side panel says what the part does, the
main public FIA rules for it in that era, notes for single seasons, and the car-level numbers
(`PART_INFO` and `SEASON_NOTES` in `web/src/three/parts.ts`). Each car and each part also has physics facts worked out from
the season's rules with simple formulas, each showing how it was calculated (`web/src/three/physics.ts`). Every team of an era shares the reference
car's shape, so it shows the era's car, not each team's own design.

Finish (`web/src/three/models.ts`): the 2020–21 and 2022–25 models, whose sources have one body
material, get a generic two-tone split in the team's colours (lower body in the secondary colour with
a thin accent line); the 2026 model keeps its own colour zones. Tyre sidewalls carry a red compound
band. Both are drawn in the shader from the car's coordinates. Visible rule changes within an era are
applied per season: in 2021 the floor is cut back in front of the rear tyres. Smaller changes (such as
the 2023 floor edge) are described in the part notes only.

**Compare** (`/cars/compare?cars=2024.ferrari,2021.mercedes&part=floor`, `web/src/pages/Compare.tsx`):
up to three cars from any seasons, the whole car or one part, with cameras that move together
(`web/src/three/sync.ts`), and a side-by-side table of the era rules for that part, the era
dimensions and the car-level numbers. Cars of the same era share one shape, so the page says so and
the differences are in the numbers. If a model cannot be loaded, a simplified car built in code
(`web/src/three/car.ts`) is shown instead. The car list shows still renders of the same models, made by one
hidden renderer, because browsers allow only about 16 live 3D views per page; renders are kept in the
browser's Cache Storage. three.js and the models load only on pages that show 3D.
Those pages start downloading their model as soon as they open, in parallel with the 3D code (one
download, shared with the 3D loader), and each team livery is painted once per car model. The 3D code
is also fetched in the background after the first page, except on connections where the visitor asked
to save data or that are very slow. The driver's helmet is seated from each model's own geometry: in
front of the roll hoop, its centre just above the cockpit rim.

### Helmets and names

Every driver has a 3D helmet (`web/src/three/helmet.ts`), always shown from the front. The shell,
visor and trim come from a reference helmet model (see [3D references](#3d-references)); its original
paint and sponsor logos are not used. The shell gets new texture coordinates (angle around the head,
position front to back) so each driver's own paint design fits it. If the model cannot be loaded, a
helmet lofted in code is used instead. On a driver's profile the helmet turns a little toward the
pointer and sways gently when idle.

Paint comes from published descriptions of each driver's 2026 race helmet
(`web/src/three/helmetRefs.ts`): PlanetF1's 2026 helmet round-up, Sky Sport Italia, Motorsport.com's
2026 guide, auto motor und sport, Red Bull, and official replica listings. Only the colours and the
kind of motif come from those sources, for example "red upper half, white lower half" or
"Argentinian flag wrap with triangles on top". The parts you see from the front carry the details:
stripes over the crown, a brow band above the visor, and flag colours across the chin bar (Italy for
Antonelli, Spain for Sainz and Alonso, Argentina for Colapinto, Brazil for Bortoleto). The artwork itself is our own simplified version, not a
copy. The profile page shows each description. Drivers with no description found (Hülkenberg,
Bottas, Pérez, Tsunoda, anyone not on the 2026 grid) are painted in their team's colours, and the page
says so. To refine a helmet, edit its entry in `helmetRefs.ts`.

Card thumbnails are rendered once per helmet by a shared off-screen renderer, only for cards on
screen. All helmets share one geometry, so only the paint is rebuilt for each driver.

Driver cards show the name in a handwritten-style font (Mrs Saint Delafield). It is a font, not the
driver's real signature: we do not reproduce real signatures.

### Driver and track graphics

The app uses no photos. In tables, drivers are shown as their initials on their team's colour. The colour follows
the season (`/api/meta` gives each driver's team per season), so Hamilton is Mercedes teal up to 2024
and Ferrari red from 2025. Each driver card and profile has a season strip in those colours. Tracks are
drawn from the outlines in [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) (MIT,
bundled in `f1qp/assets/`). All graphics are our own or openly licensed.

### 3D references

The cars and the helmet are adapted from these Sketchfab models, all licensed under
[CC BY 4.0](http://creativecommons.org/licenses/by/4.0/). Changes: repainted in each team's or driver's
colours, sponsor decals, numbers and original textures removed, props removed, simplified and
compressed.

- "2026 Redbull RB22" (https://skfb.ly/pOvxI) by Dave Love SketchFab: 2026 cars
- "2025 alpine A525" (https://skfb.ly/pHXyZ) by Abu Saif: 2022–2025 cars
- "Helmet Redbull - Max Verstappen" (https://skfb.ly/pEDBZ) by Maubian: helmets
- "Formula 1 2022 Car" (https://skfb.ly/owxuQ) by Luis Adrian V.: 2020–2021 cars, reshaped as
  described above (driver figure removed)
- "Scuderia Ferrari F1 SF23 2023" (https://skfb.ly/oRV79) by Redgrund: used to check proportions only

## Deployment

One Docker image holds the API, the built front end and the precomputed predictions. Docker must be
running first: on Windows and macOS, open **Docker Desktop** and wait until it shows "Engine running".
Otherwise `docker compose` fails with "failed to connect to the docker API … dockerDesktopLinuxEngine".

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
container starts as root only long enough for `docker-entrypoint.sh` to give those volume folders to the
app user (new Docker volumes are created owned by root, which used to make the F1DB download fail with
`git clone … exit status 128`), then runs the server as a non-root user. It has a health check
(`GET /api/health`).

If live timing cannot be reached (no internet, OpenF1 down, or live updates switched off), the Live page
says so in one line and shows the most recent completed weekend instead of an error.

**Speed:** the server answers repeat API requests from an in-memory cache (cleared whenever the
predictions are rebuilt) and requests the main pages once at start-up, so the first visitor does not pay
for them. Built JavaScript and CSS files have content hashes in their names and are cached by the
browser for a year; the 3D helmet and car thumbnails are rendered once and kept in the browser's Cache
Storage, so they appear immediately on later visits.

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
f1qp/server.py      FastAPI app: JSON API (drivers, teams, cars, tracks, sessions, what-if, live), serves web/dist
f1qp/cars.py        chassis names, liveries and regulation eras per team and season
f1qp/tracks.py      track outlines as SVG paths (MIT GeoJSON in f1qp/assets/)
f1qp/names.py       display names and team colours
web/                React + TypeScript front end (Vite); 3D in web/src/three (cars, helmets, references)
web/public/models/  prepared 3D models (CC BY 4.0 sources, see 3D references)
tools/models/       scripts that prepare those models from the downloaded originals
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

# F1 Qualifier Predictor

Predicts which 10 drivers reach Q3 (qualify in the top 10) for every Formula 1 Grand Prix, using only
information available **before** qualifying starts. It can also run live during a race weekend: after
every practice session and after qualifying (see [Live weekend predictions](#live-weekend-predictions)).

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

The project is managed with [uv](https://docs.astral.sh/uv/). `uv sync` creates `.venv/` with the
pinned dependencies from `uv.lock`, including the dev group (pytest).

```bash
uv sync
uv run f1qp-train                  # walk-forward evaluation, write reports/evaluation.md, save the model
uv run f1qp-dashboard              # build reports/dashboard.html (interactive results)
uv run f1qp-predict 2024 monaco    # one race, predicted vs actual
uv run f1qp-predict 2026 19        # by round number
uv run f1qp-data                   # re-download F1DB and rebuild data/qualifying_entries.csv (2010-now)
uv run f1qp-live                   # live prediction for the next race (see below)
uv run pytest
```

To add a dependency, run `uv add <package>` (or `uv add --dev <package>`) and commit
`pyproject.toml` and `uv.lock`.

## Dashboard

`reports/dashboard.html` is a single self-contained file. Open it in a browser. Every prediction in it
is out-of-sample: it comes from the walk-forward run, where the model is retrained before each session.

- **Overview:** correct picks per season, the model vs the simple rules, how often each score happened,
  and feature importance.
- **Drivers by track:** pick a driver to see every track they raced at: visits, average and best
  qualifying position, Q3 rate, poles, a colour-coded result chip for each season, the model's average
  predicted position, and how often the model called it right.
- **Tracks:** the same stats for every driver at one track, plus the model's score at each session there.
- **Heatmap:** average qualifying position for each driver at each track.
- **Sessions:** the model's full predicted order for any race, with the actual result.

All views can be filtered by season.

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
f1qp/data.py       download F1DB + build data/qualifying_entries.csv
f1qp/features.py   leakage-free pre-qualifying features
f1qp/model.py      models, baselines, metrics, permutation importance
f1qp/train.py      walk-forward evaluation, saves final model
f1qp/predict.py    predict any past GP vs. the actual result
f1qp/live.py       live predictions for the next race (F1DB + OpenF1)
f1qp/dashboard.py  build the interactive HTML dashboard (template: dashboard_template.html)
reports/           evaluation report + dashboard.html
data/live/         weekends saved by f1qp-live
tests/             data sanity, leakage and live (offline, fake OpenF1) tests
```

## Ideas for next steps

- Predict the exact grid order (ranking model, e.g. LightGBM LambdaRank) instead of only top 10.
- Add weather (wet qualifying is where the model fails most), long-run vs. short-run practice pace and
  car upgrade timing.
- Use FastF1 telemetry for practice sector times, if your environment can reach the F1 live-timing API.

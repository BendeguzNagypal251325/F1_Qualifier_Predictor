# F1 Qualifier Predictor (2020–2025)

Predicts which 10 drivers reach Q3 (qualify in the top 10) for every Formula 1 Grand Prix from
2020 to 2025, using only information available **before** qualifying starts.

## Results

Walk-forward evaluation, where the model is retrained before every session on all earlier sessions,
over all 131 qualifying sessions from 2020 to 2025:

| Method | Correct picks / 10 | ROC AUC |
|---|---|---|
| **Logistic regression (this model)** | **7.92** | **0.881** |
| Championship order | 7.79 | – |
| Rolling form (last 3 qualis) | 7.70 | – |
| Last practice session order | 7.56 | – |
| Previous qualifying order | 7.40 | – |

On the untouched 2025 hold-out test set (trained on 2020–2023, model chosen on 2024), the model gets
**7.83 / 10** (AUC 0.872). The best heuristic gets 7.71. Full tables, per-season numbers and feature
importance are in [`reports/evaluation.md`](reports/evaluation.md).

The top 6–7 cars are easy to call. Nearly all of the misses come from the midfield fight for P8–P12,
where the gaps are often under a tenth.

## Quick start (uv)

The project is managed with [uv](https://docs.astral.sh/uv/). `uv sync` creates `.venv/` with the
pinned dependencies from `uv.lock`, including the dev group (pytest).

```bash
uv sync
uv run f1qp-train                  # evaluate, write reports/evaluation.md, save models/top10_model.joblib
uv run f1qp-dashboard              # build reports/dashboard.html (interactive results)
uv run f1qp-predict 2024 monaco    # one race, predicted vs actual
uv run f1qp-predict 2025 7         # by round number
uv run f1qp-data                   # re-download F1DB and rebuild data/qualifying_entries.csv
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
  P(Q3), and how often the model called it right.
- **Tracks:** the same stats for every driver at one track, plus the model's score at each session there.
- **Heatmap:** average qualifying position for each driver at each track.
- **Sessions:** the model's full predicted order for any race, with the actual result.

All views can be filtered by season.

Example output (`uv run f1qp-predict 2024 monaco`). ✓ means the driver was correctly placed
inside or outside the top 10:

```
 1. max-verstappen         red-bull       P(top10)=0.98   actual P6  ✓
 2. charles-leclerc        ferrari        P(top10)=0.97   actual P1  ✓
 ...
10. yuki-tsunoda           rb             P(top10)=0.49   actual P8  ✓
    ----------------------------------------------------------------
11. lance-stroll           aston-martin   P(top10)=0.29   actual P13 ✓
...
Correct top-10 picks: 8/10
```

## Data

**Is this FastF1?** No. FastF1 reads the F1 live-timing API, which the cloud environment this was built
in cannot reach. F1DB has every session result, practice classification and standings table we need.
FastF1 adds telemetry and sector times, so it would be a good next step on a machine with normal
internet access.

[F1DB](https://github.com/f1db/f1db) (CC BY 4.0). `data/qualifying_entries.csv` is committed, so
no download is needed. To rebuild it from the latest F1DB (sparse git clone, seasons 2019–2025):

```bash
uv run f1qp-data
```

One row per driver per qualifying session: classification, Q1–Q3 times, FP1–FP3 position and gap
to fastest, and driver and constructor standings after the previous round. 2019 is included only to
give 2020 rows rolling-form history. It is never used as an evaluation target.

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

- **Target:** `top10` (classified P1–P10 in qualifying; NC/DSQ count as outside).
- **Models compared:** logistic regression (median imputation with missing-indicators, standardised)
  and histogram gradient boosting. Logistic regression was selected on the 2024 validation season;
  boosting overfits with this little data (~2.6k rows).
- **Per-session pick:** the 10 drivers with the highest probability. This always gives exactly 10 picks.

## Project layout

```
f1qp/data.py       download F1DB + build data/qualifying_entries.csv
f1qp/features.py   leakage-free pre-qualifying features
f1qp/model.py      models, baselines, metrics, permutation importance
f1qp/train.py      hold-out + walk-forward evaluation, saves final model
f1qp/predict.py    predict any 2020–2025 GP vs. the actual result
f1qp/dashboard.py  build the interactive HTML dashboard (template: dashboard_template.html)
reports/           evaluation report + dashboard.html
tests/             data sanity + leakage tests
```

## Ideas for next steps

- Predict the exact grid order (ranking model, e.g. LightGBM LambdaRank) instead of only top 10.
- Add weather (wet qualifying is where the model fails most), long-run vs. short-run practice pace and
  car upgrade timing.
- Use FastF1 telemetry for practice sector times, if your environment can reach the F1 live-timing API.

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

## Quick start

```bash
pip install -r requirements.txt
python -m f1qp.train              # evaluate + write reports/evaluation.md + save models/top10_model.joblib
python -m f1qp.predict 2024 monaco
python -m f1qp.predict 2025 7     # by round number
pytest -q
```

Example output (`python -m f1qp.predict 2024 monaco`). ✓ means the driver was correctly placed
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

[F1DB](https://github.com/f1db/f1db) (CC BY 4.0). `data/qualifying_entries.csv` is committed, so
no download is needed. To rebuild it from the latest F1DB (sparse git clone, seasons 2019–2025):

```bash
python -m f1qp.data
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
reports/           generated evaluation report
tests/             data sanity + leakage tests
```

## Ideas for next steps

- Predict the exact grid order (ranking model, e.g. LightGBM LambdaRank) instead of only top 10.
- Add weather (wet qualifying is where the model fails most), long-run vs. short-run practice pace and
  car upgrade timing.
- Use FastF1 telemetry for practice sector times, if your environment can reach the F1 live-timing API.

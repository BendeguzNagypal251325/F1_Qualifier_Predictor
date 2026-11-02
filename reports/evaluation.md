# Evaluation: F1 top-10 qualifying predictor (Ridge regression)

Ridge regression predicts each driver's qualifying position; the 10 best predicted drivers are the
predicted Q3. Walk-forward: before every session the model is retrained on all earlier sessions
(training rows from 2019 on), so each real result is added before the next race is predicted.

**Correct / 10** = how many of the 10 picks really reached Q3.
**MAE** = average number of places the predicted position is off.

## 2026 season (19 races so far)

| Method | Correct / 10 | Perfect sessions | Worst session | MAE (all) | MAE (top 10) |
|---|---|---|---|---|---|
| **Ridge regression** | 8.95 | 2/19 | 8 | 2.00 | 2.02 |
| Previous quali order | 8.26 | 1/19 | 6 | 2.94 | 3.02 |
| Rolling form (last 3 qualis) | 8.42 | 1/19 | 7 | 2.64 | 2.55 |
| Championship order | 8.53 | 1/19 | 7 | 2.37 | 2.19 |
| Last practice order | 8.63 | 2/19 | 8 | 2.15 | 2.08 |

## All seasons (same walk-forward)

| Method | Correct / 10 | Perfect sessions | Worst session | MAE (all) | MAE (top 10) |
|---|---|---|---|---|---|
| 2020 | 8.12 | 2/17 | 7 | 2.27 | 2.16 |
| 2021 | 8.14 | 1/22 | 6 | 2.44 | 2.23 |
| 2022 | 7.91 | 0/22 | 6 | 2.87 | 2.46 |
| 2023 | 7.50 | 0/22 | 5 | 3.52 | 3.16 |
| 2024 | 8.00 | 1/24 | 6 | 2.79 | 2.42 |
| 2025 | 7.96 | 0/24 | 6 | 3.14 | 2.70 |
| 2026 | 8.95 | 2/19 | 8 | 2.00 | 2.02 |
| **2020-2026** | 8.06 | 6/150 | 5 | 2.75 | 2.47 |

## Feature importance (permutation, 2026)

Drop in correct picks per 10 when the feature is shuffled.

| Feature | Drop |
|---|---|
| fp_last_pos | +0.463 |
| con_season_pos_mean | +0.284 |
| con_pos_mean3 | +0.274 |
| fp_best_pos | +0.232 |
| constructor_champ_pos_before | +0.221 |
| drv_pos_mean5 | +0.221 |
| drv_season_pos_mean | +0.211 |
| fp_mean_gap_pct | +0.179 |
| drv_career_sessions | +0.158 |
| driver_points_before | +0.147 |
| drv_circuit_last_pos | +0.147 |
| driver_champ_pos_before | +0.147 |

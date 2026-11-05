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

## Q3 probability: calibration (2020-2026)

Each driver's chance of reaching Q3: the share of earlier races' residuals (real position minus
predicted grid position, grouped by predicted position P1-3, 4-6, 7-9, 10-12, 13-15, 16+) that
would still put the driver in the top 10. Only races before the predicted one are used, starting
once 10 earlier races exist (140 races, 2827 driver entries).

| Predicted probability | Entries | Mean predicted | Observed Q3 rate |
|---|---|---|---|
| 0%-10% | 616 | 0.03 | 0.07 |
| 10%-20% | 283 | 0.15 | 0.14 |
| 20%-30% | 160 | 0.24 | 0.31 |
| 30%-40% | 183 | 0.35 | 0.32 |
| 40%-50% | 119 | 0.47 | 0.41 |
| 50%-60% | 262 | 0.57 | 0.56 |
| 60%-70% | 201 | 0.66 | 0.60 |
| 70%-80% | 172 | 0.75 | 0.82 |
| 80%-90% | 358 | 0.86 | 0.85 |
| 90%-100% | 473 | 0.96 | 0.95 |

Brier score (mean squared error of the probability against reaching Q3 or not; lower is better):

| Forecast | Brier |
|---|---|
| **Q3 probability (this model)** | **0.136** |
| Model's yes/no picks (top 10 predicted = 1) | 0.195 |
| Championship order picks (top 10 = 1) | 0.214 |
| Base rate (10 / field size for everyone) | 0.250 |

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

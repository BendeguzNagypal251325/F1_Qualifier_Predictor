# Evaluation: F1 top-10 qualifying predictor (2020-2025)

Each session the model picks the 10 drivers with the highest probability of reaching Q3. 
**Correct / 10** is the average number of those picks that actually qualified top 10.

Data: 131 qualifying sessions, 2614 driver entries.

## 1. Hold-out (train 2020-2023)

### Validation: 2024

| Method | Correct / 10 | Perfect sessions | Worst session | ROC AUC | Log loss |
|---|---|---|---|---|---|
| logreg | 8.04 | 2/24 | 6 | 0.887 | 0.426 |
| gbm | 8.04 | 1/24 | 5 | 0.879 | 0.446 |
| previous_quali | 7.42 | 0/24 | 5 | - | - |
| rolling_form_3 | 7.62 | 1/24 | 6 | - | - |
| championship | 8.04 | 1/24 | 5 | - | - |
| last_practice | 7.58 | 1/24 | 5 | - | - |

Selected model: **logreg**

### Test: 2025 (untouched until now)

| Method | Correct / 10 | Perfect sessions | Worst session | ROC AUC | Log loss |
|---|---|---|---|---|---|
| logreg | 7.83 | 0/24 | 6 | 0.872 | 0.445 |
| previous_quali | 7.58 | 1/24 | 5 | - | - |
| rolling_form_3 | 7.71 | 1/24 | 6 | - | - |
| championship | 7.17 | 1/24 | 5 | - | - |
| last_practice | 7.71 | 0/24 | 6 | - | - |

## 2. Walk-forward (retrained before every session)

| Method | Correct / 10 | Perfect sessions | Worst session | ROC AUC | Log loss |
|---|---|---|---|---|---|
| 2020 | 8.18 | 2/17 | 7 | 0.901 | 0.402 |
| 2021 | 8.14 | 1/22 | 7 | 0.906 | 0.388 |
| 2022 | 7.91 | 0/22 | 6 | 0.887 | 0.425 |
| 2023 | 7.59 | 1/22 | 5 | 0.817 | 0.551 |
| 2024 | 7.92 | 1/24 | 6 | 0.888 | 0.427 |
| 2025 | 7.88 | 0/24 | 6 | 0.874 | 0.440 |
| **2020-2025** | 7.92 | 5/131 | 5 | 0.881 | 0.440 |

Baselines over the same 2020-2025 sessions:

| Method | Correct / 10 | Perfect sessions | Worst session | ROC AUC | Log loss |
|---|---|---|---|---|---|
| previous_quali | 7.40 | 2/131 | 5 | - | - |
| rolling_form_3 | 7.70 | 3/131 | 5 | - | - |
| championship | 7.79 | 7/131 | 5 | - | - |
| last_practice | 7.56 | 3/131 | 4 | - | - |

## Feature importance (permutation, 2025 test set)

Drop in correct picks per 10 when the feature is shuffled.

| Feature | Drop |
|---|---|
| fp_last_pos | +0.367 |
| drv_pos_mean5 | +0.067 |
| drv_vs_teammate5 | +0.058 |
| fp_best_pos | +0.042 |
| constructor_points_before | +0.033 |
| driver_points_before | +0.025 |
| drv_career_sessions | +0.017 |
| con_season_pos_mean | +0.017 |
| drv_season_pos_mean | +0.000 |
| con_pace_gap_mean3 | +0.000 |
| drv_pos_last | -0.017 |
| sprint_weekend | -0.017 |

"""F1 top-10 qualifying predictor (2020-2025)."""

SEASONS = list(range(2020, 2026))
# One extra season of history so 2020 rows have rolling-form features.
HISTORY_SEASONS = [2019] + SEASONS

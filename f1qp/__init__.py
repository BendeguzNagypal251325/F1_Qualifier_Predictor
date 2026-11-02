"""F1 top-10 qualifying predictor (Ridge regression, trained on 2019+ data, live weekend updates)."""

from datetime import date

CURRENT_SEASON = date.today().year
# Seasons the walk-forward evaluation and dashboard cover (seasons without data are skipped).
SEASONS = list(range(2020, CURRENT_SEASON + 1))
# Training rows start here (tested 2007-2024 as start years; 2016-2020 were equally good, 2019 best on 2026).
TRAIN_FROM = 2019
# History used only to build features (experience, past results at each track, rolling form).
# Tested 2006-2018: history from 2010 gave the best results; going further back added nothing.
HISTORY_FROM = 2010
HISTORY_SEASONS = list(range(HISTORY_FROM, CURRENT_SEASON + 1))

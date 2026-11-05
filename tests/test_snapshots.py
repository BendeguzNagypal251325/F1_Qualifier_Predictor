"""Frozen live predictions: write-once, never after qualifying starts."""

import logging
from datetime import datetime, timezone

import pytest

from f1qp import snapshots


@pytest.fixture
def snapdir(tmp_path, monkeypatch):
    monkeypatch.setattr(snapshots, "SNAP_DIR", tmp_path)
    return tmp_path


def _snap(used=("Practice 1", "Practice 2"), quali="2026-11-21T04:00:00+00:00", first="max-verstappen"):
    drivers = [first] + [f"driver-{i}" for i in range(2, 21)]
    return {"race_key": "2026-21-las-vegas", "season": 2026, "round": 21, "grand_prix": "las-vegas", "circuit": "las-vegas",
            "date": "2026-11-22", "sessions_used": list(used), "qualifying_done": False, "model": "full (with practice)",
            "qualifying_start": quali,
            "rows": [{"pred_pos": i + 1, "driver_id": d, "constructor_id": "x", "q3_prob": 0.5} for i, d in enumerate(drivers)]}


BEFORE = datetime(2026, 11, 20, 20, 0, tzinfo=timezone.utc)
AFTER = datetime(2026, 11, 21, 4, 0, 1, tzinfo=timezone.utc)


def test_snapshot_written_once_and_never_overwritten(snapdir):
    path = snapshots.freeze(_snap(), now=BEFORE)
    assert path == snapdir / "2026-21-las-vegas" / "fp2.json"
    first = path.read_bytes()
    # a later refresh with a different prediction for the same session must not replace it
    assert snapshots.freeze(_snap(first="lando-norris"), now=BEFORE.replace(hour=21)) is None
    assert path.read_bytes() == first
    data = snapshots.load_race("2026-21-las-vegas")[0]
    assert data["created_at"] == "2026-11-20T20:00:00+00:00" and data["rows"][0]["driver_id"] == "max-verstappen"
    # the next practice session gets its own file
    assert snapshots.freeze(_snap(used=("Practice 1", "Practice 2", "Practice 3")), now=BEFORE.replace(hour=23)).name == "fp3.json"
    assert [s["session"] for s in snapshots.load_race("2026-21-las-vegas")] == ["fp2", "fp3"]
    assert not list(snapdir.rglob(".tmp-*"))  # no temporary files left behind


def test_snapshot_after_qualifying_start_is_refused(snapdir, caplog):
    with caplog.at_level(logging.WARNING, logger="f1qp.snapshots"):
        assert snapshots.freeze(_snap(used=("Practice 1", "Practice 2", "Practice 3")), now=AFTER) is None
    assert "refused: qualifying started" in caplog.text
    assert not (snapdir / "2026-21-las-vegas" / "fp3.json").exists()
    # unknown qualifying start: refused too; before FP1: nothing to freeze
    with caplog.at_level(logging.WARNING, logger="f1qp.snapshots"):
        assert snapshots.freeze(_snap(quali=None), now=BEFORE) is None
    assert "qualifying start time is unknown" in caplog.text
    assert snapshots.freeze(_snap(used=()), now=BEFORE) is None
    assert snapshots.races() == []


def test_score_counts_correct_picks():
    rows = [{"pred_pos": i + 1, "driver_id": f"d{i}"} for i in range(20)]
    actual = {f"d{i}": (i + 2 if i < 9 else (1 if i == 15 else i + 2)) for i in range(20)}  # d15 surprise pole, d9 out
    sc = snapshots.score(rows, actual)
    assert sc["correct"] == 9 and sc["missed"] == ["d9"] and sc["surprises"] == ["d15"]
    assert snapshots.score(rows, {}) is None

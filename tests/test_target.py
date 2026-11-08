"""The model's target is the qualifying classification, not the starting grid or the race result."""

from f1qp.data import load_entries
from f1qp.features import TARGET


def test_target_is_the_qualifying_classification():
    e = load_entries(include_live=False)
    assert TARGET == "quali_pos"
    assert (e["top10"] == (e["quali_pos"] <= 10)).all()

    def pos(season, gp, driver):
        return int(e[(e.season == season) & (e.grand_prix == gp) & (e.driver_id == driver)]["quali_pos"].iloc[0])

    # grid penalties do not change the target: qualified P1 / P12, started the race P11 / P17
    assert pos(2024, "belgium", "max-verstappen") == 1
    assert pos(2024, "sao-paulo", "max-verstappen") == 12


def test_q3_lap_times_follow_the_target_order():
    e = load_entries(include_live=False)
    top = e[(e["quali_pos"] <= 10) & e["q3_s"].notna()]
    for _, g in top.groupby("race_key"):
        assert list(g.sort_values("q3_s")["driver_id"]) == list(g.sort_values("quali_pos")["driver_id"])

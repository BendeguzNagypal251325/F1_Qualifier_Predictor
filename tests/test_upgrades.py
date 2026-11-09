"""Car upgrades from the FIA car presentation documents: reading the pages, matching races, and the API."""

from datetime import date

import pandas as pd

from f1qp import upgrades as U

HEADER_2025 = """Updated
component
Primary reason
for update
Geometric differences compared to
previous version
Brief description on how the update works
(min 20, max 100 words)
"""


def test_event_dates():
    assert U.event_dates("2025 SPANISH GRAND PRIX\n30 May - 01 June 2025\nThe FIA") == (date(2025, 5, 30), date(2025, 6, 1))
    assert U.event_dates("2025 ABU DHABI GRAND PRIX\n05 - 07 December 2025\n") == (date(2025, 12, 5), date(2025, 12, 7))
    assert U.event_dates("2026 AUSTRIAN GRAND PRIX\n26 - 28 Jun 2026\n") == (date(2026, 6, 26), date(2026, 6, 28))
    # no year on the date line: it comes from the title
    assert U.event_dates("2024 QATAR GRAND PRIX\n29 November - 01 December\n") == (date(2024, 11, 29), date(2024, 12, 1))
    assert U.event_dates("Document 8") is None


def test_team_names_follow_the_season():
    assert U.team_id("Visa Cash App RB F1 TEAM", 2024) == "rb"
    assert U.team_id("Visa Cash App Racing Bulls", 2025) == "racing-bulls"
    assert U.team_id("ORACLE RED BULL RACING", 2024) == "red-bull"
    assert U.team_id("Stake F1 Team KICK Sauber", 2025) == "kick-sauber"
    assert U.team_id("Audi Revolut F1 Team", 2026) == "audi"
    assert U.team_id("MONEYGRAM HAAS F1 TEAM", 2025) == "haas"
    assert U.team_id("The FIA Formula One Media Delegate", 2025) is None


def test_team_page_with_heading_and_wrapped_rows():
    page = ("Car Presentation – Spanish Grand Prix\nVisa Cash App Racing Bulls\n" + HEADER_2025 +
            "1 Front Wing Performance - \nFlow Conditioning \nThe elements of the mainplane are new. \nThe centre section is loaded further.\n"
            "2 Front Wing \nEndplate \nPerformance - \nFlow Conditioning \nThe connection between the tips has been updated.\n"
            "3 Nose Performance - \nFlow Conditioning \nThe lower surface of the nose has been raised.\n")
    name, rest = U._team_on_page(page, 2025)
    assert name == "Visa Cash App Racing Bulls"
    parts = U.parse_rows(rest)
    assert [p["part"] for p in parts] == ["Front Wing", "Front Wing Endplate", "Nose"]
    assert all(p["reason"] == "Performance - Flow Conditioning" for p in parts)
    assert parts[2]["description"].startswith("The lower surface of the nose")


def test_documents_without_headings_heading_at_the_bottom_and_grouped_rows(tmp_path):
    # early 2024: the team name is the first line; 2025: the heading can come out last; grouped rows share a reason
    pages = [
        "2024 SPANISH GRAND PRIX\n21 - 23 June 2024\n",
        "\nSCUDERIA FERRARI\nUpdated component Primary reason for update Geometric differences compared to previous version  "
        "Brief description on how the update works\n1 Rear Wing Circuit specific - Drag Range Higher downforce top rear wing\n",
        "2 Front Wing \n3 Nose \n4 Floor Body \nPerformance - \nLocal Load \nReduced keel volume and new front floor.\n",
        HEADER_2025 + "1 Floor Body Performance - \nLocal Load \nCentral floor re-shaped.\nCar Presentation – Spanish Grand Prix\nMONEYGRAM HAAS F1 TEAM",
        "Car Presentation – Spanish Grand Prix\nWilliams Racing\n\nNo updates submitted for this event.\n",
    ]
    blocks = []
    for text in pages[1:]:
        found = U._team_on_page(text, 2024)
        if found:
            blocks.append([found[0], found[1]])
        else:
            blocks[-1].append(text)  # page 3 continues Ferrari's table
    assert [b[0] for b in blocks] == ["SCUDERIA FERRARI", "MONEYGRAM HAAS F1 TEAM", "Williams Racing"]
    ferrari = U.parse_rows("\n".join(blocks[0][1:]))
    assert [(p["n"], p["part"]) for p in ferrari] == [(1, "Rear Wing"), (2, "Front Wing"), (3, "Nose"), (4, "Floor Body")]
    assert ferrari[1]["reason"] == ferrari[3]["reason"] == "Performance - Local Load"
    assert ferrari[0]["reason"] == "Circuit specific - Drag Range"
    assert U.parse_rows(blocks[1][1])[0]["part"] == "Floor Body"


def test_teams_own_reason_wording_maps_to_the_fia_categories():
    body = ("1 Front suspension Flow conditioning Revised inboard fairings on the top wishbone\n"
            "2 Cooling Louvres Cooling  Reduced span for the medium levels of cooling\n"
            "3 Brake Cooling Duct Circuit specific - Cooling Range Smaller inlet\n")
    parts = U.parse_rows(body)
    assert [(p["part"], p["reason"]) for p in parts] == [
        ("Front Suspension", "Performance - Flow Conditioning"),
        ("Cooling Louvres", "Circuit specific - Cooling Range"),
        ("Brake Cooling Duct", "Circuit specific - Cooling Range"),
    ]


def test_effects_compare_the_races_before_and_after():
    trend = [{"race_key": f"r{i}", "round": i, "gp": f"GP {i}", "gap": g} for i, g in enumerate([1.0, 1.2, 1.1, 0.6, 0.5, 0.7, 0.4], 1)]
    ups = pd.DataFrame([{"race_key": "r4", "part": "Floor Body", "reason": "Performance - Local Load", "description": "x"},
                        {"race_key": "r4", "part": "Floor Edge", "reason": "Performance - Local Load", "description": "y"},
                        {"race_key": "r7", "part": "Rear Wing", "reason": "Circuit specific - Drag Range", "description": "z"}])
    e = U.effects(trend, ups)
    assert [x["round"] for x in e] == [4, 7] and len(e[0]["parts"]) == 2
    assert e[0]["before"] == 1.1 and e[0]["after"] == 0.6 and e[0]["change"] == -0.5  # mean of R1-3 vs R4-6
    assert e[1]["after"] == 0.4  # last race of the data: only the races that exist


def test_upgrades_csv_covers_2024_on():
    df = U.load()
    assert set(df["season"]) >= {2024, 2025} and df["season"].min() >= U.FIRST_SEASON
    assert df["reason"].str.match(r"^(Performance|Circuit specific|Reliability|Other)").all()
    assert (df["description"].str.len() > 0).all()


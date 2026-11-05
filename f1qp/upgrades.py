"""Car upgrades per team and race, from the FIA's "Car Presentation Submissions" documents.

Before every Grand Prix since 2024 the FIA publishes one PDF in which each team lists the parts it brought
(component, the FIA's reason category, and a short description). This module downloads those PDFs (cached
in ``data/raw/fia/``), reads them, and writes one row per new part to ``data/upgrades.csv``:

    season, round, race_key, team, part, reason, description

The documents are published on the Friday of the race weekend, before qualifying, so a race's upgrades
are known before its qualifying result.

    uv run f1qp-upgrades                 # download missing documents, then rebuild data/upgrades.csv
    uv run f1qp-upgrades --season 2026
    uv run f1qp-upgrades --offline       # only rebuild the CSV from the cached PDFs
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

import pandas as pd

log = logging.getLogger("f1qp.upgrades")

ROOT = Path(__file__).resolve().parent.parent
PDF_DIR = Path(os.environ.get("F1QP_FIA_DIR", str(ROOT / "data" / "raw" / "fia")))
CSV = Path(os.environ.get("F1QP_UPGRADES_CSV", str(ROOT / "data" / "upgrades.csv")))
FIA = "https://www.fia.com"
DOCS = FIA + "/documents/championships/fia-formula-one-world-championship-14"
FIRST_SEASON = 2024  # the FIA site has car presentation documents from 2024 on
PAUSE_S = 1.5  # between requests to the FIA site
COLUMNS = ["season", "round", "race_key", "team", "part", "reason", "description"]


# ---------------------------------------------------------------- download


def _get(url: str) -> bytes:
    """GET with a few retries; one request at a time, with a pause before each."""
    for attempt in range(3):
        time.sleep(PAUSE_S)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Gridcast (F1 qualifying forecasts)"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            if e.code == 404 or attempt == 2:
                raise
        except urllib.error.URLError:
            if attempt == 2:
                raise
        time.sleep(3 * (attempt + 1))
    raise RuntimeError("unreachable")


def season_pages(html: str) -> dict[int, str]:
    """{season: page path} from the documents page's season menu (the highest page id per year)."""
    best: dict[int, tuple[int, str]] = {}
    for year, pid in re.findall(r"/season/season-(\d{4})-(\d+)", html):
        y, p = int(year), int(pid)
        if y not in best or p > best[y][0]:
            best[y] = (p, f"{DOCS}/season/season-{y}-{p}")
    return {y: path for y, (_, path) in best.items()}


def event_pages(html: str, season_url: str) -> list[str]:
    """Every event page of a season, from its event menu."""
    path = urllib.parse.urlparse(season_url).path
    events = re.findall(re.escape(path) + r"/event/([^\"'<>]+)", html)
    return [f"{season_url}/event/{e}" for e in dict.fromkeys(events)]


def presentation_links(html: str) -> list[str]:
    """Links to an event's car presentation PDF(s)."""
    links = re.findall(r"href=\"([^\"]+\.pdf)\"", html)
    return [FIA + urllib.parse.quote(urllib.parse.unquote(u)) if u.startswith("/") else u
            for u in dict.fromkeys(links) if re.search(r"presentation.*submission", urllib.parse.unquote(u), re.I)]


def pdf_path(season: int, url: str) -> Path:
    name = urllib.parse.unquote(url.rsplit("/", 1)[-1])
    return PDF_DIR / str(season) / re.sub(r"[^a-z0-9._-]+", "_", name.lower())


def download(seasons: list[int] | None = None) -> int:
    """Download every car presentation PDF not cached yet; returns how many were saved."""
    pages = season_pages(_get(DOCS).decode("utf-8", "replace"))
    wanted = [y for y in sorted(pages) if y >= FIRST_SEASON and (not seasons or y in seasons)]
    saved = 0
    for y in wanted:
        season_html = _get(pages[y]).decode("utf-8", "replace")
        for ev in event_pages(season_html, pages[y]):
            try:
                links = presentation_links(_get(ev).decode("utf-8", "replace"))
            except (urllib.error.URLError, TimeoutError) as e:
                log.warning("upgrades: %s: %s", ev.rsplit("/", 1)[-1], e)
                continue
            for url in links:
                out = pdf_path(y, url)
                if out.exists():
                    continue
                try:
                    data = _get(url)
                except (urllib.error.URLError, TimeoutError) as e:
                    log.warning("upgrades: %s: %s", out.name, e)
                    continue
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_bytes(data)
                saved += 1
                log.info("upgrades: saved %s", out.relative_to(PDF_DIR))
    return saved


# ---------------------------------------------------------------- reading the PDFs

REASONS = r"(Performance|Circuit[\s-]+specific|Reliability)"
SUBTYPES = ["local load", "flow conditioning", "drag range", "drag reduction", "cooling range", "mechanical setup", "balance range", "weight"]
MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august",
                                      "september", "october", "november", "december"], 1)}


def team_id(name: str, season: int) -> str | None:
    """App constructor id for the team name on a page (names change with sponsors)."""
    n = name.lower()
    rules = [("cadillac", "cadillac"), ("audi", "audi"), ("sauber", "kick-sauber"), ("stake", "kick-sauber"),
             ("racing bulls", "racing-bulls"), ("cash app rb", "racing-bulls"), ("red bull", "red-bull"),
             ("mclaren", "mclaren"), ("ferrari", "ferrari"), ("mercedes", "mercedes"), ("aston martin", "aston-martin"),
             ("alpine", "alpine"), ("williams", "williams"), ("haas", "haas")]
    for key, tid in rules:
        if key in n:
            return "rb" if tid == "racing-bulls" and season <= 2024 else tid
    if re.search(r"\brb\b|\bvcarb\b", n):
        return "rb" if season <= 2024 else "racing-bulls"
    return None


def event_dates(first_page: str) -> tuple[date, date] | None:
    """First and last day of the event from the cover page: "30 May - 01 June 2025", "05 - 07 December
    2025", "26 - 28 Jun 2026", or "29 November - 01 December" under a "2024 QATAR GRAND PRIX" title."""
    lines = [ln.strip() for ln in first_page.splitlines() if ln.strip()][:4]
    title_year = next((int(m.group(1)) for ln in lines[:1] if (m := re.match(r"(\d{4})\b", ln))), None)

    def month(word: str | None) -> int | None:
        w = (word or "").lower()
        return next((v for k, v in MONTHS.items() if len(w) >= 3 and k.startswith(w)), None)

    for line in lines:
        m = re.search(r"(\d{1,2})(?:\s+([A-Za-z]+))?\s*[-–]\s*(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?\s*$", line)
        if not m or not month(m.group(4)) or not (m.group(5) or title_year):
            continue
        year = int(m.group(5) or title_year)
        end = date(year, month(m.group(4)), int(m.group(3)))
        start = date(year, month(m.group(2)) or end.month, int(m.group(1)))
        return (start if start <= end else date(year - 1, start.month, start.day)), end
    return None


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip(" -–—")


def _part_name(s: str) -> str:
    """"front wing" / "FRONT WING" / "Front wing" -> "Front Wing"; short acronyms (FW, DRS) stay as they are."""
    word = lambda w: w if w.isupper() and len(w) <= 4 else w[:1].upper() + w[1:].lower()  # noqa: E731
    return " ".join("/".join(word(x) for x in w.split("/")) for w in re.sub(r"\s*/\s*", "/", _clean(s)).split(" "))


def _team_on_page(text: str, season: int) -> tuple[str, str] | None:
    """(team name as written, the page without it) if the page starts a team's section. The name follows
    a "Car Presentation – <event>" heading, which can be anywhere in the extracted text; pages without
    the heading (early 2024) start with the team name."""
    lines = text.splitlines()
    for i, ln in enumerate(lines):
        if ln.strip().lower().startswith("car presentation"):
            j = next((k for k in range(i + 1, len(lines)) if lines[k].strip().strip("* ")), None)
            if j is not None and team_id(lines[j], season):
                return lines[j].strip().strip("* ").strip(), "\n".join(lines[:i] + lines[j + 1:])
    first = next((k for k, ln in enumerate(lines) if ln.strip().strip("* ")), None)
    if first is not None and team_id(lines[first], season) and len(lines[first].strip()) < 60:
        return lines[first].strip().strip("* ").strip(), "\n".join(lines[first + 1:])
    return None


ROW = re.compile(rf"(?:^|\n)[ \t]*(\d{{1,2}})(?:[ \t]|[ \t]*\n\s*)+([A-Z][^.;:\n]{{0,50}}?(?:\s*\n[^.;:\n\d]{{1,30}}?){{0,2}}?)\s+{REASONS}\s*[-–—]?\s*", re.I)


LOOSE = r"(Other|Flow conditioning|Local load|Balance range|Cooling range|Drag range|Cooling(?=[ \t]{2,}))"
LOOSE_AS = {"local load": ("Performance", "local load"), "flow conditioning": ("Performance", "flow conditioning"),
            "balance range": ("Circuit specific", "balance range"), "cooling range": ("Circuit specific", "cooling range"),
            "drag range": ("Circuit specific", "drag range"), "cooling": ("Circuit specific", "cooling range")}
ROW_LOOSE = re.compile(ROW.pattern.replace(REASONS, LOOSE), re.I)
# a numbered part with no reason of its own: it shares the next row's (merged table cells)
BARE = re.compile(r"(?:^|\n)[ \t]*(\d{1,2})[ \t]+([A-Z][^\n.;:]{0,40}?)[ \t]*(?=\s*\n[ \t]*\d{1,2}[ \t]+[A-Z])", re.I)


def parse_rows(body: str) -> list[dict]:
    """The numbered rows of one team's table: part, FIA reason category, and a short description."""
    body = HEADER.sub("\n", body)  # the table's column headings (repeated on every page of a long table)
    found = list(ROW.finditer(body))
    taken = [(h.start(), h.end()) for h in found]
    free = lambda h: all(h.end() <= a or h.start() >= b for a, b in taken)  # noqa: E731
    found += [h for h in ROW_LOOSE.finditer(body) if free(h)]  # rows with a team's own reason wording
    found.sort(key=lambda h: h.start())
    hits, last = [], 0
    for h in found:
        k = int(h.group(1))
        if k > last and (not hits or h.start() >= hits[-1].end()):
            hits.append(h)
            last = k
    parts = []
    for i, h in enumerate(hits):
        rest = _clean(body[h.end(): hits[i + 1].start() if i + 1 < len(hits) else len(body)])
        sub = next((x for x in SUBTYPES if rest.lower().startswith(x)), "")
        desc = _clean(rest[len(sub):])
        if len(desc) > 220:
            desc = desc[:220].rsplit(" ", 1)[0] + "…"
        main = re.sub(r"[\s-]+", " ", h.group(3)).capitalize()
        if main.lower() in LOOSE_AS:  # a team's own wording -> the FIA category it belongs to
            main, sub = LOOSE_AS[main.lower()]
        parts.append({"n": int(h.group(1)), "part": _part_name(h.group(2)), "reason": f"{main} - {sub.title()}" if sub else main,
                      "description": desc, "at": h.start()})
    # grouped parts: give each the reason and description of the next full row
    taken = [(h.start(), h.end()) for h in hits]
    for b in BARE.finditer(body):
        if not free(b):
            continue
        nxt = next((p for p in parts if p["at"] > b.start()), None)
        if nxt and not any(p["n"] == int(b.group(1)) for p in parts):
            parts.append({**nxt, "n": int(b.group(1)), "part": _part_name(b.group(2)), "at": b.start()})
    parts.sort(key=lambda p: p["n"])
    return [{k: v for k, v in p.items() if k != "at"} for p in parts]


HEADER = re.compile(r"Updated\s+component.*?(?:max\.?\s*100\s*words\)?|how the update works(?:\s*\(min[^)]*\))?)", re.I | re.S)
NO_UPDATES = re.compile(r"no updates? (were )?submitted", re.I)


def parse_pdf(path: Path) -> tuple[tuple[date, date] | None, list[tuple[str, list[dict]]]]:
    """((first day, last day) of the event, [(team name, parts), ...]) from one car presentation PDF. A team's table can
    run over several pages; pages without a team name continue the previous team."""
    from pypdf import PdfReader

    logging.getLogger("pypdf").setLevel(logging.ERROR)  # font warnings that do not affect the text
    pages = [p.extract_text() or "" for p in PdfReader(str(path)).pages]
    dates = event_dates(pages[0] if pages else "")
    season = dates[1].year if dates else 2025
    blocks: list[list[str]] = []  # [team name, text, text, ...]
    for text in pages[1:]:
        found = _team_on_page(text, season)
        if found:
            blocks.append([found[0], found[1]])
        elif blocks:
            blocks[-1].append(text)
    merged: dict[str, list[str]] = {}  # one section per team, even if its pages are headed differently
    for name, *texts in blocks:
        merged.setdefault(team_id(name, season) or name, [name]).extend(texts)
    teams = []
    for name, *texts in merged.values():
        body = "\n".join(texts)
        teams.append((name, [] if NO_UPDATES.search(body) and not ROW.search(body) else parse_rows(body)))
    return dates, teams


# ---------------------------------------------------------------- data/upgrades.csv


def build(entries: pd.DataFrame) -> pd.DataFrame:
    """One row per new part, for every cached PDF that matches a race in ``entries``."""
    races = entries.drop_duplicates("race_key")[["season", "round", "race_key", "date"]].copy()
    races["day"] = pd.to_datetime(races["date"]).dt.date
    teams = entries.groupby("season")["constructor_id"].agg(set).to_dict()
    rows = []
    for path in sorted(PDF_DIR.glob("*/*.pdf")):
        try:
            dates, pages = parse_pdf(path)
        except Exception as e:  # a damaged download: skip it, the next run fetches it again
            log.warning("upgrades: cannot read %s (%s); deleting it", path.name, e)
            path.unlink(missing_ok=True)
            continue
        if dates is None:
            log.warning("upgrades: no event date in %s", path.name)
            continue
        start, end = dates
        near = races[races["day"].map(lambda d: (start - d).days <= 1 and (d - end).days <= 1)]
        if near.empty:
            log.warning("upgrades: no race between %s and %s for %s", start, end, path.name)
            continue
        race = near.iloc[(near["day"].map(lambda d: abs((d - end).days))).argmin()]
        for name, parts in pages:
            tid = team_id(name, int(race.season))
            if tid not in teams.get(race.season, set()):
                log.warning("upgrades: unknown team %r in %s", name, path.name)
                continue
            rows += [{"season": int(race.season), "round": int(race["round"]), "race_key": race.race_key, "team": tid, **p} for p in parts]
    out = pd.DataFrame(rows, columns=COLUMNS).drop_duplicates()
    return out.sort_values(["season", "round", "team"], kind="stable").reset_index(drop=True)


_cache: tuple[float, pd.DataFrame] | None = None


def version() -> float:
    """Changes whenever data/upgrades.csv is rebuilt (used in the API response cache key)."""
    try:
        return CSV.stat().st_mtime
    except OSError:
        return 0.0


def load() -> pd.DataFrame:
    """data/upgrades.csv (empty if it has not been built); re-read only when the file changes."""
    global _cache
    v = version()
    if _cache is None or _cache[0] != v:
        df = pd.read_csv(CSV, keep_default_na=False) if v else pd.DataFrame(columns=COLUMNS)
        _cache = (v, df)
    return _cache[1]


def effects(trend: list[dict], ups: pd.DataFrame, window: int = 3) -> list[dict]:
    """Each upgrade race of one car with its parts, and the car's average gap to pole (%) over the
    ``window`` races before it and over that race and the next ``window - 1``."""
    gaps = [t["gap"] for t in trend]
    out = []
    for i, t in enumerate(trend):
        mine = ups[ups["race_key"] == t["race_key"]]
        if mine.empty:
            continue
        before = [g for g in gaps[max(0, i - window):i] if g is not None]
        after = [g for g in gaps[i:i + window] if g is not None]
        b = round(sum(before) / len(before), 3) if before else None
        a = round(sum(after) / len(after), 3) if len(after) == min(window, len(gaps) - i) and after else None
        out.append({"race_key": t["race_key"], "round": t["round"], "gp": t["gp"],
                    "parts": [{"part": r.part, "reason": r.reason, "description": r.description} for r in mine.itertuples()],
                    "before": b, "after": a, "change": round(a - b, 3) if a is not None and b is not None else None})
    return out


def main() -> None:
    from .data import load_entries

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--season", type=int, action="append", help="only download this season (repeatable)")
    ap.add_argument("--offline", action="store_true", help="do not download; rebuild the CSV from cached PDFs")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    if not a.offline:
        print(f"downloaded {download(a.season)} new document(s) to {PDF_DIR}")
    df = build(load_entries())
    CSV.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(CSV, index=False)
    print(f"wrote {len(df)} parts from {df['race_key'].nunique()} races to {CSV}")


if __name__ == "__main__":
    main()

"""Picture manifest: driver photos, car photos and track maps for the web app.

Source: https://github.com/toUpperCase78/formula1-datasets (pictures for 2023-2026 drivers and
cars, and maps of recent tracks). The repository says these pictures come from formula1.com, so
they are Formula 1's copyright, not ours. We therefore do NOT copy them into this repository: the
manifest only stores links to the files in that repository, pinned to one commit. The browser loads
them from GitHub at run time. Set ``F1QP_MEDIA=off`` on the server to switch them off; the app then
shows its own drawings (track outlines, team-colour initials) instead.

Building the manifest needs only the file names, so the upstream repo is cloned without file
contents (``--filter=blob:none --no-checkout``): a few hundred KB instead of ~300 MB.

    uv run f1qp-media        # rebuild data/media_manifest.json from the latest upstream commit
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import unicodedata
from pathlib import Path
from urllib.parse import quote

import pandas as pd

from .data import ROOT, load_entries

UPSTREAM = "https://github.com/toUpperCase78/formula1-datasets"
RAW = "https://raw.githubusercontent.com/toUpperCase78/formula1-datasets/{sha}/{path}"
CLONE_DIR = ROOT / "data" / "raw" / "tu78"
MANIFEST = ROOT / "data" / "media_manifest.json"

# First words of a car file name -> F1DB constructor id (checked longest first).
CAR_PREFIXES = {
    "Mercedes-AMG": "mercedes", "Red_Bull": "red-bull", "Racing_Bulls": "racing-bulls", "RB": "rb",
    "AlphaTauri": "alphatauri", "Aston_Martin": "aston-martin", "Kick_Sauber": "kick-sauber",
    "Alfa_Romeo": "alfa-romeo", "Alpine": "alpine", "Ferrari": "ferrari", "Haas": "haas",
    "McLaren": "mclaren", "Williams": "williams", "Audi": "audi", "Cadillac": "cadillac",
}

# Track map file -> F1DB circuit id.
TRACK_FILES = {
    "Australia_Albert_Park": "melbourne", "Austria_Red_Bull_Ring": "spielberg", "Azerbaijan_Baku": "baku",
    "Bahrain_Bahrain_International": "bahrain", "Belgium_Spa_Francorchamps": "spa-francorchamps",
    "Brazil_Jose_Carlos_Pace": "interlagos", "Canada_Gilles_Villeneuve": "montreal",
    "China_Shanghai_International": "shanghai", "Great_Britain_Silverstone": "silverstone",
    "Hungary_Hungaroring": "hungaroring", "Italy_Imola_Internazionale_Enzo_Dino_Ferrari": "imola",
    "Italy_Monza": "monza", "Japan_Suzuka": "suzuka", "Mexico_Hermanos_Rodriguez": "mexico-city",
    "Monaco_Circuit_de_Monaco": "monaco", "Netherlands_Zandvoort": "zandvoort", "Qatar_Lusail_International": "lusail",
    "Saudi_Arabia_Jeddah_Corniche": "jeddah", "Singapore_Marina_Bay_Street": "marina-bay",
    "Spain_Barcelona_Catalunya": "catalunya", "UAE_Abu_Dhabi_Yas_Marina": "yas-marina",
    "USA_Circuit_of_the_Americas": "austin", "USA_Las_Vegas_Strip": "las-vegas", "USA_Miami_International": "miami",
}


def _slug(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def list_upstream(dest: Path = CLONE_DIR) -> tuple[str, list[str]]:
    """(commit sha, file paths) of the upstream repo, without downloading file contents."""
    if not (dest / ".git").exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", "-q", "--depth", "1", "--filter=blob:none", "--no-checkout", UPSTREAM, str(dest)], check=True)
    else:
        subprocess.run(["git", "-C", str(dest), "fetch", "-q", "--depth", "1", "origin"], check=True)
        subprocess.run(["git", "-C", str(dest), "update-ref", "HEAD", "FETCH_HEAD"], check=True)
    sha = subprocess.run(["git", "-C", str(dest), "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
    files = subprocess.run(["git", "-C", str(dest), "ls-tree", "-r", "--name-only", "HEAD"], check=True, capture_output=True, text=True).stdout.splitlines()
    return sha, files


def match_driver(stem: str, driver_ids: list[str]) -> str | None:
    """'Carlos_Sainz_55' -> 'carlos-sainz-jr'. Name before the car number, matched to F1DB ids."""
    name = re.sub(r"_\d+(\(\d+\))?$", "", stem)
    slug = _slug(name)
    if slug in driver_ids:
        return slug
    starts = [d for d in driver_ids if d.startswith(slug + "-")]
    if len(starts) == 1:
        return starts[0]
    parts = slug.split("-")  # surname-first spellings, e.g. 'Guanyu_Zhou' vs 'zhou-guanyu'
    flipped = "-".join(parts[::-1])
    return flipped if flipped in driver_ids else None


def match_car(stem: str) -> str | None:
    for prefix in sorted(CAR_PREFIXES, key=len, reverse=True):
        if stem.startswith(prefix + "_"):
            return CAR_PREFIXES[prefix]
    return None


def build_manifest(sha: str, files: list[str], entries: pd.DataFrame) -> dict:
    driver_ids = sorted(entries["driver_id"].unique())
    url = lambda p: RAW.format(sha=sha, path=quote(p))
    drivers: dict[str, dict[str, str]] = {}
    cars: dict[str, dict[str, str]] = {}
    tracks: dict[str, str] = {}
    unmatched = []
    for path in sorted(files, key=lambda p: ("(" in p, p)):  # prefer files without "(2)" copies
        folder, _, fname = path.rpartition("/")
        if not fname.lower().endswith(".png"):
            continue
        stem = fname[:-4]
        if m := re.fullmatch(r"F1 (\d{4}) Season Drivers", folder):
            d = match_driver(stem, driver_ids)
            if d:
                drivers.setdefault(d, {}).setdefault(m.group(1), url(path))
            else:
                unmatched.append(path)
        elif m := re.fullmatch(r"F1 (\d{4}) Season Cars", folder):
            t = match_car(stem)
            if t:
                cars.setdefault(t, {}).setdefault(m.group(1), url(path))
            else:
                unmatched.append(path)
        elif folder == "F1 Race Tracks":
            c = TRACK_FILES.get(stem)
            if c:
                tracks[c] = url(path)
            else:
                unmatched.append(path)
    return {
        "source": UPSTREAM,
        "commit": sha,
        "credit": "Pictures: Formula 1 (formula1.com), collected in toUpperCase78/formula1-datasets.",
        "drivers": drivers,
        "cars": cars,
        "tracks": tracks,
        "unmatched": unmatched,
    }


def load_manifest(path: Path = MANIFEST) -> dict:
    if not path.exists():
        return {"drivers": {}, "cars": {}, "tracks": {}, "credit": "", "source": "", "commit": ""}
    return json.loads(path.read_text())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=MANIFEST)
    args = parser.parse_args()
    sha, files = list_upstream()
    manifest = build_manifest(sha, files, load_entries())
    args.out.write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n")
    n = lambda k: sum(len(v) for v in manifest[k].values()) if k != "tracks" else len(manifest[k])
    print(f"Manifest for {sha[:8]}: {n('drivers')} driver photos, {n('cars')} car photos, {n('tracks')} track maps "
          f"({len(manifest['unmatched'])} unmatched) -> {args.out}")


if __name__ == "__main__":
    main()

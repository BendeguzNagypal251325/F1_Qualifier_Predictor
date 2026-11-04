"""Track outlines as SVG paths, from the MIT-licensed bacinger/f1-circuits GeoJSON (f1qp/assets)."""

from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path

GEOJSON = Path(__file__).with_name("assets") / "f1-circuits.geojson"

# F1DB circuit id -> f1-circuits feature id
GEO_IDS = {
    "melbourne": "au-1953", "bahrain": "bh-2002", "shanghai": "cn-2004", "catalunya": "es-1991",
    "monaco": "mc-1929", "montreal": "ca-1978", "paul-ricard": "fr-1969", "spielberg": "at-1969",
    "silverstone": "gb-1948", "hockenheimring": "de-1932", "hungaroring": "hu-1986",
    "spa-francorchamps": "be-1925", "monza": "it-1922", "marina-bay": "sg-2008", "sirius": "ru-2014",
    "suzuka": "jp-1962", "austin": "us-2012", "mexico-city": "mx-1962", "interlagos": "br-1940",
    "yas-marina": "ae-2009", "imola": "it-1953", "nurburgring": "de-1927", "portimao": "pt-2008",
    "mugello": "it-1914", "sepang": "my-1999", "istanbul": "tr-2005", "zandvoort": "nl-1948",
    "jeddah": "sa-2021", "miami": "us-2022", "lusail": "qa-2004", "madring": "es-2026",
    "baku": "az-2016", "las-vegas": "us-2023",
}


@lru_cache(maxsize=1)
def outlines(size: float = 100.0) -> dict[str, dict]:
    """circuit id -> {"path": SVG path in a size x size box, "name", "length_m"} (north up)."""
    feats = {f["properties"]["id"]: f for f in json.loads(GEOJSON.read_text())["features"]}
    out = {}
    for circuit, gid in GEO_IDS.items():
        f = feats.get(gid)
        if not f:
            continue
        coords = f["geometry"]["coordinates"]
        lat0 = math.radians(sum(c[1] for c in coords) / len(coords))
        pts = [(c[0] * math.cos(lat0), -c[1]) for c in coords]
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        span = max(max(xs) - min(xs), max(ys) - min(ys))
        pad = size * 0.06
        k = (size - 2 * pad) / span
        ox = (size - (max(xs) - min(xs)) * k) / 2
        oy = (size - (max(ys) - min(ys)) * k) / 2
        p2 = [((x - min(xs)) * k + ox, (y - min(ys)) * k + oy) for x, y in pts]
        path = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in p2) + " Z"
        out[circuit] = {"path": path, "points": p2, "name": f["properties"].get("Name"), "length_m": f["properties"].get("length")}
    return out


def outline_points(circuit: str) -> list[tuple[float, float]] | None:
    """The outline's points in the same 100 x 100 box as its SVG path."""
    o = outlines().get(circuit)
    return o["points"] if o else None

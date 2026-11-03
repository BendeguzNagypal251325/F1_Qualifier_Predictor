# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = ["usd-core>=24.11", "trimesh>=4.5", "numpy>=1.26", "pillow>=10", "scipy>=1.13"]
# ///
"""Turn the Sketchfab reference models (CC BY 4.0, see README) into the app's 3D assets.

    uv run tools/models/prepare_models.py --refs <folder with the unpacked models> --out build/models
    then: tools/models/optimize.sh build/models web/public/models

For each car this keeps only the car (the A525 file is a whole pit scene), lines it up with the app's
axes (x forward from the rear axle, y up from the ground, z sideways; found from the tyres), scales it
to the era's regulation width, and splits it into meshes named "<part>|<slot>":

* part: one of the eight clickable parts (front wing, nose, cockpit, sidepods, floor, power unit,
  rear wing, wheels), decided per triangle from where it sits on the car;
* slot: what the app paints it with: the team's primary / secondary / accent colour, "livery" (a
  colour-zone mask: red = primary, green = secondary, blue = accent, black = carbon), carbon, gloss
  carbon, rubber, metal, chrome, glass, light, or dark.

Sponsor decals, numbers and the original textures are dropped, so no logos reach the app. The helmet
keeps its shell, visor and trim meshes; the app paints the shell with each driver's design.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image
from scipy import ndimage


@dataclass
class Piece:
    name: str
    mat: str
    V: np.ndarray          # (n, 3) world positions
    F: np.ndarray          # (m, 3)
    N: np.ndarray | None   # (n, 3)
    UV: np.ndarray | None  # (n, 2)
    tex: Path | None       # base colour texture


# ---------------------------------------------------------------- loading

def load_gltf(path: Path) -> list[Piece]:
    sc = trimesh.load(path, force="scene", process=False)
    out = []
    for node in sc.graph.nodes_geometry:
        T, gname = sc.graph[node]
        g = sc.geometry[gname]
        mat = g.visual.material if hasattr(g.visual, "material") else None
        V = trimesh.transform_points(g.vertices, T)
        N = None
        if "vertex_normals" in g._cache.cache or g.vertex_normals is not None:
            N = g.vertex_normals @ T[:3, :3].T
            N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-12
        uv = getattr(g.visual, "uv", None)
        mname = getattr(mat, "name", "") or ""
        tex = path.parent / "textures" / f"{mname}_baseColor.png"
        out.append(Piece(gname, mname, V, np.asarray(g.faces), N,
                         None if uv is None else np.asarray(uv, dtype=np.float64), tex if tex.exists() else None))
    return out


def load_usd(path: Path, tex_dir: Path) -> list[Piece]:
    from pxr import Usd, UsdGeom

    st = Usd.Stage.Open(str(path))
    mpu = UsdGeom.GetStageMetersPerUnit(st)
    cache = UsdGeom.XformCache()
    out = []
    for prim in st.Traverse():
        if not prim.IsA(UsdGeom.Mesh):
            continue
        m = UsdGeom.Mesh(prim)
        pts, counts, idx = m.GetPointsAttr().Get(), m.GetFaceVertexCountsAttr().Get(), m.GetFaceVertexIndicesAttr().Get()
        if pts is None or not len(pts) or counts is None:
            continue
        M = np.array(cache.GetLocalToWorldTransform(prim), dtype=np.float64)
        P = (np.c_[np.array(pts, dtype=np.float64), np.ones(len(pts))] @ M)[:, :3] * mpu
        idx = np.asarray(idx)
        counts = np.asarray(counts)
        # triangulate as fans, keeping face-vertex indices so face-varying data can follow
        starts = np.r_[0, np.cumsum(counts)[:-1]]
        fv = [(s, s + i, s + i + 1) for s, c in zip(starts, counts) for i in range(1, c - 1)]
        fv = np.array(fv, dtype=np.int64)
        pv = UsdGeom.PrimvarsAPI(prim)
        st_pv = next((pv.GetPrimvar(n) for n in ("st", "st0", "UVMap") if pv.HasPrimvar(n)), None)
        uv_fv = None
        if st_pv:
            vals = np.array(st_pv.Get(), dtype=np.float64)
            interp = st_pv.GetInterpolation()
            ind = st_pv.GetIndices()
            if ind is not None and len(ind):
                vals = vals[np.asarray(ind)]
            if interp == "faceVarying":
                uv_fv = vals
            elif interp in ("vertex", "varying"):
                uv_fv = vals[idx]
        nrm = m.GetNormalsAttr().Get()
        n_fv = None
        if nrm is not None and len(nrm):
            nv = np.array(nrm, dtype=np.float64)
            n_fv = nv if len(nv) == len(idx) else nv[idx] if len(nv) == len(pts) else None
            if n_fv is not None:
                n_fv = n_fv @ M[:3, :3]
                n_fv /= np.linalg.norm(n_fv, axis=1, keepdims=True) + 1e-12
        # unweld: one vertex per face-vertex (welded again later by the optimiser)
        flat = fv.reshape(-1)
        V = P[idx[flat]]
        F = np.arange(len(flat)).reshape(-1, 3)
        rel = prim.GetRelationship("material:binding")
        targets = rel.GetTargets() if rel else []
        mat = targets[0].name if targets else ""
        tex = next((p for p in [tex_dir / f"{mat}_baseColor.jpg", tex_dir / f"{mat}_baseColor.png"] if p.exists()), None)
        out.append(Piece(str(prim.GetPath()), mat, V, F,
                         None if n_fv is None else n_fv[flat],
                         None if uv_fv is None else uv_fv[flat], tex))
    return out


# ---------------------------------------------------------------- frame

def to_car_frame(pieces: list[Piece], tyre_mats: set[str], width: float, steer_mats: set[str]):
    """Rotate/scale/translate so the rear axle is at x=0, the ground at y=0 and the car centred on z."""
    T = np.vstack([p.V for p in pieces if p.mat in tyre_mats])
    lo, hi = T.min(0), T.max(0)
    ext = hi - lo
    up = 1  # every source is y-up
    horiz = [a for a in range(3) if a != up]
    la = max(horiz, key=lambda a: ext[a])   # length axis
    wa = min(horiz, key=lambda a: ext[a])   # width axis
    mid = (lo + hi) / 2
    # wheel centres: the four tyre clusters
    q = T - mid
    centres = {}
    for sl in (-1, 1):
        for sw in (-1, 1):
            c = T[(np.sign(q[:, la]) == sl) & (np.sign(q[:, wa]) == sw)]
            centres[(sl, sw)] = (c.min(0) + c.max(0)) / 2
    axle = {sl: (centres[(sl, -1)] + centres[(sl, 1)]) / 2 for sl in (-1, 1)}
    # the front is where the steering wheel is closer to
    sw = np.vstack([p.V for p in pieces if p.mat in steer_mats]).mean(0)
    front = 1 if abs(sw[la] - axle[1][la]) < abs(sw[la] - axle[-1][la]) else -1
    rear = axle[-front]
    s = width / ext[wa]
    sign = front
    ground = lo[up]
    # the mapping (la, up, wa) -> (x, y, z) must be a rotation, not a mirror, or every triangle turns
    # inside out; the car is symmetric, so fix a mirror by flipping z
    M = np.zeros((3, 3))
    M[0, la] = sign; M[1, up] = 1; M[2, wa] = sign
    zs = sign * (1 if np.linalg.det(M) > 0 else -1)

    def tf(V):
        x = (V[:, la] - rear[la]) * sign * s
        y = (V[:, up] - ground) * s
        z = (V[:, wa] - mid[wa]) * s * zs
        return np.c_[x, y, z]

    def tfn(N):
        return np.c_[N[:, la] * sign, N[:, up], N[:, wa] * zs]

    for p in pieces:
        p.V = tf(p.V)
        if p.N is not None:
            p.N = tfn(p.N)
    wb = abs(axle[1][la] - axle[-1][la]) * s
    radius = ext[up] * s / 2
    cockpit = tf(sw[None])[0]
    return {"wheelbase": round(float(wb), 4), "tyreRadius": round(float(radius), 4), "width": width,
            "steeringWheel": [round(float(v), 4) for v in cockpit]}


# ---------------------------------------------------------------- parts

def classify_parts(C: np.ndarray, wb: float, R: float, wheel_tri: np.ndarray) -> np.ndarray:
    """Part per triangle centroid (x forward from the rear axle, y up, z sideways)."""
    x, y, az = C[:, 0], C[:, 1], np.abs(C[:, 2])
    part = np.full(len(C), "nose", dtype=object)
    near_axle = (np.minimum(np.abs(x), np.abs(x - wb)) < R + 0.12)
    part[(y < 0.13) & ~near_axle] = "floor"
    part[(x < 0.25) & (y < 0.42) & (az < 0.6)] = "floor"            # diffuser
    part[(x > 0.25) & (x < wb - 0.75) & (az > 0.22) & (y >= 0.13)] = "sidepods"
    part[(x > -0.15) & (x < wb - 1.75) & (az <= 0.3) & (y > 0.45)] = "power-unit"
    part[(x > wb - 2.05) & (x < wb - 0.8) & (az < 0.4) & (y > 0.62)] = "cockpit"
    part[(x < -0.12) & (y > 0.3)] = "rear-wing"
    part[(x > wb + 0.3) & ((y < 0.3) | (az > 0.25))] = "front-wing"
    # wheels and suspension: inside a tyre's cylinder, or the arms between body and wheel
    part[wheel_tri] = "wheels"
    arms = near_axle & (az > 0.28) & (az < 0.9) & (y > 0.08) & (y < 0.75) & (part != "front-wing")
    part[arms & (np.abs(x - wb) < 0.5)] = "wheels"
    part[arms & (np.abs(x) < 0.5) & (y < 0.6)] = "wheels"
    return part


# ---------------------------------------------------------------- livery masks

SLOT_RGB = {"P": (255, 0, 0), "S": (0, 255, 0), "A": (0, 0, 255), "K": (0, 0, 0)}


def livery_mask(tex: Path, palette: list[tuple[tuple[int, int, int], str]], size: int, clean: int, min_area: int = 3000, enclosed_area: int = 15000) -> Image.Image:
    """Nearest-palette classification of every texel, then a mode filter that removes logos and speckle."""
    im = np.asarray(Image.open(tex).convert("RGB").resize((size, size), Image.Resampling.BOX), dtype=np.float32)
    cols = np.array([c for c, _ in palette], dtype=np.float32)
    d = ((im[:, :, None, :] - cols[None, None]) ** 2).sum(-1)
    lab = d.argmin(-1)
    # majority vote per slot channel in a window (removes text, outlines and flake patterns)
    uniq = sorted({s for _, s in palette})
    votes = np.stack([ndimage.uniform_filter((np.array([s for _, s in palette])[lab] == u).astype(np.float32), size=clean)
                      for u in uniq], -1)
    lab2 = votes.argmax(-1)
    k_black = uniq.index("K") if "K" in uniq else None
    # remove small enclosed patches (letters, logos, speckle): fill them from the surrounding zone
    for _ in range(2):
        small = np.zeros(lab2.shape, dtype=bool)
        for u in range(len(uniq)):
            comp, n = ndimage.label(lab2 == u)
            if not n:
                continue
            sizes = np.bincount(comp.ravel())
            tiny = np.flatnonzero(sizes < min_area)
            tiny = tiny[tiny > 0]
            small |= np.isin(comp, tiny)
            # larger patches (lettering) that one other zone completely surrounds
            for k in np.flatnonzero((sizes >= min_area) & (sizes < enclosed_area)):
                if k == 0:
                    continue
                blob = comp == k
                ring = ndimage.binary_dilation(blob, iterations=2) & ~blob
                around = lab2[ring]
                others = around[around != k_black] if k_black is not None else around
                if len(others) and len(np.unique(others)) == 1 and len(others) > 0.6 * len(around):
                    small |= blob
        if not small.any():
            break
        idx = ndimage.distance_transform_edt(small, return_distances=False, return_indices=True)
        lab2 = lab2[idx[0], idx[1]]
    out_lab = np.array(uniq)[lab2]
    rgb = np.array([SLOT_RGB[s] for s in out_lab.reshape(-1)], dtype=np.uint8).reshape(size, size, 3)
    return Image.fromarray(rgb)


# ---------------------------------------------------------------- export

def export(pieces: list[Piece], slot_of: dict[str, str], meta: dict, out: Path, masks: dict[str, Image.Image], wheel_mats: set[str]):
    scene = trimesh.Scene()
    groups: dict[tuple[str, str], list] = {}
    R, wb = meta["tyreRadius"], meta["wheelbase"]
    for p in pieces:
        slot = slot_of.get(p.mat)
        if slot is None or slot == "drop":
            continue
        C = p.V[p.F].mean(1)
        is_wheel = np.full(len(C), p.mat in wheel_mats)
        parts = classify_parts(C, wb, R, is_wheel)
        for part in np.unique(parts):
            sel = parts == part
            groups.setdefault((part, slot if slot != "livery" else f"livery:{p.mat}"), []).append((p, p.F[sel]))
    for (part, slot), items in groups.items():
        Vs, Fs, Ns, UVs, off = [], [], [], [], 0
        use_uv = slot.startswith("livery:")
        for p, F in items:
            used = np.unique(F)
            remap = np.full(len(p.V), -1)
            remap[used] = np.arange(len(used))
            Vs.append(p.V[used]); Fs.append(remap[F] + off)
            Ns.append(p.N[used] if p.N is not None else None)
            if use_uv:
                UVs.append(p.UV[used])
            off += len(used)
        V, F = np.vstack(Vs), np.vstack(Fs)
        mesh = trimesh.Trimesh(V, F, process=False)
        if all(n is not None for n in Ns):
            mesh.vertex_normals = np.vstack(Ns)
        name = f"{part}|{'livery' if use_uv else slot}"
        if use_uv:
            mat = trimesh.visual.material.PBRMaterial(name="livery", baseColorTexture=masks[slot.split(':', 1)[1]])
            mesh.visual = trimesh.visual.TextureVisuals(uv=np.vstack(UVs), material=mat)
        else:
            mesh.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(name=slot))
        scene.add_geometry(mesh, node_name=name, geom_name=name)
    out.parent.mkdir(parents=True, exist_ok=True)
    scene.export(out, include_normals=True)
    tris = sum(len(g.faces) for g in scene.geometry.values())
    print(f"{out.name}: {len(scene.geometry)} meshes, {tris} triangles, bounds {np.round(scene.bounds, 3).tolist()}")
    return tris


# ---------------------------------------------------------------- models

RB22 = {
    # 2026 car (Red Bull RB22 by Dave Love SketchFab)
    "slots": {
        "redbull_paint.007": "livery", "redbull_color.005": "A", "redbull_detail.007": "carbon2",
        "redbull_carbon1.007": "carbon", "redbull_carbon2.007": "carbon", "redbull_carbon3.007": "carbon2",
        "generics2.007": "dark", "sidewall.007": "rubber", "redbull_wheel_hub.007": "metal", "discs.007": "dark",
        "chrome.006": "chrome", "glass.005": "glass", "redbull_mirror_right.005": "chrome", "rear_light_2.007": "light",
        "gp21_cinture.004": "dark", "redbull_steeringwheel.004": "dark", "black_s.006": "dark", "kers_blue.003": "dark",
        "gp21_LCD.003": "dark", "clearled.003": "dark",
        "redbull_decals.005": "drop", "redbull_number_3.005": "drop", "sw_decals.004": "drop",
    },
    "palette": [((8, 8, 24), "P"), ((8, 8, 40), "P"), ((8, 8, 56), "P"), ((20, 24, 90), "P"), ((230, 170, 0), "A"),
                ((8, 8, 8), "K"), ((40, 40, 40), "K"),
                ((220, 30, 40), "P"), ((245, 245, 245), "P")],
    "tyres": {"sidewall.007"}, "steer": {"redbull_steeringwheel.004"}, "wheels": {"sidewall.007", "redbull_wheel_hub.007", "discs.007"},
}

A525 = {
    # 2022-2025 car (Alpine A525 by Abu Saif); everything that is not part of the car is dropped
    "slots": {
        "car_chassis": "P", "fw_car_chassis": "livery", "driver_color": "S", "yellow": "A", "fw_yellow": "A",
        "carbon": "carbon", "cockpit_carbon": "carbon", "cockpit_carbon2": "carbon", "rtt_sw_carbon_main": "dark",
        "rtt_sw_carbon2": "dark", "material": "carbon2", "black": "dark", "black_s": "dark", "black_s_2025": "dark",
        "cockpit_black_s": "dark", "Black_painted_metal": "dark", "sw_plastic_black": "dark", "HEADREST_PADS": "dark",
        "cockpit_foam": "dark", "cockpit_cables": "dark", "cockpit_buttons": "dark", "rtt_cinture": "dark",
        "rtt_cinture_on": "dark", "rtt_chrome_cinture": "dark", "rtt_sw_buttons": "dark", "rtt_sw_switches": "dark",
        "rtt_sw_handles": "dark", "rtt_sw_Switch_upperRight": "dark", "rtt_sw_Switch_middleLeft": "dark",
        "rtt_sw_Switch_middleRight": "dark", "rtt_sw_Switch_upperLeft": "dark", "rtt_cockpit_details": "dark",
        "rtt_sw_chrome": "chrome", "WIND": "glass", "WIND_IN": "glass", "MIRROR": "chrome", "clearled": "dark",
        "kers_white": "dark", "gp21_LCD": "dark", "TAG_DRS_ON": "dark", "plastic_red": "light",
        "RTT_TIRE": "rubber", "RTT_TIRE_TREAD": "rubber", "RIM_BLURRED": "metal", "hub_nut": "metal",
        "chrome": "chrome", "chrome_rake": "chrome", "Procedural_Brushed_Chrome": "chrome", "fw_chrome": "chrome",
        "Yellow_Golden_Metal": "metal", "_020_light": "light", "rtt_bulb_rlight": "light",
        "decals": "drop", "decals_noalpha": "drop",
    },
    "palette": [((10, 40, 130), "P"), ((20, 90, 210), "P"), ((235, 120, 180), "S"), ((250, 160, 205), "S"),
                ((8, 8, 10), "K"), ((30, 30, 34), "K"), ((240, 240, 240), "K")],
    "tyres": {"RTT_TIRE", "RTT_TIRE_TREAD"}, "steer": {"rtt_sw_carbon_main"},
    "wheels": {"RTT_TIRE", "RTT_TIRE_TREAD", "RIM_BLURRED", "hub_nut"},
}


F2022 = {
    # 2017-2021 cars: "Formula 1 2022 Car" by Luis Adrian V., reshaped towards the 2017-2021 rules
    # (13-inch wheels, no wheel covers or wheel winglets, longer wheelbase, full-width front wing).
    "slots": {
        "Livery1Mtl.001": "P", "Part1Mtl.001": "A", "Aero2Mtl.001": "carbon", "Aero1Mtl.001": "carbon2",
        "Meshesmesh101Mtl.001": "dark", "Led1Mtl.001": "metal", "Cover1Mtl.001": "drop",
        "Wheeldecal1Mtl.001": "rubber", "Wheeldecal2Mtl.001": "rubber", "Meshesmcledgears0011Mtl.001": "light",
        # the driver figure: the app seats its own helmet instead
        "Rightupperarm1Mtl.001": "drop", "Righthand1Mtl.001": "drop", "Meshpart1Mtl.001": "drop",
    },
    "tyres": {"Wheeldecal1Mtl.001", "Wheeldecal2Mtl.001"}, "steer": {"Meshpart1Mtl.001"},
    "wheels": {"Wheeldecal1Mtl.001", "Wheeldecal2Mtl.001", "Led1Mtl.001", "Cover1Mtl.001"},
    "head": {"Meshpart1Mtl.001"},
    "deform": "retro_2017",
}


def retro_2017(pieces: list[Piece], meta: dict, cfg: dict) -> None:
    """Reshape a 2022 car towards a 2017-2021 one, in place (car frame, metres)."""
    wb, R = meta["wheelbase"], meta["tyreRadius"]
    tyre = np.vstack([p.V for p in pieces if p.mat in cfg["tyres"]])
    corners = []
    for front in (False, True):
        for side in (-1, 1):
            c = tyre[((tyre[:, 0] > wb / 2) == front) & (np.sign(tyre[:, 2]) == side)]
            corners.append((front, (c.min(0) + c.max(0)) / 2, c.max(0) - c.min(0)))
    # 1. wheels: 13-inch rims (330 mm) and 660 mm tyres instead of 18-inch (457 mm) and 720 mm
    R_new, rim_old, rim_new = 0.33, 0.229, 0.165
    for p in pieces:
        wheel_mat = p.mat in cfg["wheels"]
        for _front, ctr, ext in corners:
            dx, dy = p.V[:, 0] - ctr[0], p.V[:, 1] - ctr[1]
            r = np.hypot(dx, dy)
            band = np.abs(p.V[:, 2] - ctr[2]) < ext[2] / 2 + 0.05
            sel = band & (r < R + 0.03) if wheel_mat else band & (r < rim_old)  # body parts: only inside the rim
            if not sel.any():
                continue
            rr = r[sel]
            new = np.where(rr <= rim_old, rr * rim_new / rim_old,
                           np.where(rr <= R, rim_new + (rr - rim_old) * (R_new - rim_new) / (R - rim_old), rr - R + R_new))
            k = np.divide(new, rr, out=np.ones_like(rr), where=rr > 1e-9)
            p.V[sel, 0] = ctr[0] + dx[sel] * k
            p.V[sel, 1] = R_new + dy[sel] * k
    # 2. no winglets over the front wheels (allowed only from 2022)
    for p in pieces:
        if p.mat in cfg["wheels"]:
            continue
        C = p.V[p.F].mean(1)
        drop = np.zeros(len(p.F), dtype=bool)
        for front, ctr, ext in corners:
            if front:
                drop |= ((np.abs(C[:, 0] - ctr[0]) < R * 0.95) & (C[:, 1] > R_new * 1.75) & (C[:, 1] < R * 2.6)
                         & (np.abs(C[:, 2] - ctr[2]) < ext[2] / 2 + 0.06))
        p.F = p.F[~drop]
    # 3. longer wheelbase (2020-21 cars ran about 3.6-3.7 m): stretch the middle of the car
    d = 3.65 - wb
    a, b = 0.9, wb - 1.9
    for p in pieces:
        x = p.V[:, 0]
        p.V[:, 0] = np.where(x < a, x, np.where(x > b, x + d, x + (x - a) / (b - a) * d))
    meta["wheelbase"] = round(wb + d, 4)
    meta["tyreRadius"] = R_new
    for key in ("steeringWheel", "head"):
        if key in meta and meta[key][0] > b:
            meta[key][0] = round(meta[key][0] + d, 4)
    # 4. full-width front wing (2.0 m, endplates in line with the tyres)
    xf = meta["wheelbase"]
    wing = [(p, (p.V[:, 0] > xf + R_new * 0.7) & (p.V[:, 1] < 0.36)) for p in pieces if p.mat not in cfg["wheels"]]
    half = max((np.abs(p.V[m, 2]).max() for p, m in wing if m.any()), default=1.0)
    f = min(1.2, (meta["width"] / 2 - 0.005) / half)
    for p, m in wing:
        p.V[m, 2] *= f
    print(f"retro: wheelbase {wb:.3f} -> {meta['wheelbase']}, front wing half-span {half:.3f} -> {half * f:.3f}")


def build_car(pieces, cfg, era, width, out_dir: Path):
    pieces = [p for p in pieces if p.mat in cfg["slots"]]
    meta = to_car_frame(pieces, cfg["tyres"], width, cfg["steer"])
    if "head" in cfg:  # where the original driver's head is: the app seats its helmet there
        H = np.vstack([p.V for p in pieces if p.mat in cfg["head"]])
        meta["head"] = [round(float(v), 4) for v in (H.min(0) + H.max(0)) / 2]
    if cfg.get("deform") == "retro_2017":
        retro_2017(pieces, meta, cfg)
    # drop anything far from the car (props that share a car material)
    keep = []
    for p in pieces:
        c = p.V.mean(0)
        if -1.4 < c[0] < meta["wheelbase"] + 1.6 and c[1] < 1.4 and abs(c[2]) < width / 2 + 0.1:
            keep.append(p)
    masks = {}
    for p in keep:
        if cfg["slots"][p.mat] == "livery" and p.mat not in masks:
            if p.tex is None:
                raise SystemExit(f"no texture for livery material {p.mat}")
            masks[p.mat] = livery_mask(p.tex, cfg["palette"], 1024, 11)
            masks[p.mat].save(out_dir / f"{era}-{p.mat}-mask.png")
    meta["era"] = era
    tris = export(keep, cfg["slots"], meta, out_dir / f"car-{era}.glb", masks, cfg["wheels"])
    meta["sourceTriangles"] = tris
    (out_dir / f"car-{era}.json").write_text(json.dumps(meta, indent=1))


def build_helmet(pieces: list[Piece], out_dir: Path):
    """Shell / visor / trim, oriented like the procedural helmet: x back -> front, y up, z sideways."""
    by = {p.mat: p for p in pieces}
    shell, visor, trim = by["aiStandardSurface6SG"], by["aiStandardSurface7SG"], by["aiStandardSurface8SG"]
    allv = np.vstack([shell.V, visor.V, trim.V])
    lo, hi = allv.min(0), allv.max(0)
    ext = hi - lo
    la = 0 if ext[0] > ext[2] else 2
    wa = 2 - la
    mid = (lo + hi) / 2
    front = 1 if visor.V.mean(0)[la] > mid[la] else -1
    s = 2.0 / ext[wa]   # unit-ish size: width 2 (the procedural shell is about 1.8 wide)
    M = np.zeros((3, 3))
    M[0, la] = front; M[1, 1] = 1; M[2, wa] = front
    zs = front * (1 if np.linalg.det(M) > 0 else -1)  # rotation, never a mirror (see to_car_frame)
    for p in (shell, visor, trim):
        V = p.V - mid
        p.V = np.c_[V[:, la] * front, V[:, 1], V[:, wa] * zs] * s
        if p.N is not None:
            p.N = np.c_[p.N[:, la] * front, p.N[:, 1], p.N[:, wa] * zs]
    scene = trimesh.Scene()
    for name, p in (("shell", shell), ("visor", visor), ("trim", trim)):
        m = trimesh.Trimesh(p.V, p.F, process=False)
        if p.N is not None:
            m.vertex_normals = p.N
        m.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(name=name))
        scene.add_geometry(m, node_name=name, geom_name=name)
    scene.export(out_dir / "helmet.glb", include_normals=True)
    b = scene.bounds
    print(f"helmet.glb: bounds {np.round(b, 3).tolist()}, {sum(len(g.faces) for g in scene.geometry.values())} triangles")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refs", type=Path, required=True, help="folder with rb22/ (glTF), a525/ and helmet/ (unzipped USDZ)")
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    build_car(load_gltf(a.refs / "rb22" / "scene.gltf"), RB22, "2026-", 1.9, a.out)
    build_car(load_usd(a.refs / "a525" / "scene.usdc", a.refs / "a525" / "0"), A525, "2022-2025", 2.0, a.out)
    # f2022/f2022.glb: the Blender file exported to glTF (tools/models/blend2glb.py)
    build_car(load_gltf(a.refs / "f2022" / "f2022.glb"), F2022, "2017-2021", 2.0, a.out)
    build_helmet(load_usd(a.refs / "helmet" / "scene.usdc", a.refs / "helmet" / "0"), a.out)


if __name__ == "__main__":
    main()

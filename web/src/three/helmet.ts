import * as THREE from "three";
import { paint } from "./geom";
import type { Motif } from "./helmetRefs";

// Racing helmet built from front-to-back cross-sections (dome, tapering chin bar, flat base), with
// the eye port cut along the surface and a visor and seal fitted to its edge. The paint scheme uses
// reference colours where we have them (helmetRefs.ts); the artwork is our own.

export interface HelmetSpec {
  driverId: string;
  initials: string;
  number: number | null;
  colors: string[];
  motif: Motif;
  crown?: "stripe" | "triangles" | "wings" | "plain";
}

// ---------------------------------------------------------------- shape

// x along the head (back -> front), c = centre height, h = half height, w = half width, n = roundness
const SECTIONS: [number, number, number, number, number][] = [
  [-1.02, 0.1, 0.12, 0.13, 2.2],
  [-0.95, 0.07, 0.5, 0.465, 2.2],
  [-0.8, 0.04, 0.75, 0.67, 2.25],
  [-0.55, 0.02, 0.9, 0.781, 2.25],
  [-0.2, 0.0, 0.98, 0.837, 2.25],
  [0.15, -0.03, 0.99, 0.837, 2.25],
  [0.45, -0.08, 0.95, 0.8, 2.25],
  [0.7, -0.15, 0.86, 0.735, 2.25],
  [0.88, -0.24, 0.7, 0.623, 2.25],
  [1.0, -0.35, 0.5, 0.484, 2.25],
  [1.08, -0.47, 0.28, 0.307, 2.25],
  [1.12, -0.56, 0.08, 0.121, 2.25],
];
const RING = 120, SUB = 10;
const CENTRE = new THREE.Vector3(0.1, -0.08, 0);

const cr = (a: number, b: number, c: number, d: number, t: number) =>
  0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);

function shellGeometry(scale = 1): THREE.BufferGeometry {
  const S = SECTIONS;
  const rings: number[][] = [];
  for (let i = 0; i < S.length - 1; i++) {
    for (let k = 0; k < SUB; k++) {
      const t = k / SUB, g = (j: number) => S[Math.max(0, Math.min(S.length - 1, j))];
      rings.push([0, 1, 2, 3, 4].map((q) => cr(g(i - 1)[q], g(i)[q], g(i + 1)[q], g(i + 2)[q], t)));
    }
  }
  rings.push([...S[S.length - 1]]);
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  rings.forEach(([x, c, h, w, n], ri) => {
    for (let j = 0; j <= RING; j++) {
      const a = (j / RING) * Math.PI * 2, e = 2 / n, cs = Math.cos(a), sn = Math.sin(a);
      let y = c + h * Math.sign(sn) * Math.abs(sn) ** e;
      const z = w * Math.sign(cs) * Math.abs(cs) ** e;
      y = Math.max(y, -0.9 + 0.12 * Math.max(0, x)); // flat base rising toward the chin
      pos.push(x * scale, y * scale, z * scale);
      uv.push(j / RING, ri / (rings.length - 1));
    }
  });
  const W = RING + 1;
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < RING; j++) {
      const a = i * W + j, b = a + 1, c = a + W, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  for (const [ri, flip] of [[0, true], [rings.length - 1, false]] as const) {
    const centre = pos.length / 3;
    const r = rings[ri];
    pos.push(r[0] * scale, r[1] * scale, 0);
    uv.push(0.25, ri === 0 ? 0 : 1);
    for (let j = 0; j < RING; j++) {
      const a = ri * W + j, b = a + 1;
      if (flip) idx.push(centre, a, b); else idx.push(centre, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

interface Shared {
  shell: THREE.BufferGeometry; liner: THREE.BufferGeometry; visor: THREE.BufferGeometry; seal: THREE.BufferGeometry;
  hit: (az: number, el: number) => { p: THREE.Vector3; n: THREE.Vector3 };
}
let shared: Shared | null = null;

/** Port outline in (azimuth, elevation) around CENTRE: a rounded band across the face. */
const PORT = { az: 0.98, el0: -0.02, el1: 0.3 };

/** Geometry is the same for every helmet, so it is built once and shared (only paint differs). */
function geometries(): Shared {
  if (shared) return shared;
  const shell = shellGeometry();
  const probe = new THREE.Mesh(shell);
  probe.updateMatrixWorld();
  const ray = new THREE.Raycaster();
  const hit = (az: number, el: number) => {
    const dir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    ray.set(CENTRE.clone().add(dir.clone().multiplyScalar(3)), dir.clone().negate());
    const h = ray.intersectObject(probe, false)[0];
    return { p: h ? h.point.clone() : CENTRE.clone(), n: h?.face ? h.face.normal.clone() : dir };
  };
  // Port edge as a function of the parameter t in [0, 1): rounded rectangle in (az, el).
  const edge = (t: number, grow: number): [number, number] => {
    const a = t * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a), e = 2 / 6; // superellipse, n = 6: rectangle with soft corners
    const az = (PORT.az + grow) * Math.sign(c) * Math.abs(c) ** e;
    const midEl = (PORT.el0 + PORT.el1) / 2, halfEl = (PORT.el1 - PORT.el0) / 2 + grow;
    const narrow = 1 - 0.12 * Math.max(0, s); // top edge slightly narrower
    return [az * narrow, midEl + halfEl * Math.sign(s) * Math.abs(s) ** e];
  };
  const surface = (rows: number, cols: number, at: (i: number, j: number) => [number, number], offset: number, closedCols = false) => {
    const P: number[] = [], Uv: number[] = [], I: number[] = [];
    for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++) {
      const [az, el] = at(i / rows, j / cols);
      const { p, n } = hit(az, el);
      p.add(n.multiplyScalar(offset));
      P.push(p.x, p.y, p.z); Uv.push(j / cols, i / rows);
    }
    const W = cols + 1;
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const a = i * W + j, b = a + 1, c = a + W, d = c + 1;
      I.push(a, b, c, b, d, c);
    }
    void closedCols;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(Uv, 2));
    g.setIndex(I);
    g.computeVertexNormals();
    return g;
  };
  // Visor: grid over the port, mapped from the centre outward to the edge, standing proud of the shell.
  const visor = surface(24, 96, (r, t) => { const [az, el] = edge(t, 0.01); const mEl = (PORT.el0 + PORT.el1) / 2; return [az * r, mEl + (el - mEl) * r]; }, 0.028);
  // Seal: strip around the port edge.
  const seal = surface(3, 160, (r, t) => edge(t, 0.012 + r * 0.05), 0.014);
  fixOrientation(visor); fixOrientation(seal);
  const liner = shellGeometry(0.95);
  [shell, visor, seal, liner].forEach((g) => (g.userData.shared = true));
  shared = { shell, liner, visor, seal, hit };
  return shared;
}

/** Make every face of a surface point away from CENTRE (outward). */
function fixOrientation(g: THREE.BufferGeometry) {
  const pos = g.attributes.position as THREE.BufferAttribute, nor = g.attributes.normal as THREE.BufferAttribute;
  let dot = 0;
  for (let i = 0; i < pos.count; i++) {
    dot += (pos.getX(i) - CENTRE.x) * nor.getX(i) + (pos.getY(i) - CENTRE.y) * nor.getY(i) + (pos.getZ(i) - CENTRE.z) * nor.getZ(i);
  }
  if (dot < 0) {
    const a = g.index!.array as Uint16Array | Uint32Array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
    g.index!.needsUpdate = true;
    g.computeVertexNormals();
  }
}

// ---------------------------------------------------------------- paint

// canvas: x = around the cross-section (u), y = back -> front (v)

function paintTextures(spec: HelmetSpec, res = 1): { map: THREE.CanvasTexture; metal: THREE.CanvasTexture | null } {
  const U = 2048 * res, V = 1024 * res;
  const c = document.createElement("canvas");
  c.width = U; c.height = V;
  const g = c.getContext("2d")!;
  const [base, c2, c3, c4 = c3] = spec.colors;
  // u: 0 = right side (mid height), .25 = top centre, .5 = left side, .75 = underneath.
  const sideBand = (u0: number, u1: number, col: string, v0 = 0, v1 = 1) => {
    g.fillStyle = col;
    g.fillRect(u0 * U, v0 * V, (u1 - u0) * U, (v1 - v0) * V);
    g.fillRect((0.5 - u1) * U, v0 * V, (u1 - u0) * U, (v1 - v0) * V);
    if (u0 < 0) g.fillRect((1 + u0) * U, v0 * V, -u0 * U, (v1 - v0) * V);
  };
  const crownStripe = (half: number, col: string, v0 = 0.02, v1 = 0.98) => { g.fillStyle = col; g.fillRect((0.25 - half) * U, v0 * V, half * 2 * U, (v1 - v0) * V); };
  const swoosh = (col: string, width: number, lift: number) => {
    g.strokeStyle = col; g.lineWidth = width * res; g.lineCap = "round";
    for (const side of [0, 1]) {
      g.beginPath();
      for (let k = 0; k <= 40; k++) {
        const v = 0.08 + (k / 40) * 0.8, u = lift + 0.11 * (1 - v) ** 1.6;
        const x = (side ? 0.5 - u : u) * U, y = v * V;
        if (k) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
    }
  };
  g.fillStyle = base; g.fillRect(0, 0, U, V);
  let metal: HTMLCanvasElement | null = null;
  switch (spec.motif) {
    case "halves":
      g.fillStyle = c2;
      g.fillRect(0.5 * U, 0, 0.5 * U, V);
      g.fillRect(0, 0, 0.012 * U, V);
      g.fillRect(0.488 * U, 0, 0.012 * U, V);
      sideBand(0.012, 0.02, c3);
      break;
    case "bands":
      sideBand(0.02, 0.055, c2, 0.05, 1);
      sideBand(0.055, 0.075, c3, 0.05, 1);
      if (spec.colors[3]) sideBand(0.075, 0.088, c4, 0.05, 1);
      break;
    case "flag":
      sideBand(-0.03, 0.025, c2, 0, 1);
      sideBand(0.07, 0.085, c3, 0, 1);
      sideBand(-0.045, -0.03, c4, 0, 1);
      break;
    case "flourish":
      swoosh(c2, 70, 0.02);
      swoosh(c3, 18, 0.075);
      break;
    case "chrome": {
      metal = document.createElement("canvas");
      metal.width = U; metal.height = V;
      const m = metal.getContext("2d")!;
      m.fillStyle = "#000"; m.fillRect(0, 0, U, V);
      g.fillStyle = c2; m.fillStyle = "#fff";
      for (const ctx of [g, m]) {
        for (const side of [0, 1]) {
          ctx.beginPath();
          const pts: [number, number][] = [[-0.01, 0.15], [0.09, 0.3], [0.12, 0.75], [-0.01, 0.9]];
          pts.forEach(([u, v], i) => { const x = (side ? 0.5 - u : u) * U; if (i) ctx.lineTo(x, v * V); else ctx.moveTo(x, v * V); });
          ctx.closePath();
          ctx.fill();
        }
      }
      sideBand(0.09, 0.1, c3, 0.3, 0.75);
      break;
    }
    case "slashes": {
      const cols = [c2, c3, c4];
      for (let k = 0; k < 7; k++) {
        g.fillStyle = cols[k % 3];
        const v = 0.12 + k * 0.11;
        for (const side of [0, 1]) {
          const u0 = side ? 0.5 : 0, s = side ? -1 : 1;
          g.beginPath();
          g.moveTo((u0 - s * 0.02) * U, v * V); g.lineTo((u0 + s * 0.12) * U, (v + 0.05) * V);
          g.lineTo((u0 + s * 0.12) * U, (v + 0.085) * V); g.lineTo((u0 - s * 0.02) * U, (v + 0.035) * V);
          g.closePath(); g.fill();
        }
      }
      break;
    }
    case "crownwings":
      sideBand(0.0, 0.03, c2, 0.1, 1);
      sideBand(0.03, 0.042, c3, 0.1, 1);
      break;
  }
  if (spec.crown === "stripe") { crownStripe(0.016, c2); crownStripe(0.005, c3); }
  if (spec.crown === "triangles") {
    const cols = [c2, c3, c4, "#f6c400"];
    for (let i = 0; i < 26; i++) for (let j = 0; j < 4; j++) {
      g.fillStyle = cols[(i + j) % cols.length];
      const x = (0.17 + j * 0.04) * U, y = (0.08 + i * 0.033) * V, s = 0.02 * U;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + s, y + ((i + j) % 2 ? s : -s) * 0.8); g.lineTo(x + 2 * s, y); g.closePath(); g.fill();
    }
  }
  if (spec.crown === "wings") {
    g.fillStyle = c4;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(0.25 * U, 0.35 * V);
      g.quadraticCurveTo((0.25 + s * 0.09) * U, 0.42 * V, (0.25 + s * 0.12) * U, 0.7 * V);
      g.quadraticCurveTo((0.25 + s * 0.05) * U, 0.55 * V, 0.25 * U, 0.62 * V);
      g.closePath(); g.fill();
    }
  }
  // Car number on both sides, behind the eye port, upright and reading front-to-back.
  if (spec.number != null) {
    const light = (hex: string) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11 > 150; };
    g.font = `italic 700 ${V * 0.13}px "Titillium Web", "Segoe UI", sans-serif`;
    g.textAlign = "center"; g.textBaseline = "middle";
    for (const [u, rot] of [[0.07, Math.PI / 2], [0.43, -Math.PI / 2]] as const) {
      g.save();
      g.translate(u * U, 0.36 * V);
      g.rotate(rot);
      g.lineWidth = 8 * res; g.strokeStyle = light(base) ? "#ffffff" : "#000000";
      g.strokeText(String(spec.number), 0, 0);
      g.fillStyle = light(base) ? "#111111" : "#ffffff";
      g.fillText(String(spec.number), 0, 0);
      g.restore();
    }
  }
  const tex = (cv: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(cv);
    t.flipY = false;
    t.wrapS = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: tex(c, true), metal: metal ? tex(metal, false) : null };
}

// ---------------------------------------------------------------- assembly

/** Helmet facing +x, about 1.9 units tall, centred near the origin. */
export function buildHelmet(spec: HelmetSpec, res = 1): THREE.Group {
  const G = geometries();
  const grp = new THREE.Group();
  const { map, metal } = paintTextures(spec, res);
  const shellMat = paint("#ffffff", { map, metalness: metal ? 1 : 0.12, metalnessMap: metal ?? undefined, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.06 });
  const black = new THREE.MeshStandardMaterial({ color: "#0b0b0d", roughness: 0.6, metalness: 0.2 });
  const tint = new THREE.Color(spec.colors[1] ?? "#333333").lerp(new THREE.Color("#050507"), 0.985);
  const visorMat = new THREE.MeshPhysicalMaterial({ color: tint, metalness: 0.4, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, iridescence: 0.12, iridescenceIOR: 1.5 });
  grp.add(new THREE.Mesh(G.shell, shellMat));
  grp.add(new THREE.Mesh(G.seal, black));
  grp.add(new THREE.Mesh(G.visor, visorMat));
  const mount = (obj: THREE.Object3D, az: number, el: number, lift = 0) => {
    const { p, n } = G.hit(az, el);
    obj.position.copy(p.add(n.clone().multiplyScalar(lift)));
    obj.lookAt(obj.position.clone().add(n));
    grp.add(obj);
    return obj;
  };
  // Visor pivots at the ends of the eye port.
  for (const s of [-1, 1]) {
    const piv = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 32).rotateX(Math.PI / 2), paint(spec.colors[2] ?? "#888888", { metalness: 0.6 }));
    mount(piv, s * 1.12, 0.13, 0.012);
  }
  // Chin vents.
  for (const az of [-0.18, 0, 0.18]) {
    const vent = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.09, 4, 10).rotateZ(Math.PI / 2), black);
    vent.scale.set(1, 1, 0.5);
    mount(vent, az, -0.32, 0.005);
  }
  // Top intake: two flush ducts.
  for (const s of [-1, 1]) {
    const duct = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.14, 4, 10), black);
    duct.scale.set(1, 1, 0.45);
    mount(duct, s * 0.2, 0.95, 0.004);
  }
  // Rear gurney spoiler.
  const gs = new THREE.Shape();
  gs.moveTo(-0.33, 0); gs.lineTo(0.33, 0); gs.lineTo(0.28, 0.07); gs.lineTo(-0.28, 0.07); gs.closePath();
  const gurneyGeo = new THREE.ExtrudeGeometry(gs, { depth: 0.16, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2 });
  gurneyGeo.translate(0, 0, -0.08);
  mount(new THREE.Mesh(gurneyGeo, paint(spec.colors[1] ?? "#222222")), Math.PI, 0.5, 0).rotateX(-0.4);
  // Neck pad.
  const neck = new THREE.Mesh(new THREE.CircleGeometry(0.6, 48).rotateX(Math.PI / 2), black);
  neck.scale.set(1.25, 1, 1);
  neck.position.set(0.05, -0.885, 0);
  grp.add(neck);
  grp.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return grp;
}

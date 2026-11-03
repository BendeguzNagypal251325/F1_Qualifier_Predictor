import * as THREE from "three";

/** One cross-section of a lofted body: centre (x along the car, y up, z sideways), half sizes, roundness. */
export interface Section { x: number; y: number; z?: number; w: number; h: number; n?: number }

const smooth = (a: number, b: number, c: number, d: number, t: number) => {
  // Catmull-Rom between b and c
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
};

/**
 * Smooth body through superellipse cross-sections (n = 2 ellipse, larger = boxier).
 * Sections are interpolated with Catmull-Rom so the surface has no kinks; both ends are capped.
 */
export function loft(sections: Section[], ringPts = 40, sub = 8): THREE.BufferGeometry {
  const S = sections.map((s) => ({ z: 0, n: 2.4, ...s }));
  const get = (i: number) => S[Math.max(0, Math.min(S.length - 1, i))];
  const rings: Section[] = [];
  for (let i = 0; i < S.length - 1; i++) {
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      const [a, b, c, d] = [get(i - 1), get(i), get(i + 1), get(i + 2)];
      const f = (key: keyof Section) => smooth(a[key] as number, b[key] as number, c[key] as number, d[key] as number, t);
      rings.push({ x: f("x"), y: f("y"), z: f("z"), w: Math.max(0.001, f("w")), h: Math.max(0.001, f("h")), n: f("n") });
    }
  }
  rings.push(S[S.length - 1]);
  const pos: number[] = [];
  const idx: number[] = [];
  rings.forEach((r) => {
    for (let j = 0; j < ringPts; j++) {
      const a = (j / ringPts) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a), e = 2 / (r.n ?? 2.4);
      pos.push(r.x, r.y + r.h * Math.sign(s) * Math.abs(s) ** e, (r.z ?? 0) + r.w * Math.sign(c) * Math.abs(c) ** e);
    }
  });
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < ringPts; j++) {
      const a = i * ringPts + j, b = i * ringPts + ((j + 1) % ringPts), c = a + ringPts, d = b + ringPts;
      idx.push(a, c, b, b, c, d);
    }
  }
  // caps
  const cap = (ri: number, flip: boolean) => {
    const r = rings[ri];
    const centre = pos.length / 3;
    pos.push(r.x, r.y, r.z ?? 0);
    for (let j = 0; j < ringPts; j++) {
      const a = ri * ringPts + j, b = ri * ringPts + ((j + 1) % ringPts);
      if (flip) idx.push(centre, a, b);
      else idx.push(centre, b, a);
    }
  };
  cap(0, false);
  cap(rings.length - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Wing element: a cambered airfoil (chord along -x from the leading edge) extruded across the car (z). */
/** Wing element along z. ``sweep`` bends the tips back (towards -x) by that many metres, so the plan view
 *  curves like a modern front wing; the span is then split into segments so the bend is smooth. */
export function airfoil(chord: number, thickness: number, span: number, camber = 0.06, sweep = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const N = 24;
  const up: [number, number][] = [], lo: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const x = i / N;
    const yt = 5 * thickness * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const yc = camber * 4 * x * (1 - x);
    up.push([-x * chord, (yc + yt) * chord]);
    lo.push([-x * chord, (yc - yt) * chord]);
  }
  shape.moveTo(up[0][0], up[0][1]);
  up.slice(1).forEach(([x, y]) => shape.lineTo(x, y));
  lo.reverse().forEach(([x, y]) => shape.lineTo(x, y));
  const g = new THREE.ExtrudeGeometry(shape, { depth: span, bevelEnabled: false, curveSegments: 4, steps: sweep ? 32 : 1 });
  g.translate(0, 0, -span / 2);
  if (sweep) {
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) - sweep * Math.abs((2 * pos.getZ(i)) / span) ** 1.8);
  }
  g.computeVertexNormals();
  return g;
}

/** Tyre (axis along z): rounded rectangular section turned around the axle. */
export function tyre(radius: number, width: number, rimRadius: number): THREE.BufferGeometry {
  const hw = width / 2, rr = Math.min(0.07, width * 0.25);
  const pts: THREE.Vector2[] = [new THREE.Vector2(rimRadius, -hw * 0.92)];
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * (Math.PI / 2);
    pts.push(new THREE.Vector2(radius - rr + Math.cos(a) * rr, -hw + rr + Math.sin(a) * rr));
  }
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    pts.push(new THREE.Vector2(radius - rr + Math.cos(a) * rr, hw - rr + Math.sin(a) * rr));
  }
  pts.push(new THREE.Vector2(rimRadius, hw * 0.92));
  const g = new THREE.LatheGeometry(pts, 64);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Thin cylinder between two points (suspension arms, pylons). */
export function rod(a: THREE.Vector3, b: THREE.Vector3, r = 0.012): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, 10);
  const m = new THREE.Matrix4();
  const dir = b.clone().sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  m.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  return g;
}

export function roundedBox(w: number, h: number, d: number, r = 0.01): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y); shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r); shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h); shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return g;
}

export function paint(color: string, opts: Partial<THREE.MeshPhysicalMaterialParameters> = {}) {
  return new THREE.MeshPhysicalMaterial({ color, metalness: 0.35, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.12, ...opts });
}
export const carbon = () => new THREE.MeshPhysicalMaterial({ color: "#101014", metalness: 0.25, roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.3 });
export const rubber = () => new THREE.MeshStandardMaterial({ color: "#121214", metalness: 0, roughness: 0.92 });
export const metal = () => new THREE.MeshStandardMaterial({ color: "#3a3d44", metalness: 0.9, roughness: 0.3 });

/** Mirror across the car's centre plane (z -> -z), keeping triangles facing outwards. */
export function mirrorZ(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = src.clone();
  g.scale(1, 1, -1);
  if (g.index) {
    const a = g.index.array as Uint16Array | Uint32Array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
    g.index.needsUpdate = true;
  } else {
    for (const name of Object.keys(g.attributes)) {
      const attr = g.attributes[name] as THREE.BufferAttribute;
      const n = attr.itemSize, arr = attr.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3 * n) {
        for (let k = 0; k < n; k++) { const t = arr[i + n + k]; arr[i + n + k] = arr[i + 2 * n + k]; arr[i + 2 * n + k] = t; }
      }
      attr.needsUpdate = true;
    }
  }
  g.computeVertexNormals();
  return g;
}

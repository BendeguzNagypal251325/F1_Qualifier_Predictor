import * as THREE from "three";
import { airfoil, carbon, loft, metal, mirrorZ, paint, rod, roundedBox, rubber, tyre, type Section } from "./geom";
import { buildHelmet, type HelmetSpec } from "./helmet";
import type { PartId } from "./parts";

// 3D car built from each regulation era's published dimensions (FIA technical regulations):
// wheelbase, overall width, wheel and tyre sizes, wing spans and heights. Shapes are simplified;
// liveries use the team's colours for that season, without sponsor logos.

interface Era {
  wb: number; width: number; R: number; rim: number; twF: number; twR: number; covers: boolean;
  noseY: number; noseLen: number; fwSpan: number; fwEls: number; rwSpan: number; rwY: number;
  floorHalf: number; pod: "box" | "downwash"; podZ: number; bargeboards: boolean; active: boolean; tLen: number;
}

export const ERAS: Record<string, Era> = {
  "2017-2021": { wb: 3.65, width: 2.0, R: 0.335, rim: 0.2, twF: 0.305, twR: 0.405, covers: false, noseY: 0.25, noseLen: 1.15,
    fwSpan: 1.8, fwEls: 5, rwSpan: 0.95, rwY: 0.92, floorHalf: 0.7, pod: "box", podZ: 0.56, bargeboards: true, active: false, tLen: 5.6 },
  "2022-2025": { wb: 3.6, width: 2.0, R: 0.36, rim: 0.245, twF: 0.305, twR: 0.405, covers: true, noseY: 0.2, noseLen: 1.08,
    fwSpan: 1.8, fwEls: 4, rwSpan: 0.95, rwY: 0.86, floorHalf: 0.8, pod: "downwash", podZ: 0.55, bargeboards: false, active: false, tLen: 5.5 },
  "2026-": { wb: 3.4, width: 1.9, R: 0.355, rim: 0.245, twF: 0.28, twR: 0.375, covers: true, noseY: 0.2, noseLen: 1.0,
    fwSpan: 1.7, fwEls: 3, rwSpan: 0.95, rwY: 0.86, floorHalf: 0.74, pod: "downwash", podZ: 0.52, bargeboards: false, active: true, tLen: 5.2 },
};

export interface BuiltCar { group: THREE.Group; parts: Map<PartId, THREE.Mesh[]>; length: number; centre: THREE.Vector3 }

export function buildCar(era: string, livery: [string, string, string], helmet?: HelmetSpec): BuiltCar {
  const E = ERAS[era] ?? ERAS["2022-2025"];
  const [P, S, A] = livery;
  const F = E.wb; // front axle x; rear axle at x = 0
  const group = new THREE.Group();
  const parts = new Map<PartId, THREE.Mesh[]>();
  const add = (part: PartId, geo: THREE.BufferGeometry, mat: THREE.Material, mirror = false) => {
    const place = (g: THREE.BufferGeometry) => {
      const m = new THREE.Mesh(g, mat.clone());
      m.castShadow = true; m.receiveShadow = true;
      m.userData.part = part;
      group.add(m);
      parts.set(part, [...(parts.get(part) ?? []), m]);
      return m;
    };
    place(geo);
    if (mirror) place(mirrorZ(geo));
  };
  const zw = (tw: number) => E.width / 2 - tw / 2;

  // ---- nose & survival cell
  const tip = F + E.noseLen;
  const chassis: Section[] = [
    { x: F - 2.1, y: 0.5, w: 0.38, h: 0.26, n: 3.4 },
    { x: F - 1.6, y: 0.55, w: 0.37, h: 0.27, n: 3.2 },
    { x: F - 1.1, y: 0.56, w: 0.3, h: 0.24, n: 3 },
    { x: F - 0.55, y: 0.53, w: 0.22, h: 0.19, n: 2.7 },
    { x: F, y: E.noseY + 0.24, w: 0.16, h: 0.14, n: 2.5 },
    { x: F + 0.5, y: E.noseY + 0.15, w: 0.11, h: 0.1, n: 2.3 },
    { x: tip - 0.12, y: E.noseY + 0.05, w: 0.065, h: 0.06, n: 2.2 },
    { x: tip, y: E.noseY, w: 0.02, h: 0.025, n: 2 },
  ];
  add("nose", loft(chassis, 44, 10), paint(P));
  add("nose", loft(chassis.slice(2).map((s) => ({ ...s, y: s.y + s.h * 0.92, w: s.w * 0.22, h: s.h * 0.12 })), 20, 8), paint(S));

  // ---- cockpit: opening, halo, helmet, mirrors
  const opening = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshStandardMaterial({ color: "#050506", roughness: 0.8 }));
  opening.scale.set(0.42, 0.05, 0.25);
  opening.position.set(F - 1.48, 0.8, 0);
  opening.userData.part = "cockpit"; group.add(opening); parts.set("cockpit", [opening]);
  const halo = new THREE.CatmullRomCurve3([
    new THREE.Vector3(F - 1.78, 0.78, -0.27), new THREE.Vector3(F - 1.4, 0.93, -0.26), new THREE.Vector3(F - 1.08, 0.93, -0.12),
    new THREE.Vector3(F - 1.0, 0.92, 0), new THREE.Vector3(F - 1.08, 0.93, 0.12), new THREE.Vector3(F - 1.4, 0.93, 0.26),
    new THREE.Vector3(F - 1.78, 0.78, 0.27),
  ]);
  add("cockpit", new THREE.TubeGeometry(halo, 80, 0.024, 12), carbon());
  add("cockpit", rod(new THREE.Vector3(F - 0.82, 0.7, 0), new THREE.Vector3(F - 1.0, 0.92, 0), 0.022), carbon());
  for (const z of [-0.42, 0.42]) {
    add("cockpit", roundedBox(0.04, 0.06, 0.13, 0.01).translate(F - 1.22, 0.78, z), paint(P));
    add("cockpit", rod(new THREE.Vector3(F - 1.22, 0.7, z * 0.75), new THREE.Vector3(F - 1.22, 0.76, z), 0.008), carbon());
  }
  if (helmet) {
    const h = buildHelmet(helmet);
    h.scale.multiplyScalar(0.135);
    h.position.set(F - 1.52, 0.86, 0);
    h.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.userData.part = "cockpit"; parts.get("cockpit")!.push(o as THREE.Mesh); } });
    group.add(h);
  }

  // ---- power unit / engine cover, airbox, spine stripe
  const cover: Section[] = [
    { x: F - 2.05, y: 0.66, w: 0.34, h: 0.34, n: 3 },
    { x: F - 2.5, y: 0.6, w: 0.3, h: 0.32, n: 2.8 },
    { x: F - 3.05, y: 0.5, w: 0.2, h: 0.24, n: 2.6 },
    { x: 0.0, y: 0.44, w: 0.11, h: 0.15, n: 2.4 },
    { x: -0.45, y: 0.42, w: 0.05, h: 0.09, n: 2.2 },
  ];
  add("power-unit", loft(cover, 44, 10), paint(P));
  add("power-unit", loft(cover.map((s) => ({ ...s, y: s.y + s.h * 0.95, w: Math.max(0.012, s.w * 0.14), h: s.h * 0.08 })), 16, 8), paint(S));
  const airbox: Section[] = [
    { x: F - 1.9, y: 0.98, w: 0.11, h: 0.08, n: 2.6 },
    { x: F - 2.05, y: 0.99, w: 0.13, h: 0.1, n: 2.6 },
    { x: F - 2.4, y: 0.9, w: 0.1, h: 0.07, n: 2.4 },
  ];
  add("power-unit", loft(airbox, 28, 8), paint(S));
  const intake = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshStandardMaterial({ color: "#000", side: THREE.DoubleSide }));
  intake.scale.set(0.075, 0.055, 1); intake.rotation.y = Math.PI / 2; intake.position.set(F - 1.895, 0.985, 0);
  intake.userData.part = "power-unit"; group.add(intake); parts.get("power-unit")!.push(intake);

  // ---- sidepods (+ bargeboards before 2022)
  const pod: Section[] = E.pod === "box"
    ? [{ x: F - 1.28, y: 0.47, z: E.podZ, w: 0.2, h: 0.2, n: 4 }, { x: F - 1.75, y: 0.46, z: E.podZ, w: 0.22, h: 0.21, n: 4 },
       { x: F - 2.5, y: 0.4, z: E.podZ - 0.08, w: 0.18, h: 0.16, n: 3.2 }, { x: 0.55, y: 0.32, z: 0.28, w: 0.1, h: 0.1, n: 2.6 }, { x: 0.1, y: 0.3, z: 0.18, w: 0.05, h: 0.06, n: 2.4 }]
    : [{ x: F - 1.3, y: 0.43, z: E.podZ, w: 0.19, h: 0.16, n: 3.2 }, { x: F - 1.72, y: 0.42, z: E.podZ + 0.02, w: 0.21, h: 0.18, n: 3 },
       { x: F - 2.3, y: 0.36, z: E.podZ - 0.05, w: 0.19, h: 0.13, n: 2.6 }, { x: 0.7, y: 0.3, z: 0.34, w: 0.13, h: 0.09, n: 2.4 }, { x: 0.15, y: 0.28, z: 0.18, w: 0.05, h: 0.05, n: 2.2 }];
  add("sidepods", loft(pod, 40, 10), paint(P), true);
  add("sidepods", loft(pod.slice(0, 4).map((s) => ({ ...s, y: s.y + s.h * 0.9, w: s.w * 0.55, h: s.h * 0.1 })), 20, 8), paint(S), true);
  const inlet = roundedBox(0.02, pod[0].h * 1.5, pod[0].w * 1.5, 0.03).translate(pod[0].x + 0.005, pod[0].y, E.podZ);
  add("sidepods", inlet, new THREE.MeshStandardMaterial({ color: "#020203", roughness: 0.9 }), true);
  if (E.bargeboards) {
    for (let k = 0; k < 3; k++) {
      add("sidepods", roundedBox(0.32 - k * 0.06, 0.2, 0.012, 0.005).translate(F - 0.95 + k * 0.04, 0.2, 0.42 + k * 0.08), paint(A, { metalness: 0.2 }), true);
    }
  }

  // ---- floor, edge wing, diffuser
  const plan = new THREE.Shape();
  const fh = E.floorHalf;
  plan.moveTo(-0.3, -0.48); plan.lineTo(0.35, -0.5); plan.lineTo(0.55, -fh); plan.lineTo(F - 1.1, -fh);
  plan.quadraticCurveTo(F - 0.62, -fh + 0.05, F - 0.55, -0.24); plan.lineTo(F - 0.55, 0.24);
  plan.quadraticCurveTo(F - 0.62, fh - 0.05, F - 1.1, fh); plan.lineTo(0.55, fh); plan.lineTo(0.35, 0.5); plan.lineTo(-0.3, 0.48); plan.closePath();
  const floorGeo = new THREE.ExtrudeGeometry(plan, { depth: 0.025, bevelEnabled: false });
  floorGeo.rotateX(Math.PI / 2); floorGeo.translate(0, 0.07, 0);
  add("floor", floorGeo, carbon());
  add("floor", roundedBox(F - 1.75, 0.012, 0.03, 0.004).translate((F - 1.1 + 0.55) / 2, 0.075, fh - 0.01), paint(A), true);
  if (E.pod === "downwash") add("floor", roundedBox(F - 1.9, 0.05, 0.01, 0.004).translate((F - 1.2 + 0.7) / 2, 0.1, fh - 0.03), carbon(), true);
  const diff = roundedBox(0.6, 0.012, 0.9, 0.004);
  diff.rotateZ(-0.35); diff.translate(-0.3, 0.16, 0);
  add("floor", diff, carbon());

  // ---- front wing
  const fwX = tip + 0.08;
  for (let k = 0; k < E.fwEls; k++) {
    const chord = 0.17 - k * 0.02, span = E.fwSpan - (k === 0 ? 0 : 0.12 + k * 0.03);
    const g = airfoil(chord, 0.035, span, 0.08);
    g.rotateZ(-(0.04 + k * 0.17));
    g.translate(fwX - k * 0.115, 0.085 + k * 0.05, 0);
    add("front-wing", g, k < E.fwEls - 2 ? carbon() : paint(k === E.fwEls - 1 ? S : P));
  }
  for (const z of [-1, 1]) {
    add("front-wing", roundedBox(0.46, 0.22, 0.012, 0.04).translate(fwX - 0.22, 0.17, (z * E.fwSpan) / 2), paint(A));
  }
  add("front-wing", rod(new THREE.Vector3(tip - 0.25, E.noseY + 0.02, 0.06), new THREE.Vector3(tip - 0.2, 0.1, 0.12), 0.012), carbon(), true);

  // ---- rear wing: mainplane, flap, beam wing, endplates, pylon
  const rwX = -0.4;
  const main = airfoil(0.26, 0.055, E.rwSpan, 0.08); main.rotateZ(-0.12); main.translate(rwX, E.rwY, 0);
  add("rear-wing", main, carbon());
  const flap = airfoil(0.17, 0.05, E.rwSpan, 0.07); flap.rotateZ(E.active ? -0.35 : -0.55); flap.translate(rwX - 0.22, E.rwY + 0.09, 0);
  add("rear-wing", flap, paint(S));
  const beam = airfoil(0.14, 0.05, E.rwSpan * 0.8, 0.05); beam.rotateZ(-0.25); beam.translate(rwX - 0.05, 0.46, 0);
  add("rear-wing", beam, carbon());
  for (const z of [-1, 1]) {
    add("rear-wing", roundedBox(0.5, 0.44, 0.012, 0.06).translate(rwX - 0.18, E.rwY - 0.04, (z * E.rwSpan) / 2), paint(P));
    add("rear-wing", roundedBox(0.5, 0.035, 0.014, 0.01).translate(rwX - 0.18, E.rwY + 0.17, (z * E.rwSpan) / 2), paint(A));
  }
  add("rear-wing", roundedBox(0.16, 0.42, 0.02, 0.01).translate(rwX - 0.12, E.rwY - 0.24, 0), carbon());
  const light = new THREE.Mesh(roundedBox(0.02, 0.05, 0.12, 0.005), new THREE.MeshStandardMaterial({ color: "#ff1a1a", emissive: "#ff1a1a", emissiveIntensity: 1.4 }));
  light.position.set(rwX - 0.02, 0.4, 0); light.userData.part = "rear-wing"; group.add(light); parts.get("rear-wing")!.push(light);

  // ---- wheels, tyres, suspension
  const wheel = (x: number, tw: number) => {
    for (const s of [-1, 1]) {
      const z = s * zw(tw);
      add("wheels", tyre(E.R, tw, E.rim).translate(x, E.R, z), rubber());
      add("wheels", new THREE.CylinderGeometry(E.rim, E.rim, tw * 0.86, 40).rotateX(Math.PI / 2).translate(x, E.R, z), metal());
      if (E.covers) add("wheels", new THREE.CylinderGeometry(E.rim * 0.98, E.rim * 0.98, tw * 0.9, 40).rotateX(Math.PI / 2).translate(x, E.R, z), carbon());
      const band = new THREE.RingGeometry(E.R * 0.8, E.R * 0.84, 64);
      add("wheels", band.clone().translate(0, 0, tw / 2 + 0.002).applyMatrix4(new THREE.Matrix4().makeTranslation(x, E.R, z)), new THREE.MeshStandardMaterial({ color: "#e10600", roughness: 0.6, side: THREE.DoubleSide }));
      add("wheels", band.clone().translate(0, 0, -tw / 2 - 0.002).applyMatrix4(new THREE.Matrix4().makeTranslation(x, E.R, z)), new THREE.MeshStandardMaterial({ color: "#e10600", roughness: 0.6, side: THREE.DoubleSide }));
      const hub = new THREE.Vector3(x, E.R, z - s * (tw / 2 + 0.03));
      const arms: [number, number, number][] = [[-0.25, 0.46, 0.14], [0.25, 0.46, 0.14], [-0.3, 0.26, 0.16], [0.3, 0.26, 0.16]];
      arms.forEach(([dx, y, zc]) => add("wheels", rod(new THREE.Vector3(x + dx, y, s * zc), hub.clone().setY(y > 0.3 ? E.R + 0.12 : E.R - 0.12), 0.014), carbon()));
    }
  };
  wheel(F, E.twF);
  wheel(0, E.twR);

  const centre = new THREE.Vector3((F + -0.6 + tip) / 2 - 0.3, 0.45, 0);
  return { group, parts, length: E.tLen, centre };
}

export function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      if (!m.geometry.userData.shared) m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach((mat) => {
        const mm = mat as THREE.MeshStandardMaterial;
        mm.map?.dispose();
        mm.dispose();
      });
    }
  });
}


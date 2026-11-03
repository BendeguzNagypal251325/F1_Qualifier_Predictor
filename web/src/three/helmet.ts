import * as THREE from "three";
import { paint } from "./geom";

// Original helmet designs. Each driver gets a fixed personal pattern (seeded by their id, so it
// stays the same every season) painted in that season's team colours, with their car number.
// These are not replicas of the drivers' real helmets.

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PATTERNS = ["chevron", "split", "rings", "swoosh", "stars", "bolt", "stripes", "check"] as const;
export type Pattern = (typeof PATTERNS)[number];
export const patternFor = (driverId: string): Pattern => PATTERNS[hash(driverId) % PATTERNS.length];

export interface HelmetSpec { driverId: string; initials: string; number: number | null; colors: [string, string, string] }

/** Equirectangular texture: u = around the head (0 back, 0.5 front), v = top to bottom. */
function paintTexture(spec: HelmetSpec): THREE.CanvasTexture {
  const W = 2048, H = 1024;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const [p, s, a] = spec.colors;
  const r = rng(hash(spec.driverId));
  const light = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 > 150;
  };
  // Keep the base readable: if the team's primary is near-black, lead with the secondary colour.
  const base = p, c2 = s === p ? "#ffffff" : s, c3 = a;
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  const pattern = patternFor(spec.driverId);
  const band = (y: number, h: number, col: string) => { g.fillStyle = col; g.fillRect(0, y * H, W, h * H); };
  g.lineJoin = "round";
  switch (pattern) {
    case "chevron": {
      for (const [off, col] of [[0, c2], [0.07, c3]] as const) {
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(W * 0.5, H * (0.12 + off));
        g.lineTo(W * 0.15, H * (0.62 + off)); g.lineTo(W * 0.2, H * (0.7 + off));
        g.lineTo(W * 0.5, H * (0.26 + off)); g.lineTo(W * 0.8, H * (0.7 + off)); g.lineTo(W * 0.85, H * (0.62 + off));
        g.closePath(); g.fill();
      }
      break;
    }
    case "split": {
      g.fillStyle = c2;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(W, 0); g.lineTo(W, H * 0.3);
      for (let x = W; x >= 0; x -= 32) g.lineTo(x, H * (0.3 + 0.08 * Math.sin((x / W) * Math.PI * 4 + r() * 0.2)));
      g.closePath(); g.fill();
      g.strokeStyle = c3; g.lineWidth = 22;
      g.beginPath();
      for (let x = 0; x <= W; x += 32) g.lineTo(x, H * (0.3 + 0.08 * Math.sin((x / W) * Math.PI * 4)) + 18);
      g.stroke();
      break;
    }
    case "rings": {
      band(0, 0.16, c3); band(0.33, 0.05, c2); band(0.4, 0.02, c3); band(0.72, 0.06, c2);
      break;
    }
    case "swoosh": {
      for (const [k, col, wdt] of [[0, c2, 70], [1, c3, 34]] as const) {
        g.strokeStyle = col; g.lineWidth = wdt;
        g.beginPath();
        for (let x = 0; x <= W; x += 16) g.lineTo(x, H * (0.62 + 0.13 * Math.sin((x / W) * Math.PI * 2 + 1.2 + k * 0.35)));
        g.stroke();
      }
      band(0, 0.1, c2);
      break;
    }
    case "stars": {
      band(0, 0.2, c2);
      g.fillStyle = c3;
      for (let i = 0; i < 26; i++) {
        const x = r() * W, y = H * (0.25 + r() * 0.55), R = 18 + r() * 30;
        g.beginPath();
        for (let k = 0; k < 10; k++) {
          const ang = (k / 10) * Math.PI * 2 - Math.PI / 2, rad = k % 2 ? R * 0.45 : R;
          g.lineTo(x + Math.cos(ang) * rad, y + Math.sin(ang) * rad);
        }
        g.closePath(); g.fill();
      }
      break;
    }
    case "bolt": {
      g.fillStyle = c2;
      g.beginPath();
      const pts: [number, number][] = [];
      for (let i = 0; i <= 12; i++) pts.push([(i / 12) * W, H * (i % 2 ? 0.5 : 0.62)]);
      g.moveTo(0, H * 0.42);
      pts.forEach(([x, y]) => g.lineTo(x, y - 60));
      [...pts].reverse().forEach(([x, y]) => g.lineTo(x, y + 30));
      g.closePath(); g.fill();
      band(0, 0.08, c3);
      break;
    }
    case "stripes": {
      const n = 3 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        g.fillStyle = i % 2 ? c3 : c2;
        const x = W * 0.5 + (i - (n - 1) / 2) * 70;
        g.fillRect(x - 22, 0, 44, H * 0.9);
      }
      break;
    }
    case "check": {
      band(0, 0.18, c2);
      const sq = 46;
      for (let y = 0; y < 3; y++) for (let x = 0; x < W / sq; x++) {
        g.fillStyle = (x + y) % 2 ? c3 : c2;
        g.fillRect(x * sq, H * 0.58 + y * sq, sq, sq);
      }
      break;
    }
  }
  // Car number on both sides, initials on the back (wrapping across u = 0).
  const ink = light(base) ? "#111111" : "#ffffff";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.font = `italic 700 ${H * 0.14}px "Titillium Web", "Segoe UI", sans-serif`;
  g.lineWidth = 10; g.strokeStyle = light(base) ? "#ffffff" : "#000000";
  if (spec.number != null) {
    for (const u of [0.25, 0.75]) {
      g.strokeText(String(spec.number), W * u, H * 0.5);
      g.fillStyle = ink; g.fillText(String(spec.number), W * u, H * 0.5);
    }
  }
  g.font = `700 ${H * 0.09}px "Titillium Web", "Segoe UI", sans-serif`;
  for (const x of [0, W]) {
    g.strokeText(spec.initials, x, H * 0.42);
    g.fillStyle = ink; g.fillText(spec.initials, x, H * 0.42);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ---------------------------------------------------------------- shape

const PORT = { phi: 0.8, top: 0.405 * Math.PI, bottom: 0.548 * Math.PI }; // eye port around the front (phi = pi)

/** Move a point of the unit sphere onto the helmet surface. */
function shapePoint(x: number, y: number, z: number, r = 1): [number, number, number] {
  x /= r; y /= r; z /= r;
  const front = Math.max(0, x), back = Math.max(0, -x), low = Math.max(0, -y), high = Math.max(0, y);
  let X = x, Y = y, Z = z;
  Y -= 0.06 * high * high;                       // slightly flatter crown
  Z *= 0.88 + 0.05 * low;                        // narrow head, fuller cheeks
  X += 0.26 * front * low * low;                 // chin bar juts forward
  Y -= 0.12 * front * low;                       // and drops a little
  X -= 0.1 * back * low;                         // tucked-in nape
  if (Y < -0.78) Y = -0.78 + (Y + 0.78) * 0.35;  // flat base
  return [X * 1.07 * r, Y * r, Z * r];
}

function shaped(g: THREE.BufferGeometry, r = 1): THREE.BufferGeometry {
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, ...shapePoint(p.getX(i), p.getY(i), p.getZ(i), r));
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** Spherical angles of a unit-sphere point, in three.js SphereGeometry convention (front = phi pi). */
function angles(x: number, y: number, z: number) {
  const theta = Math.acos(Math.max(-1, Math.min(1, y)));
  let phi = Math.atan2(z, -x);
  if (phi < 0) phi += Math.PI * 2;
  return { phi, theta };
}

/** Drop the triangles of an indexed sphere whose centre lies inside the eye port. */
function cutPort(g: THREE.SphereGeometry, margin = 0): THREE.BufferGeometry {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const idx = g.index!.array;
  const keep: number[] = [];
  for (let i = 0; i < idx.length; i += 3) {
    const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]];
    const x = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3, y = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3, z = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    const len = Math.hypot(x, y, z) || 1;
    const { phi, theta } = angles(x / len, y / len, z / len);
    const inPort = Math.abs(phi - Math.PI) < PORT.phi + margin && theta > PORT.top - margin && theta < PORT.bottom + margin;
    if (!inPort) keep.push(a, b, c);
  }
  g.setIndex(keep);
  return g;
}

const band = (r: number, phiHalf: number, t0: number, t1: number, seg = 64) =>
  shaped(new THREE.SphereGeometry(r, seg, 3, Math.PI - phiHalf, phiHalf * 2, t0, t1 - t0), r);

/** Helmet facing +x, about 2 units tall, centred near the origin. */
export function buildHelmet(spec: HelmetSpec): THREE.Group {
  const grp = new THREE.Group();
  const accent = spec.colors[2];
  const black = new THREE.MeshStandardMaterial({ color: "#0c0c0e", roughness: 0.55, metalness: 0.2 });
  // Painted shell with the eye port cut out.
  const shellGeo = cutPort(new THREE.SphereGeometry(1, 128, 96, 0, Math.PI * 2, 0, Math.PI * 0.86));
  grp.add(new THREE.Mesh(shaped(shellGeo), paint("#ffffff", { map: paintTexture(spec), metalness: 0.15, roughness: 0.26, side: THREE.DoubleSide })));
  // Padded liner seen through the port.
  grp.add(new THREE.Mesh(shaped(new THREE.SphereGeometry(0.94, 48, 32, Math.PI - 1.0, 2.0, Math.PI * 0.36, Math.PI * 0.26), 0.94),
    new THREE.MeshStandardMaterial({ color: "#1a1a1f", roughness: 0.95, side: THREE.DoubleSide })));
  // Visor: tinted, standing slightly proud of the shell, with an iridium hint of the accent colour.
  const visorMat = new THREE.MeshPhysicalMaterial({ color: "#0b0b10", metalness: 0.55, roughness: 0.06, clearcoat: 1, transparent: true, opacity: 0.9,
    sheen: 1, sheenColor: new THREE.Color(accent), sheenRoughness: 0.35, iridescence: 0.6, iridescenceIOR: 1.6 });
  grp.add(new THREE.Mesh(band(1.035, PORT.phi + 0.06, PORT.top - 0.012 * Math.PI, PORT.bottom + 0.012 * Math.PI), visorMat));
  // Rubber seals above and below the port, and the visor pivots.
  grp.add(new THREE.Mesh(band(1.045, PORT.phi + 0.1, PORT.top - 0.026 * Math.PI, PORT.top - 0.01 * Math.PI), black));
  grp.add(new THREE.Mesh(band(1.04, PORT.phi + 0.06, PORT.bottom + 0.008 * Math.PI, PORT.bottom + 0.022 * Math.PI), black));
  for (const s of [-1, 1]) {
    const piv = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 28), paint(accent, { metalness: 0.6 }));
    const phi = Math.PI + s * (PORT.phi + 0.18), th = (PORT.top + PORT.bottom) / 2;
    const [px, py, pz] = shapePoint(-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th), 1.0);
    piv.position.set(px, py, pz);
    piv.lookAt(px * 2, py * 2, pz * 2);
    piv.rotateX(Math.PI / 2);
    grp.add(piv);
  }
  // Chin vents.
  for (let k = -1; k <= 1; k++) {
    const th = 0.69 * Math.PI, phi = Math.PI + k * 0.17;
    const [vx, vy, vz] = shapePoint(-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th), 1.01);
    const vent = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.13, 4, 8), black);
    vent.position.set(vx, vy, vz);
    vent.lookAt(vx * 2, vy * 2 - 0.4, vz * 2);
    vent.rotateX(Math.PI / 2);
    grp.add(vent);
  }
  // Flush top vents and the rear gurney.
  for (const k of [-1, 1]) {
    const th = 0.16 * Math.PI, phi = Math.PI + k * 0.28;
    const [vx, vy, vz] = shapePoint(-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th), 1.0);
    const vent = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.16, 4, 8), black);
    vent.position.set(vx, vy, vz);
    vent.lookAt(vx * 2, vy * 2, vz * 2);
    vent.rotateY(Math.PI / 2);
    vent.scale.set(1, 1, 0.5);
    grp.add(vent);
  }
  const gurneyShape = new THREE.Shape();
  gurneyShape.moveTo(0, 0); gurneyShape.lineTo(0.26, 0.02); gurneyShape.lineTo(0.3, 0.1); gurneyShape.lineTo(0.02, 0.06); gurneyShape.closePath();
  const gurney = new THREE.Mesh(new THREE.ExtrudeGeometry(gurneyShape, { depth: 0.7, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 2 }), paint(accent));
  gurney.geometry.translate(0, 0, -0.35);
  gurney.position.set(-0.98, 0.42, 0);
  gurney.rotation.z = 2.3;
  grp.add(gurney);
  // Neck roll.
  const neck = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.07, 14, 72), black);
  neck.rotation.x = Math.PI / 2;
  neck.scale.set(1.12, 0.9, 1);
  neck.position.set(0.02, -0.8, 0);
  grp.add(neck);
  grp.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return grp;
}

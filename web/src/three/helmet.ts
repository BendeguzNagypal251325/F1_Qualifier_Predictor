import * as THREE from "three";
import { glass, paint } from "./geom";

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

/** Shape a unit sphere into a helmet: taller crown, chin bar pushed forward and down, flatter sides. */
function deform(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i);
    const z = p.getZ(i);
    const front = Math.max(0, x), low = Math.max(0, -y);
    x += 0.22 * front * low;          // chin bar forward
    y -= 0.16 * front * low;          // and down
    y += 0.06 * Math.max(0, y);       // taller crown
    x -= 0.08 * Math.max(0, -x) * Math.max(0, y); // sloped back
    p.setXYZ(i, x * 1.06, y * 1.04, z * 0.9);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** Helmet facing +x, about 2 units tall, centred near the origin. */
export function buildHelmet(spec: HelmetSpec): THREE.Group {
  const grp = new THREE.Group();
  const shellMat = paint("#ffffff", { map: paintTexture(spec), metalness: 0.15, roughness: 0.28 });
  grp.add(new THREE.Mesh(deform(new THREE.SphereGeometry(1, 96, 64, 0, Math.PI * 2, 0, Math.PI * 0.82)), shellMat));
  // Visor (eye port), its seal, and the chin vent.
  grp.add(new THREE.Mesh(deform(new THREE.SphereGeometry(1.016, 64, 16, Math.PI - 0.82, 1.64, Math.PI * 0.42, Math.PI * 0.12)), glass()));
  grp.add(new THREE.Mesh(deform(new THREE.SphereGeometry(1.022, 64, 3, Math.PI - 0.86, 1.72, Math.PI * 0.413, Math.PI * 0.012)), paint(spec.colors[2])));
  grp.add(new THREE.Mesh(deform(new THREE.SphereGeometry(1.012, 24, 4, Math.PI - 0.3, 0.6, Math.PI * 0.64, Math.PI * 0.05)), new THREE.MeshStandardMaterial({ color: "#111", roughness: 0.6 })));
  // Rear spoiler (gurney) and top intake.
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.62), paint(spec.colors[2]));
  spoiler.position.set(-0.8, 0.52, 0);
  spoiler.rotation.z = -0.95;
  grp.add(spoiler);
  const intake = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.2, 4, 12), new THREE.MeshStandardMaterial({ color: "#151515", roughness: 0.5 }));
  intake.rotation.z = Math.PI / 2;
  intake.position.set(0.32, 1.0, 0);
  grp.add(intake);
  // Neck opening.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(Math.sin(Math.PI * 0.82) * 0.95, 0.045, 12, 64), new THREE.MeshStandardMaterial({ color: "#0d0d0d", roughness: 0.8 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0.06, Math.cos(Math.PI * 0.82) * 1.04, 0);
  ring.scale.set(1.06, 0.9, 1);
  grp.add(ring);
  grp.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return grp;
}

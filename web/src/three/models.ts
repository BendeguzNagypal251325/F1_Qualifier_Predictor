import * as THREE from "three";
import { bakedMeshes, loadGLB, modelUrl } from "./assets";
import { buildCar, type BuiltCar } from "./car";
import { carbon, metal, paint, rubber } from "./geom";
import { buildHelmet, helmetModelReady, type HelmetSpec } from "./helmet";
import type { PartId } from "./parts";

// Cars from the prepared reference models (tools/models; CC BY 4.0 sources credited in the README).
// Each mesh is named "<part>|<slot>"; the slot says how to paint it in the team's livery. The
// "livery" slot carries a colour-zone mask (red = primary, green = secondary, blue = accent,
// black = carbon) that is turned into a texture in the team's colours. No logos are in the files.

interface CarMeta { wheelbase: number; tyreRadius: number; width: number; steeringWheel: [number, number, number] }
interface Template { meshes: { part: PartId; slot: string; geometry: THREE.BufferGeometry; mask?: CanvasImageSource }[]; meta: CarMeta }

const MODEL_FILE: Record<string, string> = { "2022-2025": "car-2022-2025", "2026-": "car-2026" };

const templates = new Map<string, Promise<Template>>();

function loadTemplate(era: string): Promise<Template> {
  let t = templates.get(era);
  if (!t) {
    const file = MODEL_FILE[era];
    t = Promise.all([loadGLB(`${file}.glb`), fetch(modelUrl(`${file}.json`)).then((r) => r.json() as Promise<CarMeta>)]).then(([gltf, meta]) => ({
      meta,
      meshes: bakedMeshes(gltf.scene).map(({ name, geometry, material }) => {
        const [part, slot] = name.split("|") as [PartId, string];
        geometry.userData.shared = true; // reused by every car of this era; never disposed
        const mask = (material as THREE.MeshStandardMaterial).map?.image as CanvasImageSource | undefined;
        return { part, slot, geometry, mask };
      }),
    }));
    templates.set(era, t);
    t.catch(() => templates.delete(era));
  }
  return t;
}

/** Start downloading a car model early (e.g. while the page that shows it renders). */
export function preloadCar(era: string) {
  if (MODEL_FILE[era]) void loadTemplate(era).catch(() => {});
}

// ---------------------------------------------------------------- livery

const liveryTextures = new Map<string, THREE.Texture>();
const CARBON_RGB: [number, number, number] = [16, 16, 20];

/** Paint the colour-zone mask in the team's colours (cached per mask and livery). */
function liveryTexture(mask: CanvasImageSource, key: string, livery: [string, string, string]): THREE.Texture {
  const id = `${key}|${livery.join(",")}`;
  const hit = liveryTextures.get(id);
  if (hit) return hit;
  const w = (mask as { width: number }).width, h = (mask as { height: number }).height;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(mask, 0, 0);
  const img = g.getImageData(0, 0, w, h), d = img.data;
  const [P, S, A] = livery.map((x) => new THREE.Color(x).convertLinearToSRGB()) as THREE.Color[];
  const cols = [P, S, A].map((x) => [x.r * 255, x.g * 255, x.b * 255]);
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gg = d[i + 1], b = d[i + 2], k = 255 - Math.max(r, gg, b), sum = r + gg + b + k || 1;
    for (let ch = 0; ch < 3; ch++) d[i + ch] = (r * cols[0][ch] + gg * cols[1][ch] + b * cols[2][ch] + k * CARBON_RGB[ch]) / sum;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.flipY = false; // glTF texture convention
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  liveryTextures.set(id, tex);
  return tex;
}

function slotMaterial(slot: string, livery: [string, string, string], map?: THREE.Texture): THREE.Material {
  const [P, S, A] = livery;
  switch (slot) {
    case "P": return paint(P);
    case "S": return paint(S);
    case "A": return paint(A);
    case "livery": return paint("#ffffff", { map });
    case "carbon": return carbon();
    case "carbon2": return new THREE.MeshPhysicalMaterial({ color: "#16161b", metalness: 0.3, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.2 });
    case "rubber": return rubber();
    case "metal": return metal();
    case "chrome": return new THREE.MeshStandardMaterial({ color: "#c9ccd2", metalness: 1, roughness: 0.18 });
    case "glass": return new THREE.MeshPhysicalMaterial({ color: "#0b0d12", metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.55 });
    case "light": return new THREE.MeshStandardMaterial({ color: "#ff1a1a", emissive: "#ff1a1a", emissiveIntensity: 1.4 });
    default: return new THREE.MeshStandardMaterial({ color: "#0e0e11", metalness: 0.2, roughness: 0.6 });
  }
}

/** Build a car: the reference model for 2022-2025 and 2026 cars, the procedural one otherwise. */
export async function loadCar(era: string, livery: [string, string, string], helmet?: HelmetSpec): Promise<BuiltCar> {
  if (!MODEL_FILE[era]) return buildCar(era, livery, helmet);
  let tpl: Template;
  try {
    [tpl] = await Promise.all([loadTemplate(era), helmet ? helmetModelReady() : Promise.resolve()]);
  } catch {
    return buildCar(era, livery, helmet); // model could not be loaded: the procedural car still works
  }
  const group = new THREE.Group();
  const parts = new Map<PartId, THREE.Mesh[]>();
  for (const m of tpl.meshes) {
    const map = m.slot === "livery" && m.mask ? liveryTexture(m.mask, `${era}:${m.part}`, livery) : undefined;
    const mesh = new THREE.Mesh(m.geometry, slotMaterial(m.slot, livery, map));
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.part = m.part;
    if (m.slot === "light") mesh.userData.light = true;
    group.add(mesh);
    parts.set(m.part, [...(parts.get(m.part) ?? []), mesh]);
  }
  if (helmet) {
    const [sx, sy] = tpl.meta.steeringWheel;
    const h = buildHelmet(helmet);
    h.scale.multiplyScalar(0.125);
    h.position.set(sx - 0.6, sy + 0.2, 0);
    h.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.userData.part = "cockpit"; parts.get("cockpit")?.push(o as THREE.Mesh); } });
    group.add(h);
  }
  const box = new THREE.Box3().setFromObject(group);
  const centre = box.getCenter(new THREE.Vector3());
  return { group, parts, length: box.max.x - box.min.x, centre };
}

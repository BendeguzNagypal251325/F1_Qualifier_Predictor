import * as THREE from "three";
import { bakedMeshes, loadGLB } from "./assets";
import { CAR_MODEL_FILE as MODEL_FILE, fetchModel } from "./modelFiles";
import { buildCar, type BuiltCar } from "./car";
import { carbon, metal, paint, rubber } from "./geom";
import { buildHelmet, helmetModelReady, type HelmetSpec } from "./helmet";
import type { PartId } from "./parts";

// Cars from the prepared reference models (tools/models; CC BY 4.0 sources credited in the README).
// Each mesh is named "<part>|<slot>"; the slot says how to paint it in the team's livery. The
// "livery" slot carries a colour-zone mask (red = primary, green = secondary, blue = accent,
// black = carbon) that is turned into a texture in the team's colours. No logos are in the files.

interface CarMeta { wheelbase: number; tyreRadius: number; width: number; steeringWheel: [number, number, number]; head?: [number, number, number]; helmetSeat?: [number, number, number] }
interface Template { meshes: { part: PartId; slot: string; geometry: THREE.BufferGeometry; mask?: CanvasImageSource }[]; meta: CarMeta }


const templates = new Map<string, Promise<Template>>();

function loadTemplate(era: string): Promise<Template> {
  let t = templates.get(era);
  if (!t) {
    const file = MODEL_FILE[era];
    t = Promise.all([loadGLB(`${file}.glb`), fetchModel(`${file}.json`).then((b) => JSON.parse(new TextDecoder().decode(b)) as CarMeta)]).then(([gltf, meta]) => ({
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

// ---------------------------------------------------------------- finish and per-season shape

// Paint zones drawn in the shader from the car's own coordinates (x forward, y up, z sideways),
// so the lines are clean whatever the mesh's triangles look like.

/** Body panels that get a two-tone finish on the models whose source has one body material
 *  (2017-2021 and 2022-2025): the lower body in the team's secondary colour with a thin accent line.
 *  The 2026 model has its own colour zones. A generic paint split, not a team's real livery. */
const TWO_TONE_PARTS = new Set<PartId>(["nose", "cockpit", "sidepods", "power-unit"]);
const LOWER_EDGE = 0.34, ACCENT_LINE = 0.025; // metres above the ground

function withZones(mat: THREE.MeshStandardMaterial, key: string, uniforms: Record<string, { value: unknown }>, glsl: string) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    const decl = `varying vec3 vZonePos;\nvarying vec3 vZoneNormal;\n${Object.keys(uniforms).map((u) => `uniform ${uniforms[u].value instanceof THREE.Color ? "vec3" : "float"} ${u};`).join("\n")}\n`;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vZonePos;\nvarying vec3 vZoneNormal;`)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvZonePos = position;\nvZoneNormal = normal;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${decl}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${glsl}`);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

function twoTone(mat: THREE.MeshStandardMaterial, livery: [string, string, string]) {
  return withZones(mat, "two-tone", {
    uSecondary: { value: new THREE.Color(livery[1]) }, uAccent: { value: new THREE.Color(livery[2]) },
    uEdge: { value: LOWER_EDGE }, uLine: { value: ACCENT_LINE },
  }, `{
    float w = fwidth(vZonePos.y);
    float lower = 1.0 - smoothstep(uEdge - w, uEdge + w, vZonePos.y);
    float line = smoothstep(uEdge - w, uEdge + w, vZonePos.y) * (1.0 - smoothstep(uEdge + uLine - w, uEdge + uLine + w, vZonePos.y));
    diffuseColor.rgb = mix(mix(diffuseColor.rgb, uSecondary, lower), uAccent, line);
  }`);
}

/** Tyre sidewalls get a coloured compound band (qualifying is run on the softest, red-banded tyre). */
function tyreBand(mat: THREE.MeshStandardMaterial, meta: CarMeta) {
  return withZones(mat, "tyre-band", {
    uBand: { value: new THREE.Color("#d8232a") }, uRadius: { value: meta.tyreRadius }, uWheelbase: { value: meta.wheelbase },
  }, `{
    float axle = vZonePos.x > uWheelbase * 0.5 ? uWheelbase : 0.0;
    float r = length(vec2(vZonePos.x - axle, vZonePos.y - uRadius)) / uRadius;
    float side = step(0.6, abs(normalize(vZoneNormal).z));
    float w = fwidth(r);
    float band = side * smoothstep(0.815 - w, 0.815 + w, r) * (1.0 - smoothstep(0.855 - w, 0.855 + w, r));
    diffuseColor.rgb = mix(diffuseColor.rgb, uBand, band);
  }`);
}

// Visible rule changes within an era. 2021: the floor was cut back in a diagonal in front of the
// rear tyres: narrower just ahead of the tyre, back to full width further forward.
const FLOOR_CUT = { start: 0.35, length: 1.2, depth: 0.12 }; // metres ahead of the rear axle

function seasonShape(meshes: Template["meshes"], era: string, season?: number): Template["meshes"] {
  if (era !== "2017-2021" || season !== 2021) return meshes;
  // the floor's own half-width along the car (10 cm steps), so the cut follows its outline
  const BIN = 0.1, width = new Map<number, number>();
  for (const m of meshes) {
    if (m.part !== "floor") continue;
    const pos = m.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const k = Math.floor(pos.getX(i) / BIN);
      width.set(k, Math.max(width.get(k) ?? 0, Math.abs(pos.getZ(i))));
    }
  }
  return meshes.map((m) => {
    if (m.part !== "floor") return m;
    const g = m.geometry.clone();
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const t = (x - FLOOR_CUT.start) / FLOOR_CUT.length;
      if (t < 0 || t > 1) continue;
      const limit = (width.get(Math.floor(x / BIN)) ?? 0) - FLOOR_CUT.depth * (1 - t);
      if (Math.abs(z) > limit) pos.setZ(i, Math.sign(z) * limit);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    g.userData.shared = true;
    return { ...m, geometry: g };
  });
}

const finished = new Map<string, Promise<Template>>();

/** The era's template with the season's shape changes (cached). */
function finishedTemplate(era: string, season?: number): Promise<Template> {
  const key = `${era}|${era === "2017-2021" && season === 2021 ? 2021 : "base"}`;
  let t = finished.get(key);
  if (!t) {
    t = loadTemplate(era).then((tpl) => ({ meta: tpl.meta, meshes: seasonShape(tpl.meshes, era, season) }));
    finished.set(key, t);
    t.catch(() => finished.delete(key));
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
const maskIds = new WeakMap<object, number>();
let nextMaskId = 0;
function liveryTexture(mask: CanvasImageSource, livery: [string, string, string]): THREE.Texture {
  // one texture per mask image and livery: several parts share a mask, so key by the image itself
  let mid = maskIds.get(mask);
  if (mid === undefined) { mid = nextMaskId++; maskIds.set(mask, mid); }
  const id = `${mid}|${livery.join(",")}`;
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

/** Build a car from the era's reference model (procedural fallback if it cannot be loaded).
 *  ``season`` adds that season's visible rule changes (see ``seasonShape``). */
export async function loadCar(era: string, livery: [string, string, string], helmet?: HelmetSpec, season?: number): Promise<BuiltCar> {
  if (!MODEL_FILE[era]) return buildCar(era, livery, helmet);
  let tpl: Template;
  try {
    [tpl] = await Promise.all([finishedTemplate(era, season), helmet ? helmetModelReady() : Promise.resolve()]);
  } catch {
    return buildCar(era, livery, helmet); // model could not be loaded: the procedural car still works
  }
  const group = new THREE.Group();
  const parts = new Map<PartId, THREE.Mesh[]>();
  for (const m of tpl.meshes) {
    const map = m.slot === "livery" && m.mask ? liveryTexture(m.mask, livery) : undefined;
    let mat = slotMaterial(m.slot, livery, map) as THREE.MeshStandardMaterial;
    if (m.slot === "P" && era !== "2026-" && TWO_TONE_PARTS.has(m.part)) mat = twoTone(mat, livery);
    if (m.slot === "rubber" && m.part === "wheels") mat = tyreBand(mat, tpl.meta);
    const mesh = new THREE.Mesh(m.geometry, mat);
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
    // seat from the model (tools/models: in front of the roll hoop, just above the cockpit rim)
    if (tpl.meta.helmetSeat) h.position.set(tpl.meta.helmetSeat[0], tpl.meta.helmetSeat[1], 0);
    else h.position.set(sx - 0.6, sy + 0.2, 0);
    h.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.userData.part = "cockpit"; parts.get("cockpit")?.push(o as THREE.Mesh); } });
    group.add(h);
  }
  const box = new THREE.Box3().setFromObject(group);
  const centre = box.getCenter(new THREE.Vector3());
  return { group, parts, length: box.max.x - box.min.x, centre };
}

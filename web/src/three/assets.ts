import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

// Loader for the prepared 3D models in /models (see tools/models): meshopt-compressed glTF.

/** Bump when the files in /models change: the server lets browsers cache versioned model URLs for a year. */
export const MODELS_VERSION = "1";
export const modelUrl = (file: string) => `/models/${file}?v=${MODELS_VERSION}`;

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const files = new Map<string, Promise<GLTF>>();

/** Load (once) a model from /models. */
export function loadGLB(name: string): Promise<GLTF> {
  let p = files.get(name);
  if (!p) {
    p = loader.loadAsync(modelUrl(name));
    files.set(name, p);
    p.catch(() => files.delete(name)); // allow a retry after a network error
  }
  return p;
}

/** Every mesh in a loaded scene with its world transform applied to a copy of its geometry. */
export function bakedMeshes(root: THREE.Object3D): { name: string; geometry: THREE.BufferGeometry; material: THREE.Material }[] {
  root.updateMatrixWorld(true);
  const out: { name: string; geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = toFloat(m.geometry);
    g.applyMatrix4(m.matrixWorld);
    // the glTF node carries the name; the mesh may be a child primitive of it
    const name = m.name || m.parent?.name || "";
    out.push({ name, geometry: g, material: m.material as THREE.Material });
  });
  return out;
}

/** Copy of a geometry with every attribute as plain floats. Meshopt files store quantised (normalised
 *  integer) positions whose node transform scales them back; baking that transform into an integer
 *  attribute would clip it, so expand first. */
function toFloat(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(src.attributes)) {
    const attr = a as THREE.BufferAttribute;
    const out = new Float32Array(attr.count * attr.itemSize);
    for (let i = 0; i < attr.count; i++) for (let k = 0; k < attr.itemSize; k++) out[i * attr.itemSize + k] = attr.getComponent(i, k);
    g.setAttribute(name, new THREE.BufferAttribute(out, attr.itemSize));
  }
  if (src.index) g.setIndex(src.index.clone());
  return g;
}

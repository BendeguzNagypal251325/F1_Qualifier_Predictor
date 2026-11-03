import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/** Studio stage: soft environment reflections, a key light with shadows, a dark floor. */
export function makeStage(renderer: THREE.WebGLRenderer, opts: { floor?: boolean } = {}) {
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight("#ffffff", "#1a1a22", 0.5));
  const key = new THREE.DirectionalLight("#ffffff", 2.4);
  key.position.set(4, 7, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 25 });
  key.shadow.bias = -0.0004;
  scene.add(key);
  const rim = new THREE.DirectionalLight("#cfd6ff", 0.8);
  rim.position.set(-6, 3, -4);
  scene.add(rim);
  if (opts.floor !== false) {
    const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 64), new THREE.ShadowMaterial({ opacity: 0.55 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
  }
  return { scene, key, env };
}

export function makeRenderer(canvas?: HTMLCanvasElement, preserve = false) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: preserve });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

// ---------------------------------------------------------------- snapshots (one shared renderer)

let snapRenderer: THREE.WebGLRenderer | null = null;
const stages: Record<string, ReturnType<typeof makeStage>> = {};
const cache = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();

// How many mounted images are waiting for each key. A queued render whose images have all gone
// (the visitor left the page) is skipped, so it does not hold up the page they moved to.
const wanted = new Map<string, number>();
/** Mark ``key`` as wanted while an image is on screen; call the returned function on unmount. */
export function want(key: string): () => void {
  wanted.set(key, (wanted.get(key) ?? 0) + 1);
  return () => {
    const n = (wanted.get(key) ?? 1) - 1;
    if (n > 0) wanted.set(key, n); else wanted.delete(key);
  };
}

export interface SnapJob {
  key: string;
  width: number;
  height: number;
  build: () => THREE.Object3D | Promise<THREE.Object3D>;
  camera: (obj: THREE.Object3D) => THREE.PerspectiveCamera;
  floor?: boolean;
}

// Bump when the car or helmet models change, so stored thumbnails are re-rendered.
const SNAP_VERSION = "gridcast-v6";
const STORE = "gridcast-snapshots";
const storeUrl = (key: string) => `/__snapshot/${SNAP_VERSION}/${encodeURIComponent(key)}`;

/** Previously rendered image from the browser's Cache Storage (survives reloads), if any. */
async function fromStore(key: string): Promise<string | null> {
  try {
    if (!("caches" in window)) return null;
    const hit = await (await caches.open(STORE)).match(storeUrl(key));
    return hit ? URL.createObjectURL(await hit.blob()) : null;
  } catch {
    return null;
  }
}

async function toStore(key: string, blob: Blob) {
  try {
    if ("caches" in window) await (await caches.open(STORE)).put(storeUrl(key), new Response(blob, { headers: { "Content-Type": blob.type } }));
  } catch {
    /* storage full or blocked: the image just gets rendered again next time */
  }
}

/** Old versions of the thumbnails are removed once per page load. */
let pruned = false;
async function pruneStore() {
  if (pruned || !("caches" in window)) return;
  pruned = true;
  try {
    const c = await caches.open(STORE);
    for (const req of await c.keys()) if (!new URL(req.url).pathname.startsWith(`/__snapshot/${SNAP_VERSION}/`)) await c.delete(req);
  } catch {
    /* ignore */
  }
}

/** Render ``build()`` once to an image URL. Stored across visits; jobs run one at a time. */
export function snapshot(job: SnapJob): Promise<string> {
  const hit = cache.get(job.key);
  if (hit) return hit;
  void pruneStore();
  const p = fromStore(job.key).then((stored) => stored ?? (queue = queue.then(() => new Promise<string>((resolve) => {
    const run = async () => {
      if (!wanted.has(job.key)) {
        cache.delete(job.key); // nobody is waiting any more; render again if asked later
        return resolve("");
      }
      try {
        if (!snapRenderer) snapRenderer = makeRenderer(document.createElement("canvas"), true);
        const r = snapRenderer;
        r.setPixelRatio(1);
        r.setSize(job.width, job.height, false);
        const k = job.floor === false ? "nofloor" : "floor";
        const stage = (stages[k] ??= makeStage(r, { floor: job.floor }));
        const obj = await job.build();
        stage.scene.add(obj);
        r.setClearColor(0x000000, 0);
        r.shadowMap.enabled = job.floor !== false; // no floor, no shadow pass
        r.render(stage.scene, job.camera(obj));
        stage.scene.remove(obj);
        obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            if (!m.geometry.userData.shared) m.geometry.dispose();
            (Array.isArray(m.material) ? m.material : [m.material]).forEach((mt) => { (mt as THREE.MeshStandardMaterial).map?.dispose(); mt.dispose(); });
          }
        });
        r.domElement.toBlob((blob) => {
          if (!blob) return resolve("");
          void toStore(job.key, blob);
          resolve(URL.createObjectURL(blob));
        }, "image/webp", 0.92);
      } catch {
        resolve("");
      }
    };
    // Wait for a frame first, so images found in storage (and earlier renders) reach the screen
    // before the next render occupies the main thread.
    requestAnimationFrame(() => setTimeout(run, 0));
  })) as Promise<string>));
  cache.set(job.key, p);
  return p;
}

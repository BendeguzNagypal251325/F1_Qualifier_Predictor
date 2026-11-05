// Everything that needs three.js lives here, so the library loads only on pages that show 3D.
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { disposeObject } from "../three/car";
import { loadCar } from "../three/models";
import { buildHelmet, helmetModelReady, type HelmetSpec } from "../three/helmet";
import { PART_LABEL, type PartId } from "../three/parts";
import { carKey, helmetKey } from "../three/thumbs";
import { makeRenderer, makeStage, snapshot, want } from "../three/stage";
import type { CameraSync } from "../three/sync";
import { Spinner } from "./Spinner";

type View = "3/4" | "front" | "side" | "top" | "rear";

function frame(obj: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(obj);
  return { centre: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()) };
}

function viewPosition(view: View, centre: THREE.Vector3, d: number): THREE.Vector3 {
  const c = centre;
  switch (view) {
    case "front": return new THREE.Vector3(c.x + d, c.y + 0.35 * d * 0.25, c.z);
    case "side": return new THREE.Vector3(c.x, c.y + 0.12 * d, c.z + d);
    case "top": return new THREE.Vector3(c.x + 0.01, c.y + d * 1.05, c.z + 0.01);
    case "rear": return new THREE.Vector3(c.x - d, c.y + 0.3 * d, c.z - 0.3 * d);
    default: return new THREE.Vector3(c.x + 0.62 * d, c.y + 0.42 * d, c.z + 0.72 * d);
  }
}

/** Shared viewer: renderer, stage, orbit controls, resize and visibility handling. */
function useViewer(container: React.RefObject<HTMLDivElement>, opts: { autoRotate?: boolean; floor?: boolean; fov?: number; fit?: number; sync?: CameraSync }) {
  const api = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls;
    setObject: (o: THREE.Object3D) => void; flyTo: (v: View) => void; object: THREE.Object3D | null;
  } | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const el = container.current!;
    const renderer = makeRenderer();
    el.appendChild(renderer.domElement);
    const { scene } = makeStage(renderer, { floor: opts.floor });
    const camera = new THREE.PerspectiveCamera(opts.fov ?? 30, 16 / 9, 0.05, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.autoRotate = !!opts.autoRotate;
    controls.autoRotateSpeed = 0.8;
    const sync = opts.sync, me = sync ? sync.next++ : -1;
    controls.addEventListener("start", () => {
      controls.autoRotate = false;
      if (sync) sync.leader = me;
    });
    let fly: { from: THREE.Vector3; to: THREE.Vector3; fromT: THREE.Vector3; toT: THREE.Vector3; t: number } | null = null;
    let dist = 6;
    const startFly = (to: THREE.Vector3, toT: THREE.Vector3) => {
      fly = { from: camera.position.clone(), to, fromT: controls.target.clone(), toT, t: 0 };
    };
    const state = {
      renderer, scene, camera, controls, object: null as THREE.Object3D | null,
      setObject(o: THREE.Object3D) {
        if (state.object) { scene.remove(state.object); disposeObject(state.object); }
        state.object = o;
        scene.add(o);
        const { centre, size } = frame(o);
        dist = Math.max(size.x, size.z, size.y * 1.6) * (opts.fit ?? 1.55);
        controls.target.copy(centre);
        controls.minDistance = dist * 0.45;
        controls.maxDistance = dist * 2.2;
        if (!fly) camera.position.copy(viewPosition("3/4", centre, dist));
      },
      flyTo(v: View) {
        controls.autoRotate = false;
        if (sync) sync.leader = me;
        startFly(viewPosition(v, controls.target, camera.position.distanceTo(controls.target)), controls.target.clone());
      },
    };
    api.current = state;
    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight || (w * 9) / 16;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(el);
    let raf = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) controls.autoRotate = false;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!visible) return;
      if (fly) {
        fly.t = Math.min(1, fly.t + (reduce ? 1 : 0.06));
        const e = 1 - (1 - fly.t) ** 3;
        camera.position.lerpVectors(fly.from, fly.to, e);
        controls.target.lerpVectors(fly.fromT, fly.toT, e);
        if (fly.t >= 1) fly = null;
      }
      if (sync && sync.leader !== null) {
        if (sync.leader === me) sync.offset = camera.position.clone().sub(controls.target).toArray();
        else if (!fly) camera.position.copy(controls.target).add(new THREE.Vector3(...sync.offset));
      }
      controls.update();
      renderer.render(scene, camera);
    };
    loop();
    setReady(true);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      controls.dispose();
      if (state.object) disposeObject(state.object);
      renderer.dispose();
      renderer.domElement.remove();
      api.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { api, ready };
}

// ---------------------------------------------------------------- car

export function Car3D({ era, livery, selected, onSelect, helmet, label, season, sync }: {
  era: string;
  livery: [string, string, string];
  selected: PartId | null;
  onSelect: (p: PartId) => void;
  helmet?: HelmetSpec;
  label: string;
  /** Adds the season's visible rule changes to the era model. */
  season?: number;
  /** Links this viewer's camera with others (compare page). */
  sync?: CameraSync;
}) {
  const box = useRef<HTMLDivElement>(null);
  const { api, ready } = useViewer(box, { autoRotate: !sync, sync });
  const parts = useRef<Map<PartId, THREE.Mesh[]>>(new Map());
  const hovered = useRef<PartId | null>(null);
  const selRef = useRef(selected);
  const [hoverLabel, setHoverLabel] = useState<string | null>(null);

  // A selected part is shown on its own: the rest of the car fades to a faint outline. The camera
  // stays where it is, so the part is seen in its place on the whole car.
  const highlight = () => {
    const sel = selRef.current;
    parts.current.forEach((meshes, id) => {
      const hidden = sel !== null && id !== sel, hov = id === hovered.current;
      meshes.forEach((m) => {
        const mat = m.material as THREE.MeshStandardMaterial;
        if (m.userData.opacity === undefined) m.userData.opacity = { opacity: mat.opacity, transparent: mat.transparent };
        const base = m.userData.opacity as { opacity: number; transparent: boolean };
        mat.transparent = hidden || base.transparent;
        mat.opacity = hidden ? 0.08 : base.opacity;
        mat.depthWrite = !hidden;
        m.castShadow = !hidden;
        mat.needsUpdate = true;
        if (!mat.emissive || m.userData.light) return;
        mat.emissive.set(hov && !hidden ? "#ffffff" : "#000000");
        mat.emissiveIntensity = hov && !hidden ? 0.16 : 0;
      });
    });
  };

  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!ready || !api.current) return;
    let stale = false;
    setLoaded(false);
    void loadCar(era, livery, helmet, season).then((built) => {
      if (stale || !api.current) { disposeObject(built.group); return; }
      built.group.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material && ((o as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity > 1) o.userData.light = true; });
      parts.current = built.parts;
      api.current.setObject(built.group);
      setLoaded(true);
      highlight();
    });
    return () => { stale = true; };
  }, [ready, era, season, livery.join(","), helmet?.driverId, helmet?.colors.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { selRef.current = selected; highlight(); }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready || !api.current) return;
    const { renderer, camera } = api.current;
    const el = renderer.domElement;
    const ray = new THREE.Raycaster();
    const pick = (e: PointerEvent): PartId | null => {
      const r = el.getBoundingClientRect();
      const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(p, camera);
      // while a part is shown on its own, only that part (and clicking it again) can be picked
      const sel = selRef.current;
      const meshes = sel ? parts.current.get(sel) ?? [] : [...parts.current.values()].flat();
      const hit = ray.intersectObjects(meshes, false)[0];
      return (hit?.object.userData.part as PartId) ?? null;
    };
    let down: { x: number; y: number } | null = null;
    const move = (e: PointerEvent) => {
      const id = pick(e);
      if (id !== hovered.current) {
        hovered.current = id;
        el.style.cursor = id ? "pointer" : "grab";
        setHoverLabel(id ? PART_LABEL[id] : null);
        highlight();
      }
    };
    const pd = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const pu = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) {
        const id = pick(e);
        if (id) onSelect(id);
      }
      down = null;
    };
    const leave = () => { hovered.current = null; setHoverLabel(null); highlight(); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerdown", pd);
    el.addEventListener("pointerup", pu);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerdown", pd);
      el.removeEventListener("pointerup", pu);
      el.removeEventListener("pointerleave", leave);
    };
  }, [ready, onSelect]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="viewer" ref={box} role="img" aria-label={`${label}, interactive 3D model`}>
      {!loaded && <Spinner />}
      <span className="hint">{selected
        ? (hoverLabel ? `${hoverLabel} · click to show the whole car` : `${PART_LABEL[selected]} · click it again for the whole car`)
        : hoverLabel ? `${hoverLabel} · click` : "Drag to rotate · scroll to zoom · click a part"}</span>
      <div className="views">
        {(["3/4", "front", "side", "top", "rear"] as View[]).map((v) => (
          <button key={v} type="button" onClick={() => api.current?.flyTo(v)}>{v}</button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- helmet

export function Helmet3D({ spec, label }: { spec: HelmetSpec; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const { api, ready } = useViewer(box, { floor: false, fov: 24, fit: 2.25 });
  const [modelReady, setModelReady] = useState(false);
  useEffect(() => { void helmetModelReady().then(() => setModelReady(true)); }, []);
  useEffect(() => {
    if (!ready || !modelReady || !api.current) return;
    const { controls, camera } = api.current;
    const h = buildHelmet(spec);
    const pivot = new THREE.Group();
    pivot.add(h);
    api.current.setObject(pivot);
    // Front view only: no orbiting; the helmet itself turns a little toward the pointer.
    controls.enabled = false;
    const t = controls.target;
    camera.position.set(t.x + 7.2, t.y + 0.55, t.z);
    camera.lookAt(t);
    const el = box.current!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let tx = 0, ty = 0, hover = false, raf = 0;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
      ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
      hover = true;
    };
    const leave = () => { hover = false; };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    const t0 = performance.now();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const time = (performance.now() - t0) / 1000;
      const wantY = hover ? tx * 0.38 : reduce ? 0 : Math.sin(time * 0.6) * 0.07;
      const wantX = hover ? ty * 0.16 : 0;
      pivot.rotation.y += (wantY - pivot.rotation.y) * 0.08;
      pivot.rotation.z += (-wantX - pivot.rotation.z) * 0.08;
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, [ready, modelReady, spec.driverId, spec.colors.join(","), spec.motif, spec.number]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="viewer square helmet-viewer" ref={box} role="img" aria-label={`${label}, 3D helmet; move the pointer over it to turn it`} style={{ background: "transparent" }}>
      {!(ready && modelReady) && <Spinner label="Loading 3D helmet" />}
    </div>
  );
}

// ---------------------------------------------------------------- still images

/** True once the element is within 300 px of the viewport (renders are only queued for those). */
function useNearScreen<T extends Element>() {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (setNear(true), io.disconnect()), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, near] as const;
}

function useSnapshot(key: string, make: () => Promise<string>) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    const release = key ? want(key) : () => {};
    make().then((s) => alive && setSrc(s || null));
    return () => { alive = false; release(); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return src;
}

export function HelmetImage({ spec, alt }: { spec: HelmetSpec; alt: string }) {
  const key = helmetKey(spec);
  const [box, visible] = useNearScreen<HTMLSpanElement>();
  const src = useSnapshot(visible ? key : "", () => visible ? snapshot({
    key, width: 360, height: 360, floor: false,
    build: () => helmetModelReady().then(() => buildHelmet(spec, 0.5)),
    camera: (o) => {
      const { centre } = frame(o);
      const cam = new THREE.PerspectiveCamera(24, 1, 0.1, 50);
      cam.position.set(centre.x + 6.2, centre.y + 0.9, centre.z);
      cam.lookAt(centre.x, centre.y - 0.04, centre.z);
      return cam;
    },
  }) : Promise.resolve(""));
  return src ? <img src={src} alt={alt} /> : <span ref={box} className="helmet-ph">{visible && <Spinner label="Rendering helmet" />}</span>;
}

export function CarImage({ era, livery, alt, season }: { era: string; livery: [string, string, string]; alt: string; season?: number }) {
  const key = carKey(era, livery, season);
  const [box, visible] = useNearScreen<HTMLSpanElement>();
  const src = useSnapshot(visible ? key : "", () => visible ? snapshot({
    key, width: 720, height: 405,
    build: () => loadCar(era, livery, undefined, season).then((c) => c.group),
    camera: (o) => {
      const { centre, size } = frame(o);
      const d = Math.max(size.x, size.z) * 1.12;
      const cam = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 100);
      cam.position.copy(viewPosition("3/4", centre, d));
      cam.lookAt(centre);
      return cam;
    },
  }) : Promise.resolve(""));
  return src
    ? <img src={src} alt={alt} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
    : <span ref={box} style={{ display: "block", width: "100%", height: "100%", position: "relative" }}>{visible && <Spinner label="Rendering car" />}</span>;
}

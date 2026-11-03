// Everything that needs three.js lives here, so the library loads only on pages that show 3D.
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildCar, disposeObject } from "../three/car";
import { buildHelmet, type HelmetSpec } from "../three/helmet";
import { PART_LABEL, type PartId } from "../three/parts";
import { makeRenderer, makeStage, snapshot } from "../three/stage";

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
function useViewer(container: React.RefObject<HTMLDivElement>, opts: { autoRotate?: boolean; floor?: boolean; fov?: number; fit?: number }) {
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
    controls.addEventListener("start", () => (controls.autoRotate = false));
    let fly: { from: THREE.Vector3; to: THREE.Vector3; t: number } | null = null;
    let dist = 6;
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
        fly = { from: camera.position.clone(), to: viewPosition(v, controls.target, dist), t: 0 };
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
        if (fly.t >= 1) fly = null;
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

export function Car3D({ era, livery, selected, onSelect, helmet, label }: {
  era: string;
  livery: [string, string, string];
  selected: PartId | null;
  onSelect: (p: PartId) => void;
  helmet?: HelmetSpec;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const { api, ready } = useViewer(box, { autoRotate: true });
  const parts = useRef<Map<PartId, THREE.Mesh[]>>(new Map());
  const hovered = useRef<PartId | null>(null);
  const selRef = useRef(selected);
  const [hoverLabel, setHoverLabel] = useState<string | null>(null);

  const highlight = () => {
    parts.current.forEach((meshes, id) => {
      const on = id === selRef.current, hov = id === hovered.current;
      meshes.forEach((m) => {
        const mat = m.material as THREE.MeshStandardMaterial;
        if (!mat.emissive || m.userData.light) return;
        mat.emissive.set(on ? "#ff1200" : hov ? "#ffffff" : "#000000");
        mat.emissiveIntensity = on ? 1.1 : hov ? 0.16 : 0;
      });
    });
  };

  useEffect(() => {
    if (!ready || !api.current) return;
    const built = buildCar(era, livery, helmet);
    built.group.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material && ((o as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity > 1) o.userData.light = true; });
    parts.current = built.parts;
    api.current.setObject(built.group);
    highlight();
  }, [ready, era, livery.join(","), helmet?.driverId, helmet?.colors.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const meshes = [...parts.current.values()].flat();
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
      <span className="hint">{hoverLabel ? `${hoverLabel} · click` : "Drag to rotate · scroll to zoom · click a part"}</span>
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
  const { api, ready } = useViewer(box, { autoRotate: true, floor: false, fov: 26, fit: 2.0 });
  useEffect(() => {
    if (!ready || !api.current) return;
    const h = buildHelmet(spec);
    h.rotation.y = -0.5;
    api.current.setObject(h);
  }, [ready, spec.driverId, spec.colors.join(","), spec.number]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="viewer square" ref={box} role="img" aria-label={`${label}, interactive 3D helmet`} style={{ background: "transparent" }} />;
}

// ---------------------------------------------------------------- still images

function useSnapshot(key: string, make: () => Promise<string>) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    make().then((s) => alive && setSrc(s || null));
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return src;
}

export function HelmetImage({ spec, alt }: { spec: HelmetSpec; alt: string }) {
  const key = `helmet|${spec.driverId}|${spec.colors.join(",")}|${spec.number}`;
  const src = useSnapshot(key, () => snapshot({
    key, width: 420, height: 420, floor: false,
    build: () => { const h = buildHelmet(spec); h.rotation.y = -0.95; return h; },
    camera: (o) => {
      const { centre } = frame(o);
      const cam = new THREE.PerspectiveCamera(24, 1, 0.1, 50);
      cam.position.set(centre.x + 4.4, centre.y + 1.3, centre.z + 4.0);
      cam.lookAt(centre.x, centre.y - 0.08, centre.z);
      return cam;
    },
  }));
  return src ? <img src={src} alt={alt} /> : <span className="helmet-ph" aria-hidden>{spec.initials}</span>;
}

export function CarImage({ era, livery, alt }: { era: string; livery: [string, string, string]; alt: string }) {
  const key = `car|${era}|${livery.join(",")}`;
  const src = useSnapshot(key, () => snapshot({
    key, width: 720, height: 405,
    build: () => buildCar(era, livery).group,
    camera: (o) => {
      const { centre, size } = frame(o);
      const d = Math.max(size.x, size.z) * 1.12;
      const cam = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 100);
      cam.position.copy(viewPosition("3/4", centre, d));
      cam.lookAt(centre);
      return cam;
    },
  }));
  return src ? <img src={src} alt={alt} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /> : null;
}

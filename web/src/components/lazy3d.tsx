import { lazy, Suspense, useEffect, useState } from "react";
import { carKey, fromStore, helmetKey, use3D } from "../three/thumbs";

// three.js loads only on pages that show 3D. On phones (narrow screen or touch-only pointer) it waits for
// a tap: until then thumbnails come from the browser's cache only (rendered on an earlier visit), with a
// light placeholder otherwise, and the interactive views show a "View in 3D" button. Desktop is unchanged.

const mod = () => import("./ThreeViews");
const LCar3D = lazy(() => mod().then((m) => ({ default: m.Car3D })));
const LHelmet3D = lazy(() => mod().then((m) => ({ default: m.Helmet3D })));
const LHelmetImage = lazy(() => mod().then((m) => ({ default: m.HelmetImage })));
const LCarImage = lazy(() => mod().then((m) => ({ default: m.CarImage })));

type P<T> = T extends React.ComponentType<infer X> ? X : never;
type Views = typeof import("./ThreeViews");

/** A thumbnail rendered on an earlier visit (Cache Storage), without loading three.js. */
function useCachedThumb(key: string): string | null | undefined {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void fromStore(key).then((s) => alive && setSrc(s));
    return () => { alive = false; };
  }, [key]);
  return src;
}

function HelmetPlaceholder({ spec }: { spec: P<Views["HelmetImage"]>["spec"] }) {
  return <span className="helmet-ph" aria-label={`${spec.initials} helmet (3D not loaded)`}>{spec.initials}</span>;
}

function CarPlaceholder({ livery }: { livery: [string, string, string] }) {
  return (
    <span className="car-ph" aria-label="Car (3D not loaded)">
      {livery.map((c, i) => <i key={i} style={{ background: c }} />)}
    </span>
  );
}

function LiteHelmetImage(p: P<Views["HelmetImage"]>) {
  const src = useCachedThumb(helmetKey(p.spec));
  return src ? <img src={src} alt={p.alt} /> : <HelmetPlaceholder spec={p.spec} />;
}

function LiteCarImage(p: P<Views["CarImage"]>) {
  const src = useCachedThumb(carKey(p.era, p.livery, p.season));
  return src ? <img src={src} alt={p.alt} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /> : <CarPlaceholder livery={p.livery} />;
}

/** Tap-to-load stand-in for an interactive view: the cached thumbnail (or placeholder) and a button. */
function TapFor3D({ children, onTap, what, square }: { children: React.ReactNode; onTap: () => void; what: string; square?: boolean }) {
  return (
    <div className={`viewer tap3d${square ? " square" : ""}`}>
      <div className="tap3d-media">{children}</div>
      <button type="button" className="btn ghost" onClick={onTap}>View {what} in 3D</button>
    </div>
  );
}

export const Car3D = (p: P<Views["Car3D"]>) => {
  const [ok, unlock] = use3D();
  if (!ok) return <TapFor3D onTap={unlock} what="the car"><LiteCarImage era={p.era} livery={p.livery} season={p.season} alt={p.label} /></TapFor3D>;
  return <Suspense fallback={<div className="viewer" />}><LCar3D {...p} /></Suspense>;
};

export const Helmet3D = (p: P<Views["Helmet3D"]>) => {
  const [ok, unlock] = use3D();
  if (!ok) return <TapFor3D onTap={unlock} what="the helmet" square><LiteHelmetImage spec={p.spec} alt={p.label} /></TapFor3D>;
  return <Suspense fallback={<div className="viewer square" style={{ background: "transparent" }} />}><LHelmet3D {...p} /></Suspense>;
};

export const HelmetImage = (p: P<Views["HelmetImage"]>) => {
  const [ok] = use3D();
  return ok ? <Suspense fallback={null}><LHelmetImage {...p} /></Suspense> : <LiteHelmetImage {...p} />;
};

export const CarImage = (p: P<Views["CarImage"]>) => {
  const [ok] = use3D();
  return ok ? <Suspense fallback={null}><LCarImage {...p} /></Suspense> : <LiteCarImage {...p} />;
};

/** On phones, one button above a grid of thumbnails loads 3D for the rest of the visit. */
export function Show3DButton({ what }: { what: string }) {
  const [ok, unlock] = use3D();
  if (ok) return null;
  return <button type="button" className="btn ghost show3d" onClick={unlock}>Show 3D {what}</button>;
}

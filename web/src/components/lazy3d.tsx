import { lazy, Suspense, type ComponentProps } from "react";

const mod = () => import("./ThreeViews");
const LCar3D = lazy(() => mod().then((m) => ({ default: m.Car3D })));
const LHelmet3D = lazy(() => mod().then((m) => ({ default: m.Helmet3D })));
const LHelmetImage = lazy(() => mod().then((m) => ({ default: m.HelmetImage })));
const LCarImage = lazy(() => mod().then((m) => ({ default: m.CarImage })));

type P<T> = T extends React.ComponentType<infer X> ? X : never;
type Views = typeof import("./ThreeViews");

export const Car3D = (p: P<Views["Car3D"]>) => <Suspense fallback={<div className="viewer" />}><LCar3D {...p} /></Suspense>;
export const Helmet3D = (p: P<Views["Helmet3D"]>) => <Suspense fallback={<div className="viewer square" style={{ background: "transparent" }} />}><LHelmet3D {...p} /></Suspense>;
export const HelmetImage = (p: P<Views["HelmetImage"]>) => <Suspense fallback={null}><LHelmetImage {...p} /></Suspense>;
export const CarImage = (p: P<Views["CarImage"]>) => <Suspense fallback={null}><LCarImage {...p} /></Suspense>;
export type { ComponentProps };

import { useEffect, useState } from "react";

// Shared by the 3D code (stage.ts, ThreeViews) and the light, three.js-free phone path (lazy3d.tsx):
// where rendered thumbnails are stored, their keys, and whether 3D may load yet.

// Bump when the car or helmet models change, so stored thumbnails are re-rendered.
export const SNAP_VERSION = "gridcast-v7";
export const STORE = "gridcast-snapshots";
export const storeUrl = (key: string) => `/__snapshot/${SNAP_VERSION}/${encodeURIComponent(key)}`;

/** Previously rendered image from the browser's Cache Storage (survives reloads), if any. */
export async function fromStore(key: string): Promise<string | null> {
  try {
    if (!("caches" in window)) return null;
    const hit = await (await caches.open(STORE)).match(storeUrl(key));
    return hit ? URL.createObjectURL(await hit.blob()) : null;
  } catch {
    return null;
  }
}

export const helmetKey = (spec: { driverId: string; colors: string[]; motif: string; number: number | null }) =>
  `helmet|${spec.driverId}|${spec.colors.join(",")}|${spec.motif}|${spec.number}`;
export const carKey = (era: string, livery: string[], season?: number) => `car|${era}|${livery.join(",")}|${season === 2021 ? 2021 : ""}`;

// ---------------------------------------------------------------- phones: 3D only after a tap

/** Narrow screen or touch-only pointer: 3D waits for a tap (thumbnails come from the cache only). */
export const isLite = () => typeof window !== "undefined" && window.matchMedia("(max-width: 700px), (pointer: coarse)").matches;

const KEY = "gridcast-3d";
let unlocked = (() => {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
})();
const listeners = new Set<() => void>();

/** May 3D load now? Always on desktop; on phones once the visitor has tapped a "3D" button this visit. */
export const allow3D = () => !isLite() || unlocked;

export function unlock3D() {
  unlocked = true;
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    /* private mode: unlocked for this page only */
  }
  listeners.forEach((f) => f());
}

/** [3D allowed, unlock] — re-renders every user when one tap unlocks 3D. */
export function use3D(): [boolean, () => void] {
  const [ok, setOk] = useState(allow3D);
  useEffect(() => {
    const f = () => setOk(allow3D());
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);
  return [ok, unlock3D];
}

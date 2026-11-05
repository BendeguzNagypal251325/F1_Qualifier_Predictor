// Small loading mark for 3D models that are still downloading or rendering (no three.js inside, so it can
// show before the 3D code has arrived). Sits centred in its box; still for visitors who prefer reduced motion.

export function Spinner({ label = "Loading 3D model" }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label}><i aria-hidden /></span>;
}

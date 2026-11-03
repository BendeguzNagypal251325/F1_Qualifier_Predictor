// Model files in /models, fetched once and shared. Kept free of three.js so pages can start the
// download as soon as they mount, in parallel with the 3D code; the loader then parses these bytes.

/** Bump when the files in /models change: the server lets browsers cache versioned model URLs for a year. */
export const MODELS_VERSION = "3";
export const modelUrl = (file: string) => `/models/${file}?v=${MODELS_VERSION}`;

/** Prepared model per regulation era (see tools/models). */
export const CAR_MODEL_FILE: Record<string, string> = { "2017-2021": "car-2017-2021", "2022-2025": "car-2022-2025", "2026-": "car-2026" };

/** Regulation era of a season (same rule as f1qp/cars.py). */
export const eraOf = (season: number) => (season <= 2021 ? "2017-2021" : season <= 2025 ? "2022-2025" : "2026-");

const files = new Map<string, Promise<ArrayBuffer>>();

/** The bytes of a model file (downloaded once per page load). */
export function fetchModel(file: string): Promise<ArrayBuffer> {
  let p = files.get(file);
  if (!p) {
    p = fetch(modelUrl(file)).then((r) => {
      if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
      return r.arrayBuffer();
    });
    files.set(file, p);
    p.catch(() => files.delete(file)); // allow a retry after a network error
  }
  return p;
}

/** Start downloading a season's car (and the helmet that sits in it) without waiting for it. */
export function prefetchCar(season: number) {
  const f = CAR_MODEL_FILE[eraOf(season)];
  for (const file of [`${f}.glb`, `${f}.json`, "helmet.glb"]) void fetchModel(file).catch(() => {});
}

export function prefetchHelmet() {
  void fetchModel("helmet.glb").catch(() => {});
}

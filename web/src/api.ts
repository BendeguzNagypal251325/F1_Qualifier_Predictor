import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Meta } from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const cache = new Map<string, unknown>();

export async function getJSON<T>(path: string, { fresh = false } = {}): Promise<T> {
  if (!fresh && cache.has(path)) return cache.get(path) as T;
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, detail);
  }
  const data = (await res.json()) as T;
  cache.set(path, data);
  return data;
}

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Fetch ``path`` (null = skip). ``refreshMs`` re-fetches on an interval, bypassing the cache. */
export function useApi<T>(path: string | null, refreshMs?: number): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ data: null, error: null, loading: !!path });
  const current = useRef(path);
  useEffect(() => {
    current.current = path;
    if (!path) return;
    let alive = true;
    const load = (fresh: boolean) => {
      setState((s) => ({ ...s, loading: true }));
      getJSON<T>(path, { fresh })
        .then((data) => alive && current.current === path && setState({ data, error: null, loading: false }))
        .catch((e: Error) => alive && setState({ data: null, error: e.message, loading: false }));
    };
    load(false);
    const timer = refreshMs ? window.setInterval(() => load(true), refreshMs) : undefined;
    return () => {
      alive = false;
      if (timer) window.clearInterval(timer);
    };
  }, [path, refreshMs]);
  return state;
}

export const MetaContext = createContext<Meta | null>(null);

export function useMeta(): Meta {
  const meta = useContext(MetaContext);
  if (!meta) throw new Error("Meta not loaded");
  return meta;
}

export function seasonsParam(seasons: number[], all: number[]): string {
  return seasons.length === all.length ? "" : `seasons=${seasons.join(",")}`;
}

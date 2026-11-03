import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMeta } from "../api";
import type { Contrib, Group, Result } from "../types";
import { GROUPS } from "../types";

// ---------------------------------------------------------------- formatting

export const fmt = (x: number | null | undefined, d = 1) => (x == null || Number.isNaN(x) ? "–" : x.toFixed(d));
export const pct = (x: number | null | undefined) => (x == null || Number.isNaN(x) ? "–" : `${Math.round(x * 100)}%`);
export const signed = (x: number | null | undefined, d = 1) => (x == null ? "–" : `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(x).toFixed(d)}`);
export const GROUP_LABEL: Record<Group, string> = { driver: "Driver", car: "Car", weekend: "Practice", context: "Event" };

// ---------------------------------------------------------------- tooltip (any element with data-tip)

export function TooltipLayer() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tip = ref.current!;
    const over = (e: PointerEvent) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
      if (!t) return void (tip.hidden = true);
      tip.textContent = "";
      t.dataset.tip!.split("\n").forEach((line, i) => {
        if (i) tip.appendChild(document.createElement("br"));
        const s = document.createElement(i === 0 ? "b" : "span");
        s.textContent = line;
        tip.appendChild(s);
      });
      tip.hidden = false;
    };
    const move = (e: PointerEvent) => {
      if (tip.hidden) return;
      const w = tip.offsetWidth, h = tip.offsetHeight;
      let x = e.clientX + 14, y = e.clientY + 14;
      if (x + w > innerWidth - 8) x = e.clientX - w - 14;
      if (y + h > innerHeight - 8) y = e.clientY - h - 14;
      tip.style.left = `${Math.max(8, x)}px`;
      tip.style.top = `${Math.max(8, y)}px`;
    };
    const hide = () => (tip.hidden = true);
    document.addEventListener("pointerover", over);
    document.addEventListener("pointermove", move);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointermove", move);
      window.removeEventListener("scroll", hide, true);
    };
  }, []);
  return <div id="tip" ref={ref} hidden role="tooltip" />;
}

// ---------------------------------------------------------------- states

export function Loading({ height = 160 }: { height?: number }) {
  return <div className="skeleton" style={{ height }} aria-label="Loading" />;
}
export function ErrorBox({ error }: { error: string }) {
  return <div className="error" role="alert">Could not load this data: {error}</div>;
}

export function Tile({ label, value, sub, small }: { label: string; value: ReactNode; sub?: ReactNode; small?: boolean }) {
  return (
    <div className="tile">
      <span className="eyebrow">{label}</span>
      <span className="v" style={small ? { fontSize: "1.15rem" } : undefined}>{value}</span>
      {sub != null && <span className="s">{sub}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- positions

export function posClass(pos: number) {
  return pos === 1 ? "pole" : pos <= 10 ? "q3" : pos <= 15 ? "q2" : "out";
}

export function PosChip({ pos, status, miss, tip }: { pos: number; status?: string | null; miss?: boolean; tip?: string }) {
  return <span className={`chip ${posClass(pos)}${miss ? " miss" : ""}`} data-tip={tip}>{status || `P${pos}`}</span>;
}

export function ResultChip({ r, driverName }: { r: Result; driverName?: string }) {
  const meta = useMeta();
  const team = meta.teams.find((t) => t.id === r.team)?.name ?? r.team;
  const tip = `${r.season} ${r.gp} GP\n${driverName ? driverName + " · " : ""}${team}\nQualified ${r.status || "P" + r.pos} · model P${r.pred_rank}\n${r.right ? "Model called it right" : "Model got this one wrong"}`;
  return <PosChip pos={r.pos} status={r.status} miss={!r.right} tip={tip} />;
}

export function YearChips({ results, seasons, driverName }: { results: Result[]; seasons: number[]; driverName?: string }) {
  const by = new Map<number, Result[]>();
  results.forEach((r) => by.set(r.season, [...(by.get(r.season) ?? []), r]));
  return (
    <div className="chips">
      {seasons.map((y) =>
        by.has(y)
          ? by.get(y)!.map((r) => <ResultChip key={r.race_key} r={r} driverName={driverName} />)
          : <span key={y} className="chip empty" data-tip={`No ${y} session`}>{String(y).slice(2)}</span>,
      )}
    </div>
  );
}

export function PosLegend() {
  return (
    <div className="legend">
      <span className="chip pole">P1</span>pole <span className="chip q3">P2–10</span>Q3 <span className="chip q2">P11–15</span>Q2
      <span className="chip out">P16+</span>Q1 <span className="chip q3 miss">Px</span>model wrong
    </div>
  );
}

export function Bar({ value, max = 1, label }: { value: number | null; max?: number; label: string }) {
  return (
    <div className="cell-bar">
      <div className="bar"><span style={{ width: `${Math.max(0, Math.min(1, (value ?? 0) / max)) * 100}%` }} /></div>
      <b>{label}</b>
    </div>
  );
}

// ---------------------------------------------------------------- season filter

export function SeasonFilter({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const { seasons } = useMeta();
  const all = value.length === seasons.length;
  const toggle = (y: number) => {
    if (all) return onChange([y]);
    if (value.includes(y)) return onChange(value.length > 1 ? value.filter((s) => s !== y) : value);
    onChange([...value, y].sort());
  };
  return (
    <div className="seg" role="group" aria-label="Seasons">
      <button type="button" aria-pressed={all} onClick={() => onChange(seasons)}>All</button>
      {seasons.map((y) => (
        <button key={y} type="button" aria-pressed={!all && value.includes(y)} onClick={() => toggle(y)}>{y}</button>
      ))}
    </div>
  );
}

export function useSeasons(): [number[], (v: number[]) => void] {
  const { seasons } = useMeta();
  const [value, setValue] = useState<number[]>(seasons);
  return [value, setValue];
}

// ---------------------------------------------------------------- team colour + avatar

export function useTeam(id: string) {
  const meta = useMeta();
  return meta.teams.find((t) => t.id === id) ?? { id, name: id, color: "#888888" };
}

export function Swatch({ team }: { team: string }) {
  const t = useTeam(team);
  return <span className="swatch" style={{ background: t.color }} />;
}

// Where the face is in each season's photo set (fraction of width/height), and how far to zoom.
const CROPS: Record<string, { s: number; fx: number; fy: number }> = {
  "2023": { s: 2.1, fx: 0.5, fy: 0.38 },
  "2024": { s: 2.3, fx: 0.64, fy: 0.32 },
  "2025": { s: 3.6, fx: 0.51, fy: 0.2 },
  "2026": { s: 3.4, fx: 0.5, fy: 0.26 },
};
const ASPECT = 1.78; // all photo sets are ~16:9

export function pickPhoto(photos: Record<string, string>, season?: number): [string, string] | null {
  const years = Object.keys(photos).sort();
  if (!years.length) return null;
  const want = season ? String(season) : years[years.length - 1];
  const y = years.includes(want) ? want : [...years].reverse().find((s) => s <= want) ?? years[0];
  return [y, photos[y]];
}

/** Background style that centres the driver's face in a box of ``boxAspect`` (width / height). */
export function photoStyle(year: string, url: string, boxAspect = 1, zoom = 1): React.CSSProperties {
  const c = CROPS[year] ?? { s: 2, fx: 0.5, fy: 0.3 };
  const s = Math.max(c.s * zoom, 1, ASPECT / boxAspect); // zoom, but always cover the box
  const w = s, h = (s / ASPECT) * boxAspect; // image size relative to the box
  const pos = (f: number, img: number) => (Math.abs(1 - img) < 1e-3 ? 50 : Math.max(0, Math.min(100, ((0.5 - f * img) / (1 - img)) * 100)));
  return { backgroundImage: `url("${url}")`, backgroundSize: `${w * 100}% auto`, backgroundPosition: `${pos(c.fx, w)}% ${pos(c.fy, h)}%`, backgroundRepeat: "no-repeat" };
}

export function Avatar({ driver, season, size = 36 }: { driver: string; season?: number; size?: number }) {
  const meta = useMeta();
  const d = meta.drivers.find((x) => x.id === driver);
  const team = useTeam(d?.team ?? "");
  const photo = d ? pickPhoto(d.photos, season) : null;
  const name = d?.name ?? driver;
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("");
  const style: React.CSSProperties = { width: size, height: size, fontSize: size * 0.38, ["--ring" as string]: team.color };
  Object.assign(style, photo ? photoStyle(photo[0], photo[1], 1) : { background: team.color });
  return <span className="avatar" style={style} role="img" aria-label={name}>{photo ? null : initials}</span>;
}

// ---------------------------------------------------------------- track outline

export function TrackOutline({ circuit, size = 48, stroke = 4 }: { circuit: string; size?: number; stroke?: number }) {
  const meta = useMeta();
  const c = meta.circuits.find((x) => x.id === circuit);
  if (!c?.outline) return <span style={{ width: size, height: size, display: "inline-block" }} />;
  return (
    <svg className="track-outline" viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`${c.name} layout`}>
      <path d={c.outline} strokeWidth={stroke} vectorEffect="non-scaling-stroke" style={{ strokeWidth: stroke }} />
    </svg>
  );
}

// ---------------------------------------------------------------- contributions

/** Diverging bars, one per group. Negative = gains places (bar grows left, toward the front). */
export function ContribBars({ contrib, scale = 6 }: { contrib: Contrib; scale?: number }) {
  return (
    <div className="contrib">
      {GROUPS.map((g) => {
        const v = contrib[g];
        const w = (Math.min(Math.abs(v), scale) / scale) * 50;
        return (
          <div className="contrib-row" key={g} data-tip={`${GROUP_LABEL[g]}\n${signed(v)} places vs an average entry`}>
            <span>{GROUP_LABEL[g]}</span>
            <div className="contrib-axis">
              <span style={{ background: `var(--g-${g})`, width: `${w}%`, left: v < 0 ? `${50 - w}%` : "50%" }} />
            </div>
            <span className="mono" style={{ textAlign: "right" }}>{signed(v)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Compact: how much of the gain comes from each group (only the negative = helpful parts). */
export function ContribStack({ contrib }: { contrib: Contrib }) {
  const parts = GROUPS.map((g) => ({ g, v: contrib[g] }));
  const total = parts.reduce((a, p) => a + Math.abs(p.v), 0) || 1;
  const tip = parts.map((p) => `${GROUP_LABEL[p.g]} ${signed(p.v)}`).join("\n");
  return (
    <div className="stack" data-tip={`Places vs an average entry\n${tip}`}>
      {parts.map((p) => (
        <span key={p.g} style={{ width: `${(Math.abs(p.v) / total) * 100}%`, background: `var(--g-${p.g})`, opacity: p.v < 0 ? 1 : 0.35 }} />
      ))}
    </div>
  );
}

export function GroupLegend() {
  return (
    <div className="legend">
      {GROUPS.map((g) => <span key={g}><i style={{ background: `var(--g-${g})` }} />{GROUP_LABEL[g]}</span>)}
    </div>
  );
}

export function Sortable<T>({ rows, initial, children }: {
  rows: T[];
  initial: { key: keyof T; dir: "asc" | "desc" };
  children: (sorted: T[], th: (key: keyof T, label: string, cls?: string) => ReactNode) => ReactNode;
}) {
  const [sort, setSort] = useState(initial);
  const sorted = [...rows].sort((a, b) => {
    const x = a[sort.key] as unknown, y = b[sort.key] as unknown;
    const d = typeof x === "string" ? String(x).localeCompare(String(y)) : ((x as number) ?? 1e9) - ((y as number) ?? 1e9);
    return sort.dir === "asc" ? d : -d;
  });
  const th = (key: keyof T, label: string, cls = "") => (
    <th
      className={`sortable ${cls}`}
      tabIndex={0}
      aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      onClick={() => setSort({ key, dir: sort.key === key && sort.dir === "asc" ? "desc" : "asc" })}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSort({ key, dir: sort.key === key && sort.dir === "asc" ? "desc" : "asc" }))}
    >
      {label}{sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
    </th>
  );
  return <>{children(sorted, th)}</>;
}

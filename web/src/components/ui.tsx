import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMeta } from "../api";
import type { Contrib, Group, Result } from "../types";
import { GROUPS } from "../types";
import { HELMET_REFS, type Motif } from "../three/helmetRefs";

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

// ---------------------------------------------------------------- info popover (replaces grey footnotes)

/** A small "i" next to a heading; the explanation shows on hover or keyboard focus. */
/** Nudge an open popover sideways so it stays inside the viewport on narrow screens. */
function keepOnScreen(e: { currentTarget: HTMLElement }) {
  const pop = e.currentTarget.querySelector<HTMLElement>(".info-pop");
  if (!pop) return;
  pop.style.marginLeft = "0px";
  requestAnimationFrame(() => {
    const r = pop.getBoundingClientRect(), pad = 12;
    const shift = r.right > innerWidth - pad ? innerWidth - pad - r.right : r.left < pad ? pad - r.left : 0;
    pop.style.marginLeft = `${shift}px`;
  });
}

export function Info({ children, label = "About this" }: { children: ReactNode; label?: string }) {
  return (
    <span className="info" tabIndex={0} role="button" aria-label={label} onMouseEnter={keepOnScreen} onFocus={keepOnScreen}>
      <span aria-hidden>i</span>
      <span className="info-pop" role="tooltip">{children}</span>
    </span>
  );
}

// ---------------------------------------------------------------- states

export function Loading({ height = 160 }: { height?: number }) {
  return <div className="skeleton" style={{ height }} aria-label="Loading" />;
}
export function ErrorBox({ error }: { error: string }) {
  return <div className="error" role="alert">Could not load this data: {error}</div>;
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Animate a number from 0 to ``target`` (ease-out, ~0.8 s). Returns the value to show. */
export function useCountUp(target: number | null | undefined, ms = 800): number | null {
  const [v, setV] = useState<number | null>(target ?? null);
  useEffect(() => {
    if (target == null || Number.isNaN(target)) return setV(target ?? null);
    if (reducedMotion()) return setV(target);
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      setV(target * (1 - (1 - k) ** 3));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

export function Tile({ label, value, sub, small, countUp, decimals = 2, suffix = "", prefix = "" }: {
  label: string; value: ReactNode; sub?: ReactNode; small?: boolean;
  countUp?: number | null; decimals?: number; suffix?: string; prefix?: string;
}) {
  const n = useCountUp(countUp);
  const shown = countUp != null && n != null ? <>{prefix}{n.toFixed(decimals)}{suffix && (suffix.trim().startsWith("/") ? <small>{suffix}</small> : suffix)}</> : value;
  return (
    <div className="tile">
      <span className="eyebrow">{label}</span>
      <span className="v" style={small ? { fontSize: "1.15rem" } : undefined}>{shown}</span>
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

export function Bar({ value, max = 1, label, color }: { value: number | null; max?: number; label: string; color?: string }) {
  return (
    <div className="cell-bar">
      <div className="bar"><span style={{ width: `${Math.max(0, Math.min(1, (value ?? 0) / max)) * 100}%`, ...(color ? { background: color } : {}) }} /></div>
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

/** Team of ``driver`` in ``season`` (or their latest team). */
export function useDriverTeam(driver: string, season?: number): string {
  const meta = useMeta();
  const d = meta.drivers.find((x) => x.id === driver);
  if (!d) return "";
  return (season && d.teams[String(season)]) || d.team;
}

/** Helmet paint for a driver: reference colours of their 2026 helmet where we have them, else team colours. */
export function useHelmetSpec(driver: string, season?: number, teamOverride?: string) {
  const meta = useMeta();
  const d = meta.drivers.find((x) => x.id === driver);
  const year = season ?? d?.last_season ?? meta.latest;
  const team = teamOverride ?? ((d && d.teams[String(year)]) || d?.team || "");
  const ref = HELMET_REFS[driver];
  const car = meta.cars[String(year)]?.[team];
  const t = meta.teams.find((x) => x.id === team);
  const teamColors = car?.livery ?? [t?.color ?? "#444444", "#ffffff", "#e10600"];
  const fallbackMotifs: Motif[] = ["bands", "flourish", "halves"];
  const hash = [...driver].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  return {
    driverId: driver,
    initials: initials(d?.name ?? driver),
    number: d?.number ?? null,
    colors: ref ? [...ref.colors].filter(Boolean) as string[] : [...teamColors],
    motif: ref?.motif ?? fallbackMotifs[hash % fallbackMotifs.length],
    crown: ref?.crown ?? "stripe",
    brow: ref?.brow,
    chin: ref?.chin,
    crownStripes: ref?.crownStripes,
    team,
    year,
    source: ref ? ("reference" as const) : ("team" as const),
    note: ref?.note ?? null,
  };
}

/** Readable text colour on a team colour. */
export function inkOn(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.32 ? "#111418" : "#ffffff";
}

export function initials(name: string) {
  return name.split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

/** Driver initials on their team colour. ``team`` overrides; else the team of ``season``. */
export function Avatar({ driver, season, team, size = 36 }: { driver: string; season?: number; team?: string; size?: number }) {
  const meta = useMeta();
  const d = meta.drivers.find((x) => x.id === driver);
  const seasonTeam = useDriverTeam(driver, season);
  const t = useTeam(team ?? seasonTeam);
  const name = d?.name ?? driver;
  return (
    <span className="avatar" role="img" aria-label={`${name}, ${t.name}`}
      style={{ width: size, height: size, fontSize: size * 0.4, background: t.color, color: inkOn(t.color) }}>
      {initials(name)}
    </span>
  );
}

/** One segment per season, coloured by the driver's team that season. */
export function SeasonStrip({ driver, labels = false }: { driver: string; labels?: boolean }) {
  const meta = useMeta();
  const d = meta.drivers.find((x) => x.id === driver);
  return (
    <div className="season-strip" aria-label="Team by season">
      {meta.seasons.map((y) => {
        const tid = d?.teams[String(y)];
        const t = meta.teams.find((x) => x.id === tid);
        return (
          <span key={y} className={t ? "" : "none"} style={t ? { background: t.color, color: inkOn(t.color) } : undefined}
            data-tip={t ? `${y}\n${t.name}` : `${y}\nNot on the grid`}>
            {labels ? String(y).slice(2) : null}
          </span>
        );
      })}
    </div>
  );
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

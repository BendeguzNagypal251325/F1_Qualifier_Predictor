// Hand-drawn SVG charts. One scale per chart; text uses theme tokens; every mark has a hover tip.

const ticks = (lo: number, hi: number, step: number) => {
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(Math.round(t * 100) / 100);
  return out;
};

export interface DotRow { label: string; a: number; b: number; strong?: boolean }

/** Two series per row on a shared x scale (model vs a baseline). */
export function DotPlot({ rows, aLabel, bLabel, lo, hi, step = 0.5, onRow }: { rows: DotRow[]; aLabel: string; bLabel: string; lo: number; hi: number; step?: number; onRow?: (label: string) => void }) {
  const W = 560, rowH = 32, top = 8, left = 74, right = 58, H = top + rows.length * rowH + 26;
  const x = (v: number) => left + ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (W - left - right);
  const tk = ticks(lo, hi, step);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${aLabel} vs ${bLabel} by season`}>
      <g className="grid">{tk.map((t) => <line key={t} x1={x(t)} x2={x(t)} y1={top} y2={H - 22} />)}</g>
      {tk.map((t) => <text key={t} x={x(t)} y={H - 6} textAnchor="middle">{t.toFixed(1)}</text>)}
      {rows.map((r, i) => {
        const cy = top + i * rowH + rowH / 2;
        return (
          <g key={r.label} className={onRow ? "clickable" : undefined} onClick={onRow ? () => onRow(r.label) : undefined}
            data-tip={`${r.label}\n${aLabel}: ${r.a.toFixed(2)} / 10\n${bLabel}: ${r.b.toFixed(2)} / 10${onRow ? "\nClick to open these sessions" : ""}`}>
            <rect x={0} y={cy - rowH / 2} width={W} height={rowH} fill="transparent" />
            <text className="lbl" x={0} y={cy + 4} style={{ fontWeight: r.strong ? 700 : 400 }}>{r.label}</text>
            <line x1={x(Math.min(r.a, r.b))} x2={x(Math.max(r.a, r.b))} y1={cy} y2={cy} stroke="var(--line)" strokeWidth={2} />
            <circle className="pop" style={{ animationDelay: `${i * 50}ms` }} cx={x(r.b)} cy={cy} r={6} fill="var(--series-base)" stroke="var(--surface)" strokeWidth={2} />
            <circle className="pop glow" style={{ animationDelay: `${i * 50 + 120}ms` }} cx={x(r.a)} cy={cy} r={7} fill="var(--series-model)" stroke="var(--surface)" strokeWidth={2} />
            <text x={W - right + 10} y={cy + 4}>{r.a.toFixed(2)}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Lollipop rows on a shared scale, one series. */
export function Lollipops({ items, lo, hi, step }: { items: { label: string; value: number; strong?: boolean }[]; lo: number; hi: number; step: number }) {
  const W = 560, rowH = 30, left = 200, right = 56, top = 6, H = top + items.length * rowH + 24;
  const x = (v: number) => left + ((v - lo) / (hi - lo)) * (W - left - right);
  const tk = ticks(lo, hi, step);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Average correct picks per method">
      <g className="grid">{tk.map((t) => <line key={t} x1={x(t)} x2={x(t)} y1={top} y2={H - 20} />)}</g>
      {tk.map((t) => <text key={t} x={x(t)} y={H - 5} textAnchor="middle">{t.toFixed(1)}</text>)}
      {items.map((it, i) => {
        const cy = top + i * rowH + rowH / 2, col = it.strong ? "var(--series-model)" : "var(--series-base)";
        return (
          <g key={it.label} data-tip={`${it.label}\n${it.value.toFixed(2)} correct / 10`}>
            <rect x={0} y={cy - rowH / 2} width={W} height={rowH} fill="transparent" />
            <text className="lbl" x={0} y={cy + 4} style={{ fontWeight: it.strong ? 700 : 400 }}>{it.label}</text>
            <line className="draw" pathLength={1} style={{ animationDelay: `${i * 60}ms` }} x1={x(lo)} x2={x(it.value)} y1={cy} y2={cy} stroke={col} strokeWidth={2} />
            <circle className={`pop${it.strong ? " glow" : ""}`} style={{ animationDelay: `${i * 60 + 200}ms` }} cx={x(it.value)} cy={cy} r={6} fill={col} stroke="var(--surface)" strokeWidth={2} />
            <text x={x(it.value) + 12} y={cy + 4}>{it.value.toFixed(2)}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Vertical bars from zero. */
export function Bars({ items, total, onBar }: { items: { label: string; value: number }[]; total: number; onBar?: (label: string) => void }) {
  const W = 560, H = 210, left = 34, bottom = 30, top = 18, bw = (W - left - 10) / items.length;
  const max = Math.max(1, ...items.map((d) => d.value));
  const y = (v: number) => top + (1 - v / max) * (H - top - bottom);
  const tk = ticks(0, max, max > 40 ? 20 : 10);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Sessions by number of correct picks">
      <g className="grid">{tk.map((t) => <line key={t} x1={left} x2={W - 10} y1={y(t)} y2={y(t)} />)}</g>
      {tk.map((t) => <text key={t} x={left - 6} y={y(t) + 4} textAnchor="end">{t}</text>)}
      {items.map((d, i) => {
        const x0 = left + i * bw + 6, w = bw - 12, yt = y(d.value);
        const path = d.value ? `M${x0},${H - bottom} V${yt + 4} q0,-4 4,-4 h${w - 8} q4,0 4,4 V${H - bottom} Z` : "";
        return (
          <g key={d.label} className={onBar ? "clickable" : undefined} onClick={onBar ? () => onBar(d.label) : undefined}
            data-tip={`${d.label} correct\n${d.value} sessions (${Math.round((d.value / total) * 100)}%)${onBar ? "\nClick to list them" : ""}`}>
            <rect x={x0 - 4} y={top} width={w + 8} height={H - bottom - top} fill="transparent" />
            <path className="grow glow" style={{ animationDelay: `${i * 60}ms` }} d={path} fill="var(--series-model)" />
            {d.value > 0 && <text x={x0 + w / 2} y={yt - 5} textAnchor="middle">{d.value}</text>}
            <text className="lbl" x={x0 + w / 2} y={H - 10} textAnchor="middle">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Line over races (lower = better is drawn higher when ``invert``). */
export function RaceLine({ points, yLabel, invert = true, fmt = (v: number) => v.toFixed(2), color = "var(--series-model)", width = 640, height = 220 }: {
  points: { label: string; value: number | null; tip?: string }[];
  yLabel: string;
  invert?: boolean;
  fmt?: (v: number) => string;
  color?: string;
  width?: number;
  height?: number;
}) {
  const vals = points.map((p) => p.value).filter((v): v is number => v != null);
  if (!vals.length) return null;
  const W = width, H = height, left = 46, right = 14, top = 14, bottom = 34;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1e-6) { lo -= 0.5; hi += 0.5; }
  const pad = (hi - lo) * 0.08; lo = Math.max(0, lo - pad); hi += pad;
  const n = points.length;
  const x = (i: number) => left + (n === 1 ? 0.5 : i / (n - 1)) * (W - left - right);
  const y = (v: number) => (invert ? top + ((v - lo) / (hi - lo)) * (H - top - bottom) : top + (1 - (v - lo) / (hi - lo)) * (H - top - bottom));
  const step = (hi - lo) / 4;
  const tk = [0, 1, 2, 3, 4].map((k) => lo + k * step);
  let d = "";
  points.forEach((p, i) => { if (p.value != null) d += `${d ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)} `; });
  const lastI = points.map((p) => p.value != null).lastIndexOf(true);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={yLabel}>
      <g className="grid">{tk.map((t, i) => <line key={i} x1={left} x2={W - right} y1={y(t)} y2={y(t)} />)}</g>
      {tk.map((t, i) => <text key={i} x={left - 6} y={y(t) + 4} textAnchor="end">{fmt(t)}</text>)}
      <text x={left} y={H - 4}>{points[0].label}</text>
      <text x={W - right} y={H - 4} textAnchor="end">{points[n - 1].label}</text>
      <path className="draw glow" pathLength={1} d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {points.map((p, i) => p.value != null && (
        <g key={i} data-tip={p.tip ?? `${p.label}\n${fmt(p.value)}`}>
          <rect x={x(i) - (W / n) / 2} y={top} width={W / n} height={H - top - bottom} fill="transparent" />
          <circle cx={x(i)} cy={y(p.value)} r={i === lastI ? 5 : 3} fill={color} stroke="var(--surface)" strokeWidth={i === lastI ? 2 : 1} />
        </g>
      ))}
    </svg>
  );
}

import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { QualiSegment, SegmentDriverTime, TrackDetail } from "../types";
import { Avatar, Bar, Info, pct, Sortable, Swatch, Tile } from "./ui";

// Q1 / Q2 / Q3 at one track. Colours match the position chips used everywhere else: knocked out in Q1
// (grey), knocked out in Q2 (yellow), reached Q3 (green).

type SegId = "q1" | "q2" | "q3";
const SEGS: { id: SegId; label: string; color: string; ink: string }[] = [
  { id: "q1", label: "Q1", color: "var(--out)", ink: "#fff" },
  { id: "q2", label: "Q2", color: "var(--q2)", ink: "#111" },
  { id: "q3", label: "Q3", color: "var(--q3)", ink: "#111" },
];
const TEXT: Record<SegId, { cut: string; cutInfo: string; out: string; through: string; spread: string }> = {
  q1: { cut: "Slowest through", cutInfo: "Slowest Q1 lap that still made it into Q2.", out: "Knocked out", through: "Into Q2", spread: "Fastest to the cut" },
  q2: { cut: "Slowest through", cutInfo: "Slowest Q2 lap that still made it into Q3.", out: "Knocked out", through: "Into Q3", spread: "Fastest to the cut" },
  q3: { cut: "Slowest in Q3", cutInfo: "Slowest lap of the top ten: the spread of the final session.", out: "Top three", through: "Poles", spread: "Pole to P10" },
};

/** 81.786 -> "1:21.786" */
export function lapTime(s: number | null | undefined) {
  if (s == null) return "–";
  const m = Math.floor(s / 60);
  return m ? `${m}:${(s - m * 60).toFixed(3).padStart(6, "0")}` : s.toFixed(3);
}

function Who({ w, seg }: { w: SegmentDriverTime | null; seg: SegId }) {
  if (!w) return <span className="sub">no time</span>;
  return (
    <Link className="cell-name" to={`/drivers/${w.driver}`} data-tip={`${w.name}\nP${w.pos} overall`}>
      <Avatar driver={w.driver} team={w.team} size={24} /><span>{w.name}</span>
      <span className="mono lap" style={{ color: seg === "q3" && w.pos === 1 ? "var(--pole)" : undefined }}>{lapTime(w.time)}</span>
    </Link>
  );
}

export function QualiBreakdown({ data }: { data: TrackDetail }) {
  const [params, setParams] = useSearchParams();
  const seg = (SEGS.find((s) => s.id === params.get("q"))?.id ?? "q3") as SegId;
  const S = SEGS.find((s) => s.id === seg)!, T = TEXT[seg];
  const d: QualiSegment = data.segments[seg];
  const [all, setAll] = useState(false);
  const pick = (id: SegId) => setParams((p) => { const n = new URLSearchParams(p); n.set("q", id); return n; }, { replace: true });

  const timed = d.sessions.filter((s) => s.fastest?.time != null);
  const best = timed.reduce<(typeof timed)[number] | null>((a, s) => (!a || s.fastest!.time! < a.fastest!.time! ? s : a), null);
  const gaps = d.sessions.map((s) => s.gap_s).filter((g): g is number => g != null);
  const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
  const counts = new Map<string, { name: string; n: number }>();
  if (seg !== "q3") d.sessions.forEach((s) => s.out.forEach((o) => counts.set(o.driver, { name: o.name, n: (counts.get(o.driver)?.n ?? 0) + 1 })));
  const most = seg === "q3" ? d.drivers[0] && { name: d.drivers[0].name, n: d.drivers[0].reached } : [...counts.values()].sort((a, b) => b.n - a.n)[0];

  return (
    <section className="panel quali" style={{ ["--seg" as string]: S.color, ["--seg-ink" as string]: S.ink }}>
      <div className="panel-head">
        <h2>Qualifying, session by session <Info>Q1: whole field, Q2: top 15 (16 with 22 cars), Q3: top 10, by final position. Times are each driver's best.</Info></h2>
        <div className="seg seg-q" role="tablist" aria-label="Qualifying session">
          {SEGS.map((s) => (
            <button key={s.id} type="button" role="tab" aria-selected={seg === s.id} aria-pressed={seg === s.id} onClick={() => pick(s.id)}
              style={{ ["--c" as string]: s.color, ["--ci" as string]: s.ink }}>
              <i aria-hidden />{s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="tiles">
        <Tile label={`Fastest ${S.label} lap here`} value={lapTime(best?.fastest?.time)} sub={best ? `${best.fastest!.name}, ${best.season}` : "no times"} />
        <Tile label={T.spread} value={avgGap != null ? `${avgGap.toFixed(3)} s` : "–"} sub="average over the sessions here" />
        <Tile label={seg === "q3" ? "Most Q3 appearances" : `Most often out in ${S.label}`} value={most?.name ?? "–"} small sub={most ? `${most.n} time${most.n === 1 ? "" : "s"}` : "nobody"} />
      </div>

      <div className="scroll">
        <table>
          <thead><tr><th>Season</th><th>Fastest</th><th>{T.cut} <Info>{T.cutInfo}</Info></th><th className="num">Gap</th><th>{T.out}</th></tr></thead>
          <tbody>
            {[...d.sessions].reverse().map((s) => (
              <tr key={s.race_key}>
                <td><Link to={`/sessions/${s.race_key}`} className="link">{s.season}</Link></td>
                <td><Who w={s.fastest} seg={seg} /></td>
                <td><Who w={s.cutoff} seg={seg} /></td>
                <td className="num">{s.gap_s != null ? `+${s.gap_s.toFixed(3)}` : "–"}</td>
                <td>
                  <div className="out-list">
                    {s.out.map((o) => (
                      <Link key={o.driver} to={`/drivers/${o.driver}`} className="out-chip" data-tip={`${o.name}\nP${o.pos} · ${lapTime(o.time)}`}>
                        <Avatar driver={o.driver} team={o.team} size={22} /><b>P{o.pos}</b>
                      </Link>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Drivers in {S.label} here</h3>
      <div className="scroll">
        <Sortable rows={d.drivers} initial={{ key: seg === "q3" ? "reached" : "through", dir: "desc" }}>
          {(rows, th) => (
            <table>
              <thead><tr>{th("name", "Driver")}{th("reached", `In ${S.label}`, "num")}{th("through", T.through, "num")}<th>{seg === "q3" ? "Pole rate" : "Got through"}</th>{th("best_pos", "Best", "num")}{th("avg_gap_pct", "Avg gap to fastest", "num")}</tr></thead>
              <tbody>
                {(all ? rows : rows.slice(0, 12)).map((r) => (
                  <tr key={r.driver}>
                    <td><Link className="cell-name" to={`/drivers/${r.driver}`}><Avatar driver={r.driver} team={r.team} size={28} /><Swatch team={r.team} /><span>{r.name}</span></Link></td>
                    <td className="num">{r.reached}</td>
                    <td className="num">{r.through}</td>
                    <td style={{ minWidth: 130 }}><Bar value={r.through / r.reached} label={pct(r.through / r.reached)} color={S.color} /></td>
                    <td className="num">P{r.best_pos}</td>
                    <td className="num">{r.avg_gap_pct != null ? `+${r.avg_gap_pct.toFixed(2)}%` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Sortable>
      </div>
      {d.drivers.length > 12 && (
        <button type="button" className="btn ghost show-all" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? "Show fewer" : `Show all ${d.drivers.length} drivers`}
        </button>
      )}
    </section>
  );
}

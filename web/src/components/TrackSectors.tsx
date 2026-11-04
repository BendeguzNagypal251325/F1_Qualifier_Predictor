import { useState } from "react";
import { Link } from "react-router-dom";
import type { SectorEntry, SectorHolder, TrackDetail } from "../types";
import { lapTime } from "./QualiBreakdown";
import { useMeta } from "../api";
import { Avatar, Info, Sortable, Swatch, TrackOutline } from "./ui";

// The track outline in its three timing sectors, who holds the fastest time in each, and every driver's
// best sectors for a season. Sector colours follow the usual F1 track-map convention (red, blue, yellow).

type S = "s1" | "s2" | "s3";
const SECTORS: { id: S; label: string; color: string }[] = [
  { id: "s1", label: "Sector 1", color: "var(--sector-1)" },
  { id: "s2", label: "Sector 2", color: "var(--sector-2)" },
  { id: "s3", label: "Sector 3", color: "var(--sector-3)" },
];

const SOURCE = "Sector times and positions come from OpenF1's timing data (2023 onwards). The app downloads them in the background while live updates are on; run uv run f1qp-sectors to fetch them at once.";

export function TrackMap({ data }: { data: TrackDetail }) {
  const meta = useMeta();
  const sec = data.sectors;
  const years = sec.sessions.map((s) => s.season);
  const [year, setYear] = useState<number | "all">("all");
  const [hover, setHover] = useState<S | null>(null);
  const c = meta.circuits.find((x) => x.id === data.id);
  const sess = year === "all" ? null : sec.sessions.find((s) => s.season === year) ?? null;
  const holder = (id: S): (SectorHolder & { season?: number }) | null => (sess ? (sess.best[id] ? { ...sess.best[id]!, season: sess.season } : null) : sec.records[id] ?? null);

  return (
    <section className="panel track-map">
      <div className="panel-head">
        <h2>Sectors <Info>{SOURCE} The map is split where the sectors began on the fastest lap of the {sec.map?.season ?? "latest"} session.</Info></h2>
        {years.length > 0 && (
          <div className="seg" role="group" aria-label="Season">
            <button type="button" aria-pressed={year === "all"} onClick={() => setYear("all")}>Best</button>
            {years.map((y) => <button key={y} type="button" aria-pressed={year === y} onClick={() => setYear(y)}>{y}</button>)}
          </div>
        )}
      </div>
      <div className="map-wrap">
        {sec.map ? (
          <svg className="sector-map" viewBox="0 0 100 100" role="img" aria-label={`${data.name} in three sectors`}>
            {c?.outline && <path d={c.outline} className="base" />}
            {sec.map.paths.map((d, i) => (
              <path key={i} d={d} className={`sec${hover && hover !== SECTORS[i].id ? " dim" : ""}`} style={{ stroke: SECTORS[i].color }}
                onMouseEnter={() => setHover(SECTORS[i].id)} onMouseLeave={() => setHover(null)} />
            ))}
            <g transform={`translate(${sec.map.start[0]} ${sec.map.start[1]})`} className="start"><circle r="2.3" /><text y="-4" textAnchor="middle">START</text></g>
          </svg>
        ) : (
          <div className="sector-map plain"><TrackOutline circuit={data.id} size={300} stroke={6} /></div>
        )}
      </div>
      {sec.sessions.length ? (
        <div className="sector-legend">
          {SECTORS.map((s) => {
            const h = holder(s.id);
            return (
              <div key={s.id} className={`sector-row${hover === s.id ? " on" : ""}`} onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)}>
                <i style={{ background: s.color }} aria-hidden />
                <span className="sector-name">{s.label}</span>
                {h ? (
                  <Link to={`/drivers/${h.driver}`} className="cell-name"><Avatar driver={h.driver} team={h.team} size={24} /><span>{h.name}</span></Link>
                ) : <span className="sub">no time</span>}
                <b className="mono">{h ? h.time.toFixed(3) : "–"}</b>
                {year === "all" && h?.season && <span className="mono yr">{h.season}</span>}
              </div>
            );
          })}
          {sess && (
            <div className="sector-sum">
              <span>Ideal lap <Info>Best three sectors of the session added together.</Info></span><b className="mono">{lapTime(sess.ideal)}</b>
              <span>Pole lap</span><b className="mono">{lapTime(sess.pole_lap?.time)}</b>
              {sess.top_speed && <><span>Top speed</span><b className="mono">{Math.round(sess.top_speed.time)} km/h <small>{sess.top_speed.name.split(" ").slice(-1)}</small></b></>}
            </div>
          )}
        </div>
      ) : (
        <p className="body-text">No sector times for this track yet. They cover {sec.first_season} onwards and appear once the app has downloaded them from OpenF1.</p>
      )}
      <p className="credit">Track outline: bacinger/f1-circuits (MIT). Timing: OpenF1.</p>
    </section>
  );
}

/** Every driver's best sectors in one session, fastest of each column in purple (like a timing screen). */
export function SectorTable({ data }: { data: TrackDetail }) {
  const sessions = data.sectors.sessions;
  const [year, setYear] = useState(sessions.length ? sessions[sessions.length - 1].season : 0);
  if (!sessions.length) return null;
  const sess = sessions.find((s) => s.season === year) ?? sessions[sessions.length - 1];
  const best = (k: keyof SectorEntry) => Math.min(...sess.drivers.map((d) => d[k] as number | null).filter((v): v is number => v != null));
  const top = Math.max(...sess.drivers.map((d) => d.speed ?? 0));
  const cell = (v: number | null, b: number) => <td className={`num${v != null && v === b ? " fastest" : ""}`}>{v != null ? v.toFixed(3) : "–"}</td>;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Sector times <Info>Each driver's best sector times and best lap in qualifying. Purple marks the fastest of the session. {SOURCE}</Info></h2>
        <div className="seg" role="group" aria-label="Season">
          {sessions.map((s) => <button key={s.season} type="button" aria-pressed={s.season === sess.season} onClick={() => setYear(s.season)}>{s.season}</button>)}
        </div>
      </div>
      <div className="scroll">
        <Sortable rows={sess.drivers} initial={{ key: "lap", dir: "asc" }}>
          {(rows, th) => (
            <table className="sector-table">
              <thead><tr>{th("name", "Driver")}{th("s1", "S1", "num")}{th("s2", "S2", "num")}{th("s3", "S3", "num")}{th("ideal", "Ideal", "num")}{th("lap", "Best lap", "num")}{th("speed", "Top speed", "num")}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.driver}>
                    <td><Link className="cell-name" to={`/drivers/${r.driver}`}><Avatar driver={r.driver} team={r.team} size={26} /><Swatch team={r.team} /><span>{r.name}</span></Link></td>
                    {cell(r.s1, best("s1"))}{cell(r.s2, best("s2"))}{cell(r.s3, best("s3"))}
                    <td className="num">{lapTime(r.ideal)}</td>
                    <td className={`num${r.lap != null && r.lap === best("lap") ? " fastest" : ""}`}>{lapTime(r.lap)}</td>
                    <td className={`num${r.speed != null && r.speed === top ? " fastest" : ""}`}>{r.speed != null ? Math.round(r.speed) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Sortable>
      </div>
    </section>
  );
}

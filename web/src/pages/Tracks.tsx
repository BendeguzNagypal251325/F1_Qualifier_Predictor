import { Link, useParams } from "react-router-dom";
import { seasonsParam, useApi, useMeta } from "../api";
import {
  Avatar, Bar, ErrorBox, fmt, Loading, pct, PosLegend, SeasonFilter, Sortable, Swatch, Tile, TrackOutline, useSeasons, YearChips,
} from "../components/ui";
import type { SessionSummary, TrackDetail } from "../types";
import { QualiBreakdown } from "../components/QualiBreakdown";
import { SectorTable, TrackMap } from "../components/TrackSectors";

export function TrackList() {
  const meta = useMeta();
  const { data } = useApi<SessionSummary[]>("/api/sessions");
  const visits = new Map<string, SessionSummary[]>();
  data?.forEach((s) => visits.set(s.circuit, [...(visits.get(s.circuit) ?? []), s]));
  const circuits = [...meta.circuits].sort((a, b) => (visits.get(b.id)?.length ?? 0) - (visits.get(a.id)?.length ?? 0) || a.name.localeCompare(b.name));
  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Tracks</span>
          <h1>{meta.circuits.length} circuits since {meta.seasons[0]}</h1>
          <p className="lede">Every driver's qualifying record at each track, and how well the model called each session there.</p>
        </div>
      </div>
      <div className="card-grid stagger">
        {circuits.map((c) => {
          const v = visits.get(c.id) ?? [];
          const avg = v.length ? v.reduce((a, s) => a + s.correct, 0) / v.length : null;
          return (
            <Link key={c.id} to={`/tracks/${c.id}`} className="card lift">
              <div className="media" style={{ display: "grid", placeItems: "center", background: "var(--surface-2)" }}>
                <TrackOutline circuit={c.id} size={130} stroke={4} />
              </div>
              <div className="body">
                <h3>{c.name}</h3>
                <div className="meta">
                  <span>{v.length} session{v.length === 1 ? "" : "s"}</span>
                  {c.length_m && <span>{(c.length_m / 1000).toFixed(3)} km</span>}
                  {avg != null && <span>model {avg.toFixed(1)}/10</span>}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}

export function TrackPage() {
  const { id = "" } = useParams();
  const meta = useMeta();
  const [seasons, setSeasons] = useSeasons();
  const q = seasonsParam(seasons, meta.seasons);
  const { data, error } = useApi<TrackDetail>(`/api/tracks/${id}${q ? "?" + q : ""}`);
  const c = meta.circuits.find((x) => x.id === id);
  if (!c) return <ErrorBox error={`Unknown track “${id}”`} />;
  const poles = new Map<string, number>();
  data?.sessions.forEach((s) => poles.set(s.pole, (poles.get(s.pole) ?? 0) + 1));
  const topPole = [...poles.entries()].sort((a, b) => b[1] - a[1])[0];

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Track{c.length_m ? ` · ${(c.length_m / 1000).toFixed(3)} km` : ""}</span>
          <h1>{c.name}</h1>
          <div className="controls"><SeasonFilter value={seasons} onChange={setSeasons} /></div>
        </div>
      </div>
      <div className="split">
        {data ? <TrackMap data={data} /> : (
          <section className="panel">
            <div style={{ display: "grid", placeItems: "center", padding: 12 }}><TrackOutline circuit={c.id} size={300} stroke={6} /></div>
          </section>
        )}
        <div className="track-side">
          {!data ? (error ? null : <Loading />) : (
            <>
              <div className="tiles two-one stagger">
                <Tile label="Sessions" value={data.sessions.length} sub={data.sessions.map((s) => s.season).join(", ") || "none in range"} />
                <Tile label="Model here" value={<>{fmt(data.model_correct, 2)}<small> / 10</small></>} sub="correct Q3 picks" />
                <Tile label="Most poles" value={topPole?.[0] ?? "–"} small sub={topPole ? `${topPole[1]} pole${topPole[1] > 1 ? "s" : ""}` : ""} />
              </div>
              <section className="panel">
                <h3>Each session here</h3>
                <div className="legend">
                  {data.sessions.map((s) => (
                    <Link key={s.race_key} to={`/sessions/${s.race_key}`} className={`chip ${s.correct >= 8 ? "q3" : s.correct >= 7 ? "q2" : "out"}`} data-tip={`${s.season}\nPole: ${s.pole}\nModel: ${s.correct}/10 · click to open`}>
                      {s.season} · {s.correct}/10
                    </Link>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
      {error && <ErrorBox error={error} />}
      {data && <QualiBreakdown data={data} />}
      {data && <SectorTable data={data} />}
      {data && (
        <section className="panel">
          <div className="panel-head"><h2>Every driver at {c.name}</h2><PosLegend /></div>
          <div className="scroll">
            <Sortable rows={data.drivers} initial={{ key: "avg_pos", dir: "asc" }}>
              {(rows, th) => (
                <table>
                  <thead><tr>{th("name", "Driver")}{th("sessions", "Visits", "num")}{th("avg_pos", "Avg", "num")}{th("best", "Best", "num")}{th("q3_rate", "Q3 rate")}{th("poles", "Poles", "num")}<th>Results by season</th>{th("avg_pred", "Model avg", "num")}{th("right", "Model right", "num")}</tr></thead>
                  <tbody>
                    {rows.map((t) => (
                      <tr key={t.driver}>
                        <td><Link className="cell-name" to={`/drivers/${t.driver}`}><Avatar driver={t.driver} team={t.team} size={30} /><Swatch team={t.team} /><span>{t.name}</span></Link></td>
                        <td className="num">{t.sessions}</td>
                        <td className="num">{fmt(t.avg_pos)}</td>
                        <td className="num">P{t.best}</td>
                        <td style={{ minWidth: 130 }}><Bar value={t.q3_rate} label={pct(t.q3_rate)} /></td>
                        <td className="num">{t.poles || "–"}</td>
                        <td><YearChips results={t.results} seasons={seasons} driverName={t.name} /></td>
                        <td className="num">P{fmt(t.avg_pred)}</td>
                        <td className="num">{t.right}/{t.sessions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Sortable>
          </div>
        </section>
      )}
    </>
  );
}

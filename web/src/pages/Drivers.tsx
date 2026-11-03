import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { seasonsParam, useApi, useMeta } from "../api";
import {
  Bar, ContribBars, photoStyle, ErrorBox, fmt, Loading, pct, pickPhoto, PosLegend, SeasonFilter, Sortable, Swatch, Tile,
  TrackOutline, useSeasons, useTeam, YearChips,
} from "../components/ui";
import type { DriverDetail, DriverMeta } from "../types";

function DriverCard({ d, latest }: { d: DriverMeta; latest: number }) {
  const team = useTeam(d.team);
  const photo = pickPhoto(d.photos);
  return (
    <Link to={`/drivers/${d.id}`} className="card" style={{ ["--stripe" as string]: team.color }}>
      <div className="media" style={photo ? photoStyle(photo[0], photo[1], 16 / 9, 0.45) : { background: `linear-gradient(135deg, ${team.color}, var(--surface-2))` }}>
        {!photo && <span style={{ position: "absolute", right: 12, bottom: 4, fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 48, color: "rgb(255 255 255 / 0.85)" }}>{d.number ?? ""}</span>}
      </div>
      <div className="body">
        <h3>{d.name}</h3>
        <div className="meta"><span><Swatch team={d.team} /> {team.name}</span><span>{d.sessions} sessions{d.last_season !== latest ? ` · until ${d.last_season}` : ""}</span></div>
      </div>
    </Link>
  );
}

export function DriverList() {
  const meta = useMeta();
  const [q, setQ] = useState("");
  const [current, setCurrent] = useState(true);
  const list = meta.drivers.filter((d) => (!current || d.last_season === meta.latest) && d.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Drivers</span>
          <h1>{current ? `The ${meta.latest} grid` : `Every driver since ${meta.seasons[0]}`}</h1>
          <p className="lede">Open a driver for their qualifying record at every track, the teams they drove for, and how much of their predictions comes from the driver and how much from the car.</p>
        </div>
        <div className="controls">
          <div className="seg" role="group" aria-label="Which drivers">
            <button type="button" aria-pressed={current} onClick={() => setCurrent(true)}>{meta.latest} grid</button>
            <button type="button" aria-pressed={!current} onClick={() => setCurrent(false)}>All</button>
          </div>
          <input id="driver-search" type="search" placeholder="Search drivers" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search drivers" />
        </div>
      </div>
      <div className="card-grid">{list.map((d) => <DriverCard key={d.id} d={d} latest={meta.latest} />)}</div>
      {!list.length && <div className="panel empty-state">No driver matches “{q}”.</div>}
      {meta.media.enabled && <p className="credit">{meta.media.credit}</p>}
    </>
  );
}

export function DriverPage() {
  const { id = "" } = useParams();
  const meta = useMeta();
  const [seasons, setSeasons] = useSeasons();
  const q = seasonsParam(seasons, meta.seasons);
  const { data, error } = useApi<DriverDetail>(`/api/drivers/${id}${q ? "?" + q : ""}`);
  const d = meta.drivers.find((x) => x.id === id);
  const team = useTeam(d?.team ?? "");
  if (!d) return <ErrorBox error={`Unknown driver “${id}”`} />;
  const photo = pickPhoto(d.photos);
  const stints = new Map<string, number[]>();
  data?.teams.forEach((t) => stints.set(t.team, [...(stints.get(t.team) ?? []), t.season]));

  return (
    <>
      <section className="hero" style={{ ["--stripe" as string]: team.color }}>
        <div className="hero-text">
          <span className="eyebrow">{team.name}{d.number ? ` · #${d.number}` : ""}</span>
          <h1>{d.name}</h1>
          <div className="controls"><SeasonFilter value={seasons} onChange={setSeasons} /></div>
          <div className="legend">
            {[...stints.entries()].map(([t, ys]) => (
              <Link key={t} to={`/cars/${ys[ys.length - 1]}/${t}`} className="badge" data-tip={`Open the ${ys[ys.length - 1]} car`}>
                <Swatch team={t} /> {meta.teams.find((x) => x.id === t)?.name} {ys[0]}{ys.length > 1 ? `–${String(ys[ys.length - 1]).slice(2)}` : ""}
              </Link>
            ))}
          </div>
        </div>
        <div className="hero-img" style={photo ? { ...photoStyle(photo[0], photo[1], 1.6, 0.4), backgroundColor: "#111" } : { background: `linear-gradient(135deg, ${team.color}, var(--surface-2))` }} role="img" aria-label={photo ? `${d.name}, ${photo[0]} season photo` : undefined} />
      </section>

      {error && <ErrorBox error={error} />}
      {!data ? <Loading height={300} /> : (
        <>
          <div className="tiles">
            <Tile label="Sessions" value={data.sessions} sub={`at ${data.tracks.length} tracks`} />
            <Tile label="Avg quali position" value={fmt(data.avg_pos)} sub={`best P${data.best ?? "–"}`} />
            <Tile label="Reached Q3" value={pct(data.q3_rate)} />
            <Tile label="Poles" value={data.poles} />
            <Tile label="Model called it" value={pct(data.right / Math.max(1, data.sessions))} sub="in or out of Q3 correctly" />
          </div>
          <div className="split">
            <section className="panel">
              <div className="panel-head"><h2>Driver or car?</h2><span className="note">average push, in grid places</span></div>
              <ContribBars contrib={{ driver: data.contrib_driver ?? 0, car: data.contrib_car ?? 0, weekend: data.contrib_weekend ?? 0, context: data.contrib_context ?? 0 }} />
              <p className="note">Negative = the model moved {d.name.split(" ")[0]} up the grid, compared with an average entry. Car = the form of the team's car; driver = {d.name.split(" ")[0]}'s own record, which also reflects the cars driven before.</p>
            </section>
            <section className="panel">
              <div className="panel-head"><h2>Teams</h2></div>
              <table>
                <thead><tr><th>Season</th><th>Team</th><th className="num">Sessions</th></tr></thead>
                <tbody>
                  {data.teams.map((t) => (
                    <tr key={`${t.team}-${t.season}`}>
                      <td className="mono">{t.season}</td>
                      <td><Link to={`/cars/${t.season}/${t.team}`}><Swatch team={t.team} /> {meta.teams.find((x) => x.id === t.team)?.name}</Link></td>
                      <td className="num">{t.sessions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
          <section className="panel">
            <div className="panel-head"><h2>{d.name} at every track</h2><PosLegend /></div>
            <div className="scroll">
              <Sortable rows={data.tracks} initial={{ key: "avg_pos", dir: "asc" }}>
                {(rows, th) => (
                  <table>
                    <thead><tr>{th("name", "Track")}{th("sessions", "Visits", "num")}{th("avg_pos", "Avg", "num")}{th("best", "Best", "num")}{th("q3_rate", "Q3 rate")}{th("poles", "Poles", "num")}<th>Results by season</th>{th("avg_pred", "Model avg", "num")}{th("right", "Model right", "num")}</tr></thead>
                    <tbody>
                      {rows.map((t) => (
                        <tr key={t.circuit}>
                          <td><Link className="cell-name" to={`/tracks/${t.circuit}`}><TrackOutline circuit={t.circuit} size={30} stroke={2} /><span>{t.name}</span></Link></td>
                          <td className="num">{t.sessions}</td>
                          <td className="num">{fmt(t.avg_pos)}</td>
                          <td className="num">P{t.best}</td>
                          <td style={{ minWidth: 130 }}><Bar value={t.q3_rate} label={pct(t.q3_rate)} /></td>
                          <td className="num">{t.poles || "–"}</td>
                          <td><YearChips results={t.results} seasons={seasons} driverName={d.name} /></td>
                          <td className="num">P{fmt(t.avg_pred)}</td>
                          <td className="num">{t.right}/{t.sessions}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Sortable>
            </div>
            <p className="note">Hover a result for the model's prediction that weekend. A red dot means the model put the driver on the wrong side of the Q3 cut.</p>
          </section>
          {photo && <p className="credit">Photo: {meta.media.credit}</p>}
        </>
      )}
    </>
  );
}

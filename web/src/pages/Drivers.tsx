import { useEffect, useState } from "react";
import { prefetchHelmet } from "../three/modelFiles";
import { Link, useParams } from "react-router-dom";
import { seasonsParam, useApi, useMeta } from "../api";
import {
  Bar, ContribBars, ErrorBox, Info, fmt, Loading, pct, PosLegend, SeasonFilter, SeasonStrip, Sortable, Swatch, Tile, useHelmetSpec,
  TrackOutline, useSeasons, useTeam, YearChips,
} from "../components/ui";
import type { DriverDetail, DriverMeta } from "../types";
import { Helmet3D, HelmetImage, Show3DButton } from "../components/lazy3d";

function DriverCard({ d, latest }: { d: DriverMeta; latest: number }) {
  const team = useTeam(d.team);
  const spec = useHelmetSpec(d.id, d.last_season);
  return (
    <Link to={`/drivers/${d.id}`} className="card lift">
      <div className="dcard-media">
        <HelmetImage spec={spec} alt={`${d.name}'s helmet design`} />
        {d.number != null && <span className="num">#{d.number}</span>}
        <span className="script" aria-hidden>{d.name}</span>
      </div>
      <div className="body">
        <h3>{d.name}</h3>
        <div className="meta"><span><Swatch team={d.team} /> {team.name}</span><span>{d.sessions} sessions{d.last_season !== latest ? ` · until ${d.last_season}` : ""}</span></div>
        <SeasonStrip driver={d.id} />
      </div>
    </Link>
  );
}

export function DriverList() {
  const meta = useMeta();
  useEffect(prefetchHelmet, []);
  const [q, setQ] = useState("");
  const [current, setCurrent] = useState(true);
  const list = meta.drivers.filter((d) => (!current || d.last_season === meta.latest) && d.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Drivers</span>
          <h1>{current ? `The ${meta.latest} drivers` : `Every driver since ${meta.seasons[0]}`}</h1>
          <p className="lede">Each driver's qualifying record by track and team, and how much of their prediction comes from them rather than the car.</p>
        </div>
        <div className="controls">
          <div className="seg" role="group" aria-label="Which drivers">
            <button type="button" aria-pressed={current} onClick={() => setCurrent(true)}>{meta.latest}</button>
            <button type="button" aria-pressed={!current} onClick={() => setCurrent(false)}>All</button>
          </div>
          <input id="driver-search" type="search" placeholder="Search drivers" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search drivers" />
          <Show3DButton what="helmets" />
        </div>
      </div>
      <div className="card-grid stagger">{list.map((d) => <DriverCard key={d.id} d={d} latest={meta.latest} />)}</div>
      {!list.length && <div className="panel empty-state">No driver matches “{q}”.</div>}
    </>
  );
}

/** Consecutive seasons with the same team, merged into one spell. */
function spells(teams: { team: string; season: number; sessions: number }[]) {
  const out: { team: string; seasons: number[]; sessions: number }[] = [];
  [...teams].sort((x, y) => x.season - y.season).forEach((t) => {
    const last = out[out.length - 1];
    if (last && last.team === t.team && t.season - last.seasons[last.seasons.length - 1] <= 1) {
      if (!last.seasons.includes(t.season)) last.seasons.push(t.season);
      last.sessions += t.sessions;
    } else out.push({ team: t.team, seasons: [t.season], sessions: t.sessions });
  });
  return out;
}

export function DriverPage() {
  const { id = "" } = useParams();
  useEffect(prefetchHelmet, []);
  const meta = useMeta();
  const [seasons, setSeasons] = useSeasons();
  const q = seasonsParam(seasons, meta.seasons);
  const { data, error } = useApi<DriverDetail>(`/api/drivers/${id}${q ? "?" + q : ""}`);
  const d = meta.drivers.find((x) => x.id === id);
  const team = useTeam(d?.team ?? "");
  const heroSeason = seasons[seasons.length - 1];
  const helmet = useHelmetSpec(id, d && d.teams[String(heroSeason)] ? heroSeason : d?.last_season);
  const heroTeam = useTeam(helmet.team);
  if (!d) return <ErrorBox error={`Unknown driver “${id}”`} />;
  const stints = new Map<string, number[]>();
  data?.teams.forEach((t) => stints.set(t.team, [...(stints.get(t.team) ?? []), t.season]));

  return (
    <>
      <section className="hero">
        <div className="hero-text">
          <span className="eyebrow">{team.name}{d.number ? ` · #${d.number}` : ""}</span>
          <h1>{d.name} <Info label="About the helmet">{helmet.source === "reference"
            ? <>Helmet colours from descriptions of {d.name.split(" ")[0]}'s 2026 helmet: {helmet.note} Simplified artwork, not an exact copy.</>
            : <>No published description of {d.name.split(" ")[0]}'s helmet found, so it is shown in {heroTeam.name} colours ({helmet.year}).</>}</Info></h1>
          <span className="script-name" aria-hidden>{d.name}</span>
          <SeasonStrip driver={d.id} labels />
          <div className="controls"><SeasonFilter value={seasons} onChange={setSeasons} /></div>
          <div className="legend">
            {[...stints.entries()].map(([t, ys]) => (
              <Link key={t} to={`/cars/${ys[ys.length - 1]}/${t}`} className="badge" data-tip={`Open the ${ys[ys.length - 1]} car`}>
                <Swatch team={t} /> {meta.teams.find((x) => x.id === t)?.name} {ys[0]}{ys.length > 1 ? `–${String(ys[ys.length - 1]).slice(2)}` : ""}
              </Link>
            ))}
          </div>
        </div>
        <div className="hero-img helmet-stage" style={{ background: "linear-gradient(180deg, #1c1c25, #121219)" }}>
          <Helmet3D spec={helmet} label={`${d.name}'s helmet in ${heroTeam.name} colours, ${helmet.year}`} />
          {d.number != null && <span className="hero-num" aria-hidden>#{d.number}</span>}
        </div>
      </section>

      {error && <ErrorBox error={error} />}
      {!data ? (error ? null : <Loading height={300} />) : (
        <>
          <div className="tiles stagger">
            <Tile label="Sessions" value={data.sessions} sub={`at ${data.tracks.length} tracks`} />
            <Tile label="Avg quali position" value={fmt(data.avg_pos)} sub={`best P${data.best ?? "–"}`} />
            <Tile label="Reached Q3" value={pct(data.q3_rate)} />
            <Tile label="Poles" value={data.poles} />
            <Tile label="Model called it" value={pct(data.right / Math.max(1, data.sessions))} sub="in or out of Q3 correctly" />
          </div>
          <div className="split">
            <section className="panel">
              <div className="panel-head"><h2>Driver or car?<Info>average push, in qualifying places. Negative = moved up the qualifying order. Car = the team's form; driver = {d.name.split(" ")[0]}'s own record (which reflects earlier cars too).</Info></h2></div>
              <ContribBars contrib={{ driver: data.contrib_driver ?? 0, car: data.contrib_car ?? 0, weekend: data.contrib_weekend ?? 0, context: data.contrib_context ?? 0 }} />
            </section>
            <section className="panel">
              <div className="panel-head"><h2>Teams<Info>click a year to open that car</Info></h2></div>
              <table className="wrap">
                <thead><tr><th>Team</th><th>Cars</th><th className="num">Sessions</th></tr></thead>
                <tbody>
                  {spells(data.teams).map((sp) => (
                    <tr key={`${sp.team}-${sp.seasons[0]}`}>
                      <td><Swatch team={sp.team} /> {meta.teams.find((x) => x.id === sp.team)?.name} <span className="sub">{sp.seasons[0]}{sp.seasons.length > 1 ? `–${String(sp.seasons[sp.seasons.length - 1]).slice(2)}` : ""}</span></td>
                      <td><div className="legend">{sp.seasons.map((y) => <Link key={y} to={`/cars/${y}/${sp.team}`} className="badge">{meta.cars[String(y)]?.[sp.team]?.chassis ?? y}</Link>)}</div></td>
                      <td className="num">{sp.sessions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
          <section className="panel">
            <div className="panel-head"><h2>{d.name} at every track <Info>Hover a result for the model's prediction that weekend. A red dot means the model put the driver on the wrong side of the Q3 cut.</Info></h2><PosLegend /></div>
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
          </section>
        </>
      )}
    </>
  );
}

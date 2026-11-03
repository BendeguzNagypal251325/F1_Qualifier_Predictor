import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useApi, useMeta } from "../api";
import { Car3D, CarImage, HelmetImage } from "../components/lazy3d";
import { ERA_SPECS, PART_LABEL, PART_ORDER, type PartId } from "../three/parts";
import { RaceLine } from "../components/Charts";
import { Avatar, ContribBars, ErrorBox, fmt, Loading, pct, signed, Swatch, Tile, useHelmetSpec, Info } from "../components/ui";
import type { CarDetail, CarList as CarListData } from "../types";

const ENGINE_NAMES: Record<string, string> = {
  mercedes: "Mercedes", "bwt-mercedes": "BWT Mercedes", ferrari: "Ferrari", renault: "Renault", honda: "Honda",
  rbpt: "Red Bull Powertrains", "honda-rbpt": "Honda RBPT", "red-bull-ford": "Red Bull Ford", audi: "Audi",
};
export const engineName = (e: string) => ENGINE_NAMES[e] ?? e.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function CarList() {
  const meta = useMeta();
  const [params, setParams] = useSearchParams();
  const season = Number(params.get("season")) || meta.latest;
  const { data, error } = useApi<CarListData>(`/api/cars?season=${season}`);
  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Cars · {season}</span>
          <h1>The {season} cars, fastest first</h1>
          <p className="lede">Cars and drivers are modelled separately: a car's form stays with the team when a driver leaves. Open a car to explore it part by part.</p>
        </div>
        <div className="seg" role="group" aria-label="Season">
          {meta.seasons.map((y) => <button key={y} type="button" aria-pressed={y === season} onClick={() => setParams({ season: String(y) })}>{y}</button>)}
        </div>
      </div>
      {error && <ErrorBox error={error} />}
      {!data ? <Loading height={400} /> : (
        <>
          <div className="panel">
            <div className="panel-head"><h2>{data.cars[0]?.era_label}<Info>{ERA_SPECS[data.era]?.extra}</Info></h2></div>
            <p className="body-text">{data.cars[0]?.era_summary}</p>
          </div>
          <div className="card-grid stagger">
            {data.cars.map((c, i) => (
              <Link key={c.team} to={`/cars/${season}/${c.team}`} className="card lift">
                <div className="media" style={{ background: "linear-gradient(180deg, #1d1d26, #101016)" }}>
                  <CarImage era={c.era} livery={c.livery} alt={`${c.name} ${c.chassis ?? ""} 3D model`} />
                </div>
                <div className="body">
                  <h3>{c.name} {c.chassis}</h3>
                  <div className="meta">
                    <span className="mono">#{i + 1} on pace</span>
                    <span>{c.pace_gap != null ? `+${c.pace_gap.toFixed(2)}% to pole` : ""}</span>
                  </div>
                  <div className="meta"><span>{engineName(c.engine)} power · avg P{c.avg_pos.toFixed(1)}</span></div>
                </div>
              </Link>
            ))}
          </div>
          <EngineTable data={data} />
        </>
      )}
    </>
  );
}

function EngineTable({ data }: { data: CarListData }) {
  const engines = new Map<string, { gaps: number[]; teams: string[] }>();
  data.cars.forEach((c) => {
    const e = engines.get(c.engine) ?? { gaps: [], teams: [] };
    if (c.pace_gap != null) e.gaps.push(c.pace_gap);
    e.teams.push(c.name);
    engines.set(c.engine, e);
  });
  const rows = [...engines.entries()].map(([e, v]) => ({ e, gap: v.gaps.reduce((a, b) => a + b, 0) / v.gaps.length, best: Math.min(...v.gaps), teams: v.teams }))
    .sort((a, b) => a.best - b.best);
  return (
    <section className="panel">
      <div className="panel-head"><h2>Power units in {data.season}<Info>gap of each engine's cars to pole The engine supplier cannot be separated from the chassis in this data: these are whole-car gaps grouped by engine.</Info></h2></div>
      <div className="scroll">
        <table>
          <thead><tr><th>Engine</th><th>Customers</th><th className="num">Best car</th><th className="num">Average car</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.e}><td>{engineName(r.e)}</td><td>{r.teams.join(", ")}</td><td className="num">+{r.best.toFixed(2)}%</td><td className="num">+{r.gap.toFixed(2)}%</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

function PartPanel({ part, car, cars }: { part: PartId | null; car: CarDetail; cars?: CarListData | null }) {
  if (!part) {
    return (
      <div className="panel">
        <h2>Pick a part</h2>
        <p className="body-text">Click a part of the car, or use the buttons under it.</p>
        <EraSpecs era={car.era} label={car.era_label} />
      </div>
    );
  }
  let body: React.ReactNode;
  if (part === "power-unit") {
    const same = cars?.cars.filter((c) => c.engine === car.engine) ?? [];
    body = (
      <>
        <Tile label="Engine supplier" value={engineName(car.engine)} small sub={`${same.length} car${same.length === 1 ? "" : "s"} in ${car.season}: ${same.map((c) => c.name).join(", ")}`} />
        <table className="wrap"><tbody>{same.map((c) => <tr key={c.team}><td><Swatch team={c.team} /> {c.name}</td><td className="num">+{c.pace_gap?.toFixed(2)}%</td></tr>)}</tbody></table>
      </>
    );
  } else if (part === "cockpit") {
    body = (
      <table className="wrap">
        <thead><tr><th>Driver</th><th className="num">Avg</th><th className="num">vs teammate</th><th className="num">Driver push</th></tr></thead>
        <tbody>{car.drivers.map((d) => (
          <tr key={d.driver}>
            <td><Link className="cell-name" to={`/drivers/${d.driver}`}><Avatar driver={d.driver} team={car.team} size={26} /><span>{d.name}</span></Link></td>
            <td className="num">{fmt(d.avg_pos)}</td>
            <td className="num" data-tip="Average places ahead (−) or behind (+) the teammate">{signed(d.vs_teammate)}</td>
            <td className="num">{signed(d.contrib_driver)}</td>
          </tr>
        ))}</tbody>
      </table>
    );
  } else if (part === "wheels") {
    body = (
      <div className="tiles stagger">
        <Tile label="Reached Q3" value={pct(car.q3_rate)} sub="of this car's entries" />
        <Tile label="Best grid slot" value={`P${car.best}`} sub={`${car.poles} pole${car.poles === 1 ? "" : "s"}`} />
      </div>
    );
  } else {
    body = (
      <div className="tiles stagger">
        <Tile label="Gap to pole" value={`+${fmt(car.pace_gap, 2)}%`} sub="team's best lap, season average" />
        <Tile label="Pace rank" value={fmt(car.pace_rank, 1)} sub={`of ${car.teams_in_season} teams, average`} />
        <Tile label="Car push" value={signed(car.contrib_car)} sub="places vs an average car" />
      </div>
    );
  }
  return (
    <div className="panel">
      <span className="eyebrow">{car.name} {car.chassis} · {car.season}</span>
      <h2>{PART_LABEL[part]} <Info>Numbers are for the whole car. The data has no measurements of single parts.</Info></h2>
      <p className="body-text">{car.parts[part]}</p>
      {body}
    </div>
  );
}

function EraSpecs({ era, label }: { era: string; label: string }) {
  const s = ERA_SPECS[era];
  if (!s) return null;
  return (
    <table className="wrap">
      <caption className="eyebrow" style={{ textAlign: "left", paddingBottom: 6 }}>{label}</caption>
      <tbody>
        <tr><td>Width</td><td className="num">{s.width}</td></tr>
        <tr><td>Wheelbase</td><td className="num">{s.wheelbase}</td></tr>
        <tr><td>Minimum weight</td><td className="num">{s.weight}</td></tr>
        <tr><td>Wheels</td><td className="num">{s.wheels}</td></tr>
        <tr><td>Aero</td><td className="num">{s.extra}</td></tr>
      </tbody>
    </table>
  );
}

function DriverHelmet({ driver, season, team }: { driver: string; season: number; team: string }) {
  const spec = useHelmetSpec(driver, season, team);
  return <HelmetImage spec={spec} alt="" />;
}

function CarViewer({ car, part, onSelect }: { car: CarDetail; part: PartId | null; onSelect: (p: PartId) => void }) {
  const helmet = useHelmetSpec(car.drivers[0]?.driver ?? "", car.season, car.team);
  return <Car3D era={car.era} livery={car.livery} selected={part} onSelect={onSelect} helmet={car.drivers.length ? helmet : undefined} label={`${car.name} ${car.chassis ?? ""}`} />;
}

export function CarPage() {
  const { season = "", team = "" } = useParams();
  const nav = useNavigate();
  const [part, setPart] = useState<PartId | null>(null);
  const { data: car, error } = useApi<CarDetail>(`/api/cars/${season}/${team}`);
  const { data: cars } = useApi<CarListData>(`/api/cars?season=${season}`);
  if (error) return <ErrorBox error={error} />;
  if (!car) return <Loading height={480} />;

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow"><Swatch team={car.team} /> {car.name} · {car.season} · {engineName(car.engine)} power</span>
          <h1>{car.name} {car.chassis}</h1>
          <p className="lede">{car.era_summary}</p>
        </div>
        <div className="controls">
          <label htmlFor="car-season">Season
            <select id="car-season" value={car.season} onChange={(e) => {
              const l = car.lineage.find((x) => x.season === Number(e.target.value));
              if (l) nav(`/cars/${l.season}/${l.team}`);
            }}>
              {car.lineage.map((l) => <option key={l.season} value={l.season}>{l.season}{l.team !== car.team ? ` (${l.name})` : ""}</option>)}
            </select>
          </label>
          <Link to={`/what-if?team=${car.team}&season=${car.season}`} className="btn">Put another driver in this car</Link>
        </div>
      </div>

      <div className="car-wrap">
        <div className="stackcol">
        <section className="panel">
          <CarViewer car={car} part={part} onSelect={(p) => setPart((cur) => (cur === p ? null : p))} />
          <div className="part-list" role="group" aria-label="Car parts">
            {PART_ORDER.map((p) => <button key={p} type="button" aria-pressed={part === p} onClick={() => setPart(part === p ? null : p)}>{PART_LABEL[p]}</button>)}
          </div>
          <p className="credit">3D model built from the {car.era_label.toLowerCase()} regulation dimensions (wheelbase, width, wheels, wing spans) in {car.name}'s {car.season} colours. Simplified shapes, no sponsor logos; not a replica of the real car.</p>
        </section>
        <div className="tiles car-tiles">
          <Tile label="Avg quali" value={fmt(car.avg_pos)} sub={`${car.sessions} entries`} />
          <Tile label="Gap to pole" value={`+${fmt(car.pace_gap, 2)}%`} sub="faster car" />
          <Tile label="Pace rank" value={fmt(car.pace_rank, 1)} sub={`of ${car.teams_in_season} teams`} />
          <Tile label="Reached Q3" value={pct(car.q3_rate)} sub="of entries" />
          <Tile label="Model right" value={pct(car.right / Math.max(1, car.sessions))} sub="Q3 calls" />
        </div>
        </div>
        <div className="stackcol">
          <PartPanel part={part} car={car} cars={cars} />
          <section className="panel">
            <div className="panel-head"><h2>Who drove it<Info>average push on the prediction</Info></h2></div>
            {car.drivers.map((d) => (
              <div key={d.driver} style={{ display: "grid", gap: 8 }}>
                <Link className="cell-name" to={`/drivers/${d.driver}`}><span className="mini-helmet"><DriverHelmet driver={d.driver} season={car.season} team={car.team} /></span><span><b>{d.name}</b> · {d.sessions} sessions · avg P{fmt(d.avg_pos)}</span></Link>
                <ContribBars contrib={{ driver: d.contrib_driver ?? 0, car: d.contrib_car ?? 0, weekend: d.contrib_weekend ?? 0, context: d.contrib_context ?? 0 }} />
              </div>
            ))}
          </section>
        </div>
      </div>


      <div>
        <section className="panel">
          <div className="panel-head"><h2>Pace through the season<Info>gap to pole, % (lower is faster) The team's fastest qualifying lap at each race, as a percentage slower than pole. Upgrades and regressions show up here.</Info></h2></div>
          <RaceLine
            points={car.trend.map((t) => ({ label: `R${t.round}`, value: t.gap, tip: `R${t.round} ${t.gp}\n+${t.gap?.toFixed(3)}% to pole · pace rank ${t.rank}\nbest grid slot P${t.best_pos}` }))}
            yLabel="Gap to pole by race" fmt={(v) => `${v.toFixed(1)}%`} width={1120} height={240}
          />
        </section>
      </div>

    </>
  );
}

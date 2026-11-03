import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useApi, useMeta } from "../api";
import { CarSchematic, ERA_SPECS, PART_LABEL, PART_ORDER, type PartId } from "../components/CarSchematic";
import { RaceLine } from "../components/Charts";
import { Avatar, ContribBars, ErrorBox, fmt, Loading, pct, signed, Swatch, Tile } from "../components/ui";
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
            <div className="panel-head"><h2>{data.cars[0]?.era_label}</h2><span className="note">{ERA_SPECS[data.era]?.extra}</span></div>
            <p className="note">{data.cars[0]?.era_summary}</p>
          </div>
          <div className="card-grid">
            {data.cars.map((c, i) => (
              <Link key={c.team} to={`/cars/${season}/${c.team}`} className="card" style={{ ["--stripe" as string]: c.livery[0] }}>
                <div className="media" style={{ display: "grid", placeItems: "center", background: "var(--surface-2)" }}>
                  <CarSchematic era={c.era} livery={c.livery} chassis={c.chassis} compact />
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
      <div className="panel-head"><h2>Power units in {data.season}</h2><span className="note">gap of each engine's cars to pole</span></div>
      <div className="scroll">
        <table>
          <thead><tr><th>Engine</th><th>Customers</th><th className="num">Best car</th><th className="num">Average car</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.e}><td>{engineName(r.e)}</td><td>{r.teams.join(", ")}</td><td className="num">+{r.best.toFixed(2)}%</td><td className="num">+{r.gap.toFixed(2)}%</td></tr>)}</tbody>
        </table>
      </div>
      <p className="note">The engine supplier cannot be separated from the chassis in this data: these are whole-car gaps grouped by engine.</p>
    </section>
  );
}

function PartPanel({ part, car, cars }: { part: PartId | null; car: CarDetail; cars?: CarListData | null }) {
  if (!part) {
    return (
      <div className="panel">
        <h2>Pick a part</h2>
        <p className="note">Click any part of the car (or use the buttons below the drawing) to see what it does and the numbers the model uses for this car.</p>
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
      <div className="tiles">
        <Tile label="Reached Q3" value={pct(car.q3_rate)} sub="of this car's entries" />
        <Tile label="Best grid slot" value={`P${car.best}`} sub={`${car.poles} pole${car.poles === 1 ? "" : "s"}`} />
      </div>
    );
  } else {
    body = (
      <div className="tiles">
        <Tile label="Gap to pole" value={`+${fmt(car.pace_gap, 2)}%`} sub="team's best lap, season average" />
        <Tile label="Pace rank" value={fmt(car.pace_rank, 1)} sub={`of ${car.teams_in_season} teams, average`} />
        <Tile label="Car push" value={signed(car.contrib_car)} sub="places vs an average car" />
      </div>
    );
  }
  return (
    <div className="panel">
      <span className="eyebrow">{car.name} {car.chassis} · {car.season}</span>
      <h2>{PART_LABEL[part]}</h2>
      <p className="note" style={{ color: "var(--ink-2)" }}>{car.parts[part]}</p>
      {body}
      <p className="note">Numbers are for the whole car. The data has no measurements of single parts.</p>
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
        <section className="panel">
          <CarSchematic era={car.era} livery={car.livery} chassis={car.chassis} selected={part} onSelect={(p) => setPart(part === p ? null : p)} />
          <div className="part-list" role="group" aria-label="Car parts">
            {PART_ORDER.map((p) => <button key={p} type="button" aria-pressed={part === p} onClick={() => setPart(part === p ? null : p)}>{PART_LABEL[p]}</button>)}
          </div>
          <p className="credit">Schematic: our own drawing from the {car.era_label.toLowerCase()} regulation dimensions, in {car.name}'s {car.season} colours. Not to scale in detail.</p>
        </section>
        <PartPanel part={part} car={car} cars={cars} />
      </div>

      <div className="tiles">
        <Tile label="Avg quali position" value={fmt(car.avg_pos)} sub={`${car.sessions} entries (2 per race)`} />
        <Tile label="Gap to pole" value={`+${fmt(car.pace_gap, 2)}%`} sub="best lap of the two cars" />
        <Tile label="Pace rank" value={fmt(car.pace_rank, 1)} sub={`average of ${car.teams_in_season} teams`} />
        <Tile label="Reached Q3" value={pct(car.q3_rate)} />
        <Tile label="Model right" value={pct(car.right / Math.max(1, car.sessions))} sub="for this car's drivers" />
      </div>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head"><h2>Pace through the season</h2><span className="note">gap to pole, % (lower is faster)</span></div>
          <RaceLine
            points={car.trend.map((t) => ({ label: `R${t.round}`, value: t.gap, tip: `R${t.round} ${t.gp}\n+${t.gap?.toFixed(3)}% to pole · pace rank ${t.rank}\nbest grid slot P${t.best_pos}` }))}
            yLabel="Gap to pole by race" fmt={(v) => `${v.toFixed(1)}%`}
          />
          <p className="note">The team's fastest qualifying lap at each race, as a percentage slower than pole. Upgrades and regressions show up here.</p>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Who drove it</h2><span className="note">average push on the prediction</span></div>
          {car.drivers.map((d) => (
            <div key={d.driver} style={{ display: "grid", gap: 8 }}>
              <Link className="cell-name" to={`/drivers/${d.driver}`}><Avatar driver={d.driver} team={car.team} size={36} /><span><b>{d.name}</b> · {d.sessions} sessions · avg P{fmt(d.avg_pos)}</span></Link>
              <ContribBars contrib={{ driver: d.contrib_driver ?? 0, car: d.contrib_car ?? 0, weekend: d.contrib_weekend ?? 0, context: d.contrib_context ?? 0 }} />
            </div>
          ))}
        </section>
      </div>

    </>
  );
}

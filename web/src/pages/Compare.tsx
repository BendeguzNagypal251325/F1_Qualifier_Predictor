import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useApi, useMeta } from "../api";
import { Car3D } from "../components/lazy3d";
import { ErrorBox, fmt, Info, Loading, pct, Swatch } from "../components/ui";
import { ERA_SPECS, PART_LABEL, PART_ORDER, partInfo, type PartId } from "../three/parts";
import { makeCameraSync } from "../three/sync";
import type { CarDetail, CarList as CarListData } from "../types";
import { engineName } from "./Cars";

// Compare up to three cars from any seasons: the whole car or one part, with cameras that move
// together. URL: /cars/compare?cars=2024.ferrari,2021.mercedes&part=floor

const MAX = 3;
interface Slot { season: number; team: string }

const parseSlots = (s: string | null): Slot[] =>
  (s ?? "").split(",").map((x) => x.split(".")).filter(([y, t]) => Number(y) && t)
    .map(([y, t]) => ({ season: Number(y), team: t })).slice(0, MAX);
const slotsParam = (slots: Slot[]) => slots.map((x) => `${x.season}.${x.team}`).join(",");

export function ComparePage() {
  const meta = useMeta();
  const [params, setParams] = useSearchParams();
  const slots = parseSlots(params.get("cars"));
  const part = (PART_ORDER as string[]).includes(params.get("part") ?? "") ? (params.get("part") as PartId) : null;
  // one camera link for the page; a new one when the set of cars changes so all start in step
  const sync = useMemo(makeCameraSync, [params.get("cars")]); // eslint-disable-line react-hooks/exhaustive-deps

  // fixed number of hooks: one detail request per possible slot
  const d0 = useApi<CarDetail>(slots[0] ? `/api/cars/${slots[0].season}/${slots[0].team}` : null);
  const d1 = useApi<CarDetail>(slots[1] ? `/api/cars/${slots[1].season}/${slots[1].team}` : null);
  const d2 = useApi<CarDetail>(slots[2] ? `/api/cars/${slots[2].season}/${slots[2].team}` : null);
  const details = [d0, d1, d2].slice(0, slots.length);

  const update = (next: Slot[], nextPart: PartId | null = part) => {
    const p: Record<string, string> = { cars: slotsParam(next) };
    if (nextPart) p.part = nextPart;
    setParams(p, { replace: true });
  };
  const setPart = (p: PartId | null) => update(slots, p);
  const add = () => update([...slots, slots[slots.length - 1] ?? { season: meta.latest, team: "" }]);

  const cars = details.map((d) => d.data).filter((c): c is CarDetail => !!c);
  const sameEra = cars.length > 1 && cars.every((c) => c.era === cars[0].era);

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow"><Link to="/cars">Cars</Link> · Compare</span>
          <h1>Compare {part ? PART_LABEL[part].toLowerCase() : "cars"}</h1>
          <p className="lede">Pick up to three cars from any season. Show the whole car or one part; the cameras move together.</p>
        </div>
      </div>

      <div className="part-list" role="group" aria-label="Part to compare">
        <button type="button" aria-pressed={part === null} onClick={() => setPart(null)}>Whole car</button>
        {PART_ORDER.map((p) => <button key={p} type="button" aria-pressed={part === p} onClick={() => setPart(part === p ? null : p)}>{PART_LABEL[p]}</button>)}
      </div>

      {sameEra && (
        <p className="body-text compare-note">
          These cars are from the same regulation era, so the 3D models have the same shape in different colours
          {cars.some((c) => c.season === 2021) && cars.some((c) => c.season !== 2021) ? " (except the 2021 floor cut)" : ""}.
          The differences are in the numbers below.
        </p>
      )}

      <div className={`compare-grid n${Math.min(MAX, slots.length + (slots.length < MAX ? 1 : 0))}`}>
        {slots.map((slot, i) => (
          <CompareSlot
            key={`${i}-${slot.season}-${slot.team}`}
            slot={slot}
            detail={details[i].data}
            error={details[i].error}
            part={part}
            sync={sync}
            onPart={(p) => setPart(part === p ? null : p)}
            onChange={(s) => update(slots.map((x, k) => (k === i ? s : x)))}
            onRemove={slots.length > 1 ? () => update(slots.filter((_, k) => k !== i)) : undefined}
          />
        ))}
        {slots.length < MAX && (
          <button type="button" className="panel compare-add" onClick={add}>
            <span aria-hidden="true">+</span> Add a car
          </button>
        )}
      </div>

      {cars.length > 0 && <CompareTable cars={cars} part={part} />}
    </>
  );
}

function CompareSlot({ slot, detail, error, part, sync, onPart, onChange, onRemove }: {
  slot: Slot;
  detail: CarDetail | null;
  error: string | null;
  part: PartId | null;
  sync: ReturnType<typeof makeCameraSync>;
  onPart: (p: PartId) => void;
  onChange: (s: Slot) => void;
  onRemove?: () => void;
}) {
  const meta = useMeta();
  const { data: list } = useApi<CarListData>(`/api/cars?season=${slot.season}`);
  const teams = list?.cars ?? [];
  // a new slot (or a season change) without a valid team picks the season's fastest car
  const team = teams.some((c) => c.team === slot.team) ? slot.team : teams[0]?.team;
  useEffect(() => {
    if (list && team && team !== slot.team) onChange({ season: slot.season, team });
  }, [list, team, slot.team]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="panel compare-slot">
      <div className="compare-pick">
        <label>Season
          <select value={slot.season} onChange={(e) => onChange({ season: Number(e.target.value), team: slot.team })}>
            {meta.seasons.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label>Team
          <select value={team ?? ""} onChange={(e) => onChange({ season: slot.season, team: e.target.value })}>
            {teams.map((c) => <option key={c.team} value={c.team}>{c.name}</option>)}
          </select>
        </label>
        {onRemove && <button type="button" className="btn ghost small" onClick={onRemove} aria-label="Remove this car">Remove</button>}
      </div>
      {error && <ErrorBox error={error} />}
      {!detail ? <Loading height={220} /> : (
        <>
          <Car3D era={detail.era} livery={detail.livery} season={detail.season} selected={part} onSelect={onPart} sync={sync}
            label={`${detail.name} ${detail.chassis ?? ""} ${detail.season}`} />
          <h3 className="compare-title"><Swatch team={detail.team} /> <Link to={`/cars/${detail.season}/${detail.team}`}>{detail.name} {detail.chassis}</Link> · {detail.season}</h3>
        </>
      )}
    </section>
  );
}

function CompareTable({ cars, part }: { cars: CarDetail[]; part: PartId | null }) {
  const spec = (c: CarDetail) => ERA_SPECS[c.era];
  const best = (vals: (number | null | undefined)[], lowIsBest = true) => {
    const ok = vals.filter((v): v is number => v != null);
    if (ok.length < 2) return null;
    return lowIsBest ? Math.min(...ok) : Math.max(...ok);
  };
  const numRow = (label: string, get: (c: CarDetail) => number | null | undefined, show: (v: number) => string, lowIsBest = true) => {
    const vals = cars.map(get), b = best(vals, lowIsBest);
    return (
      <tr key={label}>
        <th scope="row">{label}</th>
        {vals.map((v, i) => <td key={i} className={`num${v != null && v === b ? " best" : ""}`}>{v == null ? "–" : show(v)}</td>)}
      </tr>
    );
  };
  const textRow = (label: string, get: (c: CarDetail) => string) => (
    <tr key={label}><th scope="row">{label}</th>{cars.map((c, i) => <td key={i}>{get(c)}</td>)}</tr>
  );
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Side by side<Info>Rules are the public FIA figures per era. Numbers are for the whole car in that season: the data has no measurements of single parts. The best value in a row is marked.</Info></h2>
      </div>
      <div className="scroll">
        <table className="wrap compare-table">
          <thead><tr><th />{cars.map((c, i) => <th key={i}><Swatch team={c.team} /> {c.name} {c.season}</th>)}</tr></thead>
          <tbody>
            {part && textRow(PART_LABEL[part], (c) => {
              const info = partInfo(part, c.era, c.season);
              return [info.rules, info.note].filter(Boolean).join(" ");
            })}
            {textRow("Era", (c) => c.era_label)}
            {textRow("Width", (c) => spec(c)?.width ?? "–")}
            {textRow("Wheelbase", (c) => spec(c)?.wheelbase ?? "–")}
            {textRow("Minimum weight", (c) => spec(c)?.weight ?? "–")}
            {textRow("Wheels", (c) => spec(c)?.wheels ?? "–")}
            {textRow("Power unit", (c) => engineName(c.engine))}
            {numRow("Gap to pole", (c) => c.pace_gap, (v) => `+${v.toFixed(2)}%`)}
            {numRow("Pace rank", (c) => c.pace_rank, (v) => fmt(v, 1))}
            {numRow("Avg qualifying", (c) => c.avg_pos, (v) => `P${fmt(v)}`)}
            {numRow("Reached Q3", (c) => c.q3_rate, (v) => pct(v), false)}
            {numRow("Poles", (c) => c.poles, (v) => String(v), false)}
          </tbody>
        </table>
      </div>
    </section>
  );
}

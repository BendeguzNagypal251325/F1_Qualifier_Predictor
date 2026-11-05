import { useEffect, useState } from "react";
import { useApi, useMeta } from "../api";
import type { LivePrediction, SnapshotRace } from "../types";
import { Avatar, Info } from "./ui";

// "Your pick vs the model": a for-fun game on the Live page. Before qualifying the visitor puts a driver
// in each position from P1 to P10 and locks them in; after qualifying the order is scored against the
// real result, and so is the model's frozen top ten. Everything stays in this browser (localStorage).

type Slots = (string | null)[];
interface Saved { slots: Slots; locked: boolean }
interface Tally { [raceKey: string]: { you: number; model: number } }

const N = 10;
const EMPTY: Saved = { slots: Array(N).fill(null), locked: false };
const pickKey = (race: string) => `gridcast-order-${race}`;
const tallyKey = (season: number) => `gridcast-order-tally-${season}`;

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: picks last for this page only */
  }
}

const surname = (name: string) => name.split(" ").slice(-1)[0];

/** 1 point for a driver who reaches Q3, 2 more for the exact position. */
export function orderPoints(order: Slots, actual: Map<string, number>) {
  let q3 = 0, exact = 0;
  order.forEach((d, i) => {
    const pos = d ? actual.get(d) : undefined;
    if (pos != null && pos <= N) q3++;
    if (pos === i + 1) exact++;
  });
  return { q3, exact, points: q3 + 2 * exact };
}

export function YourPicks({ p }: { p: LivePrediction }) {
  const meta = useMeta();
  const [saved, setSaved] = useState<Saved>(() => load(pickKey(p.race_key), EMPTY));
  const [active, setActive] = useState(0);
  useEffect(() => { setSaved(load(pickKey(p.race_key), EMPTY)); setActive(0); }, [p.race_key]);
  const started = p.qualifying_done || (p.qualifying_start != null && Date.now() >= Date.parse(p.qualifying_start));
  const locked = saved.locked || started;
  const filled = saved.slots.filter(Boolean).length;

  // the model's top ten as frozen before qualifying (Track record), or the live prediction if none was saved
  const frozen = useApi<SnapshotRace>(p.qualifying_done ? `/api/snapshots/${p.race_key}` : null);
  const last = frozen.data?.snapshots[frozen.data.snapshots.length - 1];
  const modelOrder: Slots = Array.from({ length: N }, (_, i) => (last ? last.rows : p.rows).find((r) => r.pred_pos === i + 1)?.driver_id ?? null);

  const update = (slots: Slots, lock = false) => {
    const next = { slots, locked: lock };
    setSaved(next);
    save(pickKey(p.race_key), next);
    const free = slots.findIndex((d) => !d);
    setActive(free < 0 ? active : free);
  };
  /** Tap a driver: into the selected position (replacing whoever was there), or out again if already placed. */
  const pick = (id: string) => {
    if (locked) return;
    const slots = [...saved.slots];
    const at = slots.indexOf(id);
    if (at >= 0) { slots[at] = null; update(slots); setActive(at); return; }
    slots[active] = id;
    update(slots);
  };

  const name = (id: string) => meta.drivers.find((d) => d.id === id)?.name ?? id;
  const drivers = [...p.rows].sort((a, b) => surname(name(a.driver_id)).localeCompare(surname(name(b.driver_id))));
  const actual = new Map(p.rows.filter((r) => r.quali_pos != null).map((r) => [r.driver_id, r.quali_pos as number]));
  const scored = p.qualifying_done && actual.size > 0 && filled === N && !frozen.loading;
  const you = orderPoints(saved.slots, actual);
  const model = orderPoints(modelOrder, actual);

  // remember the score for the season tally once the result is in
  const [tally, setTally] = useState<Tally>(() => load(tallyKey(p.season), {}));
  useEffect(() => {
    if (!scored) return;
    const t = load<Tally>(tallyKey(p.season), {});
    if (t[p.race_key]?.you === you.points && t[p.race_key]?.model === model.points) return;
    t[p.race_key] = { you: you.points, model: model.points };
    save(tallyKey(p.season), t);
    setTally(t);
  }, [scored, you.points, model.points, p.race_key, p.season]);
  const races = Object.values(tally);
  const sum = (k: "you" | "model") => races.reduce((a, r) => a + r[k], 0);

  if (started && filled < N && !races.length) return null; // never played: nothing to show once qualifying has started

  return (
    <section className="panel picks reveal">
      <div className="panel-head">
        <h2>Your pick vs the model <span className="fun">for fun</span>
          <Info>Put a driver in each position from P1 to P10. 1 point for each driver who reaches Q3, 2 more for the exact position (30 max). Picks close when qualifying starts. Saved only in this browser.</Info>
        </h2>
        {races.length > 0 && (
          <span className="picks-tally mono">Season: you {sum("you")} · model {sum("model")} pts over {races.length} race{races.length > 1 ? "s" : ""}</span>
        )}
      </div>
      {scored ? (
        <div className="facts picks-result">
          <div><b className="mono">{you.points}<small> pts</small></b><span>you: {you.q3} in Q3, {you.exact} exact</span></div>
          <div><b className="mono">{model.points}<small> pts</small></b><span>model: {model.q3} in Q3, {model.exact} exact</span></div>
          <p className="body-text">{you.points > model.points ? "You beat the model this weekend." : you.points === model.points ? "A draw with the model." : "The model wins this one."}</p>
        </div>
      ) : (
        <div className="picks-head">
          <b className="mono">{filled} / {N}</b>
          {locked
            ? <span>{started ? "Qualifying has started; your order is locked." : "Locked in. Scored once qualifying is over."}</span>
            : <>
                <button type="button" className="btn small" disabled={filled !== N} onClick={() => update(saved.slots, true)}>Lock in</button>
                {filled < N && <span>Tap a driver for P{active + 1}</span>}
                {filled > 0 && <button type="button" className="btn ghost small" onClick={() => { update(Array(N).fill(null)); setActive(0); }}>Clear</button>}
              </>}
        </div>
      )}
      <ol className="slot-grid" aria-label="Your top ten">
        {saved.slots.map((d, i) => {
          const pos = scored && d ? actual.get(d) : undefined;
          const res = pos == null ? "" : pos === i + 1 ? " exact" : pos <= N ? " in" : " out";
          return (
            <li key={i}>
              <button type="button" className={`slot${!locked && i === active ? " active" : ""}${d ? "" : " empty"}${res}`} disabled={locked}
                onClick={() => (d && i === active ? pick(d) : setActive(i))} aria-label={`P${i + 1}: ${d ? name(d) : "empty"}`}>
                <span className="slot-pos mono">P{i + 1}</span>
                {d ? <><Avatar driver={d} team={p.rows.find((r) => r.driver_id === d)?.constructor_id ?? ""} size={22} /><span className="slot-name">{surname(name(d))}</span></> : <span className="slot-name">–</span>}
                {pos != null && <span className="slot-res mono">{pos === i + 1 ? "✓" : `P${pos}`}</span>}
              </button>
            </li>
          );
        })}
      </ol>
      {!locked && (
        <div className="pick-grid" role="group" aria-label={`Driver for P${active + 1}`}>
          {drivers.map((r) => {
            const at = saved.slots.indexOf(r.driver_id);
            return (
              <button key={r.driver_id} type="button" className="pick" aria-pressed={at >= 0} onClick={() => pick(r.driver_id)}>
                <Avatar driver={r.driver_id} team={r.constructor_id} size={22} />
                <span>{surname(name(r.driver_id))}</span>
                {at >= 0 && <span className="pick-pos mono">P{at + 1}</span>}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

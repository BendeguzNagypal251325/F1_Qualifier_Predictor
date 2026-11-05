import { useEffect, useState } from "react";
import { useApi, useMeta } from "../api";
import type { LivePrediction, SnapshotRace } from "../types";
import { Avatar, Info } from "./ui";

// "Your pick vs the model": a for-fun game on the Live page. Before qualifying the visitor taps the ten
// drivers they think reach Q3 and locks them in; after qualifying their picks are scored against the
// model's frozen picks and the real result. Everything stays in this browser (localStorage).

interface Saved { picks: string[]; locked: boolean }
interface Tally { [raceKey: string]: { you: number; model: number } }

const pickKey = (race: string) => `gridcast-picks-${race}`;
const tallyKey = (season: number) => `gridcast-picks-tally-${season}`;

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

export function YourPicks({ p }: { p: LivePrediction }) {
  const meta = useMeta();
  const [saved, setSaved] = useState<Saved>(() => load(pickKey(p.race_key), { picks: [], locked: false }));
  useEffect(() => setSaved(load(pickKey(p.race_key), { picks: [], locked: false })), [p.race_key]);
  const started = p.qualifying_done || (p.qualifying_start != null && Date.now() >= Date.parse(p.qualifying_start));
  const locked = saved.locked || started;
  // the model's picks as frozen before qualifying (Track record), or the live prediction if none was saved
  const frozen = useApi<SnapshotRace>(p.qualifying_done ? `/api/snapshots/${p.race_key}` : null);
  const last = frozen.data?.snapshots[frozen.data.snapshots.length - 1];
  const modelPicks = (last ? last.rows : p.rows).filter((r) => r.pred_pos <= 10).map((r) => r.driver_id);

  const update = (next: Saved) => { setSaved(next); save(pickKey(p.race_key), next); };
  const toggle = (id: string) => {
    if (locked) return;
    const has = saved.picks.includes(id);
    if (!has && saved.picks.length >= 10) return;
    update({ ...saved, picks: has ? saved.picks.filter((x) => x !== id) : [...saved.picks, id] });
  };

  const name = (id: string) => meta.drivers.find((d) => d.id === id)?.name ?? id;
  const drivers = [...p.rows].sort((a, b) => surname(name(a.driver_id)).localeCompare(surname(name(b.driver_id))));
  const actual = new Set(p.rows.filter((r) => r.quali_pos != null && r.quali_pos <= 10).map((r) => r.driver_id));
  const scored = p.qualifying_done && actual.size === 10 && saved.picks.length === 10 && !frozen.loading;
  const you = saved.picks.filter((d) => actual.has(d)).length;
  const model = modelPicks.filter((d) => actual.has(d)).length;

  // remember the score for the season tally once the result is in
  const [tally, setTally] = useState<Tally>(() => load(tallyKey(p.season), {}));
  useEffect(() => {
    if (!scored) return;
    const t = load<Tally>(tallyKey(p.season), {});
    if (t[p.race_key]?.you === you && t[p.race_key]?.model === model) return;
    t[p.race_key] = { you, model };
    save(tallyKey(p.season), t);
    setTally(t);
  }, [scored, you, model, p.race_key, p.season]);
  const races = Object.values(tally);
  const sum = (k: "you" | "model") => races.reduce((a, r) => a + r[k], 0);

  if (started && saved.picks.length < 10 && !races.length) return null; // never played: nothing to show once qualifying has started

  return (
    <section className="panel picks reveal">
      <div className="panel-head">
        <h2>Your pick vs the model <span className="fun">for fun</span>
          <Info>Pick ten drivers for Q3. Picks close when qualifying starts and are scored against the result and the model. Saved only in this browser.</Info>
        </h2>
        {races.length > 0 && (
          <span className="picks-tally mono">Season: you {sum("you")} · model {sum("model")} over {races.length} race{races.length > 1 ? "s" : ""}</span>
        )}
      </div>
      {scored ? (
        <div className="facts picks-result">
          <div><b className="mono">{you}<small> / 10</small></b><span>your picks in Q3</span></div>
          <div><b className="mono">{model}<small> / 10</small></b><span>the model's</span></div>
          <p className="body-text">{you > model ? "You beat the model this weekend." : you === model ? "A draw with the model." : "The model wins this one."}</p>
        </div>
      ) : (
        <div className="picks-head">
          <b className="mono">{saved.picks.length} / 10</b>
          {locked
            ? <span>{started ? "Qualifying has started; your picks are locked." : "Locked in. Scored once qualifying is over."}</span>
            : <>
                <button type="button" className="btn small" disabled={saved.picks.length !== 10} onClick={() => update({ ...saved, locked: true })}>Lock in</button>
                {saved.picks.length > 0 && <button type="button" className="btn ghost small" onClick={() => update({ picks: [], locked: false })}>Clear</button>}
              </>}
        </div>
      )}
      {(!started || saved.picks.length === 10) && (
        <div className="pick-grid" role="group" aria-label="Drivers">
          {drivers.map((r) => {
            const on = saved.picks.includes(r.driver_id);
            const hit = scored && on ? actual.has(r.driver_id) : null;
            return (
              <button key={r.driver_id} type="button" className={`pick${hit === true ? " hit" : hit === false ? " miss" : ""}`} aria-pressed={on}
                disabled={locked || (!on && saved.picks.length >= 10)} onClick={() => toggle(r.driver_id)}>
                <Avatar driver={r.driver_id} team={r.constructor_id} size={22} />
                <span>{surname(name(r.driver_id))}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

import { Link, useSearchParams } from "react-router-dom";
import { useApi, useMeta } from "../api";
import { Avatar, ChanceLegend, ErrorBox, Info, Loading, PosChip, Q3Chance, Tile, TrackOutline } from "../components/ui";
import type { SnapshotRace, SnapshotSummary } from "../types";

// Frozen live predictions: saved automatically after each practice session, before qualifying starts,
// and never changed afterwards. Kept apart from the backtest numbers on the other pages.

const LABEL: Record<string, string> = { fp1: "FP1", fp2: "FP2", fp3: "FP3" };
const utc = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";

export default function TrackRecord() {
  const { data, error } = useApi<SnapshotSummary>("/api/snapshots");
  const [params, setParams] = useSearchParams();
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading height={360} />;
  const sel = params.get("race") ?? data.races[data.races.length - 1]?.race_key ?? null;
  const t = data.totals;
  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Track record · {data.season}</span>
          <h1>Frozen live predictions</h1>
          <p className="lede">
            Each weekend the live prediction is saved after FP1, FP2 and FP3, before qualifying starts, and never changed
            afterwards. These are the real forecasts, separate from the backtest on the other pages.
            <Info label="How predictions are frozen">Each file gets a UTC timestamp and is written once: an existing file is never replaced, and nothing is saved once OpenF1's qualifying start time has passed. Files live in data/live/snapshots on the server.</Info>
          </p>
        </div>
      </div>
      {!data.races.length ? (
        <section className="panel">
          <h2>No frozen predictions yet</h2>
          <p className="body-text">
            They are saved automatically while the app runs with live updates on: after FP1, FP2 and FP3 of each {data.season} weekend,
            and only before qualifying starts. Until then, the <Link className="link" to="/sessions">backtest on the Sessions page</Link> shows
            how the model did on past races.
          </p>
        </section>
      ) : (
        <>
          <div className="tiles stagger">
            <Tile label="Weekends frozen" value={t.races} sub={`${data.season} season`} />
            <Tile label="Scored" value={t.scored} sub={t.races > t.scored ? `${t.races - t.scored} waiting for qualifying` : "all results in"} />
            <Tile label="Correct picks" value={t.correct_per_10 != null ? <>{t.correct_per_10.toFixed(2)}<small> / 10</small></> : "–"} sub="last frozen prediction before qualifying" />
          </div>
          <section className="panel">
            <h2>Every frozen weekend</h2>
            <div className="scroll">
              <table>
                <thead><tr><th>Race</th><th>Frozen after</th><th className="num">Correct</th></tr></thead>
                <tbody>
                  {[...data.races].reverse().map((r) => (
                    <tr key={r.race_key} className={r.race_key === sel ? "sel-row" : ""}>
                      <td><button type="button" className="link-btn" onClick={() => setParams({ race: r.race_key }, { replace: true })}><TrackOutline circuit={r.circuit} size={22} stroke={3} /> R{r.round} {r.gp}</button></td>
                      <td>
                        <div className="frozen-list">
                          {r.sessions.map((s) => <span key={s.session} className="chip q3" data-tip={`Frozen ${utc(s.created_at)}`}>{LABEL[s.session]}</span>)}
                        </div>
                      </td>
                      <td className="num">{r.correct != null ? `${r.correct} / 10` : "after qualifying"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          {sel && <RaceMoves raceKey={sel} />}
        </>
      )}
    </>
  );
}

/** How the frozen prediction moved from FP1 to FP3, next to the real result. */
function RaceMoves({ raceKey }: { raceKey: string }) {
  const meta = useMeta();
  const { data, error } = useApi<SnapshotRace>(`/api/snapshots/${raceKey}`);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading height={300} />;
  const name = (id: string) => meta.drivers.find((d) => d.id === id)?.name ?? id;
  const snaps = data.snapshots;
  const last = snaps[snaps.length - 1];
  const at = (i: number, d: string) => snaps[i].rows.find((r) => r.driver_id === d);
  const order = [...last.rows].sort((a, b) => (data.result ? (data.result[a.driver_id] ?? 99) - (data.result[b.driver_id] ?? 99) : a.pred_pos - b.pred_pos));
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{data.season} {data.gp}: how the prediction moved <Info>Predicted grid position after each practice session, as it was frozen. The arrow compares with the previous session. Sorted by the real result once qualifying is done.</Info></h2>
        <ChanceLegend />
      </div>
      <div className="scroll">
        <table className="moves">
          <thead>
            <tr>
              <th>Driver</th>
              {snaps.map((s) => <th key={s.session} className="num" data-tip={`Frozen ${utc(s.created_at)}`}>{LABEL[s.session]}{s.score && <span className="score"> {s.score.correct}/10</span>}</th>)}
              <th className="num">Q3 chance</th>
              {data.result && <th className="num">Actual</th>}
            </tr>
          </thead>
          <tbody>
            {order.map((r) => (
              <tr key={r.driver_id}>
                <td><Link className="cell-name" to={`/drivers/${r.driver_id}`}><Avatar driver={r.driver_id} team={r.constructor_id ?? ""} size={26} /><span>{name(r.driver_id)}</span></Link></td>
                {snaps.map((s, i) => {
                  const cur = at(i, r.driver_id), prev = i > 0 ? at(i - 1, r.driver_id) : undefined;
                  const move = cur && prev ? prev.pred_pos - cur.pred_pos : 0;
                  return (
                    <td key={s.session} className="num">
                      {cur ? <>P{cur.pred_pos}{move !== 0 && <span className={move > 0 ? "up" : "down"}> {move > 0 ? "▲" : "▼"}{Math.abs(move)}</span>}</> : "–"}
                    </td>
                  );
                })}
                <td className="num"><Q3Chance p={r.q3_prob} /></td>
                {data.result && <td className="num">{data.result[r.driver_id] ? <PosChip pos={data.result[r.driver_id]} miss={(r.pred_pos <= 10) !== (data.result[r.driver_id] <= 10)} /> : "–"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

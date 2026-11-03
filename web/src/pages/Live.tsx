import { Link } from "react-router-dom";
import { useApi, useMeta } from "../api";
import { Avatar, ContribStack, ErrorBox, GroupLegend, Loading, PosChip, Swatch, Tile, TrackOutline } from "../components/ui";
import type { Live } from "../types";

const SESSIONS = ["Practice 1", "Practice 2", "Practice 3", "Qualifying"];

export default function LivePage() {
  const meta = useMeta();
  const { data, error } = useApi<Live>("/api/live", 60_000);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading height={400} />;
  const { status, prediction: p } = data;
  const name = (id: string) => meta.drivers.find((d) => d.id === id)?.name ?? id;
  const team = (id: string) => meta.teams.find((t) => t.id === id)?.name ?? id;
  const circuit = p ? meta.circuits.find((c) => c.id === p.circuit) : undefined;

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Live weekend <span className={`badge${status.enabled ? " live" : ""}`}>{status.enabled ? "auto-updating" : "updates off"}</span></span>
          <h1>{p ? `${p.season} ${p.grand_prix.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} Grand Prix` : "Next qualifying"}</h1>
          <p className="lede">The prediction is rebuilt after every finished session of the weekend: before FP1 from form and standings only, then with each practice result. After qualifying it shows the real result and the race is added to the training data.</p>
        </div>
        {circuit && <TrackOutline circuit={circuit.id} size={96} stroke={5} />}
      </div>

      {!p && (
        <div className="panel empty-state">
          <h2>No live prediction yet</h2>
          <p className="note">
            {status.error
              ? <>The last refresh failed: <span className="mono">{status.error}</span>. The server keeps retrying every {Math.round(status.interval_s / 60)} minutes.</>
              : status.enabled
                ? "The server is fetching this weekend's sessions from OpenF1. This page refreshes every minute."
                : "Live updates are switched off on this server (F1QP_LIVE_INTERVAL=0)."}
          </p>
          <Link to="/sessions" className="btn ghost">Browse past sessions instead</Link>
        </div>
      )}

      {p && (
        <>
          <div className="tiles stagger">
            <Tile label="Sessions used" value={`${p.sessions_used.length} / 4`} sub={SESSIONS.map((s) => (p.sessions_used.includes(s) ? "●" : "○") + " " + s.replace("Practice ", "FP")).join("  ")} />
            <Tile label="Model" value={p.model.startsWith("full") ? "With practice" : "Pre-weekend"} small sub={p.model} />
            {p.qualifying_done
              ? <Tile label="Result" value={<>{p.correct}<small> / 10</small></>} sub={`correct Q3 picks · ${p.mae} places off on average`} />
              : <Tile label="Qualifying" value="Not run yet" small sub={`race weekend of ${p.date}`} />}
            <Tile label="Last refresh" value={status.last_run ? new Date(status.last_run).toLocaleTimeString() : "–"} small sub={status.error ? `error: ${status.error}` : `every ${Math.round(status.interval_s / 60)} min`} />
          </div>
          <section className="panel">
            <div className="panel-head"><h2>Predicted qualifying order</h2><GroupLegend /></div>
            <div className="scroll">
              <table>
                <thead><tr><th className="num">Pred</th><th>Driver</th><th>Team</th><th className="num">Practice</th><th>Why (gain vs an average entry)</th><th className="num">Model</th>{p.qualifying_done && <th className="num">Actual</th>}</tr></thead>
                <tbody>
                  {p.rows.map((r) => (
                    <tr key={r.driver_id} className={r.pred_pos === 10 ? "cut" : ""}>
                      <td className="num">{r.pred_pos}</td>
                      <td><Link className="cell-name" to={`/drivers/${r.driver_id}`}><Avatar driver={r.driver_id} team={r.constructor_id} size={30} /><span>{name(r.driver_id)}</span></Link></td>
                      <td><Swatch team={r.constructor_id} /> {team(r.constructor_id)}</td>
                      <td className="num">{r.fp_last_pos ? `P${r.fp_last_pos}` : "–"}</td>
                      <td style={{ minWidth: 160 }}><ContribStack contrib={r.contrib} /></td>
                      <td className="num">{r.score.toFixed(1)}</td>
                      {p.qualifying_done && <td className="num">{r.quali_pos && <PosChip pos={r.quali_pos} miss={(r.pred_pos <= 10) !== (r.quali_pos <= 10)} />}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note">Data: OpenF1 (results of finished sessions) and F1DB (history). The dashed line is the predicted Q3 cut.</p>
          </section>
        </>
      )}
    </>
  );
}

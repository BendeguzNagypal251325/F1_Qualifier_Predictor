import { Link } from "react-router-dom";
import { useApi, useMeta } from "../api";
import { PredictionTable } from "../components/PredictionTable";
import { YourPicks } from "../components/YourPicks";
import { Avatar, ChanceLegend, ContribStack, ErrorBox, GroupLegend, Info, Loading, PosChip, Q3Chance, Q3ChanceHead, Swatch, Tile, TrackOutline } from "../components/ui";
import type { Live, SessionDetail, SessionSummary } from "../types";

const SESSIONS = ["Practice 1", "Practice 2", "Practice 3", "Qualifying"];
const titleCase = (s: string) => s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function LivePage() {
  const meta = useMeta();
  const { data, error } = useApi<Live>("/api/live", 60_000);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading height={400} />;
  const { status, prediction: p } = data;
  const name = (id: string) => meta.drivers.find((d) => d.id === id)?.name ?? id;
  const team = (id: string) => meta.teams.find((t) => t.id === id)?.name ?? id;
  const circuit = p ? meta.circuits.find((c) => c.id === p.circuit) : undefined;
  const state = !status.enabled ? "off" : status.error_code === "season_over" ? "over" : status.error ? "error" : p ? "live" : "waiting";
  const [lo, hi] = p?.close_call ?? [0.3, 0.7];
  const close = p ? p.rows.filter((r) => r.q3_prob != null && r.q3_prob >= lo && r.q3_prob < hi) : [];

  return (
    <>
      <div className="page-head reveal">
        <div>
          <span className="eyebrow"><span className={`live-dot${state === "live" ? " on" : ""}`} aria-hidden /> Live weekend</span>
          <h1>{p ? `${p.season} ${titleCase(p.grand_prix)} Grand Prix` : "Live weekend"}
            <Info>Rebuilt after every session. After qualifying, the real result appears next to it.</Info>
          </h1>
        </div>
        {circuit && <TrackOutline circuit={circuit.id} size={96} stroke={5} />}
      </div>

      <div className={`status-bar ${state}`} role="status">
        <b>{state === "live" ? "Live" : state === "error" ? "Live data unavailable" : state === "off" ? "Live updates off" : state === "over" ? "No live weekend" : "Waiting for the next session"}</b>
        <span>
          {state === "error" && status.error}
          {state === "over" && `The ${meta.latest} season is over. Showing the last weekend.`}
          {state === "off" && "Live timing is off on this server. Showing the last weekend."}
          {state === "waiting" && "Checking OpenF1 for this weekend's sessions."}
          {state === "live" && p && `${p.sessions_used.length} of 4 sessions in · ${p.model.startsWith("full") ? "using practice" : "pre-weekend model"}`}
        </span>
        {status.last_run && <span className="mono">updated {new Date(status.last_run).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
      </div>

      {p ? (
        <>
          <div className="tiles stagger">
            <Tile label="Sessions in" value={`${p.sessions_used.length} / 4`} sub={SESSIONS.map((s) => (p.sessions_used.includes(s) ? "●" : "○") + " " + s.replace("Practice ", "FP")).join("  ")} />
            {p.qualifying_done
              ? <Tile label="Result" value={null} countUp={p.correct ?? 0} decimals={0} suffix=" / 10" sub={`${p.mae} places off on average`} />
              : <Tile label="Qualifying" value="Not run yet" small sub={p.date} />}
            {close.length > 0 && <Tile label="Too close to call" value={close.length} sub={close.map((r) => name(r.driver_id).split(" ").slice(-1)[0]).join(", ")} />}
          </div>
          <YourPicks p={p} />
          <section className="panel reveal">
            <div className="panel-head"><h2>Predicted qualifying order <Info>The dashed line is the predicted Q3 cut. “Why” shows how much the driver, the car and practice moved each prediction.</Info></h2><div className="legends"><ChanceLegend /><GroupLegend /></div></div>
            <div className="scroll">
              <table>
                <thead><tr><th className="num">Pred</th><th>Driver</th><Q3ChanceHead /><th>Team</th><th className="num">Practice</th><th>Why</th><th className="num">Model</th>{p.qualifying_done && <th className="num">Actual</th>}</tr></thead>
                <tbody>
                  {p.rows.map((r) => (
                    <tr key={r.driver_id} className={r.pred_pos === 10 ? "cut" : ""}>
                      <td className="num">{r.pred_pos}</td>
                      <td><Link className="cell-name" to={`/drivers/${r.driver_id}`}><Avatar driver={r.driver_id} team={r.constructor_id} size={30} /><span>{name(r.driver_id)}</span></Link></td>
                      <td className="num"><Q3Chance p={r.q3_prob} band={p.close_call} /></td>
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
          </section>
        </>
      ) : <LatestWeekend />}
    </>
  );
}

/** When there is no live prediction, show the most recent completed weekend instead of an empty page. */
function LatestWeekend() {
  const meta = useMeta();
  const list = useApi<SessionSummary[]>(`/api/sessions?season=${meta.latest}`);
  const last = list.data?.[list.data.length - 1];
  const s = useApi<SessionDetail>(last ? `/api/sessions/${last.race_key}` : null);
  if (list.error || s.error) return <ErrorBox error={(list.error || s.error)!} />;
  if (list.data && !last) {
    return (
      <section className="panel">
        <h2>No {meta.latest} weekend yet</h2>
        <p className="body-text">Predictions appear here once the first practice session of {meta.latest} is in. Past seasons are on the <Link className="link" to="/sessions">Sessions page</Link>.</p>
      </section>
    );
  }
  if (!s.data) return <Loading height={420} />;
  const d = s.data;
  return (
    <>
      <div className="tiles stagger">
        <Tile label="Latest weekend" value={`${d.gp}`} small sub={`${d.season} · round ${d.round} · ${d.date}`} />
        <Tile label="Correct picks" value={null} countUp={d.correct} decimals={0} suffix=" / 10" />
        <Tile label="Places off" value={null} countUp={d.mae} sub="average, all drivers" />
      </div>
      <section className="panel reveal">
        <div className="panel-head">
          <h2>{d.season} {d.gp}: prediction vs result <Info>Shown until the next weekend's first session is in. The dashed line is the predicted Q3 cut.</Info></h2>
          <Link to={`/sessions/${d.race_key}`} className="btn ghost">Open session</Link>
        </div>
        <PredictionTable s={d} />
      </section>
    </>
  );
}

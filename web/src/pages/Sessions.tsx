import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useApi, useMeta } from "../api";
import { Avatar, ContribStack, ErrorBox, GroupLegend, Loading, PosChip, Swatch, Tile, TrackOutline } from "../components/ui";
import type { SessionDetail, SessionSummary } from "../types";

export default function Sessions() {
  const meta = useMeta();
  const nav = useNavigate();
  const all = useApi<SessionSummary[]>("/api/sessions");
  const { key } = useParams();
  const [params] = useSearchParams();
  const wantSeason = Number(params.get("season")) || null;
  const wantCorrect = params.get("correct") != null ? Number(params.get("correct")) : null;
  const pool = all.data?.filter((x) => (!wantSeason || x.season === wantSeason) && (wantCorrect == null || x.correct === wantCorrect));
  const current = key ?? pool?.[pool.length - 1]?.race_key ?? all.data?.[all.data.length - 1]?.race_key ?? null;
  const detail = useApi<SessionDetail>(current ? `/api/sessions/${current}` : null);
  const s = detail.data;
  const season = s?.season ?? meta.latest;
  const inSeason = all.data?.filter((x) => x.season === season) ?? [];
  const name = (id: string) => meta.drivers.find((d) => d.id === id)?.name ?? id;
  const tname = (id: string) => meta.teams.find((t) => t.id === id)?.name ?? id;
  const avg = inSeason.length ? inSeason.reduce((a, x) => a + x.correct, 0) / inSeason.length : null;

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Sessions</span>
          <h1>{s ? `${s.season} ${s.gp} Grand Prix` : "Qualifying sessions"}</h1>
          <div className="controls">
            <label htmlFor="ss-season">Season
              <select id="ss-season" value={season} onChange={(e) => { const f = all.data?.find((x) => x.season === Number(e.target.value)); if (f) nav(`/sessions/${f.race_key}`); }}>
                {meta.seasons.map((y) => <option key={y}>{y}</option>)}
              </select>
            </label>
            <label htmlFor="ss-race">Grand Prix
              <select id="ss-race" value={current ?? ""} onChange={(e) => nav(`/sessions/${e.target.value}`)}>
                {inSeason.map((x) => <option key={x.race_key} value={x.race_key}>R{x.round} · {x.gp}</option>)}
              </select>
            </label>
          </div>
        </div>
        {s && <Link to={`/tracks/${s.circuit}`}><TrackOutline circuit={s.circuit} size={96} stroke={5} /></Link>}
      </div>
      {all.data && (
        <section className="panel reveal">
          <div className="panel-head">
            <h2>{wantCorrect != null ? `Every session with ${wantCorrect}/10 correct` : `${season} at a glance`}</h2>
            <span className="note">{wantCorrect != null ? <Link to="/sessions">show all</Link> : "correct picks per race · click to open"}</span>
          </div>
          <div className="season-strip-lg">
            {(wantCorrect != null ? pool ?? [] : inSeason).map((x) => (
              <Link key={x.race_key} to={`/sessions/${x.race_key}`} className={`sess${x.race_key === current ? " on" : ""}`}
                style={{ ["--k" as string]: String((x.correct - 4) / 6) }} data-tip={`${x.season} R${x.round} ${x.gp}\n${x.correct}/10 correct`}>
                <span className="mono">{x.correct}</span><small>{wantCorrect != null ? `${String(x.season).slice(2)} R${x.round}` : `R${x.round}`}</small>
              </Link>
            ))}
          </div>
        </section>
      )}
      {(all.error || detail.error) && <ErrorBox error={(all.error || detail.error)!} />}
      {!s ? <Loading height={480} /> : (
        <>
          <div className="tiles stagger">
            <Tile label="Correct picks" value={<>{s.correct}<small> / 10</small></>} sub={avg != null ? `season average ${avg.toFixed(2)}` : undefined} />
            <Tile label="Places off" value={s.mae.toFixed(2)} sub="average, all drivers" />
            <Tile label="Weekend" value={s.date} small sub={s.sprint ? "sprint weekend (one practice)" : "standard weekend"} />
          </div>
          <section className="panel">
            <div className="panel-head"><h2>Predicted order vs result</h2><GroupLegend /></div>
            <div className="scroll">
              <table>
                <thead><tr><th className="num">Pred</th><th>Driver</th><th>Team</th><th className="num">Practice</th><th>Why</th><th className="num">Model</th><th className="num">Actual</th><th>Call</th></tr></thead>
                <tbody>
                  {s.rows.map((r) => (
                    <tr key={r.driver} className={r.pred_rank === 10 ? "cut" : ""}>
                      <td className="num">{r.pred_rank}</td>
                      <td><Link className="cell-name" to={`/drivers/${r.driver}`}><Avatar driver={r.driver} team={r.team} size={30} /><span>{name(r.driver)}</span></Link></td>
                      <td><Link to={`/cars/${s.season}/${r.team}`}><Swatch team={r.team} /> {tname(r.team)}</Link></td>
                      <td className="num">{r.fp_last_pos ? `P${r.fp_last_pos}` : "–"}</td>
                      <td style={{ minWidth: 150 }}><ContribStack contrib={r.contrib} /></td>
                      <td className="num">{r.pred.toFixed(1)}</td>
                      <td className="num"><PosChip pos={r.pos} status={r.status} /></td>
                      <td>{r.right ? <span className="ok">✓ right</span> : <span className="no">✗ {r.picked ? "missed Q3" : "surprise Q3"}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note">“Why” shows how far each group moved the driver: solid segments moved them forward, faded ones backward. The dashed line is the predicted Q3 cut. <Link to={`/what-if?season=${s.season}&race=${s.race_key}`}>Try a car swap for this race →</Link></p>
          </section>
        </>
      )}
    </>
  );
}

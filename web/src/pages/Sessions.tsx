import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useApi, useMeta } from "../api";
import { PredictionTable } from "../components/PredictionTable";
import { ChanceLegend, ErrorBox, GroupLegend, Info, Loading, Tile, TrackOutline } from "../components/ui";
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
            <h2>{wantCorrect != null ? `Every session with ${wantCorrect}/10 correct` : `${season} at a glance`} <Info>Each cell is one race, shaded by how many of the ten picks were right. Click a cell to open it.</Info></h2>
            {wantCorrect != null && <Link to="/sessions" className="link">Show all sessions</Link>}
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
      {!s ? (detail.error ? null : <Loading height={480} />) : (
        <>
          <div className="tiles stagger">
            <Tile label="Correct picks" value={<>{s.correct}<small> / 10</small></>} sub={avg != null ? `season average ${avg.toFixed(2)}` : undefined} />
            <Tile label="Places off" value={s.mae.toFixed(2)} sub="average, all drivers" />
            <Tile label="Weekend" value={s.date} small sub={s.sprint ? "sprint weekend (one practice)" : "standard weekend"} />
          </div>
          <section className="panel">
            <div className="panel-head"><h2>Predicted order vs result <Info>“Why” shows how far each group moved the driver: solid segments moved them forward, faded ones backward. The dashed line is the predicted Q3 cut. <Link to={`/what-if?season=${s.season}&race=${s.race_key}`}>Try a car swap for this race →</Link></Info></h2><div className="legends"><ChanceLegend /><GroupLegend /></div></div>
            <PredictionTable s={s} />
          </section>
        </>
      )}
    </>
  );
}

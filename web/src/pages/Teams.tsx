import { Link, useParams } from "react-router-dom";
import { useApi, useMeta } from "../api";
import { RaceLine } from "../components/Charts";
import { CarImage } from "../components/lazy3d";
import { Avatar, Bar, ErrorBox, fmt, Loading, pct, Swatch, Tile, TrackOutline } from "../components/ui";
import type { TeamDetail, TeamSummary } from "../types";
import { engineName } from "./Cars";

export function TeamList() {
  const meta = useMeta();
  const { data, error } = useApi<TeamSummary[]>("/api/teams");
  if (error) return <ErrorBox error={error} />;
  const current = data?.filter((t) => t.last_season === meta.latest) ?? [];
  const former = data?.filter((t) => t.last_season !== meta.latest) ?? [];
  return (
    <>
      <div className="page-head reveal">
        <div>
          <span className="eyebrow">Teams</span>
          <h1>Every team since {meta.seasons[0]}</h1>
          <p className="lede">One page per team, across renames (Toro Rosso → AlphaTauri → RB → Racing Bulls, and so on): how the car ranked each season, who beat whom inside the garage, and where the team is strongest.</p>
        </div>
      </div>
      {!data ? <Loading height={420} /> : (
        <>
          <div className="card-grid stagger">
            {current.map((t) => <TeamCard key={t.id} t={t} />)}
          </div>
          {former.length > 0 && <><h2 className="section-title">Former teams</h2><div className="card-grid stagger">{former.map((t) => <TeamCard key={t.id} t={t} />)}</div></>}
        </>
      )}
    </>
  );
}

function TeamCard({ t }: { t: TeamSummary }) {
  return (
    <Link to={`/teams/${t.id}`} className="card lift">
      <div className="media"><CarImage era={t.era} livery={t.livery} alt={`${t.name} ${t.last_season} car`} /></div>
      <div className="body">
        <h3><Swatch team={t.constructor} /> {t.name}</h3>
        <div className="meta"><span>avg pace rank {fmt(t.pace_rank)}</span><span>{t.poles} poles</span></div>
        <div className="meta"><span>{t.names.length > 1 ? `was ${t.names.slice(0, -1).join(", ")}` : `${t.seasons[0]}–${String(t.last_season).slice(2)}`}</span></div>
      </div>
    </Link>
  );
}

/** Trailing mean over ``k`` values (nulls skipped). */
function rolling(xs: (number | null)[], k: number): (number | null)[] {
  return xs.map((_, i) => {
    const w = xs.slice(Math.max(0, i - k + 1), i + 1).filter((v): v is number => v != null);
    return w.length ? w.reduce((a, b) => a + b, 0) / w.length : null;
  });
}

const surname = (name: string) => name.split(" ").slice(1).join(" ") || name;

export function TeamPage() {
  const { id = "" } = useParams();
  const { data: t, error } = useApi<TeamDetail>(`/api/teams/${id}`);
  if (error) return <ErrorBox error={error} />;
  if (!t) return <Loading height={480} />;
  const latest = t.seasons[t.seasons.length - 1];
  const bySeason = t.seasons.map((s) => ({ label: String(s.season), value: s.pace_rank, tip: `${s.season} · ${s.name} ${s.chassis ?? ""}\naverage pace rank ${fmt(s.pace_rank)} of ${s.teams_in_season}\n+${fmt(s.pace_gap, 2)}% to pole` }));

  return (
    <>
      <section className="hero team-hero reveal">
        <div className="hero-text">
          <span className="eyebrow"><Swatch team={t.constructor} /> Team · {t.seasons[0].season}–{latest.season}</span>
          <h1>{t.name}</h1>
          {t.names.length > 1 && <p className="lede">Raced as {t.names.join(" → ")}.</p>}
          <div className="legend">{t.seasons.map((s) => <Link key={s.season} to={`/cars/${s.season}/${s.constructor}`} className="badge" data-tip={`${s.season} ${s.name}\nopen the ${s.chassis}`}>{s.chassis ?? s.season}</Link>)}</div>
        </div>
        <div className="hero-img"><CarImage era={latest.era} livery={latest.livery} alt={`${latest.name} ${latest.chassis}`} /></div>
      </section>

      <div className="tiles stagger">
        <Tile label="Avg quali position" value={fmt(t.avg_pos)} sub={`${t.sessions} entries`} countUp={t.avg_pos} decimals={1} />
        <Tile label="Avg pace rank" value={fmt(t.pace_rank)} sub="team's best car each race" countUp={t.pace_rank} decimals={1} />
        <Tile label="Reached Q3" value={pct(t.q3_rate)} countUp={t.q3_rate != null ? t.q3_rate * 100 : null} decimals={0} suffix="%" />
        <Tile label="Poles" value={t.poles} countUp={t.poles} decimals={0} />
        <Tile label="Model called it" value={pct(t.right / Math.max(1, t.sessions))} sub="in or out of Q3, both cars" />
      </div>

      <div className="grid-2">
        <section className="panel reveal">
          <div className="panel-head"><h2>Pace rank by season</h2><span className="note">1 = fastest car</span></div>
          <RaceLine points={bySeason} yLabel="Average pace rank per season" fmt={(v) => v.toFixed(1)} />
        </section>
        <section className="panel reveal">
          <div className="panel-head"><h2>Race by race</h2><span className="note">pace rank, 5-race rolling average</span></div>
          <RaceLine points={rolling(t.trend.map((r) => r.rank), 5).map((v, i) => { const r = t.trend[i]; return { label: `${r.season}`, value: v, tip: `${r.season} R${r.round} ${r.gp}\nrank ${r.rank} this race · ${fmt(v)} rolling\n+${fmt(r.gap, 2)}% to pole` }; })} yLabel="Pace rank per race, rolling average" fmt={(v) => v.toFixed(1)} />
        </section>
      </div>

      <section className="panel reveal">
        <div className="panel-head"><h2>Season by season</h2><span className="note">teammate battle = who out-qualified whom, race by race</span></div>
        <div className="scroll">
          <table>
            <thead><tr><th>Season</th><th>Car</th><th>Engine</th><th className="num">Pace rank</th><th className="num">Gap</th><th className="num">Avg</th><th>Q3 rate</th><th className="num">Poles</th><th>Teammate battle</th></tr></thead>
            <tbody>
              {[...t.seasons].reverse().map((s) => {
                const [a, b] = s.drivers;
                const total = (a?.h2h_wins ?? 0) + (b?.h2h_wins ?? 0);
                return (
                  <tr key={s.season}>
                    <td className="mono">{s.season}</td>
                    <td><Link to={`/cars/${s.season}/${s.constructor}`}><Swatch team={s.constructor} /> {s.name} {s.chassis}</Link></td>
                    <td>{engineName(s.engine)}</td>
                    <td className="num">{fmt(s.pace_rank)}<span className="note"> /{s.teams_in_season}</span></td>
                    <td className="num">+{fmt(s.pace_gap, 2)}%</td>
                    <td className="num">{fmt(s.avg_pos)}</td>
                    <td style={{ minWidth: 120 }}><Bar value={s.q3_rate} label={pct(s.q3_rate)} /></td>
                    <td className="num">{s.poles || "–"}</td>
                    <td style={{ minWidth: 260 }}>
                      {a && b && total > 0 ? (
                        <div className="h2h" data-tip={`${a.name} ${a.h2h_wins} – ${b.h2h_wins} ${b.name}`}>
                          <Link to={`/drivers/${a.driver}`} className="cell-name"><Avatar driver={a.driver} team={s.constructor} size={22} /><span>{surname(a.name)}</span></Link>
                          <span className="mono">{a.h2h_wins}</span>
                          <span className="h2h-bar"><span style={{ width: `${(a.h2h_wins / total) * 100}%` }} /></span>
                          <span className="mono">{b.h2h_wins}</span>
                          <Link to={`/drivers/${b.driver}`} className="cell-name"><span>{surname(b.name)}</span><Avatar driver={b.driver} team={s.constructor} size={22} /></Link>
                        </div>
                      ) : <span className="note">{s.drivers.map((d) => d.name).join(", ")}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid-2">
        {([["Strongest tracks", t.best_tracks], ["Weakest tracks", t.worst_tracks]] as const).map(([title, list]) => (
          <section key={title} className="panel reveal">
            <div className="panel-head"><h2>{title}</h2><span className="note">average quali position, at least 4 entries</span></div>
            <div className="scroll"><table>
              <tbody>
                {list.map((r) => (
                  <tr key={r.circuit}>
                    <td><Link to={`/tracks/${r.circuit}`} className="cell-name"><TrackOutline circuit={r.circuit} size={26} stroke={2} /><span>{r.name}</span></Link></td>
                    <td className="num">P{fmt(r.avg_pos)}</td>
                    <td className="num note">{r.entries} entries</td>
                    <td className="num">{pct(r.q3_rate)} Q3</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </section>
        ))}
      </div>
    </>
  );
}

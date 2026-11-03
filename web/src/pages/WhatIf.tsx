import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useApi, useMeta } from "../api";
import { Avatar, ContribBars, ErrorBox, Loading, PosChip, Swatch, Info } from "../components/ui";
import type { SessionDetail, SessionSummary, Swap } from "../types";

export default function WhatIf() {
  const meta = useMeta();
  const [params, setParams] = useSearchParams();
  const season = Number(params.get("season")) || meta.latest;
  const sessions = useApi<SessionSummary[]>(`/api/sessions?season=${season}`);
  const key = params.get("race") ?? sessions.data?.[sessions.data.length - 1]?.race_key ?? null;
  const session = useApi<SessionDetail>(key ? `/api/sessions/${key}` : null);
  const rows = session.data?.rows ?? [];
  const teams = useMemo(() => [...new Set(rows.map((r) => r.team))], [rows]);
  const driver = params.get("driver") ?? rows.find((r) => r.pred_rank === 1)?.driver ?? "";
  const wantTeam = params.get("team");
  const team = wantTeam && teams.includes(wantTeam) ? wantTeam : teams.find((t) => t !== rows.find((r) => r.driver === driver)?.team) ?? "";
  const swap = useApi<Swap>(key && driver && team ? `/api/swap?race_key=${key}&driver=${driver}&team=${team}` : null);

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    next.set(k, v);
    if (k === "season") next.delete("race");
    setParams(next, { replace: true });
  };
  const [shown, setShown] = useState<Swap | null>(null);
  useEffect(() => { if (swap.data) setShown(swap.data); }, [swap.data]);
  const name = (id: string) => meta.drivers.find((d) => d.id === id)?.name ?? id;
  const tname = (id: string) => meta.teams.find((t) => t.id === id)?.name ?? id;
  const s = shown && shown.driver === driver ? shown : null;

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">What if</span>
          <h1>Put any driver in any car <Info>Grid position = rank of the what-if score among the other drivers of that session. This is a model estimate, not a simulation: the driver features still carry some of the cars the driver drove before. See <Link to={`/sessions/${key ?? ""}`}>the full session</Link>.</Info></h1>
          <p className="lede">The model keeps the driver's own features (form, teammate battles, experience, track record) and swaps in the car's: the team's recent form, its standings and its practice pace that weekend.</p>
        </div>
      </div>
      <section className="panel">
        <div className="controls">
          <label htmlFor="wi-season">Season
            <select id="wi-season" value={season} onChange={(e) => set("season", e.target.value)}>{meta.seasons.map((y) => <option key={y}>{y}</option>)}</select>
          </label>
          <label htmlFor="wi-race">Grand Prix
            <select id="wi-race" value={key ?? ""} onChange={(e) => set("race", e.target.value)}>
              {sessions.data?.map((x) => <option key={x.race_key} value={x.race_key}>R{x.round} · {x.gp}</option>)}
            </select>
          </label>
          <label htmlFor="wi-driver">Driver
            <select id="wi-driver" value={driver} onChange={(e) => set("driver", e.target.value)}>
              {[...rows].sort((a, b) => name(a.driver).localeCompare(name(b.driver))).map((r) => <option key={r.driver} value={r.driver}>{name(r.driver)}</option>)}
            </select>
          </label>
          <label htmlFor="wi-team">In the car of
            <select id="wi-team" value={team} onChange={(e) => set("team", e.target.value)}>{teams.map((t) => <option key={t} value={t}>{tname(t)}</option>)}</select>
          </label>
        </div>
      </section>
      {(sessions.error || session.error || swap.error) && <ErrorBox error={(sessions.error || session.error || swap.error)!} />}
      {!s ? <Loading height={260} /> : (
        <div className="grid-2" style={{ opacity: swap.loading ? 0.6 : 1 }}>
          <section className="panel">
            <span className="eyebrow">Real car</span>
            <div className="cell-name"><Avatar driver={s.driver} team={s.from_team} size={48} /><div><h2>{name(s.driver)}</h2><span className="sub"><Swatch team={s.from_team} /> {tname(s.from_team)}</span></div></div>
            <div className="tiles">
              <div className="tile"><span className="eyebrow">Predicted</span><span className="v">P{s.own_grid}</span><span className="s">model score {s.own_score.toFixed(1)}</span></div>
              <div className="tile"><span className="eyebrow">Actual</span><span className="v">{s.actual ? <PosChip pos={s.actual} /> : "–"}</span></div>
            </div>
            <ContribBars contrib={s.own_contrib} />
          </section>
          <section className="panel" style={{ borderColor: "var(--focus)" }}>
            <span className="eyebrow">What if</span>
            <div className="cell-name"><Avatar driver={s.driver} team={s.team} size={48} /><div><h2>{name(s.driver)}</h2><span className="sub"><Swatch team={s.team} /> in the {tname(s.team)}</span></div></div>
            <div className="tiles">
              <div className="tile"><span className="eyebrow">Predicted</span><span className="v">P{s.grid}</span><span className="s">model score {s.score.toFixed(1)}</span></div>
              <div className="tile"><span className="eyebrow">Change</span><span className="v" style={{ color: s.grid < s.own_grid ? "var(--good)" : s.grid > s.own_grid ? "var(--bad)" : undefined }}>{s.grid === s.own_grid ? "±0" : `${s.grid < s.own_grid ? "▲" : "▼"} ${Math.abs(s.grid - s.own_grid)}`}</span><span className="s">grid places</span></div>
            </div>
            <ContribBars contrib={s.contrib} />
          </section>
        </div>
      )}
    </>
  );
}

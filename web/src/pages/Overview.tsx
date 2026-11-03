import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApi, useMeta } from "../api";
import { Bars, DotPlot, Lollipops } from "../components/Charts";
import { ErrorBox, GROUP_LABEL, Loading, Tile, Info } from "../components/ui";
import type { Group, Overview as OverviewData } from "../types";
import { GROUPS } from "../types";

export const METHOD_NAMES: Record<string, string> = {
  previous_quali: "Previous qualifying order",
  rolling_form_3: "Average of last 3 qualis",
  championship: "Championship order",
  last_practice: "Last practice order",
};

const FEATURE_LABELS: Record<string, string> = {
  fp_last_pos: "Latest practice position", fp_best_pos: "Best practice position", fp_mean_gap_pct: "Mean practice gap %",
  fp_last_gap_pct: "Latest practice gap %", fp_sessions: "Practice sessions held", drv_pos_mean5: "Driver avg quali, last 5",
  drv_pos_mean3: "Driver avg quali, last 3", drv_pos_last: "Previous quali position", drv_vs_teammate5: "Gap to teammate, last 5",
  drv_season_pos_mean: "Driver season avg quali", drv_circuit_last_pos: "Last quali at this track", drv_career_sessions: "Driver experience",
  drv_team_sessions: "Sessions with current team", drv_top10_rate5: "Driver Q3 rate, last 5", drv_pace_gap_mean3: "Driver pace gap, last 3",
  con_pos_mean3: "Team avg quali, last 3", con_season_pos_mean: "Team season avg quali", con_top10_rate3: "Team Q3 rate, last 3",
  con_pace_gap_mean3: "Team pace gap to pole, last 3", constructor_champ_pos_before: "Team championship position",
  constructor_points_before: "Team championship points", driver_champ_pos_before: "Driver championship position",
  driver_points_before: "Driver championship points", sprint_weekend: "Sprint weekend", street_circuit: "Street circuit",
};

export default function Overview() {
  const meta = useMeta();
  const nav = useNavigate();
  const [focus, setFocus] = useState<Group | null>(null);
  const { data, error } = useApi<OverviewData>("/api/overview");
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading height={480} />;
  const o = data.overall;
  const best = Object.entries(data.baselines).sort((a, b) => b[1].correct_per_10 - a[1].correct_per_10)[0];
  const range = `${data.seasons[0]}–${String(data.latest).slice(2)}`;
  const latest = data.by_season[String(data.latest)];
  const group: Record<string, Group> = {};
  GROUPS.forEach((g) => data.feature_groups[g].forEach((f) => (group[f] = g)));
  const imp = data.importance.filter(([, v]) => v > 0).slice(0, 10);
  const impMax = Math.max(...imp.map(([, v]) => v), 0.01);
  const gs = data.group_size;
  const gsTotal = GROUPS.reduce((a, g) => a + gs[g], 0);

  const rows = [{ label: range, a: o.correct_per_10, b: data.baselines.championship.correct_per_10, strong: true }].concat(
    data.seasons.map((s) => ({ label: String(s), a: data.by_season[s].correct_per_10, b: data.baselines_by_season[s].championship, strong: false })),
  );
  const lo = Math.floor(Math.min(...rows.flatMap((r) => [r.a, r.b])) * 2) / 2;
  const hi = Math.ceil(Math.max(...rows.flatMap((r) => [r.a, r.b])) * 2) / 2;
  const methods = [{ label: "This model", value: o.correct_per_10, strong: true }, ...Object.entries(data.baselines).map(([k, v]) => ({ label: METHOD_NAMES[k], value: v.correct_per_10 }))]
    .sort((a, b) => b.value - a.value);
  const mlo = Math.floor(Math.min(...methods.map((m) => m.value)) * 5) / 5, mhi = Math.ceil(Math.max(...methods.map((m) => m.value)) * 5) / 5;
  const hist = [4, 5, 6, 7, 8, 9, 10].map((k) => ({ label: `${k}/10`, value: data.histogram[String(k)] ?? 0 }));
  const eightPlus = hist.slice(4).reduce((a, b) => a + b.value, 0);

  return (
    <>
      <div className="page-head reveal">
        <div>
          <span className="eyebrow">Formula 1 qualifying · {range}</span>
          <h1>Which ten drivers make it into Q3?</h1>
          <p className="lede">A Ridge regression model predicts every driver's qualifying position from car form, driver form and that weekend's practice. Each of the {o.sessions} sessions below was predicted using only what was known before qualifying.</p>
        </div>
        <Link to="/live" className="btn">See the live weekend</Link>
      </div>

      <div className="tiles stagger">
        <Tile label="Correct picks" value={null} countUp={o.correct_per_10} suffix=" / 10" sub={`average per session, ${range}`} />
        <Tile label={`${data.latest} season`} value={null} countUp={latest.correct_per_10} suffix=" / 10" sub={`${latest.sessions} sessions so far`} />
        <Tile label="vs best simple rule" value={`+${(o.correct_per_10 - best[1].correct_per_10).toFixed(2)}`} sub={`over ${METHOD_NAMES[best[0]].toLowerCase()}`} />
        <Tile label="Places off (Q3 drivers)" value={null} countUp={o.mae_top10} sub="mean absolute error" />
        <Tile label="Perfect sessions" value={<>{o.perfect_sessions}<small> / {o.sessions}</small></>} sub={`worst: ${o.worst_session}/10`} />
      </div>

      <div className="grid-2 stagger">
        <section className="panel">
          <div className="panel-head"><h2>Correct picks by season <Info>Average number of the ten picked drivers who really reached Q3. Click a season to open its sessions.</Info></h2></div>
          <div className="legend"><span><i style={{ background: "var(--series-model)" }} />This model</span><span><i style={{ background: "var(--series-base)" }} />Championship order</span></div>
          <DotPlot rows={rows} aLabel="This model" bLabel="Championship order" lo={lo} hi={hi} onRow={(l) => /^\d{4}$/.test(l) && nav(`/sessions?season=${l}`)} />
        </section>
        <div className="stackcol">
          <section className="panel">
            <div className="panel-head"><h2>Model vs simple rules <Info>Each rule ranks drivers by one number. The top six or seven cars are easy to call; the fight is over P8 to P12.</Info></h2></div>
            <Lollipops items={methods} lo={mlo} hi={mhi} step={0.2} />
          </section>
          <section className="panel">
            <div className="panel-head"><h2>What decides the prediction <Info>Average size of each group's push on a prediction. <b>Car</b> = team form, tracked per team (it stays with the car when a driver leaves). <b>Driver</b> = the driver's own results and teammate battle; these follow the driver to a new team, but they also include the cars the driver had. <b>Practice</b> mixes both.</Info></h2><Link to="/what-if" className="link">Try a driver in another car →</Link></div>
            <div className="stack" style={{ height: 18 }}>
            {GROUPS.map((g) => <span key={g} className={focus === g ? "sel" : ""} onClick={() => setFocus(focus === g ? null : g)} style={{ width: `${(gs[g] / gsTotal) * 100}%`, background: `var(--g-${g})`, cursor: "pointer" }} data-tip={`${GROUP_LABEL[g]}\nmoves a prediction by ${gs[g].toFixed(2)} places on average\nClick to highlight its inputs`} />)}
          </div>
          <div className="legend" role="group" aria-label="Highlight a group">
            {GROUPS.map((g) => (
              <button key={g} type="button" aria-pressed={focus === g} onClick={() => setFocus(focus === g ? null : g)}>
                <i style={{ background: `var(--g-${g})` }} />{GROUP_LABEL[g]} {Math.round((gs[g] / gsTotal) * 100)}%
              </button>
            ))}
          </div>
          </section>
        </div>
        <section className="panel">
          <div className="panel-head"><h2>How many picks were right <Info>{Math.round((eightPlus / o.sessions) * 100)}% of sessions had 8 or more of the 10 right. Click a bar to see those sessions.</Info></h2></div>
          <Bars items={hist} total={o.sessions} height={360} onBar={(l) => nav(`/sessions?correct=${parseInt(l)}`)} />
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Most useful single inputs<Info>{meta.latest} season Drop in correct picks per session when the input is shuffled (model trained on seasons before {data.latest}).</Info></h2></div>
          <div className="scroll">
            <table className={focus ? "dim-others" : undefined}>
              <tbody>
                {imp.map(([k, v]) => (
                  <tr key={k} className={`imp-row${group[k] === focus ? " on" : ""}`}>
                    <td><span className="swatch" style={{ background: `var(--g-${group[k]})`, marginRight: 8 }} />{FEATURE_LABELS[k] ?? k}</td>
                    <td style={{ width: "45%" }}><div className="cell-bar"><div className="bar"><span style={{ width: `${(v / impMax) * 100}%`, background: `var(--g-${group[k]})` }} /></div><b>{v.toFixed(2)}</b></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

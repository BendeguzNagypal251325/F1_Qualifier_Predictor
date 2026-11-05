import { Link } from "react-router-dom";
import { useApi, useMeta } from "../api";
import { ErrorBox, Info, Loading } from "../components/ui";
import type { Overview } from "../types";
import { METHOD_NAMES } from "./Overview";

// Plain-language explanation of what Gridcast predicts and how far to trust it. Every number comes from
// the same walk-forward results as the rest of the app (/api/overview).

export default function HowItWorks() {
  const meta = useMeta();
  const { data: o, error } = useApi<Overview>("/api/overview");
  if (error) return <ErrorBox error={error} />;
  if (!o) return <Loading height={420} />;
  const range = `${o.seasons[0]}–${String(o.seasons[o.seasons.length - 1]).slice(2)}`;
  const rules = Object.entries(o.baselines).sort((a, b) => b[1].correct_per_10 - a[1].correct_per_10);
  const [bestName, best] = rules[0];
  const latest = o.by_season[String(o.latest)];
  const share = (g: keyof Overview["group_size"]) => {
    const total = Object.values(o.group_size).reduce((a, b) => a + b, 0);
    return Math.round((o.group_size[g] / total) * 100);
  };
  const cal = o.q3_calibration;
  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">How it works</span>
          <h1>What Gridcast predicts, and how far to trust it</h1>
        </div>
      </div>
      <div className="explain">
        <section className="panel">
          <h2>The question</h2>
          <p className="body-text">
            Qualifying decides the starting grid in three knock-out rounds. Only the ten fastest drivers reach the last round,
            Q3, and start from the top ten. Before qualifying begins, Gridcast predicts every driver's qualifying position;
            the ten best predictions are its Q3 picks.
          </p>
          <p className="body-text">
            It uses what is known beforehand: each driver's recent form, the team's recent form, the championship standings,
            and that weekend's practice sessions. It never uses the qualifying result itself.
          </p>
        </section>

        <section className="panel">
          <h2>How it is tested</h2>
          <p className="body-text">
            The model is tested the way it is used. Going through {range} race by race, it is retrained on every earlier race
            and then predicts the next one, so it never sees a result before predicting it. This is called a walk-forward test.
          </p>
          <div className="facts">
            <div><b className="mono">{o.overall.correct_per_10.toFixed(2)}<small> / 10</small></b><span>Q3 picks right per race, {o.overall.sessions} races</span></div>
            <div><b className="mono">{latest.correct_per_10.toFixed(2)}<small> / 10</small></b><span>in {o.latest} so far ({latest.sessions} races)</span></div>
            <div><b className="mono">{best.correct_per_10.toFixed(2)}<small> / 10</small></b><span>best simple rule: {METHOD_NAMES[bestName]?.toLowerCase()}</span></div>
          </div>
        </section>

        <section className="panel">
          <h2>Why a simple model won</h2>
          <p className="body-text">
            Gridcast uses Ridge regression: a weighted sum of {meta.groups ? Object.values(meta.groups).flat().length : "the"} inputs,
            with the weights kept small so no single input dominates. We also tried logistic regression, random forests,
            gradient boosting, XGBoost and a LightGBM ranking model. None beat it: the linear models were all within about
            one correct pick per season of each other, and the more complex ones did no better.
          </p>
          <p className="body-text">
            The reason is the amount of data. There are only about {Math.round(o.overall.sessions / Math.max(1, o.seasons.length))} races
            a season and twenty drivers per race, and the cars change every year. A flexible model learns quirks of past seasons
            that do not repeat; a simple one keeps the patterns that do, like "fast in practice, fast in qualifying".
          </p>
        </section>

        <section className="panel">
          <h2>Against simple rules</h2>
          <table>
            <thead><tr><th>Method ({range})</th><th className="num">Right / 10</th></tr></thead>
            <tbody>
              <tr><td><b>This model</b></td><td className="num"><b>{o.overall.correct_per_10.toFixed(2)}</b></td></tr>
              {rules.map(([k, m]) => <tr key={k}><td>{METHOD_NAMES[k] ?? k}</td><td className="num">{m.correct_per_10.toFixed(2)}</td></tr>)}
            </tbody>
          </table>
          <p className="body-text">
            The top six or seven cars are easy to call. Nearly every miss is in the fight for P8 to P12, where the gaps are often
            under a tenth of a second.
          </p>
        </section>

        <section className="panel">
          <h2>Driver or car?</h2>
          <p className="body-text">
            Every prediction is split into what comes from the driver ({share("driver")}%), the car ({share("car")}%) and that
            weekend's practice ({share("weekend")}%). Car form is tracked per team, so it stays with the car when a driver moves;
            driver form follows the driver. Practice matters most: without it the model is only as good as the best simple rule.
            You can test this on the <Link className="link" to="/what-if">What if page</Link> by putting a driver in another car.
          </p>
        </section>

        <section className="panel">
          <h2>Two kinds of results</h2>
          <p className="body-text">
            The numbers above are a backtest: past races predicted as if in real time. Live predictions are also saved before
            each qualifying session and never changed, on the <Link className="link" to="/track-record">Track record page</Link>,
            so anyone can check that a forecast existed before the result. Once qualifying is over, each saved forecast is
            scored against the real top ten.
          </p>
        </section>

        <section className="panel">
          <h2>What the Q3 chance means</h2>
          <p className="body-text">
            Next to each predicted position, the app shows a chance of reaching Q3. A 70% chance means that in earlier races,
            about 7 out of 10 drivers predicted at that position really made Q3. It is counted from the model's own past misses,
            grouped by predicted position, using only races before the one being predicted.
          </p>
          <p className="body-text">
            Between 30% and 70% the app calls it too close to call; those drivers are where most surprises happen.
            {cal && <> Over {cal.races} races the chances are well calibrated: their Brier score (lower is better) is {cal.brier.toFixed(3)},
              against {cal.brier_picks.toFixed(3)} for plain yes/no picks and {cal.brier_base_rate.toFixed(3)} for giving everyone the same chance.</>}
          </p>
        </section>

        <section className="panel">
          <h2>Limits</h2>
          <ul className="body-text plain-list">
            <li>Close midfield battles stay hard to call; a tenth of a second can move a driver five places.</li>
            <li>Rain and crashes during qualifying are not predicted.</li>
            <li>It predicts the qualifying order, not the starting grid: grid penalties are applied after qualifying.</li>
            <li>Sector times exist only from 2023, and only once downloaded from OpenF1.</li>
            <li>The 3D cars show each era's car shape in team colours, not each team's real design.</li>
          </ul>
        </section>
        <section className="panel wide">
          <h2>Future work <Info>Plans only; none of this is built yet. The README has the longer version.</Info></h2>
          <ul className="body-text plain-list future">
            <li><b>Free hosting.</b> The same docker compose setup on an Oracle Cloud Always Free VM, with HTTPS in front.</li>
            <li><b>Static version.</b> A scheduled GitHub Action rebuilds static files after each practice session and commits the frozen predictions, so git history proves when each forecast was made. Costs a rewrite of the live service.</li>
            <li><b>Installable app.</b> A PWA that phones can install from the browser, with an optional notification when the post-FP3 prediction is ready.</li>
            <li><b>Helmets.</b> Real drivers' helmet designs are a grey area; a public version would keep them as fan-made approximations and keep the 3D model credits visible.</li>
          </ul>
        </section>
      </div>
    </>
  );
}

import { Link } from "react-router-dom";
import { useApi, useMeta } from "../api";
import { ErrorBox, Loading } from "../components/ui";
import type { Overview } from "../types";

// Plain-language explanation of what Gridcast predicts and how far to trust it. Every number comes from
// the same walk-forward results as the rest of the app (/api/overview).

export default function HowItWorks() {
  const meta = useMeta();
  const { data: o, error } = useApi<Overview>("/api/overview");
  if (error) return <ErrorBox error={error} />;
  if (!o) return <Loading height={420} />;
  const range = `${o.seasons[0]}–${String(o.seasons[o.seasons.length - 1]).slice(2)}`;
  const best = Object.values(o.baselines).sort((a, b) => b.correct_per_10 - a.correct_per_10)[0];
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
            Only the ten fastest qualifiers reach Q3. Before qualifying, Gridcast predicts every driver's position from
            driver form, team form, the standings and that weekend's practice. Its top ten are the Q3 picks.
          </p>
          <div className="facts">
            <div><b className="mono">{o.overall.correct_per_10.toFixed(2)}<small> / 10</small></b><span>right per race ({o.overall.sessions})</span></div>
            <div><b className="mono">{latest.correct_per_10.toFixed(2)}<small> / 10</small></b><span>in {o.latest}</span></div>
            <div><b className="mono">{best.correct_per_10.toFixed(2)}<small> / 10</small></b><span>best simple rule</span></div>
          </div>
        </section>

        <section className="panel">
          <h2>How it is tested</h2>
          <p className="body-text">
            Walk-forward: going race by race through {range}, the model is retrained on every earlier race and then predicts
            the next one. It never sees a result before predicting it, and neither does the Q3 chance.
          </p>
          <p className="body-text">
            That is a backtest. Live predictions are also frozen before each qualifying session and scored afterwards.
          </p>
        </section>

        <section className="panel">
          <h2>Why a simple model</h2>
          <p className="body-text">
            Ridge regression: a weighted sum of {meta.groups ? Object.values(meta.groups).flat().length : "the"} inputs, with small weights.
            Other linear models scored within about one pick a season of it; random forests, gradient boosting, XGBoost and
            LightGBM did no better. With about {Math.round(o.overall.sessions / Math.max(1, o.seasons.length))} races
            a season and new cars every year, flexible models learn quirks that do not repeat; a simple one keeps patterns
            that do, like “fast in practice, fast in qualifying”.
          </p>
        </section>

        <section className="panel">
          <h2>Limits</h2>
          <ul className="body-text plain-list">
            <li>The top six or seven cars are easy to call; nearly every miss is in the P8 to P12 fight, often decided by under a tenth.</li>
            <li>Rain and crashes in qualifying are not predicted.</li>
            <li>It predicts the qualifying order, not the grid after penalties.</li>
            <li>The 3D cars show each era's shape in team colours.</li>
          </ul>
        </section>

        <section className="panel">
          <h2>What the Q3 chance means</h2>
          <p className="body-text">
            The share of drivers predicted at that position who made Q3 in earlier races. Between 30% and 70% is too close to call.
            {cal && <> Over {cal.races} races its Brier score (lower is better) is {cal.brier.toFixed(3)}, against {cal.brier_picks.toFixed(3)} for
              yes/no picks and {cal.brier_base_rate.toFixed(3)} for one flat chance.</>}
          </p>
        </section>

        <section className="panel">
          <h2>Driver or car?</h2>
          <p className="body-text">
            Each prediction splits into driver ({share("driver")}%), car ({share("car")}%) and practice ({share("weekend")}%).
            Car form stays with the team; driver form follows the driver. Without practice, the model is no better than the
            best simple rule. Try a swap on the <Link className="link" to="/what-if">What if page</Link>.
          </p>
        </section>
      </div>
    </>
  );
}

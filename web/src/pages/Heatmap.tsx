import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { seasonsParam, useApi, useMeta } from "../api";
import { ErrorBox, fmt, Info, Loading, SeasonFilter, Swatch, useSeasons } from "../components/ui";
import type { Heatmap } from "../types";

export default function HeatmapPage() {
  const meta = useMeta();
  const nav = useNavigate();
  const [seasons, setSeasons] = useSeasons();
  const [min, setMin] = useState(20);
  const sp = seasonsParam(seasons, meta.seasons);
  const { data, error } = useApi<Heatmap>(`/api/heatmap?min_sessions=${min}${sp ? "&" + sp : ""}`);
  const cname = (id: string) => meta.circuits.find((c) => c.id === id)?.name ?? id;
  const dname = (id: string) => meta.drivers.find((d) => d.id === id)?.name ?? id;
  const cells = new Map(data?.cells.map((c) => [`${c.driver}|${c.circuit}`, c]));

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Heatmap</span>
          <h1>Average qualifying position, driver × track <Info>Darker is better. Drivers are sorted by average qualifying position. Click a cell to open the driver.</Info></h1>
        </div>
      </div>
      <section className="panel">
        <div className="controls">
          <SeasonFilter value={seasons} onChange={setSeasons} />
          <label htmlFor="hm-min">At least
            <select id="hm-min" value={min} onChange={(e) => setMin(Number(e.target.value))}>{[1, 10, 20, 40, 80].map((n) => <option key={n}>{n}</option>)}</select>
            sessions
          </label>
          <span className="legend mono">P1 <span style={{ width: 140, height: 10, borderRadius: 5, display: "inline-block", background: "linear-gradient(90deg, var(--heat), color-mix(in oklab, var(--heat) 8%, var(--surface)))" }} /> P20</span>
        </div>
      </section>
      {error && <ErrorBox error={error} />}
      {!data ? <Loading height={500} /> : (
        <section className="panel">
          <div className="scroll">
            <table className="heat">
              <thead><tr><th />{data.circuits.map((c) => <th key={c} className="col">{cname(c)}</th>)}</tr></thead>
              <tbody>
                {data.drivers.map((d) => (
                  <tr key={d.driver}>
                    <th className="rowh"><Swatch team={d.team} /> {dname(d.driver)}</th>
                    {data.circuits.map((c) => {
                      const cell = cells.get(`${d.driver}|${c}`);
                      if (!cell) return <td key={c} />;
                      const t = Math.max(0.08, (20 - cell.avg) / 19);
                      return (
                        <td key={c} className="c" onClick={() => nav(`/drivers/${d.driver}`)}
                          style={{ background: `color-mix(in oklab, var(--heat) ${Math.round(t * 100)}%, var(--surface))`, color: t > 0.55 ? "var(--heat-ink)" : "var(--ink)" }}
                          data-tip={`${dname(d.driver)} at ${cname(c)}\nAvg P${fmt(cell.avg)} over ${cell.n} session${cell.n > 1 ? "s" : ""} · best P${cell.best}\nModel right ${cell.right}/${cell.n}`}>
                          {Math.round(cell.avg)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

import { Link } from "react-router-dom";
import { useMeta } from "../api";
import type { SessionDetail } from "../types";
import { Avatar, ContribStack, PosChip, Q3Chance, Q3ChanceHead, Swatch, useTeam } from "./ui";

/** Predicted order vs result for one session (used by Sessions and the Live fallback). */
export function PredictionTable({ s }: { s: SessionDetail }) {
  const meta = useMeta();
  const name = (id: string) => meta.drivers.find((d) => d.id === id)?.name ?? id;
  const tname = (id: string) => meta.teams.find((t) => t.id === id)?.name ?? id;
  return (
    <div className="scroll">
      <table>
        <thead><tr><th className="num">Pred</th><th>Driver</th><Q3ChanceHead /><th>Team</th><th className="num">Practice</th><th>Why</th><th className="num">Model</th><th className="num">Actual</th><th>Call</th></tr></thead>
        <tbody>
          {s.rows.map((r) => (
            <tr key={r.driver} className={r.pred_rank === 10 ? "cut" : ""}>
              <td className="num">{r.pred_rank}</td>
              <td><Link className="cell-name" to={`/drivers/${r.driver}`}><Avatar driver={r.driver} team={r.team} size={30} /><span>{name(r.driver)}</span></Link></td>
              <td className="num"><Q3Chance p={r.q3_prob} band={s.close_call} /></td>
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
  );
}

type Row = SessionDetail["rows"][number];

/** One line of a grid: faint team colour behind it, position, driver, Q3 chance and a note. */
function GridRow({ r, place, note, band }: { r: Row; place: number; note: string; band?: [number, number] }) {
  const meta = useMeta();
  const color = useTeam(r.team).color;
  const name = meta.drivers.find((d) => d.id === r.driver)?.name ?? r.driver;
  return (
    <tr className={place === 10 ? "cut" : ""} style={{ background: `linear-gradient(90deg, color-mix(in oklab, ${color} 22%, transparent), transparent 80%)` }}>
      <td className="num">P{place}</td>
      <td><Link className="cell-name" to={`/drivers/${r.driver}`}><Avatar driver={r.driver} team={r.team} size={26} /><span>{name}</span></Link></td>
      <td className="num"><Q3Chance p={r.q3_prob} band={band} /></td>
      <td className="num note">{note}</td>
    </tr>
  );
}

/** The same session as two plain grids side by side: the predicted order and the real qualifying result. */
export function GridCompare({ s }: { s: SessionDetail }) {
  const predicted = [...s.rows].sort((a, b) => a.pred_rank - b.pred_rank);
  const actual = [...s.rows].sort((a, b) => (a.pos ?? 99) - (b.pos ?? 99));
  const moved = (r: Row) => {
    if (r.pos == null) return r.status ?? "–";
    const d = r.pred_rank - r.pos;
    return d === 0 ? "as predicted" : d > 0 ? `▲ ${d} vs pred` : `▼ ${-d} vs pred`;
  };
  const head = (last: string) => (
    <thead><tr><th className="num">Pos</th><th>Driver</th><Q3ChanceHead /><th className="num">{last}</th></tr></thead>
  );
  return (
    <div className="grid-compare">
      <div className="scroll">
        <span className="eyebrow">Predicted grid</span>
        <table>{head("Call")}<tbody>{predicted.map((r) => <GridRow key={r.driver} r={r} place={r.pred_rank} note={r.right ? "✓" : "✗"} band={s.close_call} />)}</tbody></table>
      </div>
      <div className="scroll">
        <span className="eyebrow">Actual qualifying</span>
        <table>{head("Vs prediction")}<tbody>{actual.map((r, i) => <GridRow key={r.driver} r={r} place={r.pos ?? i + 1} note={moved(r)} band={s.close_call} />)}</tbody></table>
      </div>
    </div>
  );
}

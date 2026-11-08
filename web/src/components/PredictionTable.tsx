import { Link } from "react-router-dom";
import { useMeta } from "../api";
import type { SessionDetail } from "../types";
import { Avatar, ContribStack, PosChip, Q3Chance, Q3ChanceHead, Swatch } from "./ui";

/** Predicted order vs result for one session (used by Sessions and the Live fallback). */
export function PredictionTable({ s }: { s: SessionDetail }) {
  const meta = useMeta();
  const name = (id: string) => meta.drivers.find((d) => d.id === id)?.name ?? id;
  const tname = (id: string) => meta.teams.find((t) => t.id === id)?.name ?? id;
  return (
    <div className="scroll">
      <table>
        <thead><tr><th className="num">Pred</th><th>Driver</th><Q3ChanceHead /><th>Team</th><th className="num">Practice</th><th>Why</th><th className="num">Model</th><th className="num">Qualified</th><th>Call</th></tr></thead>
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

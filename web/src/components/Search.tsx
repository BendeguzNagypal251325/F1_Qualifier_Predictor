import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Meta, TeamSummary } from "../types";

// Quick search: jump to any driver, team, track, car or page. Opens with Ctrl/⌘+K or "/", works with
// the keyboard (↑ ↓ Enter Esc) and from the search button in the top bar.

interface Item { kind: "Driver" | "Team" | "Track" | "Car" | "Page"; label: string; sub: string; to: string; color?: string; key: string }

const PAGES: [string, string][] = [["/live", "Live weekend"], ["/drivers", "Drivers"], ["/teams", "Teams"], ["/cars", "Cars"],
  ["/tracks", "Tracks"], ["/what-if", "What if"], ["/sessions", "Sessions"], ["/heatmap", "Heatmap"], ["/how-it-works", "How it works"]];

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** 3 = name starts with the query, 2 = a word starts with it, 1 = contains it, 0 = no match. */
function score(item: Item, q: string) {
  const name = fold(item.label), all = `${name} ${fold(item.sub)}`;
  const words = q.split(/\s+/).filter(Boolean);
  if (!words.every((w) => all.includes(w))) return 0;
  if (name.startsWith(q)) return 3;
  return all.split(/[\s·,-]+/).some((w) => w.startsWith(words[0])) ? 2 : 1;
}

let teamsCache: Promise<TeamSummary[]> | null = null;

export function Search({ meta }: { meta: Meta }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const nav = useNavigate();
  // clear and open in one step, so keys typed right after the shortcut land in an empty box
  const show = () => { setQ(""); setSel(0); setOpen(true); };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) { e.preventDefault(); show(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  useEffect(() => {
    if (!open) return;
    (teamsCache ??= fetch("/api/teams").then((r) => r.json())).then(setTeams).catch(() => { teamsCache = null; });
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const teamName = new Map(meta.teams.map((t) => [t.id, t]));
    const out: Item[] = PAGES.map(([to, label]) => ({ kind: "Page", label, sub: "page", to, key: `p${to}` }));
    meta.drivers.forEach((d) => out.push({ kind: "Driver", label: d.name, sub: teamName.get(d.team)?.name ?? "", to: `/drivers/${d.id}`, color: teamName.get(d.team)?.color, key: `d${d.id}` }));
    teams.forEach((t) => out.push({ kind: "Team", label: t.names[t.names.length - 1], sub: t.names.length > 1 ? `was ${t.names.slice(0, -1).join(", ")}` : "team", to: `/teams/${t.id}`, color: t.color, key: `t${t.id}` }));
    meta.circuits.forEach((c) => out.push({ kind: "Track", label: c.name, sub: "track", to: `/tracks/${c.id}`, key: `c${c.id}` }));
    Object.entries(meta.cars).forEach(([season, byTeam]) => Object.entries(byTeam).forEach(([team, car]) => {
      const t = teamName.get(team);
      out.push({ kind: "Car", label: `${t?.name ?? team} ${car.chassis}`, sub: season, to: `/cars/${season}/${team}`, color: t?.color, key: `k${season}${team}` });
    }));
    return out;
  }, [meta, teams]);

  const results = useMemo(() => {
    const f = fold(q.trim());
    if (!f) return items.filter((i) => i.kind === "Page");
    const order: Item["kind"][] = ["Driver", "Team", "Track", "Car", "Page"];
    return items.map((i) => ({ i, s: score(i, f) })).filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || order.indexOf(a.i.kind) - order.indexOf(b.i.kind) || b.i.sub.localeCompare(a.i.sub))
      .slice(0, 12).map((x) => x.i);
  }, [items, q]);

  const close = () => { setOpen(false); opener.current?.focus(); };
  const go = (it: Item | undefined) => { if (!it) return; close(); nav(it.to); };

  return (
    <>
      <button ref={opener} type="button" className="search-btn" onClick={show} aria-label="Search drivers, teams, tracks and cars" aria-keyshortcuts="Control+K /">
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M13 13l4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        <span className="search-label">Search</span><kbd>Ctrl K</kbd>
      </button>
      {open && (
        <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div className="palette" role="dialog" aria-modal="true" aria-label="Search">
            <input
              ref={input} autoFocus value={q} placeholder="Driver, team, track or car…" aria-label="Search" role="combobox" aria-expanded="true"
              aria-controls="palette-list" aria-activedescendant={results[sel] ? `pal-${results[sel].key}` : undefined}
              onChange={(e) => { setQ(e.target.value); setSel(0); }}
              onKeyDown={(e) => {
                if (e.key === "Escape") { e.preventDefault(); close(); }
                else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
                else if (e.key === "Enter") { e.preventDefault(); go(results[sel]); }
                else if (e.key === "Tab") e.preventDefault(); // keep focus in the dialog
              }}
            />
            <ul id="palette-list" role="listbox">
              {results.map((it, i) => (
                <li key={it.key} id={`pal-${it.key}`} role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); go(it); }}>
                  <span className="pal-kind">{it.kind}</span>
                  {it.color && <i className="swatch" style={{ background: it.color }} />}
                  <span className="pal-label">{it.label}</span>
                  <span className="pal-sub">{it.sub !== "page" && it.sub !== "track" && it.sub !== "team" ? it.sub : ""}</span>
                </li>
              ))}
              {!results.length && <li className="pal-empty">No driver, team, track or car matches “{q}”.</li>}
            </ul>
            <div className="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div>
          </div>
        </div>
      )}
    </>
  );
}

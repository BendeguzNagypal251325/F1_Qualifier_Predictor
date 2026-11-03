// Original top-down car schematic, drawn from the public dimensions of each regulation era and
// coloured with the team's livery. Nose points right. Every part is a clickable hotspot.

export type PartId = "front-wing" | "nose" | "cockpit" | "sidepods" | "floor" | "power-unit" | "rear-wing" | "wheels";

export const PART_LABEL: Record<PartId, string> = {
  "front-wing": "Front wing",
  nose: "Nose & chassis",
  cockpit: "Cockpit & halo",
  sidepods: "Sidepods",
  floor: "Floor",
  "power-unit": "Power unit",
  "rear-wing": "Rear wing",
  wheels: "Tyres & suspension",
};
export const PART_ORDER: PartId[] = ["front-wing", "nose", "cockpit", "sidepods", "floor", "power-unit", "rear-wing", "wheels"];

// Era rules (public FIA technical-regulation figures).
export const ERA_SPECS: Record<string, { width: string; wheelbase: string; weight: string; wheels: string; extra: string }> = {
  "2017-2021": { width: "2.0 m", wheelbase: "not capped (~3.6–3.7 m)", weight: "746–752 kg", wheels: "13-inch", extra: "Bargeboards, DRS" },
  "2022-2025": { width: "2.0 m", wheelbase: "≤ 3.6 m", weight: "798–800 kg", wheels: "18-inch with covers", extra: "Venturi floor, DRS" },
  "2026-": { width: "1.9 m", wheelbase: "≤ 3.4 m", weight: "768 kg", wheels: "18-inch, narrower", extra: "Active front and rear wings, no DRS" },
};

interface Geo {
  half: number; // half track width to wheel outer edge
  rearX: number;
  frontX: number;
  wheelL: number;
  wheelW: number;
  fwHalf: number;
  rwHalf: number;
  noseTip: number;
  bargeboards: boolean;
  sculpted: boolean;
  active: boolean;
}

const GEO: Record<string, Geo> = {
  "2017-2021": { half: 156, rearX: 205, frontX: 742, wheelL: 96, wheelW: 62, fwHalf: 152, rwHalf: 68, noseTip: 905, bargeboards: true, sculpted: false, active: false },
  "2022-2025": { half: 156, rearX: 205, frontX: 730, wheelL: 108, wheelW: 60, fwHalf: 146, rwHalf: 74, noseTip: 898, bargeboards: false, sculpted: true, active: false },
  "2026-": { half: 148, rearX: 215, frontX: 700, wheelL: 104, wheelW: 54, fwHalf: 136, rwHalf: 70, noseTip: 870, bargeboards: false, sculpted: true, active: true },
};

const C = 200; // centre line

export function CarSchematic({ era, livery, selected, onSelect, chassis, compact = false }: {
  era: string;
  livery: [string, string, string];
  selected?: PartId | null;
  onSelect?: (p: PartId) => void;
  chassis?: string | null;
  compact?: boolean;
}) {
  const g = GEO[era] ?? GEO["2022-2025"];
  const [primary, secondary, accent] = livery;
  const floorFill = "#24262b";
  const tyre = "#17181b";
  const ink = "var(--ink)";
  const part = (id: PartId) => ({
    className: `part${selected === id ? " sel" : ""}`,
    onClick: onSelect ? () => onSelect(id) : undefined,
    onKeyDown: onSelect ? (e: React.KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(id)) : undefined,
    tabIndex: onSelect ? 0 : undefined,
    role: onSelect ? "button" : undefined,
    "aria-label": PART_LABEL[id],
    "aria-pressed": onSelect ? selected === id : undefined,
    "data-tip": onSelect ? `${PART_LABEL[id]}\nClick for details` : undefined,
  });
  const y = (dy: number) => C + dy;
  const inner = g.half - g.wheelW;

  // Floor outline: wide between the wheels, narrowing ahead of the sidepods.
  const floorFront = g.frontX - g.wheelL / 2 - 30;
  const floorRear = g.rearX + g.wheelL / 2 + 8;
  const fh = inner - 6;
  const floor = g.sculpted
    ? `M${floorRear},${y(-fh + 20)} L${floorRear + 40},${y(-fh)} L${floorFront - 70},${y(-fh)} Q${floorFront},${y(-fh + 4)} ${floorFront + 20},${y(-62)} L${floorFront + 20},${y(62)} Q${floorFront},${y(fh - 4)} ${floorFront - 70},${y(fh)} L${floorRear + 40},${y(fh)} L${floorRear},${y(fh - 20)} Z`
    : `M${floorRear},${y(-fh + 10)} L${floorFront - 40},${y(-fh)} L${floorFront + 10},${y(-70)} L${floorFront + 10},${y(70)} L${floorFront - 40},${y(fh)} L${floorRear},${y(fh - 10)} Z`;

  // Sidepods: boxy before 2022, sculpted "downwash" shape after.
  const spF = g.frontX - g.wheelL / 2 - 118, spR = g.rearX + 70, spW = g.sculpted ? fh - 14 : fh - 8;
  const sidepod = (s: 1 | -1) =>
    g.sculpted
      ? `M${spF},${y(s * 44)} L${spF},${y(s * spW)} Q${spF - 50},${y(s * (spW + 4))} ${spF - 120},${y(s * (spW - 18))} Q${spR + 60},${y(s * 60)} ${spR},${y(s * 40)} L${spR},${y(s * 30)} Z`
      : `M${spF},${y(s * 44)} L${spF},${y(s * spW)} L${spF - 150},${y(s * spW)} Q${spR + 50},${y(s * (spW - 20))} ${spR},${y(s * 40)} L${spR},${y(s * 30)} Z`;

  const cockpitX = g.frontX - g.wheelL / 2 - 150;
  const nose = `M${cockpitX + 20},${y(-46)} L${g.noseTip - 60},${y(-20)} Q${g.noseTip},${y(-14)} ${g.noseTip},${y(0)} Q${g.noseTip},${y(14)} ${g.noseTip - 60},${y(20)} L${cockpitX + 20},${y(46)} Z`;
  const engine = `M${cockpitX - 10},${y(-42)} L${g.rearX + 10},${y(-20)} L${g.rearX - 10},${y(-12)} L${g.rearX - 10},${y(12)} L${g.rearX + 10},${y(20)} L${cockpitX - 10},${y(42)} Z`;
  const fwX = g.noseTip - 44;
  const rwX = g.rearX - g.wheelL / 2 - 52;

  const wheel = (x: number, s: 1 | -1) => (
    <rect x={x - g.wheelL / 2} y={s < 0 ? y(-g.half) : y(inner)} width={g.wheelL} height={g.wheelW} rx={g.sculpted ? 14 : 10} fill={tyre} stroke="var(--ink-2)" strokeOpacity={0.6} strokeWidth={1.5} />
  );
  const arms = (x: number, s: 1 | -1) => (
    <g stroke={ink} strokeWidth={2} opacity={0.6}>
      <line x1={x - 20} y1={y(s * inner)} x2={x - 60} y2={y(s * 40)} />
      <line x1={x + 20} y1={y(s * inner)} x2={x + 40} y2={y(s * 40)} />
    </g>
  );

  return (
    <svg className={`schematic${selected ? " dim" : ""}`} viewBox={compact ? "40 30 900 340" : "0 0 1000 430"} role="img" aria-label={`${chassis ?? "Car"} top-down schematic`}>
      {/* floor */}
      <g {...part("floor")}>
        <path d={floor} fill={floorFill} stroke="#000" strokeWidth={1} />
        {g.sculpted && <path d={`M${floorFront - 120},${y(-fh + 2)} L${floorRear + 60},${y(-fh + 2)} M${floorFront - 120},${y(fh - 2)} L${floorRear + 60},${y(fh - 2)}`} stroke={accent} strokeWidth={2} opacity={0.7} fill="none" />}
      </g>
      {/* wheels & suspension */}
      <g {...part("wheels")}>
        {arms(g.frontX, -1)}{arms(g.frontX, 1)}{arms(g.rearX, -1)}{arms(g.rearX, 1)}
        {wheel(g.frontX, -1)}{wheel(g.frontX, 1)}{wheel(g.rearX, -1)}{wheel(g.rearX, 1)}
      </g>
      {/* sidepods (+ bargeboards in the 2017-2021 era) */}
      <g {...part("sidepods")}>
        <path d={sidepod(-1)} fill={primary} stroke="#000" strokeWidth={1} />
        <path d={sidepod(1)} fill={primary} stroke="#000" strokeWidth={1} />
        <path d={`M${spF - 6},${y(-spW + 6)} L${spF - 130},${y(-spW + 10)} M${spF - 6},${y(spW - 6)} L${spF - 130},${y(spW - 10)}`} stroke={secondary} strokeWidth={8} strokeLinecap="round" fill="none" />
        <rect x={spF - 6} y={y(-spW)} width={8} height={spW - 44} fill="#0b0b0c" />
        <rect x={spF - 6} y={y(44)} width={8} height={spW - 44} fill="#0b0b0c" />
        {g.bargeboards && [-1, 1].map((s) => (
          <path key={s} d={`M${spF + 18},${y(s * 52)} Q${spF + 50},${y(s * (spW + 6))} ${spF + 90},${y(s * (spW - 2))}`} stroke={accent} strokeWidth={5} fill="none" strokeLinecap="round" />
        ))}
      </g>
      {/* power unit / engine cover */}
      <g {...part("power-unit")}>
        <path d={engine} fill={primary} stroke="#000" strokeWidth={1} />
        <path d={`M${cockpitX - 14},${y(0)} L${g.rearX},${y(0)}`} stroke={secondary} strokeWidth={10} strokeLinecap="round" />
        <ellipse cx={cockpitX - 26} cy={C} rx={22} ry={16} fill="#0b0b0c" stroke={secondary} strokeWidth={2} />
      </g>
      {/* nose & chassis */}
      <g {...part("nose")}>
        <path d={nose} fill={primary} stroke="#000" strokeWidth={1} />
        <path d={`M${cockpitX + 80},${y(0)} L${g.noseTip - 20},${y(0)}`} stroke={secondary} strokeWidth={6} strokeLinecap="round" />
      </g>
      {/* cockpit & halo */}
      <g {...part("cockpit")}>
        <rect x={cockpitX - 4} y={y(-30)} width={104} height={60} rx={26} fill="#0b0b0c" />
        <circle cx={cockpitX + 30} cy={C} r={17} fill={accent} stroke="#000" strokeWidth={1} />
        <path d={`M${cockpitX + 120},${y(0)} L${cockpitX + 96},${y(0)} M${cockpitX + 96},${y(0)} Q${cockpitX + 60},${y(-36)} ${cockpitX - 6},${y(-30)} M${cockpitX + 96},${y(0)} Q${cockpitX + 60},${y(36)} ${cockpitX - 6},${y(30)}`} stroke="#3a3d44" strokeWidth={7} fill="none" strokeLinecap="round" />
      </g>
      {/* front wing */}
      <g {...part("front-wing")}>
        <path d={`M${fwX},${y(-g.fwHalf)} Q${fwX + 30},${y(-60)} ${fwX + 34},${y(0)} Q${fwX + 30},${y(60)} ${fwX},${y(g.fwHalf)} L${fwX - 22},${y(g.fwHalf)} Q${fwX + 4},${y(60)} ${fwX + 8},${y(0)} Q${fwX + 4},${y(-60)} ${fwX - 22},${y(-g.fwHalf)} Z`} fill={secondary} stroke="#000" strokeWidth={1} />
        {(g.bargeboards ? [6, 14, 22] : [10, 20]).map((o) => (
          <path key={o} d={`M${fwX - 18 + o * 0.4},${y(-g.fwHalf + 4)} Q${fwX + o},${y(-50)} ${fwX + 10 + o * 0.5},${y(-20)} M${fwX - 18 + o * 0.4},${y(g.fwHalf - 4)} Q${fwX + o},${y(50)} ${fwX + 10 + o * 0.5},${y(20)}`} stroke="#000" strokeOpacity={0.45} strokeWidth={1.2} fill="none" />
        ))}
        <rect x={fwX - 34} y={y(-g.fwHalf - 6)} width={36} height={8} rx={2} fill={accent} stroke="#000" strokeWidth={1} />
        <rect x={fwX - 34} y={y(g.fwHalf - 2)} width={36} height={8} rx={2} fill={accent} stroke="#000" strokeWidth={1} />
        {g.active && <path d={`M${fwX + 2},${y(-g.fwHalf + 10)} Q${fwX + 22},${y(-40)} ${fwX + 24},${y(0)} Q${fwX + 22},${y(40)} ${fwX + 2},${y(g.fwHalf - 10)}`} stroke={ink} strokeDasharray="5 4" strokeWidth={2} fill="none" />}
      </g>
      {/* rear wing */}
      <g {...part("rear-wing")}>
        <rect x={rwX} y={y(-g.rwHalf)} width={46} height={g.rwHalf * 2} rx={4} fill={secondary} stroke="#000" strokeWidth={1} />
        <rect x={rwX + 28} y={y(-g.rwHalf)} width={14} height={g.rwHalf * 2} fill="#000" opacity={0.25} />
        <rect x={rwX - 4} y={y(-g.rwHalf - 8)} width={54} height={10} rx={2} fill={accent} stroke="#000" strokeWidth={1} />
        <rect x={rwX - 4} y={y(g.rwHalf - 2)} width={54} height={10} rx={2} fill={accent} stroke="#000" strokeWidth={1} />
        <line x1={rwX + 46} y1={C} x2={g.rearX - 12} y2={C} stroke={ink} strokeWidth={3} />
        {g.active && <line x1={rwX + 35} y1={y(-g.rwHalf + 6)} x2={rwX + 35} y2={y(g.rwHalf - 6)} stroke={ink} strokeDasharray="5 4" strokeWidth={2} />}
      </g>
      {!compact && (
        <g className="dims">
          <line x1={g.rearX} x2={g.frontX} y1={412} y2={412} />
          <line x1={g.rearX} x2={g.rearX} y1={402} y2={420} />
          <line x1={g.frontX} x2={g.frontX} y1={402} y2={420} />
          <text x={(g.rearX + g.frontX) / 2} y={406} textAnchor="middle">wheelbase {ERA_SPECS[era]?.wheelbase}</text>
          <line x1={980} x2={980} y1={y(-g.half)} y2={y(g.half)} />
          <text x={972} y={C} textAnchor="middle" transform={`rotate(-90 972 ${C})`}>width {ERA_SPECS[era]?.width}</text>
          {g.active && <text x={fwX - 10} y={y(-g.fwHalf - 16)} textAnchor="middle">active aero</text>}
        </g>
      )}
    </svg>
  );
}

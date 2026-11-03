// Gridcast brand: the mark (two staggered starting-grid slots on a red plate) and the wordmark.

export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size * 1.2} height={size} viewBox="0 6 48 40" aria-hidden className="logo-mark">
      <g className="logo-speed" stroke="#ff2a3a" strokeLinecap="round">
        <line x1="0" y1="14" x2="9" y2="14" strokeWidth="2" opacity="0.9" />
        <line x1="-3" y1="22" x2="6" y2="22" strokeWidth="2" opacity="0.6" />
        <line x1="-6" y1="30" x2="3" y2="30" strokeWidth="2" opacity="0.35" />
      </g>
      <path d="M15 9h29l-11 30H4z" fill="#ff2a3a" />
      <path d="M33.5 15.5h-8l-2.2 6h8M27 26.5h-8l-2.2 6h8" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <LogoMark />
      <span className="word">GRID<b>CAST</b></span>
    </span>
  );
}

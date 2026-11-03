// Fixed background of neon red speed streaks, alternating bright and dim, drifting slowly.
// Pure CSS transforms (cheap to animate); static when the visitor prefers reduced motion.

const LINES: { top: number; left: number; w: number; bright: boolean; dur: number; delay: number }[] = [
  { top: 6, left: 58, w: 34, bright: true, dur: 9, delay: 0 },
  { top: 14, left: 8, w: 22, bright: false, dur: 12, delay: -4 },
  { top: 27, left: 70, w: 26, bright: false, dur: 11, delay: -2 },
  { top: 36, left: -4, w: 30, bright: true, dur: 10, delay: -7 },
  { top: 52, left: 62, w: 38, bright: true, dur: 13, delay: -3 },
  { top: 61, left: 20, w: 18, bright: false, dur: 9, delay: -6 },
  { top: 74, left: 76, w: 24, bright: false, dur: 12, delay: -1 },
  { top: 83, left: 4, w: 36, bright: true, dur: 11, delay: -5 },
  { top: 94, left: 48, w: 28, bright: false, dur: 10, delay: -8 },
  { top: 20, left: 34, w: 16, bright: true, dur: 14, delay: -9 },
  { top: 45, left: 40, w: 20, bright: false, dur: 15, delay: -11 },
  { top: 68, left: 50, w: 22, bright: true, dur: 12, delay: -2 },
];

export function SpeedLines() {
  return (
    <div className="speedlines" aria-hidden>
      {LINES.map((l, i) => (
        <span
          key={i}
          className={l.bright ? "bright" : "dim"}
          style={{ top: `${l.top}%`, left: `${l.left}%`, width: `${l.w}vw`, animationDuration: `${l.dur}s`, animationDelay: `${l.delay}s` }}
        />
      ))}
    </div>
  );
}

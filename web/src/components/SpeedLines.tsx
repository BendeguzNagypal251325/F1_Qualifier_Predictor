// Fixed background of faint red speed streaks, alternating bright and dim. Each streak glides along a
// diagonal lane that is wider than the screen and loops while it is off-screen, so the motion never
// visibly resets. Pure CSS transforms (cheap to animate); static for visitors who prefer reduced motion.

const LINES: { top: number; w: number; bright: boolean; dur: number; delay: number }[] = [
  { top: 8, w: 30, bright: true, dur: 34, delay: -6 },
  { top: 19, w: 18, bright: false, dur: 46, delay: -30 },
  { top: 31, w: 26, bright: false, dur: 40, delay: -12 },
  { top: 42, w: 34, bright: true, dur: 52, delay: -40 },
  { top: 55, w: 20, bright: false, dur: 38, delay: -22 },
  { top: 66, w: 28, bright: true, dur: 44, delay: -9 },
  { top: 78, w: 22, bright: false, dur: 50, delay: -35 },
  { top: 90, w: 32, bright: true, dur: 42, delay: -18 },
];

export function SpeedLines() {
  return (
    <div className="speedlines" aria-hidden>
      {LINES.map((l, i) => (
        <div key={i} className="lane" style={{ top: `${l.top}%` }}>
          <span
            className={l.bright ? "bright" : "dim"}
            style={{ width: `${l.w}vw`, animationDuration: `${l.dur}s`, animationDelay: `${l.delay}s` }}
          />
        </div>
      ))}
    </div>
  );
}

export default function PacingChart({ quota, closedWonEvents = [], quarterStart, quarterEnd, today }) {
  if (!quota || !quarterStart || !quarterEnd) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 80, color: "#333", fontFamily: "monospace", fontSize: 11 }}>
        Set quota to see pacing chart
      </div>
    );
  }

  const W = 600, H = 120;
  const PAD = { top: 18, bottom: 18, left: 8, right: 8 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const qStart  = quarterStart.getTime();
  const qEnd    = quarterEnd.getTime();
  const todayMs = Math.min(today.getTime(), qEnd);

  const toX = (ms)  => PAD.left + ((ms - qStart) / (qEnd - qStart)) * chartW;
  const toY = (amt) => PAD.top  + (1 - Math.min(amt / quota, 1.05)) * chartH;

  // Sort and filter to current quarter
  const sorted = [...closedWonEvents]
    .filter(w => w.closedAt)
    .sort((a, b) => new Date(a.closedAt) - new Date(b.closedAt))
    .filter(w => {
      const ms = new Date(w.closedAt).getTime();
      return ms >= qStart && ms <= qEnd;
    });

  // Build step function: [qStart @$0] → horizontal+vertical per event → [today @cumTotal]
  let cumulative = 0;
  const stepPts = [[toX(qStart), toY(0)]];
  for (const ev of sorted) {
    const ms  = new Date(ev.closedAt).getTime();
    const acv = ev.acv || 0;
    stepPts.push([toX(ms), toY(cumulative)]);  // horizontal segment to this date
    cumulative += acv;
    stepPts.push([toX(ms), toY(cumulative)]);  // vertical jump up
  }
  stepPts.push([toX(todayMs), toY(cumulative)]);

  const stepPolyline = stepPts.map(([x, y]) => `${x},${y}`).join(" ");

  // Gap polygon: pace line forward (qStart→today), then step function reversed (today→qStart)
  const paceAtToday = quota * ((todayMs - qStart) / (qEnd - qStart));
  const isOnPace    = cumulative >= paceAtToday;

  const gapPoints = [
    [toX(qStart),  toY(0)],              // pace origin
    [toX(todayMs), toY(paceAtToday)],    // pace at today
    ...stepPts.slice().reverse(),         // step function reversed: today → qStart
  ].map(([x, y]) => `${x},${y}`).join(" ");

  const gapFill = isOnPace ? "#166834" : "#7f1d1d";

  // Labels
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const qStartLabel = `${months[quarterStart.getMonth()]} ${quarterStart.getDate()}`;
  const qEndLabel   = `${months[quarterEnd.getMonth()]} ${quarterEnd.getDate()}`;
  const currentQ    = ["Q1","Q1","Q1","Q2","Q2","Q2","Q3","Q3","Q3","Q4","Q4","Q4"][quarterStart.getMonth()];
  const yr          = quarterStart.getFullYear();
  const onPaceLabel = isOnPace ? "On pace ✦" : "Behind pace";
  const onPaceColor = isOnPace ? "#22c55e" : "#ef4444";
  const todayX      = toX(todayMs);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} xmlns="http://www.w3.org/2000/svg">
      {/* Gap shading — between step line and pace diagonal, up to today */}
      <polygon points={gapPoints} fill={gapFill} opacity={0.15} />

      {/* Pace line — full quarter diagonal regardless of today */}
      <polyline
        points={`${toX(qStart)},${toY(0)} ${toX(qEnd)},${toY(quota)}`}
        fill="none" stroke="#ffffff" strokeWidth={1} strokeDasharray="4 4" opacity={0.3}
      />

      {/* Amber step function — staircase, no dots */}
      <polyline
        points={stepPolyline}
        fill="none"
        stroke="#f59e0b"
        strokeWidth={2}
        style={{ filter: "drop-shadow(0 0 4px #f59e0b)" }}
      />

      {/* Today marker */}
      <line x1={todayX} y1={PAD.top} x2={todayX} y2={H - PAD.bottom}
        stroke="#f59e0b" strokeWidth={1} opacity={0.6} strokeDasharray="2 2" />
      <circle cx={todayX} cy={PAD.top} r={3} fill="#f59e0b" opacity={0.7} />

      {/* Labels */}
      <text x={PAD.left}     y={PAD.top - 4} fontFamily="monospace" fontSize={9} fill="#444">{currentQ} {yr}</text>
      <text x={W - PAD.right} y={PAD.top - 4} fontFamily="monospace" fontSize={9} fill={onPaceColor} textAnchor="end">{onPaceLabel}</text>
      <text x={PAD.left}     y={H - 3}       fontFamily="monospace" fontSize={9} fill="#444">{qStartLabel}</text>
      <text x={W - PAD.right} y={H - 3}       fontFamily="monospace" fontSize={9} fill="#444" textAnchor="end">{qEndLabel}</text>
    </svg>
  );
}

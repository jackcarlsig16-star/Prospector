import { mono } from '../constants/colors';

const fmtK = v => v >= 1000000 ? `$${(v/1000000).toFixed(1)}M` : v >= 1000 ? `$${Math.round(v/1000)}K` : `$${Math.round(v)}`;

export default function ForecastGapChart({ quota, closedWonQTD, commitTotal, bestCaseTotal }) {
  const total = quota || 0;
  const gap = Math.max(0, total - closedWonQTD - commitTotal);
  const attainPct = total > 0 ? Math.min(100, Math.round(((closedWonQTD + commitTotal) / total) * 100)) : 0;
  const onTrack = total > 0 && (closedWonQTD + commitTotal) >= total;

  // Arc geometry — semicircle
  const W = 160, H = 90, CX = 80, CY = 88, R = 70, stroke = 14;
  const toRad = deg => (deg * Math.PI) / 180;
  const arcPt = deg => ({ x: CX + R * Math.cos(toRad(deg)), y: CY + R * Math.sin(toRad(deg)) });

  // Map value to degree on 180° arc (-180 to 0, i.e., left to right along top)
  const valToDeg = v => total > 0 ? -180 + Math.min(1, v / total) * 180 : -180;

  const closedEnd  = valToDeg(closedWonQTD);
  const commitEnd  = valToDeg(closedWonQTD + commitTotal);
  const bestEnd    = valToDeg(closedWonQTD + commitTotal + bestCaseTotal);

  const arcPath = (startDeg, endDeg, large) => {
    if (Math.abs(endDeg - startDeg) < 0.5) return null;
    const s = arcPt(startDeg); const e = arcPt(endDeg);
    const lg = large ? 1 : 0;
    return `M${s.x} ${s.y} A${R} ${R} 0 ${lg} 1 ${e.x} ${e.y}`;
  };

  const segments = [
    { start: -180, end: closedEnd,  color: '#22c55e', large: closedWonQTD / (total||1) > 0.5 },
    { start: closedEnd, end: commitEnd,  color: '#2dd4bf', large: commitTotal / (total||1) > 0.5 },
    { start: commitEnd, end: bestEnd,    color: '#f59e0b', large: bestCaseTotal / (total||1) > 0.5 },
    { start: bestEnd,   end: 0,          color: '#1e1e1e', large: false },
  ].filter(s => Math.abs(s.end - s.start) > 0.5);

  if (!total) {
    return (
      <div style={{ padding: '10px 8px' }}>
        <p style={{ ...mono, fontSize: 9, color: '#444', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 6px' }}>Forecast Gap</p>
        <span style={{ ...mono, fontSize: 11, color: '#333' }}>Set quota to enable</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <p style={{ ...mono, fontSize: 9, color: '#444', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 2px', alignSelf: 'flex-start' }}>Forecast Gap</p>
      <svg width={W} height={H} style={{ overflow: 'visible' }}>
        {/* Background track */}
        <path d={`M${arcPt(-180).x} ${arcPt(-180).y} A${R} ${R} 0 0 1 ${arcPt(0).x} ${arcPt(0).y}`}
          fill="none" stroke="#1a1a1a" strokeWidth={stroke} strokeLinecap="round" />
        {onTrack ? (
          /* Over quota — solid green full arc */
          <path d={`M${arcPt(-180).x} ${arcPt(-180).y} A${R} ${R} 0 0 1 ${arcPt(0).x} ${arcPt(0).y}`}
            fill="none" stroke="#22c55e" strokeWidth={stroke} strokeLinecap="round" />
        ) : (
          /* Multi-segment arc */
          segments.map((seg, i) => {
            const d = arcPath(seg.start, seg.end, seg.large);
            return d ? <path key={i} d={d} fill="none" stroke={seg.color} strokeWidth={stroke} strokeLinecap="butt" /> : null;
          })
        )}
        {/* Center label */}
        <text x={CX} y={CY - 18} textAnchor="middle" fill={onTrack ? '#22c55e' : '#ccc'} style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 700 }}>
          {attainPct}%
        </text>
        <text x={CX} y={CY - 4} textAnchor="middle" fill={onTrack ? '#22c55e88' : '#444'} style={{ fontFamily: 'monospace', fontSize: 9 }}>
          {onTrack ? '✓ on track' : 'to quota'}
        </text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%', marginTop: 2 }}>
        {[
          { label: 'Closed', val: closedWonQTD, color: '#22c55e' },
          { label: 'Commit', val: commitTotal,  color: '#2dd4bf' },
          { label: 'Best Case', val: bestCaseTotal, color: '#f59e0b' },
          { label: 'Gap', val: gap, color: gap === 0 ? '#22c55e' : '#ef4444' },
        ].map(row => (
          <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ ...mono, fontSize: 9, color: row.color }}>{row.label}</span>
            <span style={{ ...mono, fontSize: 9, color: row.color, fontWeight: 600 }}>{fmtK(row.val)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

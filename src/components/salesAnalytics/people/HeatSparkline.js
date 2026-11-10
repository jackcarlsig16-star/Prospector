import { SA } from '../theme';
import { HEAT_COLOR } from './HeatPill';

// heat-v2 H5 - the pinned card's 30-day heat line: inline SVG on the kit's tokens (no chart library), one dot per stored
// day in its band color, faint guides at the two brackets. "—" until a day row exists (history starts the day the
// Stage 1 migration ran).
const W = 240, H = 44, PAD = 4;
const mdy = d => new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export default function HeatSparkline({ history = [], rule = { hot: 40, warm: 10 } }) {
  if (!history.length) return <span data-heat-sparkline="empty" style={{ color: SA.muted, fontSize: 12 }}>— no history yet</span>;
  const top = Math.max(rule.hot, ...history.map(p => p.heat)) * 1.1;
  const n = history.length;
  const x = i => PAD + (n > 1 ? ((W - 2 * PAD) * i) / (n - 1) : (W - 2 * PAD) / 2);
  const y = v => H - PAD - ((H - 2 * PAD) * v) / top;
  const d = history.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.heat).toFixed(1)}`).join(' ');
  const summary = history.map(p => `${mdy(p.day)} ${p.heat} ${p.band}`).join(', ');
  return (
    <svg data-heat-sparkline={n} role="img" aria-label={`Heat over the last 30 days: ${summary}`} width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', maxWidth: '100%', overflow: 'visible' }}>
      {[rule.hot, rule.warm].map(t => <line key={t} x1={PAD} x2={W - PAD} y1={y(t)} y2={y(t)} stroke={SA.border} strokeWidth="1" strokeDasharray="2 3" />)}
      <path d={d} fill="none" stroke={SA.muted} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {history.map((p, i) => <circle key={p.day} cx={x(i)} cy={y(p.heat)} r={i === n - 1 ? 3.5 : 2.5} fill={HEAT_COLOR[p.band] || HEAT_COLOR.cold} stroke={SA.surface} strokeWidth="1.5"><title>{`${mdy(p.day)} · ${p.heat} ${p.band}`}</title></circle>)}
    </svg>
  );
}

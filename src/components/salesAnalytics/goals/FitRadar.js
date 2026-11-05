import { SA } from '../theme';
import { numStyle } from './goalsUi';
import { Card } from './CompanyPanelSections';
import { FIT_AXES } from '../../../constants/fitLevels';

// homelover-flow-v1 F3 - "Fit at a glance" (mockup A): six axes 0-100 from GET goals/fit, drawn as a hand-built SVG radar
// (400 x 310 like the mockup, scales with the card). An axis with no data is "—": drawn at the centre as a hollow
// marker on a dotted spoke, never a fake 0. Two series at most - this account (accent, solid) and "Your clients (avg)"
// (good, dashed) - with a legend and, beside the plot, one row per axis (name, why, bar, value) that doubles as the
// table view. Text wears text tokens; the series color sits on the mark only. 0 Claude, 0 Apollo: the score inputs.
const W = 440, H = 310, CX = 220, CY = 152, R = 100;
const RINGS = [25, 50, 75, 100];
const angle = i => -Math.PI / 2 + (i * 2 * Math.PI) / FIT_AXES.length;
const pt = (i, v) => { const a = angle(i), r = (R * Math.max(0, Math.min(100, v))) / 100; return [CX + r * Math.cos(a), CY + r * Math.sin(a)]; };
const poly = values => values.map((v, i) => (v == null ? [CX, CY] : pt(i, v))).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
const tone = v => (v == null ? SA.muted : v >= 70 ? SA.good : v >= 45 ? SA.warn : SA.muted);
const LABEL_OFFSET = { 0: [0, -14], 1: [14, -2], 2: [14, 12], 3: [0, 20], 4: [-14, 12], 5: [-14, -2] };
const ANCHOR = { 0: 'middle', 1: 'start', 2: 'start', 3: 'middle', 4: 'end', 5: 'end' };

export function Radar({ axes, overlay = null, name = 'This account' }) {
  const values = FIT_AXES.map(([id]) => axes?.[id]?.value ?? null);
  const ov = overlay && overlay.n > 0 ? FIT_AXES.map(([id]) => overlay.axes?.[id] ?? null) : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Fit radar: ${FIT_AXES.map(([id, label], i) => `${label} ${values[i] == null ? 'no data' : values[i]}`).join(', ')}`} data-fit-radar style={{ width: '100%', maxWidth: W, height: 'auto', display: 'block' }}>
      {RINGS.map(r => <polygon key={r} points={poly(FIT_AXES.map(() => r))} fill="none" stroke={SA.border} strokeWidth={r === 100 ? 1 : 0.75} />)}
      {FIT_AXES.map(([id, label], i) => {
        const [x, y] = pt(i, 100), [dx, dy] = LABEL_OFFSET[i];
        const missing = values[i] == null;
        return (
          <g key={id} data-axis={id} data-missing={missing || undefined}>
            <title>{`${label}: ${missing ? 'no data' : values[i]}${axes?.[id]?.why ? ` · ${axes[id].why}` : ''}`}</title>
            <line x1={CX} y1={CY} x2={x} y2={y} stroke={missing ? SA.muted : SA.border} strokeWidth={1} strokeDasharray={missing ? '2 4' : undefined} />
            <text x={x + dx} y={y + dy} textAnchor={ANCHOR[i]} dominantBaseline="middle" fontSize={12} fill={missing ? SA.muted : SA.text}>{label}{missing ? ' —' : ''}</text>
          </g>
        );
      })}
      {ov && <polygon data-series="clients" points={poly(ov)} fill={`color-mix(in srgb, ${SA.good} 8%, transparent)`} stroke={SA.good} strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" />}
      <polygon data-series="account" points={poly(values)} fill={`color-mix(in srgb, ${SA.accent} 22%, transparent)`} stroke={SA.accent} strokeWidth={2} strokeLinejoin="round" />
      {values.map((v, i) => { const [x, y] = v == null ? [CX, CY] : pt(i, v); return <circle key={i} data-point={FIT_AXES[i][0]} cx={x} cy={y} r={4} fill={v == null ? SA.surface : SA.accent} stroke={v == null ? SA.muted : SA.surface} strokeWidth={v == null ? 1.5 : 2} strokeDasharray={v == null ? '2 2' : undefined} />; })}
      <g data-legend transform={`translate(${CX - 110} ${H - 12})`} fontSize={11.5} fill={SA.muted}>
        <line x1={0} y1={0} x2={18} y2={0} stroke={SA.accent} strokeWidth={2} /><text x={24} y={0} dominantBaseline="middle">{name}</text>
        {ov && <><line x1={120} y1={0} x2={138} y2={0} stroke={SA.good} strokeWidth={2} strokeDasharray="5 4" /><text x={144} y={0} dominantBaseline="middle">Your clients (avg{overlay.n === 1 ? ' of 1 client' : ` of ${overlay.n}`})</text></>}
      </g>
    </svg>
  );
}

export function AxisRows({ axes }) {
  return (
    <div role="table" aria-label="Fit axes" style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1fr) 96px 32px', gap: '8px 10px', alignItems: 'center', fontSize: 13 }}>
      {FIT_AXES.map(([id, label]) => {
        const a = axes?.[id] || {}; const v = a.value ?? null;
        return (
          <div key={id} role="row" data-axis-row={id} style={{ display: 'contents' }}>
            <span role="cell" style={{ minWidth: 0 }}><b style={{ display: 'block', fontWeight: 600, color: SA.text }}>{label}</b><span style={{ display: 'block', fontSize: 11.5, color: SA.muted, overflowWrap: 'anywhere' }}>{a.why || '—'}</span></span>
            <span role="cell" aria-hidden="true" style={{ height: 6, borderRadius: 3, background: SA.track, overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${v ?? 0}%`, borderRadius: 3, background: tone(v) }} /></span>
            <span role="cell" style={{ ...numStyle, textAlign: 'right', fontWeight: 600, color: v == null ? SA.muted : SA.text }}>{v == null ? '—' : v}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function FitCard({ fit, wide = true }) {
  const axes = fit ? Object.fromEntries((fit.axes || []).map(a => [a.id, a])) : null;
  const score = fit?.score != null ? `${fit.score} · ${fit.used} of ${fit.of}` : null;
  return (
    <Card label="Fit at a glance" testId="fit" action={<span style={{ fontSize: 12, color: SA.muted }}>{fit ? `0–100 per axis · hover an axis for "why"${score ? ` · fit ${score}` : ''}` : 'no score yet'}</span>}>
      {!fit && <span style={{ fontSize: 13, color: SA.muted }}>No score yet - recompute from the Intent chip.</span>}
      {fit && (
        <div style={{ display: 'grid', gridTemplateColumns: wide ? 'minmax(300px, 440px) minmax(260px, 1fr)' : '1fr', gap: 18, alignItems: 'start' }}>
          <Radar axes={axes} overlay={fit.overlay} />
          <AxisRows axes={axes} />
        </div>
      )}
    </Card>
  );
}

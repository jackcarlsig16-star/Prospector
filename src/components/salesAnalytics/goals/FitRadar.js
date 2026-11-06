import { SA } from '../theme';
import { numStyle } from './goalsUi';
import { Card } from './CompanyPanelSections';
import { RING_ORDER, DEFAULT_CAPS } from './priorities/prioritiesModel';

// company-window-v4 B1 - the Fit card beside Intel: a five-axis radar over the Map's RING_ORDER components (Visits ·
// People · Fit · Research · Engagement) from GET goals/scores/:type/:id - the same sales_company_scores row and caps the
// Map's rings draw, so the picture is the dot's rings. Each axis = points / cap; the list beside carries the numbers.
// Dashed polygon + "no score yet" until the first recompute, solid once scored. "Recompute score" = the Intent fact's
// recompute (Members). 0 Claude, 0 Apollo: the stored score only.
const AXIS_LABEL = { visits: 'Visits', people: 'People', fit: 'Fit', research: 'Research', engagement: 'Engagement' };
// The box leaves room for the axis words outside the pentagon (Engagement on the left, People on the right).
const W = 264, H = 170, CX = 132, CY = 90, R = 62;
const RINGS = [1, 0.66, 0.33];
const angle = i => -Math.PI / 2 + (i * 2 * Math.PI) / RING_ORDER.length;
const pt = (i, f) => [CX + R * f * Math.cos(angle(i)), CY + R * f * Math.sin(angle(i))];
const poly = fs => fs.map((f, i) => pt(i, f)).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
const LABEL = [[0, -10, 'middle'], [8, 0, 'start'], [6, 14, 'start'], [-6, 14, 'end'], [-8, 0, 'end']];
const when = at => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// -> [{ key, label, points, cap, value }] with value = points / cap clamped to 0..1 (the ring rule), null without a score.
export function radarAxes(score) {
  const comps = score?.row?.components || null;
  const caps = { ...DEFAULT_CAPS, ...(score?.caps || {}) };
  return RING_ORDER.map(key => {
    const points = comps ? Number(comps[key]?.points || 0) : null;
    const cap = caps[key] || DEFAULT_CAPS[key] || 10;
    return { key, label: AXIS_LABEL[key], points, cap, value: points == null ? null : Math.max(0, Math.min(1, points / cap)) };
  });
}

function Number_({ a }) {
  if (a.points == null) return <><b style={{ ...numStyle, color: SA.muted }}>—</b> of {a.cap}</>;
  if (a.key === 'research' && a.points > 0) return <><b style={{ ...numStyle, color: SA.good }}>✓</b> {a.points}</>;
  if (a.points < 0) return <><b style={{ ...numStyle, color: SA.bad }}>{a.points}</b> of {a.cap}</>;
  return <><b style={{ ...numStyle, color: SA.text }}>{a.points}</b> of {a.cap}</>;
}

export default function FitRadar({ score, canEdit, busy = false, onRecompute }) {
  const axes = radarAxes(score);
  const scored = !!score?.row;
  const values = axes.map(a => (a.value == null ? 0.3 : a.value));
  const status = scored ? `intent components · score ${score.row.score}${score.row.computed_at ? ` · ${when(score.row.computed_at)}` : ''}` : 'intent components · no score yet';
  return (
    <Card label="Fit" testId="fit" action={<span data-fit-status style={{ fontSize: 12, color: SA.muted }}>{status}</span>}>
      <div data-fit-radar={scored ? 'scored' : 'none'} style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Fit radar: ${scored ? axes.map(a => `${a.label} ${a.points} of ${a.cap}`).join(', ') : 'no score yet'}`} style={{ flex: '1 1 180px', minWidth: 160, maxWidth: W, height: 'auto', display: 'block' }}>
          <g fill="none" stroke={SA.border}>{RINGS.map(r => <polygon key={r} points={poly(RING_ORDER.map(() => r))} />)}</g>
          <g stroke={SA.border}>{RING_ORDER.map((k, i) => { const [x, y] = pt(i, 1); return <line key={k} x1={CX} y1={CY} x2={x.toFixed(1)} y2={y.toFixed(1)} />; })}</g>
          <polygon data-fit-polygon points={poly(values)} fill={SA.accent} fillOpacity={scored ? 0.22 : 0.12} stroke={SA.accent} strokeWidth={1.5} strokeLinejoin="round" strokeDasharray={scored ? undefined : '4 3'} />
          {scored && values.map((v, i) => { const [x, y] = pt(i, v); return <circle key={RING_ORDER[i]} cx={x.toFixed(1)} cy={y.toFixed(1)} r={3} fill={SA.accent} />; })}
          <g fontSize={10} fill={SA.muted}>
            {axes.map((a, i) => { const [x, y] = pt(i, 1), [dx, dy, anchor] = LABEL[i]; return <text key={a.key} x={(x + dx).toFixed(1)} y={(y + dy).toFixed(1)} textAnchor={anchor} dominantBaseline="middle">{a.label}</text>; })}
          </g>
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: SA.soft, flex: 'none' }}>
          {axes.map(a => <span key={a.key} data-axis={a.key} data-points={a.points ?? ''} data-cap={a.cap}>{a.label} <Number_ a={a} /></span>)}
          {canEdit && <span><button type="button" className="ui-link" data-recompute-score disabled={busy} onClick={onRecompute} style={{ fontSize: 12 }}>{busy ? 'Recomputing…' : 'Recompute score'}</button></span>}
        </div>
      </div>
    </Card>
  );
}

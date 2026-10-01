import { SA, SA_TYPE, SA_SHAPE } from './theme';
import { STAGE_LABELS } from './pipelineStages';

const FIELDS = [
  ['decision_makers', 'Decision makers'], ['champion', 'Champion'], ['objections', 'Objections'],
  ['competitors', 'Competitors'], ['next_action', 'Next step'], ['needed_to_advance', 'Needed to advance'],
];

export default function TopOpportunities({ opportunities }) {
  const rows = opportunities.filter(o => o.is_top);

  if (!rows.length) {
    return <p style={{ fontSize: 12, color: SA.muted, padding: '12px 0' }}>No top opportunities starred yet.</p>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
      {rows.map(o => (
        <div key={o.id} style={{ padding: '14px 16px', background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <span style={{ ...SA_TYPE.body, fontSize: 14, fontWeight: 600, color: SA.text }}>{o.organization}</span>
            <span style={{ fontSize: 11, color: SA.muted }}>{STAGE_LABELS[o.stage] || o.stage}</span>
          </div>
          {FIELDS.map(([key, label]) => o[key] ? (
            <div key={key}>
              <div style={{ ...SA_TYPE.label, fontSize: 9, color: SA.faint }}>{label}</div>
              <div style={{ fontSize: 12, color: SA.muted, lineHeight: 1.4 }}>{o[key]}</div>
            </div>
          ) : null)}
        </div>
      ))}
    </div>
  );
}

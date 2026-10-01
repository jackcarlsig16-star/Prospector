import { SA, SA_TYPE } from './theme';
import { computeAlerts } from './alertRules';

const SEVERITY_COLOR = { bad: SA.bad, warn: SA.warn };

// design-v1 Stage 2 - hidden entirely when there are no alerts (DECIDED);
// rendered outside the normal widget registry loop since it needs its own
// multi-card grid with no title bar, and must disappear completely rather
// than show an empty-card shell.
export default function AlertsRow({ allRows, entities, runs }) {
  const alerts = computeAlerts({ allRows, entities, runs });
  if (!alerts.length) return null;

  return (
    <div className="print-avoid-break" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginBottom: 12 }}>
      {alerts.map(a => (
        <div key={a.key} style={{ background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: 14, padding: '16px 18px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <span style={{ marginTop: 5, width: 10, height: 10, borderRadius: 3, background: SEVERITY_COLOR[a.severity], flexShrink: 0, display: 'inline-block' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <div style={{ ...SA_TYPE.body, fontSize: 14, fontWeight: 600, color: SA.text }}>{a.title}</div>
            <div style={{ fontSize: 13, color: SA.muted, lineHeight: 1.45 }}>{a.action}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

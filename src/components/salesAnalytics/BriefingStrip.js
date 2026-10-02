import { SA, SA_TYPE, SA_SHAPE } from './theme';

const SEVERITY_COLOR = { bad: SA.bad, warn: SA.warn };

function jumpTo(contactId) {
  const el = document.getElementById(`huddle-card-${contactId}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.animate([{ boxShadow: `0 0 0 2px ${SA.accent}` }, { boxShadow: '0 0 0 0 transparent' }], { duration: 1600 });
}

// sales-hot-prospects-v1 Stage 4c - morning briefing. `people` arrives
// already filtered/sorted/capped by DailyHuddle (needsActionToday); issues is
// null while the insights request is still in flight.
export default function BriefingStrip({ people, total, issues, issuesError, ownerLabels }) {
  return (
    <div className="no-print" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 12, marginBottom: 24 }}>
      <div style={{ padding: '14px 16px', background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 24, fontWeight: 600, color: total ? SA.accent : SA.muted, fontVariantNumeric: 'tabular-nums' }}>{total}</span>
          <span style={{ ...SA_TYPE.cardTitle, color: SA.text }}>{total === 1 ? 'person needs' : 'people need'} action today</span>
          {total > people.length && <span style={{ ...SA_TYPE.label, color: SA.faint }}>top {people.length} by heat</span>}
        </div>
        {people.length === 0 ? (
          <p style={{ fontSize: 13, color: SA.faint, margin: 0 }}>Nothing urgent — sequences are running.</p>
        ) : (
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {people.map(({ prospect: p, action, overdue }) => (
              <li key={p.contact_id}>
                <button onClick={() => jumpTo(p.contact_id)}
                  style={{ ...SA_TYPE.body, width: '100%', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto auto', gap: 10, alignItems: 'center', fontSize: 13, textAlign: 'left', background: 'transparent', border: 0, borderRadius: 6, padding: '4px 6px', cursor: 'pointer', color: SA.text }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name || 'Unknown contact'}{p.company && <span style={{ color: SA.muted }}> · {p.company}</span>}
                  </span>
                  <span style={{ fontWeight: 600, color: overdue ? SA.bad : SA.accent, whiteSpace: 'nowrap' }}>{action}</span>
                  <span style={{ fontSize: 12, color: SA.muted, whiteSpace: 'nowrap' }}>{ownerLabels[p.owner] || p.owner}</span>
                  <span style={{ fontSize: 12, color: SA.faint, fontVariantNumeric: 'tabular-nums', minWidth: 28, textAlign: 'right' }}>{p.score}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div style={{ padding: '14px 16px', background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner }}>
        <div style={{ ...SA_TYPE.cardTitle, color: SA.text, marginBottom: 10 }}>Top sequence issues</div>
        {issuesError ? (
          <p style={{ fontSize: 13, color: SA.warn, margin: 0 }}>⚠ {issuesError}</p>
        ) : issues === null ? (
          <p style={{ fontSize: 13, color: SA.faint, margin: 0 }}>Checking sequences…</p>
        ) : issues.length === 0 ? (
          <p style={{ fontSize: 13, color: SA.faint, margin: 0 }}>No sequence issues flagged.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {issues.map(i => (
              <div key={`${i.id}:${i.scope_key}`} title={i.evidence} style={{ borderLeft: `3px solid ${SEVERITY_COLOR[i.severity] || SA.muted}`, paddingLeft: 10, cursor: 'help' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: SA.text }}>{i.title}</div>
                <div style={{ fontSize: 12, color: SA.muted, marginTop: 2 }}>{i.action}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

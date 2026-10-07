import { SA } from '../theme';
import { SEMANTIC } from '../palette';
import { cardStyle, labelStyle, h2Style, numStyle, SourceBadge, NeedsMigration, ErrorNote, EditableNumber, DrillNumber, fmt } from './goalsUi';

// Seif's 11-row table (api/sales/goalsReportRoutes.js buildKpi). Targets
// carry forward until changed; Manual rows take a typed weekly value.
const MANUAL = ['meetings_held', 'meetings_set'];
// Where each row's list lives (goals-surface-v1 Stage 4). Manual rows have
// none - they're typed in.
const DRILL = {
  target_orgs: 'overview:companies_by_cohort', dm_contacted: 'overview:kpi_tiles', positive_responses: 'huddle:reply',
  qualified_opps: 'overview:pipeline_table', covered_lives_pipeline: 'overview:pipeline_table', proposals_outstanding: 'overview:pipeline_table',
  verbal_commitments: 'overview:pipeline_table', contracts_signed: 'overview:pipeline_table', launches_90d: 'overview:pipeline_forecast',
};

function change(last, now) {
  if (last == null || now == null) return { text: '—', color: SA.muted };
  const d = now - last;
  const rel = last ? ` (${d >= 0 ? '+' : ''}${Math.round((d * 100) / last)}%)` : d ? ' (new)' : '';
  return { text: `${d > 0 ? '+' : ''}${fmt(d)}${rel}`, color: d > 0 ? SEMANTIC.healthy : SA.muted };
}

export default function KpiTable({ rows, error, weekStart, editable, onSaveTarget, frozen, onOpen }) {
  const th = { ...labelStyle, textAlign: 'right', padding: '0 12px 10px', whiteSpace: 'nowrap' };
  const td = { padding: '14px 12px', borderTop: `1px solid ${SA.track}`, textAlign: 'right', verticalAlign: 'top' };
  return (
    <section style={cardStyle} className="print-avoid-break" aria-labelledby="h-kpi">
      <span style={labelStyle}>Scorecard for Seif{frozen ? ' · as finalized' : ''}</span>
      <h2 style={{ ...h2Style, marginTop: 4 }} id="h-kpi">KPIs: last week vs this week</h2>
      {error?.needsMigration ? <div style={{ marginTop: 12 }}><NeedsMigration what="The KPI table" /></div>
        : error ? <div style={{ marginTop: 12 }}><ErrorNote message={error.message} /></div>
        : !rows ? <div style={{ color: SA.muted, marginTop: 12 }}>Loading…</div>
        : (
        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead><tr>
              <th scope="col" style={{ ...th, textAlign: 'left', paddingLeft: 0 }}>KPI</th>
              <th scope="col" style={th}>Last week</th><th scope="col" style={th}>This week</th>
              <th scope="col" style={th}>Change</th><th scope="col" style={th}>Target</th>
            </tr></thead>
            <tbody>
              {rows.map(r => {
                const c = change(r.last_week, r.this_week);
                return (
                  <tr key={r.key}>
                    <td style={{ ...td, textAlign: 'left', paddingLeft: 0 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><span>{r.label}</span><SourceBadge source={r.source} /></div>
                    </td>
                    <td style={{ ...td, ...numStyle }}>{fmt(r.last_week)}</td>
                    <td style={{ ...td, ...numStyle, fontWeight: 600 }}>
                      {DRILL[r.key] && onOpen && r.this_week != null
                        ? <DrillNumber onClick={() => onOpen(DRILL[r.key])} title={`Open the list behind ${r.label}`}>{fmt(r.this_week)}</DrillNumber>
                        : editable && MANUAL.includes(r.key)
                        ? <EditableNumber value={r.this_week} placeholder="enter" display={fmt(r.this_week)} ariaLabel={`${r.label} this week`}
                            onSave={v => onSaveTarget({ period: 'week', period_start: weekStart, metric_key: r.key, actual: v })} />
                        : fmt(r.this_week)}
                    </td>
                    <td style={{ ...td, ...numStyle, color: c.color }}>{c.text}</td>
                    <td style={{ ...td, ...numStyle, color: SA.muted }}>
                      {editable
                        ? <EditableNumber value={r.target} placeholder="set target" display={fmt(r.target)} ariaLabel={`${r.label} target`}
                            onSave={v => onSaveTarget({ period: 'week', period_start: weekStart, metric_key: r.key, goal: v })} />
                        : r.target == null ? '—' : fmt(r.target)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p style={{ fontSize: 12, color: SA.muted, margin: '10px 0 0' }}>
            Apollo rows use the last sync inside each week · Pipeline rows are rebuilt from stage history as of the end of the week · targets carry forward until changed.
          </p>
        </div>
      )}
    </section>
  );
}

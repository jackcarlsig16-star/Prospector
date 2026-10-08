import { useState } from 'react';
import { SA, SA_TYPE, SA_SHAPE } from './theme';
import { dismissInsight, fetchBounces } from './salesApi';
import { formatValue } from './computeMetric';
import { shortDate } from './emailTrendData';
import { flashTo } from './goals/goalsUi';
import ExportButton from './ExportButton';
import { exportWidgetCsv } from './exportCsv';

// sales-email-trend-v1 REV2 Stage 4 - "Why performance looks like this".
// Rules run server-side (api/sales/insightRules.js); this only renders
// them. Severity is a shape + word, never colour alone.
//
// overview-home-v1 Stage 2 - every rule carries the one thing to do about
// it: R1 View bounces (where the hard bounces are, from the stored daily
// counts) · R2/R5/R6 Open mailbox (Apollo's mailbox settings - this app has
// no mailbox screen; Admin › Integrations holds API keys only) · R3 View
// week · R4 Open Huddle · R7/R8 Open sequence in Apollo (read-only link) ·
// R9 Show/Hide human opens (the strip + the chart) · R10 nothing. Rules
// that ran and did not fire are "checks passed", collapsed.
const SEVERITY = {
  bad: { color: SA.bad, mark: '■', word: 'Problem' },
  warn: { color: SA.warn, mark: '▲', word: 'Watch' },
  info: { color: SA.good, mark: '●', word: 'Good news' },
};
export const RULE_IDS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10'];
export const APOLLO_MAILBOXES_URL = 'https://app.apollo.io/#/settings/mailboxes';
export const apolloSequenceUrl = id => `https://app.apollo.io/#/sequences/${id}`;

// "Clickable filters" are jump links: they scroll to the item on this page
// and flash it. Actually filtering the leaderboard would mean lifting its
// filter state up into SalesAnalyticsTab - not done here.
function jumpTo(item) {
  const id = item.type === 'sequence' ? `sa-seq-${item.id}`
    : item.type === 'mailbox' ? `sa-mailbox-${item.id}`
      : 'sa-widget-email_trend';
  const el = document.getElementById(id) || document.getElementById(item.type === 'sequence' ? 'sa-widget-sequence_leaderboard' : 'sa-widget-mailbox_health');
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.animate([{ outline: `2px solid ${getComputedStyle(el).getPropertyValue('--sa-accent') || '#8FA8FF'}` }, { outline: '2px solid transparent' }], { duration: 1600 });
}

export function actionFor(insight, ctx) {
  const seq = insight.affected.find(a => a.type === 'sequence' && !a.label.startsWith('Best:'));
  switch (insight.id) {
    case 'R1': return { label: 'View bounces', onClick: () => ctx.toggleBounces(insight) };
    case 'R2': case 'R5': case 'R6': return { label: 'Open mailbox', href: APOLLO_MAILBOXES_URL, title: 'Apollo › Settings › Mailboxes (reconnect or check the mailbox there)' };
    case 'R3': return { label: 'View week', onClick: () => flashTo('sa-widget-email_trend') };
    case 'R4': return { label: 'Open Huddle', onClick: () => ctx.onOpenHuddle({ feed: null }) };
    case 'R7': case 'R8': return seq ? { label: 'Open sequence in Apollo', href: apolloSequenceUrl(seq.id), title: `${seq.label} in Apollo (read-only)` } : null;
    case 'R9': return { label: ctx.humanOpens ? 'Hide human opens' : 'Show human opens', onClick: ctx.onToggleHumanOpens };
    default: return null;
  }
}

const bounceParams = insight => (insight.scope_key.startsWith('week:') ? { week: insight.scope_key.slice(5) } : { sequence_id: insight.scope_key });

function BounceList({ data, sequenceName }) {
  const total = data.rows.reduce((n, r) => n + r.hard_bounced, 0);
  if (!data.rows.length) return <p style={{ fontSize: 12, color: SA.muted, margin: 0 }}>No hard bounces stored for this scope.</p>;
  const cell = { padding: '5px 8px', borderTop: `1px solid ${SA.border}`, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
  return (
    <div data-bounce-list="" style={{ fontSize: 12, color: SA.text }}>
      <div style={{ color: SA.muted, marginBottom: 6 }}>{total} hard bounce{total === 1 ? '' : 's'} across {data.rows.length} sequence-step-day{data.rows.length === 1 ? '' : 's'} (Apollo's daily counts). Apollo lists the bounced contacts on the sequence page.</div>
      <div style={{ overflowX: 'auto', maxHeight: 220, overflowY: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr>{['Day', 'Mailbox', 'Sequence', 'Step', 'Hard bounced', 'Delivered'].map((h, i) => <th key={h} style={{ ...cell, borderTop: 0, ...SA_TYPE.label, fontSize: 9, color: SA.muted, textAlign: i >= 3 ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
          <tbody>
            {data.rows.map(r => (
              <tr key={`${r.day}|${r.mailbox}|${r.sequence_id}|${r.step}`}>
                <td style={cell}>{shortDate(r.day)}</td>
                <td style={{ ...cell, color: SA.muted }}>{r.mailbox}</td>
                <td style={{ ...cell, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.sequence_id}>{sequenceName(r.sequence_id)}</td>
                <td style={{ ...cell, textAlign: 'right' }}>{r.step || '—'}</td>
                <td style={{ ...cell, textAlign: 'right', fontWeight: 600, color: SA.bad }}>{r.hard_bounced}</td>
                <td style={{ ...cell, textAlign: 'right', color: SA.muted }}>{formatValue(r.delivered, 'number')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.contacts.length > 0 && (
        <div style={{ marginTop: 8, color: SA.muted }}>
          Tracked contacts that bounced: {data.contacts.map(c => <a key={c.apollo_message_id} href={c.apollo_url} target="_blank" rel="noreferrer" style={{ color: SA.link, marginRight: 10 }}>{c.name || c.contact_id}{c.company ? ` · ${c.company}` : ''}</a>)}
        </div>
      )}
    </div>
  );
}

const actionStyle = { ...SA_TYPE.body, fontSize: 12, fontWeight: 600, height: 30, padding: '0 12px', borderRadius: 7, border: `1px solid ${SA.accent}`, background: 'transparent', color: SA.accent, cursor: 'pointer', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', flexShrink: 0 };

export default function InsightsPanel({ businessId, insights, entities, onInsightsChanged, canEdit = true, humanOpens = true, onToggleHumanOpens, onOpenHuddle, widgetId = 'email_insights' }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  // Hidden right away on dismiss - the refetch rebuilds every rule from
  // stored data and takes a few seconds.
  const [hidden, setHidden] = useState(() => new Set());
  const [bounces, setBounces] = useState({}); // insight key -> { loading, data, error }

  if (!insights) return <p style={{ fontSize: 12, color: SA.muted }}>Loading…</p>;
  const keyOf = i => `${i.id}:${i.scope_key}`;
  const visible = insights.insights.filter(i => !hidden.has(keyOf(i)));
  const sequenceName = id => entities?.sequences?.find(s => s.id === id)?.name || id;

  const toggleBounces = async i => {
    const key = keyOf(i);
    if (bounces[key]) { setBounces(b => { const n = { ...b }; delete n[key]; return n; }); return; }
    setBounces(b => ({ ...b, [key]: { loading: true } }));
    try {
      const data = await fetchBounces(businessId, bounceParams(i));
      setBounces(b => ({ ...b, [key]: { data } }));
    } catch (e) {
      setBounces(b => ({ ...b, [key]: { error: e.message } }));
    }
  };
  const ctx = { toggleBounces, onOpenHuddle, humanOpens, onToggleHumanOpens };

  // Rules that ran and did not fire = passed; suppressed ones are listed by
  // their rule id in not_enough_data ("R9 bot opens: ...").
  const firedIds = new Set(insights.insights.map(i => i.id));
  const suppressedIds = new Set(insights.not_enough_data.map(t => t.split(' ')[0]));
  const dismissedIds = new Set(insights.dismissed.map(d => d.id));
  const passed = RULE_IDS.filter(id => !firedIds.has(id) && !suppressedIds.has(id) && !dismissedIds.has(id));

  // One table, three kinds of row, so the export says what was judged,
  // what was hidden on purpose, and what couldn't be judged at all.
  const handleExport = () => exportWidgetCsv(widgetId, [
    ...visible.map(i => ({ ...i, status: 'fired' })),
    ...insights.dismissed.map(d => ({ id: d.id, scope_key: d.scope_key, title: d.title, status: 'dismissed (7 days)' })),
    ...insights.not_enough_data.map(text => ({ id: text.split(' ')[0], title: text, status: 'not enough data' })),
    ...passed.map(id => ({ id, title: 'check passed', status: 'passed' })),
  ], [
    { label: 'Status', key: 'status' },
    { label: 'Rule', key: 'id' },
    { label: 'Severity', value: r => r.severity || '' },
    { label: 'Title', key: 'title' },
    { label: 'Evidence', value: r => r.evidence || '' },
    { label: 'Likely cause', value: r => r.cause || '' },
    { label: 'Suggested action', value: r => r.action || '' },
    { label: 'Affected', value: r => (r.affected || []).map(a => a.label).join('; ') },
    { label: 'Computed at', value: () => insights.computed_at || '' },
  ]);

  const dismiss = async i => {
    setBusy(keyOf(i));
    setError('');
    try {
      await dismissInsight(businessId, { insight_id: i.id, scope_key: i.scope_key });
      setHidden(h => new Set(h).add(keyOf(i)));
      await onInsightsChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <ExportButton onClick={handleExport} />
      </div>
      {(error || insights.error) && <p style={{ fontSize: 12, color: SA.bad, margin: '0 0 8px' }}>⚠ {error || insights.error}</p>}
      {visible.length === 0 ? (
        <p style={{ fontSize: 13, color: SA.muted, margin: 0 }}>Nothing stands out right now.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 380px), 1fr))', gap: 10 }}>
          {visible.map(i => {
            const sev = SEVERITY[i.severity];
            const key = keyOf(i);
            const action = actionFor(i, ctx);
            const bl = bounces[key];
            return (
              <div key={key} data-insight={i.id} className="print-avoid-break" style={{ padding: '14px 16px', background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner, display: 'flex', flexDirection: 'column', gap: 8, opacity: busy === key ? 0.6 : 1 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                      <span style={{ color: sev.color, fontSize: 10 }}>{sev.mark}</span>
                      <span style={{ ...SA_TYPE.label, color: SA.muted }}>{sev.word} · {i.id}</span>
                    </div>
                    <div style={{ ...SA_TYPE.cardTitle, fontSize: 14, color: SA.text }}>{i.title}</div>
                  </div>
                  {action && (action.href
                    ? <a data-action={i.id} className="no-print" href={action.href} target="_blank" rel="noreferrer" title={action.title} style={actionStyle}>{action.label} ↗</a>
                    : <button data-action={i.id} className="no-print" type="button" onClick={action.onClick} title={action.title} style={actionStyle}>{action.label}</button>)}
                </div>
                <div style={{ fontSize: 12, color: SA.text, fontVariantNumeric: 'tabular-nums', lineHeight: 1.45 }}>{i.evidence}</div>
                <div style={{ fontSize: 12, color: SA.muted, lineHeight: 1.45 }}><span style={{ color: SA.faint }}>Likely cause · </span>{i.cause}</div>
                <div style={{ fontSize: 12, color: SA.muted, lineHeight: 1.45 }}><span style={{ color: SA.faint }}>Suggested · </span>{i.action}</div>
                {bl && (
                  <div className="no-print" style={{ padding: '10px 12px', background: SA.inset, border: `1px solid ${SA.border}`, borderRadius: 8 }}>
                    {bl.loading ? <span style={{ fontSize: 12, color: SA.muted }}>Loading bounces…</span>
                      : bl.error ? <span style={{ fontSize: 12, color: SA.bad }}>⚠ {bl.error}</span>
                        : <BounceList data={bl.data} sequenceName={sequenceName} />}
                  </div>
                )}
                <div className="no-print" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {i.affected.map(a => (
                    <button key={`${a.type}:${a.id}:${a.label}`} onClick={() => jumpTo(a)} title="Jump to it on this page"
                      style={{ ...SA_TYPE.body, fontSize: 11, height: 26, padding: '0 10px', borderRadius: SA_SHAPE.radiusPill, border: `1px solid ${SA.border}`, background: 'transparent', color: SA.accent, cursor: 'pointer', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.label} ↗
                    </button>
                  ))}
                  <span style={{ flex: 1 }} />
                  {canEdit && (
                    <button disabled={!!busy} onClick={() => dismiss(i)}
                      style={{ ...SA_TYPE.body, fontSize: 11, height: 26, padding: '0 10px', borderRadius: 7, border: `1px solid ${SA.border}`, background: 'transparent', color: SA.muted, cursor: 'pointer' }}>
                      Dismiss for 7 days
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <details className="no-print" data-checks-passed="" style={{ marginTop: 12 }}>
        <summary style={{ fontSize: 12, color: SA.muted, cursor: 'pointer' }}>
          {passed.length} check{passed.length === 1 ? '' : 's'} passed
          {insights.not_enough_data.length > 0 && ` · not enough data: ${insights.not_enough_data.length}`}
          {insights.dismissed.length > 0 && ` · dismissed: ${insights.dismissed.length}`}
        </summary>
        <ul style={{ fontSize: 12, color: SA.faint, paddingLeft: 18, lineHeight: 1.6 }}>
          {passed.map(id => <li key={id}>{id} passed</li>)}
          {insights.not_enough_data.map(s => <li key={s}>{s}</li>)}
          {insights.dismissed.map(d => <li key={`${d.id}:${d.scope_key}`}>Dismissed: {d.title}</li>)}
        </ul>
      </details>
      <p className="print-only" style={{ fontSize: 11, color: SA.muted, margin: '10px 0 0' }}>
        {passed.length} check{passed.length === 1 ? '' : 's'} passed{insights.not_enough_data.length > 0 && ` · not enough data to judge: ${insights.not_enough_data.length} (listed in the app and the insights CSV)`}.
      </p>
      <p style={{ fontSize: 11, color: SA.faint, margin: '10px 0 0' }}>
        Rule-based checks on stored data, not AI. Each fires only above its minimum sample; causes are likely, not certain.
      </p>
    </div>
  );
}

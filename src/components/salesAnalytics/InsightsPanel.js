import { useState } from 'react';
import { SA } from './theme';
import { ROLE } from '../../ui/tokens';
import { dismissInsight } from './salesApi';
import { labelStyle, Chip, ErrorNote } from './goals/goalsUi';

// sales-email-trend-v1 REV2 Stage 4 - "Why performance looks like this". Rules run server-side (api/sales/insightRules.js);
// this only renders them. Severity is a shape + word, never colour alone.
// dashboard-v3 Stage 4 (M): compact rows - square · title (+ the sequence's pill) · evidence · "Rule Rn · Cause … ·
// Suggested …" · ONE action - every live rule including the "good" ones, "Dismissed n ▾" listing what is hidden,
// header "✦ generated · 10 rules live · n short of data". Home shows the top three of the same list (HomeView).
// ONE action per rule, shared with Home: Apollo is read-only here, so "Pause sequence" / "Review copy" open the sequence
// in Apollo (where that happens), mailbox rules open Apollo's mailboxes, the rest open the Explorer (ctx.onEmail).
export const RULE_IDS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10'];
export const APOLLO_MAILBOXES_URL = 'https://app.apollo.io/#/settings/mailboxes';
export const apolloSequenceUrl = id => `https://app.apollo.io/#/sequences/${id}`;
const SEVERITY = { bad: { color: SA.bad, word: 'Problem' }, warn: { color: SA.warn, word: 'Watch' }, info: { color: SA.good, word: 'Good news' } };
export const sequenceOf = insight => (insight.affected || []).find(a => a.type === 'sequence' && !a.label.startsWith('Best:'));

export function actionFor(insight, ctx = {}) {
  const seq = sequenceOf(insight);
  const apollo = (label, href, title) => <a className="ui-btn ui-btn--secondary ui-btn--sm" data-action={insight.id} style={{ textDecoration: 'none' }} href={href} target="_blank" rel="noreferrer" title={title}>{label} ↗</a>;
  const here = label => (ctx.onEmail ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" data-action={insight.id} onClick={ctx.onEmail}>{label}</button> : null);
  switch (insight.id) {
    case 'R1': return seq ? apollo('Pause sequence', apolloSequenceUrl(seq.id), `${seq.label} in Apollo - pause it there`) : here(ctx.hereLabel || 'Open Email');
    case 'R2': case 'R5': case 'R6': return apollo('Open mailboxes', APOLLO_MAILBOXES_URL, 'Apollo › Settings › Mailboxes');
    case 'R4': case 'R7': case 'R8': return seq ? apollo('Review copy', apolloSequenceUrl(seq.id), `${seq.label} in Apollo (read-only)`) : here(ctx.hereLabel || 'Open Email');
    case 'R3': case 'R9': return here(ctx.hereLabel || 'Open Email');
    default: return null;
  }
}

export function InsightRow({ insight, action, canEdit, busy, onDismiss }) {
  const sev = SEVERITY[insight.severity] || SEVERITY.info;
  const seq = sequenceOf(insight);
  return (
    <div data-insight={insight.id} data-severity={insight.severity} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12, alignItems: 'start', padding: '12px 14px', borderRadius: 10, background: SA.inset, border: `1px solid ${SA.border}`, minWidth: 0 }}>
      <span role="img" aria-label={sev.word} title={sev.word} style={{ width: 8, height: 8, borderRadius: 2, marginTop: 6, background: sev.color, display: 'block' }} />
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <b style={{ fontSize: 13, fontWeight: 600, color: SA.text, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{insight.title}{seq && <Chip style={{ height: 20, fontSize: 11 }}>{seq.label}</Chip>}</b>
        <span style={{ fontSize: 12.5, color: SA.soft, lineHeight: 1.45 }}>{insight.evidence}</span>
        <span style={{ fontSize: 12, color: SA.muted, marginTop: 2 }}>Rule {insight.id}{insight.cause ? ` · Cause: ${insight.cause}` : ''}{insight.action ? ` · Suggested: ${insight.action}` : ''}</span>
      </div>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        {action}
        {canEdit && onDismiss && <button type="button" className="ui-btn ui-btn--tertiary ui-btn--sm" disabled={busy} onClick={onDismiss} title="Hide this one for 7 days">Dismiss 7 d</button>}
      </span>
    </div>
  );
}

export default function InsightsPanel({ businessId, insights, canEdit = true, onInsightsChanged, onOpenExplorer }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [hidden, setHidden] = useState(() => new Set());
  const [dismissedOpen, setDismissedOpen] = useState(false);
  const keyOf = i => `${i.id}:${i.scope_key}`;
  const list = insights?.insights || [];
  const visible = list.filter(i => !hidden.has(keyOf(i)));
  const dismissed = insights?.dismissed || [];
  const short = insights?.not_enough_data?.length || 0;
  const dismiss = async i => {
    setBusy(keyOf(i)); setError('');
    try { await dismissInsight(businessId, { insight_id: i.id, scope_key: i.scope_key }); setHidden(h => new Set(h).add(keyOf(i))); await onInsightsChanged?.(); }
    catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  return (
    <section aria-labelledby="h-why" data-insights-panel={visible.length} style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <h2 id="h-why" style={{ margin: 0, fontSize: 15, fontWeight: 600, color: SA.text }}>
          Why performance looks like this <span style={{ ...labelStyle, marginLeft: 8, color: ROLE.generateAccent }}>✦ generated · {RULE_IDS.length} rules live{short ? ` · ${short} short of data` : ''}</span>
        </h2>
        {dismissed.length > 0 && <button type="button" className="ui-btn ui-btn--tertiary ui-btn--sm" aria-expanded={dismissedOpen} onClick={() => setDismissedOpen(o => !o)}>Dismissed {dismissed.length} {dismissedOpen ? '▴' : '▾'}</button>}
      </div>
      {(error || insights?.error) && <ErrorNote message={error || insights.error} />}
      {!insights && <span style={{ fontSize: 12, color: SA.muted }}>Loading…</span>}
      {insights && !visible.length && <div data-insights-empty style={{ padding: '12px 14px', borderRadius: 10, background: SA.inset, border: `1px solid ${SA.border}`, fontSize: 13, color: SA.soft }}>Nothing stands out right now · {RULE_IDS.length} rules ran on the synced data{short ? ` · ${short} short of data` : ''}.</div>}
      {visible.map(i => <InsightRow key={keyOf(i)} insight={i} action={actionFor(i, { onEmail: onOpenExplorer, hereLabel: 'Open Explorer' })} canEdit={canEdit} busy={busy === keyOf(i)} onDismiss={() => dismiss(i)} />)}
      {dismissedOpen && dismissed.length > 0 && (
        <ul data-dismissed-list style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: SA.muted, lineHeight: 1.6 }}>
          {dismissed.map(d => <li key={`${d.id}:${d.scope_key}`}>{d.title} <span style={{ color: SA.faint }}>· {d.id} · hidden 7 days</span></li>)}
        </ul>
      )}
      <p style={{ fontSize: 11, color: SA.faint, margin: 0 }}>Rule-based checks on stored data, not AI. Each fires only above its minimum sample; causes are likely, not certain.</p>
    </section>
  );
}

import { useState, useEffect } from 'react';
import { SA } from '../theme';
import { ROLE } from '../../../ui/tokens';
import { goalsApi } from './goalsApi';
import { fetchInsights } from '../salesApi';
import { RULE_IDS, actionFor } from '../InsightsPanel';
import { HOME_TILES, PulseGrid, md, agoOf } from './PulseTiles';
import { cardStyle, labelStyle, numStyle, ErrorNote, Chip, fmt } from './goalsUi';
import ExplorerView from './ExplorerView';

// dashboard-v3 Stage 2 - Dashboard › Home (specs/design/dashboard-v3/Dash.dc.html; the app's sidebar leaves the tiles
// ~150 px, so the sparkline gets its own line under the delta instead of sitting beside it): the title line, PULSE (seven tiles
// over GET goals/pulse - every digit is the route's, the delta and its direction too; this file only formats), INSIGHTS
// (the top three of GET /insights by severity, one action each) and the Explorer (ExplorerView over GET goals/explorer,
// Stage 3: Sent · Human opens % · Visitors · Replies %, 8 weeks + this week, split Team). Period and Who live in the
// frame row (GoalsTab); the Explorer's Save view is the only write here (Members).
export const PERIODS = [['this_week', 'This week'], ['last_week', 'Last week'], ['4_weeks', '4 weeks'], ['month', 'Month'], ['90_days', '90 days']];
export const DEFAULT_PERIOD = 'this_week';
export { HOME_TILES as TILES };
const SEVERITY = { bad: { color: SA.bad, word: 'Problem' }, warn: { color: SA.warn, word: 'Watch' }, info: { color: SA.good, word: 'Good news' } };
export const topInsights = (insights, n = 3) => (insights || []).slice(0, n);

function Insights({ data, error, syncedAgo, onOpenEmail }) {
  const all = data?.insights || [];
  const top = topInsights(all);
  const compact = typeof window !== 'undefined' && window.innerWidth < 900;
  return (
    <section aria-labelledby="h-insights" data-insights={top.length} style={{ ...cardStyle, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <h2 id="h-insights" style={{ margin: 0, fontSize: 15, fontWeight: 600, color: SA.text }}>
          Insights <span style={{ ...labelStyle, marginLeft: 8, color: ROLE.generateAccent }}>✦ generated · {RULE_IDS.length} rules{syncedAgo ? ` · updated ${syncedAgo}` : ''}</span>
        </h2>
        {all.length > 0 && <button type="button" className="ui-link" onClick={onOpenEmail}>All {all.length} in Email →</button>}
      </div>
      {error && <ErrorNote message={error} />}
      {!error && data && !top.length && (
        <div data-insights-empty style={{ padding: '12px 14px', borderRadius: 10, background: SA.inset, border: `1px solid ${SA.border}` }}>
          <b style={{ fontSize: 13, fontWeight: 600, color: SA.text, display: 'block' }}>Nothing to flag</b>
          <span style={{ fontSize: 12.5, color: SA.soft }}>{RULE_IDS.length} rules ran on the synced data{data.not_enough_data?.length ? ` · ${data.not_enough_data.length} waiting for more data` : ''}</span>
        </div>
      )}
      {top.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : `repeat(${top.length}, minmax(0, 1fr))`, gap: 10 }}>
          {top.map(i => {
            const sev = SEVERITY[i.severity] || SEVERITY.info;
            const seq = (i.affected || []).find(a => a.type === 'sequence' && !a.label.startsWith('Best:'));
            return (
              <div key={`${i.id}:${i.scope_key}`} data-insight={i.id} data-severity={i.severity} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12, alignItems: 'start', padding: '12px 14px', borderRadius: 10, background: SA.inset, border: `1px solid ${SA.border}`, minWidth: 0 }}>
                <span role="img" aria-label={sev.word} title={sev.word} style={{ width: 8, height: 8, borderRadius: 2, marginTop: 6, background: sev.color, display: 'block' }} />
                <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <b style={{ fontSize: 13, fontWeight: 600, color: SA.text, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{i.title}{seq && <Chip style={{ height: 20, fontSize: 11 }}>{seq.label}</Chip>}</b>
                  <span style={{ fontSize: 12.5, color: SA.soft, lineHeight: 1.45 }}>{i.evidence}</span>
                  <span style={{ fontSize: 12, color: SA.muted, marginTop: 2 }}>Cause: {i.cause} · Rule {i.id}</span>
                </div>
                {actionFor(i, { onEmail: onOpenEmail })}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function HomeView({ businessId, period, owner, canEdit, onOpenEmail }) {
  const [pulse, setPulse] = useState(null);
  const [error, setError] = useState('');
  const [insights, setInsights] = useState(null);
  const [insightsError, setInsightsError] = useState('');
  useEffect(() => {
    let live = true;
    setPulse(null); setError('');
    goalsApi.pulse(businessId, { period, owner }).then(d => { if (live) setPulse(d); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [businessId, period, owner]);
  useEffect(() => {
    let live = true;
    fetchInsights(businessId).then(d => { if (live) setInsights(d); }).catch(e => { if (live) setInsightsError(e.message); });
    return () => { live = false; };
  }, [businessId]);

  const label = pulse?.label || PERIODS.find(([id]) => id === period)?.[1] || 'This week';
  const synced = agoOf(pulse?.synced_at);
  const meta = pulse ? [`${md(pulse.from)} – ${md(pulse.to)}`, synced ? `synced ${synced}` : 'not synced yet', pulse.apollo_calls != null ? `${fmt(pulse.apollo_calls)} Apollo calls` : null, `${fmt(pulse.credits.used)} of ${fmt(pulse.credits.cap)} credits`].filter(Boolean).join(' · ') : '';
  return (
    <div data-home={period} style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600, letterSpacing: '-0.025em', color: SA.text }}>{label}</h1>
        <span data-home-meta style={{ color: SA.muted, ...numStyle }}>{meta || (error ? '' : 'Loading…')}</span>
      </div>
      {error && <ErrorNote message={error} />}
      {pulse && (
        <PulseGrid tiles={HOME_TILES} metrics={pulse.metrics} period={period} />
      )}
      <Insights data={insights} error={insightsError} syncedAgo={synced} onOpenEmail={onOpenEmail} />
      <ExplorerView businessId={businessId} canEdit={canEdit} context="home" />
    </div>
  );
}

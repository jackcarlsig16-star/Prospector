import { useState, useEffect } from 'react';
import { SA } from '../theme';
import { ROLE } from '../../../ui/tokens';
import { goalsApi } from './goalsApi';
import { fetchInsights } from '../salesApi';
import { RULE_IDS, APOLLO_MAILBOXES_URL, apolloSequenceUrl } from '../InsightsPanel';
import { cardStyle, labelStyle, numStyle, ErrorNote, Chip, fmt } from './goalsUi';

// dashboard-v3 Stage 2 - Dashboard › Home (specs/design/dashboard-v3/Dash.dc.html; the app's sidebar leaves the tiles
// ~150 px, so the sparkline gets its own line under the delta instead of sitting beside it): the title line, PULSE (seven tiles
// over GET goals/pulse - every digit is the route's, the delta and its direction too; this file only formats), INSIGHTS
// (the top three of GET /insights by severity, one action each) and the Explorer's place, marked Stage 3 (its GET is
// stubbed to today's series). Period and Who live in the frame row (GoalsTab); nothing here writes.
export const PERIODS = [['this_week', 'This week'], ['last_week', 'Last week'], ['4_weeks', '4 weeks'], ['month', 'Month'], ['90_days', '90 days']];
export const DEFAULT_PERIOD = 'this_week';
const VS = { this_week: 'vs last wk', last_week: 'vs wk before', '4_weeks': 'vs prior 4 wks', month: 'vs last month', '90_days': 'vs prior 90 d' };
export const TILES = [
  { key: 'sent', label: 'Sent' },
  { key: 'delivered_rate', label: 'Delivered' },
  { key: 'human_open_rate', label: 'Human opens' },
  { key: 'reply_rate', label: 'Replies' },
  { key: 'meetings', label: 'Meetings' },
  { key: 'visitors', label: 'Visitors' },
  { key: 'first_touched', label: 'First-touched' },
];
const md = iso => new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(iso.length === 10 ? { timeZone: 'UTC' } : {}) });
const agoOf = iso => { if (!iso) return null; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const pts = r => `${(r * 100).toFixed(1)}`;
const sign = n => (n > 0 ? '+' : n < 0 ? '−' : '');

// The number and its small unit, the route's digit formatted once.
export function tileValue(key, m) {
  if (m.value == null) return { main: '—', unit: '' };
  if (m.kind === 'rate') return { main: pts(m.value), unit: '%' };
  if (key === 'first_touched' && m.goal != null) return { main: fmt(m.value), unit: `/${fmt(m.goal)}` };
  return { main: fmt(m.value), unit: '' };
}

// Direction = sign of the route's delta against what "better" means for the metric (good / bad / flat / none).
export function deltaOf(key, m, period) {
  if (key === 'meetings' && m.upcoming != null) return { dir: 'flat', text: `${m.upcoming} on the calendar${m.next_at ? ` · next ${md(m.next_at)}` : ''}` };
  if (key === 'first_touched' && m.goal != null && m.value != null) return { dir: m.value >= m.goal ? 'good' : 'flat', text: `${Math.round((m.value / m.goal) * 100)}% of goal · ${m.weeks_in} wk${m.weeks_in === 1 ? '' : 's'} in${m.carried ? ' · goal carried' : ''}` };
  if (m.delta == null) return { dir: 'none', text: m.value == null ? 'no pull in this window' : 'no previous period' };
  const up = m.delta > 0, flat = m.delta === 0;
  const dir = flat ? 'flat' : (up === (m.better === 'up')) ? 'good' : 'bad';
  const amount = m.kind === 'rate' ? `${sign(m.delta)}${pts(Math.abs(m.delta))} pts` : `${sign(m.delta)}${fmt(Math.abs(m.delta))}${m.delta_pct ? ` (${sign(m.delta_pct)}${Math.round(Math.abs(m.delta_pct) * 100)}%)` : ''}`;
  return { dir, text: `${amount} ${VS[period]}` };
}
const DIR_COLOR = { good: SA.good, bad: SA.bad, flat: SA.faint, none: SA.faint };
const Arrow = ({ dir }) => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {dir === 'good' ? <path d="M8 12V4M4.5 7.5 8 4l3.5 3.5" /> : dir === 'bad' ? <path d="M8 4v8M4.5 8.5 8 12l3.5-3.5" /> : <path d="M3 8h10" />}
  </svg>
);

// 90 × 22, the last SERIES windows; a null is a gap, never a zero; the last point gets a dot.
export function Sparkline({ series, color = SA.accent, width = 90, height = 22 }) {
  const vals = series.filter(v => v != null);
  const max = vals.length ? Math.max(...vals) : 0, min = vals.length ? Math.min(...vals, 0) : 0;
  const x = i => (series.length > 1 ? (i * width) / (series.length - 1) : width);
  const y = v => height - 2 - ((v - min) / (max - min || 1)) * (height - 4);
  let d = '', on = false;
  series.forEach((v, i) => { if (v == null) { on = false; return; } d += `${on ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `; on = true; });
  const last = series.length - 1;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ flex: 'none', overflow: 'visible' }}>
      {vals.length >= 2 && <path d={d} fill="none" stroke={color} strokeWidth="1.5" />}
      {series[last] != null && <circle cx={x(last)} cy={y(series[last])} r="2" fill={color} />}
    </svg>
  );
}

function Tile({ t, m, period }) {
  const { main, unit } = tileValue(t.key, m);
  const delta = deltaOf(t.key, m, period);
  const src = t.key === 'human_open_rate' && m.apollo_open_rate != null ? `${m.source} · Apollo says ${pts(m.apollo_open_rate)}%`
    : t.key === 'reply_rate' && m.value != null ? `${fmt(m.replied)} of ${fmt(m.delivered)} · ${fmt(m.ever)} ever`
      : t.key === 'visitors' ? `${m.source}${m.scope === 'team' ? ' · team-wide' : ''}` : m.source;
  return (
    <div data-pulse-tile={t.key} style={{ ...cardStyle, borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <span style={labelStyle}>{t.label}</span>
      <span data-value style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1, color: SA.text, ...numStyle }}>
        {main}{unit && <small style={{ fontSize: 14, fontWeight: 500, color: SA.muted, letterSpacing: 0, marginLeft: 4 }}>{unit}</small>}
      </span>
      <span data-delta={delta.dir} style={{ fontSize: 12, lineHeight: 1.3, display: 'flex', alignItems: 'flex-start', gap: 5, color: DIR_COLOR[delta.dir], minWidth: 0, ...numStyle }}>
        <span style={{ flex: 'none', paddingTop: 2 }}><Arrow dir={delta.dir} /></span><span>{delta.text}</span>
      </span>
      <Sparkline series={m.series} />
      <span style={{ fontSize: 11, color: SA.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }} title={src}>{src}</span>
    </div>
  );
}

const SEVERITY = { bad: { color: SA.bad, word: 'Problem' }, warn: { color: SA.warn, word: 'Watch' }, info: { color: SA.good, word: 'Good news' } };
// ONE action per rule. Apollo is read-only here, so "Pause sequence" and "Review copy" open the sequence in Apollo (where
// that happens); mailbox rules open Apollo's mailboxes; the rest open Email, where the rule's chart lives.
export function actionFor(insight, onOpenEmail) {
  const seq = (insight.affected || []).find(a => a.type === 'sequence' && !a.label.startsWith('Best:'));
  const apollo = (label, href, title) => <a className="ui-btn ui-btn--secondary ui-btn--sm" style={{ textDecoration: 'none' }} href={href} target="_blank" rel="noreferrer" title={title}>{label} ↗</a>;
  const email = label => <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={onOpenEmail}>{label}</button>;
  switch (insight.id) {
    case 'R1': return seq ? apollo('Pause sequence', apolloSequenceUrl(seq.id), `${seq.label} in Apollo - pause it there`) : email('Open Email');
    case 'R2': case 'R5': case 'R6': return apollo('Open mailboxes', APOLLO_MAILBOXES_URL, 'Apollo › Settings › Mailboxes');
    case 'R4': case 'R7': case 'R8': return seq ? apollo('Review copy', apolloSequenceUrl(seq.id), `${seq.label} in Apollo (read-only)`) : email('Open Email');
    case 'R3': case 'R9': return email('Open Email');
    default: return null;
  }
}
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
                {actionFor(i, onOpenEmail)}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function HomeView({ businessId, period, owner, onOpenEmail }) {
  const [pulse, setPulse] = useState(null);
  const [error, setError] = useState('');
  const [insights, setInsights] = useState(null);
  const [insightsError, setInsightsError] = useState('');
  const [explorer, setExplorer] = useState(null);
  useEffect(() => {
    let live = true;
    setPulse(null); setError('');
    goalsApi.pulse(businessId, { period, owner }).then(d => { if (live) setPulse(d); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [businessId, period, owner]);
  useEffect(() => {
    let live = true;
    fetchInsights(businessId).then(d => { if (live) setInsights(d); }).catch(e => { if (live) setInsightsError(e.message); });
    goalsApi.explorer(businessId).then(d => { if (live) setExplorer(d); }).catch(() => {});
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
        <div data-pulse style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          {TILES.map(t => <Tile key={t.key} t={t} m={pulse.metrics[t.key]} period={period} />)}
        </div>
      )}
      <Insights data={insights} error={insightsError} syncedAgo={synced} onOpenEmail={onOpenEmail} />
      <section aria-labelledby="h-explorer" data-explorer="stage-3" style={{ ...cardStyle, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <h2 id="h-explorer" style={{ margin: 0, fontSize: 15, fontWeight: 600, color: SA.text }}>Explorer</h2>
          <span style={{ fontSize: 12, color: SA.muted }}>one chart, your layers · 8 weeks + this week</span>
        </div>
        <div style={{ minHeight: 180, border: `1px dashed ${SA.borderStrong}`, borderRadius: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: SA.muted, textAlign: 'center', padding: 16 }}>
          <span style={{ ...labelStyle, color: SA.text }}>Stage 3</span>
          <span style={{ fontSize: 12.5 }}>The Explorer lands in Stage 3. Its read, GET goals/explorer, is stubbed to today's series{explorer ? ` (${explorer.series.length} day${explorer.series.length === 1 ? '' : 's'} since ${md(explorer.from)})` : ''}.</span>
        </div>
      </section>
    </div>
  );
}

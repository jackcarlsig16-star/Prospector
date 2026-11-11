import { SA } from '../theme';
import { cardStyle, labelStyle, numStyle, fmt } from './goalsUi';

// dashboard-v3 Stage 2 / 4 - the Pulse tiles Home and Email share: every digit is the pulse route's (value, delta,
// direction, series); this file only formats. A tile = mono label · 30/600 number · delta line (▲▼— colored by the
// route's `better`) · sparkline of the last five windows · one source line. The app's columns are ~150 px, so the
// sparkline gets its own line under the delta.
const VS = { this_week: 'vs last wk', last_week: 'vs wk before', '4_weeks': 'vs prior 4 wks', month: 'vs last month', '90_days': 'vs prior 90 d' };
export const HOME_TILES = [
  { key: 'sent', label: 'Sent' },
  { key: 'delivered_rate', label: 'Delivered' },
  { key: 'human_open_rate', label: 'Human opens' },
  { key: 'reply_rate', label: 'Replies' },
  { key: 'meetings', label: 'Meetings' },
  { key: 'visitors', label: 'Visitors' },
  { key: 'first_touched', label: 'First-touched' },
];
export const md = iso => new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(iso.length === 10 ? { timeZone: 'UTC' } : {}) });
export const agoOf = iso => { if (!iso) return null; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
export const pts = r => `${(r * 100).toFixed(1)}`;
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
  if (key === 'email_site') return { dir: m.trend, text: `${m.fraction}${m.vs_prior ? ' · vs prior 30 d' : ''}` };
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

export function Tile({ t, m, period }) {
  const { main, unit } = tileValue(t.key, m);
  const delta = deltaOf(t.key, m, period);
  const src = t.src ? t.src(m) : t.key === 'human_open_rate' && m.apollo_open_rate != null ? `${m.source} · Apollo says ${pts(m.apollo_open_rate)}%`
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


export function PulseGrid({ tiles, metrics, period }) {
  return (
    <div data-pulse style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
      {tiles.map(t => <Tile key={t.key} t={t} m={metrics[t.key]} period={period} />)}
    </div>
  );
}

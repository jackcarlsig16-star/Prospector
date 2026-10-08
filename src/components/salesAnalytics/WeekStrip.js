import { SA, SA_TYPE, SA_SHAPE } from './theme';
import { formatValue } from './computeMetric';
import { bounceHealthColor } from './palette';
import { shortDate } from './emailTrendData';
import { buildStrip, formatDelta, compareRange, PER_WEEK } from './weekStripData';
import { flashTo } from './goals/goalsUi';
import ExportButton from './ExportButton';
import { exportWidgetCsv } from './exportCsv';

// overview-home-v1 Stage 1 - Band 0. Follows the page's period picker and
// its compare checkbox (Jack 2026-10-08: one picker). The big number on
// Open / Reply is Apollo's full-population rate (what Seif sees in Apollo);
// the sub-line carries the estimate from the tracked messages, labeled est.
const SPARK_W = 120, SPARK_H = 26;
const COMPARE_LABEL = { this_week: 'last week', last_week: 'the week before', four_weeks: 'the 4 weeks before' };

// Single series: the line in the soft ink, the current week's point in the
// accent with a surface ring; weeks with no value break the line.
function Spark({ points, label }) {
  const known = points.filter(p => p.y !== null);
  if (known.length < 2) return <div style={{ height: SPARK_H }} />;
  const min = Math.min(...known.map(p => p.y), 0), max = Math.max(...known.map(p => p.y));
  const range = max - min || 1;
  const stepX = SPARK_W / (points.length - 1);
  const x = i => i * stepX, y = v => SPARK_H - 3 - ((v - min) / range) * (SPARK_H - 6);
  let d = '', pen = false;
  points.forEach((p, i) => { if (p.y === null) { pen = false; return; } d += `${pen ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(p.y).toFixed(1)} `; pen = true; });
  const last = points[points.length - 1];
  return (
    <svg role="img" aria-label={`${label}, last ${points.length} weeks`} width={SPARK_W} height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} style={{ display: 'block', overflow: 'visible' }}>
      <path d={d.trim()} fill="none" stroke={SA.soft} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {last.y !== null && <circle cx={x(points.length - 1)} cy={y(last.y)} r={3.5} fill={SA.accent} stroke={SA.surface} strokeWidth={2} />}
    </svg>
  );
}

const pct = v => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`);

function subLine(t, humanOpens) {
  const d = t.detail;
  switch (t.id) {
    case 'sent': return t.perWeek ? `avg per week · ${formatValue(d.sent, 'number')} in ${t.perWeek} weeks` : `${formatValue(d.delivered, 'number')} delivered`;
    case 'delivered_rate': return `${formatValue(d.delivered, 'number')} of ${formatValue(d.sent, 'number')} sent`;
    case 'bounce_rate': return `${formatValue(d.hard_bounced, 'number')} hard bounces`;
    case 'spam_blocked': return 'blocked by spam filters';
    case 'open_rate': return !humanOpens ? `${formatValue(d.opened, 'number')} opens · human est. hidden` : d.tracked_opens > 0 ? `~${pct(d.human_open_rate)} human · est. from ${d.tracked_opens} tracked` : 'no tracked opens yet';
    case 'reply_rate': return d.tracked_replies > 0 ? `${d.tracked_real_replies} real · of ${d.tracked_replies} tracked` : 'no tracked replies yet';
    case 'meetings': return t.perWeek ? 'avg per week · partners moved to Meeting' : 'partners moved to Meeting';
    default: return '';
  }
}

function tooltip(t) {
  const d = t.detail;
  switch (t.id) {
    case 'sent': return 'Delivered + hard bounced + spam blocked, from Apollo\'s daily counts.';
    case 'delivered_rate': return 'Delivered ÷ sent.';
    case 'bounce_rate': return 'Hard bounces ÷ sent. Green under 3%, amber under 8%.';
    case 'spam_blocked': return 'Messages Apollo reports as blocked by the recipient\'s spam filter.';
    case 'open_rate': return `Apollo opens ÷ delivered (${d.opened} / ${d.delivered}). Human estimate = this rate × the human share of the ${d.tracked_opens} tracked opens (${d.tracked_bot_opens} look automated: a tracking service, a generic Linux agent, or opened within 60s of delivery).`;
    case 'reply_rate': return `Apollo replies ÷ delivered (${d.replied} / ${d.delivered}). Real = tracked replies not classed out of office, unsubscribe or left the company.`;
    case 'meetings': return `Partners moved to Meeting in this period (Goals › Partners).${d.manual_meetings !== null && d.manual_meetings !== t.value ? ` The scorecard's typed count says ${d.manual_meetings}.` : ''}`;
    default: return '';
  }
}

function Tile({ tile, compareLabel, humanOpens, onDrill }) {
  const color = tile.health && tile.value !== null ? bounceHealthColor(tile.value) : SA.text;
  const number = formatValue(tile.value, tile.format);
  return (
    <div data-strip-tile={tile.id} title={tooltip(tile)} style={{ minWidth: 0, padding: '14px 16px 12px', background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ ...SA_TYPE.label, color: SA.muted }}>{tile.label}</span>
      <button type="button" data-part="number" onClick={() => onDrill(tile)} title={tile.drill === 'goals' ? 'Open Goals › Partners at Meeting' : 'Open Email Performance Over Time'}
        style={{ all: 'unset', cursor: 'pointer', ...SA_TYPE.kpiValue, fontVariantNumeric: 'normal', fontSize: 30, lineHeight: 1, color, alignSelf: 'flex-start', textDecoration: 'underline dotted', textDecorationColor: 'var(--sa-muted)', textUnderlineOffset: 5 }}>{number}</button>
      <Spark points={tile.points} label={tile.label} />
      <span data-part="sub" style={{ fontSize: 12, color: SA.muted, lineHeight: 1.35 }}>{subLine(tile, humanOpens)}</span>
      <span data-part="delta" className="sa-delta" style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: tile.delta === null ? SA.faint : tile.delta === 0 ? SA.muted : tile.deltaGood ? SA.good : SA.bad }}>
        {tile.delta === null ? (compareLabel ? `vs ${compareLabel} —` : 'compare off') : tile.delta === 0 ? `no change vs ${compareLabel}` : `${formatDelta(tile.delta, tile.format)} vs ${compareLabel}`}
      </span>
    </div>
  );
}

// emailData: loaded once by SalesAnalyticsTab (shared with the chart and
// the mailbox table). humanOpens: the R9 toggle - hides the human estimate
// on the open tile when off (the big number stays Apollo's either way).
export default function WeekStrip({ emailData: data, period, prevPeriod, preset, compareEnabled, humanOpens = true, onOpenGoals, widgetId = 'week_strip' }) {
  if (!data) return <p style={{ fontSize: 12, color: SA.muted }}>Loading…</p>;
  const compare = compareRange(period, prevPeriod, preset);
  const perWeek = PER_WEEK[preset] || null;
  const tiles = buildStrip(data, { period, prevPeriod: compare, compareEnabled, perWeek });
  const compareLabel = compareEnabled ? (COMPARE_LABEL[preset] || 'previous period') : null;
  const lowVolume = tiles[0].detail.low_volume;
  const onDrill = tile => (tile.drill === 'goals' ? onOpenGoals({ partners: { stage: 'meeting_set' } }) : flashTo('sa-widget-email_trend'));

  const handleExport = () => exportWidgetCsv(widgetId, tiles, [
    { label: 'Metric', key: 'label' },
    { label: 'Value', value: t => formatValue(t.value, t.format) },
    { label: 'Change', value: t => (t.delta === null ? '' : formatDelta(t.delta, t.format)) },
    { label: 'Detail', value: t => subLine(t, humanOpens) },
  ]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <span data-strip-period style={{ fontSize: 13, color: SA.muted }}>
          {shortDate(period.from)} – {shortDate(period.to)}{perWeek && <span> · counts are per-week averages over {perWeek} weeks</span>}
          {compareLabel && <span> · vs {compareLabel} ({shortDate(compare.from)} – {shortDate(compare.to)})</span>}
          {lowVolume && <span style={{ color: SA.warn }}> · under 50 sent, rates are noisy</span>}
        </span>
        <ExportButton onClick={handleExport} />
      </div>
      <div className="sa-strip" style={{ display: 'grid', gap: 10 }}>
        {tiles.map(t => <Tile key={t.id} tile={t} compareLabel={compareLabel} humanOpens={humanOpens} onDrill={onDrill} />)}
      </div>
    </div>
  );
}

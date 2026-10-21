import { useState, useEffect, useCallback, useRef } from 'react';
import { SA } from '../theme';
import { TREND_COLORS, TREND_THEME_CSS, PRIORITY_COLORS, PRIORITY_THEME_CSS } from '../palette';
import { ui } from '../../../ui/kitTheme';
import { ChartCard, StatTile, fmtNum } from '../../../ui/charts/chartKit';
import BarChart from '../../../ui/charts/BarChart';
import ColumnChart from '../../../ui/charts/ColumnChart';
import LineChart from '../../../ui/charts/LineChart';
import Meter from '../../../ui/charts/Meter';
import Ring, { RingLegend } from '../charts/Ring';
import { goalsApi, TODOS_CHANGED } from './goalsApi';
import { BOARD_TOKENS } from './PipelineView';
import { ErrorNote } from './goalsUi';
import { scopeLabel, captionFor, dayPoints, weekPoints, statusGroups, ownerSeries, categoryParts, bandSeries, channelPoints, historyNote, monthName } from './dashboardModel';

// sales-ia-v2 D1 - the Dashboard's 13 charts over one read (GET
// goals/dashboard). Range / Owner / Team live in the frame row (GoalsTab);
// snapshot charts ignore the range and say "as of today"; charts with no
// owner say "team-wide" while a filter is on. Inline SVG from the chart kit -
// no chart library. Pie only for the one part-of-a-whole (partners by category).
const STATUS = { new: SA.accent, accepted: SA.good, dismissed: 'var(--ui-control)' };
const TODO = { done: SA.good, open: 'var(--ui-control)' };

export default function DashboardCharts({ businessId, days, owner, team, lookup }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  // Filters change faster than reads return; only the newest read may land.
  const seq = useRef(0);
  const load = useCallback(() => {
    const n = ++seq.current;
    return goalsApi.dashboard(businessId, { days, owner, team }).then(d => { if (n === seq.current) { setData(d); setError(''); } }).catch(e => { if (n === seq.current) setError(e.message); });
  }, [businessId, days, owner, team]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener(TODOS_CHANGED, load);
    return () => window.removeEventListener(TODOS_CHANGED, load);
  }, [load]);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <div data-dashboard-charts aria-busy="true" style={{ minHeight: 420, color: SA.muted, fontSize: 13 }}>Loading charts…</div>;

  const scope = scopeLabel({ owner, team }, lookup);
  const range = `Last ${data.days} days`;
  const asOf = 'As of today';
  const owners = ownerSeries(data.partners_by_status_owner, lookup);
  const partnerGroups = statusGroups(data.partners_by_status_owner);
  const pie = categoryParts(data.partners_by_category);
  const history = historyNote(data);
  const visitorDays = dayPoints(data.visitors_per_day, ['companies']);
  const visitorPrio = dayPoints(data.visitors_by_priority_day, ['P1', 'P2', 'P3', 'P4']);
  const outreach = weekPoints(data.outreach_per_week, ['sent', 'opened', 'clicked', 'replied']);
  const repliesMeetings = weekPoints(data.replies_meetings_per_week, ['replies', 'meetings']);
  const anySignals = data.signals_by_channel.some(r => r.new + r.accepted + r.dismissed > 0);
  const todoRows = data.todos_per_owner.map(r => ({ id: r.owner_user_id || 'unassigned', label: lookup(r.owner_user_id).first, values: { done: r.done, open: r.open } }));
  const empty = (rows, what) => (rows.some(r => (r.value ?? 0) > 0 || Object.values(r.values || {}).some(Boolean)) ? null : `No ${what} yet`);
  const month = monthName(data.month);

  return (
    <div data-dashboard-charts data-days={data.days} className="ui-theme-dark" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 12 }}>
      <style>{TREND_THEME_CSS}{PRIORITY_THEME_CSS}</style>
      <ChartCard id="chart-pipeline-stage" title="Pipeline by stage" caption={captionFor(`Employers · ${asOf}`, scope)} empty={empty(data.pipeline_by_stage.map(s => ({ value: s.count })), 'employers')}>
        <BarChart label="Pipeline by stage" rows={data.pipeline_by_stage.map(s => ({ id: s.id, label: s.label, value: s.count }))} />
      </ChartCard>
      <ChartCard id="chart-partners-status" title="Partners by status per owner" caption={captionFor(asOf, scope)} empty={partnerGroups.length ? null : 'No partners yet'}>
        <BarChart label="Partners by status per owner" rows={partnerGroups} series={owners} barHeight={10} />
      </ChartCard>
      <ChartCard id="chart-partners-category" title="Partners by category" caption={captionFor(asOf, scope)} empty={pie.length ? null : 'No partners yet'}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <Ring parts={pie} center={String(pie.reduce((n, p) => n + p.count, 0))} caption="partners" size={120} stroke={16} label="Partners by category" />
          <RingLegend parts={pie} />
        </div>
      </ChartCard>
      <ChartCard id="chart-visitors-day" title="Website visitors per day" caption={captionFor(`Companies · ${range}`, scope, true)} note={history} empty={data.history_start ? null : 'No visitor pulls yet'}>
        <LineChart label="Website visitors per day" points={visitorDays} series={[{ id: 'companies', label: 'Companies', color: SA.accent }]} />
      </ChartCard>
      <ChartCard id="chart-visitors-priority" title="Visitors by priority per day" caption={captionFor(range, scope, true)} note={history} empty={data.history_start ? null : 'No visitor pulls yet'}>
        <ColumnChart label="Visitors by priority per day" mode="stacked" points={visitorPrio} series={['P1', 'P2', 'P3', 'P4'].map(p => ({ id: p, label: p, color: PRIORITY_COLORS[p] }))} />
      </ChartCard>
      <ChartCard id="chart-outreach" title="Outreach per week" caption={captionFor(`Apollo emails · ${range}`, scope, true)} empty={empty(outreach, 'emails in this range')}>
        <LineChart label="Outreach per week" points={outreach} series={[{ id: 'sent', label: 'Sent', color: 'var(--ui-control)' }, { id: 'opened', label: 'Opened', color: TREND_COLORS.open }, { id: 'clicked', label: 'Clicked', color: TREND_COLORS.click }, { id: 'replied', label: 'Replied', color: TREND_COLORS.reply }]} />
      </ChartCard>
      <ChartCard id="chart-replies-meetings" title="Replies and meetings per week" caption={captionFor(`All replies · meetings = stage moves in history · ${range}`, scope)} empty={empty(repliesMeetings, 'replies or meetings in this range')}>
        <ColumnChart label="Replies and meetings per week" mode="grouped" points={repliesMeetings} series={[{ id: 'replies', label: 'Replies', color: TREND_COLORS.reply }, { id: 'meetings', label: 'Meetings', color: SA.accent }]} />
      </ChartCard>
      <ChartCard id="chart-signals" title="Signals by channel and outcome" caption={captionFor(range, scope, true)} empty={anySignals ? null : 'No signals in this range'}>
        <BarChart label="Signals by channel and outcome" rows={data.signals_by_channel.map(r => ({ id: r.source, label: r.label, values: { new: r.new, accepted: r.accepted, dismissed: r.dismissed } }))}
          series={[{ id: 'new', label: 'New', color: STATUS.new }, { id: 'accepted', label: 'Accepted', color: STATUS.accepted }, { id: 'dismissed', label: 'Dismissed', color: STATUS.dismissed }]} barHeight={10} />
      </ChartCard>
      <ChartCard id="chart-companies-channel" title="Companies by channel and stage" caption={captionFor(`Partners, employers and targets · ${asOf}`, scope)} empty={data.companies_by_channel_stage.length ? null : 'No companies yet'}>
        <ColumnChart label="Companies by channel and stage" mode="stacked" points={channelPoints(data.companies_by_channel_stage)} series={bandSeries(BOARD_TOKENS)} />
      </ChartCard>
      <ChartCard id="chart-todos" title="To-dos done vs open this week" caption={captionFor(`Week of ${new Date(`${data.week_start}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`, scope)} empty={todoRows.length ? null : 'No to-dos this week'}>
        <BarChart label="To-dos done vs open this week" rows={todoRows} series={[{ id: 'done', label: 'Done', color: TODO.done }, { id: 'open', label: 'Open', color: TODO.open }]} barHeight={10} />
      </ChartCard>
      <ChartCard id="chart-waiting" title="Waiting on them" caption="Open rows · overdue past their date · team-wide">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <StatTile label="Open" value={data.waiting.open} />
          <StatTile label="Overdue" value={data.waiting.overdue} tone={data.waiting.overdue ? 'bad' : undefined} />
        </div>
      </ChartCard>
      <ChartCard id="chart-covered-lives" title="Covered lives by stage" caption={captionFor(`Employers · ${asOf}`, scope)} empty={empty(data.covered_lives_by_stage.map(s => ({ value: s.lives })), 'covered lives')}>
        <BarChart label="Covered lives by stage" rows={data.covered_lives_by_stage.map(s => ({ id: s.id, label: s.label, value: s.lives }))} format={fmtNum} />
      </ChartCard>
      <ChartCard id="chart-credits" title="Apollo credits used by visitor pulls" caption={`${month} · Prospector's own pulls · all businesses on the shared Apollo account`}>
        <Meter label="Apollo credits used this month" value={data.credits.used} cap={data.credits.cap} caption={month} />
        <span style={{ fontSize: 12, color: ui.muted }}>The daily pull pauses itself at {fmtNum(data.credits.cap)}.</span>
      </ChartCard>
    </div>
  );
}

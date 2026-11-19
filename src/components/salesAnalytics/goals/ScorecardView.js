import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { SA } from '../theme';
import Segmented from '../../../ui/Segmented';
import useMediaQuery from '../../../utils/useMediaQuery';
import { goalsApi } from './goalsApi';
import { laWeekStart } from '../periods';
import { Sparkline } from './PulseTiles';
import WeeklyChart from './WeeklyChart';
import { GROUP_COLOR, md, isRate, valueText, fullName, statusOf, changeOf, paceText, sparkLabel } from './scorecardWeekly';
import { cardStyle, labelStyle, subStyle, numStyle, EditableNumber, ErrorNote, NeedsMigration, Btn, fmt, pct, monthName, monthOf, weeksOfMonth } from './goalsUi';

// weekly-funnel-v1 Stage 2 - Dashboard › Scorecard, the weekly funnel. The rows are the registry's (GET goals/weekly:
// Outbound · Site · Pipeline · LinkedIn), every number the route's own digit: Last week · This week read as PACE (to
// date, the same point last week, "on pace for ~n" for counts only) · Change (▲ / ▼ by the metric's direction, beside
// the signed amount) · this week's Goal (the owner types it in place; next week's can be typed ahead) + progress · a 12-week line (goal dotted, this
// week hollow) that opens the full chart · the Month column (dashboard-v3: to date / goal + a ring, from GET
// goals/scorecard, for the rows that have a month). A LinkedIn cell is typed by a Member for this week or last week; an
// empty one is "—". Print = this table alone, white ground. Under 760 px: one tile per metric with its line, no table.
// ROWS = the rows the month route knows (the Month column, the no-goals banner, Copy last month's goals).
export const ROWS = [
  { key: 'total_in_sequence', name: 'In sequence' },
  { key: 'sequences_running', name: 'Sequences running' },
  { key: 'human_open_rate', name: 'Human open rate', rate: true },
  { key: 'meetings_set', name: 'Meetings set' },
  { key: 'people_first_touched', name: 'People first-touched', goalKey: 'partners_first_touched' },
  { key: 'tier1_touched_pct', name: 'Tier 1 touched', rate: true },
  { key: 'partner_meetings', name: 'Partner meetings' },
  { key: 'partners_pilot_live', name: 'Pilot / live' },
];
const goalKeyOf = r => r.goalKey || r.key;

// One month cell = value / goal / progress (pure; the route's digits in, three states out).
export function cellOf(row, metrics) {
  const m = metrics?.[row.key] || {};
  const g = metrics?.[goalKeyOf(row)] || {};
  const carried = g.goal == null && g.carried_goal != null;
  const goal = carried ? g.carried_goal : g.goal ?? null;
  const p = m.value != null && goal ? m.value / goal : null;
  return { value: m.value ?? null, goal, carried, p, status: statusOf(p), next_at: m.next_at || null };
}
const STATUS = { ok: ['✓', 'good'], warn: ['!', 'warn'], bad: ['✕', 'bad'] };
const tone = s => (s === 'ok' ? SA.good : s === 'warn' ? SA.warn : s === 'bad' ? SA.bad : SA.muted);
const DIR_COLOR = { good: SA.good, bad: SA.bad, flat: SA.muted, none: SA.faint };
const shortMonth = m => new Date(`${m}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
const mdIso = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
const agoOf = iso => { if (!iso) return null; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const addMonths = (month, n) => { const d = new Date(`${month}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return `${d.toISOString().slice(0, 7)}-01`; };
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const goalText = (rate, goal) => (rate ? pct(goal) : fmt(goal));
// "October's were: in sequence 3,500 · sequences 12 · …" - the month goals the previous month carried.
export const prevGoalsLine = prev => ROWS.map(r => { const g = prev?.month_total?.[goalKeyOf(r)]?.goal; return g == null ? null : `${r.name.toLowerCase()} ${goalText(r.rate, g)}`; }).filter(Boolean).join(' · ');
export const hasGoals = data => !!data && ROWS.some(r => data.month_total?.[goalKeyOf(r)]?.goal != null || data.weeks.some(w => w.metrics?.[goalKeyOf(r)]?.goal != null));

function Bar({ p, status, width = 150 }) {
  return (
    <span className="num" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, width }}>
      <span aria-hidden="true" style={{ flex: 1, height: 4, borderRadius: 999, background: SA.track, overflow: 'hidden', display: 'block' }}>
        <span style={{ display: 'block', height: '100%', width: `${Math.min(100, Math.round((p || 0) * 100))}%`, background: tone(status), borderRadius: 999 }} />
      </span>
      <span style={{ ...numStyle, fontSize: 11, width: 44, textAlign: 'right', color: tone(status), whiteSpace: 'nowrap' }}>{STATUS[status]?.[0]} {Math.round(p * 100)}%</span>
    </span>
  );
}
function Ring28({ p, status }) {
  const deg = Math.round(Math.min(1, p || 0) * 100);
  return (
    <span role="img" aria-label={`${deg}% of the month goal`} style={{ display: 'inline-grid', placeItems: 'center', width: 28, height: 28, borderRadius: 999, background: `conic-gradient(${tone(status)} ${deg}%, ${SA.track} 0)`, flex: 'none' }}>
      <span style={{ width: 20, height: 20, borderRadius: 999, background: SA.surface, display: 'grid', placeItems: 'center', fontSize: 8.5, fontWeight: 600, color: SA.text, ...numStyle }}>{deg}</span>
    </span>
  );
}
const pill = { display: 'inline-flex', alignItems: 'center', height: 17, padding: '0 6px', borderRadius: 999, border: `1px solid ${SA.border}`, fontSize: 9.5, color: SA.muted, fontFamily: "'Geist Mono', ui-monospace, monospace", letterSpacing: '.06em', textTransform: 'uppercase' };
const stack = { display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, minWidth: 0 };
const small = { fontSize: 11, color: SA.muted, ...numStyle };
const big = { ...numStyle, fontSize: 15, fontWeight: 600, color: SA.text };
const PHONE_PICKS = [{ id: 'last', label: 'Last wk' }, { id: 'this', label: 'This wk' }, { id: 'month', label: 'Month' }];

export default function ScorecardView({ businessId, isOwner, canEdit = false, toolsSlot }) {
  const phone = useMediaQuery('(max-width: 760px)');
  const thisWeek = laWeekStart();
  const thisMonth = monthOf(thisWeek);
  const [month, setMonth] = useState(thisMonth);
  const [data, setData] = useState(null);
  const [prev, setPrev] = useState(null);
  const [weekly, setWeekly] = useState(null);
  const [error, setError] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState('');
  const [tick, setTick] = useState(0);
  const [expanded, setExpanded] = useState(null);
  const [pick, setPick] = useState('this');
  useEffect(() => {
    let live = true;
    setError(null);
    goalsApi.scorecard(businessId, month, null).then(d => { if (live) setData(d); }).catch(e => { if (live) setError(e); });
    goalsApi.scorecard(businessId, addMonths(month, -1), null).then(d => { if (live) setPrev(d); }).catch(() => { if (live) setPrev(null); });
    return () => { live = false; };
  }, [businessId, month, tick]);
  // The weekly route reads every funnel table (seconds on real data): one read per page, again only after a save,
  // and the rows on screen stay up while it reloads.
  useEffect(() => {
    let live = true;
    goalsApi.weekly(businessId).then(d => { if (live) setWeekly(d); }).catch(e => { if (live) setError(e); });
    return () => { live = false; };
  }, [businessId, tick]);
  const monthData = data?.month === month ? data : null;
  const weeks = monthData?.weeks || weeksOfMonth(month).map(w => ({ week_start: w, metrics: {} }));
  const weekIdx = Math.max(0, weeks.findIndex(w => w.week_start === thisWeek));
  const noGoals = !!monthData && !hasGoals(monthData);
  const prevLine = useMemo(() => prevGoalsLine(prev), [prev]);
  const saved = async write => {
    setSaveError('');
    try { await write(); setTick(t => t + 1); } catch (e) { setSaveError(e.message); throw e; }
  };
  const save = body => saved(() => goalsApi.saveTarget(businessId, body));
  const saveManual = body => saved(() => goalsApi.saveManual(businessId, body));
  const copyPrev = async () => {
    if (!prev || busy) return;
    setBusy('copy'); setSaveError('');
    try {
      const prevWeeks = prev.weeks || [];
      for (const r of ROWS) {
        const k = goalKeyOf(r);
        const mg = prev.month_total?.[k]?.goal;
        if (mg != null) await goalsApi.saveTarget(businessId, { period: 'month', period_start: month, metric_key: k, goal: mg });
        for (let i = 0; i < weeks.length; i++) {
          const wg = prevWeeks[i]?.metrics?.[k]?.goal;
          if (wg != null && weeks[i].week_start >= thisWeek) await goalsApi.saveTarget(businessId, { period: 'week', period_start: weeks[i].week_start, metric_key: k, goal: wg, ...(k === 'partners_first_touched' ? { unit: 'people' } : {}) });
        }
      }
      setTick(t => t + 1);
    } catch (e) { setSaveError(e.message); } finally { setBusy(''); }
  };
  const synced = agoOf(monthData?.synced_at);
  const cal = monthData?.calendar;
  const calNote = cal?.none ? 'no calendar connected' : cal?.partial ? `${cal.members.join(' + ')}'s calendar` : null;
  const months = [addMonths(thisMonth, -1), thisMonth, addMonths(thisMonth, 1)];
  const setGoalsLabel = `Set ${monthName(month)} goals`;
  const tools = toolsSlot && createPortal(
    <>
      <Segmented label="Month" items={months.map(m => ({ id: m, label: shortMonth(m) }))} value={month} onChange={setMonth} />
      {!phone && <Btn onClick={() => window.print()}>Print</Btn>}
      {isOwner && !phone && <Btn primary onClick={() => document.getElementById('scorecard-first-goal')?.focus()} title="Goals are typed in place: click any goal cell">{setGoalsLabel}</Btn>}
    </>,
    toolsSlot,
  );

  // A goal cell: the owner edits in place (EditableNumber saves at once); everyone else reads.
  let firstGoal = true;
  const goalCell = ({ name, rate, goal, carried, goalKey, period, start, slash = false, extraStyle = {} }) => {
    const display = `${slash ? '/ ' : ''}${goalText(rate, goal)}`;
    if (!isOwner) return goal != null ? <span data-goal style={{ ...numStyle, fontSize: 12, color: SA.muted, ...extraStyle }}>{carried ? `${display} · carried` : display}</span> : null;
    const id = firstGoal ? 'scorecard-first-goal' : undefined; firstGoal = false;
    return (
      <span id={id} tabIndex={id ? -1 : undefined} data-goal style={{ ...numStyle, fontSize: 12, color: SA.muted, ...extraStyle }}>
        <EditableNumber value={carried ? null : goal} rate={rate} muted={carried} placeholder={carried ? `${display} · carried` : 'set goal'} display={display} ariaLabel={`${name} goal, ${period === 'month' ? monthName(start) : md(start)}`}
          onSave={v => save({ period, period_start: start, metric_key: goalKey, goal: v, ...(goalKey === 'partners_first_touched' && period === 'week' ? { unit: 'people' } : {}) })} />
      </span>
    );
  };
  const weekGoalCell = m => goalCell({ name: fullName(m), rate: isRate(m), goal: m.this_week.goal, carried: !!m.series[m.series.length - 1].carried, goalKey: m.goal_key, period: 'week', start: weekly.week_start });
  // Next week's goal can be typed ahead (the route takes next Monday); a reader sees the line only once one is set.
  const nextGoalLine = m => {
    const cell = m.next_week && goalCell({ name: fullName(m), rate: isRate(m), goal: m.next_week.goal, carried: !!m.next_week.carried, goalKey: m.goal_key, period: 'week', start: m.next_week.week_start });
    return cell ? <span data-next-goal style={{ ...small, display: 'inline-flex', alignItems: 'baseline', gap: 5 }}>next wk {cell}</span> : null;
  };
  const monthGoalCell = (r, cell, extraStyle) => goalCell({ name: r.name, rate: r.rate, goal: cell.goal, carried: cell.carried, goalKey: goalKeyOf(r), period: 'month', start: month, slash: true, extraStyle });
  // A typed cell (LinkedIn): a Member types this week's or last week's number; nobody's number is "—", never 0.
  const manualCell = (m, which) => {
    const start = which === 'this_week' ? weekly.week_start : m.last_week?.week_start;
    const value = which === 'this_week' ? m.this_week.to_date : m.last_week?.value ?? null;
    const by = m.entered?.[which];
    return (
      <span style={stack}>
        <span data-value style={big}>
          {canEdit && start
            ? <EditableNumber commitOnBlur value={value} placeholder="—" display={fmt(value)} ariaLabel={`${fullName(m)}, ${which === 'this_week' ? 'this week' : 'last week'} (week of ${md(start)})`} onSave={v => saveManual({ metric_key: m.key, week_start: start, value: v })} />
            : fmt(value)}
        </span>
        {by && <span data-entered style={small}>entered by {by.by} {mdIso(by.at)}</span>}
      </span>
    );
  };
  const paceLine = m => {
    const pace = paceText(m);
    if (pace) return <span data-pace="pace" style={small}><span style={{ ...labelStyle, fontSize: 9.5, marginRight: 5 }}>pace</span>{pace}</span>;
    return m.this_week.to_date == null ? null : <span data-pace="to-date" style={small}>{m.kind === 'stock' ? 'as of today' : 'to date'}</span>;
  };
  const changeMark = m => {
    const c = changeOf(m);
    if (c.dir === 'none') return null;
    return <span data-change={c.dir} role="img" aria-label={c.dir === 'flat' ? c.word : `${c.word}, ${c.text}`} style={{ ...numStyle, fontSize: 13, fontWeight: 600, color: DIR_COLOR[c.dir], whiteSpace: 'nowrap' }}>{c.glyph} {c.text}</span>;
  };
  const hitMark = lw => lw?.hit != null && <span role="img" aria-label={lw.hit ? 'goal met' : 'goal missed'} style={{ color: lw.hit ? SA.good : SA.bad, marginLeft: 4 }}>{lw.hit ? '✓' : '✕'}</span>;
  const spark = (m, width = 120) => (
    <Sparkline series={m.series.map(s => s.value)} goals={m.series.some(s => s.goal != null) ? m.series.map(s => s.goal ?? null) : null} hollowLast dots width={width} height={26} color={GROUP_COLOR[m.group]} label={sparkLabel(m)} />
  );
  const sourcePill = m => <span style={pill}>{m.source}{m.key === 'meetings_set' && calNote ? ` · ${calNote}` : ''}</span>;
  const banner = noGoals && (
    <div data-goals-banner style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: SA.inset, border: `1px solid ${SA.warn}`, flexWrap: 'wrap' }}>
      <span style={{ ...pill, height: 20, padding: '0 8px', fontSize: 11, color: SA.warn, borderColor: SA.warn, textTransform: 'none', letterSpacing: 0, fontFamily: 'inherit' }}>! no {monthName(month)} goals</span>
      <span style={{ fontSize: phone ? 12.5 : 13, color: SA.soft }}>
        {phone && !isOwner ? `No ${monthName(month)} goals yet — the owner sets them on desktop.` : prevLine ? `Every row shows "set goal". ${monthName(addMonths(month, -1))}'s were: ${prevLine}.` : `Every row shows "set goal". ${monthName(addMonths(month, -1))} had none either.`}
      </span>
      {isOwner && prevLine && !phone && <Btn onClick={copyPrev} disabled={!!busy} style={{ marginLeft: 'auto', height: 26, fontSize: 12 }}>{busy === 'copy' ? 'Copying…' : `Copy ${monthName(addMonths(month, -1))}'s goals`}</Btn>}
    </div>
  );
  const head = (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: phone ? 22 : 28, fontWeight: 600, letterSpacing: '-0.025em', color: SA.text }}>{phone ? monthName(month) : 'Scorecard'}</h1>
        <span style={{ color: SA.muted, fontSize: phone ? 12 : 14 }}>{phone ? `week ${weekIdx + 1} of ${weeks.length} · ${md(weeks[weekIdx]?.week_start || month)}` : `${monthName(month)} · week ${weekIdx + 1} of ${weeks.length} · the page Seif opens weekly`}</span>
      </div>
      {!phone && <span style={{ fontSize: 12, color: SA.muted }}>Actuals fill in on every sync. Goals and the LinkedIn rows are typed.</span>}
    </div>
  );
  const errorBlock = error ? (error.needsMigration ? <NeedsMigration what="The scorecard" /> : <ErrorNote message={error.message} />) : null;
  const saveBlock = saveError && (saveError.includes('database update') || saveError.includes('metric_key') ? <NeedsMigration what="Saving this" /> : <div data-save-error><ErrorNote message={saveError} /></div>);
  const groupsOf = keep => (weekly ? weekly.groups.map(g => [g, weekly.metrics.filter(m => m.group === g && keep(m))]).filter(([, list]) => list.length) : []);

  if (phone) {
    const tile = m => {
      const manual = m.kind === 'manual', tw = m.this_week, lw = m.last_week;
      const mr = ROWS.find(r => r.key === m.key);
      const mc = pick === 'month' ? cellOf(mr, monthData?.month_total) : null;
      const value = pick === 'month' ? goalText(mr.rate, mc.value) : pick === 'last' ? (manual ? manualCell(m, 'last_week') : valueText(m, lw?.value)) : manual ? manualCell(m, 'this_week') : valueText(m, tw.to_date);
      const goal = pick === 'month' ? mc.goal : pick === 'last' ? lw?.goal : tw.goal;
      const p = pick === 'month' ? mc.p : pick === 'this' ? tw.progress : null;
      return (
        <div key={m.key} data-tile={m.key} style={{ ...cardStyle, padding: '14px 16px', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <b style={{ fontSize: 13, fontWeight: 500, color: SA.text }}>{m.name}</b>
            {sourcePill(m)}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <span data-value={manual && pick !== 'month' ? undefined : ''} style={{ ...numStyle, fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', color: SA.text }}>
              {value}{goal != null && <small style={{ fontSize: 13, color: SA.muted, fontWeight: 400 }}> / {goalText(pick === 'month' ? mr.rate : isRate(m), goal)}{pick === 'last' && hitMark(lw)}</small>}
            </span>
            {pick === 'this' && !manual && <span style={{ ...stack, fontSize: 12, color: SA.muted }}>{changeMark(m)}{tw.same_point_last_week != null && <span style={small}>vs {valueText(m, tw.same_point_last_week)} same point last wk</span>}</span>}
            {pick === 'month' && m.key === 'meetings_set' && mc.next_at && <span style={{ fontSize: 12, color: SA.muted }}>next {mdIso(mc.next_at)}</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minWidth: 0 }}>
            <span style={{ minWidth: 0 }}>{pick === 'this' && !manual ? paceLine(m) : <span style={small}>12 weeks</span>}</span>
            {spark(m)}
          </div>
          {p != null ? <Bar p={p} status={statusOf(p)} width="100%" /> : pick === 'month' ? monthGoalCell(mr, mc) : pick === 'this' ? weekGoalCell(m) : null}
          {pick === 'this' && nextGoalLine(m)}
        </div>
      );
    };
    return (
      <div data-scorecard="phone" style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        {tools}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          {head}
          <Segmented label="Week" items={PHONE_PICKS} value={pick} onChange={setPick} />
        </div>
        {banner}{errorBlock}
        {!weekly && !error && <span style={subStyle}>Loading…</span>}
        {groupsOf(m => pick !== 'month' || ROWS.some(r => r.key === m.key)).map(([g, list]) => [<span key={g} style={labelStyle}>{g}</span>, ...list.map(tile)])}
        {saveBlock}
        {weekly && <div data-pace-rule style={{ fontSize: 11.5, color: SA.muted }}>{weekly.wording.pace}</div>}
        <div style={{ fontSize: 11.5, color: SA.muted, textAlign: 'center', paddingTop: 6 }}>{[!isOwner ? 'Read-only on this account' : null, synced ? `synced ${synced}` : null].filter(Boolean).join(' · ')}</div>
      </div>
    );
  }

  const th = { textAlign: 'right', fontWeight: 500, height: 40, padding: '0 10px', borderBottom: `1px solid ${SA.border}`, whiteSpace: 'nowrap', background: SA.surface, verticalAlign: 'middle' };
  const td = { height: 58, padding: '5px 10px', borderBottom: `1px solid ${SA.track}`, whiteSpace: 'nowrap', textAlign: 'right', color: SA.soft, verticalAlign: 'middle' };
  const tint = { background: `color-mix(in srgb, ${SA.accent} 6%, transparent)` };
  const faint = <span style={{ ...numStyle, color: SA.faint, fontSize: 15, fontWeight: 500 }}>—</span>;
  const COLS = 7;
  const row = m => {
    const manual = m.kind === 'manual', tw = m.this_week, lw = m.last_week;
    const open = expanded === m.key;
    const toggle = () => setExpanded(open ? null : m.key);
    const mr = ROWS.find(r => r.key === m.key);
    const mc = mr && monthData ? cellOf(mr, monthData.month_total) : null;
    const goal = weekGoalCell(m);
    return [
      <tr key={m.key} id={`score-row-${m.key}`} data-row={m.key}>
        <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
            <button type="button" data-expand aria-expanded={open} aria-controls={`score-chart-${m.key}`} title={`${open ? 'Hide' : 'Show'} the ${m.series.length}-week chart`} onClick={toggle}
              style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontWeight: 500, color: SA.text, cursor: 'pointer', textAlign: 'left' }}>
              <span aria-hidden="true" className="no-print" style={{ display: 'inline-block', width: 12, color: SA.muted, fontSize: 10 }}>{open ? '▾' : '▸'}</span>{m.name}
            </button>
            <span data-hint style={{ fontSize: 12, color: SA.muted, display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingLeft: 12 }}>{sourcePill(m)}{m.hint}</span>
          </div>
        </td>
        <td data-cell={`${m.key}|last`} style={td}>
          {manual ? manualCell(m, 'last_week') : (
            <span style={stack}>
              <span data-value style={big}>{valueText(m, lw?.value)}</span>
              {lw?.goal != null && <span style={small}>/ {valueText(m, lw.goal)}{hitMark(lw)}</span>}
            </span>
          )}
        </td>
        <td data-cell={`${m.key}|this`} style={{ ...td, ...tint }}>
          {manual ? manualCell(m, 'this_week') : <span style={stack}><span data-value style={big}>{valueText(m, tw.to_date)}</span>{paceLine(m)}</span>}
        </td>
        <td data-cell={`${m.key}|change`} style={td}>
          {tw.delta == null ? faint : <span style={stack}>{changeMark(m)}<span style={small}>vs {valueText(m, tw.same_point_last_week)}</span></span>}
        </td>
        <td data-cell={`${m.key}|goal`} style={td}>
          <span style={stack}>{goal || (tw.progress == null ? faint : null)}{tw.progress != null && <Bar p={tw.progress} status={statusOf(tw.progress)} />}{nextGoalLine(m)}</span>
        </td>
        <td data-cell={`${m.key}|spark`} onClick={toggle} style={{ ...td, cursor: 'pointer' }}>{spark(m)}</td>
        <td data-cell={`${m.key}|month`} style={td}>
          {!mc ? (mr ? null : faint) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <span data-value style={{ ...numStyle, fontWeight: 600, color: SA.text }}>{goalText(mr.rate, mc.value)}{mc.goal != null && <small style={{ fontSize: 12, color: SA.muted, fontWeight: 400 }}> / {goalText(mr.rate, mc.goal)}</small>}</span>
              {mc.p != null ? <Ring28 p={mc.p} status={mc.status} /> : monthGoalCell(mr, mc, { color: SA.faint })}
            </span>
          )}
        </td>
      </tr>,
      open && (
        <tr key={`${m.key}-chart`} id={`score-chart-${m.key}`} data-expanded={m.key} className="no-print">
          <td colSpan={COLS} style={{ padding: '12px 14px 14px', background: SA.inset, borderBottom: `1px solid ${SA.track}`, textAlign: 'left' }}><WeeklyChart metric={m} wording={weekly.wording} /></td>
        </tr>
      ),
    ];
  };
  const lastWeek = weekly ? addDays(weekly.week_start, -7) : null;
  return (
    <div id="sales-analytics-print-area" data-scorecard="table" style={{ maxWidth: 1100, width: '100%', display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      {tools}
      {head}
      <div className="no-print">{banner}</div>
      {errorBlock}
      {!weekly && !error && <span style={subStyle}>Loading…</span>}
      {weekly && (
        <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
          <table data-scorecard-table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', tableLayout: 'fixed', fontSize: 13 }}>
            <colgroup><col style={{ width: 224 }} /><col style={{ width: 88 }} /><col style={{ width: 168 }} /><col style={{ width: 140 }} /><col style={{ width: 176 }} /><col style={{ width: 144 }} /><col style={{ width: 160 }} /></colgroup>
            <thead><tr>
              <th scope="col" style={{ ...th, textAlign: 'left' }}><span style={labelStyle}>Metric</span></th>
              <th scope="col" data-week={lastWeek} style={th}><span style={labelStyle}>Last week</span><br /><span style={{ fontSize: 11, color: SA.muted }}>{md(lastWeek)} – {md(addDays(lastWeek, 6))}</span></th>
              <th scope="col" data-week={weekly.week_start} data-this-week style={{ ...th, background: SA.surface2, boxShadow: `inset 0 -2px 0 ${SA.accent}` }}><span style={{ ...labelStyle, color: SA.text }}>This week · pace</span><br /><span style={{ fontSize: 11, color: SA.muted }}>{md(weekly.week_start)} – {md(weekly.today)} · day {weekly.elapsed.days} of 7</span></th>
              <th scope="col" style={th}><span style={labelStyle}>Change</span><br /><span style={{ fontSize: 11, color: SA.muted }}>vs same point last wk</span></th>
              <th scope="col" style={th}><span style={labelStyle}>Goal</span><br /><span style={{ fontSize: 11, color: SA.muted }}>this week · progress · next</span></th>
              <th scope="col" style={th}><span style={labelStyle}>{weekly.weeks.length} weeks</span><br /><span style={{ fontSize: 11, color: SA.muted }}>since {md(weekly.weeks[0])}</span></th>
              <th scope="col" style={th}><span style={labelStyle}>{monthName(month)}</span><br /><span style={{ fontSize: 11, color: SA.muted }}>to date / goal</span></th>
            </tr></thead>
            <tbody>
              {groupsOf(() => true).map(([g, list]) => [
                <tr key={g} data-group={g}><td colSpan={COLS} style={{ height: 30, background: SA.inset, padding: '0 10px', textAlign: 'left' }}><span style={labelStyle}>{g}</span>{g === 'LinkedIn' && <span style={{ fontSize: 11.5, color: SA.muted, marginLeft: 10 }}>typed by a member, this week or last week · an empty cell is "—", not zero</span>}</td></tr>,
                ...list.map(row),
              ])}
            </tbody>
          </table>
        </div>
      )}
      {saveBlock}
      <div className="no-print" style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 12, color: SA.muted, flexWrap: 'wrap' }}>
        <span>{isOwner ? 'Click a goal to edit it in place.' : 'Read-only on this account.'}{canEdit && !isOwner ? ' The LinkedIn cells are yours to type.' : ''} Click a metric for its chart.</span>
        <span aria-hidden="true" style={{ width: 1, height: 20, background: SA.border }} />
        <span style={{ display: 'inline-flex', gap: 14, flexWrap: 'wrap' }}>{[['ok', '≥ 90%'], ['warn', '50–89%'], ['bad', '< 50%']].map(([s, l]) => <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 8, height: 8, borderRadius: 999, background: tone(s), display: 'inline-block' }} />{l}</span>)}</span>
        <span aria-hidden="true" style={{ width: 1, height: 20, background: SA.border }} />
        <span>▲ moved the good way · ▼ the bad way</span>
        {weekly && <span data-pace-rule style={{ flexBasis: '100%' }}>{weekly.wording.pace} {weekly.wording.week}{synced ? ` Synced ${synced}.` : ''}</span>}
      </div>
    </div>
  );
}

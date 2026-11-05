import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { SA } from '../theme';
import Segmented from '../../../ui/Segmented';
import useMediaQuery from '../../../utils/useMediaQuery';
import { goalsApi } from './goalsApi';
import { laWeekStart } from '../periods';
import { cardStyle, labelStyle, subStyle, numStyle, EditableNumber, ErrorNote, NeedsMigration, Btn, fmt, pct, monthName, monthOf, weeksOfMonth } from './goalsUi';

// dashboard-v3 Stage 1 - Dashboard › Scorecard (specs/design/dashboard-v3/DashScorecard.dc.html + DashScorecardPhone.dc.html):
// the page Seif opens weekly. Eight metrics in two groups, Wk 1-4 of the month (this week tinted, future weeks "—") and
// the Month column (to date / goal + a ring); every number is the scorecard route's own digit, nothing is computed here.
// Goals: the owner types them in place (click a goal) or copies last month's; everyone else reads. No goal for the month
// = the banner. Print = this table alone, white ground, one page (the frame's print CSS). Under 760 px: one tile per
// metric for the week picked (Wk n / Month), no table, no sideways scroll.
export const ROWS = [
  { key: 'total_in_sequence', name: 'In sequence', hint: 'people in active sequences', source: 'Apollo', format: fmt, group: 'Outreach' },
  { key: 'sequences_running', name: 'Sequences running', hint: 'active sequences', source: 'Apollo', format: fmt },
  { key: 'human_open_rate', name: 'Human open rate', hint: 'tracked opens ÷ delivered', source: 'Apollo', format: pct, rate: true },
  { key: 'meetings_set', name: 'Meetings set', hint: 'events with an external domain · was manual', source: 'Outlook', format: fmt },
  { key: 'people_first_touched', name: 'People first-touched', hint: 'emailed, called, met or messaged', source: 'App', format: fmt, group: 'Partners', goalKey: 'partners_first_touched' },
  { key: 'tier1_touched_pct', name: 'Tier 1 touched', hint: 'T1 partners with any touch', source: 'App', format: pct, rate: true },
  { key: 'partner_meetings', name: 'Partner meetings', hint: 'moved to Meeting', source: 'App', format: fmt },
  { key: 'partners_pilot_live', name: 'Pilot / live', hint: 'at week end', source: 'App', format: fmt },
];
const goalKeyOf = r => r.goalKey || r.key;

// One cell = value / goal / progress (pure; the route's digits in, the mockup's three states out).
export function cellOf(row, metrics) {
  const m = metrics?.[row.key] || {};
  const g = metrics?.[goalKeyOf(row)] || {};
  const carried = g.goal == null && g.carried_goal != null;
  const goal = carried ? g.carried_goal : g.goal ?? null;
  const p = m.value != null && goal ? m.value / goal : null;
  return { value: m.value ?? null, goal, carried, p, status: p == null ? null : p >= 0.9 ? 'ok' : p >= 0.5 ? 'warn' : 'bad', next_at: m.next_at || null };
}
const STATUS = { ok: ['✓', 'good'], warn: ['!', 'warn'], bad: ['✕', 'bad'] };
const tone = s => (s === 'ok' ? SA.good : s === 'warn' ? SA.warn : s === 'bad' ? SA.bad : SA.muted);
const shortMonth = m => new Date(`${m}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
const md = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const mdIso = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
const agoOf = iso => { if (!iso) return null; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const addMonths = (month, n) => { const d = new Date(`${month}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return `${d.toISOString().slice(0, 7)}-01`; };
const goalText = (row, goal) => (row.rate ? pct(goal) : fmt(goal));
// "October's were: in sequence 3,500 · sequences 12 · …" - the month goals the previous month carried.
export const prevGoalsLine = prev => ROWS.map(r => { const g = prev?.month_total?.[goalKeyOf(r)]?.goal; return g == null ? null : `${r.name.toLowerCase()} ${goalText(r, g)}`; }).filter(Boolean).join(' · ');
export const hasGoals = data => !!data && ROWS.some(r => data.month_total?.[goalKeyOf(r)]?.goal != null || data.weeks.some(w => w.metrics?.[goalKeyOf(r)]?.goal != null));

function Bar({ p, status }) {
  return (
    <span className="num" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, width: 150 }}>
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

export default function ScorecardView({ businessId, isOwner, toolsSlot, onOpen }) {
  const phone = useMediaQuery('(max-width: 760px)');
  const thisWeek = laWeekStart();
  const thisMonth = monthOf(thisWeek);
  const [month, setMonth] = useState(thisMonth);
  const [data, setData] = useState(null);
  const [prev, setPrev] = useState(null);
  const [error, setError] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState('');
  const [tick, setTick] = useState(0);
  const [pick, setPick] = useState(null); // phone: a week_start or 'month'
  useEffect(() => {
    let live = true;
    setData(null); setError(null);
    goalsApi.scorecard(businessId, month, null).then(d => { if (live) setData(d); }).catch(e => { if (live) setError(e); });
    goalsApi.scorecard(businessId, addMonths(month, -1), null).then(d => { if (live) setPrev(d); }).catch(() => { if (live) setPrev(null); });
    return () => { live = false; };
  }, [businessId, month, tick]);
  const weeks = data?.weeks || weeksOfMonth(month).map(w => ({ week_start: w, metrics: {} }));
  const weekIdx = Math.max(0, weeks.findIndex(w => w.week_start === thisWeek));
  const toDate = weeks.filter(w => w.week_start <= thisWeek);
  const picked = pick || (toDate.length ? toDate[toDate.length - 1].week_start : weeks[0]?.week_start);
  const noGoals = !!data && !hasGoals(data);
  const prevLine = useMemo(() => prevGoalsLine(prev), [prev]);
  const save = async body => {
    setSaveError('');
    try { await goalsApi.saveTarget(businessId, body); setTick(t => t + 1); } catch (e) { setSaveError(e.message); throw e; }
  };
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
          if (wg != null) await goalsApi.saveTarget(businessId, { period: 'week', period_start: weeks[i].week_start, metric_key: k, goal: wg, ...(k === 'partners_first_touched' ? { unit: 'people' } : {}) });
        }
      }
      setTick(t => t + 1);
    } catch (e) { setSaveError(e.message); } finally { setBusy(''); }
  };
  const synced = agoOf(data?.synced_at);
  const cal = data?.calendar;
  const calNote = cal?.none ? 'no calendar connected' : cal?.partial ? `${cal.members.join(' + ')}'s calendar` : null;
  const months = [addMonths(thisMonth, -1), thisMonth, addMonths(thisMonth, 1)];
  const setGoalsLabel = `Set ${monthName(month)} goals`;
  const tools = toolsSlot && createPortal(
    <>
      <Segmented label="Month" items={months.map(m => ({ id: m, label: shortMonth(m) }))} value={month} onChange={m => { setMonth(m); setPick(null); }} />
      {!phone && <Btn onClick={() => window.print()}>Print</Btn>}
      {isOwner && !phone && <Btn primary onClick={() => document.getElementById('scorecard-first-goal')?.focus()} title="Goals are typed in place: click any goal cell">{setGoalsLabel}</Btn>}
    </>,
    toolsSlot,
  );

  // A goal cell: the owner edits in place (EditableNumber saves at once); everyone else reads.
  let firstGoal = true;
  const goalCell = (row, cell, period, start, extraStyle = {}) => {
    const display = `/ ${goalText(row, cell.goal)}`;
    if (!isOwner) return cell.goal != null ? <span style={{ ...numStyle, fontSize: 12, color: SA.muted, ...extraStyle }}>{cell.carried ? `${display} · carried` : display}</span> : null;
    const id = firstGoal ? 'scorecard-first-goal' : undefined; firstGoal = false;
    return (
      <span id={id} tabIndex={id ? -1 : undefined} style={{ ...numStyle, fontSize: 12, color: SA.muted, ...extraStyle }}>
        <EditableNumber value={cell.carried ? null : cell.goal} rate={row.rate} muted={cell.carried} placeholder={cell.carried ? `${display} · carried` : 'set goal'} display={display} ariaLabel={`${row.name} goal, ${period === 'month' ? monthName(start) : md(start)}`}
          onSave={v => save({ period, period_start: start, metric_key: goalKeyOf(row), goal: v, ...(goalKeyOf(row) === 'partners_first_touched' && period === 'week' ? { unit: 'people' } : {}) })} />
      </span>
    );
  };
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
      {!phone && <span style={{ fontSize: 12, color: SA.muted }}>Actuals fill in on every sync. Only goals are typed.</span>}
    </div>
  );
  const errorBlock = error ? (error.needsMigration ? <NeedsMigration what="The scorecard" /> : <ErrorNote message={error.message} />) : null;

  if (phone) {
    const w = picked === 'month' ? null : weeks.find(x => x.week_start === picked);
    const prevW = w ? weeks[weeks.findIndex(x => x.week_start === w.week_start) - 1] : null;
    return (
      <div data-scorecard="phone" style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        {tools}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          {head}
          <Segmented label="Week" items={[...toDate.map((x, i) => ({ id: x.week_start, label: `Wk ${i + 1}` })), { id: 'month', label: 'Month' }]} value={picked} onChange={setPick} />
        </div>
        {banner}{errorBlock}
        {!data && !error && <span style={subStyle}>Loading…</span>}
        {data && ROWS.map(r => {
          const cell = w ? cellOf(r, w.metrics) : cellOf(r, data.month_total);
          const prevCell = prevW ? cellOf(r, prevW.metrics) : null;
          const delta = w && prevCell && prevCell.value != null && cell.value != null
            ? (r.rate ? `${cell.value - prevCell.value >= 0 ? '+' : '−'}${Math.abs((cell.value - prevCell.value) * 100).toFixed(1)} pts vs last wk` : `${cell.value - prevCell.value >= 0 ? '+' : '−'}${fmt(Math.abs(cell.value - prevCell.value))} vs last wk`)
            : r.key === 'meetings_set' && cell.next_at ? `next ${mdIso(cell.next_at)}` : '';
          return [
            r.group && <span key={`${r.key}-g`} style={labelStyle}>{r.group}</span>,
            <div key={r.key} data-tile={r.key} style={{ ...cardStyle, padding: '14px 16px', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <b style={{ fontSize: 13, fontWeight: 500, color: SA.text }}>{r.name}</b>
                <span style={pill}>{r.source}{r.key === 'meetings_set' && calNote ? ` · ${calNote}` : ''}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <span data-value style={{ ...numStyle, fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', color: SA.text }}>
                  {r.format(cell.value)}{cell.goal != null && <small style={{ fontSize: 13, color: SA.muted, fontWeight: 400 }}> / {goalText(r, cell.goal)}</small>}
                </span>
                <span style={{ fontSize: 12, color: SA.muted }}>{delta}</span>
              </div>
              {cell.p != null ? <Bar p={cell.p} status={cell.status} /> : goalCell(r, cell, w ? 'week' : 'month', w ? w.week_start : month)}
            </div>,
          ];
        })}
        {saveError && <ErrorNote message={saveError} />}
        <div style={{ fontSize: 11.5, color: SA.faint, textAlign: 'center', paddingTop: 6 }}>{[!isOwner ? 'Read-only on this account' : null, synced ? `synced ${synced}` : null].filter(Boolean).join(' · ')}</div>
      </div>
    );
  }

  const th = { textAlign: 'right', fontWeight: 500, height: 40, padding: '0 10px', borderBottom: `1px solid ${SA.border}`, whiteSpace: 'nowrap', background: SA.surface, verticalAlign: 'middle' };
  const td = { height: 46, padding: '0 10px', borderBottom: `1px solid ${SA.track}`, whiteSpace: 'nowrap', textAlign: 'right', color: SA.soft, verticalAlign: 'middle' };
  return (
    <div id="sales-analytics-print-area" data-scorecard="table" style={{ maxWidth: 1100, width: '100%', display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      {tools}
      {head}
      <div className="no-print">{banner}</div>
      {errorBlock}
      {!data && !error && <span style={subStyle}>Loading…</span>}
      {data && (
        <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
          <table data-scorecard-table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', tableLayout: 'fixed', fontSize: 13 }}>
            <colgroup><col style={{ width: 270 }} />{weeks.map(w => <col key={w.week_start} />)}<col style={{ width: 170 }} /></colgroup>
            <thead><tr>
              <th scope="col" style={{ ...th, textAlign: 'left' }}><span style={labelStyle}>Metric</span></th>
              {weeks.map((w, i) => {
                const sel = w.week_start === thisWeek;
                return (
                  <th key={w.week_start} scope="col" data-week={w.week_start} data-this-week={sel || undefined} style={{ ...th, ...(sel ? { background: SA.surface2, boxShadow: `inset 0 -2px 0 ${SA.accent}` } : {}) }}>
                    <span style={{ ...labelStyle, color: sel ? SA.text : SA.muted }}>Wk {i + 1}{sel ? ' · this week' : ''}</span><br /><span style={{ fontSize: 11, color: SA.faint }}>{md(w.week_start)}</span>
                  </th>
                );
              })}
              <th scope="col" style={th}><span style={labelStyle}>{monthName(month)}</span><br /><span style={{ fontSize: 11, color: SA.faint }}>to date / goal</span></th>
            </tr></thead>
            <tbody>
              {ROWS.map(r => {
                const m = cellOf(r, data.month_total);
                return [
                  r.group && <tr key={`${r.key}-g`}><td colSpan={weeks.length + 2} style={{ height: 30, background: SA.inset, padding: '0 10px', textAlign: 'left' }}><span style={labelStyle}>{r.group}</span></td></tr>,
                  <tr key={r.key} id={`score-row-${r.key}`}>
                    <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <b style={{ fontWeight: 500, color: SA.text }}>{r.name}</b>
                        <span style={{ fontSize: 12, color: SA.muted, display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}><span style={pill}>{r.source}{r.key === 'meetings_set' && calNote ? ` · ${calNote}` : ''}</span>{r.hint}</span>
                      </div>
                    </td>
                    {weeks.map(w => {
                      const future = w.week_start > thisWeek;
                      const cell = cellOf(r, w.metrics);
                      const sel = w.week_start === thisWeek;
                      return (
                        <td key={w.week_start} data-cell={`${r.key}|${w.week_start}`} style={{ ...td, background: sel ? `color-mix(in srgb, ${SA.accent} 6%, transparent)` : undefined }}>
                          {future ? <span style={{ ...numStyle, color: SA.faint, fontSize: 15, fontWeight: 500 }}>—</span> : (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                              <span data-value style={{ ...numStyle, fontSize: 15, fontWeight: 600, color: SA.text }}>{r.format(cell.value)}{cell.goal != null && cell.p != null && <small style={{ fontSize: 12, fontWeight: 400, color: SA.muted, marginLeft: 3 }}>/ {goalText(r, cell.goal)}</small>}</span>
                              {cell.p != null ? <Bar p={cell.p} status={cell.status} /> : goalCell(r, cell, 'week', w.week_start)}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td data-cell={`${r.key}|month`} style={td}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                        <span data-value style={{ ...numStyle, fontWeight: 600, color: SA.text }}>{r.format(m.value)}{m.goal != null && <small style={{ fontSize: 12, color: SA.muted, fontWeight: 400 }}> / {goalText(r, m.goal)}</small>}</span>
                        {m.p != null ? <Ring28 p={m.p} status={m.status} /> : goalCell(r, m, 'month', month, { color: SA.faint })}
                      </span>
                    </td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
      {saveError && (saveError.includes('database update') || saveError.includes('metric_key') ? <NeedsMigration what="Saving this goal" /> : <ErrorNote message={saveError} />)}
      <div className="no-print" style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 12, color: SA.muted, flexWrap: 'wrap' }}>
        <span>{isOwner ? 'Click a goal to edit it in place.' : 'Read-only on this account.'}</span>
        <span aria-hidden="true" style={{ width: 1, height: 20, background: SA.border }} />
        <span style={{ display: 'inline-flex', gap: 14, flexWrap: 'wrap' }}>{[['ok', '≥ 90%'], ['warn', '50–89%'], ['bad', '< 50%']].map(([s, l]) => <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 8, height: 8, borderRadius: 999, background: tone(s), display: 'inline-block' }} />{l}</span>)}</span>
        <span aria-hidden="true" style={{ width: 1, height: 20, background: SA.border }} />
        <span>{synced ? `Synced ${synced}. ` : ''}Dropped from the old scorecard: Outbound audience, Apollo open rate (replaced by human opens), the Weekly report (never finalized).</span>
      </div>
      {onOpen && null}
    </div>
  );
}

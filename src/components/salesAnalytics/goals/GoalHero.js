import { useState, useEffect, useCallback } from 'react';
import { SA, saSans } from '../theme';
import Ring from '../charts/Ring';
import { goalsApi } from './goalsApi';
import { labelStyle, subStyle, numStyle, inputStyle, Btn, Chip, ErrorNote, NeedsMigration, addDays, monthOf, monthName, shortWeek, fmt, short, progressColor } from './goalsUi';

// goals-surface-v1 Stage 3 - the five goals at the top of Goals, on every
// view: actual vs goal, % ring, 6-week trend (goal dashed), week-on-week
// change. A card with no goal offers "Set goal" (same targets route as the
// scorecard). Clicking a card's number opens where it comes from.
// Replaces the right rail's "<Month> at a glance".
// prospector_goals_hero - per-viewer convenience: 'collapsed' or not.
const HERO_KEY = 'prospector_goals_hero';
const readOpen = () => { try { return localStorage.getItem(HERO_KEY) !== 'collapsed'; } catch { return true; } };
const writeOpen = open => { try { localStorage.setItem(HERO_KEY, open ? 'open' : 'collapsed'); } catch { /* private mode */ } };
const WEEKS = 6;

// Weekly points with the goal dashed behind them; a missing week is a gap,
// never a zero. Each point has a hover title with its value.
function Sparkline({ points, format, width = 104, height = 32 }) {
  const vals = points.flatMap(p => [p.value, p.goal]).filter(v => v != null);
  if (points.filter(p => p.value != null).length < 2) return <span style={{ ...subStyle, fontSize: 11 }}>Not enough weeks yet</span>;
  const max = Math.max(...vals, 1), min = Math.min(...vals, 0);
  const x = i => 4 + (i * (width - 8)) / (points.length - 1);
  const y = v => height - 4 - ((v - min) / (max - min || 1)) * (height - 8);
  const path = key => {
    let d = '', on = false;
    points.forEach((p, i) => { if (p[key] == null) { on = false; return; } d += `${on ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p[key]).toFixed(1)} `; on = true; });
    return d;
  };
  const last = points.length - 1;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" style={{ display: 'block', overflow: 'visible' }}
      aria-label={`Last ${points.length} weeks: ${points.map(p => `${shortWeek(p.week)} ${format(p.value)}`).join(', ')}`}>
      {points.some(p => p.goal != null) && <path d={path('goal')} fill="none" stroke={SA.muted} strokeWidth="1.5" strokeDasharray="3 3" />}
      <path d={path('value')} fill="none" stroke={SA.accent} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {points[last].value != null && <circle cx={x(last)} cy={y(points[last].value)} r="3" fill={SA.accent} />}
      {points.map((p, i) => (
        <circle key={p.week} cx={x(i)} cy={p.value == null ? height / 2 : y(p.value)} r="9" fill="transparent">
          <title>{`${shortWeek(p.week)}: ${format(p.value)}${p.goal != null ? ` (goal ${format(p.goal)})` : ''}`}</title>
        </circle>
      ))}
    </svg>
  );
}

function SetGoal({ label, onSave }) {
  const [draft, setDraft] = useState(null);
  const [state, setState] = useState('');
  if (draft === null) {
    return <Btn style={{ height: 32, fontSize: 13, borderColor: SA.accent, color: SA.text }} onClick={() => { setDraft(''); setState(''); }}>Set goal</Btn>;
  }
  const save = async e => {
    e.preventDefault();
    const n = Number(draft.replace(/,/g, ''));
    if (!draft.trim() || !(Number.isFinite(n) && n >= 0)) { setState('A number, 0 or more'); return; }
    setState('Saving…');
    try { await onSave(n); setDraft(null); } catch (err) { setState(err.needsMigration ? 'Needs the database update (see report)' : err.message); }
  };
  return (
    <form onSubmit={save} onKeyDown={e => { if (e.key === 'Escape') setDraft(null); }} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input autoFocus value={draft} inputMode="decimal" aria-label={`Goal for ${label}`} placeholder="goal"
          onChange={e => setDraft(e.target.value)} style={{ ...inputStyle, height: 32, width: 96, fontSize: 13 }} />
        <Btn primary type="submit" style={{ height: 32, fontSize: 13, padding: '0 10px' }}>Save</Btn>
      </div>
      {state && <span role={state === 'Saving…' ? undefined : 'alert'} style={{ fontSize: 11, color: state === 'Saving…' ? SA.muted : SA.bad }}>{state}</span>}
    </form>
  );
}

function Card({ card, canEdit, onDrill, openTasks, onOpenTasks }) {
  const p = card.value != null && card.goal ? card.value / card.goal : null;
  const pctLabel = p == null ? '—' : `${Math.round(p * 100)}%`;
  return (
    <section aria-label={card.name} style={{ background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <button type="button" onClick={onDrill} title={`Open ${card.drillLabel}`}
          style={{ all: 'unset', ...saSans, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, borderRadius: 6 }}>
          <span style={{ ...labelStyle, display: 'flex', gap: 6, alignItems: 'center' }}>{card.name}{card.teamOnly && <Chip style={{ height: 18, fontSize: 10, padding: '0 6px' }}>team</Chip>}</span>
          <span style={{ ...numStyle, fontSize: 24, fontWeight: 600, lineHeight: 1.1, color: SA.text }}>{card.format(card.value)}</span>
          <span style={{ ...subStyle, fontSize: 12 }}>{card.goal != null ? `of ${card.format(card.goal)} · ${card.period}` : card.period}</span>
          {card.thisWeek !== undefined && <span style={{ ...numStyle, fontSize: 12, color: SA.soft }}>This week: {card.format(card.thisWeek)}</span>}
        </button>
        {card.goal != null && (
          <Ring size={46} stroke={12} label={`${card.name} to goal`} center={pctLabel}
            parts={[{ label: 'Reached', count: Math.round(Math.min(p || 0, 1) * 1000), color: progressColor(p) }, { label: 'Left', count: Math.round((1 - Math.min(p || 0, 1)) * 1000), color: SA.track }]} />
        )}
      </div>
      <Sparkline points={card.weeks} format={card.format} />
      <span style={{ ...numStyle, fontSize: 11, color: card.wow == null ? SA.faint : card.wow >= 0 ? SA.good : SA.bad }}
        title="Change vs last week">{card.wow == null ? `${card.wowLabel || 'vs last week'} —` : `${card.wow >= 0 ? '▲' : '▼'} ${card.format(Math.abs(card.wow))} ${card.wowLabel || 'vs last week'}`}</span>
      {openTasks > 0 && (
        <button type="button" onClick={onOpenTasks} aria-label={`${openTasks} open task${openTasks === 1 ? '' : 's'} for ${card.name} - open in Tasks`}
          style={{ all: 'unset', ...saSans, cursor: 'pointer', fontSize: 12, color: SA.link, minHeight: 24 }}>✓ {openTasks} open task{openTasks === 1 ? '' : 's'} →</button>
      )}
      {card.goal == null && (canEdit ? <SetGoal label={card.name} onSave={card.saveGoal} /> : <span style={{ ...subStyle, fontSize: 12 }}>No goal set</span>)}
      {card.note}
    </section>
  );
}

// owner: 'team' or a member's user id. commitments: this week's, already
// person-filtered. reloadKey changes when a goal was saved elsewhere.
// scorecard / scorecardError: Goals' own current-month scorecard, so the hero
// doesn't load that month twice; left undefined (Overview), the hero loads it.
// openTasks: { metric key: open linked to-dos } (Goals, current week only).
export default function GoalHero({ businessId, weekStart, owner, commitments, missingHeadcount, canEdit, reloadKey, onDrill, onGoalSaved, scorecard, scorecardError, openTasks, onOpenTasks }) {
  const [open, setOpen] = useState(readOpen);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const weeks = Array.from({ length: WEEKS }, (_, i) => addDays(weekStart, (i - WEEKS + 1) * 7));
  const month = monthOf(weekStart);
  const shared = scorecard !== undefined;

  const load = useCallback(async () => {
    try {
      setData(await goalsApi.hero(businessId, weekStart, owner === 'team' ? null : owner, shared)); setError(null);
    } catch (e) { setError(e); }
  }, [businessId, weekStart, owner, shared]);
  useEffect(() => { load(); }, [load, reloadKey]);
  // Goals' scorecard can still be the previous week's or person's for a moment.
  const sharedReady = scorecard && scorecard.month === month && (scorecard.owner_user_id ?? 'team') === owner;
  const sc = !data ? null : !shared ? data.scorecard : sharedReady ? scorecard : null;
  const failure = error || (shared ? scorecardError : null);

  const toggle = () => { setOpen(o => !o); writeOpen(!open); };
  const saveGoal = (period, periodStart, key) => async goal => {
    await goalsApi.saveTarget(businessId, { period, period_start: periodStart, metric_key: key, goal });
    await load();
    onGoalSaved();
  };

  let cards = [];
  if (sc) {
    const weekRow = w => [...data.earlier, ...sc.weeks].find(x => x.week_start === w);
    const series = key => weeks.map(w => ({ week: w, value: weekRow(w)?.metrics[key]?.value ?? null, goal: weekRow(w)?.metrics[key]?.goal ?? null }));
    const wow = pts => (pts[WEEKS - 1].value != null && pts[WEEKS - 2].value != null ? pts[WEEKS - 1].value - pts[WEEKS - 2].value : null);
    const rrGoal = new Map(data.targets.filter(t => t.metric_key === 'real_replies_clicks').map(t => [t.period_start, t.goal == null ? null : Number(t.goal)]));
    const engagement = weeks.map(w => { const e = data.engagement.find(x => x.week_start === w); return { week: w, value: e ? e.real_clicks + e.replies : null, goal: rrGoal.get(w) ?? null }; });
    const commitment = commitments.find(c => c.metric_key === 'outbound_audience' && c.target_value != null);
    const weekCard = (id, name, key, extra) => {
      const pts = series(key);
      return { id, metric: key, name, value: pts[WEEKS - 1].value, goal: pts[WEEKS - 1].goal, weeks: pts, wow: wow(pts), format: fmt, period: shortWeek(weekStart).replace('Wk', 'week'), saveGoal: saveGoal('week', weekStart, key), ...extra };
    };
    const aud = series('outbound_audience');
    cards = [
      { id: 'audience', metric: 'outbound_audience', name: 'Audience reached', value: sc.month_total.outbound_audience.value, goal: sc.month_total.outbound_audience.goal,
        // Big number = the month; the trend and change are weekly, so they say so.
        weeks: aud, wow: wow(aud), wowLabel: 'weekly vs last week', thisWeek: aud[WEEKS - 1].value, format: short, period: monthName(month), drillLabel: 'Companies', saveGoal: saveGoal('month', month, 'outbound_audience'),
        note: (commitment || missingHeadcount > 0) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
            {commitment && <span style={subStyle}>of {short(Number(commitment.target_value))} commitment</span>}
            {missingHeadcount > 0 && <button type="button" onClick={() => onDrill('missing')} style={{ all: 'unset', ...saSans, cursor: 'pointer', color: SA.warn, textDecoration: 'underline', textUnderlineOffset: 2 }}>{missingHeadcount} missing headcount → fill</button>}
          </div>
        ) },
      weekCard('in_sequence', 'People in sequence', 'total_in_sequence', { teamOnly: owner !== 'team', drillLabel: 'Overview' }),
      weekCard('partners', 'Partners first-touched', 'partners_first_touched', { drillLabel: 'Partners (Sent)' }),
      weekCard('meetings', 'Meetings set', 'meetings_set', { teamOnly: owner !== 'team', drillLabel: 'the scorecard row' }),
      { id: 'engagement', metric: 'real_replies_clicks', name: 'Real replies + clicks', value: engagement[WEEKS - 1].value, goal: engagement[WEEKS - 1].goal, weeks: engagement, wow: wow(engagement),
        format: fmt, period: shortWeek(weekStart).replace('Wk', 'week'), teamOnly: owner !== 'team', drillLabel: 'the Daily Huddle', saveGoal: saveGoal('week', weekStart, 'real_replies_clicks') },
    ];
  }

  return (
    <div className="no-print" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={labelStyle}>Goals</span>
        {!open && sc && (
          <span style={{ ...numStyle, fontSize: 13, color: SA.soft, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {cards.map(c => <span key={c.id}>{c.name.split(' ')[0]} <b style={{ color: SA.text }}>{c.format(c.value)}</b>{c.goal != null ? ` / ${c.format(c.goal)}` : ''}</span>)}
          </span>
        )}
        <button type="button" aria-expanded={open} onClick={toggle} style={{ all: 'unset', ...saSans, cursor: 'pointer', marginLeft: 'auto', fontSize: 13, color: SA.link, minHeight: 28 }}>
          {open ? 'Collapse ▴' : 'Expand ▾'}
        </button>
      </div>
      {open && (failure ? (failure.needsMigration ? <NeedsMigration what="The goal cards" /> : <ErrorNote message={failure.message} />)
        : !sc ? <span style={{ ...subStyle, fontSize: 13 }}>Loading goals…</span>
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 136px), 1fr))', gap: 12 }}>
            {cards.map(c => <Card key={c.id} card={c} canEdit={canEdit} onDrill={() => onDrill(c.id)} openTasks={openTasks?.[c.metric]} onOpenTasks={() => onOpenTasks(c.metric)} />)}
          </div>
        ))}
    </div>
  );
}

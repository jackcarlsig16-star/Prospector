import { useState } from 'react';
import { SA } from '../theme';
import Ring from '../charts/Ring';
import {
  cardStyle, labelStyle, h2Style, subStyle, numStyle, SourceBadge, NeedsMigration, ErrorNote, EditableNumber,
  fmt, short, pct, progressColor, shortWeek, monthName,
} from './goalsUi';

const ROWS = [
  { key: 'outbound_audience', name: 'Outbound audience', hint: 'employees at companies sequenced', format: short },
  { key: 'total_in_sequence', name: 'Total in sequence', hint: 'people in active sequences', format: fmt },
  { key: 'sequences_running', name: 'Sequences running', hint: 'active sequences', format: fmt },
  { key: 'meetings_set', name: 'Meetings set', hint: 'typed in until calendar sync', format: fmt, manual: true },
  { key: 'open_rate', name: 'Open rate', hint: 'opens ÷ delivered', format: pct, rate: true },
  // sales-partners-pipeline-v1 - counted from the partner buttons' history.
  { key: 'partners_first_touched', name: 'Partners first-touched', hint: '"1st email sent" clicks', format: fmt, source: 'App', group: 'Partners' },
  { key: 'tier1_touched_pct', name: 'Tier 1 touched', hint: 'Tier 1 partners with any touch', format: pct, rate: true, source: 'App' },
  { key: 'partner_meetings', name: 'Partner meetings', hint: '"Meeting booked" clicks', format: fmt, source: 'App' },
  { key: 'partners_pilot_live', name: 'Partners in pilot / live', hint: 'at week end', format: fmt, source: 'App' },
];
// These narrow to one person (partners by owner); the rest are team-wide numbers.
const PER_PERSON = ['outbound_audience', 'open_rate', 'partners_first_touched', 'tier1_touched_pct', 'partner_meetings', 'partners_pilot_live'];

function Bar({ p }) {
  return (
    <div style={{ width: 96, height: 4, borderRadius: 999, background: SA.track }}>
      <div style={{ height: 4, borderRadius: 999, width: `${p == null ? 0 : Math.min(100, Math.round(p * 100))}%`, background: progressColor(p) }} />
    </div>
  );
}

const linkBtn = { all: 'unset', cursor: 'pointer', fontSize: 11, color: SA.warn, textDecoration: 'underline', textUnderlineOffset: 2 };

// missingHeadcount: companies (all weeks) with no employee count - the reason
// outbound audience reads low; onFillHeadcount opens that list.
export default function ScorecardTable({ data, error, weekStart, ownerName, canEdit, onSaveTarget, missingHeadcount, onFillHeadcount }) {
  const [saveError, setSaveError] = useState('');
  const month = data?.month;
  const save = async body => {
    setSaveError('');
    try { await onSaveTarget(body); } catch (e) { setSaveError(e.message); throw e; }
  };
  const th = { ...labelStyle, textAlign: 'right', padding: '0 12px 10px', whiteSpace: 'nowrap' };
  const td = { padding: '14px 12px', borderTop: `1px solid ${SA.track}`, textAlign: 'right', verticalAlign: 'top' };

  return (
    <section style={cardStyle} aria-labelledby="h-score">
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle}>{ownerName ? `Scorecard · ${ownerName} (audience, open rate, partners) · rest team-wide` : 'Scorecard · team totals'}</span>
          <h2 style={h2Style} id="h-score">{month ? `${monthName(month)} targets, week by week` : 'Targets, week by week'}</h2>
          <span style={subStyle}>Actuals fill in from Apollo on every sync and from the partner buttons. You only type the goals.</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <SourceBadge source="Apollo" /><span style={{ ...subStyle, fontSize: 12 }}>auto</span>
          <SourceBadge source="Manual" /><span style={{ ...subStyle, fontSize: 12 }}>typed</span>
          <SourceBadge source="App" /><span style={{ ...subStyle, fontSize: 12 }}>buttons</span>
        </div>
      </div>
      {error?.needsMigration ? <div style={{ marginTop: 16 }}><NeedsMigration what="The scorecard" /></div>
        : error ? <div style={{ marginTop: 16 }}><ErrorNote message={error.message} /></div>
        : !data ? <div style={{ ...subStyle, marginTop: 16 }}>Loading…</div>
        : (
        <div style={{ overflowX: 'auto', marginTop: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead><tr>
              <th scope="col" style={{ ...th, textAlign: 'left', paddingLeft: 0 }}>Metric</th>
              {data.weeks.map(w => <th key={w.week_start} scope="col" style={{ ...th, color: w.week_start === weekStart ? SA.text : SA.muted }}>{shortWeek(w.week_start)}</th>)}
              <th scope="col" style={th}>Month</th>
            </tr></thead>
            <tbody>
              {ROWS.map(r => {
                const m = data.month_total[r.key];
                const mp = m.value != null && m.goal ? m.value / m.goal : null;
                const dimmed = ownerName && !PER_PERSON.includes(r.key);
                return [
                  r.group && (
                    <tr key={`${r.key}-group`}><th scope="rowgroup" colSpan={data.weeks.length + 2} style={{ ...labelStyle, textAlign: 'left', padding: '20px 0 6px', borderTop: `1px solid ${SA.track}` }}>{r.group}</th></tr>
                  ),
                  <tr key={r.key} id={`score-row-${r.key}`} style={{ opacity: dimmed ? 0.75 : 1 }}>
                    <td style={{ ...td, textAlign: 'left', paddingLeft: 0, minWidth: 190 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontWeight: 500 }}>{r.name}</span>
                        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <SourceBadge source={r.source || (r.manual ? 'Manual' : 'Apollo')} />
                          <span style={{ ...subStyle, fontSize: 12 }}>{dimmed ? 'team-wide' : r.hint}</span>
                        </span>
                        {r.key === 'outbound_audience' && missingHeadcount > 0 && (
                          <button type="button" onClick={onFillHeadcount} style={{ ...linkBtn, fontSize: 12 }}>
                            {missingHeadcount} compan{missingHeadcount === 1 ? 'y' : 'ies'} missing headcount → fill
                          </button>
                        )}
                      </div>
                    </td>
                    {data.weeks.map(w => {
                      const c = w.metrics[r.key];
                      const p = c.value != null && c.goal ? c.value / c.goal : null;
                      const sel = w.week_start === weekStart;
                      return (
                        <td key={w.week_start} style={{ ...td, background: sel ? 'color-mix(in srgb, var(--sa-accent) 6%, transparent)' : undefined }}>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                            <span style={{ ...numStyle, fontSize: 16, fontWeight: 600 }}>
                              {r.manual && canEdit
                                ? <EditableNumber value={c.value} placeholder="enter" display={r.format(c.value)} ariaLabel={`${r.name} actual, ${shortWeek(w.week_start)}`}
                                    onSave={v => save({ period: 'week', period_start: w.week_start, metric_key: r.key, actual: v })} />
                                : r.format(c.value)}
                            </span>
                            <span style={{ ...numStyle, ...subStyle, fontSize: 12 }}>
                              {canEdit
                                ? <EditableNumber value={c.goal} rate={r.rate} placeholder="set goal" display={`of ${r.format(c.goal)}`} ariaLabel={`${r.name} goal, ${shortWeek(w.week_start)}`}
                                    onSave={v => save({ period: 'week', period_start: w.week_start, metric_key: r.key, goal: v })} />
                                : c.goal != null ? `of ${r.format(c.goal)}` : ''}
                            </span>
                            {r.key === 'outbound_audience' && c.companies > c.companies_with_employees && (
                              <button type="button" onClick={onFillHeadcount} style={linkBtn}>{c.companies - c.companies_with_employees} of {c.companies} need headcount</button>
                            )}
                            <Bar p={p} />
                            <span style={{ ...numStyle, fontSize: 12, color: progressColor(p) }}>{p == null ? '' : `${Math.round(p * 100)}%`}</span>
                          </div>
                        </td>
                      );
                    })}
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                          <span style={{ ...numStyle, fontWeight: 600 }}>{r.format(m.value)}</span>
                          <span style={{ ...numStyle, ...subStyle, fontSize: 12 }}>
                            {canEdit
                              ? <EditableNumber value={m.goal} rate={r.rate} placeholder="set goal" display={`of ${r.format(m.goal)}`} ariaLabel={`${r.name} goal, ${monthName(month)}`}
                                  onSave={v => save({ period: 'month', period_start: month, metric_key: r.key, goal: v })} />
                              : m.goal != null ? `of ${r.format(m.goal)}` : ''}
                          </span>
                        </div>
                        <Ring size={52} stroke={14} label={`${r.name} month to goal`} center={mp == null ? '—' : `${Math.round(mp * 100)}%`}
                          parts={[{ label: 'Reached', count: Math.round(Math.min(mp || 0, 1) * 1000), color: progressColor(mp) }, { label: 'Left', count: Math.round((1 - Math.min(mp || 0, 1)) * 1000), color: SA.track }]} />
                      </div>
                    </td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
      {saveError && <div style={{ marginTop: 12 }}>{saveError.includes('database update') ? <NeedsMigration what="Saving this number" /> : <ErrorNote message={saveError} />}</div>}
    </section>
  );
}

import { useState } from 'react';
import { SA } from '../theme';
import { sourceColor, SOURCE_ORDER } from '../palette';
import { cardStyle, labelStyle, numStyle, fmt, h3Style, DrillNumber, Btn } from './goalsUi';
import Segmented from '../../../ui/Segmented';

// brad-attribution-v1 F4 a-c - Dashboard > Sources' funnel: one table, three groupings (rep · partner, partner, source
// kind), columns Referred · Visited · Replied · Meeting · Pilot · Lost. Columns are cumulative (a company counts at every
// stage it reached). Each count opens the list of those companies with the stage date and the intent band; a ▲n says
// how many entered that stage today (their stage date = today, LA). The selected row draws a five-bar funnel in ONE
// hue - the row's main lead source from the validated SOURCE_ORDER palette - with "n of m" labels (a percentage only
// from m >= 10); the table row is its data view.
export const FUNNEL_STAGES = [['referred', 'Referred'], ['visited', 'Visited'], ['replied', 'Replied'], ['meeting', 'Meeting'], ['pilot', 'Pilot'], ['lost', 'Lost']];
const RATE_OF = { visited: 'visited_of_referred', replied: 'replied_of_visited', meeting: 'meeting_of_replied', pilot: 'pilot_of_meeting' };
const GROUPINGS = [{ id: 'rep', label: 'By rep', field: 'by_rep', empty: 'No partner rep named yet.' }, { id: 'partner', label: 'By partner', field: 'by_partner', empty: 'No company is sourced to a partner yet.' }, { id: 'source', label: 'By source', field: 'by_source_kind', empty: 'No companies in this range.' }];
const TYPE_LABEL = { partner: 'Partner', employer: 'Employer', target: 'Target' };
const md = d => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—');
const cell = { padding: '8px 10px', borderTop: `1px solid ${SA.track}`, fontSize: 13, color: SA.text, ...numStyle, textAlign: 'right', whiteSpace: 'nowrap' };
const head = { ...labelStyle, textAlign: 'right', padding: '8px 10px', whiteSpace: 'nowrap' };

export const rateText = r => (!r || !r.m ? '' : `${r.pct != null ? `${r.pct}% · ` : ''}${fmt(r.n)} of ${fmt(r.m)}`);
export const membersOf = (companies, groupBy, key) => companies.filter(c => c.keys?.[groupBy] === key);
export const enteredToday = (companies, stage, today) => companies.filter(c => c[stage] === today).length;
// The row's hue: the lead source most of its companies carry (intent-score's source label), else its kind.
export function rowHue(companies, groupBy, key) {
  const n = new Map();
  for (const c of companies) { const k = c.score_source || (SOURCE_ORDER.includes(c.source_kind) ? c.source_kind : 'other'); n.set(k, (n.get(k) || 0) + 1); }
  const top = [...n].sort((a, b) => b[1] - a[1])[0];
  return sourceColor(top ? top[0] : groupBy === 'source' && SOURCE_ORDER.includes(key) ? key : 'other');
}

function Count({ g, stage, label, members, today, onOpen }) {
  const n = g[stage];
  const up = n ? enteredToday(members, stage, today) : 0;
  if (!n) return <span style={{ color: SA.muted }}>—</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
      <DrillNumber onClick={() => onOpen(g, stage)} title={`List the ${fmt(n)} ${label.toLowerCase()} for ${g.label}`}><span data-funnel-count={stage}>{fmt(n)}</span></DrillNumber>
      {up > 0 && <span data-since-yesterday={stage} title={`${up} entered ${label} today`} style={{ fontSize: 11, color: SA.good }}>▲{up}</span>}
    </span>
  );
}

export function FunnelBars({ g, hue }) {
  const max = Math.max(1, ...FUNNEL_STAGES.slice(0, 5).map(([s]) => g[s] || 0));
  return (
    <figure data-funnel-chart={g.key} aria-label={`${g.label} funnel`} style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <figcaption style={{ fontSize: 13, fontWeight: 600, color: SA.text }}>{g.label}{g.lost ? <span style={{ fontWeight: 400, color: SA.muted }}> · {fmt(g.lost)} lost</span> : null}</figcaption>
      {FUNNEL_STAGES.slice(0, 5).map(([s, label]) => (
        <div key={s} title={`${label}: ${fmt(g[s] || 0)}${RATE_OF[s] && rateText(g.conversion?.[RATE_OF[s]]) ? ` (${rateText(g.conversion[RATE_OF[s]])} of the stage before)` : ''}`} style={{ display: 'grid', gridTemplateColumns: '72px 1fr', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span style={{ color: SA.muted }}>{label}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span aria-hidden="true" data-funnel-bar={s} style={{ height: 14, borderRadius: '0 4px 4px 0', background: hue, width: `${((g[s] || 0) / max) * 70}%`, minWidth: g[s] ? 2 : 0, flex: 'none' }} />
            <span style={{ ...numStyle, color: SA.text, whiteSpace: 'nowrap' }}>{fmt(g[s] || 0)}{RATE_OF[s] && rateText(g.conversion?.[RATE_OF[s]]) ? <span style={{ color: SA.muted }}> · {rateText(g.conversion[RATE_OF[s]])}</span> : null}</span>
          </span>
        </div>
      ))}
    </figure>
  );
}

// The list behind one count: those companies, the stage date (newest first), the intent band, the journey.
export function FunnelDrawer({ g, stage, groupBy, companies, onClose }) {
  const label = FUNNEL_STAGES.find(([s]) => s === stage)[1];
  const rows = membersOf(companies, groupBy, g.key).filter(c => c[stage]).sort((a, b) => b[stage].localeCompare(a[stage]) || a.name.localeCompare(b.name));
  return (
    <section aria-label={`${g.label} - ${label}`} data-funnel-drawer={stage} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, border: `1px solid ${SA.border}`, borderRadius: 10, background: SA.surface2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ fontSize: 13, color: SA.text, marginRight: 'auto' }}>{g.label} · {label} ({rows.length})</b>
        <Btn onClick={onClose}>Close</Btn>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map(c => (
          <li key={`${c.type}-${c.id}`} data-funnel-company={c.name} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 0', borderTop: `1px solid ${SA.track}`, fontSize: 13 }}>
            <span style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <b style={{ fontWeight: 500, color: SA.text }}>{c.name}</b>
              <span style={{ color: SA.muted }}>{TYPE_LABEL[c.type]} · {label} {md(c[stage])}{c.score_band ? ` · ${c.score_band}${c.score != null ? ` (${c.score})` : ''}` : ''}{c.upside ? ' · Upside' : ''}</span>
            </span>
            <span style={{ fontSize: 12, color: SA.muted, overflowWrap: 'anywhere' }}>{c.journey}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function SourceFunnel({ data, narrow }) {
  const [groupBy, setGroupBy] = useState('rep');
  const [selected, setSelected] = useState(null);
  const [open, setOpen] = useState(null); // { key, stage }
  const grouping = GROUPINGS.find(x => x.id === groupBy);
  const groups = data[grouping.field] || [];
  const sel = groups.find(g => g.key === selected) || groups[0] || null;
  const openG = open && groups.find(g => g.key === open.key);
  const onOpen = (g, stage) => { setSelected(g.key); setOpen({ key: g.key, stage }); };
  const t = data.totals;
  const switchTo = id => { setGroupBy(id); setSelected(null); setOpen(null); };
  return (
    <section aria-label="Funnel" data-source-funnel style={{ ...cardStyle, padding: narrow ? 16 : 20, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ ...h3Style, marginRight: 'auto' }}>Funnel</h2>
        <Segmented label="Group the funnel" items={GROUPINGS.map(x => ({ id: x.id, label: x.label }))} value={groupBy} onChange={switchTo} />
      </div>
      <p data-funnel-totals style={{ margin: 0, fontSize: 13, color: SA.soft, ...numStyle }}>
        {FUNNEL_STAGES.map(([s, label]) => `${label} ${fmt(t[s])}`).join(' · ')} · of {fmt(t.companies)} companies
      </p>
      <span style={{ fontSize: 12, color: SA.muted }}>Cumulative - a company counts at every stage it reached, with the date it got there. Click a number for the companies.</span>
      {!groups.length && <span style={{ fontSize: 13, color: SA.muted }}>{grouping.empty}</span>}
      {groups.length > 0 && (narrow ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {groups.map(g => (
            <li key={g.key} data-funnel-row={g.label} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 0', borderTop: `1px solid ${SA.track}`, fontSize: 13 }}>
              <button type="button" className="ui-link" aria-pressed={sel?.key === g.key} onClick={() => setSelected(g.key)} style={{ textAlign: 'left', fontWeight: 600, overflowWrap: 'anywhere' }}>{g.label}</button>
              <span style={{ display: 'flex', gap: '4px 12px', flexWrap: 'wrap', color: SA.muted, ...numStyle }}>
                {FUNNEL_STAGES.map(([s, label]) => <span key={s}>{label} <Count g={g} stage={s} label={label} members={membersOf(data.companies, groupBy, g.key)} today={data.today} onOpen={onOpen} /></span>)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th scope="col" style={{ ...head, textAlign: 'left' }}>{groupBy === 'rep' ? 'Rep · partner' : groupBy === 'partner' ? 'Partner' : 'Source'}</th>
                {FUNNEL_STAGES.map(([s, label]) => <th key={s} scope="col" style={head}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {groups.map(g => {
                const members = membersOf(data.companies, groupBy, g.key);
                return (
                  <tr key={g.key} data-funnel-row={g.label} style={{ background: sel?.key === g.key ? SA.inset : undefined }}>
                    <td style={{ ...cell, textAlign: 'left', whiteSpace: 'normal' }}>
                      <button type="button" className="ui-link" aria-pressed={sel?.key === g.key} title="Show this row's funnel" onClick={() => setSelected(g.key)} style={{ textAlign: 'left', fontWeight: 500 }}>{g.label}</button>
                    </td>
                    {FUNNEL_STAGES.map(([s, label]) => <td key={s} style={cell}><Count g={g} stage={s} label={label} members={members} today={data.today} onOpen={onOpen} /></td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      {openG && <FunnelDrawer g={openG} stage={open.stage} groupBy={groupBy} companies={data.companies} onClose={() => setOpen(null)} />}
      {sel && <FunnelBars g={sel} hue={rowHue(membersOf(data.companies, groupBy, sel.key), groupBy, sel.key)} />}
    </section>
  );
}

import { SA } from '../theme';
import useMediaQuery from '../../../utils/useMediaQuery';
import { Sparkline } from './PulseTiles';
import { GROUP_COLOR, valueText, changeOf, paceText, sparkLabel } from './scorecardWeekly';
import { cardStyle, labelStyle, numStyle, h3Style, subStyle, ErrorNote } from './goalsUi';

// email-by-member-v1 M3 / M4 - the member rows of GET goals/weekly?member=all, drawn: every digit is the route's (the
// same registry over one member's mailboxes), this file only formats. A member is a first name, a mailbox nobody is
// mapped to is "Unassigned mailbox" - no address reaches the browser. This week is read TO DATE against the same
// point last week; a count carries the route's pace, a rate never does (the route sends none).
export const TABLE_COLS = [['delivered', 'Delivered'], ['human_open_rate', 'Open rate'], ['human_clicks', 'Clicks'], ['replies', 'Replies'], ['meetings_set', 'Meetings']];
const SPARK_KEY = 'delivered';
const DIR_COLOR = { good: SA.good, bad: SA.bad, flat: SA.muted, none: SA.faint };
const small = { fontSize: 11, color: SA.muted, ...numStyle };
const of = (row, key) => row.metrics.find(m => m.key === key);

// The control's items: Team, then the members with a mapped mailbox in the route's order.
export const memberItems = all => [{ id: 'team', label: 'Team' }, ...(all?.members || []).map(m => ({ id: m.id, label: m.name }))];
export const memberRow = (all, id) => all?.rows.find(r => r.id === id) || null;
// The rows under one Scorecard metric: everyone but the team, each with that metric.
export const memberMetricRows = (all, key) => (all?.rows || []).filter(r => r.id !== 'team').map(r => ({ id: r.id, name: r.name, metric: of(r, key) })).filter(r => r.metric);

export function ChangeMark({ m, size = 12 }) {
  const c = changeOf(m);
  if (c.dir === 'none') return null;
  return <span data-change={c.dir} role="img" aria-label={c.dir === 'flat' ? c.word : `${c.word}, ${c.text}`} style={{ ...numStyle, fontSize: size, fontWeight: 600, color: DIR_COLOR[c.dir], whiteSpace: 'nowrap' }}>{c.glyph} {c.text}</span>;
}
export const memberSpark = (name, m, width = 120) => (
  <Sparkline series={m.series.map(s => s.value)} hollowLast dots width={width} height={26} color={GROUP_COLOR[m.group]} label={`${name}: ${sparkLabel(m)}`} />
);

function Cell({ m }) {
  const tw = m.this_week, pace = paceText(m);
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, minWidth: 0 }}>
      <span data-value style={{ ...numStyle, fontSize: 15, fontWeight: 600, color: SA.text }}>{valueText(m, tw.to_date)}</span>
      {tw.delta != null && <span style={{ display: 'inline-flex', gap: 5, alignItems: 'baseline', flexWrap: 'wrap', justifyContent: 'flex-end' }}><ChangeMark m={m} /><span style={small}>vs {valueText(m, tw.same_point_last_week)}</span></span>}
      {pace && <span data-pace style={small}>{pace}</span>}
    </span>
  );
}

// The strip for one member: the member's six registry rows as tiles (this week to date, the 12-week line).
export function MemberStrip({ row }) {
  return (
    <div data-member-strip={row.id} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
      {row.metrics.map(m => {
        const rate = m.unit === 'rate', v = m.this_week.to_date, pace = paceText(m);
        return (
          <div key={m.key} data-member-tile={m.key} style={{ ...cardStyle, borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <span style={labelStyle}>{m.name}</span>
            <span data-value style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1, color: SA.text, ...numStyle }}>
              {v == null ? '—' : rate ? (v * 100).toFixed(1) : valueText(m, v)}{rate && v != null && <small style={{ fontSize: 14, fontWeight: 500, color: SA.muted, letterSpacing: 0, marginLeft: 4 }}>%</small>}
            </span>
            <span style={{ fontSize: 12, lineHeight: 1.3, display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'baseline', minWidth: 0 }}>
              {m.this_week.delta == null ? <span style={small}>no comparison</span> : <><ChangeMark m={m} /><span style={small}>vs {valueText(m, m.this_week.same_point_last_week)} same point last wk</span></>}
            </span>
            {pace && <span data-pace style={{ fontSize: 11.5, color: SA.muted, ...numStyle }}><span style={{ ...labelStyle, fontSize: 9.5, marginRight: 5 }}>pace</span>{pace}</span>}
            {memberSpark(row.name, m, 90)}
            <span style={{ fontSize: 11, color: SA.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }} title={m.hint || ''}>{m.hint}</span>
          </div>
        );
      })}
    </div>
  );
}

const th = { textAlign: 'right', fontWeight: 500, padding: '0 10px 8px', borderBottom: `1px solid ${SA.border}`, whiteSpace: 'nowrap', verticalAlign: 'bottom' };
const td = { padding: '10px', borderBottom: `1px solid ${SA.track}`, textAlign: 'right', verticalAlign: 'top', color: SA.soft };
const nameBtn = { background: 'none', border: 0, padding: 0, font: 'inherit', fontWeight: 500, color: SA.text, cursor: 'pointer', textAlign: 'left' };

// One row per member + Unassigned mailbox (when there is one) + Team. A name that is on the control is a button that
// switches the strip to that member.
export function ByMemberTable({ all, error, selected, onSelect }) {
  const phone = useMediaQuery('(max-width: 760px)');
  const pickable = new Set(memberItems(all).map(i => i.id));
  const name = r => (pickable.has(r.id)
    ? <button type="button" data-pick={r.id} aria-pressed={selected === r.id} title={`Show ${r.id === 'team' ? "the team's" : `${r.name}'s`} numbers above`} onClick={() => onSelect(r.id)} style={nameBtn}>{r.name}</button>
    : <span style={{ fontWeight: 500, color: SA.text }}>{r.name}</span>);
  const picked = id => (selected === id ? { background: `color-mix(in srgb, ${SA.accent} 6%, transparent)` } : {});
  return (
    <section data-by-member aria-labelledby="h-by-member" style={{ ...cardStyle, borderRadius: 14, padding: '18px 20px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2 id="h-by-member" style={h3Style}>By member</h2>
        {all && <span style={{ fontSize: 12, color: SA.muted }}>this week to date vs the same point last week · day {all.elapsed.days} of 7 · {all.weeks.length} weeks of delivered</span>}
      </div>
      {error && <ErrorNote message={error} />}
      {!all && !error && <span style={subStyle}>Loading…</span>}
      {all && phone && all.rows.map(r => (
        <div key={r.id} data-member-row={r.id} style={{ borderTop: `1px solid ${SA.track}`, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8, ...picked(r.id) }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>{name(r)}{memberSpark(r.name, of(r, SPARK_KEY), 110)}</div>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px 12px' }}>
            {TABLE_COLS.map(([key, label]) => (
              <div key={key} data-cell={`${r.id}|${key}`} style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <dt style={{ ...labelStyle, fontSize: 10 }}>{label}</dt>
                <dd style={{ margin: 0, display: 'flex', justifyContent: 'flex-start' }}><Cell m={of(r, key)} /></dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      {all && !phone && (
        <table data-by-member-table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', tableLayout: 'fixed', fontSize: 13 }}>
          <colgroup><col style={{ width: '19%' }} />{TABLE_COLS.map(([key]) => <col key={key} style={{ width: '13.6%' }} />)}<col style={{ width: '13%' }} /></colgroup>
          <thead><tr>
            <th scope="col" style={{ ...th, textAlign: 'left' }}><span style={labelStyle}>Member</span></th>
            {TABLE_COLS.map(([key, label]) => <th key={key} scope="col" style={th}><span style={labelStyle}>{label}</span></th>)}
            <th scope="col" style={th}><span style={labelStyle}>Delivered · {all.weeks.length} wks</span></th>
          </tr></thead>
          <tbody>
            {all.rows.map(r => (
              <tr key={r.id} data-member-row={r.id} style={picked(r.id)}>
                <th scope="row" style={{ ...td, textAlign: 'left', fontWeight: 400 }}>{name(r)}</th>
                {TABLE_COLS.map(([key]) => <td key={key} data-cell={`${r.id}|${key}`} style={td}><Cell m={of(r, key)} /></td>)}
                <td data-cell={`${r.id}|spark`} style={td}>{memberSpark(r.name, of(r, SPARK_KEY))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {all && <div data-member-rule style={{ fontSize: 11.5, color: SA.muted }}>{all.wording.member} {all.wording.pace}</div>}
    </section>
  );
}

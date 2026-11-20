import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { priorityColor } from '../../palette';
import { companyWindowUrl } from '../../salesNav';
import HeatPill from '../../people/HeatPill';
import { SOURCE, VERB_LABEL, dueWords, dayWords, snoozeChoices, dueChoices } from './todayRows';

// actions-v2 Stage 2 - the pieces of the Today list (specs/design/actions-v2/ActionsToday · States · Phone): the five
// strip, a row's cells, the check circle, the ⋯ menu that changes in place, the done line. Every control here calls
// back; nothing in this file writes.
const Svg = ({ d, size = 14, fill = false, sw = 1.5 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
export const CHECK = 'M3.500 8.500l3 3 6-7', SPARK = SOURCE.scout[1], TARGET = 'M2 8a6 6 0 1 0 12 0A6 6 0 0 0 2 8zM6 8a2 2 0 1 0 4 0 2 2 0 0 0-4 0z';
const STAR = 'M8 1.800l1.900 3.900 4.300.600-3.100 3 .700 4.300L8 11.600l-3.800 2 .700-4.300-3.100-3 4.300-.600z';
const DOTS = 'M3.500 8h.010M8 8h.010M12.500 8h.010';
export const Icon = Svg;

export function Strip({ strip, five, open, onToggle }) {
  if (!strip.length) return null;
  return (
    <section className="td-card td-strip" aria-label="This week’s five" data-today-strip>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
          <span className="td-star" style={{ margin: 0 }}><Svg d={TARGET} /></span>
          <b style={{ fontWeight: 600 }}>This week’s five</b>
          <span className="td-note"><span className="td-num">{five.used} of {five.max}</span> · they stay on top and out of the ranking · clears Monday</span>
        </span>
        <button type="button" className="td-btn td-btn--ghost" aria-expanded={open} onClick={onToggle}>{open ? 'Hide' : 'Show'}</button>
      </div>
      {open && (
        <div className="td-slots" style={{ flexWrap: 'wrap' }}>
          {strip.map(s => (
            <div key={s.id} className="td-slot" data-today-slot={s.slot} style={{ minWidth: 150 }}>
              <span className="n">{s.slot}</span>
              <div style={{ minWidth: 0 }}>
                <div className="t">{s.text}</div>
                <div className="s">{s.company || 'no company'} · {s.late_days ? `${s.late_days} d late` : s.due ? dayWords(s.due) : 'no date'}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function CompanyCell({ company }) {
  if (!company) return <span className="td-dash">—</span>;
  if (!company.id) return <span>{company.name}</span>;
  const hue = company.band ? priorityColor(company.band) : null;
  return (
    <>
      <a href={companyWindowUrl({ type: company.type, id: company.id })} style={{ color: 'var(--sa-link)', textDecoration: 'none' }}>{company.name || 'Open the record'}</a>
      {company.pinned && <span className="td-star" title="Pinned company" role="img" aria-label="Pinned company"><Svg d={STAR} size={12} fill /></span>}
      {company.band && <span className="td-pill" style={{ color: hue, borderColor: hue }}>{company.band}<small className="td-num">{company.score}</small></span>}
      {company.visits_7d > 0 && <span className="td-note td-num" style={{ marginLeft: 7 }}>{company.visits_7d} visit{company.visits_7d === 1 ? '' : 's'}</span>}
    </>
  );
}
export const PersonCell = ({ person }) => (person
  ? <>{person.name}{person.heat_band && <span style={{ marginLeft: 7, verticalAlign: 'middle', display: 'inline-flex' }}><HeatPill heat={person.heat} band={person.heat_band} size="sm" /></span>}</>
  : <span className="td-dash">—</span>);
export const OwnerCell = ({ row, lookup }) => (row.owner_user_id
  ? <span className="td-ow"><i style={{ background: lookup(row.owner_user_id).color }} />{row.owner || lookup(row.owner_user_id).first}</span>
  : <span className="td-dash">Unassigned</span>);
export function DueCell({ row, today, canEdit, onSetDate }) {
  const d = dueWords(row, today);
  if (d) return <span className={`td-num${d.tone === 'bad' ? ' td-bad' : ''}`} style={{ fontWeight: d.tone === 'bad' ? 500 : 400, color: d.tone === 'text' ? 'var(--sa-text)' : undefined }}>{d.text}</span>;
  return canEdit && row.kind === 'todo' ? <button type="button" className="td-link" onClick={onSetDate} data-today-setdate>Set date</button> : <span className="td-dash">—</span>;
}
export const FromCell = ({ source }) => { const [label, d] = SOURCE[source] || SOURCE.manual; return <span className="td-og" title={`From: ${label}`} role="img" aria-label={`From: ${label}`}><Svg d={d} /></span>; };
// The verb names what Scout can do on the row. The work panel it opens is Stage 3: until then it is a label, not a button.
export const Verb = ({ verb }) => <span className="td-vb" data-today-verb={verb} title="Scout’s work panel for this row arrives with the next stage"><Svg d={SPARK} size={12} />{VERB_LABEL[verb]}</span>;
export const Check = ({ row, onDone }) => <button type="button" className="td-ck" aria-label={`Done: ${row.text}`} onClick={onDone} data-today-done><Svg d={CHECK} size={12} /></button>;
export const MoreButton = ({ row, open, onClick, buttonRef }) => <button type="button" ref={buttonRef} className="td-mb" aria-haspopup="menu" aria-expanded={open} aria-label={`More for ${row.text}`} onClick={onClick} data-today-more><Svg d={DOTS} size={16} sw={2.2} /></button>;

// The ⋯ menu: Reassign, Snooze and Due change in place (a second list inside the same menu), Open, Drop.
// onPick({ verb, args, say }) - the caller sends it through Scout's plan.
export function RowMenu({ row, anchor, today, members, initial = null, onPick, onClose }) {
  const [sub, setSub] = useState(initial);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect(), h = ref.current?.offsetHeight || 0;
    setPos({ left: Math.max(8, Math.min(r.right - 220, window.innerWidth - 228)), top: r.bottom + 4 + h > window.innerHeight ? Math.max(8, r.top - 4 - h) : r.bottom + 4 });
  }, [anchor, sub]);
  useEffect(() => {
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    const away = e => { if (!ref.current?.contains(e.target) && !anchor.contains(e.target)) onClose(); };
    window.addEventListener('keydown', key, true); window.addEventListener('mousedown', away);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('mousedown', away); };
  }, [anchor, onClose]);
  useEffect(() => { ref.current?.querySelector('button, input')?.focus(); }, [sub]);
  const item = (label, onClick, extra = null, cls = '') => <button type="button" role="menuitem" className={`td-mi ${cls}`} onClick={onClick} key={label}>{label}{extra && <em className="td-num">{extra}</em>}</button>;
  const pickDate = (verb, date) => onPick({ verb, args: { date }, say: { date } });
  const dateList = (verb, choices) => choices.map(([label, date]) => item(label, () => pickDate(verb, date), dayWords(date)));
  const verbOf = { snooze: 'snooze', due: 'task_due' }[sub];
  const root = (
    <>
      {row.kind === 'todo' && item('Reassign', () => setSub('assign'), row.owner || 'Unassigned')}
      {row.kind === 'todo' && item('Snooze', () => setSub('snooze'))}
      {row.kind === 'todo' && item('Due', () => setSub('due'), row.due ? dayWords(row.due) : 'no date')}
      {row.kind === 'reply' && item('Add to-do', () => onPick({ verb: 'reply_todos', args: {}, say: {} }))}
      {row.company?.id && <><div className="td-sepr" /><a role="menuitem" className="td-mi" href={companyWindowUrl({ type: row.company.type, id: row.company.id })} style={{ textDecoration: 'none' }}>Open <em>{row.company.name}</em></a></>}
      {row.kind === 'todo' && <><div className="td-sepr" />{item('Drop', () => onPick({ verb: 'task_drop', args: {}, say: {} }), null, 'td-mi--bad')}</>}
    </>
  );
  const body = sub === 'assign'
    ? [...members.map(m => [m.name.split(/\s+/)[0], m.id]), ['Unassigned', null]].map(([name, id]) => item(name, () => onPick({ verb: 'assign', args: { owner_user_id: id }, say: { ownerName: id ? name : null } }), (row.owner_user_id || null) === id ? 'now' : null))
    : sub === 'snooze' ? dateList('snooze', snoozeChoices(today)) : sub === 'due' ? dateList('task_due', dueChoices(today)) : root;
  const title = { assign: 'Reassign', snooze: 'Snooze', due: 'Due' }[sub];
  // position: fixed, so the card's overflow never clips it; it stays inside the list (and its landmark).
  return (
    <div ref={ref} className="td-menu" data-today-menu={sub || 'root'} style={pos || { left: -9999, top: 0 }}>
      {title && <span className="td-lbl td-mh" aria-hidden="true">{title}</span>}
      <div role="menu" aria-label={`${title || 'Actions'} for ${row.text}`} style={{ display: 'flex', flexDirection: 'column' }}>{body}</div>
      {verbOf && <>
        <label className="td-lbl td-mh" htmlFor={`td-date-${row.id}`}>Pick a date</label>
        <input id={`td-date-${row.id}`} type="date" className="td-date" min={sub === 'snooze' ? today : undefined} onChange={e => e.target.value && pickDate(verbOf, e.target.value)} />
      </>}
    </div>
  );
}

export function Toast({ state, onUndo, onClose }) {
  if (!state || state.kind === 'card') return null;
  const text = state.kind === 'busy' ? 'Working…' : state.kind === 'note' ? state.text : state.line;
  return (
    <div className="td-toast" role="status" data-today-toast={state.kind}>
      <span>{text}</span>
      {state.kind === 'done' && !state.undone && state.left > 0 && <button type="button" className="u" onClick={onUndo} data-today-undo>Undo <span className="td-num">{state.left} s</span></button>}
      {state.kind !== 'busy' && <button type="button" className="u" aria-label="Dismiss" onClick={onClose}>×</button>}
    </div>
  );
}

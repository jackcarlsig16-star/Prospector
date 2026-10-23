import { useState } from 'react';
import Button from '../../../ui/Button';
import { dueChoices } from './actionsModel';

// actions-v2 REV2 A3/A4 - the same three slots on every Actions row, in the same place: [Primary] [Done / Due] [More ▾],
// fixed widths so they line up down the table (an empty slot keeps its space). slots = { primary, second, more } where
// primary / a button second = { label, title, run }, second = { due: { value, onPick } } for the date button, and
// more = [{ id, label, run }]. Phone: Primary + More ▾ (the second slot's action folds into More).
export const SLOT_W = { primary: 96, second: 88, more: 72 };
const rowSelect = { height: 24, fontSize: 12, borderRadius: 6, padding: '0 4px' };
const Gap = ({ w }) => <span aria-hidden="true" style={{ width: w, flex: 'none' }} />;

export function MoreMenu({ items, label, width = SLOT_W.more }) {
  if (!items.length) return <Gap w={width} />;
  return (
    <select className="ui-filter__select" aria-label={label} value="" title="More" onChange={e => items.find(i => i.id === e.target.value)?.run()} style={{ ...rowSelect, width, flex: 'none' }}>
      <option value="">More ▾</option>
      {items.map(i => <option key={i.id} value={i.id}>{i.label}</option>)}
    </select>
  );
}

// A date button: the quick choices, or pick any date in place.
export function DueMenu({ value, today, label, onPick, width = SLOT_W.second }) {
  const [picking, setPicking] = useState(false);
  if (picking) {
    return <input type="date" autoFocus aria-label={label} defaultValue={value || today} className="ui-input"
      onBlur={() => setPicking(false)} onKeyDown={e => { if (e.key === 'Escape') setPicking(false); if (e.key === 'Enter' && e.currentTarget.value) { setPicking(false); onPick(e.currentTarget.value); } }}
      onChange={e => { if (e.target.value) { setPicking(false); onPick(e.target.value); } }}
      style={{ ...rowSelect, width, flex: 'none', colorScheme: 'dark' }} />;
  }
  return (
    <select className="ui-filter__select" aria-label={label} value="" title="Change the due date" onChange={e => {
      const v = e.target.value;
      if (v === 'pick') return setPicking(true);
      const c = dueChoices(today).find(x => x[0] === v);
      if (c && c[2] !== value) onPick(c[2]);
    }} style={{ ...rowSelect, width, flex: 'none' }}>
      <option value="">Due ▾</option>
      {dueChoices(today).map(([id, lb]) => <option key={id} value={id}>{lb}</option>)}
      <option value="pick">Pick a date…</option>
    </select>
  );
}

export function Slots({ it, slots, today, phone }) {
  const name = it.text;
  const { primary, second, more } = slots;
  if (phone) {
    const folded = second?.due
      ? [...dueChoices(today).map(([id, lb, d]) => ({ id: `due:${id}`, label: `Due: ${lb}`, run: () => second.due.onPick(d) }))]
      : second ? [{ id: 'second', label: second.label, run: second.run }] : [];
    return (
      <span role="group" aria-label={`Actions for ${name}`} data-slots style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        {primary ? <Button size="sm" title={primary.title} onClick={primary.run}>{primary.label}</Button> : null}
        <MoreMenu items={[...folded, ...more]} label={`More for ${name}`} width={96} />
      </span>
    );
  }
  return (
    <span role="group" aria-label={`Actions for ${name}`} data-slots style={{ display: 'inline-flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap' }}>
      {primary ? <Button size="sm" title={primary.title} onClick={primary.run} style={{ width: SLOT_W.primary, flex: 'none', justifyContent: 'center' }}>{primary.label}</Button> : <Gap w={SLOT_W.primary} />}
      {second?.due ? <DueMenu value={second.due.value} today={today} label={`Due date for ${name}`} onPick={second.due.onPick} />
        : second ? <Button size="sm" title={second.title} onClick={second.run} style={{ width: SLOT_W.second, flex: 'none', justifyContent: 'center' }}>{second.label}</Button>
          : <Gap w={SLOT_W.second} />}
      <MoreMenu items={more} label={`More for ${name}`} />
    </span>
  );
}

// A4 - the owner cell as a select (Members). options: [{ value, label }]; value '' = nobody.
export function OwnerSelect({ value, options, label, onPick }) {
  return (
    <select className="ui-filter__select" aria-label={label} value={value || ''} title="Owner" onChange={e => { if (e.target.value !== (value || '')) onPick(e.target.value || null); }} style={{ ...rowSelect, width: '100%' }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

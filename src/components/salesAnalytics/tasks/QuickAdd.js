import { useState } from 'react';
import { SA, saSans } from '../theme';
import LinkPicker, { chipStyle } from './LinkPicker';

const fieldStyle = { all: 'unset', ...saSans, fontSize: 12, color: SA.soft, cursor: 'pointer' };

// Type and press Enter. Defaults: owner = me, this week, no due date, no
// link; the chips appear once there's text.
export default function QuickAdd({ meId, members, lookup, links, onAdd }) {
  const [text, setText] = useState('');
  const [owner, setOwner] = useState(null); // null = me (meId can arrive after first render)
  const [due, setDue] = useState('');
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState(false);
  const ownerId = owner ?? meId ?? '';

  const submit = async e => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    const ok = await onAdd({ text: text.trim(), owner_user_id: ownerId || null, due_date: due || null, link_type: link?.type ?? null, link_id: link?.id ?? null });
    setBusy(false);
    if (ok) { setText(''); setOwner(null); setDue(''); setLink(null); }
  };

  return (
    <form onSubmit={submit} style={{ padding: '12px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input value={text} onChange={e => setText(e.target.value)} aria-label="New task" placeholder="Add a task, press Enter" disabled={busy}
        style={{ ...saSans, fontSize: 14, height: 40, boxSizing: 'border-box', background: SA.inset, border: `1px solid ${SA.border}`, borderRadius: 10, color: SA.text, padding: '0 12px' }} />
      {text.trim() && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={chipStyle}>
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: lookup(ownerId || null).color }} />
            <select aria-label="Owner of the new task" value={ownerId} onChange={e => setOwner(e.target.value)} style={fieldStyle}>
              <option value="">Unassigned</option>
              {members.map(m => <option key={m.user_id} value={m.user_id}>{m.user_id === meId ? `${lookup(m.user_id).first} (me)` : lookup(m.user_id).first}</option>)}
            </select>
          </label>
          <label style={chipStyle}>
            <span>Due</span>
            <input type="date" aria-label="Due date of the new task" value={due} onChange={e => setDue(e.target.value)} style={{ ...fieldStyle, colorScheme: 'dark' }} />
          </label>
          <LinkPicker link={link} links={links} onChange={(type, id) => setLink(type ? { type, id } : null)} taskText="the new task" />
          <button type="submit" disabled={busy} style={{ ...chipStyle, marginLeft: 'auto', borderColor: SA.accent, color: SA.text }}>{busy ? 'Adding…' : 'Add ↵'}</button>
        </div>
      )}
    </form>
  );
}

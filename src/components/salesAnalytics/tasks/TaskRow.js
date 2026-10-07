import { useState } from 'react';
import { SA, saSans } from '../theme';
import { SEMANTIC } from '../palette';
import LinkPicker, { chipStyle } from './LinkPicker';
import SourceNote from './SourceNote';

export const md = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const linkBtn = { all: 'unset', cursor: 'pointer', color: SA.link, fontSize: 13, minHeight: 28, display: 'inline-flex', alignItems: 'center' };
const fieldStyle = { all: 'unset', ...saSans, fontSize: 12, color: SA.soft, cursor: 'pointer' };

export function Box({ checked, disabled, title, onClick, label }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={checked} aria-label={label} title={title}
      style={{ width: 22, height: 22, flex: 'none', borderRadius: 6, border: `1.5px solid ${checked ? SEMANTIC.healthy : SA.borderStrong}`, background: checked ? SEMANTIC.healthy : 'transparent', cursor: disabled ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
      {checked && <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke={SA.ground} strokeWidth="2.4" aria-hidden="true"><path d="m3 8.5 3.2 3L13 4.5" /></svg>}
    </button>
  );
}

function AddStep({ taskText, onAdd }) {
  const [text, setText] = useState('');
  const submit = async e => {
    e.preventDefault();
    if (!text.trim()) return;
    if (await onAdd(text.trim())) setText('');
  };
  return (
    <form onSubmit={submit}>
      <input value={text} onChange={e => setText(e.target.value)} aria-label={`Add a step to ${taskText}`} placeholder="+ Add a step, press Enter"
        style={{ ...saSans, width: '100%', fontSize: 13, height: 32, boxSizing: 'border-box', background: 'transparent', border: `1px dashed ${SA.border}`, borderRadius: 8, color: SA.text, padding: '0 10px' }} />
    </form>
  );
}

// One to-do or flag. `can` = { edit, remove } where remove is 'delete'
// (FIX-5: creator within 2 min, or Owner/Admin) or 'drop'.
export default function TaskRow({ t, isFlag, isOpen, onToggle, members, lookup, links, today, week, can, act }) {
  const owner = lookup(t.owner_user_id);
  const nDone = t.steps.filter(s => s.done).length;
  const done = t.st === 'done';
  // All steps ticked makes a to-do done by itself; only a step reopens it.
  const doneBySteps = done && t.status !== 'done';
  const overdue = !done && t.due_date && t.due_date < today;
  const link = t.link_type ? { type: t.link_type, id: t.link_id } : null;
  return (
    <li data-task-id={t.id} style={{ borderTop: `1px solid ${SA.track}`, padding: '10px 0' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ paddingTop: 2 }}>
          <Box checked={done} disabled={!can.edit || doneBySteps || (isFlag && done)} label={`Done: ${t.text}`}
            title={doneBySteps ? 'Every step is ticked - untick a step to reopen' : isFlag ? 'Mark contacted and close the flag' : undefined}
            onClick={() => act.setDone(t, !done)} />
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button type="button" onClick={onToggle} aria-expanded={isOpen}
            style={{ all: 'unset', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: done ? SA.muted : SA.text, textDecoration: done ? 'line-through' : 'none', overflowWrap: 'anywhere' }}>
            {isFlag && '🚩 '}{t.text}
          </button>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, color: SA.muted }}>
            {can.edit ? (
              <label style={chipStyle}>
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: owner.color }} />
                <select aria-label={`Owner of ${t.text}`} value={t.owner_user_id || ''} onChange={e => act.reassign(t, e.target.value)} style={fieldStyle}>
                  {!isFlag && <option value="">Unassigned</option>}
                  {members.map(m => <option key={m.user_id} value={m.user_id}>{lookup(m.user_id).first}</option>)}
                </select>
              </label>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: owner.color }} />{owner.first}</span>
            )}
            {t.due_date && !isOpen && <span style={{ color: overdue ? SA.bad : SA.muted }}>due {md(t.due_date)}</span>}
            {t.steps.length > 0 && <span style={{ fontVariantNumeric: 'tabular-nums' }}>{nDone}/{t.steps.length}</span>}
            {link && !isOpen && <span style={{ padding: '2px 8px', borderRadius: 999, border: `1px solid ${SA.border}`, color: SA.soft, overflowWrap: 'anywhere' }}>{links.labelFor(link.type, link.id)}</span>}
          </div>
          {isOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
              {can.edit && !isFlag ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <label style={{ ...chipStyle, borderColor: overdue ? SA.bad : SA.border }}>
                    <span>Due</span>
                    <input type="date" aria-label={`Due date of ${t.text}`} value={t.due_date || ''} onChange={e => act.update(t, { due_date: e.target.value || null })}
                      style={{ ...fieldStyle, colorScheme: 'dark' }} />
                  </label>
                  <LinkPicker link={link} links={links} taskText={t.text}
                    onChange={(type, id) => act.update(t, { link_type: type, link_id: id })} />
                </div>
              ) : (
                <>
                  {t.due_date && <span style={{ fontSize: 12, color: overdue ? SA.bad : SA.muted }}>due {md(t.due_date)}</span>}
                  {link && <span style={{ fontSize: 12, color: SA.soft }}>{links.labelFor(link.type, link.id)}</span>}
                </>
              )}
              {t.steps.length > 0 && (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {t.steps.map(s => (
                    <li key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13 }}>
                      <Box checked={s.done} disabled={!can.edit} label={`Step done: ${s.text}`} onClick={() => act.toggleStep(t, s)} />
                      <span style={{ color: s.done ? SA.muted : SA.text, textDecoration: s.done ? 'line-through' : 'none', paddingTop: 2 }}>{s.text}</span>
                    </li>
                  ))}
                </ul>
              )}
              {can.edit && <AddStep taskText={t.text} onAdd={text => act.addStep(t, text)} />}
              {t.flag_note && <span style={{ fontSize: 13, color: SA.soft }}>From {lookup(t.flagged_by).first}: “{t.flag_note}”</span>}
              {t.contacts.length > 0 && <span style={{ fontSize: 13, color: SA.muted }}>With {t.contacts.join(', ')}</span>}
              {t.source_note_id && <SourceNote noteId={t.source_note_id} category={t.category} canRead={can.edit} load={act.loadNote} />}
              {t.week_start !== week && <span style={{ fontSize: 12, color: SA.warn }}>From the week of {md(t.week_start)}</span>}
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" style={linkBtn} onClick={act.openInGoals}>Open in Goals →</button>
                {can.edit && can.remove === 'delete' && <button type="button" style={{ ...linkBtn, color: SA.bad }} onClick={() => act.remove(t)}>Delete</button>}
                {can.edit && can.remove === 'drop' && <button type="button" style={{ ...linkBtn, color: SA.muted }} onClick={() => act.drop(t)}>{isFlag ? 'Drop flag' : 'Drop'}</button>}
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

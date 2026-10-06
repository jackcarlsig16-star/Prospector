import { useState } from 'react';
import { SA } from '../theme';
import { SEMANTIC } from '../palette';
import Ring, { RingLegend } from '../charts/Ring';
import { cardStyle, labelStyle, h2Style, subStyle, numStyle, rowStyle, inputStyle, Chip, Dot, Btn, AddButton, ErrorNote } from './goalsUi';

// Status computes itself from the steps (REV4): all ticked = done, some =
// in progress, none = not started. A to-do marked done/dropped by hand
// keeps that.
export function todoStatus(t) {
  if (t.status === 'dropped') return 'dropped';
  const done = t.steps.filter(s => s.done).length;
  if (t.status === 'done' || (t.steps.length && done === t.steps.length)) return 'done';
  return done > 0 ? 'prog' : 'not';
}
const STATUS_COLOR = { done: SEMANTIC.healthy, prog: SEMANTIC.warning, not: 'var(--sa-neutral)', dropped: 'var(--sa-neutral)' };

function Check({ step, disabled, onToggle }) {
  return (
    <button type="button" onClick={onToggle} disabled={disabled} aria-pressed={step.done} aria-label={`Done: ${step.text}`}
      style={{ width: 22, height: 22, flex: 'none', borderRadius: 6, border: `1.5px solid ${step.done ? SEMANTIC.healthy : SA.borderStrong}`, background: step.done ? SEMANTIC.healthy : 'transparent', cursor: disabled ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, marginTop: 1 }}>
      {step.done && <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke={SA.ground} strokeWidth="2.4" aria-hidden="true"><path d="m3 8.5 3.2 3L13 4.5" /></svg>}
    </button>
  );
}

function InlineText({ placeholder, onSubmit, onCancel }) {
  const [text, setText] = useState('');
  return (
    <input autoFocus value={text} placeholder={placeholder} aria-label={placeholder}
      onChange={e => setText(e.target.value)}
      onKeyDown={async e => {
        if (e.key === 'Escape') onCancel();
        if (e.key === 'Enter' && text.trim()) { await onSubmit(text.trim()); setText(''); }
      }}
      style={{ ...inputStyle, width: '100%' }} />
  );
}

function AddTodoForm({ members, categories, defaultOwner, onSubmit, onCancel }) {
  const [form, setForm] = useState({ text: '', category: '', owner_user_id: defaultOwner || '', contacts: '' });
  const [busy, setBusy] = useState(false);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const submit = async () => {
    if (!form.text.trim()) return;
    setBusy(true);
    try {
      await onSubmit({
        text: form.text.trim(), category: form.category.trim() || null, owner_user_id: form.owner_user_id || null,
        contacts: form.contacts.split(',').map(c => c.trim()).filter(Boolean),
      });
    } finally { setBusy(false); }
  };
  const onKey = e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); };
  return (
    <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
      <input autoFocus placeholder="To-do (Enter to save)" aria-label="To-do" value={form.text} onChange={set('text')} onKeyDown={onKey} disabled={busy} style={{ ...inputStyle, gridColumn: '1 / -1' }} />
      <input placeholder="Category" aria-label="Category" list="goal-todo-categories" value={form.category} onChange={set('category')} onKeyDown={onKey} disabled={busy} style={inputStyle} />
      <datalist id="goal-todo-categories">{categories.map(c => <option key={c} value={c} />)}</datalist>
      <select aria-label="Owner" value={form.owner_user_id} onChange={set('owner_user_id')} disabled={busy} style={inputStyle}>
        <option value="">Unassigned</option>
        {members.map(m => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
      </select>
      <input placeholder="With (comma-separated)" aria-label="Contacts" value={form.contacts} onChange={set('contacts')} onKeyDown={onKey} disabled={busy} style={inputStyle} />
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn primary onClick={submit} disabled={busy || !form.text.trim()} style={{ height: 40 }}>Add</Btn>
        <Btn onClick={onCancel} style={{ height: 40 }}>Cancel</Btn>
      </div>
    </div>
  );
}

export default function TodoList({ todos, lookup, members, whoLabel, defaultOwner, canEdit, error, onToggleStep, onAddTodo, onAddStep, onCarry, onOpenHuddle }) {
  const [adding, setAdding] = useState(false);
  const [addingStepFor, setAddingStepFor] = useState(null);
  const [carryState, setCarryState] = useState(null);
  const [actionError, setActionError] = useState('');
  const run = async fn => { setActionError(''); try { return await fn(); } catch (e) { setActionError(e.message); return null; } };

  const built = todos.map(t => ({ ...t, st: todoStatus(t) }));
  const live = built.filter(t => t.st !== 'dropped');
  const count = k => live.filter(t => t.st === k).length;
  const parts = [
    { label: 'Done', count: count('done'), color: STATUS_COLOR.done },
    { label: 'In progress', count: count('prog'), color: STATUS_COLOR.prog },
    { label: 'Not started', count: count('not'), color: STATUS_COLOR.not },
  ];
  const groups = [];
  for (const t of built) {
    const name = t.category || 'Uncategorized';
    let g = groups.find(x => x.name === name);
    if (!g) { g = { name, items: [] }; groups.push(g); }
    g.items.push(t);
  }
  const categories = [...new Set(todos.map(t => t.category).filter(Boolean))];

  return (
    <section style={cardStyle} aria-labelledby="h-todo">
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle}>This week · {whoLabel}</span>
          <h2 style={h2Style} id="h-todo">To-dos</h2>
          <span style={subStyle}>{live.length} to-do{live.length === 1 ? '' : 's'} · tick the steps as you go; status updates itself</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <Ring parts={parts} center={`${count('done')}/${live.length}`} label="To-dos" />
          <RingLegend parts={parts} />
          {canEdit && (
            <Btn disabled={carryState === 'busy'} onClick={async () => {
              setCarryState('busy');
              const r = await run(onCarry);
              setCarryState(r ? (r.carried.length ? `Carried ${r.carried.length} over ✓` : 'Nothing left to carry ✓') : null);
            }}>
              {carryState && carryState !== 'busy' ? carryState : 'Carry over unfinished'}
            </Btn>
          )}
        </div>
      </div>
      {error && <div style={{ marginTop: 12 }}><ErrorNote message={error.message} /></div>}
      {!error && !built.length && <p style={{ ...subStyle, margin: '20px 0 0' }}>No to-dos for this week yet — add your first{canEdit ? ', or carry over last week’s unfinished ones' : ''}.</p>}
      {groups.map(g => (
        <div key={g.name} style={{ marginTop: 20 }}>
          <span style={{ ...labelStyle, color: SA.soft }}>{g.name}</span>
          {g.items.map(t => {
            const owner = lookup(t.owner_user_id);
            const nDone = t.steps.filter(s => s.done).length;
            return (
              <div key={t.id} style={{ ...rowStyle, alignItems: 'flex-start', flexWrap: 'wrap', opacity: t.st === 'dropped' ? 0.6 : 1 }}>
                <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 999, flex: 'none', marginTop: 6, background: STATUS_COLOR[t.st] }} />
                <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600 }}>{t.text}</span>
                    <span style={{ ...numStyle, ...subStyle, fontSize: 12 }}>{t.steps.length ? `${nDone} of ${t.steps.length}` : t.st === 'done' ? 'done' : 'no steps'}</span>
                    {t.carried_from_id && <Chip color={SA.warn} style={{ height: 20 }}>Carried from last week</Chip>}
                    {t.st === 'dropped' && <Chip style={{ height: 20 }}>Dropped</Chip>}
                  </div>
                  {t.prospect_contact_id && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 12, color: SA.muted }}>
                      <span>🚩 From {lookup(t.flagged_by).first}{t.flag_note ? ` · “${t.flag_note}”` : ''}</span>
                      {onOpenHuddle && <button type="button" onClick={() => onOpenHuddle(t.prospect_contact_id)} style={{ all: 'unset', cursor: 'pointer', color: SA.link }}>Open in Huddle →</button>}
                    </div>
                  )}
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {t.steps.map(s => (
                      <li key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <Check step={s} disabled={!canEdit} onToggle={() => run(() => onToggleStep(s))} />
                        <span style={{ color: s.done ? SA.muted : SA.text, textDecoration: s.done ? 'line-through' : 'none' }}>{s.text}</span>
                      </li>
                    ))}
                  </ul>
                  {canEdit && (addingStepFor === t.id
                    ? <InlineText placeholder="New step (Enter to save, Esc to cancel)" onCancel={() => setAddingStepFor(null)}
                        onSubmit={text => run(() => onAddStep(t, text))} />
                    : <button type="button" onClick={() => setAddingStepFor(t.id)} style={{ all: 'unset', cursor: 'pointer', color: SA.link, fontSize: 13, minHeight: 24 }}>+ step</button>)}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', flex: '0 1 260px' }}>
                  <Chip><Dot color={owner.color} />{owner.first}</Chip>
                  {t.contacts.map(c => <Chip key={c} color={SA.muted}>w/ {c}</Chip>)}
                </div>
              </div>
            );
          })}
        </div>
      ))}
      {actionError && <div style={{ marginTop: 12 }}><ErrorNote message={actionError} /></div>}
      {canEdit && (adding
        ? <AddTodoForm members={members} categories={categories} defaultOwner={defaultOwner}
            onCancel={() => setAdding(false)}
            onSubmit={async body => { const ok = await run(() => onAddTodo(body)); if (ok !== null) setAdding(false); }} />
        : <AddButton onClick={() => setAdding(true)}>+ Add to-do</AddButton>)}
    </section>
  );
}

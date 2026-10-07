import { useState, useEffect, useRef } from 'react';
import { SA, SA_TYPE, SA_SHAPE, saSans } from './theme';
import { FLAG_STEPS, flagDefaults, defaultAssignee, signalOf } from './huddleView';

// sales-huddle-v2 Stage 3 - hand a prospect to a teammate. Creates a Goals
// to-do (Huddle follow-ups) with this checklist; nothing is sent.
const field = { ...saSans, height: 40, borderRadius: 10, background: SA.inset, border: `1px solid ${SA.border}`, color: SA.text, padding: '0 10px', fontSize: 14, width: '100%', boxSizing: 'border-box' };

export default function FlagDialog({ p, members, myUserId, today, onSubmit, onReassign, onClose }) {
  const [assignee, setAssignee] = useState(() => defaultAssignee(p, members, myUserId)?.user_id || '');
  const defaults = flagDefaults(p);
  const [checked, setChecked] = useState(() => ({ [FLAG_STEPS.email]: defaults.includes(FLAG_STEPS.email), [FLAG_STEPS.linkedin]: defaults.includes(FLAG_STEPS.linkedin) }));
  const [extra, setExtra] = useState('');
  const [note, setNote] = useState(() => signalOf(p, today).context || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(null); // the open flag that blocks a second one
  const dialogRef = useRef(null);
  const who = members.find(m => m.user_id === assignee);
  const first = who ? who.name.split(' ')[0] : 'teammate';
  const steps = [...Object.entries(checked).filter(([, on]) => on).map(([t]) => t), ...(extra.trim() ? [extra.trim()] : [])];

  useEffect(() => {
    dialogRef.current?.querySelector('select, input, button')?.focus();
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async e => {
    e.preventDefault();
    if (!assignee || !steps.length || busy) return;
    setBusy(true); setError('');
    try { await onSubmit({ assignee_user_id: assignee, steps, note: note.trim() || null }); }
    catch (err) {
      if (err.status === 409 && err.data?.existing) setConflict(err.data.existing);
      else setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 4500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <form ref={dialogRef} onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="flag-title"
        style={{ ...saSans, width: 440, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', background: SA.surface, border: `1px solid ${SA.borderStrong}`, borderRadius: SA_SHAPE.radiusCard, padding: 22, display: 'flex', flexDirection: 'column', gap: 14, color: SA.text }}>
        <div>
          <h2 id="flag-title" style={{ ...SA_TYPE.cardTitle, margin: 0, fontSize: 18 }}>🚩 Flag {p.name || 'prospect'}</h2>
          <div style={{ fontSize: 13, color: SA.muted, marginTop: 4 }}>{[p.company, signalOf(p, today).context].filter(Boolean).join(' · ')}</div>
        </div>
        <label style={{ ...SA_TYPE.label, color: SA.muted }} htmlFor="flag-assignee">Hand to</label>
        <select id="flag-assignee" value={assignee} onChange={e => setAssignee(e.target.value)} style={field}>
          {members.map(m => <option key={m.user_id} value={m.user_id}>{m.name}{m.role === 'viewer' ? ' (viewer)' : ''}</option>)}
        </select>
        <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <legend style={{ ...SA_TYPE.label, color: SA.muted, marginBottom: 6 }}>Checklist</legend>
          {Object.values(FLAG_STEPS).map(t => (
            <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer', minHeight: 32 }}>
              <input type="checkbox" checked={!!checked[t]} onChange={e => setChecked(c => ({ ...c, [t]: e.target.checked }))} /> {t}
            </label>
          ))}
          <input aria-label="Another step" placeholder="Another step (optional)" value={extra} onChange={e => setExtra(e.target.value)} style={field} />
        </fieldset>
        <label style={{ ...SA_TYPE.label, color: SA.muted }} htmlFor="flag-note">Note</label>
        <input id="flag-note" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Opened step 2 three times - strike while warm" style={field} />
        <p style={{ fontSize: 12, color: SA.muted, margin: 0 }}>Creates a to-do for {first} in Goals → This week. Nothing is sent automatically.</p>
        {conflict && (
          <div role="alert" style={{ fontSize: 13, color: SA.text, padding: '10px 12px', borderRadius: 10, background: SA.inset, border: `1px solid ${SA.warn}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span>{p.name || 'This prospect'} is already flagged to {conflict.owner_name || 'a teammate'}. One open flag per prospect.</span>
            {conflict.owner_user_id === assignee
              ? <span style={{ color: SA.muted }}>That's who you picked - nothing to change.</span>
              : <button type="button" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await onReassign(conflict.id, assignee); } catch (e2) { setError(e2.message); setBusy(false); } }}
                  style={{ ...field, width: 'auto', alignSelf: 'flex-start', padding: '0 14px', cursor: 'pointer', borderColor: SA.warn }}>Reassign to {first} instead</button>}
          </div>
        )}
        {error && <p role="alert" style={{ fontSize: 13, color: SA.bad, margin: 0 }}>⚠ {error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" onClick={onClose} style={{ ...field, width: 'auto', padding: '0 16px', cursor: 'pointer' }}>Cancel</button>
          <button type="submit" disabled={!assignee || !steps.length || busy}
            style={{ ...field, width: 'auto', padding: '0 16px', cursor: 'pointer', background: SA.accent, color: SA.ground, border: 0, fontWeight: 600, opacity: !assignee || !steps.length || busy ? 0.6 : 1 }}>
            {busy ? 'Flagging…' : `Flag for ${first}`}
          </button>
        </div>
      </form>
    </div>
  );
}

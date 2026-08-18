import { useState } from 'react';
import { mono } from '../../constants/colors';
import { CARD } from './tokens';
import { recordAccountActivity } from '../../utils/db';

const inp = { fontSize: 12, padding: '6px 9px', background: CARD.surface2, border: `1px solid ${CARD.border}`, borderRadius: 5, color: CARD.textPrimary, outline: 'none', width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.55 };
const smallBtn = { ...mono, fontSize: 11, padding: '4px 12px', borderRadius: 5, cursor: 'pointer' };

// account-taxonomy-and-creation-upgrade-v1 Stage 7 — the audit found no
// real add-note UI existed on an account beyond the raw-edit debug
// textarea; the only writer of handoffNotes was an automatic CSV-import
// side effect. This is the real one, reusing Handoff Context's own
// textarea shape/copy (AccountsUploadModal.js) rather than a new input
// style. Uses recordAccountActivity() (a fresh server-side fetch-then-
// append, not the generic bulk-save path) since notes are append-only and
// genuinely concurrency-sensitive - two reps could add a note to the same
// account close together.
export default function AddNoteBox({ acc, userEmail, onUpdate }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!note.trim()) return;
    setSaving(true); setError('');
    const { error: err } = await recordAccountActivity(acc.id, userEmail || null, 'manual_note', note.trim());
    if (err) { setError(err); setSaving(false); return; }
    // Optimistic local refresh so the timeline above shows it immediately -
    // same stamp format recordAccountActivity() writes server-side.
    const stamp = `[manual_note · ${new Date().toLocaleDateString()}] ${note.trim()}`;
    const nextNotes = acc.handoffNotes ? `${acc.handoffNotes}\n\n${stamp}` : stamp;
    onUpdate?.({ ...acc, handoffNotes: nextNotes });
    setNote(''); setOpen(false); setSaving(false);
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ ...mono, fontSize: 10, color: CARD.textMuted, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, marginTop: 4 }}>
        + Add note
      </button>
    );
  }

  return (
    <div style={{ marginTop: 6 }}>
      <textarea
        value={note} onChange={e => setNote(e.target.value)}
        placeholder="What happened? More context helps the next reassay score this better."
        rows={3} autoFocus style={inp}
      />
      {error && <p style={{ ...mono, fontSize: 10, color: '#F06060', margin: '4px 0 0' }}>⚠ {error}</p>}
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button onClick={save} disabled={saving || !note.trim()} style={{ ...smallBtn, background: CARD.textPrimary, border: `1px solid ${CARD.textPrimary}`, color: CARD.bg, fontWeight: 700, opacity: saving || !note.trim() ? 0.5 : 1 }}>
          {saving ? 'Saving…' : 'Save note'}
        </button>
        <button onClick={() => { setOpen(false); setNote(''); setError(''); }} disabled={saving} style={{ ...smallBtn, background: 'transparent', border: `1px solid ${CARD.border}`, color: CARD.textMuted }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

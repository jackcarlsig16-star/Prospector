import { useState } from 'react';
import { SA, SA_SHAPE } from '../theme';
import { linkBtn } from './TaskRow';

// The call a to-do came from. Members open the stored notes; a Viewer only
// sees which call (the API refuses them the text).
export default function SourceNote({ noteId, category, canRead, load }) {
  const [note, setNote] = useState(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const call = (category || '').replace(/^From calls · /, '') || 'a call';
  if (!canRead) return <span style={{ fontSize: 12, color: SA.muted }}>From call: {call}</span>;
  const toggle = () => {
    setOpen(o => !o);
    if (!note) load(noteId).then(n => { setNote(n); setError(''); }).catch(e => setError(e.message));
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button type="button" aria-expanded={open} onClick={toggle} style={{ ...linkBtn, fontSize: 12 }}>
        {open ? '▾' : '▸'} From call: {call} · notes
      </button>
      {open && (error ? <span role="alert" style={{ fontSize: 12, color: SA.bad }}>{error}</span> : (
        <div aria-label={`Call notes: ${call}`} tabIndex={0}
          style={{ maxHeight: 240, overflowY: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12, lineHeight: 1.5, color: SA.soft, background: SA.inset, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner, padding: '8px 10px' }}>
          {note ? note.text : 'Loading…'}
        </div>
      ))}
    </div>
  );
}

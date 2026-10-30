import React, { useState } from 'react';

// grow-ui-refresh-v1 U3 - Log activity (L) on the Brand page: contact made away from Grow, as an outside touch
// (Emailed · Called · Met · DM · LinkedIn, a past date, a note <= 200; the note covers anything else). Undo in the toast.
export const WHATS = [['emailed', 'Emailed'], ['called', 'Called'], ['met', 'Met'], ['dm', 'DM'], ['linkedin', 'LinkedIn']];
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

export default function LogActivity({ brand, onLog, onClose, busy }) {
  const [what, setWhat] = useState('emailed');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  return (
    <form className="hk-logact" aria-label={`Log activity for ${brand.name}`} data-hk-log-activity onSubmit={async e => { e.preventDefault(); await onLog({ what, date, ...(note.trim() ? { note: note.trim() } : {}) }); onClose(); }}>
      <div className="hk-seg" role="group" aria-label="What happened">
        {WHATS.map(([k, label]) => <button key={k} type="button" className="hk-btn hk-seg__btn" aria-pressed={what === k} onClick={() => setWhat(k)} data-hk-log-what={k}>{label}</button>)}
      </div>
      <label className="hk-logact__field">Date <input type="date" className="ui-input" value={date} max={today()} onChange={e => setDate(e.target.value)} /></label>
      <label className="hk-logact__field hk-logact__note">Note <input className="ui-input" value={note} maxLength={200} placeholder="optional · no email addresses or phone numbers" onChange={e => setNote(e.target.value)} /></label>
      <button type="submit" className="hk-btn hk-primary" disabled={!!busy || !date} data-hk-log-save>Log it</button>
      <button type="button" className="hk-btn hk-link" onClick={onClose}>Cancel</button>
    </form>
  );
}

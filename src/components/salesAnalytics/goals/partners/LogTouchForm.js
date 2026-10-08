import { useState } from 'react';
import { SA, saSans } from '../../theme';
import { TOUCH_TYPES, WORKFLOW_STEPS, stepOf, touchStageMove } from '../../../../constants/partnerPipeline';
import { labelStyle, subStyle, inputStyle, Btn, Chip, ErrorNote } from '../goalsUi';
import { stageName } from './activityTimeline';

const localToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const mondayOf = d => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));
const md = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const pill = on => ({ ...saSans, height: 28, padding: '0 10px', borderRadius: 999, fontSize: 12, cursor: 'pointer', border: `1px solid ${on ? SA.accent : SA.border}`, background: on ? 'color-mix(in srgb, var(--sa-accent) 18%, transparent)' : 'transparent', color: on ? SA.text : SA.soft });

// partner-touch-log-v1 design, built here (partner-360-v1 Stage 1): an
// email / call / LinkedIn / meeting that happened on a date, with who it was
// with. The server dates the event that day and moves the stage per
// touchStageMove - never backwards. onSubmit resolves true when it landed.
export default function LogTouchForm({ partner, names, onSubmit, onClose }) {
  const today = localToday();
  const status = partner.pipeline_status || 'not_started';
  const [date, setDate] = useState(today);
  const [type, setType] = useState('email');
  const [who, setWho] = useState([]);
  const [newName, setNewName] = useState('');
  const [note, setNote] = useState('');
  const [move, setMove] = useState('auto');
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const auto = touchStageMove(status, type, 'auto');
  const current = stepOf(status);
  const ahead = WORKFLOW_STEPS.filter((s, i) => current === null || i > current);
  const toggle = n => setWho(w => (w.includes(n) ? w.filter(x => x !== n) : [...w, n]));
  const addName = () => { const n = newName.trim().replace(/\s+/g, ' '); if (n && !who.some(w => w.toLowerCase() === n.toLowerCase())) setWho(w => [...w, n]); setNewName(''); };
  const backdated = date < mondayOf(today);
  const submit = async e => {
    e.preventDefault();
    if (move === 'pick' && !pick) { setError('Pick the stage to move to, or choose Auto'); return; }
    setBusy(true); setError('');
    const contacts = [...who, ...(newName.trim() ? [newName.trim()] : [])];
    const ok = await onSubmit({ type: 'touch', touch_type: type, date, contacts, ...(note.trim() ? { note: note.trim() } : {}), move_to: move === 'pick' ? pick : move, expect: status });
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <form onSubmit={submit} aria-label={`Log a touch on ${partner.name}`} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, borderRadius: 10, background: SA.surface, border: `1px solid ${SA.borderStrong}` }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle}>When</span>
          <input type="date" value={date} max={today} required onChange={e => setDate(e.target.value)} style={{ ...inputStyle, height: 36 }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle}>Type</span>
          <select value={type} onChange={e => setType(e.target.value)} style={{ ...inputStyle, height: 36 }}>
            {TOUCH_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={labelStyle}>Who</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {[...new Set([...names, ...who])].map(n => <button key={n} type="button" aria-pressed={who.includes(n)} onClick={() => toggle(n)} style={pill(who.includes(n))}>{n}</button>)}
          <input aria-label="Add a name" placeholder="Add a name, Enter" value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addName(); } }} style={{ ...inputStyle, height: 28, fontSize: 12, width: 170 }} />
        </div>
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={labelStyle}>Note</span>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="What happened, in a line (optional)" style={{ ...inputStyle, height: 36 }} />
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={labelStyle}>Stage</span>
        <div role="radiogroup" aria-label="Stage after this touch" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" role="radio" aria-checked={move === 'auto'} onClick={() => setMove('auto')} style={pill(move === 'auto')}>Auto · {auto ? `→ ${stageName(auto)}` : 'no change'}</button>
          <button type="button" role="radio" aria-checked={move === 'none'} onClick={() => setMove('none')} style={pill(move === 'none')}>No stage change</button>
          <button type="button" role="radio" aria-checked={move === 'pick'} onClick={() => setMove('pick')} style={pill(move === 'pick')} disabled={!ahead.length}>Pick…</button>
          {move === 'pick' && (
            <select aria-label="Stage to move to" value={pick} onChange={e => setPick(e.target.value)} style={{ ...inputStyle, height: 28, fontSize: 12, width: 'auto' }}>
              <option value="">Choose a stage</option>
              {ahead.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          )}
        </div>
        <span style={{ ...subStyle, fontSize: 12 }}>Never backwards. {backdated ? `Counts in the week of ${md(mondayOf(date))}.` : 'Counts this week.'}</span>
      </div>
      {error && <ErrorNote message={error} />}
      <div style={{ display: 'flex', gap: 6 }}>
        <Btn primary type="submit" style={{ height: 36 }} disabled={busy}>{busy ? 'Logging…' : 'Log touch'}</Btn>
        <Btn style={{ height: 36 }} onClick={onClose}>Cancel</Btn>
        {who.length > 0 && <Chip style={{ height: 28, marginLeft: 'auto' }}>{who.length} {who.length === 1 ? 'person' : 'people'}</Chip>}
      </div>
    </form>
  );
}

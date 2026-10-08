import { useState } from 'react';
import { SA, saSans } from '../../theme';
import { TOUCH_TYPES } from '../../../../constants/partnerPipeline';
import { labelStyle, subStyle, inputStyle, numStyle, Btn, ErrorNote } from '../goalsUi';
import { stageName } from './activityTimeline';

const localToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const md = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const norm = s => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// A pasted line -> one partner: exact name first, then the only partner
// whose name contains it. Anything else is unmatched and reported, and so
// is a partner named twice (one touch per partner per batch).
export function matchPartners(text, partners) {
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const matched = [], unmatched = [], seen = new Set();
  for (const line of lines) {
    const k = norm(line);
    const exact = partners.filter(p => norm(p.name) === k);
    const loose = exact.length ? exact : partners.filter(p => norm(p.name).includes(k) || k.includes(norm(p.name)));
    if (loose.length !== 1) unmatched.push({ line, reason: loose.length ? `matches ${loose.length} partners` : 'no partner with that name' });
    else if (seen.has(loose[0].id)) unmatched.push({ line, reason: 'same partner twice' });
    else { seen.add(loose[0].id); matched.push({ line, partner: loose[0] }); }
  }
  return { matched, unmatched };
}

// partner-touch-log-v1 bulk catch-up (built in partner-360-v1 Stage 1):
// paste names, one touch per partner on one date, preview what each would
// do (dry run on the server), then apply exactly that list.
export default function BulkTouchLog({ partners, onPreview, onApply, onDone, onClose }) {
  const today = localToday();
  const [text, setText] = useState('');
  const [type, setType] = useState('email');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [move, setMove] = useState('auto');
  const [preview, setPreview] = useState(null); // { rows, unmatched, touches }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const touchesFor = matched => matched.map(m => ({ goal_id: m.partner.id, touch_type: type, date, ...(note.trim() ? { note: note.trim() } : {}), move_to: move }));
  const run = async () => {
    setBusy(true); setError('');
    try {
      const { matched, unmatched } = matchPartners(text, partners);
      const touches = touchesFor(matched);
      const rows = touches.length ? (await onPreview(touches)).preview : [];
      setPreview({ rows, unmatched, touches });
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    setBusy(true); setError('');
    try { const r = await onApply(preview.touches); onDone(r.logged); }
    catch (e) { setError(e.message); setBusy(false); }
  };
  const ok = preview ? preview.rows.filter(r => !r.error) : [];
  return (
    <section aria-label="Log touches for several partners" style={{ marginTop: 12, padding: 14, borderRadius: 12, background: SA.inset, border: `1px solid ${SA.borderStrong}`, display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>Log touches</span>
        <span style={{ ...subStyle, fontSize: 12 }}>One partner per line · one touch each, on one date · preview first, nothing is written until Apply</span>
      </div>
      {!preview && <>
        <textarea aria-label="Partner names, one per line" value={text} onChange={e => setText(e.target.value)} rows={6} placeholder={'Justworks\nGallagher\nEquifax'}
          style={{ ...inputStyle, ...saSans, height: 'auto', padding: 10, resize: 'vertical' }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={labelStyle}>Type</span>
            <select value={type} onChange={e => setType(e.target.value)} style={{ ...inputStyle, height: 36 }}>{TOUCH_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={labelStyle}>When</span>
            <input type="date" value={date} max={today} onChange={e => setDate(e.target.value)} style={{ ...inputStyle, height: 36 }} /></label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={labelStyle}>Stage</span>
            <select value={move} onChange={e => setMove(e.target.value)} style={{ ...inputStyle, height: 36 }}><option value="auto">Auto (Sent if not yet contacted; meeting → Meeting)</option><option value="none">No stage change</option></select></label>
        </div>
        <input aria-label="Note for every touch" value={note} onChange={e => setNote(e.target.value)} placeholder="Note on every touch (optional)" style={{ ...inputStyle, height: 36 }} />
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn primary style={{ height: 36 }} onClick={run} disabled={busy || !text.trim()}>{busy ? 'Checking…' : 'Preview'}</Btn>
          <Btn style={{ height: 36 }} onClick={onClose}>Cancel</Btn>
        </div>
      </>}
      {preview && <>
        {preview.rows.length > 0 && (
          <table aria-label="Touches to log" style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr style={{ textAlign: 'left', color: SA.muted, fontSize: 12 }}><th style={{ padding: '4px 8px 4px 0', fontWeight: 500 }}>Partner</th><th style={{ padding: 4, fontWeight: 500 }}>Stage</th><th style={{ padding: 4, fontWeight: 500 }}>Counts in week of</th><th style={{ padding: 4, fontWeight: 500 }}>First touch</th></tr></thead>
            <tbody>
              {preview.rows.map(r => (
                <tr key={r.goal_id} style={{ borderTop: `1px solid ${SA.track}`, color: r.error ? SA.bad : SA.text }}>
                  <td style={{ padding: '6px 8px 6px 0' }}>{r.name || r.goal_id}</td>
                  <td style={{ padding: 6 }}>{r.error ? r.error : r.to_status ? `${stageName(r.from_status)} → ${stageName(r.to_status)}` : `${stageName(r.from_status)} · unchanged`}</td>
                  <td style={{ padding: 6, ...numStyle }}>{r.week_start ? md(r.week_start) : '—'}</td>
                  <td style={{ padding: 6 }}>{r.first_touch ? (r.replaces_first_touch_week ? `✓ (was week of ${md(r.replaces_first_touch_week)})` : '✓ first') : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {preview.unmatched.length > 0 && (
          <div style={{ color: SA.warn }}>Not matched, skipped: {preview.unmatched.map(u => `${u.line} (${u.reason})`).join(' · ')}</div>
        )}
        {!preview.rows.length && <span style={subStyle}>Nothing to log.</span>}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Btn primary style={{ height: 36 }} onClick={apply} disabled={busy || !ok.length || ok.length !== preview.rows.length}>{busy ? 'Logging…' : `Apply ${ok.length}`}</Btn>
          <Btn style={{ height: 36 }} onClick={() => setPreview(null)}>Back</Btn>
          {ok.length !== preview.rows.length && <span style={{ ...subStyle, fontSize: 12 }}>Fix or remove the rows in red first - the batch applies all or nothing.</span>}
        </div>
      </>}
      {error && <ErrorNote message={error} />}
    </section>
  );
}

import { useState } from 'react';
import { SA, saMono } from '../../theme';
import { labelStyle, subStyle, inputStyle, Btn, ErrorNote } from '../goalsUi';
import { PEOPLE_SOURCES } from '../../../../constants/partnerPeople';
import { ACTIVITY_PAST } from './activityTimeline';

const md = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const iconBtn = { ...saMono, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 6, border: `1px solid ${SA.border}`, color: SA.link, textDecoration: 'none', fontSize: 11 };

export function Badge({ source }) {
  return (
    <span style={{ ...saMono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 6, border: `1px solid ${SA.borderStrong}`, color: source === 'apollo' ? SA.accent : SA.soft, whiteSpace: 'nowrap' }}>
      {PEOPLE_SOURCES[source] || source}
    </span>
  );
}

const EMPTY = { name: '', title: '', email: '', linkedin_url: '' };

// partner-360-v1 - everyone we know at this partner: people = mergePeople()
// of the partner_contacts rows, the logged-touch names and the sheet's names
// (src/constants/partnerPeople.js).
export default function PartnerPeople({ people, canEdit, onAdd, onDelete }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const submit = async e => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true); setError('');
    try { await onAdd({ name: form.name, title: form.title || null, email: form.email || null, linkedin_url: form.linkedin_url || null }); setForm(EMPTY); setAdding(false); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const remove = async p => {
    setError('');
    try { await onDelete(p.id); } catch (err) { setError(err.message); }
  };
  return (
    <section aria-label="People" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
        <span style={labelStyle}>People</span>
        <span style={{ ...subStyle, fontSize: 12 }}>{people.length ? `${people.length} known` : 'nobody yet'}</span>
      </div>
      {!people.length && <span style={{ ...subStyle, fontSize: 13 }}>Add the people you've talked to, or log a touch with their names — they show up here.</span>}
      {people.length > 0 && (
        <ul aria-label="People at this partner" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {people.map(p => (
            <li key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
              <span style={{ fontWeight: 600 }}>{p.name}</span>
              {(p.title || p.note) && <span style={{ color: SA.muted, overflowWrap: 'anywhere' }}>{p.title || p.note}</span>}
              <Badge source={p.source} />
              {p.last_activity_at && <span style={{ color: SA.soft, fontSize: 12 }}>{ACTIVITY_PAST[p.last_activity_type] || 'Touched'} {md(p.last_activity_at)}</span>}
              {p.sequence_status && <span style={{ color: SA.soft, fontSize: 12 }} title="Apollo sequence membership - not a sent email">In sequence · {p.sequence_status.replace(/_/g, ' ')}{p.sequence_added_at ? ` since ${md(p.sequence_added_at)}` : ''}{p.sequence_finished_at ? ` · finished ${md(p.sequence_finished_at)}` : ''}</span>}
              <span style={{ display: 'inline-flex', gap: 6, marginLeft: 'auto' }}>
                {p.email && <a href={`mailto:${p.email}`} title={`Email ${p.name}`} aria-label={`Email ${p.name}`} style={iconBtn}>✉</a>}
                {p.linkedin_url && <a href={p.linkedin_url} target="_blank" rel="noreferrer" title="LinkedIn" aria-label={`${p.name} on LinkedIn`} style={iconBtn}>in</a>}
                {canEdit && p.deletable && <button type="button" aria-label={`Remove ${p.name}`} title="Remove" onClick={() => remove(p)} style={{ ...iconBtn, background: 'transparent', color: SA.muted, cursor: 'pointer' }}>×</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canEdit && !adding && <button type="button" onClick={() => setAdding(true)} style={{ all: 'unset', cursor: 'pointer', color: SA.link, fontSize: 13, minHeight: 24, alignSelf: 'flex-start' }}>+ Add person</button>}
      {canEdit && adding && (
        <form onSubmit={submit} aria-label="Add person" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
          <input autoFocus required aria-label="Name" placeholder="Name" value={form.name} onChange={set('name')} style={{ ...inputStyle, height: 36 }} />
          <input aria-label="Title" placeholder="Title (optional)" value={form.title} onChange={set('title')} style={{ ...inputStyle, height: 36 }} />
          <input type="email" aria-label="Email" placeholder="Email (optional)" value={form.email} onChange={set('email')} style={{ ...inputStyle, height: 36 }} />
          <input type="url" aria-label="LinkedIn URL" placeholder="LinkedIn URL (optional)" value={form.linkedin_url} onChange={set('linkedin_url')} style={{ ...inputStyle, height: 36 }} />
          <div style={{ display: 'flex', gap: 6, gridColumn: '1 / -1' }}>
            <Btn primary type="submit" style={{ height: 36 }} disabled={busy || !form.name.trim()}>{busy ? 'Saving…' : 'Add'}</Btn>
            <Btn style={{ height: 36 }} onClick={() => { setAdding(false); setForm(EMPTY); setError(''); }}>Cancel</Btn>
          </div>
        </form>
      )}
      {error && <ErrorNote message={error} />}
    </section>
  );
}

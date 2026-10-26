import { useState, useEffect, useRef } from 'react';
import { SA, SA_SHAPE } from '../theme';
import { goalsApi } from '../goals/goalsApi';
import { labelStyle, inputStyle, Btn, ErrorNote } from '../goals/goalsUi';
import OwnerPicker from '../goals/OwnerPicker';
import Segmented from '../../../ui/Segmented';
import Tag from '../../../ui/Tag';
import { stageName } from '../goals/partners/activityTimeline';
import { md, linkBtn } from './TaskRow';

// lead-upload-v1 S1/S4/S5 - the Lead list side of Intake: where the leads came from, the pasted list, one read,
// a review grouped by company (what each one is, who owns it, its people) and File. Nothing is written until File;
// Cancel and Back write nothing. The server re-checks every row and decides what each company IS.
export const MAX_CHARS = 120000; // same cap as the extract route
export const PICKS = [['apollo', 'Apollo'], ['partner_referral', 'Partner referral'], ['person_referral', 'Person referral'], ['event', 'Event'], ['campaign', 'Campaign'], ['website', 'Website'], ['inbound', 'Inbound'], ['other', 'Other']];
const KINDS = [['employer', 'Employer'], ['partner', 'Partner'], ['target', 'Target']];
const ACTION = { create: 'Create', add_people: 'Add people', skip: 'Skip' };
const TONE = { bad: SA.bad, warn: SA.warn, info: SA.accent };
const small = color => ({ fontSize: 12, color: color || SA.muted, overflowWrap: 'anywhere' });
const selectStyle = { ...inputStyle, height: 28, fontSize: 12, padding: '0 6px', borderRadius: 8, width: 'auto' };

export const statusText = c => (c.status === 'partner' ? `In Pipeline · Partner · ${stageName(c.match.pipeline_status)}`
  : c.status === 'employer' ? `In Pipeline · Employer · ${c.match.stage}`
  : c.status === 'target' ? `Target · ${c.match.status}`
  : c.status === 'apollo_only' ? 'In Apollo, not in pipeline'
  : c.status === 'possible_duplicate' ? 'Possible duplicate' : 'New');

const toRow = c => ({ ...c, owner_user_id: null, research: false });
export const counts = rows => ({
  create: rows.filter(r => r.action === 'create').length,
  people: rows.filter(r => r.action !== 'skip').reduce((n, r) => n + r.people.filter(p => !p.already_in).length, 0),
  skip: rows.filter(r => r.action === 'skip').length,
});
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const filedSummary = out => [`${plural(out.created.length, 'company', 'companies')} created`, `${plural(out.people_added, 'person', 'people')} added`,
  out.already_in ? `${out.already_in} already in` : null, `${out.skipped.length} skipped`,
  out.research?.some(r => !r.ok) ? `research failed for ${out.research.filter(r => !r.ok).map(r => r.name).join(', ')}` : null].filter(Boolean).join(' · ');

function CompanyRow({ c, members, set }) {
  const actions = (c.match ? ['add_people', 'skip'] : ['create', 'skip']).map(id => ({ id, label: ACTION[id] }));
  const creating = c.action === 'create';
  const override = c.chip?.skip && c.action !== 'skip';
  return (
    <li data-lead-company={c.name} style={{ borderTop: `1px solid ${SA.track}`, padding: '10px 0', display: 'flex', flexDirection: 'column', gap: 6, opacity: c.action === 'skip' ? 0.7 : 1 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: SA.text, overflowWrap: 'anywhere' }}>{c.name}</span>
        <span style={small()}>{statusText(c)}{c.employees ? ` · ${c.employees.toLocaleString('en-US')} employees` : ''}</span>
        {c.chip && <Tag color={TONE[c.chip.tone]}>{c.chip.text}</Tag>}
        <span style={{ marginLeft: 'auto' }}><Segmented label={`Action for ${c.name}`} items={actions} value={c.action} onChange={action => set({ action })} /></span>
      </div>
      {c.existing_source && <span style={small()}>Source already set: {c.existing_source} - kept; this upload is added to its history</span>}
      {c.action === 'skip' && c.reason && <span style={small(SA.warn)}>Skipped: {c.reason}</span>}
      {override && <span style={small(SA.warn)}>Filing anyway - the override is kept on the upload</span>}
      {creating && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select aria-label={`Kind of ${c.name}`} value={c.kind} disabled={c.status === 'apollo_only'} onChange={e => set({ kind: e.target.value })} style={selectStyle}>
            {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {c.category && <span style={small()}>{c.category}</span>}
          <OwnerPicker members={members} value={c.owner_user_id} onChange={owner_user_id => set({ owner_user_id })} />
          <label style={{ ...small(SA.soft), display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" aria-label={`Research now for ${c.name}`} checked={c.research} onChange={e => set({ research: e.target.checked })} /> Research now
          </label>
        </div>
      )}
      {c.people.length > 0 && (
        <ul aria-label={`People at ${c.name}`} style={{ listStyle: 'none', margin: 0, padding: '0 0 0 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {c.people.map(p => (
            <li key={p.name} style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 13 }}>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ color: SA.text, fontWeight: 500 }}>{p.name}</span>
                {p.title && <span style={{ color: SA.muted }}>· {p.title}</span>}
                {p.location && <span style={{ color: SA.muted }}>· {p.location}</span>}
                {p.already_in && <Tag color={SA.neutral}>Already in</Tag>}
              </span>
              {p.why && <span style={{ ...small(), fontStyle: 'italic' }}>“{p.why}”</span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function LeadListPanel({ businessId, members, text, setText, onClose, onFiled, switcher, readFile }) {
  const [pick, setPick] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [partners, setPartners] = useState(null);
  const [person, setPerson] = useState('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState(null);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  useEffect(() => {
    if (pick !== 'partner_referral' || partners) return;
    goalsApi.partners(businessId).then(list => setPartners(list.filter(p => !p.archived_at).sort((a, b) => a.name.localeCompare(b.name)))).catch(e => setError(e.message));
  }, [pick, partners, businessId]);

  const source = { pick, partner_id: pick === 'partner_referral' ? partnerId || null : null, person: pick === 'person_referral' ? person.trim() || null : null, note: note.trim() || null };
  const sourceOk = pick && (pick !== 'partner_referral' || partnerId) && (pick !== 'person_referral' || person.trim());
  const reviewing = !!result;
  const n = counts(rows);

  const upload = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    try {
      const t = await readFile(file);
      if (!t.trim()) throw new Error(`${file.name} has no text in it`);
      setText(t);
    } catch (err) { setError(err.message); }
  };
  const read = async () => {
    setBusy('read'); setError('');
    try {
      const r = await goalsApi.extractLeads(businessId, { text, source });
      setResult(r);
      setRows(r.companies.map(toRow));
    } catch (err) { setError(err.message); }
    setBusy('');
  };
  const file = async () => {
    setBusy('file'); setError('');
    try {
      const out = await goalsApi.fileLeads(businessId, {
        text, source,
        companies: rows.map(r => ({
          name: r.name, domain: r.domain, employees: r.employees, kind_guess: r.kind_guess, action: r.action, kind: r.kind, owner_user_id: r.owner_user_id, research: r.research,
          people: r.people.map(p => ({ name: p.name, title: p.title, location: p.location, linkedin_url: p.linkedin_url, why: p.why })),
        })),
      });
      onFiled(`Filed from the lead list: ${filedSummary(out)}`, out);
    } catch (err) { setError(err.message); setBusy(''); }
  };
  const setRow = i => patch => setRows(prev => prev.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  return (
    <section aria-label="Lead list" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {!reviewing && switcher}
          <span style={{ ...labelStyle, color: SA.soft, flex: 1 }}>{reviewing ? 'Review · nothing is saved until File leads' : 'Lead list · paste a list of leads'}</span>
          <button type="button" style={linkBtn} onClick={onClose}>Cancel</button>
        </div>
        {!reviewing && (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select value={pick} onChange={e => setPick(e.target.value)} aria-label="Where did these leads come from?" disabled={!!busy} required
                style={{ ...inputStyle, flex: '0 0 auto', width: 'auto', color: pick ? SA.text : SA.muted }}>
                <option value="">Where did these leads come from?</option>
                {PICKS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              {pick === 'partner_referral' && (
                <select value={partnerId} onChange={e => setPartnerId(e.target.value)} aria-label="Which partner referred these leads?" disabled={!!busy || !partners}
                  style={{ ...inputStyle, flex: '1 1 160px', minWidth: 0 }}>
                  <option value="">{partners ? 'Pick the partner' : 'Loading partners…'}</option>
                  {(partners || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              {pick === 'person_referral' && (
                <input value={person} onChange={e => setPerson(e.target.value)} aria-label="Who referred these leads?" placeholder="Who referred them" maxLength={120} disabled={!!busy}
                  style={{ ...inputStyle, flex: '1 1 160px', minWidth: 0 }} />
              )}
              <input value={note} onChange={e => setNote(e.target.value)} aria-label="Upload note" placeholder="Note, e.g. Apollo recommended, Oct 26 (optional)" maxLength={300} disabled={!!busy}
                style={{ ...inputStyle, flex: '1 1 160px', minWidth: 0 }} />
            </div>
            <textarea value={text} onChange={e => setText(e.target.value)} aria-label="Lead list" disabled={!!busy}
              placeholder="Paste the list - Apollo's recommended leads email, a partner's list of names, an event attendee list. Up to 30 people per upload." rows={12}
              style={{ ...inputStyle, height: 'auto', minHeight: 220, padding: '10px 12px', resize: 'vertical', lineHeight: 1.5, fontSize: 13 }} />
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: SA.muted }}>
              <input ref={fileRef} type="file" accept=".txt,.md,.docx" onChange={upload} hidden aria-label="Upload lead list file" />
              <button type="button" style={{ ...linkBtn, fontSize: 13 }} disabled={!!busy} onClick={() => fileRef.current.click()}>Upload .txt / .docx / .md</button>
              <span style={{ marginLeft: 'auto', color: text.length > MAX_CHARS ? SA.bad : SA.muted, fontVariantNumeric: 'tabular-nums' }}>
                {text.length.toLocaleString('en-US')} / {MAX_CHARS.toLocaleString('en-US')}
              </span>
            </div>
          </>
        )}
        {reviewing && (
          <>
            {result.earlier && (
              <span role="note" style={{ fontSize: 13, color: SA.warn }}>
                This list was filed before on {md(result.earlier.created_at.slice(0, 10))}{result.earlier.counts ? ` (${result.earlier.counts.companies_created} created · ${result.earlier.counts.people_added} people added)` : ''} - anyone already in is marked.
              </span>
            )}
            {!rows.length && <p style={{ fontSize: 14, color: SA.muted, margin: 0 }}>No companies or people found in this list.</p>}
            <ul aria-label="Companies in the list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {rows.map((c, i) => <CompanyRow key={c.key} c={c} members={members} set={setRow(i)} />)}
            </ul>
          </>
        )}
        {error && <ErrorNote message={error} />}
      </div>
      <footer style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '12px 16px', borderTop: `1px solid ${SA.border}`, flexWrap: 'wrap' }}>
        {reviewing ? (
          <>
            <button type="button" style={linkBtn} disabled={!!busy} onClick={() => setResult(null)}>← Back to list</button>
            <span role="status" style={{ fontSize: 13, color: SA.soft, flex: 1, textAlign: 'right' }}>Create {n.create} {n.create === 1 ? 'company' : 'companies'} · add {n.people} {n.people === 1 ? 'person' : 'people'} · skip {n.skip}</span>
            <Btn primary disabled={!!busy || !(n.create + n.people)} onClick={file} style={{ borderRadius: SA_SHAPE.radiusInner }}>{busy === 'file' ? 'Filing…' : 'File leads'}</Btn>
          </>
        ) : (
          <>
            {busy && <span role="status" style={{ fontSize: 13, color: SA.muted }}>Reading the list - about 20 seconds…</span>}
            <Btn primary style={{ marginLeft: 'auto' }} disabled={!text.trim() || text.length > MAX_CHARS || !sourceOk || !!busy} onClick={read}>Read list</Btn>
          </>
        )}
      </footer>
    </section>
  );
}

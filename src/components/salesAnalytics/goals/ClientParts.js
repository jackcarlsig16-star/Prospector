import { useState, useEffect, useRef } from 'react';
import { SA, SA_TYPE } from '../theme';
import { goalsApi } from './goalsApi';
import { inputStyle, ErrorNote, fmt } from './goalsUi';
import { Card } from './CompanyPanelSections';
import { md } from './companyPanelFacts';
import Tag from '../../../ui/Tag';
import FilterSelect from '../../../ui/FilterSelect';
import { SOURCE_KINDS, SOURCE_LABEL } from '../../../constants/leadSources';
import { CLIENT_STATUSES, CLIENT_STATUS_LABEL, APOLLO_STAGE_HINT, CLIENT_FILE_KINDS, CLIENT_FILE_KIND_LABEL, CLIENT_FILE_MIMES, CLIENT_FILE_MAX_BYTES } from '../../../constants/clients';

// homelover-clients-v1 Stage 2 - the client pieces of the company window: the Make client sheet (C3, also Add › Client
// and a partner's "Add a client they referred"), the Client card with Mark signed / Mark launched (C4) and the Files card
// (C6: straight-to-storage upload, 60 s open link, archive with Undo). Undo on every write (10 s toast). No field takes
// an email address or phone number - the server refuses them.
const field = { ...inputStyle, height: 36, fontSize: 13, padding: '0 10px', width: '100%' };
const dim = { fontSize: 13, color: SA.muted };
const text = { ...SA_TYPE.body, fontSize: 13, color: SA.text, overflowWrap: 'anywhere' };
const lbl = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: SA.muted, minWidth: 0 };
const STATUS_COLOR = { verbal_yes: SA.good, agreement_sent: SA.warn, signed: SA.good, launched: SA.good };
const num = v => (v === '' || v == null ? null : Number(v));

// A client date: "Nov 20" this year, "Jan 1, 2027" otherwise (launches are often next year).
export const mdy = d => { if (!d) return '—'; const y = String(d).slice(0, 4); return y === String(new Date().getFullYear()) ? md(d) : `${md(d)}, ${y}`; };
export const livesText = c => (c?.eligible_now == null ? '—' : `${fmt(c.eligible_now)}${c.eligible_added ? ` (+${fmt(c.eligible_added)})` : ''}`);
export const StatusChip = ({ status }) => (status ? <span data-client-status={status}><Tag color={STATUS_COLOR[status]}>{CLIENT_STATUS_LABEL[status]}</Tag></span> : null);

// row: the employer ({ id, name }) or null for Add › Client; record: GET goals/company's record; source: its current
// source; preset: a source to start from (a partner's "Add a client they referred").
export function MakeClientForm({ businessId, row = null, record = null, source = null, preset = null, onDone, onCancel, onToast }) {
  const c = record?.client || {};
  const [d, setD] = useState(() => ({
    organization: '', domain: '', status: c.client_status || 'verbal_yes',
    eligible_now: c.eligible_now ?? record?.covered_lives ?? '', eligible_added: c.eligible_added ?? '', eligible_added_note: c.eligible_added_note || '',
    expected_signing_date: c.expected_signing_date || c.expected_close || '', launch_date: c.launch_date || '',
    source_kind: preset?.source_kind || source?.source_kind || '', source_partner_id: preset?.source_partner_id || source?.source_partner_id || '', source_person: preset?.source_person || source?.source_person || '',
    primary_contact_name: '', primary_contact_title: '', hq_city: '', hq_state: '',
  }));
  const [partners, setPartners] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    goalsApi.partners(businessId).then(p => live && setPartners(p.filter(x => !x.archived_at).sort((a, b) => a.name.localeCompare(b.name)))).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [businessId]);
  const set = k => e => setD(x => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const save = async e => {
    e.preventDefault();
    if (!d.source_kind) { setError('Pick a source - who brought this client in'); return; }
    if (d.source_kind === 'partner_referral' && !d.source_partner_id) { setError('Partner referral needs the partner picked'); return; }
    if (!row && !(d.organization.trim() && d.domain.trim())) { setError('Company name and website are both needed'); return; }
    setBusy(true); setError('');
    const s = { source_kind: d.source_kind, source_partner_id: d.source_kind === 'partner_referral' ? d.source_partner_id : null, source_person: d.source_person.trim() || null };
    const keep = (k, v) => (v === '' || v == null ? {} : { [k]: v });
    const body = {
      ...(row ? { opportunity_id: row.id } : { organization: d.organization.trim(), domain: d.domain.trim() }), status: d.status,
      ...keep('eligible_now', num(d.eligible_now)), ...keep('eligible_added', num(d.eligible_added)), ...keep('eligible_added_note', d.eligible_added_note.trim()),
      ...keep('expected_signing_date', d.expected_signing_date), ...keep('launch_date', d.launch_date),
      ...keep('primary_contact_name', d.primary_contact_name.trim()), ...keep('primary_contact_title', d.primary_contact_title.trim()), ...keep('hq_city', d.hq_city.trim()), ...keep('hq_state', d.hq_state.trim()),
      ...(s.source_kind !== source?.source_kind || s.source_partner_id !== (source?.source_partner_id || null) || s.source_person !== (source?.source_person || null) ? { source: s } : {}),
    };
    try {
      const r = await goalsApi.makeClient(businessId, body);
      const extra = [r.contacts_stopped ? `${r.contacts_stopped} campaign ${r.contacts_stopped === 1 ? 'person' : 'people'} stopped` : null, r.todo_id ? '"Send agreement" added' : null, ...(r.warnings || [])].filter(Boolean);
      onDone(r);
      onToast({ text: `${r.client.name} is a client · ${CLIENT_STATUS_LABEL[r.client.client_status]}${extra.length ? ` · ${extra.join(' · ')}` : ''}`, undo: async () => { await goalsApi.undoClient(businessId, r.event_id); onDone(null); } });
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <form data-make-client onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {row ? <span style={dim}>Make <b style={{ color: SA.text, fontWeight: 500 }}>{row.name}</b> a client. Status sets the pipeline stage; Apollo is never written.</span>
        : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          <label style={lbl}>Company<input autoFocus aria-label="Company" value={d.organization} maxLength={160} onChange={set('organization')} className="ui-input" style={field} /></label>
          <label style={lbl}>Website<input aria-label="Website" placeholder="company.com" value={d.domain} maxLength={120} onChange={set('domain')} className="ui-input" style={field} /></label>
        </div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <FilterSelect label="Status" value={d.status} options={CLIENT_STATUSES.map(s => ({ value: s, label: CLIENT_STATUS_LABEL[s] }))} onChange={set('status')} />
        <span style={{ fontSize: 12, color: SA.muted }}>In Apollo: {APOLLO_STAGE_HINT[d.status]}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <label style={lbl}>Eligible now<input aria-label="Eligible now" inputMode="numeric" value={d.eligible_now} onChange={set('eligible_now')} className="ui-input" style={field} /></label>
        <label style={lbl}>Eligible added<input aria-label="Eligible added" inputMode="numeric" value={d.eligible_added} onChange={set('eligible_added')} className="ui-input" style={field} /></label>
        <label style={{ ...lbl, gridColumn: 'span 2' }}>Added because<input aria-label="Added because" placeholder="e.g. acquisition, expected April 2027" maxLength={200} value={d.eligible_added_note} onChange={set('eligible_added_note')} className="ui-input" style={field} /></label>
        <label style={lbl}>Expected signing<input aria-label="Expected signing" type="date" value={d.expected_signing_date} onChange={set('expected_signing_date')} className="ui-input" style={field} /></label>
        <label style={lbl}>Launch<input aria-label="Launch date" type="date" value={d.launch_date} onChange={set('launch_date')} className="ui-input" style={field} /></label>
      </div>
      <div role="group" aria-label="Who brought it in" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <FilterSelect label="Source" value={d.source_kind} options={[{ value: '', label: 'Pick one' }, ...SOURCE_KINDS.map(k => ({ value: k, label: SOURCE_LABEL[k] }))]} onChange={set('source_kind')} />
        {d.source_kind === 'partner_referral' && <FilterSelect label="Partner" value={d.source_partner_id} disabled={!partners}
          options={[{ value: '', label: partners ? 'Pick the partner' : 'Loading…' }, ...(partners || []).map(p => ({ value: p.id, label: p.name }))]} onChange={set('source_partner_id')} />}
        <input aria-label="Referred by (person)" placeholder="Person, e.g. the rep" maxLength={120} value={d.source_person} onChange={set('source_person')} className="ui-input" style={{ ...field, width: 220 }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <label style={lbl}>Primary contact (optional)<input aria-label="Primary contact" maxLength={120} value={d.primary_contact_name} onChange={set('primary_contact_name')} className="ui-input" style={field} /></label>
        <label style={lbl}>Their title<input aria-label="Primary contact title" maxLength={160} value={d.primary_contact_title} onChange={set('primary_contact_title')} className="ui-input" style={field} /></label>
        <label style={lbl}>HQ city<input aria-label="HQ city" maxLength={80} value={d.hq_city} onChange={set('hq_city')} className="ui-input" style={field} /></label>
        <label style={lbl}>HQ state<input aria-label="HQ state" maxLength={40} value={d.hq_state} onChange={set('hq_state')} className="ui-input" style={field} /></label>
      </div>
      <span style={{ fontSize: 12, color: SA.muted }}>Saving also stops this company's Prospector campaign contacts and adds "Send agreement" for a verbal yes. Names only - no emails or phone numbers.</span>
      {error && <ErrorNote message={error} />}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="ui-btn ui-btn--secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="ui-btn ui-btn--primary" disabled={busy}>{busy ? 'Saving…' : 'Make client'}</button>
      </div>
    </form>
  );
}

// The employer panel's Client card: not a client yet = one "Make client" button (Members); a client = status, lives,
// dates, the Apollo hint and the next mark.
// bare (company-window-v4 B3): inside the Client drawer - the row carries the label and the Make client / Edit link, so
// the body keeps only the facts plus the Mark <next> step.
export function ClientCard({ businessId, row, detail, canEdit, onMake, onChanged, onToast, bare = false }) {
  const c = detail?.record?.client || {};
  const [busy, setBusy] = useState(false);
  if (!c.client_status) {
    return canEdit || bare ? (
      <Card label="Client" testId="client" bare={bare} action={<button type="button" className="ui-btn ui-btn--secondary" style={{ height: 28, fontSize: 12 }} onClick={onMake}>Make client</button>}>
        <span style={dim}>Not a client yet.{canEdit ? ' Make client sets status, eligible lives and who referred it.' : ''}</span>
      </Card>
    ) : null;
  }
  const mark = to => async () => {
    setBusy(true);
    try {
      const r = await goalsApi.markClient(businessId, row.id, to, { expect_status: c.client_status });
      onChanged();
      onToast({ text: `${row.name} marked ${to}`, undo: async () => { await goalsApi.undoClient(businessId, r.event_id); onChanged(); } });
    } catch (e) { onToast({ text: e.message }); } finally { setBusy(false); }
  };
  const next = c.client_status === 'launched' ? null : c.client_status === 'signed' ? 'launched' : 'signed';
  const markNext = next && canEdit ? <button type="button" className="ui-btn ui-btn--secondary" style={{ height: 28, fontSize: 12 }} disabled={busy} onClick={mark(next)}>Mark {next}</button> : null;
  return (
    <Card label="Client" testId="client" bare={bare} action={canEdit ? <span style={{ display: 'inline-flex', gap: 6 }}>
      {markNext}
      <button type="button" className="ui-btn ui-btn--tertiary" style={{ height: 28, fontSize: 12 }} onClick={onMake}>Edit</button>
    </span> : null}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <StatusChip status={c.client_status} />
        {bare && markNext}
        <span style={text}>{livesText(c)} eligible{c.eligible_added_note ? <span style={{ color: SA.muted }}> · +{fmt(c.eligible_added)} {c.eligible_added_note}</span> : null}</span>
      </div>
      <div style={{ ...text, color: SA.soft }}>
        {[c.client_since && `Client since ${mdy(c.client_since)}`, c.expected_signing_date && !c.signed_date && `Signing ${mdy(c.expected_signing_date)}`, c.signed_date && `Signed ${mdy(c.signed_date)}`, c.launch_date && `Launch ${mdy(c.launch_date)}`].filter(Boolean).join(' · ')}
      </div>
      <span style={{ fontSize: 12, color: SA.muted }}>Apollo stage to match by hand: {APOLLO_STAGE_HINT[c.client_status]}</span>
    </Card>
  );
}

const ACCEPT = Object.keys(CLIENT_FILE_MIMES).join(',');
const kb = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// Files (agreements + financials) on an employer: the bytes go straight to the private bucket via a signed upload url.
// bare (company-window-v4 B3): inside the Files drawer - the upload controls sit at the top of the body.
export function FilesCard({ businessId, row, canEdit, version, onToast, bare = false }) {
  const [files, setFiles] = useState(null);
  const [kind, setKind] = useState('agreement');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const input = useRef(null);
  useEffect(() => {
    let live = true;
    goalsApi.clientFiles(businessId, row.id).then(f => live && setFiles(f)).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [businessId, row.id, version, tick]);
  const upload = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!CLIENT_FILE_MIMES[file.type]) { setError(`Only ${Object.values(CLIENT_FILE_MIMES).join(' / ')} files`); return; }
    if (file.size > CLIENT_FILE_MAX_BYTES) { setError('Files must be 20 MB or smaller'); return; }
    setBusy('upload'); setError('');
    try {
      const title = file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 160) || 'File';
      const u = await goalsApi.clientUploadUrl(businessId, row.id, { kind, title, mime: file.type, size_bytes: file.size });
      const put = await fetch(u.upload_url, { method: 'PUT', headers: { 'Content-Type': file.type, 'x-upsert': 'false' }, body: file });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      const f = await goalsApi.recordClientFile(businessId, row.id, { file_id: u.file_id, kind, title });
      setTick(t => t + 1);
      onToast({ text: `${f.title} filed under ${row.name}`, undo: async () => { await goalsApi.archiveClientFile(businessId, f.id); setTick(t => t + 1); } });
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  };
  // The tab opens on the click itself (a window opened after an await is a blocked popup in Safari); it then goes to
  // the 60-second signed url. Its opener is kept: nulling it from this side cuts the link and the tab stays blank
  // (measured in Chromium, Nov 3); it only ever loads our own storage url.
  const open = async f => {
    const tab = window.open('', '_blank');
    try { const { url } = await goalsApi.clientFileUrl(businessId, f.id); if (tab) tab.location.href = url; else window.location.assign(url); }
    catch (e) { tab?.close(); setError(e.message); }
  };
  const archive = async f => {
    setBusy(f.id);
    try {
      await goalsApi.archiveClientFile(businessId, f.id);
      setTick(t => t + 1);
      onToast({ text: `${f.title} archived`, undo: async () => { await goalsApi.restoreClientFile(businessId, f.id); setTick(t => t + 1); } });
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  const controls = canEdit ? <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <select aria-label="File kind" value={kind} onChange={e => setKind(e.target.value)} className="ui-input" style={{ ...field, width: 'auto', height: 28, fontSize: 12 }}>
        {CLIENT_FILE_KINDS.map(k => <option key={k} value={k}>{CLIENT_FILE_KIND_LABEL[k]}</option>)}
      </select>
      <button type="button" className="ui-btn ui-btn--secondary" style={{ height: 28, fontSize: 12 }} disabled={!!busy} onClick={() => input.current?.click()}>{busy === 'upload' ? 'Uploading…' : '+ Upload'}</button>
      <input ref={input} type="file" accept={ACCEPT} aria-label="Upload a file" onChange={upload} style={{ display: 'none' }} />
    </span> : null;
  return (
    <Card label="Files" count={files ? files.length : null} testId="files" bare={bare} action={controls}>
      {bare && controls && <div>{controls}</div>}
      {error && <ErrorNote message={error} />}
      {!files && !error && <span style={dim}>Loading…</span>}
      {files && !files.length && <span style={dim}>No agreements or financials yet. PDF, DOCX, XLSX, PNG or JPG, up to 20 MB.</span>}
      {files?.map(f => (
        <div key={f.id} data-client-file style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, flexWrap: 'wrap' }}>
          <Tag>{CLIENT_FILE_KIND_LABEL[f.kind]}</Tag>
          <button type="button" className="ui-btn ui-btn--tertiary" style={{ height: 24, fontSize: 13, padding: '0 4px' }} onClick={() => open(f)}>{f.title}</button>
          <span style={{ color: SA.muted }}>{f.type_label} · {kb(f.size_bytes)} · {md(f.uploaded_at)}</span>
          <span style={{ flex: 1 }} />
          {canEdit && <button type="button" className="ui-btn ui-btn--tertiary" style={{ height: 24, fontSize: 12 }} disabled={busy === f.id} onClick={() => archive(f)}>Archive</button>}
        </div>
      ))}
    </Card>
  );
}

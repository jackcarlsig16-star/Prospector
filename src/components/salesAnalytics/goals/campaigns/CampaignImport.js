import { useState, useRef } from 'react';
import { SA } from '../../theme';
import Button from '../../../../ui/Button';
import FilterSelect from '../../../../ui/FilterSelect';
import Tag from '../../../../ui/Tag';
import { goalsApi } from '../goalsApi';
import { ErrorNote, numStyle, toBase64 } from '../goalsUi';
import { SEGMENT_LABEL, WARMTH_LABEL, LINK_LABEL } from './campaignModel';

// seif-campaign-v1 B1 - the contact sheet in: pick the file -> the server's
// preview (nothing written) -> tick any Brad / Upside rows to add anyway ->
// Add. Blank segment / warmth cells can take one default. The preview never
// holds an address: a row says "email ✓" or why it's left out.
const SEGMENTS = [{ value: '', label: 'Leave blank' }, ...Object.entries(SEGMENT_LABEL).map(([value, label]) => ({ value, label }))];
const WARMTHS = [{ value: '', label: 'Leave blank' }, ...Object.entries(WARMTH_LABEL).map(([value, label]) => ({ value, label }))];
const SKIPPED = { missing_name: true, missing_email: true, bad_email: true, dup_sheet: true, in_campaign: true };

export default function CampaignImport({ businessId, campaign, members, lookup, onAdded, onClose }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [include, setInclude] = useState([]);
  const [defaults, setDefaults] = useState({ segment: '', warmth: '' });
  const [owner, setOwner] = useState(campaign.sender_user_id || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const body = (f, extra = {}) => ({ file: f, include, owner_user_id: owner || null, defaults: Object.fromEntries(Object.entries(defaults).filter(([, v]) => v)), ...extra });
  const run = async fn => { setError(''); setBusy(true); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const look = (f, patch = {}) => run(async () => setPreview(await goalsApi.importCampaign(businessId, campaign.id, { ...body(f), ...patch, dryRun: true })));
  const pick = f => f && run(async () => {
    const next = { name: f.name, data: await toBase64(f) };
    setFile(next); setInclude([]);
    setPreview(await goalsApi.importCampaign(businessId, campaign.id, { ...body(next), include: [], dryRun: true }));
  });
  const setDefault = (k, v) => { const d = { ...defaults, [k]: v }; setDefaults(d); if (file) look(file, { defaults: Object.fromEntries(Object.entries(d).filter(([, x]) => x)) }); };
  const toggle = n => { const next = include.includes(n) ? include.filter(x => x !== n) : [...include, n]; setInclude(next); look(file, { include: next }); };
  const apply = () => run(async () => { const r = await goalsApi.importCampaign(businessId, campaign.id, { ...body(file), dryRun: false }); onAdded(r.added); });
  const adds = preview?.counts?.add || 0;

  return (
    <section aria-label="Import contacts" data-campaign-import style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, borderRadius: 10, border: `1px solid ${SA.border}`, background: SA.surface }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: SA.text }}>Import contacts</h3>
        <span style={{ fontSize: 12, color: SA.muted }}>.xlsx or .csv with name, title, company, email, segment, warmth</span>
        <span style={{ flex: 1 }} />
        <Button variant="tertiary" onClick={onClose}>Cancel</Button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {/* The browser's own file input has no edge to see (R6); the kit button is the visible, focusable control. */}
        <Button disabled={busy} onClick={() => fileRef.current?.click()}>{file ? `Sheet: ${file.name}` : 'Choose sheet…'}</Button>
        <input ref={fileRef} type="file" accept=".xlsx,.csv" aria-label="Contact sheet" disabled={busy} onChange={e => pick(e.target.files?.[0])} style={{ display: 'none' }} />
        <FilterSelect label="Owner" value={owner} onChange={setOwner} options={[{ value: '', label: 'The sender' }, ...members.map(m => ({ value: m.user_id, label: lookup(m.user_id).first }))]} />
        <FilterSelect label="Blank segment" value={defaults.segment} onChange={v => setDefault('segment', v)} options={SEGMENTS} />
        <FilterSelect label="Blank warmth" value={defaults.warmth} onChange={v => setDefault('warmth', v)} options={WARMTHS} />
      </div>
      {busy && <span style={{ fontSize: 12, color: SA.muted }}>Reading…</span>}
      {error && <ErrorNote message={error} />}
      {preview && (
        <>
          <span style={{ fontSize: 13, color: SA.soft, ...numStyle }}>
            {preview.rows.length} rows (header on row {preview.header_row}) · {adds} to add · {preview.counts.skip} left out
            {preview.counts.brad ? ` · ${preview.counts.brad} Brad's / Upside's` : ''}{preview.counts.in_apollo ? ` · ${preview.counts.in_apollo} already in Apollo` : ''}
          </span>
          <ul data-import-rows style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 320, overflowY: 'auto' }}>
            {preview.rows.map(r => {
              const brad = r.reasons.includes('brad') && !r.reasons.some(x => SKIPPED[x]);
              return (
                <li key={r.row} data-import-row={r.row} style={{ borderTop: `1px solid ${SA.track}`, padding: '6px 0', fontSize: 13, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ ...numStyle, color: SA.muted, width: 32, flex: 'none' }}>{r.row}</span>
                  <span style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ color: r.would === 'add' ? SA.text : SA.muted, fontWeight: 600, overflowWrap: 'anywhere' }}>
                      {r.name || '(no name)'}<span style={{ fontWeight: 400 }}>{[r.title, r.company].filter(Boolean).map(x => ` · ${x}`).join('')}</span>
                    </span>
                    <span style={{ color: SA.soft, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <Tag color={r.would === 'add' ? SA.good : SA.borderStrong}>{r.would === 'add' ? 'Add' : 'Left out'}</Tag>
                      {r.has_email ? 'email ✓' : null}
                      {r.track ? ` · ${r.track}` : ''}
                      {r.labels.length > 0 && ` · ${r.labels.join(' · ')}`}
                      {r.match && ` · ${LINK_LABEL[r.match.type] || r.match.type}: ${r.match.name}`}
                    </span>
                  </span>
                  {brad && (
                    <label style={{ fontSize: 12, color: SA.soft, display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none' }}>
                      <input type="checkbox" checked={include.includes(r.row)} disabled={busy} onChange={() => toggle(r.row)} /> Add anyway
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" disabled={busy || !adds} disabledReason="Nothing in this sheet to add" onClick={apply}>{adds ? `Add ${adds} contact${adds === 1 ? '' : 's'}` : 'Nothing to add'}</Button>
          </div>
        </>
      )}
    </section>
  );
}

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import DataTable from '../../ui/DataTable';
import Button from '../../ui/Button';
import { Sprout } from '../HkMarks';
import { Chip } from '../brands/BrandsScreen';
import { hkGet, hkPost, hkFetch } from '../hkApi';

// hkos-gmail-connect-v1 G8 - Drafts: every touch waiting in Gmail. No Send button exists here; sending happens in Gmail.
// grow-nav-filters-v1 N4: inside Inbox the rail drives it - `filter` (all · email · ig_dm · lint_failed · older) and the
// owner toggle become server filters (owner = whose Gmail the draft sits in) and replace the selects. N13: viewers read.
const KIND = { cold: 'Cold', bump: 'Bump', final: 'Final', reply: 'Reply' };
export const AGING_DAYS = 3;
const RAIL_QUERY = { all: {}, email: { kind: 'email' }, ig_dm: { kind: 'ig_dm' }, lint_failed: { lint: 'failed' }, older: { older_than: String(AGING_DAYS) } };
const fmt = iso => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
export const DISCARD_COPY = "This deletes the draft in Gmail and marks the touch discarded. The brand's next follow-up is unchanged.";

export default function DraftsScreen({ businessId, shell, compact, onOpenBrand, filter = null, owner = 'all', canEdit = true, onChanged }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [f, setF] = useState({ kind: '', sender: '', lint: '', age: '' });
  const [selected, setSelected] = useState(() => new Set());
  const [preview, setPreview] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState('');
  const members = shell?.members || [];
  const who = (id, createdBy) => (createdBy === 'claude' ? 'Claude' : createdBy === 'system' ? 'System' : id === shell?.me?.user_id ? 'You' : members.find(m => m.user_id === id)?.first_name || 'Member');
  const load = useCallback(async () => { setError(''); try { setRows((await hkGet(businessId, '/drafts', filter ? { ...(RAIL_QUERY[filter] || {}), owner: owner || 'all' } : undefined)).drafts); } catch (e) { setError(e.message); setRows([]); } }, [businessId, filter, owner]);
  useEffect(() => { load(); }, [load]);
  const shown = useMemo(() => (rows || []).filter(r => (!f.kind || r.kind === f.kind) && (!f.sender || r.sender_user_id === f.sender) && (!f.lint || (f.lint === 'pass' ? r.lint_passed !== false : r.lint_passed === false)) && (!f.age || r.age_days > AGING_DAYS)), [rows, f]);
  const act = async (label, fn) => { setBusy(label); setError(''); try { await fn(); await load(); onChanged?.(); } catch (e) { setError(e.message); } finally { setBusy(''); } };
  const discard = ids => act('discard', async () => { for (const id of ids) await hkFetch(businessId, `/drafts/${id}`, { method: 'DELETE' }); setSelected(new Set()); setConfirm(null); });
  const relint = id => act('lint', async () => { const r = await hkPost(businessId, `/drafts/${id}/lint`, {}); if (!r.lint_passed) setPreview({ id, problems: r.problems }); });
  const open = async id => { try { const { touch } = await hkGet(businessId, `/drafts/${id}`); setPreview({ id, touch }); } catch (e) { setError(e.message); } };
  const toggle = id => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const columns = useMemo(() => [
    ...(canEdit ? [{ id: 'pick', label: '', width: 36, render: r => <input type="checkbox" aria-label={`Select draft for ${r.brand_name || 'brand'}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /> }] : []),
    { id: 'brand', label: 'Brand', sticky: true, minWidth: 180, sortValue: r => r.brand_name || '', render: r => <button type="button" className="hk-btn hk-table__name" onClick={() => onOpenBrand(r.brand_id)}><span className="hk-table__title">{r.brand_name || 'Brand'}</span></button> },
    { id: 'contact', label: 'Contact', width: 140, render: r => r.contact_name || <span className="hk-meta">{r.channel === 'ig_dm' ? 'Instagram' : 'No contact'}</span> },
    { id: 'kind', label: 'Kind', width: 90, sortValue: r => r.kind, render: r => <Chip tone={r.kind === 'cold' ? 'blue' : 'lilac'}>{KIND[r.kind] || r.kind}{r.channel === 'ig_dm' ? ' DM' : ''}</Chip> },
    { id: 'subject', label: 'Subject', minWidth: 240, render: r => r.subject || <span className="hk-meta">Instagram DM</span> },
    { id: 'by', label: 'Created by', width: 110, render: r => who(r.sender_user_id, r.created_by) },
    { id: 'lint', label: 'Lint', width: 90, render: r => <Chip tone={r.lint_passed === false ? 'block' : 'green'}>{r.lint_passed === false ? 'Fails' : 'Passed'}</Chip> },
    { id: 'age', label: 'Age', width: 110, sortValue: r => r.age_days, render: r => <span className={r.age_days > AGING_DAYS ? 'hk-chip hk-chip--mustard' : 'hk-meta'}>{r.age_days > AGING_DAYS ? `${r.age_days} d, aging` : `${r.age_days} d`}</span> },
    { id: 'sender', label: 'Sender mailbox', width: 120, render: r => members.find(m => m.user_id === r.sender_user_id)?.first_name || '' },
    { id: 'actions', label: '', width: 300, stickyEnd: true, render: r => (
      <span style={{ display: 'inline-flex', gap: 6 }}>
        {r.gmail_draft_url ? <a className="ui-btn ui-btn--primary ui-btn--sm" href={r.gmail_draft_url} target="_blank" rel="noopener noreferrer" data-hk-open-gmail>Open in Gmail</a> : <Button size="sm" variant="primary" disabled disabledReason={r.channel === 'ig_dm' ? 'Instagram DMs are copied, not opened' : r.mine ? 'No Gmail draft id yet' : "In another founder's mailbox"}>Open in Gmail</Button>}
        <Button size="sm" onClick={() => open(r.id)}>Preview</Button>
        {canEdit && <Button size="sm" disabled={busy === 'lint'} onClick={() => relint(r.id)}>Re-lint</Button>}
        {canEdit && <Button size="sm" variant="danger" disabled={!r.mine && shell?.me?.role !== 'owner'} disabledReason="Only the sender or an owner-role member" onClick={() => setConfirm([r.id])}>Discard</Button>}
      </span>) },
  ], [selected, members, busy, shell, onOpenBrand, canEdit]);
  return (
    <div data-hk-drafts>
      {filter ? canEdit && selected.size > 0 && <div className="hk-bulk" role="toolbar" aria-label="Bulk actions"><Button size="sm" variant="danger" onClick={() => setConfirm([...selected])}>Discard selected ({selected.size})</Button></div> : <div className="hk-toolbar">
        <select className="ui-input ui-input--sm hk-filter" aria-label="Kind" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}><option value="">All kinds</option>{Object.entries(KIND).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select className="ui-input ui-input--sm hk-filter" aria-label="Sender" value={f.sender} onChange={e => setF({ ...f, sender: e.target.value })}><option value="">All senders</option>{members.filter(m => m.user_id).map(m => <option key={m.user_id} value={m.user_id}>{m.first_name}</option>)}</select>
        <select className="ui-input ui-input--sm hk-filter" aria-label="Lint" value={f.lint} onChange={e => setF({ ...f, lint: e.target.value })}><option value="">Lint: all</option><option value="pass">Passed</option><option value="fail">Fails</option></select>
        <select className="ui-input ui-input--sm hk-filter" aria-label="Age" value={f.age} onChange={e => setF({ ...f, age: e.target.value })}><option value="">Any age</option><option value="aging">Aging ({AGING_DAYS}+ days)</option></select>
        <span className="hk-spacer" />
        {canEdit && selected.size > 0 && <Button size="sm" variant="danger" onClick={() => setConfirm([...selected])}>Discard selected ({selected.size})</Button>}
      </div>}
      {error && <p className="hk-error" role="alert">{error}</p>}
      {rows === null ? <p className="hk-meta">Loading drafts…</p> : !shown.length ? (
        <div className="hk-empty" data-hk-empty><Sprout size={40} /><p className="hk-empty__title">No drafts waiting.</p><p className="hk-empty__line">New pitches come from Claude (hk batch / hk pitch); follow-ups appear here automatically.</p></div>
      ) : (
        <DataTable label="Drafts" columns={columns} rowKey={r => r.id} compact={compact} groups={[{ id: 'all', header: `${shown.length} draft${shown.length === 1 ? '' : 's'}`, rows: shown }]}
          renderCompact={r => <div className="hk-card-row" data-hk-draft><span className="hk-table__title">{r.brand_name}</span><span className="hk-meta">{KIND[r.kind]} · {r.subject || 'Instagram DM'} · {r.age_days} d</span>{r.gmail_draft_url && <a className="ui-btn ui-btn--primary ui-btn--sm" href={r.gmail_draft_url} target="_blank" rel="noopener noreferrer">Open in Gmail</a>}</div>} />
      )}
      <p className="hk-strip" data-hk-no-send>There is no Send button here. Sending happens in Gmail.</p>
      {preview && (
        <>
          <div className="hk-backdrop" onClick={() => setPreview(null)} aria-hidden="true" />
          <div className="hk-modal" role="dialog" aria-modal="true" aria-label="Draft preview" data-hk-preview>
            {preview.touch ? <><h2 className="hk-modal__title">{preview.touch.subject || 'Instagram DM'}</h2><pre className="hk-pre">{preview.touch.body_text}</pre></> : <><h2 className="hk-modal__title">Lint problems</h2><ul className="hk-problems">{preview.problems.map((p, i) => <li key={i} className={`hk-problem hk-problem--${p.level}`}><strong>{p.rule}</strong> {p.message} <span className="hk-meta">{p.excerpt}</span></li>)}</ul></>}
            <Button variant="tertiary" onClick={() => setPreview(null)}>Close</Button>
          </div>
        </>
      )}
      {confirm && (
        <>
          <div className="hk-backdrop" onClick={() => setConfirm(null)} aria-hidden="true" />
          <div className="hk-modal" role="dialog" aria-modal="true" aria-label="Discard draft" data-hk-discard-confirm>
            <h2 className="hk-modal__title">Discard {confirm.length === 1 ? 'this draft' : `${confirm.length} drafts`}?</h2>
            <p>{DISCARD_COPY}</p>
            <span style={{ display: 'inline-flex', gap: 8 }}><Button variant="danger" disabled={busy === 'discard'} onClick={() => discard(confirm)}>Discard</Button><Button variant="tertiary" onClick={() => setConfirm(null)}>Cancel</Button></span>
          </div>
        </>
      )}
    </div>
  );
}

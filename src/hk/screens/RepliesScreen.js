import React, { useCallback, useEffect, useMemo, useState } from 'react';
import DataTable from '../../ui/DataTable';
import Button from '../../ui/Button';
import { Sprout } from '../HkMarks';
import OwnerChip from '../brands/OwnerChip';
import { Chip } from '../brands/BrandsScreen';
import { hkGet, hkPatch } from '../hkApi';

// hkos-gmail-connect-v1 G8 - Replies: brands that wrote back, with a drawer for one reply. Another founder's reply
// never links into their Gmail; it says whose inbox it is and points at the brand timeline.
export const LABELS = [['interested', 'Interested'], ['pricing', 'Pricing'], ['referral', 'Referral'], ['decline', 'Decline'], ['auto_reply', 'Auto reply'], ['prefers_email', 'Prefers email'], ['new_thread', 'New thread'], ['other', 'Other']];
const TONE = { interested: 'green', pricing: 'block', referral: 'blue', decline: 'grey', auto_reply: 'grey', prefers_email: 'lilac', new_thread: 'mustard', other: 'grey' };
const SNOOZE = [['1', 'Tomorrow'], ['3', 'In 3 days'], ['7', 'In a week']];
const fmt = iso => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

export default function RepliesScreen({ businessId, shell, owner, compact, onOpenBrand }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [f, setF] = useState({ label: '', owner: owner || 'all', handled: 'false', from: '' });
  const [open, setOpen] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [copied, setCopied] = useState(false);
  const members = shell?.members || [];
  const member = id => members.find(m => m.user_id === id);
  const load = useCallback(async () => { setError(''); try { const { replies } = await hkGet(businessId, '/replies', { handled: f.handled === 'all' ? 'all' : f.handled, label: f.label, owner: f.owner, from: f.from ? new Date(f.from).toISOString() : '' }); setRows(replies); } catch (e) { setError(e.message); setRows([]); } }, [businessId, f]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setF(x => ({ ...x, owner: owner || 'all' })); }, [owner]);
  const current = useMemo(() => (rows || []).find(r => r.id === open) || null, [rows, open]);
  const patch = async (id, body) => { setError(''); try { await hkPatch(businessId, `/replies/${id}`, body); await load(); } catch (e) { setError(e.message); } };
  const setStatus = async (brandId, status) => { setError(''); try { await hkPatch(businessId, `/brands/${brandId}`, { status }); await load(); } catch (e) { setError(e.message); } };
  const claim = async brandId => { setError(''); try { await hkPatch(businessId, `/brands/${brandId}`, { claim: true }); await load(); } catch (e) { setError(e.message); } };
  const bulk = async body => { for (const id of selected) await hkPatch(businessId, `/replies/${id}`, body); setSelected(new Set()); await load(); };
  const toggle = id => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const copyCmd = async name => { try { await navigator.clipboard.writeText(`hk reply ${name}`); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setError(`Copy failed. The command is: hk reply ${name}`); } };
  const columns = useMemo(() => [
    { id: 'pick', label: '', width: 36, render: r => <input type="checkbox" aria-label={`Select reply from ${r.brand_name || 'brand'}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /> },
    { id: 'brand', label: 'Brand', sticky: true, minWidth: 170, sortValue: r => r.brand_name || '', render: r => <button type="button" className="hk-btn hk-table__name" onClick={() => setOpen(r.id)} data-hk-reply={r.id}><span className="hk-table__title">{r.brand_name || 'Brand'}</span></button> },
    { id: 'from', label: 'From', width: 180, render: r => <span>{r.from_name || 'Unknown'}{r.from_domain && <span className="hk-meta"> · {r.from_domain}</span>}</span> },
    { id: 'label', label: 'Label', width: 120, sortValue: r => r.label || '', render: r => <Chip tone={TONE[r.label] || 'grey'}>{LABELS.find(([v]) => v === r.label)?.[1] || 'Unlabeled'}</Chip> },
    { id: 'summary', label: 'Summary', minWidth: 260, render: r => <span className="hk-meta">{r.summary}</span> },
    { id: 'received', label: 'Received', width: 140, sortValue: r => r.received_at, render: r => fmt(r.received_at) },
    { id: 'owner', label: 'Owner', width: 150, render: r => <OwnerChip owner={member(r.brand_owner_user_id)} hint={r.brand_owner_hint} /> },
    { id: 'handled', label: 'Handled', width: 100, render: r => <Chip tone={r.handled ? 'green' : 'mustard'}>{r.handled ? 'Handled' : 'Open'}</Chip> },
  ], [selected, members]);
  return (
    <div data-hk-replies>
      <div className="hk-toolbar">
        <select className="ui-input ui-input--sm hk-filter" aria-label="Label" value={f.label} onChange={e => setF({ ...f, label: e.target.value })}><option value="">All labels</option>{LABELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select className="ui-input ui-input--sm hk-filter" aria-label="Owner" value={f.owner} onChange={e => setF({ ...f, owner: e.target.value })}><option value="all">All owners</option><option value="me">Me</option>{members.filter(m => m.user_id && m.user_id !== shell?.me?.user_id).map(m => <option key={m.user_id} value={m.user_id}>{m.first_name}</option>)}</select>
        <select className="ui-input ui-input--sm hk-filter" aria-label="Handled" value={f.handled} onChange={e => setF({ ...f, handled: e.target.value })}><option value="false">Unhandled</option><option value="true">Handled</option><option value="all">All</option></select>
        <input className="ui-input ui-input--sm hk-filter" type="date" aria-label="From date" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} />
        <span className="hk-spacer" />
        {selected.size > 0 && <Button size="sm" onClick={() => bulk({ handled: true })}>Mark handled ({selected.size})</Button>}
      </div>
      {error && <p className="hk-error" role="alert">{error}</p>}
      {rows === null ? <p className="hk-meta">Loading replies…</p> : !rows.length ? (
        <div className="hk-empty" data-hk-empty><Sprout size={40} /><p className="hk-empty__title">No replies waiting.</p><p className="hk-empty__line">Replies land here after each Gmail sync, labeled and summarized.</p></div>
      ) : (
        <DataTable label="Replies" columns={columns} rowKey={r => r.id} compact={compact} groups={[{ id: 'all', header: `${rows.length} repl${rows.length === 1 ? 'y' : 'ies'}`, rows }]}
          renderCompact={r => <button type="button" className="hk-btn hk-card-row" onClick={() => setOpen(r.id)} data-hk-reply={r.id}><span className="hk-table__title">{r.brand_name}</span><span className="hk-meta">{r.from_name} · {fmt(r.received_at)}</span><span className="hk-card-row__chips"><Chip tone={TONE[r.label] || 'grey'}>{LABELS.find(([v]) => v === r.label)?.[1] || 'Unlabeled'}</Chip></span></button>} />
      )}
      {current && (
        <>
          <div className="hk-backdrop" onClick={() => setOpen(null)} aria-hidden="true" />
          <aside className="hk-drawer" role="dialog" aria-modal="true" aria-label={`Reply from ${current.brand_name || 'brand'}`} data-hk-reply-drawer>
            <header className="hk-drawer__head">
              <div><div className="hk-drawer__title">{current.brand_name}</div><div className="hk-meta">{current.from_name || 'Unknown'}{current.from_domain ? ` · ${current.from_domain}` : ''} · {fmt(current.received_at)}</div></div>
              <button type="button" className="hk-btn hk-link" onClick={() => setOpen(null)}>Close</button>
            </header>
            <p className="hk-drawer__summary">{current.summary || 'No summary yet.'}</p>
            {current.label === 'pricing' && <p className="hk-banner hk-banner--block" style={{ margin: '8px 0' }}><span className="hk-banner__title">Do not quote pricing in the reply.</span></p>}
            <div className="hk-drawer__row">
              {current.open_url ? <a className="ui-btn ui-btn--primary" href={current.open_url} target="_blank" rel="noopener noreferrer" data-hk-open-reply>Open in Gmail</a> : <span className="hk-meta" data-hk-other-inbox>In {member(current.sender_user_id)?.first_name || 'a teammate'}'s inbox · <button type="button" className="hk-btn hk-link" onClick={() => onOpenBrand(current.brand_id)}>brand timeline</button></span>}
              <Button onClick={() => copyCmd(current.brand_name)} data-hk-copy-reply>{copied ? 'Copied' : 'Copy Claude command'}</Button>
            </div>
            <div className="hk-form" style={{ marginTop: 12 }}>
              <label className="hk-meta">Label<select className="ui-input ui-input--sm" aria-label="Reply label" value={current.label || 'other'} onChange={e => patch(current.id, { label: e.target.value })}>{LABELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <label className="hk-meta">Set status<select className="ui-input ui-input--sm" aria-label="Set brand status" defaultValue="" onChange={e => { if (e.target.value) setStatus(current.brand_id, e.target.value); e.target.value = ''; }}><option value="">…</option><option value="meeting">Meeting</option><option value="signed">Signed</option><option value="passed">Passed</option></select></label>
              <label className="hk-meta">Snooze<select className="ui-input ui-input--sm" aria-label="Snooze" defaultValue="" onChange={e => { if (e.target.value) patch(current.id, { snoozed_until: new Date(Date.now() + Number(e.target.value) * 86400e3).toISOString() }); e.target.value = ''; }}><option value="">…</option>{SNOOZE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
                {!current.brand_owner_user_id && <Button size="sm" onClick={() => claim(current.brand_id)}>Assign to me</Button>}
                <Button size="sm" variant={current.handled ? 'secondary' : 'primary'} onClick={() => patch(current.id, { handled: !current.handled })} data-hk-mark-handled>{current.handled ? 'Reopen' : 'Mark handled'}</Button>
              </span>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

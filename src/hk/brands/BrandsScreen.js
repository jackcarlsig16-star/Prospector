import React, { useCallback, useEffect, useMemo, useState } from 'react';
import DataTable from '../../ui/DataTable';
import Tabs from '../../ui/Tabs';
import Button from '../../ui/Button';
import { Avatar, Sprout } from '../HkMarks';
import AddBrandModal from './AddBrandModal';
import { STATUS_LABELS, RELATIONSHIP_LABELS, STATUS_TONE, RELATIONSHIP_TONE, SOURCE_LABELS } from './verdict';
import { hkGet, hkPatch } from '../hkApi';

// hkos-data-foundation-v1 D6 - Brands: saved views, search (name / domain / alias, never a contact email), the table
// (kit DataTable on the hk tokens), bulk Claim / Release / Set status / Mark do-not-contact, [+ Add brand].
export const VIEWS = [['my_open', 'My open'], ['unclaimed', 'Unclaimed candidates'], ['overdue', 'Overdue'], ['local', 'Local Chicago'], ['all', 'All']];
const MANUAL = [['meeting', 'Meeting'], ['signed', 'Signed'], ['passed', 'Passed'], ['skipped', 'Skipped']];
const fmt = iso => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
export const Chip = ({ tone, children }) => <span className={`hk-chip hk-chip--${tone || 'grey'}`}>{children}</span>;

export default function BrandsScreen({ businessId, shell, owner, compact, onOpenBrand, canEdit }) {
  const [view, setView] = useState('all');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState('');
  const members = shell?.members || [];
  const member = id => members.find(m => m.user_id === id);

  const load = useCallback(async () => {
    setError('');
    try { const { brands } = await hkGet(businessId, '/brands', { view, q: q.trim(), owner }); setRows(brands); }
    catch (e) { setError(e.message); setRows([]); }
  }, [businessId, view, q, owner]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => { setSelected(new Set()); }, [view, q, owner]);

  const toggle = id => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const bulk = async (label, body) => {
    setBusy(label);
    try { for (const id of selected) await hkPatch(businessId, `/brands/${id}`, body); setSelected(new Set()); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };
  const markDnc = () => { const reason = window.prompt('Why should these brands never be contacted?'); if (reason && reason.trim()) bulk('dnc', { relationship: 'do_not_contact', dnc_reason: reason.trim() }); };

  const columns = useMemo(() => [
    ...(canEdit ? [{ id: 'pick', label: '', width: 36, render: r => <input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /> }] : []),
    { id: 'name', label: 'Name', sticky: true, minWidth: 220, sortValue: r => r.name, render: r => (
      <button type="button" className="hk-btn hk-table__name" onClick={() => onOpenBrand(r.id)} data-hk-brand={r.id}>
        <span className="hk-table__title">{r.name}</span>
        {r.domain && <span className="hk-meta">{r.domain}</span>}
      </button>) },
    { id: 'category', label: 'Category', width: 130, sortValue: r => r.category || '', render: r => r.category || <span className="hk-meta">·</span> },
    { id: 'local', label: 'Local / National', width: 130, sortValue: r => (r.is_local ? 0 : 1), render: r => <Chip tone={r.is_local ? 'green' : 'grey'}>{r.is_local ? 'Local Chicago' : 'National'}</Chip> },
    { id: 'owner', label: 'Owner', width: 90, sortValue: r => member(r.owner_user_id)?.first_name || '', render: r => { const m = member(r.owner_user_id); return m ? <span className="hk-owner"><Avatar name={m.first_name} index={m.palette_index} size={24} />{m.first_name}</span> : <span className="hk-meta">Unclaimed</span>; } },
    { id: 'status', label: 'Status', width: 120, sortValue: r => r.status, render: r => <Chip tone={STATUS_TONE[r.status]}>{STATUS_LABELS[r.status] || r.status}</Chip> },
    { id: 'relationship', label: 'Relationship', width: 140, sortValue: r => r.relationship, render: r => <Chip tone={RELATIONSHIP_TONE[r.relationship]}>{RELATIONSHIP_LABELS[r.relationship] || r.relationship}</Chip> },
    { id: 'last_touch', label: 'Last touch', width: 100, sortValue: r => r.last_touch_at || '', render: r => fmt(r.last_touch_at) || <span className="hk-meta">None</span> },
    { id: 'next_due', label: 'Next due', width: 100, sortValue: r => r.next_due_at || '', render: r => fmt(r.next_due_at) || <span className="hk-meta">·</span> },
    { id: 'contact', label: 'Primary contact', width: 150, sortValue: r => r.primary_contact_name || '', render: r => r.primary_contact_name || <span className="hk-meta">·</span> },
    { id: 'source', label: 'Source', width: 120, sortValue: r => r.source, render: r => SOURCE_LABELS[r.source] || r.source },
    { id: 'created', label: 'Created', width: 100, sortValue: r => r.created_at, render: r => fmt(r.created_at) },
  ], [canEdit, selected, members, onOpenBrand]);

  return (
    <div className="hk-brands" data-hk-brands>
      <div className="hk-toolbar">
        <Tabs label="Saved views" items={VIEWS.map(([id, label]) => ({ id, label }))} value={view} onChange={setView} />
        <span className="hk-spacer" />
        <input className="ui-input hk-search-input" type="search" placeholder="Search name, domain or alias" aria-label="Search brands" value={q} onChange={e => setQ(e.target.value)} />
        {canEdit && <Button variant="primary" onClick={() => setAdding(true)} data-hk-add>+ Add brand</Button>}
      </div>
      {canEdit && selected.size > 0 && (
        <div className="hk-bulk" role="toolbar" aria-label="Bulk actions">
          <span>{selected.size} selected</span>
          <Button size="sm" disabled={!!busy} onClick={() => bulk('claim', { claim: true })}>Claim</Button>
          <Button size="sm" disabled={!!busy} onClick={() => bulk('release', { claim: false })}>Release</Button>
          <label className="hk-meta">Set status
            <select className="ui-input ui-input--sm" aria-label="Set status" disabled={!!busy} defaultValue="" onChange={e => { if (e.target.value) bulk('status', { status: e.target.value }); e.target.value = ''; }}>
              <option value="">…</option>{MANUAL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <Button size="sm" variant="danger" disabled={!!busy} onClick={markDnc}>Mark do-not-contact</Button>
        </div>
      )}
      {error && <p className="hk-error" role="alert">{error}</p>}
      {rows === null ? <p className="hk-meta">Loading brands…</p> : rows.length === 0 ? (
        <div className="hk-empty" data-hk-empty>
          <Sprout size={40} />
          <p className="hk-empty__title">{q ? 'No brand matches.' : view === 'all' ? 'No brands yet.' : 'Nothing in this view.'}</p>
          <p className="hk-empty__line">{q ? 'Try the domain or an alias.' : 'Add a brand, or wait for the Sheet import.'}</p>
        </div>
      ) : (
        <DataTable label="Brands" columns={columns} rowKey={r => r.id} compact={compact} groups={[{ id: 'all', header: `${rows.length} brand${rows.length === 1 ? '' : 's'}`, rows }]}
          renderCompact={r => (
            <button type="button" className="hk-btn hk-card-row" onClick={() => onOpenBrand(r.id)} data-hk-brand={r.id}>
              <span className="hk-table__title">{r.name}</span>
              <span className="hk-card-row__chips"><Chip tone={STATUS_TONE[r.status]}>{STATUS_LABELS[r.status]}</Chip><Chip tone={r.is_local ? 'green' : 'grey'}>{r.is_local ? 'Local' : 'National'}</Chip></span>
            </button>)} />
      )}
      {adding && <AddBrandModal businessId={businessId} members={members} onClose={() => setAdding(false)} onOpenMatch={id => { setAdding(false); onOpenBrand(id); }} onSaved={b => { setAdding(false); onOpenBrand(b.id); }} />}
    </div>
  );
}

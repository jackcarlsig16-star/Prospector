import React, { useCallback, useEffect, useMemo, useState } from 'react';
import DataTable from '../../ui/DataTable';
import Tabs from '../../ui/Tabs';
import Button from '../../ui/Button';
import { Sprout } from '../HkMarks';
import AddBrandModal from './AddBrandModal';
import BrandPicker from '../screens/BrandPicker';
import { STATUS_LABELS, RELATIONSHIP_LABELS, STATUS_TONE, RELATIONSHIP_TONE, SOURCE_LABELS } from './verdict';
import { hkGet, hkPatch, hkPost } from '../hkApi';
import { HeatChip, ListButtons, heatBarStyle } from '../signals/Heat';
import OwnerChip, { sheetOwnerLabel } from './OwnerChip';

// hkos-data-foundation-v1 D6 - Brands: saved views, search (name / domain / alias, never a contact email), the table
// (kit DataTable on the hk tokens), bulk Claim / Release / Set status / Mark do-not-contact, [+ Add brand].
export const VIEWS = [['my_open', 'My open'], ['hot', 'Hot leads'], ['targets', 'Targets'], ['unclaimed', 'Unclaimed candidates'], ['overdue', 'Overdue'], ['local', 'Local Chicago'], ['all', 'All']];
const MANUAL = [['meeting', 'Meeting'], ['signed', 'Signed'], ['passed', 'Passed'], ['skipped', 'Skipped']];
const fmt = iso => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
export const Chip = ({ tone, children }) => <span className={`hk-chip hk-chip--${tone || 'grey'}`}>{children}</span>;

const PIPELINE_HIDDEN = new Set(['candidate', 'passed', 'skipped', 'sponsor']);

export default function BrandsScreen({ businessId, shell, owner, compact, onOpenBrand, canEdit, pipeline = false, intent = null, onIntentDone }) {
  const [view, setView] = useState('all');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState('');
  const [contactPick, setContactPick] = useState(false);
  const members = shell?.members || [];
  // hkos-sheet-import-v1 - "+ New": Add brand opens the modal; Add contact asks which brand, then opens its page.
  useEffect(() => {
    if (!intent || pipeline || !canEdit) return;
    if (intent.kind === 'add_brand') setAdding(true);
    if (intent.kind === 'add_contact') setContactPick(true);
    if (intent.kind === 'add_brand' || intent.kind === 'add_contact') onIntentDone?.();
  }, [intent, pipeline, canEdit, onIntentDone]);
  const member = id => members.find(m => m.user_id === id);
  const meId = shell?.me?.user_id;

  const load = useCallback(async () => {
    setError('');
    try { const { brands } = await hkGet(businessId, '/brands', { view: pipeline ? 'all' : view, q: q.trim(), owner }); setRows(pipeline ? brands.filter(b => !PIPELINE_HIDDEN.has(b.status)) : brands); }
    catch (e) { setError(e.message); setRows([]); }
  }, [businessId, view, q, owner, pipeline]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => { setSelected(new Set()); }, [view, q, owner]);

  const toggle = id => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const bulk = async (label, body) => {
    setBusy(label);
    try { for (const id of selected) await hkPatch(businessId, `/brands/${id}`, body); setSelected(new Set()); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };
  // grow-signals G7 bulk: + Target / + Pipeline one brand at a time; a refused brand is named, the rest still go.
  const bulkList = async (label, path, body) => {
    setBusy(label); setError('');
    const refused = [];
    for (const id of selected) { try { await hkPost(businessId, `/brands/${id}/${path}`, body); } catch (e) { refused.push(e.message); } }
    setSelected(new Set()); await load(); setBusy('');
    if (refused.length) setError(`Not added: ${refused.join('; ')}`);
  };
  const markDnc = () => { const reason = window.prompt('Why should these brands never be contacted?'); if (reason && reason.trim()) bulk('dnc', { relationship: 'do_not_contact', dnc_reason: reason.trim() }); };

  const columns = useMemo(() => [
    ...(canEdit ? [{ id: 'pick', label: 'Select', width: 36, render: r => <input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /> }] : []),
    { id: 'name', label: 'Name', sticky: true, minWidth: 220, sortValue: r => r.name, render: r => (
      <button type="button" className="hk-btn hk-table__name" onClick={() => onOpenBrand(r.id)} data-hk-brand={r.id}>
        <span className="hk-table__title">{r.name}</span>
        {r.domain && <span className="hk-meta">{r.domain}</span>}
      </button>) },
    { id: 'heat', label: 'Heat', width: 80, sortValue: r => r.heat || 0, render: r => (r.heat_band && r.heat_band !== 'cold' ? <HeatChip band={r.heat_band} /> : <span className="hk-meta">·</span>) },
    ...(canEdit ? [{ id: 'lists', label: 'Lists', width: 250, render: r => <ListButtons businessId={businessId} brand={r} meId={meId} members={members} canEdit compact /> }] : []),
    { id: 'category', label: 'Category', width: 130, sortValue: r => r.category || '', render: r => r.category || <span className="hk-meta">·</span> },
    { id: 'local', label: 'Local / National', width: 130, sortValue: r => (r.is_local ? 0 : 1), render: r => <Chip tone={r.is_local ? 'green' : 'grey'}>{r.is_local ? 'Local Chicago' : 'National'}</Chip> },
    { id: 'owner', label: 'Owner', width: 150, sortValue: r => member(r.owner_user_id)?.first_name || (r.owner_hint ? sheetOwnerLabel(r.owner_hint) : ''), render: r => <OwnerChip owner={member(r.owner_user_id)} hint={r.owner_hint} size={24} /> },
    { id: 'status', label: 'Status', width: 120, sortValue: r => r.status, render: r => <Chip tone={STATUS_TONE[r.status]}>{STATUS_LABELS[r.status] || r.status}</Chip> },
    { id: 'relationship', label: 'Relationship', width: 140, sortValue: r => r.relationship, render: r => <Chip tone={RELATIONSHIP_TONE[r.relationship]}>{RELATIONSHIP_LABELS[r.relationship] || r.relationship}</Chip> },
    { id: 'last_touch', label: 'Last touch', width: 100, sortValue: r => r.last_touch_at || '', render: r => fmt(r.last_touch_at) || <span className="hk-meta">None</span> },
    { id: 'next_due', label: 'Next due', width: 100, sortValue: r => r.next_due_at || '', render: r => fmt(r.next_due_at) || <span className="hk-meta">·</span> },
    { id: 'contact', label: 'Primary contact', width: 150, sortValue: r => r.primary_contact_name || '', render: r => r.primary_contact_name || <span className="hk-meta">·</span> },
    { id: 'source', label: 'Source', width: 120, sortValue: r => r.source, render: r => (r.source === 'import' ? <Chip tone="lilac">Import</Chip> : SOURCE_LABELS[r.source] || r.source) },
    { id: 'created', label: 'Created', width: 100, sortValue: r => r.created_at, render: r => fmt(r.created_at) },
  ], [canEdit, selected, members, onOpenBrand, businessId, meId]);

  return (
    <div className="hk-brands" data-hk-brands={pipeline ? 'pipeline' : 'brands'}>
      <div className="hk-toolbar">
        {pipeline ? <span className="hk-meta">Brands in motion: claimed through replied. Candidates, passed, skipped and sponsors live under Brands and Sponsors.</span> : <Tabs label="Saved views" items={VIEWS.map(([id, label]) => ({ id, label }))} value={view} onChange={setView} />}
        <span className="hk-spacer" />
        <input className="ui-input hk-search-input" type="search" placeholder="Search name, domain or alias" aria-label="Search brands" value={q} onChange={e => setQ(e.target.value)} />
        {canEdit && !pipeline && <Button variant="primary" onClick={() => setAdding(true)} data-hk-add>+ Add brand</Button>}
      </div>
      {canEdit && selected.size > 0 && (
        <div className="hk-bulk" role="toolbar" aria-label="Bulk actions">
          <span>{selected.size} selected</span>
          <Button size="sm" disabled={!!busy} onClick={() => bulk('claim', { claim: true })}>Claim</Button>
          <Button size="sm" disabled={!!busy} onClick={() => bulk('release', { claim: false })}>Release</Button>
          <Button size="sm" disabled={!!busy} onClick={() => bulkList('target', 'target', { on: true })} data-hk-bulk-target>+ Target</Button>
          <Button size="sm" disabled={!!busy} onClick={() => bulkList('pipeline', 'pipeline', {})} data-hk-bulk-pipeline>+ Pipeline</Button>
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
          <p className="hk-empty__title">{q ? 'No brand matches.' : pipeline ? 'No brands in motion yet.' : view === 'all' ? 'No brands yet.' : view === 'hot' ? 'No Hot or Warm brands right now.' : view === 'targets' ? 'No Targets yet.' : 'Nothing in this view.'}</p>
          <p className="hk-empty__line">{q ? 'Try the domain or an alias.' : pipeline ? 'Claim a brand under Brands and it shows here.' : 'Add a brand, or wait for the Sheet import.'}</p>
        </div>
      ) : (
        <><h2 className="ui-sr-only">Brand list</h2>
        <DataTable label="Brands" columns={columns} rowKey={r => r.id} compact={compact} rowStyle={r => heatBarStyle(r.heat_band)} groups={[{ id: 'all', header: `${rows.length} brand${rows.length === 1 ? '' : 's'}`, rows }]}
          renderCompact={r => (<>
            <button type="button" className="hk-btn hk-card-row" onClick={() => onOpenBrand(r.id)} data-hk-brand={r.id}>
              <span className="hk-table__title">{r.name}</span>
              <span className="hk-card-row__chips"><HeatChip band={r.heat_band} /><Chip tone={STATUS_TONE[r.status]}>{STATUS_LABELS[r.status]}</Chip><OwnerChip owner={member(r.owner_user_id)} hint={r.owner_hint} size={18} chip /><Chip tone={r.is_local ? 'green' : 'grey'}>{r.is_local ? 'Local' : 'National'}</Chip>{r.source === 'import' && <Chip tone="lilac">Import</Chip>}</span>
            </button>
            <ListButtons businessId={businessId} brand={r} meId={meId} members={members} canEdit={canEdit} compact />
          </>)} /></>
      )}
      {contactPick && <BrandPicker businessId={businessId} title="Which brand gets the contact?" line="Pick the brand, then add the contact on its Contacts tab." confirmLabel="Open brand" any onClose={() => setContactPick(false)} onPick={b => { setContactPick(false); onOpenBrand(b.id); }} />}
      {adding && <AddBrandModal businessId={businessId} members={members} onClose={() => setAdding(false)} onOpenMatch={id => { setAdding(false); onOpenBrand(id); }} onSaved={b => { setAdding(false); onOpenBrand(b.id); }} />}
    </div>
  );
}

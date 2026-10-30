import React, { useEffect, useMemo, useState } from 'react';
import DataTable from '../../ui/DataTable';
import Button from '../../ui/Button';
import { Sprout } from '../HkMarks';
import AddBrandModal from './AddBrandModal';
import BrandPicker from '../screens/BrandPicker';
import { STATUS_LABELS, RELATIONSHIP_LABELS, STATUS_TONE, RELATIONSHIP_TONE, SOURCE_LABELS } from './verdict';
import { hkPatch, hkPost } from '../hkApi';
import { HeatChip, ListButtons, heatBarStyle } from '../signals/Heat';
import OwnerChip from './OwnerChip';

// hkos-data-foundation-v1 D6 + grow-nav-filters-v1 N3/N11 - the Brands list: the kit DataTable on the hk tokens, fed by
// the Brands space (one paged, server-sorted read: useBrandList). Sorting and paging happen on the server; the next page
// loads as the end scrolls into view. While a new filter loads the old rows stay, dimmed. Bulk Claim / Release /
// + Target / + Pipeline / Set status / Mark do-not-contact; [+ Add brand] arrives as an intent from "+ New".
//   layout 'stage': grouped by status, groups in the server's status order (facets.stage), each with its count.
const MANUAL = [['meeting', 'Meeting'], ['signed', 'Signed'], ['passed', 'Passed'], ['skipped', 'Skipped']];
const fmt = iso => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
export const Chip = ({ tone, children }) => <span className={`hk-chip hk-chip--${tone || 'grey'}`}>{children}</span>;
const plural = (n, w) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`;

export default function BrandsScreen({ businessId, shell, compact, onOpenBrand, canEdit, list, sort, onSort, layout = 'table', emptyLine, intent = null, onIntentDone }) {
  const [selected, setSelected] = useState(() => new Set());
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [contactPick, setContactPick] = useState(false);
  const members = shell?.members || [];
  // hkos-sheet-import-v1 - "+ New": Add brand opens the modal; Add contact asks which brand, then opens its page.
  useEffect(() => {
    if (!intent || !canEdit) return;
    if (intent.kind === 'add_brand') setAdding(true);
    if (intent.kind === 'add_contact') setContactPick(true);
    if (intent.kind === 'add_brand' || intent.kind === 'add_contact') onIntentDone?.();
  }, [intent, canEdit, onIntentDone]);
  const member = id => members.find(m => m.user_id === id);
  const meId = shell?.me?.user_id;
  const rows = list.rows;
  const rowsKey = rows ? rows.map(r => r.id).join() : '';
  useEffect(() => { setSelected(s => (s.size ? new Set([...s].filter(id => rowsKey.includes(id))) : s)); }, [rowsKey]);

  const toggle = id => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const bulk = async (label, body) => {
    setBusy(label); setError('');
    try { for (const id of selected) await hkPatch(businessId, `/brands/${id}`, body); setSelected(new Set()); await list.reload(); }
    catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };
  // grow-signals G7 bulk: + Target / + Pipeline one brand at a time; a refused brand is named, the rest still go.
  const bulkList = async (label, path, body) => {
    setBusy(label); setError('');
    const refused = [];
    for (const id of selected) { try { await hkPost(businessId, `/brands/${id}/${path}`, body); } catch (e) { refused.push(e.message); } }
    setSelected(new Set()); await list.reload(); setBusy('');
    if (refused.length) setError(`Not added: ${refused.join('; ')}`);
  };
  const markDnc = () => { const reason = window.prompt('Why should these brands never be contacted?'); if (reason && reason.trim()) bulk('dnc', { relationship: 'do_not_contact', dnc_reason: reason.trim() }); };

  // sortValue marks the columns the server can sort (brandFilters SORTS); serverSort keeps the rows as they arrive.
  const columns = useMemo(() => [
    ...(canEdit ? [{ id: 'pick', label: 'Select', width: 36, render: r => <input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /> }] : []),
    { id: 'name', label: 'Name', sticky: true, minWidth: 220, sortValue: r => r.name, render: r => (
      <button type="button" className="hk-btn hk-table__name" onClick={() => onOpenBrand(r.id)} data-hk-brand={r.id}>
        <span className="hk-table__title">{r.name}</span>
        {r.domain && <span className="hk-meta">{r.domain}</span>}
      </button>) },
    { id: 'heat', label: 'Heat', width: 80, sortValue: r => r.heat || 0, render: r => (r.heat_band && r.heat_band !== 'cold' ? <HeatChip band={r.heat_band} /> : <span className="hk-meta">·</span>) },
    ...(canEdit ? [{ id: 'lists', label: 'Lists', width: 250, render: r => <ListButtons businessId={businessId} brand={r} meId={meId} members={members} canEdit compact /> }] : []),
    { id: 'category', label: 'Category', width: 130, render: r => r.category || <span className="hk-meta">·</span> },
    { id: 'local', label: 'Local / National', width: 130, render: r => <Chip tone={r.is_local ? 'green' : 'grey'}>{r.is_local ? 'Local Chicago' : 'National'}</Chip> },
    { id: 'owner', label: 'Owner', width: 150, render: r => <OwnerChip owner={member(r.owner_user_id)} hint={r.owner_hint} size={24} /> },
    { id: 'status', label: 'Status', width: 120, sortValue: r => r.status, render: r => <Chip tone={STATUS_TONE[r.status]}>{STATUS_LABELS[r.status] || r.status}</Chip> },
    { id: 'relationship', label: 'Relationship', width: 140, render: r => <Chip tone={RELATIONSHIP_TONE[r.relationship]}>{RELATIONSHIP_LABELS[r.relationship] || r.relationship}</Chip> },
    { id: 'last_touch', label: 'Last touch', width: 100, sortValue: r => r.last_touch_at || '', render: r => fmt(r.last_touch_at) || <span className="hk-meta">None</span> },
    { id: 'next_due', label: 'Next due', width: 100, sortValue: r => r.next_due_at || '', render: r => fmt(r.next_due_at) || <span className="hk-meta">·</span> },
    { id: 'contact', label: 'Primary contact', width: 150, render: r => r.primary_contact_name || <span className="hk-meta">·</span> },
    { id: 'source', label: 'Source', width: 120, render: r => (r.source === 'import' ? <Chip tone="lilac">Import</Chip> : SOURCE_LABELS[r.source] || r.source) },
    { id: 'created', label: 'Created', width: 100, sortValue: r => r.created_at, render: r => fmt(r.created_at) },
  ], [canEdit, selected, members, onOpenBrand, businessId, meId]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    if (!rows) return [];
    if (layout !== 'stage') return [{ id: 'all', header: plural(list.total, 'brand'), rows }];
    const order = (list.facets?.stage || []).map(([v, n]) => [v, n]);
    for (const r of rows) if (!order.some(([v]) => v === r.status)) order.push([r.status, null]);
    return order.map(([v, n]) => ({ id: v, header: <>{STATUS_LABELS[v] || v} <span className="ui-table__count">{n ?? rows.filter(r => r.status === v).length}</span></>, rows: rows.filter(r => r.status === v) })).filter(g => g.rows.length);
  }, [rows, layout, list.total, list.facets]);

  return (
    <div className="hk-brands" data-hk-brands="brands">
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
      {(error || list.error) && <p className="hk-error" role="alert">{error || list.error}</p>}
      {rows === null ? <p className="hk-meta">Loading brands…</p> : rows.length === 0 ? (
        <div className="hk-empty" data-hk-empty>
          <Sprout size={40} />
          <p className="hk-empty__title">No brand matches these filters.</p>
          <p className="hk-empty__line">{emptyLine || 'Remove a filter, or pick another view.'}</p>
        </div>
      ) : (
        <div className={list.loading ? 'hk-list--stale' : undefined} aria-busy={list.loading || undefined} data-hk-brand-list>
          <h2 className="ui-sr-only">Brand list</h2>
          <DataTable label="Brands" columns={columns} rowKey={r => r.id} compact={compact} rowStyle={r => heatBarStyle(r.heat_band)} groups={groups}
            serverSort sort={sort} onSort={onSort} onReachEnd={list.next ? list.loadMore : null}
            renderCompact={r => (<>
              <button type="button" className="hk-btn hk-card-row" onClick={() => onOpenBrand(r.id)} data-hk-brand={r.id}>
                <span className="hk-table__title">{r.name}</span>
                <span className="hk-card-row__chips"><HeatChip band={r.heat_band} /><Chip tone={STATUS_TONE[r.status]}>{STATUS_LABELS[r.status]}</Chip><OwnerChip owner={member(r.owner_user_id)} hint={r.owner_hint} size={18} chip /><Chip tone={r.is_local ? 'green' : 'grey'}>{r.is_local ? 'Local' : 'National'}</Chip>{r.source === 'import' && <Chip tone="lilac">Import</Chip>}</span>
              </button>
              <ListButtons businessId={businessId} brand={r} meId={meId} members={members} canEdit={canEdit} compact />
            </>)} />
          {list.next && <p className="hk-meta" data-hk-more-rows>Showing {rows.length.toLocaleString('en-US')} of {list.total.toLocaleString('en-US')}. More load as you scroll.</p>}
        </div>
      )}
      {contactPick && <BrandPicker businessId={businessId} title="Which brand gets the contact?" line="Pick the brand, then add the contact on its Contacts tab." confirmLabel="Open brand" any onClose={() => setContactPick(false)} onPick={b => { setContactPick(false); onOpenBrand(b.id); }} />}
      {adding && <AddBrandModal businessId={businessId} members={members} onClose={() => setAdding(false)} onOpenMatch={id => { setAdding(false); onOpenBrand(id); }} onSaved={b => { setAdding(false); onOpenBrand(b.id); }} />}
    </div>
  );
}

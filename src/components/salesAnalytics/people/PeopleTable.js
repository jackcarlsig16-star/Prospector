import { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { SA, SA_THEME_ROOT_ID } from '../theme';
import { goalsApi, OPEN_PIPELINE_RECORD } from '../goals/goalsApi';
import { numStyle, ErrorNote } from '../goals/goalsUi';
import DataTable from '../../../ui/DataTable';
import FilterSelect from '../../../ui/FilterSelect';
import Button from '../../../ui/Button';
import { ToggleChip, ActiveFilterLine } from '../../../ui/Chip';
import { memberColor } from '../../../constants/memberColors';
import useMediaQuery from '../../../utils/useMediaQuery';
import { toCsv } from '../../../utils/csv';
import { readPeopleCompany, writePeopleCompany } from '../salesNav';
import { CHIPS, WINDOW_OPTIONS, SOURCE_OPTIONS, EMPTY_FILTERS, applyFilters, chipCounts, stageOptions, activeFilters, removeFilter, toggleChip, targetToFilters, CSV_COLUMNS, heatRule, readSort, writeSort } from './peopleTableModel';
import PersonDetail from './PersonDetail';

// people-v2 Stage 2 - Pipeline › People: ONE table of everyone we know (prospects, identified visitors, partner contacts)
// with their email activity and their company's visits, from GET goals/people/activity (P5: the materialised summary -
// the Huddle's numbers to the digit) sliced by the filter chips (P3, multi-select with counts), the labeled selects, a
// search, any-column sort (default = the route's heat desc, then last email). A row click selects it (the pinned card
// under the row: timeline + quick menu, P4); the name opens the company window on its People card; the company name
// opens the window. P6: a phone gets stacked cards and a scrolling chip row. P7: CSV of the filtered rows (structured
// fields only) and Share view (saved filters, kind 'people'). Viewers read: no quick-menu writes, no Share view.
// The heat band is never computed here - it is the route's (the Huddle's rule), and the footnote states that rule.
const UNDO_MS = 10000;
const LA = 'America/Los_Angeles';
const md = iso => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: LA }) : null);
const mdy = d => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : null);
const HEAT_COLOR = { hot: SA.bad, warm: SA.warn, cold: SA.muted };
const Dim = () => <span className="ui-table__dim">—</span>;
const ell = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' };
const rowBar = { minHeight: 36, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 };
const RECORD = ['partner', 'employer', 'target'];

export default function PeopleTable({ businessId, canEdit, me = null, initialTarget = null }) {
  const phone = useMediaQuery('(max-width: 899px)');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [members, setMembers] = useState([]);
  const [filters, setFilters] = useState(() => targetToFilters(initialTarget, { ...EMPTY_FILTERS, company: readPeopleCompany() }));
  const [sort, setSort] = useState(readSort);
  const [toast, setToast] = useState(null);
  const [views, setViews] = useState([]);
  const [viewName, setViewName] = useState('');
  const [sharing, setSharing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const meId = me?.profile?.id || null, myName = me?.profile?.display_name || '';
  const load = useCallback(() => goalsApi.peopleActivity(businessId, filters.window).then(d => { setData(d); setError(''); }).catch(e => setError(e.message)), [businessId, filters.window]);
  useEffect(() => { load(); }, [load, reload]);
  useEffect(() => {
    goalsApi.members(businessId).then(setMembers).catch(() => setMembers([]));
    goalsApi.peopleViews(businessId).then(setViews).catch(() => setViews([]));
  }, [businessId]);
  useEffect(() => { if (initialTarget) setFilters(f => targetToFilters(initialTarget, f)); }, [initialTarget]);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), toast.undo ? UNDO_MS : 4000);
    return () => clearTimeout(t);
  }, [toast]);
  const ctx = useMemo(() => ({ meId, myName, now: Date.now() }), [meId, myName, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = useMemo(() => data?.rows || [], [data]);
  const rows = useMemo(() => applyFilters(all, filters, ctx), [all, filters, ctx]);
  const counts = useMemo(() => chipCounts(all, ctx), [all, ctx]);
  const stages = useMemo(() => stageOptions(all), [all]);
  const colorOf = uid => { const i = members.findIndex(m => m.user_id === uid); return i >= 0 ? members[i].color || memberColor(i) : null; };
  const openCompany = (c, section = null) => { if (!c?.id || !RECORD.includes(c.type)) return; window.dispatchEvent(new CustomEvent(OPEN_PIPELINE_RECORD, { detail: { key: `${c.type}-${c.id}`, ...(section ? { section } : {}) } })); };
  const changed = () => setReload(n => n + 1);
  const set = patch => setFilters(f => ({ ...f, ...patch }));
  const onRemove = key => { if (key === 'company') writePeopleCompany(null); setFilters(f => removeFilter(f, key)); };
  const clearAll = () => { writePeopleCompany(null); setFilters(EMPTY_FILTERS); };
  const onSort = s => { setSort(s); writeSort(s); };

  const exportCsv = () => {
    const text = toCsv(rows, CSV_COLUMNS);
    if (/@/.test(text)) { setToast({ text: 'Export refused: an address would have reached the file' }); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = `people-${new Date().toLocaleDateString('en-CA', { timeZone: LA })}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const saveView = async e => {
    e.preventDefault();
    const name = viewName.trim(); if (!name) return;
    try { const r = await goalsApi.savePeopleView(businessId, { name, state: { chips: filters.chips, source: filters.source, stage: filters.stage, owner: filters.owner, window: filters.window, q: filters.q } }); setViews(r.views); setViewName(''); setToast({ text: `View "${name}" saved for the team` }); }
    catch (err) { setToast({ text: err.message }); }
  };
  const applyView = v => setFilters({ ...EMPTY_FILTERS, ...v.state, chips: [...(v.state?.chips || [])], company: null });
  const deleteView = async v => { try { setViews(await goalsApi.deletePeopleView(businessId, v.id)); } catch (err) { setToast({ text: err.message }); } };

  const nameCell = r => (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
        {r.company?.id && RECORD.includes(r.company.type)
          ? <button type="button" className="ui-link ui-link--cell" data-person-name title={`Open ${r.company.name} on its People card`} onClick={() => openCompany(r.company, 'people')} style={{ fontWeight: 500, color: SA.text, ...ell }}>{r.name}</button>
          : <span data-person-name style={{ fontWeight: 500, ...ell }}>{r.name}</span>}
        {r.has_email && <span aria-label="address on file" title="An address is on file (never shown)" style={{ color: SA.muted, fontSize: 11, flex: 'none' }}>✉</span>}
      </span>
      <span style={{ fontSize: 12, color: SA.muted, ...ell }}>{r.title || 'no title'}</span>
    </span>
  );
  const companyCell = r => (r.company
    ? <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        {r.company.id && RECORD.includes(r.company.type) ? <button type="button" className="ui-link ui-link--cell" title={`Open ${r.company.name}`} onClick={() => openCompany(r.company)} style={ell}>{r.company.name}</button> : <span style={ell}>{r.company.name}</span>}
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 10.5 }}>{r.company.stage && <span className="ui-group-label" style={{ fontSize: 10.5 }}>{String(r.company.stage).replace(/_/g, ' ')}</span>}{r.company.owner_user_id && colorOf(r.company.owner_user_id) && <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: colorOf(r.company.owner_user_id), display: 'inline-block' }} />}</span>
      </span>
    : <Dim />);
  const sourceCell = r => <span className="ui-chip ui-chip--dense" title={r.sources.join(' + ')}>{r.source}{r.sources.length > 1 ? ` +${r.sources.length - 1}` : ''}</span>;
  const emailsCell = r => <span style={{ ...numStyle, whiteSpace: 'nowrap' }}>{r.emails.sent} <span style={{ color: SA.muted }}>sent</span> · {r.emails.opened} <span style={{ color: SA.muted }}>opened</span> · {r.emails.clicked} <span style={{ color: SA.muted }}>clicked</span> · {r.emails.replied} <span style={{ color: SA.muted }}>replied</span></span>;
  const lastEmailCell = r => (r.last_email ? <span style={{ whiteSpace: 'nowrap' }}>{md(r.last_email.at)} <span style={{ color: SA.muted }}>· {r.last_email.what}{r.last_email.reply_class ? ` · ${r.last_email.reply_class.replace(/_/g, ' ')}` : ''}</span></span> : <Dim />);
  const heatCell = r => (r.heat == null ? <span className="ui-table__dim" title="No heat yet - the next Apollo sync computes it">—</span> : <span data-heat-band={r.heat_band} style={{ display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', color: HEAT_COLOR[r.heat_band] || SA.text, background: `color-mix(in srgb, ${HEAT_COLOR[r.heat_band] || SA.muted} 14%, transparent)` }}>{r.heat} · {r.heat_band}</span>);
  const visitsCell = r => (r.visits ? <span style={{ whiteSpace: 'nowrap' }}><b style={numStyle}>{r.visits.visits_7d}</b> <span style={{ color: SA.muted }}>visits 7 d · last {mdy(r.visits.last_visit)}{r.visits.top_page ? ` · ${r.visits.top_page}` : ''}</span></span> : <Dim />);
  const columns = [
    { id: 'person', label: 'Person', width: 190, sticky: true, detail: true, sortValue: r => r.name, render: nameCell, title: r => `${r.name}${r.title ? ` · ${r.title}` : ''}` },
    { id: 'company', label: 'Company', width: 176, sortValue: r => r.company?.name || null, render: companyCell, title: r => r.company?.name },
    { id: 'source', label: 'Source', width: 130, sortValue: r => r.source, render: sourceCell },
    { id: 'emails', label: 'Emails (human opens)', width: 262, sortValue: r => r.emails.opened + r.emails.clicked * 2 + r.emails.replied * 4, render: emailsCell },
    { id: 'last_email', label: 'Last email', width: 158, sortValue: r => r.last_email?.at || null, render: lastEmailCell },
    { id: 'heat', label: 'Heat', width: 96, sortValue: r => r.heat ?? -1, render: heatCell, title: r => (r.heat == null ? 'no heat yet' : `${r.heat} · ${r.heat_band} - the Huddle's band`) },
    { id: 'visits', label: 'Company visits', width: 170, sortValue: r => r.visits?.visits_7d ?? -1, render: visitsCell },
    { id: 'identified', label: 'Identified', width: 90, sortValue: r => r.identified_at || null, render: r => (r.identified_at ? <span style={numStyle}>{mdy(r.identified_at)}</span> : <Dim />) },
    { id: 'buyer', label: 'Buyer', width: 56, sortValue: r => (r.buyer ? 1 : 0), render: r => (r.buyer ? <span aria-label="buyer title" style={{ color: SA.good }}>✓</span> : <Dim />) },
    { id: 'last_touch', label: 'Last touch', width: 90, sortValue: r => r.last_touch_at || null, render: r => (r.last_touch_at ? <span style={numStyle}>{md(r.last_touch_at)}</span> : <Dim />) },
  ];
  const sortLabel = sort && columns.find(c => c.id === sort.id)?.label;
  const groups = [{ id: 'people', header: <>{sort ? `Sorted by ${sortLabel}` : 'Heat first, then the last email'} <span className="ui-table__count">{rows.length}</span></>, rows, emptyText: 'No people match these filters.' }];
  const renderDetail = r => <PersonDetail businessId={businessId} row={r} canEdit={canEdit} meId={meId} onToast={setToast} onChanged={changed} onOpenCompany={openCompany} />;
  const compactRow = r => (
    <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', minWidth: 0 }}>{nameCell(r)}{heatCell(r)}</span>
      <span style={{ fontSize: 12, color: SA.muted, ...ell }}>{r.company?.name || 'no company'}{r.company?.stage ? ` · ${String(r.company.stage).replace(/_/g, ' ')}` : ''}</span>
      <span style={{ fontSize: 12, display: 'flex', gap: 10, flexWrap: 'wrap', ...numStyle }}><span title="sent">✉ {r.emails.sent}</span><span title="human opens">👁 {r.emails.opened}</span><span title="clicked">🖱 {r.emails.clicked}</span><span title="replied">↩ {r.emails.replied}</span><span style={{ color: SA.muted }}>{r.visits ? `${r.visits.visits_7d} visits 7 d` : 'no visits'}</span></span>
      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{sourceCell(r)}{r.buyer && <span className="ui-chip ui-chip--dense">Buyer ✓</span>}{r.identified_at && <span className="ui-chip ui-chip--dense">Identified {mdy(r.identified_at)}</span>}</span>
    </div>
  );
  const chipRow = (
    <div data-people-chips role="group" aria-label="Filter chips" style={{ display: 'flex', gap: 6, ...(phone ? { overflowX: 'auto', flexWrap: 'nowrap', paddingBottom: 4 } : { flexWrap: 'wrap' }) }}>
      <h2 className={phone ? 'ui-sr-only' : 'ui-group-label'} style={{ margin: 0, flex: 'none' }}>Filter</h2>
      {CHIPS.map(([id, label]) => <ToggleChip key={id} pressed={filters.chips.includes(id)} count={data ? `(${counts[id]})` : ''} onClick={() => set(toggleChip(filters, id))} title={id === 'hot' ? `Heat band hot (score ≥ ${data?.heat_rule?.hot ?? 40}, or the Huddle's reply / click rule)` : id === 'needs_touch' ? 'No touch on any channel in 14 days' : undefined}>{label}</ToggleChip>)}
    </div>
  );
  const selects = (
    <>
      <FilterSelect label="Source" value={filters.source} options={[{ value: '', label: 'All' }, ...SOURCE_OPTIONS.map(s => ({ value: s, label: s }))]} onChange={v => set({ source: v })} />
      <FilterSelect label="Company stage" value={filters.stage} options={[{ value: '', label: 'All' }, ...stages.map(s => ({ value: s, label: String(s).replace(/_/g, ' ') }))]} onChange={v => set({ stage: v })} />
      <FilterSelect label="Owner" value={filters.owner} options={[{ value: '', label: 'All' }, ...members.filter(m => m.role !== 'viewer').map(m => ({ value: m.user_id, label: m.name })), { value: 'unassigned', label: 'Unassigned' }]} onChange={v => set({ owner: v })} />
      <FilterSelect label="Window" value={filters.window} options={WINDOW_OPTIONS.map(([value, label]) => ({ value, label }))} onChange={v => set({ window: v })} />
    </>
  );
  const tools = (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }}>
      <Button size="sm" disabled={!rows.length} onClick={exportCsv} title="The filtered rows, structured fields only - never an address">CSV</Button>
      {canEdit && <Button size="sm" aria-expanded={sharing} onClick={() => setSharing(s => !s)}>Share view{views.length ? ` (${views.length})` : ''}</Button>}
    </span>
  );
  const overlayRoot = document.getElementById(SA_THEME_ROOT_ID) || document.body;
  const active = activeFilters(filters, { members });

  return (
    <section aria-label="People" data-people-table style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, padding: '0 20px' }}>
      <div data-filter-row style={rowBar}>
        <input type="search" className="ui-input ui-input--sm" aria-label="Search people" placeholder="Search name, title, company" value={filters.q} onChange={e => set({ q: e.target.value })} style={{ width: phone ? '100%' : 240 }} />
        {!phone && chipRow}
        {phone && <Button aria-expanded={sheetOpen} onClick={() => setSheetOpen(true)}>Filters{active.length ? ` (${active.length})` : ''}</Button>}
        {!phone && tools}
      </div>
      {phone && chipRow}
      {!phone && <div role="group" aria-label="Filters" data-filter-selects style={rowBar}>{selects}</div>}
      {data && (active.length
        ? <ActiveFilterLine summary={`Showing ${rows.length} of ${data.total} ·`} active={active} onRemove={onRemove} onClear={clearAll} />
        : <span data-active-filters style={{ fontSize: 12, color: SA.muted, ...numStyle }}>Showing {rows.length} of {data.total}</span>)}
      {sharing && canEdit && (
        <div role="group" aria-label="Share view" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 10px', border: `1px solid ${SA.border}`, borderRadius: 10, background: SA.surface2 }}>
          <form onSubmit={saveView} style={{ display: 'inline-flex', gap: 6 }}>
            <input aria-label="View name" placeholder="Name this view" value={viewName} maxLength={60} onChange={e => setViewName(e.target.value)} className="ui-input ui-input--sm" style={{ width: 180 }} />
            <Button type="submit" size="sm" variant="primary" disabled={!viewName.trim()}>Save view</Button>
          </form>
          {views.map(v => <span key={v.id} style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}><Button size="sm" onClick={() => applyView(v)}>{v.name}</Button><Button size="sm" variant="tertiary" aria-label={`Delete view ${v.name}`} onClick={() => deleteView(v)}>×</Button></span>)}
          {!views.length && <span style={{ fontSize: 12, color: SA.muted }}>No saved views yet - save the current filters for the team.</span>}
        </div>
      )}
      {error && <ErrorNote message={error} />}
      {data && (
        <div className="ui-theme-dark">
          <DataTable label="People" columns={columns} groups={groups} rowKey={r => r.key.replace(/[^A-Za-z0-9_-]/g, '_')} sort={sort} onSort={onSort} dense rowDetail pinUnder="[data-workspace-header]" compact={phone} renderCompact={compactRow} renderDetail={renderDetail} emptyText="No people match these filters." />
        </div>
      )}
      {data && <p data-heat-footnote style={{ margin: 0, fontSize: 12, color: SA.faint }}>{heatRule(data.heat_rule)}{data.heat_pending ? ` ${data.heat_pending} ${data.heat_pending === 1 ? 'person has' : 'people have'} no heat yet (the next Apollo sync computes it).` : ''} Times are Pacific.</p>}
      {toast && createPortal(
        <div role="status" className="no-print" style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 4005, padding: '10px 16px', borderRadius: 10, background: SA.surface2, border: `1px solid ${SA.border}`, color: SA.text, fontSize: 13, display: 'flex', gap: 12, alignItems: 'center', boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>
          <span>{toast.text}</span>
          {toast.undo && <Button variant="tertiary" style={{ fontWeight: 600 }} onClick={async () => { const u = toast.undo; setToast(null); try { await u(); } catch (e) { setToast({ text: e.message }); } }}>Undo</Button>}
        </div>, overlayRoot)}
      {sheetOpen && createPortal(
        <div className="no-print" style={{ position: 'fixed', inset: 0, zIndex: 4003 }}>
          <div onClick={() => setSheetOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
          <div role="dialog" aria-label="Filters" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '80vh', overflowY: 'auto', background: SA.surface, borderTop: `1px solid ${SA.border}`, borderRadius: '14px 14px 0 0', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {selects}
            {tools}
            <button type="button" className="ui-btn ui-btn--secondary" style={{ width: '100%' }} onClick={() => setSheetOpen(false)}>Show {rows.length}</button>
          </div>
        </div>, overlayRoot)}
    </section>
  );
}

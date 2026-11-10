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
import { readOpenKey, openKeyOf, onScoutOpen, clearUrlParam } from '../../scout/scoutOpen';
import { CHIPS, WINDOW_OPTIONS, SOURCE_OPTIONS, EMPTY_FILTERS, applyFilters, chipCounts, sizeChipCounts, peopleCoverage, stageOptions, activeFilters, removeFilter, toggleChip, targetToFilters, CSV_COLUMNS, readSort, writeSort, bandGroups, bandRule } from './peopleTableModel';
import { SIZE_BUCKETS, toggleSize, coverageLine, headcountSortValue, headcountText, HEADCOUNT_SOURCE_GLYPH, HEADCOUNT_SOURCE_WORD } from '../../../constants/headcount';
import { SOURCE_GLYPH_BY_WORD } from '../../../constants/peopleSource';
import HeatPill, { HEAT_COLOR, BAND_WORD, delta7 } from './HeatPill';
import HeatPopover from './HeatPopover';
import PersonDetail from './PersonDetail';

// people-v2 Stage 2 - Pipeline › People: ONE table of everyone we know (prospects, identified visitors, partner contacts)
// with their email activity and their company's visits, from GET goals/people/activity (P5: the materialised summary)
// sliced by the filter chips (P3, multi-select with counts), the labeled selects, a search, any-column sort (default =
// the route's heat desc, then last email). A row click selects it (the pinned card under the row: timeline + quick
// menu, P4); the name opens the company window on its People card; the company name opens the window. P6: a phone
// gets stacked cards and a scrolling chip row. P7: CSV of the filtered rows (structured fields only) and Share view
// (saved filters, kind 'people'). Viewers read: no quick-menu writes, no Share view.
// heat-v2 Stage 2 (the Nov 9 design, specs/design/people-v2/PeopleTable-v2.dc.html): the band is the route's (the
// number's bracket) and the table shows it as the one pill (D1) under Hot / Warm / Cold group headers in heat order,
// Cold collapsed; Identified is a date column and the buyer title a tag on the name (D2); Source is glyph + word; the
// footnote is gone - the Heat header's ⓘ opens the popover (D3); the header is two lines, the selects right of the
// Size row (D4); the Δ7 glyph after the number once 7 days of history exist (H5). Widths sum to 1,082 of the card's
// 1,100 px at 1440 - no sideways scroll (N2).
const UNDO_MS = 10000;
const LA = 'America/Los_Angeles';
const md = iso => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: LA }) : null);
const mdy = d => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : null);
const Dim = () => <span className="ui-table__dim">—</span>;
const two = { display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, fontSize: 12, lineHeight: '15px' };
const srHead = (word, rest) => <>{word}<span className="ui-sr-only"> {rest}</span></>;
const ell = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' };
const rowBar = { minHeight: 36, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 };
const RECORD = ['partner', 'employer', 'target'];
const rowKeyOf = r => r.key.replace(/[^A-Za-z0-9_-]/g, '_');
const tag = { display: 'inline-flex', alignItems: 'center', height: 16, padding: '0 6px', borderRadius: 999, border: `1px solid ${SA.accent}`, color: SA.accent, fontSize: 9.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', flex: 'none', lineHeight: 1 };
const BuyerTag = () => <span data-buyer style={tag} title="Buyer title (matches Settings › buyer titles)">buyer</span>;

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
  const [coldOpen, setColdOpen] = useState(false);
  // scout-v2 B7: ?open=person:<person key> (or a Scout open while on screen) pins that person's card.
  const [scoutKey, setScoutKey] = useState(() => readOpenKey('person'));
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
  useEffect(() => onScoutOpen(p => { const k = openKeyOf('person', p.open); if (k) { setFilters(EMPTY_FILTERS); setScoutKey(k); } }), []);
  const ctx = useMemo(() => ({ meId, myName, now: Date.now() }), [meId, myName, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = useMemo(() => data?.rows || [], [data]);
  const rows = useMemo(() => applyFilters(all, filters, ctx), [all, filters, ctx]);
  const counts = useMemo(() => chipCounts(all, ctx), [all, ctx]);
  const sizes = useMemo(() => sizeChipCounts(all), [all]);
  const coverage = useMemo(() => peopleCoverage(all), [all]);
  const stages = useMemo(() => stageOptions(all), [all]);
  const scoutRow = useMemo(() => (scoutKey ? all.find(r => r.key === scoutKey || r.source_keys?.includes(scoutKey)) || null : null), [all, scoutKey]);
  useEffect(() => {
    if (!scoutRow) return;
    if (scoutRow.heat_band === 'cold' || scoutRow.heat == null) setColdOpen(true);
    clearUrlParam('open');
    document.querySelector(`[data-key="${rowKeyOf(scoutRow)}"]`)?.scrollIntoView?.({ block: 'center' });
  }, [scoutRow]);
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
    try { const r = await goalsApi.savePeopleView(businessId, { name, state: { chips: filters.chips, source: filters.source, stage: filters.stage, owner: filters.owner, window: filters.window, q: filters.q, sizes: filters.sizes } }); setViews(r.views); setViewName(''); setToast({ text: `View "${name}" saved for the team` }); }
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
        {r.buyer && <BuyerTag />}
      </span>
      <span style={{ fontSize: 12, color: SA.muted, ...ell }}>{r.title || 'no title'}</span>
    </span>
  );
  const hasRecord = r => !!(r.company?.id && RECORD.includes(r.company.type));
  const companyCell = r => (r.company
    ? <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        {hasRecord(r) ? <button type="button" className="ui-link ui-link--cell" title={`Open ${r.company.name}`} onClick={() => openCompany(r.company)} style={ell}>{r.company.name}</button> : <span style={ell}>{r.company.name}</span>}
        {hasRecord(r) && (r.company.stage || colorOf(r.company.owner_user_id)) && <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 10.5 }}>{r.company.stage && <span className="ui-group-label" style={{ fontSize: 10.5 }}>{String(r.company.stage).replace(/_/g, ' ')}</span>}{r.company.owner_user_id && colorOf(r.company.owner_user_id) && <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: colorOf(r.company.owner_user_id), display: 'inline-block' }} />}</span>}
      </span>
    : <Dim />);
  const sourceText = r => r.sources.join(' + ');
  const sourceCell = r => <span data-source={r.source} title={sourceText(r)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}><span aria-hidden="true" style={{ color: SA.muted, fontSize: 11 }}>{SOURCE_GLYPH_BY_WORD[r.source] || ''}</span>{r.source}{r.sources.length > 1 ? <span style={{ color: SA.muted }}> +{r.sources.length - 1}</span> : null}</span>;
  const sizeTitle = r => (r.company?.employees == null ? (r.company?.id ? 'Headcount unknown - type it in the company window (Employees)' : 'No company record - no headcount') : `${headcountText(r.company.employees)} employees · ${HEADCOUNT_SOURCE_WORD[r.company.employees_source] || 'source unknown'}`);
  const sizeCell = r => (r.company?.employees == null
    ? <span data-size="unknown" className="ui-table__dim">unknown</span>
    : <span data-size={r.company.employees_source || 'none'} style={{ ...numStyle, display: 'inline-flex', gap: 4, alignItems: 'baseline' }}>{headcountText(r.company.employees)}{HEADCOUNT_SOURCE_GLYPH[r.company.employees_source] && <span style={{ color: SA.muted, fontSize: 11 }}><span aria-hidden="true">{HEADCOUNT_SOURCE_GLYPH[r.company.employees_source]}</span><span className="ui-sr-only"> {HEADCOUNT_SOURCE_WORD[r.company.employees_source]}</span></span>}</span>);
  const emailsCell = r => (
    <span style={{ ...two, ...numStyle }}>
      <span style={ell}>{r.emails.sent} <span style={{ color: SA.muted }}>sent</span> · {r.emails.opened} <span style={{ color: SA.muted }}>opened</span></span>
      <span style={ell}>{r.emails.clicked} <span style={{ color: SA.muted }}>clicked</span> · {r.emails.replied} <span style={{ color: SA.muted }}>replied</span></span>
    </span>
  );
  const emailsText = r => `${r.emails.sent} sent · ${r.emails.opened} opened (human) · ${r.emails.clicked} clicked · ${r.emails.replied} replied`;
  const lastEmailText = r => (r.last_email ? `${md(r.last_email.at)} · ${r.last_email.what}${r.last_email.reply_class ? ` · ${r.last_email.reply_class.replace(/_/g, ' ')}` : ''}` : '');
  const lastEmailCell = r => (r.last_email ? <span style={ell}>{md(r.last_email.at)} <span style={{ color: SA.muted }}>· {r.last_email.what}{r.last_email.reply_class ? ` · ${r.last_email.reply_class.replace(/_/g, ' ')}` : ''}</span></span> : <Dim />);
  const heatTitle = r => (r.heat == null ? 'no heat yet' : `${r.heat} · ${BAND_WORD[r.heat_band] || r.heat_band} - the number's bracket${delta7(r) != null ? ` · ${delta7(r) > 0 ? '+' : ''}${delta7(r)} vs 7 days ago` : ''}`);
  const heatCell = r => <HeatPill heat={r.heat} band={r.heat_band} delta={delta7(r)} />;
  const visitsText = r => (r.visits ? `${r.visits.visits_7d} visits 7 d · last ${mdy(r.visits.last_visit)}${r.visits.top_page ? ` · ${r.visits.top_page}` : ''}` : '');
  const visitsCell = r => (r.visits
    ? <span style={two}>
        <span style={ell}><b style={numStyle}>{r.visits.visits_7d}</b> <span style={{ color: SA.muted }}>visits 7 d</span></span>
        <span style={{ color: SA.muted, ...ell }}>last {mdy(r.visits.last_visit)}{r.visits.top_page ? ` · ${r.visits.top_page}` : ''}</span>
      </span>
    : <Dim />);
  const columns = [
    { id: 'person', label: 'Person', width: 190, sticky: true, detail: true, sortValue: r => r.name, render: nameCell, title: r => `${r.name}${r.title ? ` · ${r.title}` : ''}${r.buyer ? ' · buyer title' : ''}` },
    { id: 'company', label: 'Company', width: 140, sortValue: r => r.company?.name || null, render: companyCell, title: r => r.company?.name },
    { id: 'size', label: srHead('Size', '(company)'), width: 74, sortValue: r => headcountSortValue(r.company?.employees), render: sizeCell, title: sizeTitle },
    { id: 'source', label: 'Source', width: 84, sortValue: r => r.source, render: sourceCell },
    { id: 'emails', label: srHead('Emails', '(human opens)'), width: 132, sortValue: r => r.emails.opened + r.emails.clicked * 2 + r.emails.replied * 4, render: emailsCell, title: emailsText },
    { id: 'last_email', label: 'Last email', width: 104, sortValue: r => r.last_email?.at || null, render: lastEmailCell, title: lastEmailText },
    { id: 'heat', label: 'Heat', width: 104, sortValue: r => r.heat ?? -1, render: heatCell, title: heatTitle, headerExtra: <HeatPopover rule={data?.heat_rule} historySince={data?.history_since} /> },
    { id: 'visits', label: srHead('Visits', '(company, 7 d)'), width: 108, sortValue: r => r.visits?.visits_7d ?? -1, render: visitsCell, title: visitsText },
    { id: 'identified', label: 'Identified', width: 76, sortValue: r => r.identified_at || null, render: r => (r.identified_at ? <span data-identified={r.identified_at} style={numStyle}>{mdy(r.identified_at)}</span> : <Dim />), title: r => (r.identified_at ? `Apollo named this person on the site · ${mdy(r.identified_at)}` : 'Not a visitor-identified person') },
    { id: 'last_touch', label: srHead('Touch', '(last, any channel)'), width: 70, sortValue: r => r.last_touch_at || null, render: r => (r.last_touch_at ? <span style={numStyle}>{md(r.last_touch_at)}</span> : <Dim />) },
  ];
  const sortLabel = sort && columns.find(c => c.id === sort.id)?.id;
  const bands = bandGroups(rows, sort);
  const groups = bands
    ? bands.map(({ band, rows: brows }) => ({
      id: band,
      header: <><span style={{ color: HEAT_COLOR[band] }}>{BAND_WORD[band]}</span><span className="ui-table__count" style={{ ...numStyle, fontWeight: 400 }}>{brows.length} · {bandRule(band, data?.heat_rule)}{band === 'cold' && !coldOpen ? ' · collapsed' : ''}</span></>,
      rows: brows,
      ...(band === 'cold' ? { collapsed: !coldOpen, onToggle: () => setColdOpen(o => !o) } : {}),
      emptyText: band === 'hot' ? 'Nobody is hot right now.' : undefined,
    }))
    : [{ id: 'people', header: <>Sorted by {sortLabel.replace(/_/g, ' ')} <span className="ui-table__count">{rows.length}</span></>, rows, emptyText: 'No people match these filters.' }];
  const renderDetail = r => <PersonDetail businessId={businessId} row={r} canEdit={canEdit} meId={meId} onToast={setToast} onChanged={changed} onOpenCompany={openCompany} rule={data?.heat_rule} />;
  const compactRow = r => (
    <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', minWidth: 0 }}>{nameCell(r)}{heatCell(r)}</span>
      <span style={{ fontSize: 12, color: SA.muted, ...ell }}>{r.company?.name || 'no company'}{hasRecord(r) && r.company?.stage ? ` · ${String(r.company.stage).replace(/_/g, ' ')}` : ''} · <span data-card-size title={sizeTitle(r)}>{r.company?.employees == null ? 'size unknown' : `${headcountText(r.company.employees)} ${HEADCOUNT_SOURCE_GLYPH[r.company.employees_source] || ''}`.trim()}</span></span>
      <span style={{ fontSize: 12, display: 'flex', gap: 10, flexWrap: 'wrap', ...numStyle }}><span title="sent">✉ {r.emails.sent}</span><span title="human opens">👁 {r.emails.opened}</span><span title="clicked">🖱 {r.emails.clicked}</span><span title="replied">↩ {r.emails.replied}</span><span style={{ color: SA.muted }}>{r.visits ? `${r.visits.visits_7d} visits 7 d` : 'no visits'}</span></span>
      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}><span className="ui-chip ui-chip--dense">{sourceCell(r)}</span>{r.identified_at && <span className="ui-chip ui-chip--dense">Identified {mdy(r.identified_at)}</span>}</span>
    </div>
  );
  const chipRow = (
    <div data-people-chips role="group" aria-label="Filter chips" style={{ display: 'flex', gap: 6, ...(phone ? { overflowX: 'auto', flexWrap: 'nowrap', paddingBottom: 4 } : { flexWrap: 'wrap' }) }}>
      <h2 className={phone ? 'ui-sr-only' : 'ui-group-label'} style={{ margin: 0, flex: 'none' }}>Filter</h2>
      {CHIPS.map(([id, label]) => <ToggleChip key={id} pressed={filters.chips.includes(id)} count={data ? `(${counts[id]})` : ''} onClick={() => set(toggleChip(filters, id))} style={id === 'hot' ? { color: HEAT_COLOR.hot, borderColor: HEAT_COLOR.hot } : undefined} title={id === 'hot' ? `Heat band hot (score ≥ ${data?.heat_rule?.hot ?? 40})` : id === 'needs_touch' ? 'No touch on any channel in 14 days' : undefined}>{label}</ToggleChip>)}
    </div>
  );
  const sizeChips = (
    <span role="group" aria-label="Size" data-size-chips style={{ display: 'flex', gap: 6, flex: 'none', alignItems: 'center', ...(phone ? { overflowX: 'auto', paddingBottom: 4 } : {}) }}>
      <span className="ui-group-label" aria-hidden="true">Size</span>
      {SIZE_BUCKETS.map(([id, label]) => <ToggleChip key={id} data-size-chip={id} pressed={filters.sizes.includes(id)} count={data ? `(${sizes[id]})` : ''} title={id === 'unknown' ? 'No headcount on the company record (or no record at all)' : `Company headcount ${label}`} onClick={() => set({ sizes: toggleSize(filters.sizes, id) })}>{label}</ToggleChip>)}
    </span>
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
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <Button size="sm" disabled={!rows.length} onClick={exportCsv} title="The filtered rows, structured fields only - never an address">CSV</Button>
      {canEdit && <Button size="sm" aria-expanded={sharing} onClick={() => setSharing(s => !s)}>Share view{views.length ? ` (${views.length})` : ''}</Button>}
    </span>
  );
  const overlayRoot = document.getElementById(SA_THEME_ROOT_ID) || document.body;
  const active = activeFilters(filters, { members });

  return (
    <section aria-label="People" data-people-table style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, padding: '0 20px' }}>
      <div data-filter-row style={rowBar}>
        <input type="search" className="ui-input ui-input--sm" aria-label="Search people" placeholder="Search name, title, company" value={filters.q} onChange={e => set({ q: e.target.value })} style={{ width: phone ? '100%' : 220 }} />
        {!phone && chipRow}
        {phone && <Button aria-expanded={sheetOpen} onClick={() => setSheetOpen(true)}>Filters{active.length ? ` (${active.length})` : ''}</Button>}
      </div>
      {phone && chipRow}
      {phone && sizeChips}
      {!phone && <div role="group" aria-label="Filters" data-filter-selects style={rowBar}>{sizeChips}<span style={{ flex: 1 }} />{selects}{tools}</div>}
      {data && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {active.length
            ? <ActiveFilterLine summary={`Showing ${rows.length} of ${data.total} ·`} active={active} onRemove={onRemove} onClear={clearAll} />
            : <span data-active-filters style={{ fontSize: 12, color: SA.muted, ...numStyle }}>Showing {rows.length} of {data.total}</span>}
          <span data-coverage style={{ fontSize: 12, color: SA.muted, ...numStyle }}>{coverageLine(coverage)}</span>
          {data.heat_pending ? <span data-heat-pending style={{ fontSize: 12, color: SA.muted, ...numStyle }}>{data.heat_pending} {data.heat_pending === 1 ? 'person has' : 'people have'} no heat yet (the next Apollo sync computes it)</span> : null}
        </div>
      )}
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
          <DataTable label="People" columns={columns} groups={groups} rowKey={rowKeyOf} openKey={scoutRow ? rowKeyOf(scoutRow) : null} sort={sort} onSort={onSort} dense rowDetail pinUnder="[data-workspace-header]" compact={phone} renderCompact={compactRow} renderDetail={renderDetail} emptyText="No people match these filters." />
        </div>
      )}
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

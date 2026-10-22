import { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { SA, SA_THEME_ROOT_ID } from './theme';
import { SEMANTIC } from './palette';
import { fetchLive, FLAGS_CHANGED } from './huddleApi';
import { numStyle, ErrorNote } from './goals/goalsUi';
import DataTable from '../../ui/DataTable';
import DetailList from '../../ui/DetailList';
import FilterSelect from '../../ui/FilterSelect';
import Button from '../../ui/Button';
import Tag from '../../ui/Tag';
import { OWNER_OPTIONS, ACTIVITY_OPTIONS, STATUS_OPTIONS, EMPTY_FILTERS, activeFilterCount, peopleView, displayName, readSort, writeSort } from './peopleModel';
import { readPeopleCompany, writePeopleCompany } from './salesNav';
import { ActiveFilterChip, ToggleChip } from '../../ui/Chip';

// sales-ia-v2 P5 - Pipeline > People: Huddle Live on the kit table. One row
// per person with real activity (GET huddle/live, one page, closed rows
// included), filtered and sorted here. Closed + snoozed rows hide behind
// "Show closed (n)"; every column sorts (default newest activity, remembered);
// the filter row has a fixed height and scrolls sideways (N2). Row actions
// sit in a column pinned to the right edge (always in view while the middle
// columns scroll) and write through DailyHuddle (Undo lives there); Open
// company opens the P4 company panel for the person's company.
const ROW_BAR_HEIGHT = 36;
const NOT_NOW = [[7, '1 week'], [30, '1 month'], [90, '3 months']];
const LA = 'America/Los_Angeles';
const laDate = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: LA });
const clock = iso => new Date(iso).toLocaleTimeString('en-US', { timeZone: LA, hour: 'numeric', minute: '2-digit' }).toLowerCase();
export function whenText(iso, now = Date.now()) {
  if (!iso) return '—';
  if (laDate(iso) === laDate(now)) return clock(iso);
  const days = Math.max(1, Math.round((Date.parse(`${laDate(now)}T12:00:00Z`) - Date.parse(`${laDate(iso)}T12:00:00Z`)) / 864e5));
  return days < 7 ? `${days} d ago` : new Date(iso).toLocaleDateString('en-US', { timeZone: LA, month: 'short', day: 'numeric' });
}
const fullWhen = iso => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: LA, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'time unknown');
const KIND = { reply: ['↩ Replied', SEMANTIC.healthy], click: ['🖱 Clicked', SEMANTIC.warning], open: ['👁 Opened', SA.link] };
const KIND_RANK = { reply: 3, click: 2, open: 1 };

const rowBar = { height: ROW_BAR_HEIGHT, display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', overflowY: 'hidden', flexWrap: 'nowrap', minWidth: 0 };
// A row's Snooze… is a select acting as a small menu: the kit filter-select edge at the dense row's 24 px.
const rowSelect = { height: 24, fontSize: 12, borderRadius: 6, padding: '0 4px' };
const opts = (first, list) => [{ value: '', label: first }, ...list.map(([value, label]) => ({ value, label }))];
const Dim = () => <span className="ui-table__dim">—</span>;
const rowKey = r => r.contact_id;

export default function PeopleView({ businessId, myUserId, ownerColor, ownerLabel, canEdit, reloadKey, onFlag, onContacted, onNotAFit, onNotNow, onRestore, onOpenCompany, onSyncInfo, phone }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState(() => ({ ...EMPTY_FILTERS, company: readPeopleCompany() }));
  const [showClosed, setShowClosed] = useState(false);
  const [sort, setSort] = useState(readSort);
  const [sheetOpen, setSheetOpen] = useState(false);

  const load = useCallback(() => fetchLive(businessId, { show_closed: true, limit: 1000 })
    .then(d => { setData(d); setError(''); onSyncInfo?.(d.sync); }).catch(e => setError(e.message)), [businessId, onSyncInfo]);
  useEffect(() => { load(); }, [load, reloadKey]);
  useEffect(() => {
    window.addEventListener(FLAGS_CHANGED, load);
    return () => window.removeEventListener(FLAGS_CHANGED, load);
  }, [load]);

  const all = useMemo(() => data?.rows || [], [data]);
  const view = useMemo(() => peopleView(all, filters, showClosed), [all, filters, showClosed]);
  const set = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  const nFilters = activeFilterCount(filters);
  const clearCompany = () => { writePeopleCompany(null); set('company', null); };
  const clearAll = () => { writePeopleCompany(null); setFilters(EMPTY_FILTERS); };
  const onSort = s => { setSort(s); writeSort(s); };
  const now = Date.now();

  const activityCell = r => {
    if (!r.last_activity_kind) return <Dim />;
    const [label, color] = KIND[r.last_activity_kind];
    return <span style={{ display: 'inline-flex', gap: 6, alignItems: 'baseline', whiteSpace: 'nowrap' }}><span style={{ color }}>{label}</span><span style={{ ...numStyle, color: SA.muted, fontSize: 12 }}>{whenText(r.last_activity_at, now)}</span></span>;
  };
  const nameCell = r => <span title={r.name || undefined} style={{ fontWeight: 500, color: r.closed ? SA.muted : SA.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{displayName(r)}</span>;
  const companyCell = r => (r.company
    ? <button type="button" className="ui-link ui-link--cell" title={`Open ${r.company}`} onClick={() => onOpenCompany(r)}>{r.company}</button>
    : <Dim />);
  const ownerCell = r => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}><span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: ownerColor(r.owner), flex: 'none' }} />{ownerLabel(r.owner)}</span>;
  const statusCell = r => <span style={{ color: r.closed ? SA.muted : SA.text, whiteSpace: 'nowrap' }}>{r.closed && r.unsubscribed ? 'Unsubscribed' : r.status_label}{r.snoozed && r.snooze_until ? <span style={{ ...numStyle, color: SA.faint, fontSize: 11 }}> · until {r.snooze_until.slice(5).replace('-', '/')}</span> : null}</span>;
  const flagCell = r => (r.flag ? <span style={{ color: SA.accent, whiteSpace: 'nowrap' }} title={`Flagged to ${r.flag.owner_name || 'a teammate'}`}>⚑ {r.flag.owner_name ? r.flag.owner_name.split(' ')[0] : 'teammate'}</span> : <Dim />);
  const actionsCell = r => {
    if (!canEdit) return <Dim />;
    const name = r.name || 'contact';
    return (
      <span role="group" aria-label={`Actions for ${name}`} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap' }}>
        {r.not_a_fit
          ? <Button size="sm" title="Back on the list with the status they had before" onClick={() => onRestore(r)}>Restore</Button>
          : <>
            <Button size="sm" disabled={r.status === 'contacted'} disabledReason="Already marked contacted" title="Mark contacted (Undo for 10 s)" onClick={() => onContacted(r)}>Mark contacted</Button>
            <Button size="sm" title="Flag for a teammate (a to-do with a checklist)" onClick={() => onFlag(r)}>Flag</Button>
            <select className="ui-filter__select" aria-label={`Snooze ${name}`} value="" title="Hide until" onChange={e => { const n = Number(e.target.value); if (n) onNotNow(r, n, NOT_NOW.find(([d]) => d === n)[1]); }} style={{ ...rowSelect, width: 76 }}>
              <option value="">Snooze…</option>
              {NOT_NOW.map(([n, lb]) => <option key={n} value={n}>{lb}</option>)}
            </select>
            <Button size="sm" variant="danger" title="Not a fit (Undo for 10 s)" onClick={() => onNotAFit(r)}>Not a fit</Button>
          </>}
        {r.company && <Button size="sm" title={`Open ${r.company} in the company panel`} onClick={() => onOpenCompany(r)}>Open company</Button>}
      </span>
    );
  };

  const columns = [
    { id: 'person', label: 'Person', width: 150, sticky: true, detail: true, sortValue: r => r.name, render: nameCell, title: r => r.name },
    { id: 'title', label: 'Title', width: 150, sortValue: r => r.title, render: r => (r.title ? <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{r.title}</span> : <Dim />), title: r => r.title },
    { id: 'company', label: 'Company', width: 170, sortValue: r => r.company, render: companyCell, title: r => r.company },
    { id: 'activity', label: 'Last activity', width: 170, sortValue: r => r.last_activity_at, render: activityCell, title: r => `${r.insight || ''}${r.last_activity_at ? ` · ${fullWhen(r.last_activity_at)}` : ''}` },
    { id: 'sequence', label: 'Sequence', width: 180, sortValue: r => r.sequence?.name || null, render: r => (r.sequence ? <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{r.sequence.name || 'Sequence'}{r.step != null ? <span style={{ color: SA.muted }}> · step {r.step}</span> : null}</span> : <Dim />), title: r => r.sequence && `${r.sequence.name || 'Sequence'}${r.step != null ? ` · step ${r.step}` : ''}` },
    { id: 'heat', label: 'Heat', width: 56, sortValue: r => r.heat_7d, render: r => <span style={{ ...numStyle, color: r.heat_7d ? SA.text : SA.faint }}>{r.heat_7d}</span>, title: r => `${r.heat_7d} real opens + clicks in 7 days (bot opens excluded)${r.replied ? ' · replied' : ''}` },
    { id: 'kind', label: 'Signal', width: 96, sortValue: r => KIND_RANK[r.last_activity_kind] || null, render: r => (r.replied ? <Tag color={SEMANTIC.healthy}>Reply</Tag> : r.human_clicks ? <Tag color={SEMANTIC.warning}>Click</Tag> : r.real_opens ? <Tag color={SA.link}>Open ×{r.real_opens}</Tag> : <Dim />) },
    { id: 'owner', label: 'Owner', width: 90, sortValue: r => ownerLabel(r.owner), render: ownerCell },
    { id: 'status', label: 'Status', width: 96, sortValue: r => r.status_label, render: statusCell },
    { id: 'flag', label: 'Flag', width: 96, sortValue: r => r.flag?.owner_name || null, render: flagCell },
    { id: 'actions', label: 'Actions', width: canEdit ? 414 : 40, stickyEnd: true, render: actionsCell },
  ];
  const sortLabel = sort && columns.find(c => c.id === sort.id)?.label;
  const groups = [{ id: 'people', header: <>{sort ? `Sorted by ${sortLabel}` : 'Newest activity first'} <span className="ui-table__count">{view.rows.length}</span></>, rows: view.rows, emptyText: 'No people match these filters.' }];
  const rowStyle = r => (r.closed ? { '--ui-row-tint': `color-mix(in srgb, ${SA.track} 40%, transparent)` } : undefined);

  // FIX actions-row-detail-v1: the full text of every cell the row cuts off, read-only. Never an email or phone.
  const renderDetail = r => (
    <DetailList data-person-detail rows={[
      ['Person', displayName(r)],
      ['Title', r.title],
      ['Company', r.company && <span className="ui-detail-list__actions"><span>{r.company}</span><button type="button" className="ui-link" onClick={() => onOpenCompany(r)}>Open company →</button></span>],
      ['Last activity', r.last_activity_kind && [KIND[r.last_activity_kind][0], r.insight, fullWhen(r.last_activity_at)].filter(Boolean).join(' · ')],
      ['Sequence', r.sequence && `${r.sequence.name || 'Sequence'}${r.step != null ? ` · step ${r.step}` : ''}`],
      ['Flag', r.flag && `Flagged to ${r.flag.owner_name || 'a teammate'}`],
    ]} />
  );

  const compactRow = r => (
    <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 }}>{nameCell(r)}<span style={{ fontSize: 12, color: SA.muted, whiteSpace: 'nowrap' }}>{r.status_label}</span></span>
      <span style={{ fontSize: 12, color: SA.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[r.company, r.title].filter(Boolean).join(' · ')}</span>
      <span style={{ fontSize: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{activityCell(r)}{r.sequence && <span style={{ color: SA.muted }}>{r.sequence.name || 'Sequence'}{r.step != null ? ` · step ${r.step}` : ''}</span>}<span style={{ color: SA.muted }}>heat {r.heat_7d}</span>{ownerCell(r)}{r.flag && flagCell(r)}</span>
      {canEdit && <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{actionsCell(r)}</span>}
    </div>
  );

  // R4: labelled dropdowns that show their value; an active company filter is the accent-outlined chip; Clear is a
  // text button (only while a filter is on); Show closed is a toggle chip. R7: the row carries its label.
  const filterControls = (
    <>
      <span className="ui-group-label" aria-hidden="true">Filter</span>
      <FilterSelect label="Owner" value={filters.owner} options={OWNER_OPTIONS.map(([value, label]) => ({ value, label }))} onChange={v => set('owner', v)} />
      <FilterSelect label="Sequence" value={filters.sequence} options={opts('All sequences', (data?.sequences || []).map(s => [s.id, s.name || s.id]))} onChange={v => set('sequence', v)} />
      <FilterSelect label="Last activity" value={filters.activity} options={opts('Any activity', ACTIVITY_OPTIONS)} onChange={v => set('activity', v)} />
      <FilterSelect label="Status" value={filters.status} options={opts('All statuses', STATUS_OPTIONS)} onChange={v => set('status', v)} />
      <input type="search" className="ui-input ui-input--sm" aria-label="Search people" placeholder="Search" value={filters.q} onChange={e => set('q', e.target.value)} style={{ width: 160 }} />
      {filters.company && <ActiveFilterChip onRemove={clearCompany}>Company: {filters.company.name || filters.company.type}</ActiveFilterChip>}
      {nFilters > 0 && <Button variant="tertiary" onClick={clearAll}>Clear ({nFilters})</Button>}
      <ToggleChip pressed={showClosed} count={data ? `(${view.closed})` : ''} onClick={() => setShowClosed(s => !s)} title="Booked, Not now, Not a fit, unsubscribed and snoozed people">Show closed</ToggleChip>
    </>
  );
  const overlayRoot = document.getElementById(SA_THEME_ROOT_ID) || document.body;

  return (
    <section aria-label="Pipeline people" data-pipeline-people style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      {phone ? (
        <div data-filter-row style={rowBar}>
          <Button aria-expanded={sheetOpen} onClick={() => setSheetOpen(true)}>Filters{nFilters ? ` (${nFilters})` : ''}</Button>
          <span style={{ fontSize: 13, color: SA.muted, ...numStyle }}>{data ? `${view.rows.length} shown` : ''}</span>
        </div>
      ) : (
        <div role="group" aria-label="Filters" data-filter-row style={rowBar}>{filterControls}</div>
      )}
      {error && <ErrorNote message={error} />}
      {data && (
        <div className="ui-theme-dark">
          <DataTable label="Pipeline people" columns={columns} groups={groups} rowKey={rowKey} rowStyle={rowStyle} sort={sort} onSort={onSort}
            dense pinUnder="[data-workspace-header]" compact={phone} renderCompact={compactRow} renderDetail={renderDetail} emptyText="No people match these filters." />
        </div>
      )}
      {data && view.rows.length > 0 && <span style={{ fontSize: 12, color: SA.faint }}>Times are Pacific · a reply's time is when the sync first saw it (Apollo gives no reply time).</span>}
      {sheetOpen && createPortal(
        <div className="no-print" style={{ position: 'fixed', inset: 0, zIndex: 4003 }}>
          <div onClick={() => setSheetOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
          <div role="dialog" aria-label="Filters" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '80vh', overflowY: 'auto', background: SA.surface, borderTop: `1px solid ${SA.border}`, borderRadius: '14px 14px 0 0', padding: 16, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {filterControls}
            <button type="button" className="ui-btn ui-btn--secondary" style={{ width: '100%' }} onClick={() => setSheetOpen(false)}>Show {view.rows.length}</button>
          </div>
        </div>, overlayRoot)}
    </section>
  );
}

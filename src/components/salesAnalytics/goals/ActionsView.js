import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SA, SA_THEME_ROOT_ID } from '../theme';
import useMediaQuery from '../../../utils/useMediaQuery';
import DataTable from '../../../ui/DataTable';
import FilterSelect from '../../../ui/FilterSelect';
import Segmented from '../../../ui/Segmented';
import Button from '../../../ui/Button';
import Tag from '../../../ui/Tag';
import { priorityColor } from '../palette';
import PeopleCompanyPanel from '../PeopleCompanyPanel';
import { goalsApi, TODOS_CHANGED } from './goalsApi';
import { completeFlag, announceFlagsChanged, FLAGS_CHANGED } from '../huddleApi';
import { numStyle, ErrorNote } from './goalsUi';
import { KIND_LABEL, KIND_OPTIONS, EMPTY_FILTERS, activeFilterCount, actionsView, priorityText, dueText, readSort, writeSort, SNOOZE_OPTIONS, snoozeTo } from './actionsModel';

// sales-ia-v2 A1 - Actions: one ranked list (GET goals/actions) on the kit
// table. Every kind keeps the write it already had (signals, Tidy, waiting-on,
// to-dos, flags, Focus 5); finishing removes the row at once and offers Undo
// for 10 s. FIX actions-done-button-v1: Done on a signal / to-do-making Tidy
// row = Accept with { done: true } (the to-do is born done; a partner gets one
// email touch) - Undo hands the touch id back so the touch comes off first. Undo reverses the write (the signal / suggestion undo routes, a
// PATCH back, deleting the nudge to-do); Mark contacted is the one deferred
// write - the flag closes when the window ends, so Undo only keeps the row.
// Company opens the P4 company window. Viewers get the Team list, read-only.
const UNDO_MS = 10000; // REVISABLE (spec)
const ROW_BAR_HEIGHT = 36;
const rowBar = { height: ROW_BAR_HEIGHT, display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', overflowY: 'hidden', flexWrap: 'nowrap', minWidth: 0 };
// A row's Snooze… / Reassign… are selects acting as small menus: the kit filter-select edge at the dense row's 24 px.
const rowSelect = { height: 24, fontSize: 12, borderRadius: 6, padding: '0 4px' };
const WHO = [{ id: 'mine', label: 'Mine' }, { id: 'team', label: 'Team' }];
const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' };
const Dim = () => <span className="ui-table__dim">—</span>;
const rowKey = it => it.key;

export default function ActionsView({ businessId, canEdit, meId, members, lookup, onPlan, onOpenFull }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState(() => ({ ...EMPTY_FILTERS, who: canEdit ? 'mine' : 'team' }));
  const [sort, setSort] = useState(readSort);
  const [showDone, setShowDone] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState(null); // { text, undo?, busy?, error? }
  const [company, setCompany] = useState(null); // { company, link } for the company window
  const toastTimer = useRef(null);
  const toastExpire = useRef(null); // the deferred write (Mark contacted); runs early on unmount
  const phone = useMediaQuery('(max-width: 760px)');

  const load = useCallback(() => goalsApi.actions(businessId).then(d => { setData(d); setError(''); }).catch(e => setError(e.message)), [businessId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener(TODOS_CHANGED, load);
    window.addEventListener(FLAGS_CHANGED, load);
    return () => { window.removeEventListener(TODOS_CHANGED, load); window.removeEventListener(FLAGS_CHANGED, load); };
  }, [load]);
  // The deferred write runs early when the list unmounts (another tab, another
  // workspace) and when the page itself goes away (pagehide covers close,
  // reload and bfcache); the write is keepalive so unload can't cancel it.
  useEffect(() => {
    const flush = () => { const f = toastExpire.current; toastExpire.current = null; f?.({ unloading: true }); };
    window.addEventListener('pagehide', flush);
    return () => { clearTimeout(toastTimer.current); window.removeEventListener('pagehide', flush); flush(); };
  }, []);

  const expireToast = () => { setToast(null); const f = toastExpire.current; toastExpire.current = null; f?.(); };
  const showToast = (text, undoFn, onExpire = null) => {
    clearTimeout(toastTimer.current);
    toastExpire.current?.();
    toastExpire.current = onExpire;
    setToast({ text, undo: undoFn });
    toastTimer.current = setTimeout(expireToast, UNDO_MS);
  };
  const undo = async () => {
    if (!toast?.undo) return;
    clearTimeout(toastTimer.current);
    const t = toast;
    setToast({ ...t, busy: true });
    try { await t.undo(); toastExpire.current = null; setToast(null); load(); }
    catch (e) { setToast({ ...t, error: e.message }); toastTimer.current = setTimeout(expireToast, UNDO_MS); }
  };
  const panelToast = useCallback(t => showToast(t.text, t.undo), []); // eslint-disable-line react-hooks/exhaustive-deps
  const closeCompany = useCallback(() => setCompany(null), []);

  const remove = it => setData(d => (d ? { ...d, items: d.items.filter(x => x.key !== it.key) } : d));
  // The row leaves at once; the write runs; Undo reverses it (then reloads).
  const finish = async (it, write, label, undoWrite) => {
    remove(it);
    try {
      const r = await write();
      showToast(typeof label === 'function' ? label(r) : label, undoWrite ? () => undoWrite(r) : null);
    } catch (e) { setError(e.message); load(); }
  };
  // A change that keeps the row (snooze, reassign, nudge): the write, then Undo.
  const change = async (write, label, undoWrite) => {
    try { const r = await write(); showToast(typeof label === 'function' ? label(r) : label, () => undoWrite(r)); }
    catch (e) { setError(e.message); }
  };
  const patch = (id, body) => goalsApi.updateWeekGoal(businessId, id, body);
  const today = data?.today;
  const acts = {
    signal: it => <>
      <Button size="sm" title="Accept: one to-do (due Friday) and a target / note on the matched record" onClick={() => finish(it, () => goalsApi.acceptSignal(businessId, it.id), r => `Accepted · to-do added: ${r.todo.text}`, () => goalsApi.undoSignal(businessId, it.id))}>Accept</Button>
      <Button size="sm" title="Already did it — logs it as done (Undo for 10 s)" onClick={() => finish(it, () => goalsApi.acceptSignal(businessId, it.id, { done: true }), r => `Done: ${r.todo.text}`, r => goalsApi.undoSignal(businessId, it.id, r.touch_event_id))}>Done</Button>
      <Button size="sm" title="Dismiss for 7 days" onClick={() => finish(it, () => goalsApi.dismissSignal(businessId, it.id), `Dismissed ${it.company?.name || 'the signal'} for 7 days`, () => goalsApi.undoSignal(businessId, it.id))}>Dismiss</Button>
    </>,
    tidy: it => <>
      <Button size="sm" title="Accept: one to-do" onClick={() => finish(it, () => goalsApi.acceptSuggestion(businessId, it.id), r => (r.todo ? `Accepted · to-do added: ${r.todo.text}` : 'Accepted'), r => goalsApi.undoSuggestion(businessId, it.id, r.todo?.id))}>Accept</Button>
      {it.meta.makes_todo && <Button size="sm" title="Already did it — logs it as done (Undo for 10 s)" onClick={() => finish(it, () => goalsApi.acceptSuggestion(businessId, it.id, { done: true }), r => `Done: ${r.todo.text}`, r => goalsApi.undoSuggestion(businessId, it.id, r.todo.id, r.touch_event_id))}>Done</Button>}
      <Button size="sm" title="Dismiss for 7 days" onClick={() => finish(it, () => goalsApi.dismissSuggestion(businessId, it.id), 'Dismissed for 7 days', () => goalsApi.undoSuggestion(businessId, it.id))}>Dismiss</Button>
      <Button size="sm" title="Snooze 7 days" onClick={() => finish(it, () => goalsApi.snoozeSuggestion(businessId, it.id), 'Snoozed 7 days', () => goalsApi.undoSuggestion(businessId, it.id))}>Snooze</Button>
    </>,
    waiting: it => <>
      <Button size="sm" title="Got it: they delivered" onClick={() => finish(it, () => patch(it.id, { status: 'done' }), `Got it: ${it.text}`, () => patch(it.id, { status: 'open' }))}>Got it</Button>
      <Button size="sm" title="Nudge: a to-do for you, due today" onClick={() => change(() => goalsApi.nudgeWaiting(businessId, it.id), r => `Nudge to-do added, due today: ${r.text}`, r => goalsApi.deleteWeekGoal(businessId, r.id))}>Nudge</Button>
    </>,
    todo: it => <>
      <Button size="sm" title="Done (Undo for 10 s)" onClick={() => finish(it, () => patch(it.id, { status: 'done' }), `Done: ${it.text}`, () => patch(it.id, { status: 'open' }))}>Done</Button>
      <select className="ui-filter__select" aria-label={`Snooze ${it.text}`} value="" title="New due date" onChange={e => { const d = e.target.value; if (d) change(() => patch(it.id, { due_date: snoozeTo(today, d) }), `Snoozed to ${dueText({ due_date: snoozeTo(today, d) }, today)}`, () => patch(it.id, { due_date: it.due_date })); }} style={{ ...rowSelect, width: 74 }}>
        <option value="">Snooze…</option>
        {SNOOZE_OPTIONS.map(([d, lb]) => <option key={d} value={d}>{lb}</option>)}
      </select>
      <select className="ui-filter__select" aria-label={`Reassign ${it.text}`} value="" title="New owner" onChange={e => { const u = e.target.value; if (u) change(() => patch(it.id, { owner_user_id: u }), `Reassigned to ${lookup(u).first}`, () => patch(it.id, { owner_user_id: it.owner_user_id })); }} style={{ ...rowSelect, width: 84 }}>
        <option value="">Reassign…</option>
        {members.filter(m => m.user_id !== it.owner_user_id).map(m => <option key={m.user_id} value={m.user_id}>{lookup(m.user_id).first}</option>)}
      </select>
    </>,
    flag: it => <Button size="sm" title="Mark contacted: closes the flag when the Undo window ends" onClick={() => {
      remove(it);
      showToast(`${it.meta.contact || 'Prospect'} marked contacted · flag closes in 10 s`, () => load(), ({ unloading = false } = {}) => completeFlag(businessId, it.id, { keepalive: true }).then(() => { if (!unloading) { announceFlagsChanged(); load(); } }).catch(e => { if (!unloading) { setError(e.message); load(); } }));
    }}>Mark contacted</Button>,
    focus: it => (it.status === 'done'
      ? <Button size="sm" onClick={() => change(() => patch(it.id, { status: 'open' }), `Reopened: ${it.text}`, () => patch(it.id, { status: 'done' }))}>Reopen</Button>
      : <Button size="sm" title="Done (Undo for 10 s)" onClick={() => change(() => patch(it.id, { status: 'done' }), `Done: ${it.text}`, () => patch(it.id, { status: 'open' }))}>Done</Button>),
  };

  const items = useMemo(() => data?.items || [], [data]);
  const view = useMemo(() => actionsView(items, filters, { meId, viewer: !canEdit }), [items, filters, meId, canEdit]);
  const set = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  const nFilters = activeFilterCount(filters);
  const onSort = s => { setSort(s); writeSort(s); };

  // R5: priority is a status chip - overdue red, P1-P4 each their own hue (FIX priority-colors-v1); the word is always on it.
  const priorityCell = it => <Tag color={it.overdue ? SA.bad : priorityColor(it.priority) || SA.borderStrong}><span style={numStyle}>{priorityText(it)}</span></Tag>;
  const companyCell = it => (!it.company ? <Dim />
    : it.company.type ? <button type="button" className="ui-link ui-link--cell" title={`Open ${it.company.name}`} onClick={() => setCompany({ company: it.company.name, link: { type: it.company.type, id: it.company.id } })}>{it.company.name}</button>
      : <span style={ellipsis} title={`${it.company.name} is not in the Pipeline yet`}>{it.company.name}</span>);
  const ownerCell = it => (it.owner_user_id
    ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}><span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: lookup(it.owner_user_id).color, flex: 'none' }} />{lookup(it.owner_user_id).first}</span>
    : <span style={{ color: SA.muted }}>Team</span>);
  const actionsCell = it => <span role="group" aria-label={`Actions for ${it.text}`} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap' }}>{acts[it.kind](it)}</span>;

  const columns = [
    { id: 'priority', label: 'Priority', width: 124, sticky: true, sortValue: it => (it.overdue ? -it.late_days : it.priority), render: priorityCell, title: it => (it.overdue ? `${it.late_days} days late` : `P${it.priority}`) },
    { id: 'text', label: 'What to do', width: 200, sortValue: it => it.text, render: it => <span style={{ ...ellipsis, fontWeight: 500, color: it.status === 'done' ? SA.muted : SA.text }}>{it.text}</span>, title: it => it.text },
    { id: 'company', label: 'Company', width: 150, sortValue: it => it.company?.name || null, render: companyCell, title: it => it.company?.name },
    { id: 'why', label: 'Why', width: 162, sortValue: it => it.why, render: it => (it.why ? <span style={{ ...ellipsis, color: SA.soft }}>{it.why}</span> : <Dim />), title: it => it.why },
    { id: 'kind', label: 'Kind', width: 72, sortValue: it => KIND_LABEL[it.kind], render: it => <span style={{ whiteSpace: 'nowrap' }}>{KIND_LABEL[it.kind]}</span> },
    { id: 'due', label: 'Due', width: 72, sortValue: it => it.due_date, render: it => <span style={{ ...numStyle, color: it.overdue ? SA.bad : it.due_date ? SA.text : SA.faint, whiteSpace: 'nowrap' }}>{dueText(it, today)}</span> },
    { id: 'owner', label: 'Owner', width: 84, sortValue: it => (it.owner_user_id ? lookup(it.owner_user_id).first : null), render: ownerCell },
    // Widths add up to 1134 so the Member table fits a 1440 window without a sideways scroll (Priority and Actions pin either way);
    // Priority is 124 so "Overdue · 12 d" never clips.
    ...(canEdit ? [{ id: 'actions', label: 'Actions', width: 270, stickyEnd: true, render: actionsCell }] : []),
  ];
  const sortLabel = sort && columns.find(c => c.id === sort.id)?.label;
  const groups = [
    { id: 'open', header: <>{sort ? `Sorted by ${sortLabel}` : 'Overdue first, then P1 → P4, then due'} <span className="ui-table__count">{view.open.length}</span></>, rows: view.open, emptyText: canEdit ? 'Nothing to act on - accept a signal, plan the week or open Pipeline.' : 'Nothing open for the team.' },
    ...(view.done.length ? [{ id: 'done', header: <>{view.done.length} done {showDone ? '▾' : '▸'}</>, rows: view.done, collapsed: !showDone, onToggle: () => setShowDone(o => !o) }] : []),
  ];
  const rowStyle = it => (it.status === 'done' ? { '--ui-row-tint': `color-mix(in srgb, ${SA.track} 40%, transparent)` } : it.overdue ? { '--ui-row-bar': SA.bad } : it.priority === 1 ? { '--ui-row-bar': priorityColor(1) } : undefined);

  const compactRow = it => (
    <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 }}>{priorityCell(it)}<span style={{ ...ellipsis, fontWeight: 500 }}>{it.text}</span></span>
      <span style={{ fontSize: 12, color: SA.muted, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{KIND_LABEL[it.kind]}{it.company && <>· {companyCell(it)}</>}· {dueText(it, today)} · {ownerCell(it)}</span>
      {it.why && <span style={{ fontSize: 12, color: SA.soft, ...ellipsis }}>{it.why}</span>}
      {canEdit && <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{actionsCell(it)}</span>}
    </div>
  );

  // R2 Mine | Team is the whose-list switch (segmented); R4 Kind is a labelled dropdown; Clear is a text button
  // (only while a filter is on); R7: labels on the row.
  const filterControls = (
    <>
      {canEdit && <span className="ui-group-label" aria-hidden="true">Who</span>}
      {canEdit && <Segmented label="Who" items={WHO} value={filters.who} onChange={v => set('who', v)} />}
      <FilterSelect label="Kind" value={filters.kind} options={[{ value: '', label: 'All kinds' }, ...KIND_OPTIONS.filter(([id]) => canEdit || ['todo', 'focus', 'flag'].includes(id)).map(([value, label]) => ({ value, label }))]} onChange={v => set('kind', v)} />
      <input type="search" className="ui-input ui-input--sm" aria-label="Search actions" placeholder="Search" value={filters.q} onChange={e => set('q', e.target.value)} style={{ width: 160 }} />
      {nFilters > 0 && <Button variant="tertiary" onClick={() => setFilters(f => ({ ...EMPTY_FILTERS, who: f.who }))}>Clear ({nFilters})</Button>}
      {canEdit && onPlan && !items.some(it => it.kind === 'focus') && <Button onClick={onPlan}>Plan this week</Button>}
    </>
  );
  const overlayRoot = document.getElementById(SA_THEME_ROOT_ID) || document.body;

  return (
    <section aria-label="Actions" data-actions style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      {phone ? (
        <div data-filter-row style={rowBar}>
          <Button aria-expanded={sheetOpen} onClick={() => setSheetOpen(true)}>Filters{nFilters ? ` (${nFilters})` : ''}</Button>
          <span style={{ fontSize: 13, color: SA.muted, ...numStyle }}>{data ? `${view.open.length} open` : ''}</span>
        </div>
      ) : (
        <div role="group" aria-label="Filters" data-filter-row style={rowBar}>{filterControls}</div>
      )}
      {error && <ErrorNote message={error} />}
      {!data && !error && <span style={{ fontSize: 13, color: SA.muted }}>Loading…</span>}
      {data && (
        <div className="ui-theme-dark">
          <DataTable label="Actions" columns={columns} groups={groups} rowKey={rowKey} rowStyle={rowStyle} sort={sort} onSort={onSort}
            dense pinUnder="[data-workspace-header]" compact={phone} renderCompact={compactRow} emptyText="Nothing to act on." />
        </div>
      )}
      {company && (
        <PeopleCompanyPanel businessId={businessId} person={company} canEdit={canEdit} members={members} meId={meId} onToast={panelToast} onClose={closeCompany} onOpenFull={row => { setCompany(null); onOpenFull(row); }} />
      )}
      {sheetOpen && createPortal(
        <div className="no-print" style={{ position: 'fixed', inset: 0, zIndex: 4003 }}>
          <div onClick={() => setSheetOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
          <div role="dialog" aria-label="Filters" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '80vh', overflowY: 'auto', background: SA.surface, borderTop: `1px solid ${SA.border}`, borderRadius: '14px 14px 0 0', padding: 16, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {filterControls}
            <button type="button" className="ui-btn ui-btn--secondary" style={{ width: '100%' }} onClick={() => setSheetOpen(false)}>Show {view.open.length}</button>
          </div>
        </div>, overlayRoot)}
      {toast && createPortal(
        <div role="status" className="no-print" style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 4005, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderRadius: 10, background: SA.surface2, border: `1px solid ${SA.border}`, color: SA.text, fontSize: 14, maxWidth: 'min(640px, 92vw)' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{toast.error ? `Undo failed: ${toast.error}` : toast.text}</span>
          {!toast.error && toast.undo && <Button size="sm" onClick={undo} disabled={toast.busy} style={{ height: 28 }}>{toast.busy ? 'Undoing…' : 'Undo'}</Button>}
        </div>, overlayRoot)}
    </section>
  );
}

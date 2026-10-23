import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SA, SA_THEME_ROOT_ID } from '../theme';
import useMediaQuery from '../../../utils/useMediaQuery';
import DataTable from '../../../ui/DataTable';
import DetailList from '../../../ui/DetailList';
import FilterSelect from '../../../ui/FilterSelect';
import Button from '../../../ui/Button';
import Tag from '../../../ui/Tag';
import { priorityColor } from '../palette';
import PeopleCompanyPanel from '../PeopleCompanyPanel';
import { goalsApi, TODOS_CHANGED } from './goalsApi';
import { completeFlag, announceFlagsChanged, reassignFlag, FLAGS_CHANGED } from '../huddleApi';
import { numStyle, ErrorNote } from './goalsUi';
import { KIND_LABEL, KIND_OPTIONS, EMPTY_FILTERS, activeFilterCount, actionsView, priorityText, dueText, readSort, writeSort, readFolded, writeFolded, actionSource, companyLine, datesLine, campaignLine } from './actionsModel';
import { contactSlots, PromoteDialog } from './campaigns/ContactActions';
import { Slots, OwnerSelect, SLOT_W } from './ActionSlots';
import { clipboardText, LINK_LABEL } from './campaigns/campaignModel';

// sales-ia-v2 A1 - Actions: one list (GET goals/actions) on the kit table.
// actions-v2 REV2: whose list = the frame's one Who control (owner prop: a
// member's user id or 'team') plus the Unassigned (n) chip; the rows sit in
// the server's bands (Now / Today / This week / Housekeeping - folded, and the
// folds remembered); every row has the same three action slots (ActionSlots:
// Primary · Done or Due · More ▾) and Members adjust it in place - the owner
// on every kind (a signal / Tidy row = Accept on that person's behalf, a flag
// = the flag reassign, waiting rows have none: they owe us), the due date,
// and the text in the row detail. Every kind keeps the write it already had;
// finishing removes the row at once and offers Undo for 10 s (FIX
// actions-done-button-v1: Done on a signal / to-do-making Tidy row = Accept
// with { done: true }; Undo hands the touch id back). Mark contacted is the
// one deferred write - the flag closes when the window ends. Viewers get the
// to-dos, Focus 5 and flags, read-only.
const UNDO_MS = 10000; // REVISABLE (spec)
const ROW_BAR_HEIGHT = 36;
const rowBar = { height: ROW_BAR_HEIGHT, display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', overflowY: 'hidden', flexWrap: 'nowrap', minWidth: 0 };
const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' };
const Dim = () => <span className="ui-table__dim">—</span>;
const rowKey = it => it.key;

export default function ActionsView({ businessId, canEdit, meId, owner = 'team', members, lookup, onOpenFull }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [folded, setFolded] = useState(readFolded);
  const [promoting, setPromoting] = useState(null); // a campaign reply row whose Promote dialog is open
  const [editing, setEditing] = useState(null); // { key, text } - the row detail's text being edited
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
  // seif-campaign-v1 B4/B5: every campaign write but Promote has the server's Undo (the caller's own latest change).
  const CAMPAIGN_DONE = { sent: 'sent', skip: 'skipped', stop: 'stopped', replied: 'reply logged', pause: 'taken off the schedule', resume: 'back on the schedule' };
  const campaignAct = (it, action, body) => finish(it, () => goalsApi.contactAction(businessId, it.id, action, body),
    r => (action === 'promote' ? `${r.record.name} ${r.created ? 'added to Pipeline' : 'linked'} as ${LINK_LABEL[r.record.type].toLowerCase()}`
      : action === 'status' ? `${it.meta.name}: ${body.status.replace('_', ' ')}` : `${it.meta.name}: step ${it.meta.step_no} ${CAMPAIGN_DONE[action]}`),
    action === 'promote' ? null : r => goalsApi.contactAction(businessId, it.id, 'undo', { event_id: r.event.id }));
  const copyDraft = async it => {
    try {
      const d = await goalsApi.contactDraft(businessId, it.id);
      await navigator.clipboard.writeText(clipboardText(d));
      showToast(`Step ${d.step_no} email for ${it.meta.name} copied - paste it into your mailbox`);
    } catch (e) { setError(`Couldn't copy the email: ${e.message}`); }
  };
  const accept = (it, ownerId) => (it.kind === 'signal' ? goalsApi.acceptSignal(businessId, it.id, { ownerUserId: ownerId }) : goalsApi.acceptSuggestion(businessId, it.id, { ownerUserId: ownerId }));
  const undoAccept = (it, r) => (it.kind === 'signal' ? goalsApi.undoSignal(businessId, it.id, r?.touch_event_id) : goalsApi.undoSuggestion(businessId, it.id, r?.todo?.id, r?.touch_event_id));
  const setDue = (it, d) => change(() => patch(it.id, { due_date: d }), d ? `Due ${dueText({ due_date: d }, today)}: ${it.text}` : `No due date: ${it.text}`, () => patch(it.id, { due_date: it.due_date }));
  const due = it => ({ due: { value: it.due_date, onPick: d => setDue(it, d) } });
  const markContacted = it => {
    remove(it);
    showToast(`${it.meta.contact || 'Prospect'} marked contacted · flag closes in 10 s`, () => load(), ({ unloading = false } = {}) => completeFlag(businessId, it.id, { keepalive: true }).then(() => { if (!unloading) { announceFlagsChanged(); load(); } }).catch(e => { if (!unloading) { setError(e.message); load(); } }));
  };
  const done = it => ({ label: 'Done', title: 'Done (Undo for 10 s)', run: () => finish(it, () => patch(it.id, { status: 'done' }), `Done: ${it.text}`, () => patch(it.id, { status: 'open' })) });
  // A3 - per kind: the primary, the second slot (Done or the due date) and everything else in More.
  const slotsFor = {
    signal: it => ({
      primary: { label: 'Accept', title: 'Accept: one to-do (due Friday) and a target / note on the matched record', run: () => finish(it, () => accept(it), r => `Accepted · to-do added: ${r.todo.text}`, r => undoAccept(it, { todo: r.todo })) },
      second: { label: 'Done', title: 'Already did it — logs it as done (Undo for 10 s)', run: () => finish(it, () => goalsApi.acceptSignal(businessId, it.id, { done: true }), r => `Done: ${r.todo.text}`, r => goalsApi.undoSignal(businessId, it.id, r.touch_event_id)) },
      more: [{ id: 'dismiss', label: 'Dismiss for 7 days', run: () => finish(it, () => goalsApi.dismissSignal(businessId, it.id), `Dismissed ${it.company?.name || 'the signal'} for 7 days`, () => goalsApi.undoSignal(businessId, it.id)) }],
    }),
    tidy: it => ({
      primary: { label: 'Accept', title: it.meta.makes_todo ? 'Accept: one to-do' : 'Accept', run: () => finish(it, () => accept(it), r => (r.todo ? `Accepted · to-do added: ${r.todo.text}` : 'Accepted'), r => undoAccept(it, r)) },
      second: it.meta.makes_todo ? { label: 'Done', title: 'Already did it — logs it as done (Undo for 10 s)', run: () => finish(it, () => goalsApi.acceptSuggestion(businessId, it.id, { done: true }), r => `Done: ${r.todo.text}`, r => goalsApi.undoSuggestion(businessId, it.id, r.todo.id, r.touch_event_id)) } : null,
      more: [
        { id: 'dismiss', label: 'Dismiss for 7 days', run: () => finish(it, () => goalsApi.dismissSuggestion(businessId, it.id), 'Dismissed for 7 days', () => goalsApi.undoSuggestion(businessId, it.id)) },
        { id: 'snooze', label: 'Snooze 7 days', run: () => finish(it, () => goalsApi.snoozeSuggestion(businessId, it.id), 'Snoozed 7 days', () => goalsApi.undoSuggestion(businessId, it.id)) },
      ],
    }),
    waiting: it => ({
      primary: { label: 'Got it', title: 'Got it: they delivered', run: () => finish(it, () => patch(it.id, { status: 'done' }), `Got it: ${it.text}`, () => patch(it.id, { status: 'open' })) },
      second: due(it),
      more: [{ id: 'nudge', label: 'Nudge (a to-do for you, due today)', run: () => change(() => goalsApi.nudgeWaiting(businessId, it.id), r => `Nudge to-do added, due today: ${r.text}`, r => goalsApi.deleteWeekGoal(businessId, r.id)) }],
    }),
    todo: it => ({ primary: done(it), second: due(it), more: [] }),
    flag: it => ({ primary: { label: 'Contacted', title: 'Mark contacted: closes the flag when the Undo window ends', run: () => markContacted(it) }, second: null, more: [] }),
    campaign: it => contactSlots({
      contact: { id: it.id, name: it.meta.name, company: it.meta.company_name, segment: it.meta.segment, status: it.meta.action === 'reply' ? 'replied' : 'active', current_step: it.meta.step_no, track_id: true },
      onAct: (action, body) => campaignAct(it, action, body), onCopy: () => copyDraft(it),
      onRespond: () => (it.company?.type ? openCompany(it) : setError(`${it.meta.company_name || it.meta.name} isn't in the Pipeline yet - Promote it from More`)),
      onPromote: () => setPromoting(it),
    }),
    focus: it => (it.status === 'done'
      ? { primary: { label: 'Reopen', run: () => change(() => patch(it.id, { status: 'open' }), `Reopened: ${it.text}`, () => patch(it.id, { status: 'done' })) }, second: null, more: [] }
      : { primary: { label: 'Done', title: 'Done (Undo for 10 s)', run: () => change(() => patch(it.id, { status: 'done' }), `Done: ${it.text}`, () => patch(it.id, { status: 'open' })) }, second: null, more: [] }),
  };

  // A4 - the owner, changed in place. To-do: PATCH (Unassigned = nobody); signal / to-do-making Tidy: Accept on that
  // person's behalf (the row becomes their to-do); flag: the flag reassign (one open flag per prospect).
  const actors = members.filter(m => m.role !== 'viewer');
  const pickOwner = (it, u) => {
    const who = u ? lookup(u).first : 'nobody';
    if (it.kind === 'todo') return change(() => patch(it.id, { owner_user_id: u }), `${it.text}: owner ${who}`, () => patch(it.id, { owner_user_id: it.owner_user_id }));
    if (it.kind === 'flag') return change(() => reassignFlag(businessId, it.id, u), `Flag handed to ${who}`, () => reassignFlag(businessId, it.id, it.owner_user_id));
    return finish(it, () => accept(it, u), r => `Accepted for ${who}${r.todo ? ` · to-do added: ${r.todo.text}` : ''}`, r => undoAccept(it, r));
  };
  const ownerOptions = it => [
    ...(it.kind === 'todo' || !it.owner_user_id ? [{ value: '', label: it.kind === 'todo' ? 'Unassigned' : 'Nobody yet' }] : []),
    ...actors.map(m => ({ value: m.user_id, label: lookup(m.user_id).first })),
  ];
  const ownerEditable = it => canEdit && (it.kind === 'todo' || it.kind === 'flag' || it.kind === 'signal' || (it.kind === 'tidy' && it.meta.makes_todo));

  const items = useMemo(() => data?.items || [], [data]);
  const view = useMemo(() => actionsView(items, filters, { owner, viewer: !canEdit }), [items, filters, owner, canEdit]);
  const set = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  const nFilters = activeFilterCount(filters);
  const onSort = s => { setSort(s); writeSort(s); };

  // R5: priority is a status chip - overdue red, P1-P4 each their own hue (FIX priority-colors-v1); the word is always on it.
  const priorityCell = it => <Tag color={it.overdue ? SA.bad : priorityColor(it.priority) || SA.borderStrong}><span style={numStyle}>{priorityText(it)}</span></Tag>;
  const openCompany = it => setCompany({ company: it.company.name, link: { type: it.company.type, id: it.company.id } });
  const companyCell = it => (!it.company ? <Dim />
    : it.company.type ? <button type="button" className="ui-link ui-link--cell" title={`Open ${it.company.name}`} onClick={() => openCompany(it)}>{it.company.name}</button>
      : <span style={ellipsis} title={`${it.company.name} is not in the Pipeline yet`}>{it.company.name}</span>);
  const ownerName = it => (it.owner_user_id
    ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}><span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: lookup(it.owner_user_id).color, flex: 'none' }} />{lookup(it.owner_user_id).first}</span>
    : <span style={{ color: SA.muted }}>{it.kind === 'waiting' ? '—' : 'Nobody'}</span>);
  const ownerCell = it => (ownerEditable(it)
    ? <OwnerSelect value={it.owner_user_id} options={ownerOptions(it)} label={`Owner of ${it.text}`} onPick={u => pickOwner(it, u)} />
    : ownerName(it));
  const actionsCell = it => <Slots it={it} slots={slotsFor[it.kind](it)} today={today} phone={phone} />;

  const columns = [
    { id: 'priority', label: 'Priority', width: 124, sticky: true, sortValue: it => (it.overdue ? -it.late_days : it.priority), render: priorityCell, title: it => (it.overdue ? `${it.late_days} days late` : `P${it.priority}`) },
    { id: 'text', label: 'What to do', width: 196, detail: true, sortValue: it => it.text, render: it => <span style={{ ...ellipsis, fontWeight: 500, color: it.status === 'done' ? SA.muted : SA.text }}>{it.text}</span>, title: it => it.text },
    { id: 'company', label: 'Company', width: 146, sortValue: it => it.company?.name || null, render: companyCell, title: it => it.company?.name },
    { id: 'why', label: 'Why', width: 152, sortValue: it => it.why, render: it => (it.why ? <span style={{ ...ellipsis, color: SA.soft }}>{it.why}</span> : <Dim />), title: it => it.why },
    { id: 'kind', label: 'Kind', width: 72, sortValue: it => KIND_LABEL[it.kind], render: it => <span style={{ whiteSpace: 'nowrap' }}>{KIND_LABEL[it.kind]}</span> },
    { id: 'due', label: 'Due', width: 72, sortValue: it => it.due_date, render: it => <span style={{ ...numStyle, color: it.overdue ? SA.bad : it.due_date ? SA.text : SA.faint, whiteSpace: 'nowrap' }}>{dueText(it, today)}</span> },
    { id: 'owner', label: 'Owner', width: 100, sortValue: it => (it.owner_user_id ? lookup(it.owner_user_id).first : null), render: ownerCell },
    // Widths add up to 1134 so the Member table fits a 1440 window without a sideways scroll (Priority and Actions pin either way);
    // Priority is 124 so "Overdue · 12 d" never clips; Actions = the three fixed slots (N2: they line up row to row).
    ...(canEdit ? [{ id: 'actions', label: 'Actions', width: SLOT_W.primary + SLOT_W.second + SLOT_W.more + 16, stickyEnd: true, render: actionsCell }] : []),
  ];
  const sortLabel = sort && columns.find(c => c.id === sort.id)?.label;
  const toggleBand = id => setFolded(f => { const next = f.includes(id) ? f.filter(x => x !== id) : [...f, id]; writeFolded(next); return next; });
  const groups = [
    ...view.bands.map(b => ({
      id: b.id, rows: b.rows, collapsed: folded.includes(b.id), onToggle: () => toggleBand(b.id),
      header: <>{b.label} <span className="ui-table__count">{b.rows.length}</span>{sort ? <span style={{ fontWeight: 400, color: SA.muted }}> · sorted by {sortLabel}</span> : null}</>,
      emptyText: b.id === 'now' ? 'Nothing urgent.' : 'Nothing here.',
    })),
    ...(view.done.length ? [{ id: 'done', header: <>{view.done.length} done {showDone ? '▾' : '▸'}</>, rows: view.done, collapsed: !showDone, onToggle: () => setShowDone(o => !o) }] : []),
  ];
  const rowStyle = it => (it.status === 'done' ? { '--ui-row-tint': `color-mix(in srgb, ${SA.track} 40%, transparent)` } : it.overdue ? { '--ui-row-bar': SA.bad } : it.priority === 1 ? { '--ui-row-bar': priorityColor(1) } : undefined);

  // A4 - the text, edited in the row detail: click it, Enter saves, Esc cancels; Undo puts it back.
  const rawText = it => (it.kind === 'waiting' ? it.meta.text ?? it.text : it.text);
  const saveText = async (it, text) => {
    setEditing(null);
    const t = text.trim(), before = rawText(it);
    if (!t || t === before) return;
    await change(() => patch(it.id, { text: t }), `Saved: ${t}`, () => patch(it.id, { text: before }));
    load();
  };
  const textEditor = it => (editing?.key === it.key
    ? <input autoFocus className="ui-input ui-input--sm" aria-label={`Edit ${it.text}`} value={editing.text} maxLength={500}
      onChange={e => setEditing({ key: it.key, text: e.target.value })} onBlur={() => setEditing(null)}
      onKeyDown={e => { if (e.key === 'Enter') saveText(it, editing.text); if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); } }} style={{ width: '100%' }} />
    : <button type="button" className="ui-link" aria-label={`Change the text: ${it.text}`} title="Click to edit" onClick={() => setEditing({ key: it.key, text: rawText(it) })} style={{ textAlign: 'left' }}>{it.text} <span style={{ color: SA.muted, fontSize: 12 }}>✎</span></button>);
  // FIX actions-row-detail-v1: the whole row - the actions stay in the row. Never an email or phone.
  const renderDetail = it => (
    <DetailList data-action-detail rows={[
      ['What to do', canEdit && ['todo', 'waiting'].includes(it.kind) ? textEditor(it) : it.text],
      ['Why', it.why || <span style={{ color: SA.muted }}>No reason given</span>],
      ['Where it came from', actionSource(it)],
      ['Campaign step', campaignLine(it)],
      ['Heads-up', it.kind === 'campaign' && it.meta.conflict],
      ['Company', it.company && <span className="ui-detail-list__actions"><span>{companyLine(it.company)}</span>
        {it.company.type && <button type="button" className="ui-link" onClick={() => openCompany(it)}>Open company →</button>}</span>],
      ['Dates', datesLine(it, it.owner_user_id ? lookup(it.owner_user_id).first : null)],
      ['Owner', canEdit && ownerEditable(it) && phone ? ownerCell(it) : null],
    ]} />
  );

  const compactRow = it => (
    <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 }}>{priorityCell(it)}<span style={{ ...ellipsis, fontWeight: 500 }}>{it.text}</span></span>
      <span style={{ fontSize: 12, color: SA.muted, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{KIND_LABEL[it.kind]}{it.company && <>· {companyCell(it)}</>}· {dueText(it, today)} · {ownerName(it)}</span>
      {it.why && <span style={{ fontSize: 12, color: SA.soft, ...ellipsis }}>{it.why}</span>}
      {canEdit && <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{actionsCell(it)}</span>}
    </div>
  );

  // A1/A5: whose list is the frame's Who control (Plan this week sits there too); this row keeps Kind (R4 labelled
  // dropdown), Search and the Unassigned (n) chip (a pressed toggle). Clear is a text button, only while a filter is on (R7: labels on the row).
  const filterControls = (
    <>
      <FilterSelect label="Kind" value={filters.kind} options={[{ value: '', label: 'All kinds' }, ...KIND_OPTIONS.filter(([id]) => canEdit || ['todo', 'focus', 'flag'].includes(id)).map(([value, label]) => ({ value, label }))]} onChange={v => set('kind', v)} />
      <input type="search" className="ui-input ui-input--sm" aria-label="Search actions" placeholder="Search" value={filters.q} onChange={e => set('q', e.target.value)} style={{ width: 160 }} />
      <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" aria-pressed={filters.unassigned} data-unassigned-chip onClick={() => set('unassigned', !filters.unassigned)}
        title="Rows nobody owns yet" style={{ height: 28, flex: 'none' }}>Unassigned <span style={numStyle}>({view.unassigned})</span></button>
      {nFilters > 0 && <Button variant="tertiary" onClick={() => setFilters(EMPTY_FILTERS)}>Clear ({nFilters})</Button>}
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
            dense pinUnder="[data-workspace-header]" compact={phone} renderCompact={compactRow} renderDetail={renderDetail} emptyText="Nothing to act on." />
        </div>
      )}
      {company && (
        <PeopleCompanyPanel businessId={businessId} person={company} canEdit={canEdit} members={members} meId={meId} onToast={panelToast} onClose={closeCompany} onOpenFull={row => { setCompany(null); onOpenFull(row); }} />
      )}
      {promoting && <PromoteDialog contact={{ id: promoting.id, name: promoting.meta.name, company: promoting.meta.company_name, segment: promoting.meta.segment }} members={members} lookup={lookup}
        onClose={() => setPromoting(null)} onPromote={async body => { const it = promoting; setPromoting(null); await campaignAct(it, 'promote', body); }} />}
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

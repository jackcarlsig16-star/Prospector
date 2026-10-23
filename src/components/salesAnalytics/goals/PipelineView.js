import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SA, SA_THEME_ROOT_ID } from '../theme';
import { goalsApi } from './goalsApi';
import { fetchOpportunities, createOpportunity, updateOpportunity, archiveOpportunity } from '../pipelineApi';
import OpportunityPanel from '../OpportunityPanel';
import CompanyPanel from './CompanyPanel';
import OwnerPill from '../OwnerPill';
import SheetUpdateDrawer from './SheetUpdateDrawer';
import SidePanel from '../SidePanel';
import VisitorReport from './VisitorReport';
import TypeChip, { typeSortValue } from './TypeChip';
import DataTable from '../../../ui/DataTable';
import EditableCell from '../../../ui/EditableCell';
import FilterSelect from '../../../ui/FilterSelect';
import Button from '../../../ui/Button';
import Tag from '../../../ui/Tag';
import { priorityColor } from '../palette';
import { ToggleChip } from '../../../ui/Chip';
import { KIT_EDITABLE } from '../../../ui/tokens';
import useMediaQuery from '../../../utils/useMediaQuery';
import { openTasks } from '../tasks/LinkedTasks';
import { laWeekStart } from '../periods';
import { FRAME_TOOLS_ID } from '../salesFrame';
import { numStyle, inputStyle, ErrorNote } from './goalsUi';
import { BOARD_COLORS, TOP_CAP } from '../../../constants/pipelineBoard';
import { OWNER_TEAMS, TEAM_LABEL } from '../../../constants/ownership';
import { TIERS } from '../../../constants/partnerPipeline';
import { CHANNEL_LABEL, PRIORITIES, PRIORITY_WORD } from '../../../constants/salesChannels';
import { NOT_A_FIT, priorityValue, priorityText, writePriority, undoValue } from './priorityActions';
import { PRIORITY_TYPES } from './companyPanelModel';
import {
  CHANNEL_BUTTONS, TYPE_OPTIONS, EMPTY_FILTERS, activeFilterCount, channelFromParam, companiesView, ownersOf, stagesOf,
  readHidden, writeHidden, readSort, writeSort, prioritySetLabel,
} from './companiesModel';

// sales-ia-v2 P1-P3 - Pipeline > Companies: every partner, employer and
// target (plus Apollo-only companies, website visitors and Scout signals
// under their channel buttons) on one table. Rows come from GET
// goals/pipeline-board; the UI filters, sorts and maps a color key to a token.
// N2: the channel row and the filter row have fixed heights and scroll
// sideways instead of wrapping; notices and the column chooser float over
// the page; the screen's buttons sit in the frame row (#sales-frame-tools).
// Unsorted, rows keep the color bands (Top first); a header sort shows one
// sorted list. Any row but a Scout signal opens CompanyPanel (P4: the same
// side panel + action bar for partner / employer / target / Apollo-only /
// visitor); "Open full card" from there goes to the record's own screen.
// Priority is a dropdown with "Not a fit" and a 10 s Undo (every priority
// and stage change, hide and remove gets one).
export const BOARD_TOKENS = { green: SA.good, yellow: SA.warn, blue: SA.link, gray: SA.muted, light: SA.faint, faded: SA.track };
export const ROW_BAR_HEIGHT = 36;
const TIER_RANK = { active: 0, 1: 1, 2: 2, 3: 3, 4: 4 };
const UNDO_MS = 10000; // REVISABLE (spec)
const md = d => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const tierLabel = t => (t === 'active' ? 'Active' : t ? `T${t}` : null);
const visitedLabel = r => (r.visited ? `${md(r.visited.last_visit)}${r.visited.visits_7d != null ? ` · ${r.visited.visits_7d}` : ''}` : null);
const tint = color => `color-mix(in srgb, ${BOARD_TOKENS[color]} 6%, transparent)`;
const HIGHLIGHT_MS = 1500;
const highlightTint = `color-mix(in srgb, ${SA.accent} 22%, transparent)`;
const selectStyle = { ...inputStyle, height: 30, fontSize: 13, padding: '0 8px', flex: 'none' };
const opts = (first, list) => [{ value: '', label: first }, ...list];
const rowBar = { height: ROW_BAR_HEIGHT, display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', overflowY: 'hidden', flexWrap: 'nowrap', minWidth: 0 };
const Dim = () => <span className="ui-table__dim">—</span>;
const rowKey = r => `${r.type}-${r.id}`;
const CELL_FIELD = { next: 'next_step', due: 'next_step_due' };
const SIZE_TAG = { research: 'Research', manual: 'Typed' };
const Swatch = ({ color }) => <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, flex: 'none', background: BOARD_TOKENS[color] }} />;
const workCell = (n, late, what) => (n ? <span style={{ ...numStyle, color: late ? SA.bad : SA.text }} title={`${n} open ${what}${late ? ` · ${late} overdue` : ''}`}>{n}{late ? ' !' : ''}</span> : <Dim />);

export default function PipelineView({ businessId, canEdit, meId, onOpenPartner, onOpenCompanies, onOpenPeople }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [channel, setChannel] = useState(() => channelFromParam(new URLSearchParams(window.location.search).get('channel')));
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [hidden, setHidden] = useState(readHidden);
  const [sort, setSort] = useState(readSort);
  const [chooser, setChooser] = useState(null); // DOMRect of the Columns button while the chooser is open
  const [sheetOpen, setSheetOpen] = useState(false); // phone filter sheet
  const [visitorsOpen, setVisitorsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => new Set(['faded']));
  const [toast, setToast] = useState(null); // { text, undo? }
  const [busyId, setBusyId] = useState(null);
  const [panel, setPanel] = useState(undefined); // undefined = closed, null = new employer, object = edit
  const [panelKey, setPanelKey] = useState(null); // row key open in the company panel
  const [members, setMembers] = useState([]);
  const [highlight, setHighlight] = useState(null); // row key kept tinted after the company panel closes (tinted while open via panelKey)
  const [editing, setEditing] = useState(null); // { key, col } of the one open cell editor
  const [saving, setSaving] = useState({}); // `${key}:${col}` -> value in flight, shown dimmed
  const [panelSaving, setPanelSaving] = useState(false);
  const [panelError, setPanelError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [toolsSlot, setToolsSlot] = useState(null);
  const undoTimer = useRef(null);
  const phone = useMediaQuery('(max-width: 760px)');
  useEffect(() => { setToolsSlot(document.getElementById(FRAME_TOOLS_ID)); }, []);
  useEffect(() => { goalsApi.members(businessId).then(setMembers).catch(() => setMembers([])); }, [businessId]);
  useEffect(() => {
    if (!highlight) return;
    const t = setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [highlight]);
  useEffect(() => {
    if (!toast) return undefined;
    undoTimer.current = setTimeout(() => setToast(null), toast.undo ? UNDO_MS : 4000);
    return () => clearTimeout(undoTimer.current);
  }, [toast]);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (channel === 'all') url.searchParams.delete('channel'); else url.searchParams.set('channel', channel);
    window.history.replaceState(window.history.state, '', url);
  }, [channel]);
  useEffect(() => {
    if (!chooser) return undefined;
    const close = e => { if (!e.target.closest('[data-column-chooser]')) setChooser(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [chooser]);

  const load = useCallback(() => goalsApi.pipelineBoard(businessId, true)
    .then(r => { setRows(r); setError(''); }).catch(e => setError(e.message)), [businessId]);
  useEffect(() => { load(); }, [load]);

  // company-workflow-v1 W3: Owner = the person (first name) wherever the record has one; the old text otherwise.
  const all = useMemo(() => {
    const first = new Map(members.map(m => [m.user_id, (m.name || '').split(' ')[0]]));
    return (rows || []).map(r => (r.owner_user_id && first.get(r.owner_user_id) ? { ...r, owner: first.get(r.owner_user_id) } : r));
  }, [rows, members]);
  const owners = useMemo(() => ownersOf(all), [all]);
  const stages = useMemo(() => stagesOf(all), [all]);
  const view = useMemo(() => companiesView(all, channel, filters), [all, channel, filters]);
  const topAll = all.filter(r => r.top).length;
  const set = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  const nFilters = activeFilterCount(filters);
  const toggleBand = id => setCollapsed(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const onSort = s => { setSort(s); writeSort(s); };
  const patchRow = (r, patch) => setRows(rs => rs.map(x => (rowKey(x) === rowKey(r) ? { ...x, ...patch } : x)));

  const starRow = async r => {
    if (!r.top && topAll >= TOP_CAP) throw new Error(`Top is full (${TOP_CAP}): unstar one first.`);
    if (r.type === 'partner') await goalsApi.partnerSignal(businessId, r.id, { type: 'hot', hot: !r.top });
    else await updateOpportunity(businessId, r.id, { is_top: !r.top });
    setRows(rs => rs.map(x => (x.id === r.id ? { ...x, top: !r.top } : x)));
  };
  const star = async r => {
    setBusyId(r.id);
    try { await starRow(r); } catch (e) { setToast({ text: e.message }); } finally { setBusyId(null); }
  };

  // P3: one dropdown for every type that has a priority (priorityActions.js
  // does the write; the panel's dropdown shares it).
  const changePriority = async (r, value) => {
    const before = undoValue(r);
    setBusyId(rowKey(r));
    try {
      await writePriority(businessId, r, value);
      await load();
      setToast({ text: `${r.name}: ${priorityText(value)}`, undo: async () => { await writePriority(businessId, r, before); await load(); } });
    } catch (e) { setToast({ text: e.message }); } finally { setBusyId(null); }
  };

  const panelRow = panelKey === null ? null : all.find(r => rowKey(r) === panelKey) || null;
  const closePanel = useCallback(() => {
    setPanelKey(null);
    setHighlight(panelKey);
    const rowEl = document.querySelector(`[data-row][data-key="${panelKey}"]`);
    rowEl?.scrollIntoView({ block: 'nearest' });
    rowEl?.querySelector('[data-row-name]')?.focus({ preventScroll: true });
  }, [panelKey]);
  const open = r => {
    if (r.type === 'signal') return openTasks({ link: null, view: 'signals', filter: 'team' });
    return setPanelKey(rowKey(r));
  };
  // "Open full card": the record's own screen.
  const openFull = async r => {
    setPanelKey(null);
    if (r.type === 'partner') return onOpenPartner(r.id, r.name);
    if (r.type === 'target') return openTasks({ link: { type: 'target', id: r.id }, filter: 'team' });
    if (r.type === 'visitor') return setVisitorsOpen(true);
    if (r.type === 'apollo') return onOpenCompanies(laWeekStart(new Date(r.last_touch_at)));
    try {
      const opp = (await fetchOpportunities(businessId)).find(o => o.id === r.id);
      if (opp) { setPanel(opp); setPanelError(''); } else setToast({ text: `${r.name} is no longer in the pipeline.` });
    } catch (e) { setToast({ text: e.message }); }
  };
  // A visitor / Apollo-only row became (or already was) a record: show that record's panel.
  const converted = async created => { await load(); setPanelKey(`${created.type}-${created.id}`); };
  const exportSheet = async () => {
    setExporting(true);
    try {
      const res = await fetch(goalsApi.pipelineBoardExportUrl(businessId, { type: filters.type, ownerTeam: filters.ownerTeam, owner: filters.owner, tier: filters.tier, q: filters.q }));
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Export failed (${res.status})`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'joint-pipeline.xlsx';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { setToast({ text: e.message }); } finally { setExporting(false); }
  };
  const panelDo = async fn => {
    setPanelSaving(true); setPanelError('');
    try { await fn(); setPanel(undefined); load(); } catch (e) { setPanelError(e.message); } finally { setPanelSaving(false); }
  };
  const commitCell = async (r, col, value) => {
    const id = `${rowKey(r)}:${col}`;
    setEditing(null);
    setSaving(s => ({ ...s, [id]: value }));
    try {
      if (r.type === 'partner') await goalsApi.updatePartner(businessId, r.id, { next_step: value });
      else await updateOpportunity(businessId, r.id, col === 'next' ? { next_action: value } : { next_action_date: value });
      patchRow(r, { [CELL_FIELD[col]]: value });
    } catch (e) { setToast({ text: e.message }); } finally { setSaving(s => { const n = { ...s }; delete n[id]; return n; }); }
  };
  const editable = (r, col) => canEdit && (r.type === 'employer' || (r.type === 'partner' && col === 'next'));
  const cell = (r, col, type, render) => {
    if (!editable(r, col)) return render(r[CELL_FIELD[col]]);
    const key = rowKey(r);
    return (
      <EditableCell type={type} label={`${col === 'next' ? 'Next step' : 'Due'} for ${r.name}`} value={r[CELL_FIELD[col]]} render={render}
        editing={editing?.key === key && editing.col === col} saving={saving[`${key}:${col}`]}
        onEdit={() => setEditing({ key, col })} onCancel={() => setEditing(null)} onCommit={v => commitCell(r, col, v)}
        onTab={col === 'next' && r.type === 'employer' ? () => setEditing({ key, col: 'due' }) : undefined} />
    );
  };

  const starCell = r => {
    if (r.type !== 'partner' && r.type !== 'employer') return null;
    return canEdit
      ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm ui-btn--icon" disabled={busyId === r.id} aria-pressed={r.top} aria-label={`${r.top ? 'Unstar' : 'Star'} ${r.name}`} onClick={() => star(r)}
        style={{ color: r.top ? SA.warn : SA.muted }}>{r.top ? '★' : '☆'}</button>
      : <span aria-label={r.top ? 'Top' : undefined} style={{ fontSize: 15, color: r.top ? SA.warn : SA.muted }}>{r.top ? '★' : '☆'}</span>;
  };
  const priorityCell = r => {
    if (!PRIORITY_TYPES.includes(r.type)) return <Dim />;
    const label = prioritySetLabel(r);
    const value = priorityValue(r);
    // FIX priority-colors-v1: the level's hue on the chip (Viewers) and as a dot beside the dropdown (Members).
    if (!canEdit) return value ? <Tag color={value === NOT_A_FIT ? SA.borderStrong : priorityColor(value)} title={label}><span style={numStyle}>{value === NOT_A_FIT ? 'Not a fit' : `P${value}`}</span></Tag> : <Dim />;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }} title={label || undefined}>
        {value && value !== NOT_A_FIT && <span className="ui-tag__dot" data-priority-dot={`P${value}`} aria-hidden="true" style={{ '--tag-color': priorityColor(value) }} />}
        <select aria-label={`Priority for ${r.name}`} data-priority={r.type} value={value} disabled={busyId === rowKey(r)} onChange={e => changePriority(r, e.target.value)}
          style={{ ...selectStyle, height: 26, fontSize: 12, padding: '0 4px', color: value ? SA.text : SA.muted }}>
          <option value="">—</option>
          {PRIORITIES.map(p => <option key={p} value={String(p)}>P{p} · {PRIORITY_WORD[p]}</option>)}
          <option value={NOT_A_FIT}>Not a fit</option>
        </select>
        {label.includes(' · set by ') && <span style={{ fontSize: 11, color: SA.muted, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label.split(' · set by ')[1]}</span>}
      </span>
    );
  };
  const nameCell = r => <button type="button" data-row-name className="ui-link ui-link--cell" onClick={() => open(r)}>{r.name}</button>;
  const typeCell = r => <TypeChip row={r} />;
  const allColumns = [
    { id: 'top', label: `Top ${TOP_CAP}`, width: 38, fixed: true, render: r => <span style={{ display: 'block', textAlign: 'center' }}>{starCell(r)}</span> },
    { id: 'name', label: 'Company', width: 220, sticky: true, fixed: true, sortValue: r => r.name, render: nameCell, title: r => `${r.name}${r.record_id ? ` · ${r.record_id}` : ''}` },
    { id: 'type', label: 'Type', width: 116, sortValue: typeSortValue, render: typeCell },
    { id: 'channel', label: 'Channel', width: 112, sortValue: r => CHANNEL_LABEL[r.channel] || null, render: r => (r.channel && r.channel !== 'unknown' ? CHANNEL_LABEL[r.channel] : <Dim />), title: r => CHANNEL_LABEL[r.channel] },
    { id: 'stage', label: 'Stage', width: 120, sortValue: r => r.stage_label, render: r => r.stage_label || <Dim />, title: r => r.stage_label },
    { id: 'priority', label: 'Priority', width: 150, sortValue: r => (r.not_a_fit ? 5 : r.priority), render: priorityCell },
    { id: 'tier', label: 'Tier', width: 56, sortValue: r => TIER_RANK[r.tier] ?? null, render: r => tierLabel(r.tier) || <Dim /> },
    { id: 'owner', label: 'Owner', width: 104, sortValue: r => r.owner, render: r => r.owner || <Dim />, title: r => r.owner },
    { id: 'team', label: 'Team', width: 100, sortValue: r => TEAM_LABEL[r.owner_team] || null, render: r => (r.owner_team ? <OwnerPill row={r} /> : <Dim />) },
    { id: 'next', label: 'Next step', minWidth: 160, sortValue: r => r.next_step, render: r => cell(r, 'next', 'text', v => v || <Dim />), title: r => r.next_step },
    { id: 'due', label: 'Due', width: KIT_EDITABLE.dateWidth, sortValue: r => r.next_step_due, render: r => cell(r, 'due', 'date', v => (v ? <span style={numStyle}>{md(v)}</span> : <Dim />)),
      title: r => (r.type === 'partner' ? (r.next_step_due ? `Next meeting ${r.next_step_due}` : 'No next meeting set') : r.next_step_due) },
    { id: 'touch', label: 'Last touch', width: 84, sortValue: r => r.last_touch_at, render: r => (r.last_touch_at ? <span style={numStyle}>{md(r.last_touch_at)}</span> : <Dim />), title: r => r.last_touch_at && r.last_touch_at.slice(0, 10) },
    { id: 'visited', label: 'Visited', width: 92, sortValue: r => r.visited?.last_visit || null, render: r => (visitedLabel(r) ? <span style={numStyle}>{visitedLabel(r)}</span> : <Dim />),
      title: r => r.visited && `Last website visit ${r.visited.last_visit}${r.visited.visits_7d != null ? ` · ${r.visited.visits_7d} visits in 7 days` : ''}${r.visited.priority ? ` · P${r.visited.priority}` : ''}` },
    { id: 'todos', label: 'To-dos', width: 72, sortValue: r => r.work?.todos || null, render: r => workCell(r.work?.todos, r.work?.todos_overdue, 'to-dos') },
    { id: 'waiting', label: 'Waiting', width: 76, sortValue: r => r.work?.waiting || null, render: r => workCell(r.work?.waiting, r.work?.waiting_overdue, 'waiting on them') },
    { id: 'lives', label: 'Covered lives', width: 104, sortValue: r => r.covered_lives, render: r => (r.covered_lives != null ? <span style={numStyle}>{r.covered_lives.toLocaleString('en-US')}</span> : <Dim />) },
    // company-workflow-v1 W4/W5: Employees (number + where it came from) and a partner's Reach / Clients - sortable.
    { id: 'employees', label: 'Employees', width: 116, sortValue: r => r.employees, render: r => (r.employees != null
      ? <span style={{ display: 'inline-flex', gap: 6, alignItems: 'baseline', whiteSpace: 'nowrap' }}><span style={numStyle}>{r.employees.toLocaleString('en-US')}</span>{SIZE_TAG[r.employees_source] && <span style={{ fontSize: 11, color: SA.muted }}>{SIZE_TAG[r.employees_source]}</span>}</span>
      : <Dim />), title: r => (r.employees != null ? `${r.employees.toLocaleString('en-US')} employees · ${SIZE_TAG[r.employees_source] || ''}` : undefined) },
    { id: 'reach', label: 'Reach', width: 92, sortValue: r => r.reach_employees, render: r => (r.reach_employees != null ? <span style={numStyle}>{r.reach_employees.toLocaleString('en-US')}</span> : <Dim />), title: () => 'Employees it covers across its clients (PEO / HR / benefit platforms)' },
    { id: 'clients', label: 'Clients', width: 76, sortValue: r => r.reach_clients, render: r => (r.reach_clients != null ? <span style={numStyle}>{r.reach_clients.toLocaleString('en-US')}</span> : <Dim />), title: () => 'Client companies it serves' },
    { id: 'record', label: 'Record ID', width: 92, sortValue: r => r.record_id, render: r => r.record_id || <Dim /> },
  ];
  const columns = allColumns.filter(c => c.fixed || !hidden.includes(c.id));
  const toggleColumn = id => setHidden(h => { const n = h.includes(id) ? h.filter(x => x !== id) : [...h, id]; writeHidden(n); return n; });

  const compactRow = r => (
    <>
      <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontWeight: 500, color: SA.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameCell(r)} {typeCell(r)}</span>
        <span style={{ fontSize: 12, color: SA.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {[r.stage_label, priorityValue(r) && (r.not_a_fit ? 'Not a fit' : `P${r.priority}`), tierLabel(r.tier), TEAM_LABEL[r.owner_team], r.owner, r.next_step_due && md(r.next_step_due), r.next_step && `Next: ${r.next_step}`,
            r.last_touch_at && `Touched ${md(r.last_touch_at)}`, visitedLabel(r) && `Visited ${visitedLabel(r)}`, r.work?.todos && `${r.work.todos} to-do${r.work.todos === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
        </span>
      </div>
      <span style={{ width: 44, height: 44, flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{starCell(r)}</span>
    </>
  );

  const visible = view.rows;
  const sortLabel = sort && allColumns.find(c => c.id === sort.id)?.label;
  const groups = sort ? [
    { id: 'sorted', header: <>Sorted by {sortLabel} <span className="ui-table__count">{visible.length}</span></>, rows: visible, emptyText: 'No companies match these filters.' },
  ] : [
    { id: 'top', header: <>Top <span className="ui-table__count">{topAll} of {TOP_CAP}</span></>, icon: <span aria-hidden="true" style={{ color: SA.warn }}>★</span>, rows: visible.filter(r => r.top) },
    ...BOARD_COLORS.map(c => ({ id: c.id, rows: visible.filter(r => !r.top && r.color === c.id) })).filter(g => g.rows.length).map(g => ({
      ...g, icon: <Swatch color={g.id} />, header: <>{BOARD_COLORS.find(c => c.id === g.id).label} <span className="ui-table__count">{g.rows.length}</span></>,
      collapsed: collapsed.has(g.id), onToggle: () => toggleBand(g.id),
    })),
  ];
  const rowStyle = r => ({ '--ui-row-tint': highlight === rowKey(r) || panelKey === rowKey(r) ? highlightTint : tint(r.color), '--ui-row-bar': BOARD_TOKENS[r.color] });

  // R4: labelled dropdowns that show their value, toggle chips for the yes/no filters, Clear as a text button
  // (only while a filter is on); R7: the row carries its label.
  const filterControls = (
    <>
      <span className="ui-group-label" aria-hidden="true">Filter</span>
      <FilterSelect label="Owner" value={filters.owner} options={opts('All owners', owners.map(o => ({ value: o, label: o })))} onChange={v => set('owner', v)} />
      <FilterSelect label="Team" value={filters.ownerTeam} options={[...opts('All teams', OWNER_TEAMS.map(t => ({ value: t, label: TEAM_LABEL[t] }))), { value: 'unset', label: 'No team set' }]} onChange={v => set('ownerTeam', v)} />
      <FilterSelect label="Type" value={filters.type} options={opts('All types', TYPE_OPTIONS.map(([value, label]) => ({ value, label })))} onChange={v => set('type', v)} />
      <FilterSelect label="Stage" value={filters.stage} options={opts('All stages', stages.map(s => ({ value: s, label: s })))} onChange={v => set('stage', v)} />
      <FilterSelect label="Priority" value={filters.priority} options={[...opts('All priorities', PRIORITIES.map(p => ({ value: String(p), label: `P${p}` }))), { value: 'none', label: 'No priority' }]} onChange={v => set('priority', v)} />
      <FilterSelect label="Tier" value={filters.tier} options={opts('All tiers', TIERS.map(t => ({ value: t, label: t === 'active' ? 'Active' : `T${t}` })))} onChange={v => set('tier', v)} />
      <ToggleChip pressed={filters.visited} onClick={() => set('visited', !filters.visited)}>Visited 7 d</ToggleChip>
      <ToggleChip pressed={filters.hasTodo} onClick={() => set('hasTodo', !filters.hasTodo)}>Has open to-do</ToggleChip>
      <ToggleChip pressed={filters.overdue} onClick={() => set('overdue', !filters.overdue)}>Overdue</ToggleChip>
      <input type="search" className="ui-input ui-input--sm" aria-label="Search companies" placeholder="Search" value={filters.q} onChange={e => set('q', e.target.value)} style={{ width: 160 }} />
      {nFilters > 0 && <Button variant="tertiary" onClick={() => setFilters(EMPTY_FILTERS)}>Clear ({nFilters})</Button>}
    </>
  );

  const tools = (
    <>
      {channel === 'website' && <button type="button" className="ui-btn ui-btn--secondary no-print" onClick={() => setVisitorsOpen(true)} title="The 7-day visitor report, Export for Brad and the skip list">Visitor report</button>}
      {!phone && <button type="button" data-column-chooser className="ui-btn ui-btn--secondary no-print" aria-expanded={!!chooser} onClick={e => { const rect = e.currentTarget.getBoundingClientRect(); setChooser(c => (c ? null : rect)); }}>Columns</button>}
      {canEdit && <>
        <button type="button" className="ui-btn ui-btn--secondary no-print" disabled={exporting} onClick={exportSheet}
          title="Excel file of the partners, employers and targets under these filters (Apollo-only, visitors and signals left out), colored like the board">{exporting ? 'Exporting…' : 'Export joint sheet'}</button>
        <button type="button" className="ui-btn ui-btn--secondary no-print" onClick={() => setUpdating(true)}
          title="Upload the joint sheet (.csv or .xlsx): preview what would change, tick, apply">Update from sheet</button>
        <button type="button" className="ui-btn ui-btn--secondary no-print" onClick={() => { setPanel(null); setPanelError(''); }}>+ Add employer</button>
      </>}
    </>
  );
  const overlayRoot = document.getElementById(SA_THEME_ROOT_ID) || document.body;

  return (
    <section aria-label="Pipeline companies" data-pipeline-companies style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      {toolsSlot && createPortal(tools, toolsSlot)}
      <div role="group" aria-label="Channel" data-channel-row style={rowBar}>
        <span className="ui-group-label" aria-hidden="true">Channel</span>
        {CHANNEL_BUTTONS.map(([id, label]) => (
          <ToggleChip key={id} pressed={channel === id} data-channel={id} count={rows ? view.counts[id] : ''} onClick={() => setChannel(id)}>{label}</ToggleChip>
        ))}
      </div>
      {phone ? (
        <div data-filter-row style={rowBar}>
          <Button aria-expanded={sheetOpen} onClick={() => setSheetOpen(true)}>Filters{nFilters ? ` (${nFilters})` : ''}</Button>
          <span style={{ fontSize: 13, color: SA.muted, ...numStyle }}>{rows ? `${visible.length} shown` : ''}</span>
        </div>
      ) : (
        <div role="group" aria-label="Filters" data-filter-row style={rowBar}>{filterControls}</div>
      )}
      {error && <ErrorNote message={error} />}

      {rows && (
        // The module stays dark on screen in light mode; the kit's vars would go light here without the pin.
        <div className="ui-theme-dark">
          <DataTable label="Pipeline companies" columns={columns} groups={groups} rowKey={rowKey} rowStyle={rowStyle} sort={sort} onSort={onSort}
            dense pinUnder="[data-workspace-header]" compact={phone} renderCompact={compactRow} emptyText="No companies match these filters." />
        </div>
      )}

      {chooser && createPortal(
        <div data-column-chooser role="dialog" aria-label="Columns" className="no-print"
          style={{ position: 'fixed', top: chooser.bottom + 4, right: Math.max(8, window.innerWidth - chooser.right), zIndex: 4010, background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: 10, padding: 8, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 200 }}>
          {allColumns.filter(c => !c.fixed).map(c => (
            <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', fontSize: 13, color: SA.text, cursor: 'pointer' }}>
              <input type="checkbox" checked={!hidden.includes(c.id)} onChange={() => toggleColumn(c.id)} />{c.label}
            </label>
          ))}
        </div>, overlayRoot)}
      {sheetOpen && createPortal(
        <div className="no-print" style={{ position: 'fixed', inset: 0, zIndex: 4003 }}>
          <div onClick={() => setSheetOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
          <div role="dialog" aria-label="Filters" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '80vh', overflowY: 'auto', background: SA.surface, borderTop: `1px solid ${SA.border}`, borderRadius: '14px 14px 0 0', padding: 16, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {filterControls}
            <button type="button" className="ui-btn ui-btn--secondary" style={{ width: '100%' }} onClick={() => setSheetOpen(false)}>Show {visible.length}</button>
          </div>
        </div>, overlayRoot)}
      {toast && createPortal(
        <div role="status" className="no-print" style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 4005, padding: '10px 16px', borderRadius: 10, background: SA.surface2, border: `1px solid ${SA.border}`, color: SA.text, fontSize: 14, display: 'flex', gap: 14, alignItems: 'center' }}>
          {toast.text}
          {toast.undo && <Button variant="tertiary" style={{ fontWeight: 600 }}
            onClick={async () => { const u = toast.undo; setToast(null); try { await u(); } catch (e) { setToast({ text: e.message }); } }}>Undo</Button>}
        </div>, overlayRoot)}

      {visitorsOpen && (
        <SidePanel label="Website visitors" width={1040} onClose={() => { setVisitorsOpen(false); load(); }}>
          <VisitorReport businessId={businessId} canEdit={canEdit} />
        </SidePanel>
      )}
      {canEdit && updating && (
        <SheetUpdateDrawer businessId={businessId} onClose={() => setUpdating(false)}
          onApplied={r => { setToast({ text: `Updated ${r.applied}${r.failed.length ? ` · ${r.failed.length} not applied` : ''}` }); load(); }} />
      )}
      {panelRow && (
        <CompanyPanel businessId={businessId} row={panelRow} canEdit={canEdit} members={members} meId={meId} onStar={() => starRow(panelRow)} onPatch={patch => patchRow(panelRow, patch)} onChanged={load} onToast={setToast}
          onConvert={converted} onClose={closePanel} onOpenFull={() => openFull(panelRow)} onOpenPeople={onOpenPeople && (c => { closePanel(); onOpenPeople(c); })} />
      )}
      {panel !== undefined && (
        <OpportunityPanel businessId={businessId} opportunity={panel} saving={panelSaving} error={panelError} readOnly={!canEdit} members={members} onClose={() => setPanel(undefined)}
          onSave={payload => panelDo(async () => {
            if (panel) return updateOpportunity(businessId, panel.id, payload);
            // The create route reuses a live opportunity with the same name first (opportunityMatch).
            const { reused, opportunity } = await createOpportunity(businessId, payload);
            if (reused) setToast({ text: `${opportunity.organization} is already in the pipeline - no new row added.` });
          })}
          onArchive={() => panelDo(() => archiveOpportunity(businessId, panel.id))} />
      )}
    </section>
  );
}

import { useState, useEffect, useCallback, useMemo } from 'react';
import { SA } from '../theme';
import { goalsApi } from './goalsApi';
import { fetchOpportunities, createOpportunity, updateOpportunity, archiveOpportunity } from '../pipelineApi';
import OpportunityPanel from '../OpportunityPanel';
import PartnerQuickPanel from './PartnerQuickPanel';
import OwnerPill from '../OwnerPill';
import SheetUpdateDrawer from './SheetUpdateDrawer';
import DataTable from '../../../ui/DataTable';
import EditableCell from '../../../ui/EditableCell';
import { KIT_EDITABLE } from '../../../ui/tokens';
import useMediaQuery from '../../../utils/useMediaQuery';
import { openTasks } from '../tasks/LinkedTasks';
import { laWeekStart } from '../periods';
import { cardStyle, labelStyle, h2Style, subStyle, numStyle, inputStyle, ErrorNote } from './goalsUi';
import { BOARD_COLORS, TOP_CAP, matchesBoardFilters } from '../../../constants/pipelineBoard';
import { OWNER_TEAMS, TEAM_LABEL } from '../../../constants/ownership';
import { TIERS } from '../../../constants/partnerPipeline';

// pipeline-board-v1 - Goals > Pipeline: every partner, employer and target
// (and, on request, Apollo-only companies) on one color-coded board. Rows,
// stage and color come from GET goals/pipeline-board; the UI only filters,
// groups and maps a color key to a token. pipeline-wide-table-v1: the board
// is a DataTable (one line per company) with a compact toolbar; on a phone
// it is the two-line list. pipeline-quick-panel-v1: a partner row opens
// PartnerQuickPanel over the table (never a navigation); employers open
// OpportunityPanel, read-only for a Viewer. Stage 2: Next step (partners +
// employers) and Due (employers) are typed straight into the table; the row's
// value changes only when the save lands, so an open editor never re-sorts.
export const BOARD_TOKENS = { green: SA.good, yellow: SA.warn, blue: SA.link, gray: SA.muted, light: SA.faint, faded: SA.track };
const TYPE_CHIPS = [['', 'All'], ['partner', 'Partners'], ['employer', 'Employers'], ['target', 'Targets']];
const TYPE_LABEL = { partner: 'Partner', employer: 'Employer', target: 'Target', apollo: 'Apollo' };
const TIER_RANK = { active: 0, 1: 1, 2: 2, 3: 3, 4: 4 };
const md = d => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const tierLabel = t => (t === 'active' ? 'Active' : t ? `T${t}` : null);
const touchLabel = r => ((r.type === 'partner' || r.type === 'apollo') && r.last_touch_at ? md(r.last_touch_at) : null);
const tint = color => `color-mix(in srgb, ${BOARD_TOKENS[color]} 6%, transparent)`;
const HIGHLIGHT_MS = 1500;
const highlightTint = `color-mix(in srgb, ${SA.accent} 22%, transparent)`;
const chipBtn = on => ({ height: 30, padding: '0 12px', borderRadius: 999, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', flex: 'none', border: `1px solid ${on ? SA.accent : SA.border}`, background: on ? SA.surface2 : 'transparent', color: on ? SA.text : SA.muted });
const selectStyle = { ...inputStyle, height: 30, fontSize: 13, padding: '0 8px' };
const Dim = () => <span className="ui-table__dim">—</span>;
const rowKey = r => `${r.type}-${r.id}`;
const CELL_FIELD = { next: 'next_step', due: 'next_step_due' };
const Swatch = ({ color }) => <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, flex: 'none', background: BOARD_TOKENS[color] }} />;

export default function PipelineView({ businessId, canEdit, onOpenPartner, onOpenCompanies }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [includeApollo, setIncludeApollo] = useState(false);
  const [filters, setFilters] = useState({ type: '', ownerTeam: '', owner: '', tier: '', color: '', q: '' });
  const [collapsed, setCollapsed] = useState(() => new Set(['faded']));
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [panel, setPanel] = useState(undefined); // undefined = closed, null = new employer, object = edit
  const [quick, setQuick] = useState(null); // partner id open in the quick panel
  const [highlight, setHighlight] = useState(null); // row key flashed after the quick panel closes
  const [editing, setEditing] = useState(null); // { key, col } of the one open cell editor
  const [saving, setSaving] = useState({}); // `${key}:${col}` -> value in flight, shown dimmed
  const [panelSaving, setPanelSaving] = useState(false);
  const [panelError, setPanelError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [updating, setUpdating] = useState(false);
  const phone = useMediaQuery('(max-width: 760px)');
  useEffect(() => {
    if (!highlight) return;
    const t = setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [highlight]);

  const load = useCallback(() => goalsApi.pipelineBoard(businessId, includeApollo)
    .then(r => { setRows(r); setError(''); }).catch(e => setError(e.message)), [businessId, includeApollo]);
  useEffect(() => { load(); }, [load]);

  const owners = useMemo(() => [...new Set((rows || []).map(r => r.owner).filter(Boolean))].sort(), [rows]);
  const shown = useMemo(() => (rows || []).filter(r => matchesBoardFilters(r, { ...filters, color: '' })), [rows, filters]);
  const counts = useMemo(() => Object.fromEntries(BOARD_COLORS.map(c => [c.id, shown.filter(r => r.color === c.id).length])), [shown]);
  const visible = filters.color ? shown.filter(r => r.color === filters.color) : shown;
  const topAll = (rows || []).filter(r => r.top).length;
  const set = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  const toggleBand = id => setCollapsed(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const starRow = async r => {
    if (!r.top && topAll >= TOP_CAP) throw new Error(`Top is full (${TOP_CAP}): unstar one first.`);
    if (r.type === 'partner') await goalsApi.partnerSignal(businessId, r.id, { type: 'hot', hot: !r.top });
    else await updateOpportunity(businessId, r.id, { is_top: !r.top });
    setRows(rs => rs.map(x => (x.id === r.id ? { ...x, top: !r.top } : x)));
  };
  const star = async r => {
    setNotice(''); setBusyId(r.id);
    try { await starRow(r); } catch (e) { setNotice(e.message); } finally { setBusyId(null); }
  };
  const quickRow = quick === null ? null : (rows || []).find(r => r.type === 'partner' && r.id === quick) || null;
  const patchQuick = patch => setRows(rs => rs.map(x => (x.type === 'partner' && x.id === quick ? { ...x, ...patch } : x)));
  const closeQuick = useCallback(() => {
    const key = `partner-${quick}`;
    setQuick(null);
    setHighlight(key);
    document.querySelector(`[data-row][data-key="${key}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [quick]);
  const open = async r => {
    if (r.type === 'partner') return setQuick(r.id);
    if (r.type === 'target') return openTasks({ link: { type: 'target', id: r.id }, filter: 'team' });
    if (r.type === 'apollo') return onOpenCompanies(laWeekStart(new Date(r.last_touch_at)));
    try {
      const opp = (await fetchOpportunities(businessId)).find(o => o.id === r.id);
      if (opp) { setPanel(opp); setPanelError(''); } else setNotice(`${r.name} is no longer in the pipeline.`);
    } catch (e) { setNotice(e.message); }
  };
  const exportSheet = async () => {
    setExporting(true); setNotice('');
    try {
      const res = await fetch(goalsApi.pipelineBoardExportUrl(businessId, filters));
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Export failed (${res.status})`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'joint-pipeline.xlsx';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { setNotice(e.message); } finally { setExporting(false); }
  };
  const panelDo = async fn => {
    setPanelSaving(true); setPanelError('');
    try { await fn(); setPanel(undefined); load(); } catch (e) { setPanelError(e.message); } finally { setPanelSaving(false); }
  };
  const commitCell = async (r, col, value) => {
    const id = `${rowKey(r)}:${col}`;
    setEditing(null); setNotice('');
    setSaving(s => ({ ...s, [id]: value }));
    try {
      if (r.type === 'partner') await goalsApi.updatePartner(businessId, r.id, { next_step: value });
      else await updateOpportunity(businessId, r.id, col === 'next' ? { next_action: value } : { next_action_date: value });
      setRows(rs => rs.map(x => (rowKey(x) === rowKey(r) ? { ...x, [CELL_FIELD[col]]: value } : x)));
    } catch (e) { setNotice(e.message); } finally { setSaving(s => { const n = { ...s }; delete n[id]; return n; }); }
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
      ? <button type="button" disabled={busyId === r.id} aria-pressed={r.top} aria-label={`${r.top ? 'Unstar' : 'Star'} ${r.name}`} onClick={() => star(r)}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 15, lineHeight: 1, color: r.top ? SA.warn : SA.faint }}>{r.top ? '★' : '☆'}</button>
      : <span aria-label={r.top ? 'Top' : undefined} style={{ fontSize: 15, color: r.top ? SA.warn : SA.faint }}>{r.top ? '★' : '☆'}</span>;
  };
  const nameCell = r => <button type="button" onClick={() => open(r)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit', textAlign: 'left', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</button>;
  const typeCell = r => <span className="ui-table__label">{TYPE_LABEL[r.type]}</span>;
  const columns = [
    { id: 'top', label: `Top ${TOP_CAP}`, width: 38, render: r => <span style={{ display: 'block', textAlign: 'center' }}>{starCell(r)}</span> },
    { id: 'name', label: 'Company', width: 250, sticky: true, sortValue: r => r.name, render: nameCell, title: r => `${r.name}${r.record_id ? ` · ${r.record_id}` : ''}` },
    { id: 'type', label: 'Type', width: 84, sortValue: r => TYPE_LABEL[r.type], render: typeCell },
    { id: 'stage', label: 'Stage', width: 124, sortValue: r => r.stage_label, render: r => r.stage_label || <Dim />, title: r => r.stage_label },
    { id: 'tier', label: 'Tier', width: 58, sortValue: r => TIER_RANK[r.tier] ?? null, render: r => tierLabel(r.tier) || <Dim /> },
    { id: 'owner', label: 'Owner', width: 116, sortValue: r => r.owner, render: r => r.owner || <Dim />, title: r => r.owner },
    { id: 'team', label: 'Team', width: 104, sortValue: r => TEAM_LABEL[r.owner_team] || null, render: r => (r.owner_team ? <OwnerPill row={r} /> : <Dim />) },
    { id: 'next', label: 'Next step', minWidth: 160, sortValue: r => r.next_step, render: r => cell(r, 'next', 'text', v => v || <Dim />), title: r => r.next_step },
    { id: 'due', label: 'Due', width: KIT_EDITABLE.dateWidth, sortValue: r => r.next_step_due, render: r => cell(r, 'due', 'date', v => (v ? <span style={numStyle}>{md(v)}</span> : <Dim />)),
      title: r => (r.type === 'partner' ? 'Partners have no due date yet' : r.next_step_due) },
    { id: 'touch', label: 'Last touch', width: 86, sortValue: r => r.last_touch_at, render: r => (touchLabel(r) ? <span style={numStyle}>{touchLabel(r)}</span> : <Dim />), title: r => r.last_touch_at && r.last_touch_at.slice(0, 10) },
  ];
  const compactRow = r => (
    <>
      <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontWeight: 500, color: SA.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameCell(r)} {typeCell(r)}</span>
        <span style={{ fontSize: 12, color: SA.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {[r.stage_label, tierLabel(r.tier), TEAM_LABEL[r.owner_team], r.owner, r.next_step_due && md(r.next_step_due), r.next_step && `Next: ${r.next_step}`, touchLabel(r) && `Touched ${touchLabel(r)}`].filter(Boolean).join(' · ')}
        </span>
      </div>
      <span style={{ width: 44, height: 44, flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{starCell(r)}</span>
    </>
  );

  const top = visible.filter(r => r.top);
  const groups = [
    { id: 'top', header: <>Top <span className="ui-table__count">{topAll} of {TOP_CAP}</span></>, icon: <span aria-hidden="true" style={{ color: SA.warn }}>★</span>, rows: top,
      emptyText: canEdit ? 'Nothing starred yet. ★ a row to pin it here.' : 'Nothing starred yet.' },
    ...BOARD_COLORS.map(c => ({ id: c.id, rows: visible.filter(r => !r.top && r.color === c.id) })).filter(g => g.rows.length).map(g => ({
      ...g, icon: <Swatch color={g.id} />, header: <>{BOARD_COLORS.find(c => c.id === g.id).label} <span className="ui-table__count">{g.rows.length}</span></>,
      collapsed: collapsed.has(g.id), onToggle: () => toggleBand(g.id),
    })),
  ];
  const rowStyle = r => ({ '--ui-row-tint': highlight === rowKey(r) ? highlightTint : tint(r.color), '--ui-row-bar': BOARD_TOKENS[r.color] });

  return (
    <section style={{ ...cardStyle, padding: 16 }} aria-labelledby="h-pipeline">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
        <span style={labelStyle}>Joint pipeline · HomeLover × Upside</span>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={h2Style} id="h-pipeline">{rows ? `${shown.length} compan${shown.length === 1 ? 'y' : 'ies'}` : 'Pipeline'}</h2>
          {canEdit && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="ui-btn ui-btn--secondary no-print" disabled={exporting} onClick={exportSheet}
                title="Excel file of the rows below (Apollo-only companies left out), colored like the board">{exporting ? 'Exporting…' : 'Export joint sheet'}</button>
              <button type="button" className="ui-btn ui-btn--secondary no-print" onClick={() => { setUpdating(true); setNotice(''); }}
                title="Upload the joint sheet (.csv or .xlsx): preview what would change, tick, apply">Update from sheet</button>
              <button type="button" className="ui-btn ui-btn--secondary no-print" onClick={() => { setPanel(null); setPanelError(''); setNotice(''); }}>+ Add employer</button>
            </div>
          )}
        </div>
        <span style={subStyle}>Every partner, employer and target in one place. Color shows where it stands; ★ puts it in the Top {TOP_CAP}.</span>
      </div>
      {error && <ErrorNote message={error} />}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <div role="group" aria-label="Type" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {TYPE_CHIPS.map(([id, label]) => <button key={label} type="button" aria-pressed={filters.type === id} style={chipBtn(filters.type === id)} onClick={() => set('type', id)}>{label}</button>)}
          <button type="button" aria-pressed={includeApollo} style={chipBtn(includeApollo)} onClick={() => setIncludeApollo(v => !v)}
            title="Also show companies sequenced in Apollo that aren't on the board yet">In Apollo</button>
        </div>
        {!phone && <span aria-hidden="true" style={{ width: 1, height: 20, background: SA.border, margin: '0 4px' }} />}
        <select aria-label="Owner team" value={filters.ownerTeam} onChange={e => set('ownerTeam', e.target.value)} style={selectStyle}>
          <option value="">All teams</option>
          {OWNER_TEAMS.map(t => <option key={t} value={t}>{TEAM_LABEL[t]}</option>)}
          <option value="unset">No team set</option>
        </select>
        <select aria-label="Owner" value={filters.owner} onChange={e => set('owner', e.target.value)} style={selectStyle}>
          <option value="">All owners</option>
          {owners.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select aria-label="Tier" value={filters.tier} onChange={e => set('tier', e.target.value)} style={selectStyle}>
          <option value="">All tiers</option>
          {TIERS.map(t => <option key={t} value={t}>{t === 'active' ? 'Active' : `T${t}`}</option>)}
        </select>
        <input type="search" aria-label="Search companies" placeholder="Filter companies" value={filters.q} onChange={e => set('q', e.target.value)} style={{ ...selectStyle, flex: '1 1 160px', minWidth: 0 }} />
      </div>
      <div role="group" aria-label="Counts by color" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {BOARD_COLORS.map(c => (
          <button key={c.id} type="button" aria-pressed={filters.color === c.id} onClick={() => set('color', filters.color === c.id ? '' : c.id)}
            style={{ ...chipBtn(filters.color === c.id), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Swatch color={c.id} />
            {c.label} <span style={numStyle}>{counts[c.id]}</span>
          </button>
        ))}
      </div>
      {notice && <p role="status" style={{ margin: '0 0 12px', fontSize: 13, color: SA.warn }}>{notice}</p>}

      {rows && (
        // The module stays dark on screen in light mode; the kit's vars would go light here without the pin.
        <div className="ui-theme-dark">
          <DataTable label="Joint pipeline" columns={columns} groups={groups} rowKey={rowKey} rowStyle={rowStyle}
            compact={phone} renderCompact={compactRow} emptyText="No companies match these filters." />
        </div>
      )}

      {canEdit && updating && (
        <SheetUpdateDrawer businessId={businessId} onClose={() => setUpdating(false)}
          onApplied={r => { setNotice(`Updated ${r.applied}${r.failed.length ? ` · ${r.failed.length} not applied` : ''}`); load(); }} />
      )}
      {quickRow && (
        <PartnerQuickPanel businessId={businessId} row={quickRow} canEdit={canEdit} onChange={patchQuick} onStar={() => starRow(quickRow)} onClose={closeQuick}
          onOpenFull={() => { setQuick(null); onOpenPartner(quickRow.id, quickRow.name); }} />
      )}
      {panel !== undefined && (
        <OpportunityPanel businessId={businessId} opportunity={panel} saving={panelSaving} error={panelError} readOnly={!canEdit} onClose={() => setPanel(undefined)}
          onSave={payload => panelDo(async () => {
            if (panel) return updateOpportunity(businessId, panel.id, payload);
            // The create route reuses a live opportunity with the same name first (opportunityMatch).
            const { reused, opportunity } = await createOpportunity(businessId, payload);
            if (reused) setNotice(`${opportunity.organization} is already in the pipeline - no new row added.`);
          })}
          onArchive={() => panelDo(() => archiveOpportunity(businessId, panel.id))} />
      )}
    </section>
  );
}

import { useState, useEffect, useCallback, useMemo } from 'react';
import { SA } from '../theme';
import { goalsApi } from './goalsApi';
import { fetchOpportunities, createOpportunity, updateOpportunity, archiveOpportunity } from '../pipelineApi';
import OpportunityPanel from '../OpportunityPanel';
import OwnerPill from '../OwnerPill';
import { openTasks } from '../tasks/LinkedTasks';
import { laWeekStart } from '../periods';
import { cardStyle, labelStyle, h2Style, h3Style, subStyle, numStyle, inputStyle, ErrorNote } from './goalsUi';
import { BOARD_COLORS, TOP_CAP, matchesBoardFilters } from '../../../constants/pipelineBoard';
import { OWNER_TEAMS, TEAM_LABEL } from '../../../constants/ownership';
import { TIERS } from '../../../constants/partnerPipeline';

// pipeline-board-v1 - Goals > Pipeline: every partner, employer and target
// (and, on request, Apollo-only companies) on one color-coded board. Rows,
// stage and color come from GET goals/pipeline-board; the UI only filters,
// groups and maps a color key to a token.
export const BOARD_TOKENS = { green: SA.good, yellow: SA.warn, blue: SA.link, gray: SA.muted, light: SA.faint, faded: SA.track };
const TYPE_CHIPS = [['', 'All'], ['partner', 'Partners'], ['employer', 'Employers'], ['target', 'Targets']];
const TYPE_LABEL = { partner: 'Partner', employer: 'Employer', target: 'Target', apollo: 'Apollo' };
const md = d => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const tint = color => `color-mix(in srgb, ${BOARD_TOKENS[color]} 9%, transparent)`;
const chipBtn = on => ({ height: 30, padding: '0 12px', borderRadius: 999, fontSize: 13, cursor: 'pointer', border: `1px solid ${on ? SA.accent : SA.border}`, background: on ? SA.surface2 : 'transparent', color: on ? SA.text : SA.muted });
const selectStyle = { ...inputStyle, height: 32, fontSize: 13, padding: '0 8px' };

export default function PipelineView({ businessId, canEdit, onOpenPartner, onOpenCompanies }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [includeApollo, setIncludeApollo] = useState(false);
  const [filters, setFilters] = useState({ type: '', ownerTeam: '', owner: '', tier: '', color: '', q: '' });
  const [fadedOpen, setFadedOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [panel, setPanel] = useState(undefined); // undefined = closed, null = new employer, object = edit
  const [panelSaving, setPanelSaving] = useState(false);
  const [panelError, setPanelError] = useState('');

  const load = useCallback(() => goalsApi.pipelineBoard(businessId, includeApollo)
    .then(r => { setRows(r); setError(''); }).catch(e => setError(e.message)), [businessId, includeApollo]);
  useEffect(() => { load(); }, [load]);

  const owners = useMemo(() => [...new Set((rows || []).map(r => r.owner).filter(Boolean))].sort(), [rows]);
  const shown = useMemo(() => (rows || []).filter(r => matchesBoardFilters(r, { ...filters, color: '' })), [rows, filters]);
  const counts = useMemo(() => Object.fromEntries(BOARD_COLORS.map(c => [c.id, shown.filter(r => r.color === c.id).length])), [shown]);
  const visible = filters.color ? shown.filter(r => r.color === filters.color) : shown;
  const topAll = (rows || []).filter(r => r.top).length;
  const set = (k, v) => setFilters(f => ({ ...f, [k]: v }));

  const star = async r => {
    setNotice('');
    if (!r.top && topAll >= TOP_CAP) return setNotice(`Top is full (${TOP_CAP}): unstar one first.`);
    setBusyId(r.id);
    try {
      if (r.type === 'partner') await goalsApi.partnerSignal(businessId, r.id, { type: 'hot', hot: !r.top });
      else await updateOpportunity(businessId, r.id, { is_top: !r.top });
      setRows(rs => rs.map(x => (x.id === r.id ? { ...x, top: !r.top } : x)));
    } catch (e) { setNotice(e.message); } finally { setBusyId(null); }
  };
  const open = async r => {
    if (r.type === 'partner') return onOpenPartner(r.id, r.name);
    if (r.type === 'target') return openTasks({ link: { type: 'target', id: r.id }, filter: 'team' });
    if (r.type === 'apollo') return onOpenCompanies(laWeekStart(new Date(r.last_touch_at)));
    if (!canEdit) return;
    try {
      const opp = (await fetchOpportunities(businessId)).find(o => o.id === r.id);
      if (opp) { setPanel(opp); setPanelError(''); } else setNotice(`${r.name} is no longer in the pipeline.`);
    } catch (e) { setNotice(e.message); }
  };
  const panelDo = async fn => {
    setPanelSaving(true); setPanelError('');
    try { await fn(); setPanel(undefined); load(); } catch (e) { setPanelError(e.message); } finally { setPanelSaving(false); }
  };

  const top = visible.filter(r => r.top);
  const sections = BOARD_COLORS.map(c => ({ ...c, items: visible.filter(r => !r.top && r.color === c.id) })).filter(s => s.items.length);
  const rowProps = { canEdit, busyId, onStar: star, onOpen: open, clickable: r => r.type !== 'employer' || canEdit };

  return (
    <section style={cardStyle} aria-labelledby="h-pipeline">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
        <span style={labelStyle}>Joint pipeline · HomeLover × Upside</span>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={h2Style} id="h-pipeline">{rows ? `${shown.length} compan${shown.length === 1 ? 'y' : 'ies'}` : 'Pipeline'}</h2>
          {canEdit && <button type="button" className="ui-btn ui-btn--secondary no-print" onClick={() => { setPanel(null); setPanelError(''); setNotice(''); }}>+ Add employer</button>}
        </div>
        <span style={subStyle}>Every partner, employer and target in one place. Color shows where it stands; ★ puts it in the Top {TOP_CAP}.</span>
      </div>
      {error && <ErrorNote message={error} />}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <div role="group" aria-label="Type" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {TYPE_CHIPS.map(([id, label]) => <button key={label} type="button" aria-pressed={filters.type === id} style={chipBtn(filters.type === id)} onClick={() => set('type', id)}>{label}</button>)}
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: SA.muted, cursor: 'pointer' }}>
          <input type="checkbox" checked={includeApollo} onChange={e => setIncludeApollo(e.target.checked)} /> Include Apollo-only companies
        </label>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
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
        <input type="search" aria-label="Search companies" placeholder="Search companies" value={filters.q} onChange={e => set('q', e.target.value)} style={{ ...selectStyle, flex: '1 1 180px', minWidth: 0 }} />
      </div>

      <div role="group" aria-label="Counts by color" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
        {BOARD_COLORS.map(c => (
          <button key={c.id} type="button" aria-pressed={filters.color === c.id} onClick={() => set('color', filters.color === c.id ? '' : c.id)}
            style={{ ...chipBtn(filters.color === c.id), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: BOARD_TOKENS[c.id] }} />
            {c.label} <span style={numStyle}>{counts[c.id]}</span>
          </button>
        ))}
      </div>
      {notice && <p role="status" style={{ margin: '0 0 12px', fontSize: 13, color: SA.warn }}>{notice}</p>}

      {rows && (
        <>
          <BoardSection title={`Top ${topAll} of ${TOP_CAP}`} items={top} {...rowProps} emptyText={canEdit ? 'Nothing starred yet. ★ a row to pin it here.' : 'Nothing starred yet.'} />
          {sections.map(s => (s.id === 'faded' ? (
            <div key={s.id} style={{ marginTop: 16 }}>
              <button type="button" aria-expanded={fadedOpen} onClick={() => setFadedOpen(o => !o)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', ...h3Style, color: SA.muted }}>
                {fadedOpen ? '▾' : '▸'} {s.label} ({s.items.length})
              </button>
              {fadedOpen && <BoardSection items={s.items} {...rowProps} />}
            </div>
          ) : <BoardSection key={s.id} title={s.label} color={s.id} items={s.items} {...rowProps} />))}
          {!shown.length && <p style={{ ...subStyle, fontSize: 13 }}>No companies match these filters.</p>}
        </>
      )}

      {canEdit && panel !== undefined && (
        <OpportunityPanel opportunity={panel} saving={panelSaving} error={panelError} onClose={() => setPanel(undefined)}
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

function BoardSection({ title, color, items, emptyText, ...rowProps }) {
  return (
    <div style={{ marginTop: 16 }}>
      {title && (
        <h3 style={{ ...h3Style, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          {color && <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: BOARD_TOKENS[color] }} />}
          {title} {color && <span style={{ ...numStyle, color: SA.muted, fontWeight: 400 }}>{items.length}</span>}
        </h3>
      )}
      {!items.length && emptyText && <p style={{ ...subStyle, fontSize: 13, margin: '4px 0' }}>{emptyText}</p>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map(r => <BoardRow key={`${r.type}-${r.id}`} r={r} {...rowProps} />)}
      </ul>
    </div>
  );
}

function BoardRow({ r, canEdit, busyId, onStar, onOpen, clickable }) {
  const starrable = r.type === 'partner' || r.type === 'employer';
  const go = clickable(r);
  return (
    <li data-color={r.color} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, borderLeft: `4px solid ${BOARD_TOKENS[r.color]}`, background: tint(r.color), minWidth: 0 }}>
      <span style={{ width: 22, flex: '0 0 22px', textAlign: 'center' }}>
        {starrable && (canEdit
          ? <button type="button" disabled={busyId === r.id} aria-pressed={r.top} aria-label={`${r.top ? 'Unstar' : 'Star'} ${r.name}`} onClick={() => onStar(r)}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 16, color: r.top ? SA.warn : SA.faint }}>{r.top ? '★' : '☆'}</button>
          : <span aria-label={r.top ? 'Top' : undefined} style={{ fontSize: 16, color: r.top ? SA.warn : SA.faint }}>{r.top ? '★' : '☆'}</span>)}
      </span>
      <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
          {go
            ? <button type="button" onClick={() => onOpen(r)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: SA.text, fontSize: 14, fontWeight: 600, textAlign: 'left', overflowWrap: 'anywhere' }}>{r.name}</button>
            : <span style={{ color: SA.text, fontSize: 14, fontWeight: 600, overflowWrap: 'anywhere' }}>{r.name}</span>}
          <span style={{ fontSize: 11, color: SA.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{TYPE_LABEL[r.type]}</span>
          <OwnerPill row={r} />
        </div>
        <span style={{ fontSize: 12, color: SA.muted, overflowWrap: 'anywhere' }}>
          {[r.stage_label, r.tier && (r.tier === 'active' ? 'Active' : `T${r.tier}`), r.owner,
            r.next_step && `Next: ${r.next_step}${r.next_step_due ? ` · ${md(r.next_step_due)}` : ''}`,
            !r.next_step && r.next_step_due && `Due ${md(r.next_step_due)}`,
            r.type === 'partner' && r.last_touch_at && `Touched ${md(r.last_touch_at)}`,
            r.type === 'apollo' && r.last_touch_at && `Sequenced ${md(r.last_touch_at)}`].filter(Boolean).join(' · ')}
        </span>
      </div>
    </li>
  );
}

import { useState, useRef } from 'react';
import { SA, SA_TYPE, SA_SHAPE } from './theme';
import { STAGE_ENUM, STAGE_LABELS, effectiveProbability } from './pipelineStages';
import { createOpportunity, updateOpportunity, archiveOpportunity, importOpportunitiesCsv, templateUrl } from './pipelineApi';
import OpportunityPanel from './OpportunityPanel';
import ExportButton from './ExportButton';
import { exportWidgetCsv } from './exportCsv';
import { formatValue } from './computeMetric';
import { laDateString } from './periods';

// sales-pipeline-v1 Stage 3 - same shared-column-definition approach the
// leaderboard alignment fix established (FIX sales-leaderboard-
// alignment-v1), used from the start here per the SPEC's own instruction,
// even though this widget only ever renders one table (no per-group
// splitting the way the leaderboard has) - table-layout:fixed + one
// <colgroup> still keeps header/row cells aligned consistently.
const COLUMNS = [
  { id: 'star', width: 32 },
  { id: 'organization', width: null },
  { id: 'cohort', width: 80 },
  { id: 'stage', width: 110 },
  { id: 'next_action', width: 110 },
  { id: 'next_action_date', width: 95 },
  { id: 'expected_close', width: 95 },
  { id: 'probability', width: 64 },
  { id: 'covered_lives', width: 70 },
  { id: 'owner', width: 70 },
];
// Widths trimmed from an earlier wider pass (1064px total) after actually
// reading the rendered PDF: wider than the printable area minus the
// widget card's own padding (~935px, the same budget design-v1 Stage 4
// measured for the leaderboard), so Lives/Owner were clipped off the
// right edge entirely with no way to scroll in a static PDF - this
// table never got that same print-fit pass when it was first built in
// Stage 3. New total ~876px.
const NAME_COL_MIN_WIDTH = 150;
const TABLE_MIN_WIDTH = COLUMNS.reduce((sum, c) => sum + (c.width ?? NAME_COL_MIN_WIDTH), 0);

const fieldStyle = { ...SA_TYPE.body, fontSize: 12, width: '100%', padding: '4px 6px', background: 'transparent', border: `1px solid transparent`, borderRadius: 5, color: SA.text, boxSizing: 'border-box' };
const fieldFocusStyle = { border: `1px solid ${SA.border}`, background: SA.ground };

export default function PipelineTable({ businessId, opportunities, onPipelineChanged, widgetId = 'pipeline_table' }) {
  const [stageFilter, setStageFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('organization');
  const [sortDesc, setSortDesc] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [rowError, setRowError] = useState({});
  const [panelOpp, setPanelOpp] = useState(undefined); // undefined = closed, null = create, object = edit
  const [panelSaving, setPanelSaving] = useState(false);
  const [panelError, setPanelError] = useState('');
  const [importMessage, setImportMessage] = useState('');
  const fileInputRef = useRef(null);

  const today = laDateString();

  if (!opportunities.length) {
    return (
      <div>
        <p style={{ fontSize: 13, color: SA.muted, padding: '12px 0 4px' }}>No opportunities yet — add one or import a CSV.</p>
        <div className="no-print" style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setPanelOpp(null)} style={addButtonStyle()}>Add opportunity</button>
          <a href={templateUrl(businessId)} style={{ ...SA_TYPE.body, fontSize: 12, color: SA.accent, alignSelf: 'center' }}>Download template</a>
        </div>
        {panelOpp !== undefined && (
          <OpportunityPanel
            opportunity={panelOpp} saving={panelSaving} error={panelError}
            onClose={() => { setPanelOpp(undefined); setPanelError(''); }}
            onSave={async payload => {
              setPanelSaving(true); setPanelError('');
              try { await createOpportunity(businessId, payload); setPanelOpp(undefined); onPipelineChanged?.(); }
              catch (e) { setPanelError(e.message); }
              finally { setPanelSaving(false); }
            }}
          />
        )}
      </div>
    );
  }

  const filtered = opportunities.filter(o => {
    if (stageFilter !== 'all' && o.stage !== stageFilter) return false;
    if (search.trim() && !o.organization.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    const as = av == null ? '' : String(av), bs = bv == null ? '' : String(bv);
    const cmp = as.localeCompare(bs, undefined, { numeric: true });
    return sortDesc ? -cmp : cmp;
  });

  const totals = filtered.reduce((acc, o) => {
    acc.count += 1;
    acc.coveredLives += o.covered_lives || 0;
    acc.weightedLives += (o.covered_lives || 0) * effectiveProbability(o);
    return acc;
  }, { count: 0, coveredLives: 0, weightedLives: 0 });

  const fieldUpdate = async (opp, patch) => {
    setSavingId(opp.id);
    setRowError(prev => { const next = { ...prev }; delete next[opp.id]; return next; });
    try {
      await updateOpportunity(businessId, opp.id, patch);
      onPipelineChanged?.();
    } catch (e) {
      setRowError(prev => ({ ...prev, [opp.id]: e.message }));
    } finally {
      setSavingId(null);
    }
  };

  const handleExport = () => {
    exportWidgetCsv(widgetId, sorted, [
      { label: 'Organization', key: 'organization' },
      { label: 'Cohort', key: 'cohort' },
      { label: 'Stage', value: o => STAGE_LABELS[o.stage] || o.stage },
      { label: 'Next Action', key: 'next_action' },
      { label: 'Next Action Date', key: 'next_action_date' },
      { label: 'Expected Close', key: 'expected_close' },
      { label: 'Probability', value: o => formatValue(effectiveProbability(o), 'percent') },
      { label: 'Covered Lives', value: o => formatValue(o.covered_lives, 'number') },
      { label: 'Owner', key: 'owner' },
      { label: 'Top', value: o => (o.is_top ? 'Yes' : 'No') },
    ]);
  };

  const handleImportFile = async file => {
    const text = await file.text();
    setImportMessage('Importing…');
    try {
      const result = await importOpportunitiesCsv(businessId, text);
      setImportMessage(`Imported: ${result.inserted} added, ${result.updated} updated${result.errors.length ? `, ${result.errors.length} errors` : ''}.`);
      onPipelineChanged?.();
    } catch (e) {
      setImportMessage(`Import failed: ${e.message}`);
    }
  };

  const openPanel = async payload => {
    setPanelSaving(true); setPanelError('');
    try {
      if (panelOpp) await updateOpportunity(businessId, panelOpp.id, payload);
      else await createOpportunity(businessId, payload);
      setPanelOpp(undefined);
      onPipelineChanged?.();
    } catch (e) {
      setPanelError(e.message);
    } finally {
      setPanelSaving(false);
    }
  };

  const toggleSort = key => {
    if (sortKey === key) setSortDesc(d => !d);
    else { setSortKey(key); setSortDesc(false); }
  };

  return (
    <div>
      <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <select value={stageFilter} onChange={e => setStageFilter(e.target.value)} style={selectStyle()}>
          <option value="all">All stages</option>
          {STAGE_ENUM.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
        </select>
        <input placeholder="Search organization…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...selectStyle(), flex: '1 1 160px', minWidth: 140 }} />
        <button onClick={() => setPanelOpp(null)} style={addButtonStyle()}>Add opportunity</button>
        <button onClick={() => fileInputRef.current?.click()} style={secondaryButtonStyle()}>Import CSV</button>
        <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) handleImportFile(e.target.files[0]); e.target.value = ''; }} />
        <a href={templateUrl(businessId)} style={{ ...SA_TYPE.body, fontSize: 12, color: SA.accent }}>Template</a>
        <ExportButton onClick={handleExport} />
      </div>
      {importMessage && <p className="no-print" style={{ fontSize: 12, color: SA.muted, margin: '0 0 10px' }}>{importMessage}</p>}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: TABLE_MIN_WIDTH, tableLayout: 'fixed', borderCollapse: 'collapse', ...SA_TYPE.body, fontSize: 13 }}>
          <colgroup>{COLUMNS.map(c => <col key={c.id} style={c.width ? { width: c.width } : undefined} />)}</colgroup>
          <thead>
            <tr>
              <th style={thStyle()} />
              <th style={thStyle(true)} onClick={() => toggleSort('organization')}>Organization</th>
              <th style={thStyle()}>Cohort</th>
              <th style={thStyle()}>Stage</th>
              <th style={thStyle()}>Next Action</th>
              <th style={thStyle(true)} onClick={() => toggleSort('next_action_date')}>Next Date</th>
              <th style={thStyle(true)} onClick={() => toggleSort('expected_close')}>Exp. Close</th>
              <th style={{ ...thStyle(), textAlign: 'right' }}>Prob.</th>
              <th style={{ ...thStyle(true), textAlign: 'right' }} onClick={() => toggleSort('covered_lives')}>Lives</th>
              <th style={thStyle()}>Owner</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(o => {
              const saving = savingId === o.id;
              const overdue = o.next_action_date && o.next_action_date < today;
              const err = rowError[o.id];
              const cellStyle = { padding: '8px 8px', borderBottom: `1px solid ${SA.border}`, color: SA.text };
              return (
                <tr key={o.id}>
                  <td style={{ ...cellStyle, textAlign: 'center' }}>
                    <span
                      className="no-print"
                      onClick={() => !saving && fieldUpdate(o, { is_top: !o.is_top })}
                      style={{ cursor: saving ? 'default' : 'pointer', color: o.is_top ? SA.warn : SA.border, fontSize: 15 }}
                    >
                      {o.is_top ? '★' : '☆'}
                    </span>
                    {/* Print never shows the interactive toggle (no
                        interactive controls in print) - but the star
                        STATE is real information, so a starred row still
                        shows the symbol as plain text; an un-starred row
                        shows nothing rather than a confusing empty box. */}
                    {o.is_top && <span className="print-only" style={{ color: SA.warn, fontSize: 13 }}>★</span>}
                  </td>
                  <td style={{ ...cellStyle, cursor: 'pointer', fontWeight: 500 }} onClick={() => setPanelOpp(o)} title={o.organization}>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.organization}</span>
                    {err && <div style={{ color: SA.bad, fontSize: 9 }}>⚠ {err}</div>}
                  </td>
                  <td style={{ ...cellStyle, color: SA.muted, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.cohort || '—'}</td>
                  <td style={cellStyle}>
                    <select
                      className="no-print" disabled={saving} value={o.stage}
                      onChange={e => fieldUpdate(o, { stage: e.target.value })}
                      style={fieldStyle}
                    >
                      {STAGE_ENUM.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
                    </select>
                    <span className="print-only" style={{ fontSize: 12 }}>{STAGE_LABELS[o.stage]}</span>
                  </td>
                  <td style={cellStyle}>
                    <input
                      className="no-print" disabled={saving} defaultValue={o.next_action || ''}
                      onBlur={e => { if (e.target.value !== (o.next_action || '')) fieldUpdate(o, { next_action: e.target.value || null }); }}
                      style={fieldStyle}
                    />
                    <span className="print-only" style={{ fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.next_action || ''}>{o.next_action || '—'}</span>
                  </td>
                  <td style={{ ...cellStyle, color: overdue ? SA.bad : SA.text, fontWeight: overdue ? 600 : 400 }}>
                    <input
                      className="no-print" type="date" disabled={saving} defaultValue={o.next_action_date || ''}
                      onBlur={e => { if (e.target.value !== (o.next_action_date || '')) fieldUpdate(o, { next_action_date: e.target.value || null }); }}
                      style={fieldStyle}
                    />
                    <span className="print-only" style={{ fontSize: 12 }}>{o.next_action_date || '—'}</span>
                  </td>
                  <td style={cellStyle}>
                    <input
                      className="no-print" type="date" disabled={saving} defaultValue={o.expected_close || ''}
                      onBlur={e => { if (e.target.value !== (o.expected_close || '')) fieldUpdate(o, { expected_close: e.target.value || null }); }}
                      style={fieldStyle}
                    />
                    <span className="print-only" style={{ fontSize: 12 }}>{o.expected_close || '—'}</span>
                  </td>
                  <td style={{ ...cellStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {formatValue(effectiveProbability(o), 'percent')}
                  </td>
                  <td style={{ ...cellStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatValue(o.covered_lives, 'number')}</td>
                  <td style={{ ...cellStyle, color: SA.muted, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.owner || '—'}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} style={{ padding: '8px 8px', borderTop: `2px solid ${SA.border}`, fontWeight: 600, color: SA.text }}>
                {totals.count} opportunities
              </td>
              <td colSpan={5} style={{ padding: '8px 8px', borderTop: `2px solid ${SA.border}`, color: SA.muted, fontSize: 12 }}>
                {formatValue(totals.coveredLives, 'number')} covered lives · {formatValue(Math.round(totals.weightedLives), 'number')} weighted lives
              </td>
              <td colSpan={3} style={{ borderTop: `2px solid ${SA.border}` }} />
            </tr>
          </tfoot>
        </table>
      </div>

      {panelOpp !== undefined && (
        <OpportunityPanel
          opportunity={panelOpp} saving={panelSaving} error={panelError}
          onClose={() => { setPanelOpp(undefined); setPanelError(''); }}
          onSave={openPanel}
          onArchive={async () => {
            setPanelSaving(true); setPanelError('');
            try { await archiveOpportunity(businessId, panelOpp.id); setPanelOpp(undefined); onPipelineChanged?.(); }
            catch (e) { setPanelError(e.message); }
            finally { setPanelSaving(false); }
          }}
        />
      )}
    </div>
  );
}

function thStyle(sortable) {
  return { ...SA_TYPE.label, fontSize: 10, color: SA.muted, textAlign: 'left', padding: '0 8px 8px', borderBottom: `1px solid ${SA.border}`, cursor: sortable ? 'pointer' : 'default' };
}
function selectStyle() {
  return { ...SA_TYPE.body, fontSize: 12, padding: '6px 8px', background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner, color: SA.text };
}
function addButtonStyle() {
  return { ...SA_TYPE.body, fontSize: 12, fontWeight: 600, padding: '6px 12px', background: SA.accent, color: SA.ground, border: 0, borderRadius: SA_SHAPE.radiusInner, cursor: 'pointer' };
}
function secondaryButtonStyle() {
  return { ...SA_TYPE.body, fontSize: 12, padding: '6px 12px', background: 'transparent', color: SA.text, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner, cursor: 'pointer' };
}

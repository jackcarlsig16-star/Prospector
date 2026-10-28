import { SA } from '../../theme';
import DataTable from '../../../../ui/DataTable';
import { sourceColor, SOURCE_LABELS } from '../../palette';
import { numStyle } from '../goalsUi';
import { md } from '../companyPanelFacts';
import { isDimmed, hollowness } from './prioritiesModel';

// intent-score-v1 S3 TABLE - the same rows, legend state and filters as the chart (a lit legend narrows the table
// to those sources); closed-won / pilot rows in a second "Live" group. Company · Score · Band · Source · Owner ·
// Visits 7d · People · Last touch · Employees · Stage · Researched (+ Change when "Since yesterday" is on).
const TYPE_WORD = { partner: 'Partner', employer: 'Employer', target: 'Target' };
const RESEARCHED = { fresh: 'Yes', decayed: '> 60 d', none: 'No' };
const n = v => (v == null ? '—' : Number(v).toLocaleString('en-US'));

// FIX priorities-select-vs-open-v1: the name click selects (double-click opens); "Open" is the deliberate opener.
export default function PrioritiesTable({ rows, live = [], lit, selectedKey, onSelect, onOpen, showTrend = false, phone = false }) {
  const visible = rows.filter(r => !isDimmed(r, lit));
  const liveVisible = live.filter(r => !isDimmed(r, lit));
  const columns = [
    { id: 'name', label: 'Company', sticky: true, width: 220, sortValue: r => r.name, render: r => (
      <button type="button" className="ui-link ui-link--cell" data-row-name aria-pressed={r.key === selectedKey} onClick={e => { if (e.detail > 1) return; onSelect && onSelect(r); }} onDoubleClick={() => onOpen && onOpen(r)} style={{ fontWeight: r.key === selectedKey ? 600 : 500 }}>{r.name}</button>
    ), title: r => `${r.name} · ${TYPE_WORD[r.type] || r.type}` },
    { id: 'open', label: '', width: 56, render: r => <button type="button" className="ui-link" data-row-open aria-label={`Open ${r.name}`} onClick={() => onOpen && onOpen(r)}>Open</button> },
    { id: 'score', label: 'Score', width: 70, sortValue: r => r.score, render: r => <span style={{ ...numStyle, fontWeight: 600 }}>{r.score}</span> },
    { id: 'band', label: 'Band', width: 60, sortValue: r => r.band, render: r => <span style={numStyle}>{r.band}</span> },
    { id: 'source', label: 'Source', width: 140, sortValue: r => r.source_label, render: r => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: sourceColor(r.source_label), flex: 'none' }} />{SOURCE_LABELS[r.source_label] || r.source_label}{r.touch_locked ? ' · no double touch' : ''}</span>
    ) },
    { id: 'owner', label: 'Owner', width: 110, sortValue: r => r.owner || '', render: r => <span style={{ color: r.owner ? SA.text : SA.muted }}>{r.owner || 'Unassigned'}</span> },
    { id: 'visits', label: 'Visits 7d', width: 80, sortValue: r => r.visits_7d, render: r => <span style={numStyle}>{n(r.visits_7d)}</span> },
    { id: 'people', label: 'People', width: 70, sortValue: r => r.people, render: r => <span style={numStyle}>{n(r.people)}</span> },
    { id: 'touch', label: 'Last touch', width: 100, sortValue: r => r.last_touch_at, render: r => <span style={{ color: r.last_touch_at ? SA.text : SA.muted }}>{r.last_touch_at ? md(r.last_touch_at) : 'never'}</span> },
    { id: 'employees', label: 'Employees', width: 90, sortValue: r => r.employees, render: r => <span style={numStyle}>{n(r.employees)}</span> },
    { id: 'stage', label: 'Stage', width: 120, sortValue: r => r.stage || '', render: r => <span>{String(r.stage || '—').replace(/_/g, ' ')}</span> },
    { id: 'researched', label: 'Researched', width: 90, sortValue: r => r.researched, render: r => <span style={{ color: hollowness(r) === 'solid' ? SA.text : SA.muted }}>{RESEARCHED[r.researched] || 'No'}</span> },
    ...(showTrend ? [{ id: 'change', label: 'Change', width: 80, sortValue: r => (r.trend === 'up' ? 1 : r.trend === 'down' ? -1 : 0), render: r => (r.band_changed ? <span data-trend={r.trend} style={{ color: r.trend === 'up' ? SA.good : SA.bad }}>{r.trend === 'up' ? '▲' : '▼'} {r.prev_band} → {r.band}</span> : <span style={{ color: SA.muted }}>—</span>) }] : []),
  ];
  const groups = [
    { id: 'ranked', header: `Ranked (${visible.length})`, rows: visible },
    ...(liveVisible.length ? [{ id: 'live', header: `Live · closed-won or pilot (${liveVisible.length})`, rows: liveVisible }] : []),
  ];
  const compactRow = r => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: sourceColor(r.source_label), flex: 'none' }} />
      <button type="button" className="ui-link ui-link--cell" data-row-name aria-pressed={r.key === selectedKey} onClick={() => onSelect && onSelect(r)} style={{ flex: 1, textAlign: 'left', fontWeight: r.key === selectedKey ? 600 : 500 }}>{r.name}</button>
      <span style={{ ...numStyle, fontWeight: 600 }}>{r.score}</span><span style={{ ...numStyle, color: SA.muted }}>{r.band}</span>
      <button type="button" className="ui-link" data-row-open aria-label={`Open ${r.name}`} onClick={() => onOpen && onOpen(r)}>Open</button>
    </div>
  );
  return (
    <div className="ui-theme-dark">
      <DataTable label="Priorities" columns={columns} groups={groups} rowKey={r => r.key} rowStyle={r => (r.key === selectedKey ? { '--ui-row-tint': `color-mix(in srgb, ${SA.accent} 10%, transparent)` } : undefined)}
        dense compact={phone} renderCompact={compactRow} emptyText="No companies under these filters." />
    </div>
  );
}

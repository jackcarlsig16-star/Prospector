import { useState, useEffect, useRef } from 'react';
import { SA } from '../../theme';
import DataTable, { sortRows } from '../../../../ui/DataTable';
import { sourceColor, SOURCE_LABELS } from '../../palette';
import { numStyle } from '../goalsUi';
import { isDimmed, hollowness, DEFAULT_CAPS } from './prioritiesModel';
import { BAND_COLOR } from './DotsChart';

// priorities-v2 T - the detail table: the chart's rows (same page, legend state and filters) as # · Company · Source ·
// Intent · Visits · People · Fit · Research · Engagement · Touched · Band (+ Change while "Since yesterday" is on). A row
// press SELECTS - the chart's dot with it, and a dot press highlights its row and scrolls it into view; the Company name
// OPENS the company window. Default sort Intent desc; the first 10 show until "Show 11-40". Closed-won / pilot rows in a
// second "Live" group. Also the whole view in Table mode and on a phone (compact list).
export const COLLAPSED = 10;
const DEFAULT_SORT = { id: 'score', dir: 'desc' };
const touched = r => (r.days_since_touch == null ? '—' : `${r.days_since_touch} d`);
const n = v => (v == null ? '—' : Number(v).toLocaleString('en-US'));
export const BandPill = ({ band }) => (
  <span data-band-pill={band} style={{ display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 7px', borderRadius: 999, border: `1px solid ${BAND_COLOR[band] || SA.border}`, color: BAND_COLOR[band] || SA.muted, font: "500 11px 'Geist Mono', ui-monospace, monospace", letterSpacing: '.06em' }}>{band}</span>
);

export default function PrioritiesTable({ rows, live = [], lit, selectedKey, onSelect, onOpen, showTrend = false, phone = false, caps = DEFAULT_CAPS, from = 1, collapsible = true }) {
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [expanded, setExpanded] = useState(!collapsible);
  const boxRef = useRef(null);
  const visible = rows.filter(r => !isDimmed(r, lit));
  const liveVisible = live.filter(r => !isDimmed(r, lit));
  const columns = [
    { id: 'rank', label: '#', width: 48, sortValue: r => r.rank, render: r => <span style={{ ...numStyle, color: SA.muted }}>{r.rank ?? '—'}</span> },
    { id: 'name', label: 'Company', sticky: true, width: 220, sortValue: r => r.name, render: r => (
      <button type="button" className="ui-link ui-link--cell" data-row-name title="Open the company window" onClick={() => onOpen && onOpen(r)} style={{ fontWeight: r.key === selectedKey ? 600 : 500 }}>{r.name}</button>
    ) },
    { id: 'source', label: 'Source', width: 150, sortValue: r => r.source_label, render: r => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: sourceColor(r.source_label), flex: 'none' }} />{SOURCE_LABELS[r.source_label] || r.source_label}{r.touch_locked ? ' · no double touch' : ''}</span>
    ) },
    { id: 'score', label: 'Intent', width: 76, sortValue: r => r.score, render: r => <span style={{ ...numStyle, fontWeight: 600 }}>{r.score}</span> },
    { id: 'visits', label: 'Visits', width: 66, sortValue: r => r.visits_7d, render: r => <span style={numStyle}>{n(r.visits_7d)}</span> },
    { id: 'people', label: 'People', width: 66, sortValue: r => r.people, render: r => <span style={numStyle}>{n(r.people)}</span> },
    { id: 'fit', label: 'Fit', width: 62, sortValue: r => r.components?.fit?.points ?? null, render: r => <span style={numStyle}>{r.components?.fit ? `${r.components.fit.points}/${caps.fit ?? DEFAULT_CAPS.fit}` : '—'}</span> },
    { id: 'research', label: 'Research', width: 78, sortValue: r => (hollowness(r) === 'solid' ? 2 : hollowness(r) === 'decayed' ? 1 : 0), render: r => <span title={hollowness(r) === 'decayed' ? 'Research older than 60 days' : undefined} style={{ color: hollowness(r) === 'hollow' ? SA.muted : SA.text }}>{hollowness(r) === 'solid' ? '✓' : hollowness(r) === 'decayed' ? '✓ old' : '—'}</span> },
    { id: 'engagement', label: 'Engagement', width: 92, sortValue: r => r.components?.engagement?.points ?? null, render: r => <span style={numStyle}>{n(r.components?.engagement?.points)}</span> },
    { id: 'touched', label: 'Touched', width: 76, sortValue: r => (r.days_since_touch == null ? null : -r.days_since_touch), render: r => <span style={{ ...numStyle, color: r.days_since_touch == null ? SA.muted : SA.text }}>{touched(r)}</span> },
    { id: 'band', label: 'Band', width: 64, sortValue: r => r.band, render: r => <BandPill band={r.band} /> },
    ...(showTrend ? [{ id: 'change', label: 'Change', width: 90, sortValue: r => (r.trend === 'up' ? 1 : r.trend === 'down' ? -1 : 0), render: r => (r.band_changed ? <span data-trend={r.trend} style={{ color: r.trend === 'up' ? SA.good : SA.bad }}>{r.trend === 'up' ? '▲' : '▼'} {r.prev_band} → {r.band}</span> : <span style={{ color: SA.muted }}>—</span>) }] : []),
  ];
  const sortCol = columns.find(c => c.id === sort?.id) || null;
  const ordered = sortRows(visible, sortCol, sort?.dir);
  const selIndex = ordered.findIndex(r => r.key === selectedKey);
  // A dot selected below the fold opens the rest, then its row scrolls into view.
  useEffect(() => { if (selIndex >= COLLAPSED) setExpanded(true); }, [selIndex]);
  useEffect(() => {
    if (!selectedKey) return;
    const el = boxRef.current?.querySelector(`[data-row][data-key="${selectedKey}"]`);
    if (el?.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [selectedKey, expanded]);
  const shown = expanded ? ordered : ordered.slice(0, COLLAPSED);
  const groups = [
    { id: 'ranked', header: `Ranked (${visible.length})`, rows: shown },
    ...(liveVisible.length ? [{ id: 'live', header: `Live · closed-won or pilot (${liveVisible.length})`, rows: liveVisible }] : []),
  ];
  const compactRow = r => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
      <span style={{ ...numStyle, color: SA.muted, minWidth: 22 }}>{r.rank ?? ''}</span>
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: sourceColor(r.source_label), flex: 'none' }} />
      <span style={{ flex: 1, minWidth: 0, fontWeight: r.key === selectedKey ? 600 : 500, color: SA.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
      <span style={{ ...numStyle, fontWeight: 600 }}>{r.score}</span><BandPill band={r.band} />
      <button type="button" className="ui-link" data-row-name aria-label={`Open ${r.name}`} onClick={() => onOpen && onOpen(r)}>Open</button>
    </div>
  );
  return (
    <div ref={boxRef} className="ui-theme-dark" data-detail-table data-keeps-selection>
      <DataTable label="Map detail" columns={columns} groups={groups} rowKey={r => r.key} sort={sort} onSort={setSort} onRowClick={r => onSelect && onSelect(r)}
        rowStyle={r => ({ cursor: 'pointer', ...(r.key === selectedKey ? { '--ui-row-tint': `color-mix(in srgb, ${SA.accent} 14%, transparent)`, '--ui-row-bar': SA.accent } : {}) })}
        dense compact={phone} renderCompact={compactRow} emptyText="No companies under these filters." />
      {!expanded && ordered.length > COLLAPSED && (
        <button type="button" className="ui-btn ui-btn--tertiary ui-btn--sm" data-show-more onClick={() => setExpanded(true)} style={{ marginTop: 6 }}>
          Show {from + COLLAPSED}–{from + ordered.length - 1} ▾
        </button>
      )}
    </div>
  );
}

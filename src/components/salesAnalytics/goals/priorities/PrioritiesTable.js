import { useState, useEffect, useRef } from 'react';
import { SA } from '../../theme';
import DataTable, { sortRows } from '../../../../ui/DataTable';
import { sourceColor, SOURCE_LABELS } from '../../palette';
import { numStyle } from '../goalsUi';
import { isDimmed, hollowness, DEFAULT_CAPS } from './prioritiesModel';
import { BAND_COLOR } from './DotsChart';
import { ownerChip } from '../flowModel';
import { FIT_WORD } from '../../../../constants/fitLevels';
import { md } from '../companyPanelFacts';
import { headcountSortValue, HEADCOUNT_SOURCE_GLYPH, HEADCOUNT_SOURCE_WORD } from '../../../../constants/headcount';

// priorities-v2 T - the detail table: the chart's rows (same page, legend state and filters) as # · Company · Source ·
// Intent · Visits · People · Fit · Research · Engagement · Touched · Band (+ Change while "Since yesterday" is on). A row
// press SELECTS - the chart's dot with it, and a dot press highlights its row and scrolls it into view; the Company name
// OPENS the company window. Default sort Intent desc; the first 10 show until "Show 11-40". Closed-won / pilot rows in a
// second "Live" group. Also the whole view in Table mode and on a phone (compact list).
export const COLLAPSED = 10;
// homelover-flow-v1 F11: newest visitor first (first seen on the site), then the rank; the Intent header re-sorts.
const DEFAULT_SORT = { id: 'seen', dir: 'desc' };
const FIT_COLOR = { strong: SA.good, good: SA.accent, low: SA.muted, deprioritized: SA.bad };
const touched = r => (r.days_since_touch == null ? '—' : `${r.days_since_touch} d`);
const n = v => (v == null ? '—' : Number(v).toLocaleString('en-US'));
// heat-size-v1 S1: the number with its source glyph (◇ Apollo · ✎ typed · ◆ researched), "unknown" never blank.
export const HeadcountCell = ({ employees, source }) => (employees == null
  ? <span data-headcount="unknown" style={{ color: SA.muted }}>unknown</span>
  : <span data-headcount={source || 'none'} style={{ ...numStyle, display: 'inline-flex', gap: 4, alignItems: 'baseline' }}>{n(employees)}{HEADCOUNT_SOURCE_GLYPH[source] && <span style={{ color: SA.muted, fontSize: 11 }}><span aria-hidden="true">{HEADCOUNT_SOURCE_GLYPH[source]}</span><span className="ui-sr-only"> {HEADCOUNT_SOURCE_WORD[source]}</span></span>}</span>);
export const headcountTitle = r => (r.employees == null ? 'Headcount unknown - type it in the company window (Employees)' : `${n(r.employees)} employees · ${HEADCOUNT_SOURCE_WORD[r.employees_source] || 'source unknown'}`);
export const BandPill = ({ band }) => (
  <span data-band-pill={band} style={{ display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 7px', borderRadius: 999, border: `1px solid ${BAND_COLOR[band] || SA.border}`, color: BAND_COLOR[band] || SA.muted, font: "500 11px 'Geist Mono', ui-monospace, monospace", letterSpacing: '.06em' }}>{band}</span>
);

export default function PrioritiesTable({ rows, live = [], lit, selectedKey, onSelect, onOpen, showTrend = false, phone = false, caps = DEFAULT_CAPS, from = 1, collapsible = true, members = [], meId = null, reach = null }) {
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [expanded, setExpanded] = useState(!collapsible);
  const boxRef = useRef(null);
  const visible = rows.filter(r => !isDimmed(r, lit, meId));
  const liveVisible = live.filter(r => !isDimmed(r, lit, meId));
  const owner = r => ownerChip({ ownerUserId: r.owner_user_id, ownerTeam: r.owner_team, coOwnerName: r.co_owner_name, members, meId });
  const reached = r => reach?.[`${r.type}:${r.id}`] || null;
  const columns = [
    { id: 'rank', label: '#', width: 48, sortValue: r => r.rank, render: r => <span style={{ ...numStyle, color: SA.muted }}>{r.rank ?? '—'}</span> },
    { id: 'name', label: 'Company', sticky: true, width: 220, sortValue: r => r.name, render: r => (
      <button type="button" className="ui-link ui-link--cell" data-row-name title="Open the company window" onClick={() => onOpen && onOpen(r)} style={{ fontWeight: r.key === selectedKey ? 600 : 500 }}>{r.name}</button>
    ) },
    { id: 'source', label: 'Source', width: 150, sortValue: r => r.source_label, render: r => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: sourceColor(r.source_label), flex: 'none' }} />{SOURCE_LABELS[r.source_label] || r.source_label}{r.touch_locked ? ' · no double touch' : ''}</span>
    ) },
    { id: 'seen', label: 'Seen', width: 84, sortValue: r => r.first_seen || '', render: r => (r.first_seen ? <span style={{ ...numStyle, display: 'inline-flex', gap: 6, alignItems: 'center' }}>{md(r.first_seen)}{r.new_today && <span data-new-badge style={{ fontSize: 10, color: SA.accent, border: `1px solid ${SA.accent}`, borderRadius: 999, padding: '0 5px' }}>NEW</span>}</span> : <span style={{ color: SA.muted }}>—</span>), title: r => (r.first_seen ? `First seen on the site ${r.first_seen}` : 'No website visit') },
    { id: 'owner', label: 'Owner', width: 96, sortValue: r => owner(r).word, render: r => { const o = owner(r); return <span data-owner-cell={o.kind} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: o.dashed ? 'transparent' : o.color, border: o.dashed ? `1.5px dashed ${o.color}` : 'none', flex: 'none' }} />{o.word}</span>; } },
    { id: 'fit_level', label: 'Fit', width: 92, sortValue: r => (r.fit_level === 'deprioritized' ? -1 : r.fit_score ?? -0.5), render: r => (r.fit_level ? <span data-fit-cell={r.fit_level} style={{ ...numStyle, color: FIT_COLOR[r.fit_level] }}>{r.fit_level === 'deprioritized' ? 'Deprior.' : `${FIT_WORD[r.fit_level]}${r.fit_score != null ? ` ${r.fit_score}` : ''}`}</span> : <span style={{ color: SA.muted }}>—</span>) },
    { id: 'reached', label: 'Reached', width: 76, sortValue: r => reached(r)?.reached ?? null, render: r => { const x = reached(r); return x && x.known ? <span data-reached-cell style={numStyle}>{x.reached}/{x.known}</span> : <span style={{ color: SA.muted }}>—</span>; }, title: r => { const x = reached(r); return x && x.known ? `${x.reached} of ${x.known} people reached · ${x.replies} replies` : 'Nobody known yet'; } },
    { id: 'score', label: 'Intent', width: 76, sortValue: r => r.score, render: r => <span style={{ ...numStyle, fontWeight: 600 }}>{r.score}</span> },
    { id: 'visits', label: 'Visits', width: 66, sortValue: r => r.visits_7d, render: r => <span style={numStyle}>{n(r.visits_7d)}</span> },
    { id: 'people', label: 'People', width: 66, sortValue: r => r.people, render: r => <span style={numStyle}>{n(r.people)}</span> },
    { id: 'employees', label: 'Headcount', width: 100, sortValue: r => headcountSortValue(r.employees), render: r => <HeadcountCell employees={r.employees} source={r.employees_source} />, title: headcountTitle },
    { id: 'fit', label: 'Size pts', width: 70, sortValue: r => r.components?.fit?.points ?? null, render: r => <span style={numStyle}>{r.components?.fit ? `${r.components.fit.points}/${caps.fit ?? DEFAULT_CAPS.fit}` : '—'}</span> },
    { id: 'research', label: 'Research', width: 78, sortValue: r => (hollowness(r) === 'solid' ? 2 : hollowness(r) === 'decayed' ? 1 : 0), render: r => <span title={hollowness(r) === 'decayed' ? 'Research older than 60 days' : undefined} style={{ color: hollowness(r) === 'hollow' ? SA.muted : SA.text }}>{hollowness(r) === 'solid' ? '✓' : hollowness(r) === 'decayed' ? '✓ old' : '—'}</span> },
    { id: 'engagement', label: 'Engagement', width: 92, sortValue: r => r.components?.engagement?.points ?? null, render: r => <span style={numStyle}>{n(r.components?.engagement?.points)}</span> },
    { id: 'touched', label: 'Touched', width: 76, sortValue: r => (r.days_since_touch == null ? null : -r.days_since_touch), render: r => <span style={{ ...numStyle, color: r.days_since_touch == null ? SA.muted : SA.text }}>{touched(r)}</span> },
    { id: 'band', label: 'Band', width: 64, sortValue: r => r.band, render: r => <BandPill band={r.band} /> },
    ...(showTrend ? [{ id: 'change', label: 'Change', width: 90, sortValue: r => (r.trend === 'up' ? 1 : r.trend === 'down' ? -1 : 0), render: r => (r.band_changed ? <span data-trend={r.trend} style={{ color: r.trend === 'up' ? SA.good : SA.bad }}>{r.trend === 'up' ? '▲' : '▼'} {r.prev_band} → {r.band}</span> : <span style={{ color: SA.muted }}>—</span>) }] : []),
  ];
  const sortCol = columns.find(c => c.id === sort?.id) || null;
  const ordered = sort?.id === 'seen' ? [...visible].sort((a, b) => String(b.first_seen || '').localeCompare(String(a.first_seen || '')) * (sort.dir === 'desc' ? 1 : -1) || (b.score - a.score)) : sortRows(visible, sortCol, sort?.dir);
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
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontWeight: r.key === selectedKey ? 600 : 500, color: SA.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
        <span data-card-size style={{ fontSize: 12, color: SA.muted }} title={headcountTitle(r)}><HeadcountCell employees={r.employees} source={r.employees_source} /></span>
      </span>
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

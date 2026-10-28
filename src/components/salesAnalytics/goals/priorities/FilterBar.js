import { useId } from 'react';
import { SA } from '../../theme';
import { numStyle } from '../goalsUi';
import { ToggleChip, ActiveFilterChip } from '../../../../ui/Chip';
import { IconSearch } from '../../../../ui/icons';
import { SEGMENTS, WINDOWS, BANDS, EMPTY_FILTERS } from './prioritiesModel';

// priorities-v2 F - the FILTER card: what's in the set. Type chips with their counts (counts.segments, over the
// unfiltered ranked set) · labeled selects (mono label above, 30 px) · min score · Needs a touch · search. A second line
// only while something narrows the set: "Showing n of m ·" + one removable chip per active filter + Clear all.
const divider = <span aria-hidden="true" style={{ width: 1, height: 28, background: SA.border, flex: 'none' }} />;
const selectStyle = { height: 30, borderRadius: 8, minWidth: 120 };

function Labeled({ label, value, options, onChange }) {
  const id = useId();
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 3 }}>
      <label htmlFor={id} className="ui-group-label">{label}</label>
      <select id={id} className="ui-filter__select" value={value} onChange={e => onChange(e.target.value)} style={selectStyle}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </span>
  );
}

export function activeFilters(f, { members = [] } = {}) {
  const owner = f.owner === 'unassigned' ? 'Unassigned' : members.find(m => m.user_id === f.owner)?.name || 'owner';
  return [
    f.segment !== 'all' && { key: 'segment', text: `Type: ${SEGMENTS.find(([id]) => id === f.segment)?.[1]}` },
    f.owner && { key: 'owner', text: `Owner: ${owner}` },
    f.band && { key: 'band', text: `Band: ${f.band}` },
    f.window && { key: 'window', text: WINDOWS.find(([id]) => id === f.window)?.[1] },
    f.min > 0 && { key: 'min', text: `Min score ${f.min}` },
    f.needs_touch && { key: 'needs_touch', text: 'Needs a touch' },
    f.source.length > 0 && { key: 'source', text: `Source: ${f.source.length}` },
    f.q && { key: 'q', text: `"${f.q}"` },
  ].filter(Boolean);
}

export default function FilterBar({ filters, set, onClear, data, members }) {
  const seg = data?.counts?.segments || {};
  const active = activeFilters(filters, { members });
  const ownerOpts = [{ value: '', label: 'All owners' }, ...members.filter(m => m.role !== 'viewer').map(m => ({ value: m.user_id, label: m.name })), { value: 'unassigned', label: 'Unassigned' }];
  return (
    <div role="group" aria-label="Filters" data-filter-row style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
        <h2 className="ui-group-label" style={{ alignSelf: 'center', margin: 0 }}>Filter</h2>
        <div role="group" aria-label="Type" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {SEGMENTS.map(([id, label]) => <ToggleChip key={id} data-segment={id} pressed={filters.segment === id} count={seg[id] ?? ''} onClick={() => set('segment', id)}>{label}</ToggleChip>)}
        </div>
        {divider}
        <Labeled label="Owner" value={filters.owner} options={ownerOpts} onChange={v => set('owner', v)} />
        <Labeled label="Band" value={filters.band} options={[{ value: '', label: 'All bands' }, ...BANDS.map(b => ({ value: b, label: b }))]} onChange={v => set('band', v)} />
        <Labeled label="Window" value={filters.window} options={WINDOWS.map(([value, label]) => ({ value, label }))} onChange={v => set('window', v)} />
        <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 3 }}>
          <span className="ui-group-label" aria-hidden="true">Min score</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30 }}>
            <input type="range" min={0} max={100} step={5} value={filters.min} aria-label="Minimum score" onChange={e => set('min', Number(e.target.value))} style={{ width: 96 }} />
            <span style={{ ...numStyle, minWidth: 22, fontSize: 13, color: SA.text }}>{filters.min}</span>
          </span>
        </span>
        {divider}
        <ToggleChip pressed={filters.needs_touch} count={data?.counts?.needs_touch ?? ''} title={data ? `Score ≥ ${data.needs_touch_rule.min} and no touch in ${data.needs_touch_rule.days} days` : undefined} onClick={() => set('needs_touch', !filters.needs_touch)}>Needs a touch</ToggleChip>
        <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', flex: '1 1 160px', minWidth: 140, maxWidth: 240, color: SA.muted }}>
          <span style={{ position: 'absolute', left: 9, display: 'inline-flex', pointerEvents: 'none' }}><IconSearch size={13} /></span>
          <input type="search" className="ui-input ui-input--sm" aria-label="Search companies" placeholder="Search companies" value={filters.q} onChange={e => set('q', e.target.value)} style={{ width: '100%', height: 30, paddingLeft: 28 }} />
        </span>
      </div>
      {active.length > 0 && (
        <div data-active-filters style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12, color: SA.muted }}>
          <span style={numStyle}>Showing {data?.counts?.shown ?? '…'} of {data?.counts?.ranked ?? '…'} ·</span>
          {active.map(a => <ActiveFilterChip key={a.key} onRemove={() => set(a.key, EMPTY_FILTERS[a.key])}>{a.text}</ActiveFilterChip>)}
          <button type="button" className="ui-link" onClick={onClear}>Clear all</button>
        </div>
      )}
    </div>
  );
}

import { SA } from '../theme';
import { numStyle } from './goalsUi';
import Button from '../../../ui/Button';
import FilterSelect from '../../../ui/FilterSelect';
import { ToggleChip, ActiveFilterLine } from '../../../ui/Chip';
import * as Icons from '../../../ui/icons';
import { OWNER_TEAMS, TEAM_LABEL } from '../../../constants/ownership';
import { TIERS } from '../../../constants/partnerPipeline';
import { PRIORITIES } from '../../../constants/salesChannels';
import { TYPE_OPTIONS, EMPTY_FILTERS, CHANNEL_BUTTON_ICON, orderedChannelButtons, activeFilters } from './companiesModel';

// companies-v2 C3 - Pipeline › Companies' filter card: CHANNEL (chips with glyphs and counts; a channel with nothing
// under it dashed and last) · FILTER (search, six one-piece selects, then the yes/no toggles) · the active-filter line
// (the kit's ActiveFilterLine, shared with priorities-v2's FilterBar). The phone keeps the Filters button + sheet.
const LABEL_WIDTH = 64;
const line = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 };
const divider = <span aria-hidden="true" style={{ width: 1, height: 22, background: SA.border, flex: 'none', margin: '0 4px' }} />;
const opts = (first, list) => [{ value: '', label: first }, ...list];

export function FilterControls({ filters, set, owners, stages, phone, searchRef }) {
  return (
    <>
      <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', flex: 'none', color: SA.muted }}>
        <span style={{ position: 'absolute', left: 9, display: 'inline-flex', pointerEvents: 'none' }}><Icons.IconSearch size={13} /></span>
        <input ref={searchRef} type="search" className="ui-input ui-input--sm" aria-label="Search companies" placeholder="Search companies" value={filters.q} onChange={e => set('q', e.target.value)}
          style={{ width: phone ? 160 : 220, height: 30, paddingLeft: 28, flex: 'none' }} />
      </span>
      <FilterSelect variant="pill" label="Owner" value={filters.owner} options={opts('All', owners.map(o => ({ value: o, label: o })))} onChange={v => set('owner', v)} />
      <FilterSelect variant="pill" label="Team" value={filters.ownerTeam} options={[...opts('All', OWNER_TEAMS.map(t => ({ value: t, label: TEAM_LABEL[t] }))), { value: 'unset', label: 'No team set' }]} onChange={v => set('ownerTeam', v)} />
      <FilterSelect variant="pill" label="Type" value={filters.type} options={opts('All', TYPE_OPTIONS.map(([value, label]) => ({ value, label })))} onChange={v => set('type', v)} />
      <FilterSelect variant="pill" label="Stage" value={filters.stage} options={opts('All', stages.map(s => ({ value: s, label: s })))} onChange={v => set('stage', v)} />
      <FilterSelect variant="pill" label="Priority" value={filters.priority} options={[...opts('All', PRIORITIES.map(p => ({ value: String(p), label: `P${p}` }))), { value: 'none', label: 'No priority' }]} onChange={v => set('priority', v)} />
      <FilterSelect variant="pill" label="Tier" value={filters.tier} options={opts('All', TIERS.map(t => ({ value: t, label: t === 'active' ? 'Active' : `T${t}` })))} onChange={v => set('tier', v)} />
      {divider}
      <ToggleChip pressed={filters.visited} onClick={() => set('visited', !filters.visited)}><Icons.IconGlobe size={12} />Visited 7 d</ToggleChip>
      <ToggleChip pressed={filters.hasTodo} onClick={() => set('hasTodo', !filters.hasTodo)}><Icons.IconTodo size={12} />Has open to-do</ToggleChip>
      <ToggleChip pressed={filters.overdue} onClick={() => set('overdue', !filters.overdue)}><Icons.IconClock size={12} />Overdue</ToggleChip>
    </>
  );
}

export default function CompaniesFilters({ channel, onChannel, counts, filters, set, onClear, owners, stages, phone, searchRef, shown, total, sortLabel, onOpenSheet, sheetOpen }) {
  const active = activeFilters(filters);
  return (
    <div data-filter-card style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '10px 14px', background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: 10, minWidth: 0 }}>
      <div role="group" aria-label="Channel" data-channel-row style={line}>
        <span className="ui-group-label" aria-hidden="true" style={{ width: LABEL_WIDTH, flex: 'none' }}>Channel</span>
        {orderedChannelButtons(counts).map(([id, label]) => {
          const Icon = Icons[CHANNEL_BUTTON_ICON[id]];
          return (
            <ToggleChip key={id} pressed={channel === id} data-channel={id} count={counts ? counts[id] : ''} className={counts && !counts[id] ? 'ui-chip--empty' : undefined} onClick={() => onChannel(id)}>
              <Icon size={12} />{label}
            </ToggleChip>
          );
        })}
      </div>
      {phone ? (
        <div data-filter-row style={line}>
          <Button aria-expanded={sheetOpen} onClick={onOpenSheet}>Filters{active.length ? ` (${active.length})` : ''}</Button>
          <span style={{ fontSize: 13, color: SA.muted, ...numStyle }}>{counts ? `${shown} shown` : ''}</span>
        </div>
      ) : (
        <div role="group" aria-label="Filters" data-filter-row style={line}>
          <span className="ui-group-label" aria-hidden="true" style={{ width: LABEL_WIDTH, flex: 'none' }}>Filter</span>
          <FilterControls filters={filters} set={set} owners={owners} stages={stages} searchRef={searchRef} />
        </div>
      )}
      <ActiveFilterLine summary={`Showing ${shown} of ${total} · sorted by ${sortLabel} ·`} active={active} onRemove={k => set(k, EMPTY_FILTERS[k])} onClear={onClear}
        style={phone ? undefined : { paddingLeft: LABEL_WIDTH + 6 }} />
    </div>
  );
}

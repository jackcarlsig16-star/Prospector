import React from 'react';
import Button from '../../ui/Button';
import { Icon } from '../HkMarks';
import BrandsScreen from './BrandsScreen';
import SponsorsScreen from '../screens/SponsorsScreen';
import ActiveFilters from '../nav/ActiveFilters';
import { VIEW_LABELS, BRAND_BUCKETS, valueLabel, toggleValue, activeCount, layoutOf } from '../nav/filterState';

// grow-nav-filters-v1 N3 / N5 / N10 - the Brands space: one list for what were Brands, Pipeline and Sponsors. The rail
// sets the view and filters (in the address); this shows the active-filter line, Table | By stage, and the list. The
// Sponsors view hosts the existing Sponsors screen (months, Add sponsor, do-not-contact) until the brands sheet.
const plural = (n, w) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`;
const DEFAULT_DIR = { name: 'asc', status: 'asc', last_touch: 'desc', next_due: 'asc', created: 'desc', heat: 'desc', score: 'desc' };
// grow-ui-refresh U6 - the Sort control beside Table | By stage (mockup 3: "Score, high to low").
export const SORT_CHOICES = [['score', 'Score, high to low'], ['heat', 'Heat, hottest first'], ['last_touch', 'Last touch, newest first'], ['name', 'Name, A to Z'], ['status', 'Stage'], ['next_due', 'Next due, soonest first'], ['created', 'Newest added']];

export default function BrandsSpace({ businessId, shell, compact, canEdit, state, setState, list, savedName, onSaveView, onOpenFilters, onOpenBrand, onGo, intent, onIntentDone }) {
  const meId = shell?.me?.user_id, members = shell?.members || [];
  const label = k => BRAND_BUCKETS.find(b => b.key === k)?.label || k;
  const chips = [
    ...(state.view !== 'all' && !state.saved ? [{ key: 'view', label: `View: ${VIEW_LABELS[state.view]}`, onRemove: () => setState({ ...state, view: 'all' }) }] : []),
    ...Object.entries(state.filters).flatMap(([k, vs]) => vs.map(v => ({ key: `${k}:${v}`, label: `${label(k)}: ${valueLabel(k, v, { meId, members })}`, onRemove: () => setState(toggleValue(state, k, v)) }))),
    ...(state.q ? [{ key: 'q', label: `Name: ${state.q}`, onRemove: () => setState({ ...state, q: '' }) }] : []),
  ];
  const layout = layoutOf(state);
  const sponsors = state.view === 'sponsors' && !state.saved && !Object.keys(state.filters).length;
  const count = list.rows === null ? 'Loading…' : plural(list.total, 'brand');
  const sort = state.sort ? { id: state.sort, dir: state.dir || DEFAULT_DIR[state.sort] || 'asc' } : layout === 'stage' ? { id: 'status', dir: 'asc' } : null;
  const n = activeCount(state);
  return (
    <div data-hk-brands-space>
      <header className="hk-space__head">
        <div>
          <h1 className="hk-head__title">{savedName || (state.view === 'all' ? 'Brands' : VIEW_LABELS[state.view])}</h1>
          <p className="hk-head__line">{sponsors ? 'Current sponsors, founding partners and do-not-contact.' : 'Every brand and who owns it. Filter from the rail; the address keeps the view.'}</p>
        </div>
        <span className="hk-spacer" />
        {compact && <Button size="sm" onClick={onOpenFilters} data-hk-open-filters><Icon name="filter" size={16} /> Filters{n ? ` (${n})` : ''}</Button>}
        {!sponsors && (
          <label className="hk-sortpick">Sort
            <select className="ui-input ui-input--sm" aria-label="Sort" value={state.sort || ''} onChange={e => setState({ ...state, sort: e.target.value || null, dir: null })} data-hk-sort>
              <option value="">Name, A to Z (default)</option>{SORT_CHOICES.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
            </select>
          </label>
        )}
        {!sponsors && (
          <div className="ui-seg" role="group" aria-label="Layout" data-hk-layout>
            {[['table', 'Table'], ['stage', 'By stage']].map(([id, l]) => <button key={id} type="button" className="ui-seg__btn" aria-pressed={layout === id} onClick={() => setState({ ...state, layout: id })} data-hk-layout-btn={id}>{l}</button>)}
          </div>
        )}
      </header>
      <ActiveFilters chips={chips} count={count} savedAs={savedName} onClear={() => setState({ view: 'all', filters: {}, q: '', sort: null, dir: null, layout: null, saved: null })} onSave={onSaveView} />
      {sponsors
        ? <SponsorsScreen businessId={businessId} shell={shell} canEdit={canEdit} onOpenBrand={onOpenBrand} />
        : <BrandsScreen businessId={businessId} shell={shell} compact={compact} canEdit={canEdit} onOpenBrand={onOpenBrand} onGo={onGo} list={list} layout={layout} intent={intent} onIntentDone={onIntentDone}
            sort={sort} onSort={s => setState({ ...state, sort: s?.id || null, dir: s ? s.dir : null })} />}
    </div>
  );
}

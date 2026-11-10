import { chipMatches, applyFilters, chipCounts, sizeChipCounts, peopleCoverage, activeFilters, removeFilter, toggleChip, targetToFilters, CSV_COLUMNS, bandGroups, bandRule, EMPTY_FILTERS, stageOptions, activeFilterCount } from './peopleTableModel';
import { toCsv } from '../../../utils/csv';

// people-v2 Stage 2 - the table's pure rules over invented rows (the route's shape).
const NOW = Date.parse('2026-11-06T18:00:00Z');
const row = (name, over = {}) => ({ key: `prospect:${name}`, sources: ['Apollo'], source: 'Apollo', name, title: 'VP People', company: { type: 'employer', id: 'o1', name: 'Acme Health', stage: 'contacted', owner_user_id: 'u1' }, status: 'new', owner: 'jack',
  emails: { sent: 1, opened: 0, clicked: 0, replied: 0, bot_opens: 0 }, last_email: { at: '2026-11-03T12:00:00Z', what: 'sent', reply_class: null }, heat: 5, heat_band: 'cold', visits: null, identified_at: null, buyer: false, has_email: true, last_touch_at: '2026-11-03T12:00:00Z', ...over });
const ROWS = [
  row('Ana', { emails: { sent: 3, opened: 2, clicked: 1, replied: 1, bot_opens: 1 }, heat: 150, heat_band: 'hot', buyer: true, visits: { visits_7d: 6, last_visit: '2026-11-05', top_page: '/pricing', seen_to: '2026-11-06' } }),
  row('Bo', { source: 'Website', sources: ['Website'], identified_at: '2026-11-02', company: { type: 'target', id: 't1', name: 'Quarry Labs', stage: 'researching', owner_user_id: null }, owner: null, emails: { sent: 0, opened: 0, clicked: 0, replied: 0, bot_opens: 0 }, last_email: null, heat: null, heat_band: null, last_touch_at: null, visits: { visits_7d: 1, last_visit: '2026-10-22', top_page: '/', seen_to: '2026-10-23' } }),
  row('Cy', { company: { type: 'partner', id: 'g1', name: 'Harbor Lane', stage: 'replied', owner_user_id: 'u2' }, owner: 'cyrus', emails: { sent: 2, opened: 1, clicked: 0, replied: 0, bot_opens: 0 }, heat: 12, heat_band: 'warm', last_touch_at: '2026-10-01T12:00:00Z' }),
];
const ctx = { meId: 'u1', myName: 'Jack Carlson', now: NOW };

test('chips: each rule alone; Mine = my company or my prospect owner slug; needs a touch = none in 14 d; visited 7 d needs a pull window ending this week', () => {
  expect(ROWS.map(r => chipMatches(r, 'opened', ctx))).toEqual([true, false, true]);
  expect(ROWS.map(r => chipMatches(r, 'clicked', ctx))).toEqual([true, false, false]);
  expect(ROWS.map(r => chipMatches(r, 'replied', ctx))).toEqual([true, false, false]);
  expect(ROWS.map(r => chipMatches(r, 'sent', ctx))).toEqual([true, false, true]);
  expect(ROWS.map(r => chipMatches(r, 'identified', ctx))).toEqual([false, true, false]);
  expect(ROWS.map(r => chipMatches(r, 'visited_7d', ctx))).toEqual([true, false, false]);
  expect(ROWS.map(r => chipMatches(r, 'buyer', ctx))).toEqual([true, false, false]);
  expect(ROWS.map(r => chipMatches(r, 'hot', ctx))).toEqual([true, false, false]);
  expect(ROWS.map(r => chipMatches(r, 'needs_touch', ctx))).toEqual([false, true, true]);
  expect(ROWS.map(r => chipMatches(r, 'mine', ctx))).toEqual([true, false, false]);
  expect(chipMatches(ROWS[2], 'mine', { meId: 'u9', myName: 'Cyrus Test', now: NOW })).toBe(true);
  expect(chipCounts(ROWS, ctx)).toEqual({ opened: 2, clicked: 1, replied: 1, sent: 2, identified: 1, visited_7d: 1, buyer: 1, hot: 1, needs_touch: 2, mine: 1 });
});

test('filters: chips AND together; source / stage / owner / company / search; the active list and its removals; the count', () => {
  const f = { ...EMPTY_FILTERS, chips: ['opened', 'buyer'] };
  expect(applyFilters(ROWS, f, ctx).map(r => r.name)).toEqual(['Ana']);
  expect(applyFilters(ROWS, { ...EMPTY_FILTERS, source: 'Website' }, ctx).map(r => r.name)).toEqual(['Bo']);
  expect(applyFilters(ROWS, { ...EMPTY_FILTERS, stage: 'replied' }, ctx).map(r => r.name)).toEqual(['Cy']);
  expect(applyFilters(ROWS, { ...EMPTY_FILTERS, owner: 'unassigned' }, ctx).map(r => r.name)).toEqual(['Bo']);
  expect(applyFilters(ROWS, { ...EMPTY_FILTERS, owner: 'u2' }, ctx).map(r => r.name)).toEqual(['Cy']);
  expect(applyFilters(ROWS, { ...EMPTY_FILTERS, company: { type: 'employer', id: 'o1' } }, ctx).map(r => r.name)).toEqual(['Ana']);
  expect(applyFilters(ROWS, { ...EMPTY_FILTERS, q: 'quarry' }, ctx).map(r => r.name)).toEqual(['Bo']);
  expect(applyFilters(ROWS, { ...EMPTY_FILTERS, q: 'vp people' }, ctx)).toHaveLength(3);
  const full = { ...EMPTY_FILTERS, chips: ['hot'], source: 'Apollo', stage: 'contacted', owner: 'u1', window: '30', q: 'ana', company: { type: 'employer', id: 'o1', name: 'Acme Health' } };
  expect(activeFilters(full, { members: [{ user_id: 'u1', name: 'Jack Carlson' }] }).map(a => a.text)).toEqual(['Hot', 'Source: Apollo', 'Stage: contacted', 'Owner: Jack Carlson', 'Window: 30 d', 'Company: Acme Health', '“ana”']);
  expect(activeFilterCount(full)).toBe(7);
  expect(removeFilter(full, 'chip:hot').chips).toEqual([]);
  expect(removeFilter(full, 'owner').owner).toBe('');
  expect(removeFilter(full, 'company').company).toBeNull();
  expect(toggleChip(toggleChip(EMPTY_FILTERS, 'hot'), 'hot').chips).toEqual([]);
  expect(stageOptions(ROWS)).toEqual(['contacted', 'replied', 'researching']);
});

test('the old feed links land on chips; the band groups follow the heat order and fold when another column sorts', () => {
  expect(targetToFilters({ feed: 'open' }).chips).toEqual(['opened']);
  expect(targetToFilters({ feed: 'click' }).chips).toEqual(['clicked']);
  expect(targetToFilters({ feed: 'reply' }).chips).toEqual(['replied']);
  expect(targetToFilters({ feed: null }).chips).toEqual([]);
  expect(targetToFilters({ flags: true }).chips).toEqual(['mine']);
  expect(targetToFilters(null)).toBe(EMPTY_FILTERS);
  // heat-v2 D1: Hot / Warm / Cold in heat order (no sort or sorted by heat; asc reverses); a person with no heat sits in Cold.
  expect(bandGroups(ROWS, null).map(g => [g.band, g.rows.map(r => r.name)])).toEqual([['hot', ['Ana']], ['warm', ['Cy']], ['cold', ['Bo']]]);
  expect(bandGroups(ROWS, { id: 'heat', dir: 'desc' }).map(g => g.band)).toEqual(['hot', 'warm', 'cold']);
  expect(bandGroups(ROWS, { id: 'heat', dir: 'asc' }).map(g => g.band)).toEqual(['cold', 'warm', 'hot']);
  expect(bandGroups(ROWS, { id: 'company', dir: 'asc' })).toBeNull();
  expect([bandRule('hot'), bandRule('warm'), bandRule('cold'), bandRule('hot', { hot: 50, warm: 20 })]).toEqual(['score ≥ 40', 'score 10–39', 'score < 10', 'score ≥ 50']);
});

test('CSV: structured fields only, the address a yes / no, Company size = number or unknown + the source word, never an @', () => {
  const rows = [row('Ana', { ...ROWS[0], company: { ...ROWS[0].company, employees: 12000, employees_source: 'manual' } }), ROWS[1], ROWS[2]];
  const csv = toCsv(rows, CSV_COLUMNS);
  const lines = csv.split('\r\n');
  expect(lines[0]).toBe('Person,Title,Company,Company stage,Company size,Size source,Source,Sent,Opened (human),Clicked,Replied,Last email,Heat,Heat band,Company visits 7 d,Last visit,Identified,Buyer title,Address on file,Last touch');
  expect(lines[1]).toBe('Ana,VP People,Acme Health,contacted,12000,typed,Apollo,3,2,1,1,Nov 3 sent,150,hot,6,2026-11-05,,yes,yes,Nov 3');
  expect(lines[2]).toBe('Bo,VP People,Quarry Labs,researching,unknown,,Website,0,0,0,0,,,,1,2026-10-22,2026-11-02,,yes,');
  expect(toCsv([row('Nil', { company: null })], CSV_COLUMNS).split('\r\n')[1].startsWith('Nil,VP People,,,unknown,,')).toBe(true);
  expect(csv).not.toMatch(/@/);
});

test('heat-size-v1: the size chips count people by their company headcount (no record = Unknown), the sizes filter narrows, the active chip reads the labels, the coverage counts distinct records', () => {
  const rows = [row('Ana', { company: { ...ROWS[0].company, employees: 12000, employees_source: 'manual' } }), row('Al', { company: { ...ROWS[0].company, employees: 12000, employees_source: 'manual' } }), ROWS[1], row('Nil', { company: null }), row('Cy', { company: { ...ROWS[2].company, employees: 150, employees_source: 'apollo' } })];
  expect(sizeChipCounts(rows)).toEqual({ unknown: 2, lt200: 1, '200_999': 0, '1k_4999': 0, '5k': 2 });
  expect(applyFilters(rows, { ...EMPTY_FILTERS, sizes: ['5k'] }, ctx).map(r => r.name)).toEqual(['Ana', 'Al']);
  expect(applyFilters(rows, { ...EMPTY_FILTERS, sizes: ['unknown'] }, ctx).map(r => r.name)).toEqual(['Bo', 'Nil']);
  expect(applyFilters(rows, { ...EMPTY_FILTERS, sizes: ['unknown', 'lt200'] }, ctx).map(r => r.name)).toEqual(['Bo', 'Nil', 'Cy']);
  expect(activeFilters({ ...EMPTY_FILTERS, sizes: ['5k', 'unknown'] })).toEqual([{ key: 'sizes', text: 'Size: 5,000+ + Unknown' }]);
  expect(removeFilter({ ...EMPTY_FILTERS, sizes: ['5k'] }, 'sizes').sizes).toEqual([]);
  expect(activeFilterCount({ ...EMPTY_FILTERS, sizes: ['5k'] })).toBe(1);
  expect(peopleCoverage(rows)).toEqual({ companies: 3, known: 2, noCompanyPeople: 1 });
  expect(peopleCoverage([])).toEqual({ companies: 0, known: 0, noCompanyPeople: 0 });
});

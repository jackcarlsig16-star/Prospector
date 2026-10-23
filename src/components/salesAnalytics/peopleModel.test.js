import { matchesPeopleFilters, peopleView, displayName, companyRowFor, readSort, writeSort, DEFAULT_SORT, EMPTY_FILTERS, activeFilterCount } from './peopleModel';

const row = (id, extra) => ({ contact_id: id, name: `Pat ${id}`, company: `Co ${id}`, title: null, owner: 'jack', status: 'new', status_label: 'Active', closed: false, snoozed: false, sequence_ids: ['s1'], last_activity_kind: 'open', last_activity_at: '2026-10-20T10:00:00Z', in_pipeline: false, opportunity_id: null, ...extra });
const rows = [
  row('a'),
  row('b', { owner: 'cyrus', status: 'contacted', status_label: 'Contacted', last_activity_kind: 'reply', sequence_ids: ['s2'] }),
  row('c', { status: 'booked', status_label: 'Booked', closed: true }),
  row('d', { status: 'not_now', status_label: 'Not now', closed: true, snoozed: true }),
  row('e', { status: 'dead', status_label: 'Not a fit', closed: true, owner: 'unassigned' }),
  row('f', { closed: true, unsubscribed: true, last_activity_kind: 'click' }),
];

test('P5: closed (Booked, Not now, Not a fit, unsubscribed) and snoozed rows hide unless Show closed; the count is every closed row', () => {
  expect(peopleView(rows, EMPTY_FILTERS, false).rows.map(r => r.contact_id)).toEqual(['a', 'b']);
  expect(peopleView(rows, EMPTY_FILTERS, true).rows.map(r => r.contact_id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  expect(peopleView(rows, EMPTY_FILTERS, false).closed).toBe(4);
});

test('one filter row: Owner (jack | cyrus | unassigned) · Sequence · Last activity · Status · Search; a closed status filter shows its rows without Show closed', () => {
  const f = o => ({ ...EMPTY_FILTERS, ...o });
  expect(peopleView(rows, f({ owner: 'cyrus' }), false).rows.map(r => r.contact_id)).toEqual(['b']);
  expect(peopleView(rows, f({ owner: 'unassigned' }), true).rows.map(r => r.contact_id)).toEqual(['e']);
  expect(peopleView(rows, f({ sequence: 's2' }), false).rows.map(r => r.contact_id)).toEqual(['b']);
  expect(peopleView(rows, f({ activity: 'reply' }), false).rows.map(r => r.contact_id)).toEqual(['b']);
  expect(peopleView(rows, f({ activity: 'click' }), false).rows).toEqual([]);
  expect(peopleView(rows, f({ status: 'active' }), false).rows.map(r => r.contact_id)).toEqual(['a']);
  expect(peopleView(rows, f({ status: 'dead' }), false).rows.map(r => r.contact_id)).toEqual(['e']);
  expect(peopleView(rows, f({ status: 'not_now' }), false).rows.map(r => r.contact_id)).toEqual(['d']);
  expect(peopleView(rows, f({ q: 'co b' }), false).rows.map(r => r.contact_id)).toEqual(['b']);
  expect(matchesPeopleFilters(row('x', { title: 'Head of Benefits' }), f({ q: 'benefits' }), false)).toBe(true);
});

test('Person shows first name + last initial until the person is on a Pipeline record; full name once in_pipeline', () => {
  expect(displayName({ name: 'Avery Jo Opener', in_pipeline: false })).toBe('Avery O.');
  expect(displayName({ name: 'Cher', in_pipeline: false })).toBe('Cher');
  expect(displayName({ name: 'Avery Opener', in_pipeline: true })).toBe('Avery Opener');
  expect(displayName({ name: null })).toBe('Unknown contact');
});

test('Open company: the linked opportunity first, else the record whose name matches (partner before employer before target); nothing = null', () => {
  const board = [
    { type: 'employer', id: 'o1', name: 'Acme Rentals' }, { type: 'partner', id: 'g1', name: 'Acme Rentals, Inc.' }, { type: 'target', id: 't1', name: 'Beta Benefits' },
    { type: 'visitor', id: 'cobalt co', name: 'Cobalt Co' }, { type: 'signal', id: 's1', name: 'Delta' },
  ];
  expect(companyRowFor({ company: 'Acme Rentals', opportunity_id: 'o1' }, board).id).toBe('o1');
  expect(companyRowFor({ company: 'acme rentals inc', opportunity_id: null }, board).id).toBe('g1');
  expect(companyRowFor({ company: 'Beta Benefits', opportunity_id: 'gone' }, board).id).toBe('t1');
  expect(companyRowFor({ company: 'Cobalt', opportunity_id: null }, board).id).toBe('cobalt co');
  expect(companyRowFor({ company: 'Delta', opportunity_id: null }, board)).toBeNull();
  expect(companyRowFor({ company: null, opportunity_id: null }, board)).toBeNull();
});

test('the last header sort is remembered per browser; default = newest activity', () => {
  localStorage.clear();
  expect(readSort()).toEqual(DEFAULT_SORT);
  writeSort({ id: 'heat', dir: 'desc' });
  expect(readSort()).toEqual({ id: 'heat', dir: 'desc' });
  writeSort(null);
  expect(readSort()).toEqual(DEFAULT_SORT);
  localStorage.setItem('prospector_people_sort', '{bad');
  expect(readSort()).toEqual(DEFAULT_SORT);
});

// company-panel-v2 L6 - "Open in People →" filters to one company by its link (goal_id for a partner, opportunity_id for an employer).
test('company filter: partner rows match on goal_id, employer rows on opportunity_id; it counts as an active filter; null = everyone', () => {
  const linked = [row('a', { goal_id: 'g1' }), row('b', { opportunity_id: 'o1' }), row('g', { goal_id: 'g1', opportunity_id: 'o1' })];
  const f = company => ({ ...EMPTY_FILTERS, company });
  expect(peopleView(linked, f({ type: 'partner', id: 'g1', name: 'Gallagher' }), false).rows.map(r => r.contact_id)).toEqual(['a', 'g']);
  expect(peopleView(linked, f({ type: 'employer', id: 'o1', name: 'Solidcore' }), false).rows.map(r => r.contact_id)).toEqual(['b', 'g']);
  expect(peopleView(linked, f(null), false).rows.length).toBe(3);
  expect(activeFilterCount(f({ type: 'partner', id: 'g1', name: 'Gallagher' }))).toBe(1);
  expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
});

test('FIX people-apollo-visibility-v1 F2: search matches the full stored name and the company while the row shows "First L."', () => {
  const r = row('v', { name: 'Avery Quillfeather', company: "Daisy's Gym", in_pipeline: false });
  expect(displayName(r)).toBe('Avery Q.');
  const f = q => ({ ...EMPTY_FILTERS, q });
  expect(matchesPeopleFilters(r, f('quillfeather'), false)).toBe(true);
  expect(matchesPeopleFilters(r, f('Avery Quill'), false)).toBe(true);
  expect(matchesPeopleFilters(r, f("daisy's"), false)).toBe(true);
  expect(matchesPeopleFilters(r, f('quillfeather daisy'), false)).toBe(true);
  expect(matchesPeopleFilters(r, f('avery q.'), false)).toBe(false);
});

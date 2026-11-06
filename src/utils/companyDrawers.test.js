import { readDrawers, writeDrawer, DRAWERS_KEY, DRAWERS_CAP } from './companyDrawers';

// company-window-v4 D2 - the per-viewer, per-company drawer state: read / write, the 200-company cap (oldest evicted),
// a malformed value reads as nothing open.
beforeEach(() => localStorage.clear());

test('write then read per company; sections keep their own booleans; another company is untouched', () => {
  expect(readDrawers('employer-a')).toEqual({});
  writeDrawer('employer-a', 'signals', true, 1000);
  writeDrawer('employer-a', 'people', false, 1001);
  writeDrawer('target-b', 'files', true, 1002);
  expect(readDrawers('employer-a')).toEqual({ signals: true, people: false });
  expect(readDrawers('target-b')).toEqual({ files: true });
  expect(JSON.parse(localStorage.getItem(DRAWERS_KEY))['employer-a']._at).toBe(1001);
});

test('the cap: past 200 companies the oldest-touched is evicted; touching an old one keeps it', () => {
  for (let i = 0; i < DRAWERS_CAP; i++) writeDrawer(`c-${i}`, 'signals', true, 1000 + i);
  writeDrawer('c-0', 'notes', true, 5000); // c-0 becomes the newest
  writeDrawer('c-new', 'signals', true, 6000);
  const all = JSON.parse(localStorage.getItem(DRAWERS_KEY));
  expect(Object.keys(all)).toHaveLength(DRAWERS_CAP);
  expect(all['c-1']).toBeUndefined();
  expect(readDrawers('c-0')).toEqual({ signals: true, notes: true });
  expect(readDrawers('c-new')).toEqual({ signals: true });
});

test('malformed or foreign values read as nothing open and are replaced on the next write', () => {
  localStorage.setItem(DRAWERS_KEY, '{not json');
  expect(readDrawers('employer-a')).toEqual({});
  localStorage.setItem(DRAWERS_KEY, JSON.stringify([1, 2]));
  expect(readDrawers('employer-a')).toEqual({});
  localStorage.setItem(DRAWERS_KEY, JSON.stringify({ 'employer-a': { signals: 'yes', people: true } }));
  expect(readDrawers('employer-a')).toEqual({ people: true });
  writeDrawer('employer-a', 'signals', true, 9);
  expect(readDrawers('employer-a')).toEqual({ signals: true, people: true });
});

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ImportsPanel, { contactLine, tabLine, filterRows, warningText } from './ImportsPanel';
import ReviewScreen from './ReviewScreen';
import NewMenu, { NEW_ITEMS } from '../NewMenu';

// hkos-sheet-import-v1 Stage 3 - Review > Imports against a recorded fetch (invented names, no address anywhere in
// what the browser gets) and the top bar's "+ New". The file picked is a tiny invented blob; the base64 the panel
// sends is what the server would parse.
const HK = 'biz-hk';
const owner = { me: { user_id: 'u-jack', first_name: 'Jack', role: 'owner' }, members: [{ user_id: 'u-jack', first_name: 'Jack', palette_index: 1 }, { user_id: 'u-pete', first_name: 'Pete', palette_index: 2 }] };
const memberShell = { ...owner, me: { ...owner.me, role: 'member' } };
let calls, routes, bodies;
const json = (status, body) => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });
beforeEach(() => {
  calls = []; routes = {}; bodies = {};
  global.fetch = jest.fn((url, init = {}) => {
    const method = init.method || 'GET'; const u = new URL(url, 'http://x'); const key = `${method} ${u.pathname}`; calls.push(key);
    if (init.body) bodies[key] = JSON.parse(init.body);
    const hit = routes[key]; return hit ? json(200, typeof hit === 'function' ? hit(init.body ? JSON.parse(init.body) : null) : hit) : json(404, { error: `no route ${key}` });
  });
});

const row = (key, over = {}) => ({ key, name: key, domain: null, segment: 'sponsor_brand', status: 'candidate', relationship: 'prospect', owner_hint: 'pete', result: 'new', tabs: ['Pete Outreach'], refs: ['Pete Outreach:2'], contact_count: 0, has_email: false, touches: 0, periods: [], warnings: [], duplicate_of: [], existing: null, ...over });
const PREVIEW = {
  run: { id: 'run-1', source: 'Zz Tracker.xlsx', status: 'preview', rows_read: 5, created_count: 3, matched_count: 1, flagged_count: 2, started_by: 'u-jack', created_at: '2026-10-27T15:00:00Z', finished_at: null, undone_at: null, summary: null, can_undo: false },
  preview: {
    tabs: [{ name: 'Pete Outreach', kind: 'pete_outreach', reason: null, period: null, rows_read: 3, rows: 3, skipped_rows: 0, create: 2, match: 1, warnings: 2, unknown_headers: [] }, { name: 'June Confirmed Sponsors', kind: 'monthly', period: '2026-06', rows_read: 1, rows: 1, skipped_rows: 0, create: 1, match: 0, warnings: 0, unknown_headers: [] }, { name: 'Events', kind: 'skipped', reason: 'events are not brand-shaped (no event segment yet)', rows_read: 1, rows: 0, skipped_rows: 0, create: 0, match: 0, warnings: 0, unknown_headers: [] }],
    brands: [
      row('Zz Northwind Juice', { domain: 'northwind.invalid', status: 'bumped', contact_count: 2, has_email: true, touches: 2, warnings: [{ code: 'future_date', detail: '2026-12-24', ref: 'Pete Outreach:2' }], result: 'warning' }),
      row('Zz Harbor Yoga', { result: 'matches', existing: { id: 'b-yoga', name: 'Harbor Yoga' }, contact_count: 1, has_email: false }),
      row('Zz Salt Spa', { result: 'possible_duplicate', duplicate_of: ['Zz Hogsalt'] }),
      row('Zz Oak Street Bakery', { relationship: 'sponsor', status: 'sponsor', owner_hint: null, tabs: ['June Confirmed Sponsors'], periods: ['2026-06'], warnings: [{ code: 'unmapped_status', detail: 'Need to set up', ref: 'June Confirmed Sponsors:2' }], result: 'warning' }),
    ],
    duplicates: [{ a: 'Zz Salt Spa', b: 'Zz Hogsalt', b_existing_id: null, reason: 'name_contains' }],
    warnings: [{ code: 'owner_missing', detail: "2 touches on Pete's rows wait for his first sign-in (owner_hint pete)" }],
    totals: { rows_read: 5, rows: 4, brands: 4, create: 3, match: 1, possible_duplicates: 1, warnings: 3, contacts: 3, contacts_with_email: 2, touches: 2, periods: 1, skipped_tabs: [{ name: 'Events', rows_read: 1, reason: 'events are not brand-shaped (no event segment yet)' }] },
  },
};
const committedRun = { ...PREVIEW.run, status: 'committed', finished_at: '2026-10-27T15:01:00Z', summary: { counts: { brands: 3 } }, can_undo: true };

test('pure: contact presence line, tab line, filters, warning text', () => {
  expect(contactLine({ contact_count: 0 })).toBe('No contact');
  expect(contactLine({ contact_count: 1, has_email: true })).toBe('1 contact, has email');
  expect(contactLine({ contact_count: 2, has_email: false })).toBe('2 contacts, no email');
  expect(tabLine(PREVIEW.preview.tabs[0])).toBe('3 rows · 2 to create · 1 match · 2 warnings');
  expect(tabLine(PREVIEW.preview.tabs[2])).toBe('1 rows skipped: events are not brand-shaped (no event segment yet)');
  expect(filterRows(PREVIEW.preview.brands, 'warning').map(b => b.name)).toEqual(['Zz Northwind Juice', 'Zz Oak Street Bakery']);
  expect(filterRows(PREVIEW.preview.brands, 'matches').map(b => b.name)).toEqual(['Zz Harbor Yoga']);
  expect(filterRows(PREVIEW.preview.brands, 'all')).toHaveLength(4);
  expect(warningText({ code: 'future_date', detail: '2026-12-24' })).toBe('Future date: 2026-12-24');
  expect(warningText({ code: 'odd_code' })).toBe('odd_code');
});

test('+ New: Add brand, Add contact, Import list, Log outside touch (disabled, says why); no Paste notes; a pick closes and reports', () => {
  const onPick = jest.fn();
  const { container } = render(<NewMenu onPick={onPick} />);
  expect(NEW_ITEMS.map(i => i.label)).toEqual(['Add brand', 'Add contact', 'Import list', 'Log outside touch']);
  expect(NEW_ITEMS.some(i => /paste/i.test(i.label))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'New' }));
  const items = screen.getAllByRole('menuitem');
  expect(items.map(b => b.textContent)).toEqual(['Add brand', 'Add contact', 'Import list', 'Log outside touch']);
  expect(items[3]).toBeDisabled(); expect(items[3]).toHaveAttribute('title', 'Arrives with Gmail (step 3)');
  fireEvent.click(items[2]);
  expect(onPick).toHaveBeenCalledWith('import');
  expect(container.querySelector('[data-hk-new-menu]')).toBeNull();
});

test('Imports: empty history; New import reads the file as base64 and POSTs preview; cards, totals and rows show contact presence only; filters; Commit -> toast with links; history gets the run with Undo', async () => {
  routes[`GET /api/hk/${HK}/imports`] = () => ({ runs: calls.some(c => c.endsWith('/commit')) ? [committedRun] : [] });
  routes[`POST /api/hk/${HK}/imports/preview`] = PREVIEW;
  routes[`POST /api/hk/${HK}/imports/run-1/commit`] = { run: committedRun, counts: { brands: 3, matched: 1, contacts: 3, touches: 2, touches_deferred: 2, touches_unowned: 0, periods: 1, possible_duplicates: 1, warnings: 3 } };
  const onOpenBrands = jest.fn(), onCount = jest.fn();
  const { container } = render(<ImportsPanel businessId={HK} shell={owner} canEdit compact={false} onCount={onCount} onOpenBrands={onOpenBrands} onOpenWarnings={() => {}} />);
  await screen.findByText('No imports yet.');
  expect(onCount).toHaveBeenCalledWith(0);
  const input = container.querySelector('[data-hk-import-file]');
  expect(input).toHaveAttribute('accept', '.xlsx,.csv');
  fireEvent.change(input, { target: { files: [new File([new Uint8Array([80, 75, 3, 4])], 'Zz Tracker.xlsx')] } });
  await screen.findByText('Preview: Zz Tracker.xlsx');
  const sent = bodies[`POST /api/hk/${HK}/imports/preview`];
  expect(sent.name).toBe('Zz Tracker.xlsx'); expect(sent.data).toBe(Buffer.from([80, 75, 3, 4]).toString('base64'));
  expect(container.querySelectorAll('[data-hk-import-tab]')).toHaveLength(3);
  expect(within(container.querySelector('[data-hk-import-tab="skipped"]')).getByText(/1 rows skipped/)).toBeInTheDocument();
  expect(container.querySelector('[data-hk-import-totals]').textContent).toMatch(/^4 rows read as 4 brands: 3 to create, 1 matching existing brands, 1 possible duplicate, 3 warnings\./);
  expect(screen.getByText('2 contacts, has email')).toBeInTheDocument();
  expect(screen.getByText('Already in Brands as Harbor Yoga')).toBeInTheDocument();
  expect(screen.getByText('Looks like Zz Hogsalt')).toBeInTheDocument();
  expect(screen.getByText('Future date: 2026-12-24')).toBeInTheDocument();
  expect(screen.getByText(/2 touches on Pete's rows wait/)).toBeInTheDocument();
  expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['All (4)', 'New (0)', 'Matches (1)', 'Possible duplicate (1)', 'Warning (2)']);
  fireEvent.click(screen.getByRole('tab', { name: 'Warning (2)' }));
  expect(screen.getByText('2 brands')).toBeInTheDocument();
  expect(screen.queryByText('Zz Salt Spa')).toBeNull();
  expect(container.textContent).not.toMatch(/@/);
  fireEvent.click(screen.getByRole('button', { name: 'Commit import' }));
  const toast = await screen.findByRole('status');
  expect(toast.textContent).toMatch(/^Imported 3 brands, 3 contacts, 2 touches and 1 sponsor period\. 1 matched existing brands and were left as they are\. 2 touches wait for Pete's first sign-in\./);
  fireEvent.click(within(toast).getByRole('button', { name: 'Open Brands' }));
  expect(onOpenBrands).toHaveBeenCalled();
  expect(container.querySelector('[data-hk-import-preview]')).toBeNull();
  await screen.findByText('Zz Tracker.xlsx');
  expect(screen.getByText('Committed')).toBeInTheDocument();
  expect(screen.getByText('5 rows read · 3 created · 1 matched · 2 flagged')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
  expect(onCount).toHaveBeenLastCalledWith(1);
});

test('Undo asks first, then POSTs undo and reports what came out; a member sees Commit and Undo disabled with the reason', async () => {
  routes[`GET /api/hk/${HK}/imports`] = { runs: [committedRun] };
  routes[`POST /api/hk/${HK}/imports/run-1/undo`] = { run: { ...committedRun, status: 'undone', can_undo: false }, deleted: { brands: 3, contacts: 3, touches: 2, periods: 1, events: 3 } };
  const { container, unmount } = render(<ImportsPanel businessId={HK} shell={owner} canEdit compact={false} onOpenBrands={() => {}} onOpenWarnings={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
  expect(container.querySelector('[data-hk-undo-confirm]')).toBeInTheDocument();
  expect(calls.filter(c => c.endsWith('/undo'))).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Undo import' }));
  await waitFor(() => expect(calls.filter(c => c.endsWith('/undo'))).toHaveLength(1));
  expect((await screen.findByRole('status')).textContent).toBe('Undone: 3 brands, 3 contacts, 2 touches and 1 period removed.');
  unmount();
  routes[`POST /api/hk/${HK}/imports/preview`] = PREVIEW;
  const m = render(<ImportsPanel businessId={HK} shell={memberShell} canEdit compact={false} onOpenBrands={() => {}} onOpenWarnings={() => {}} />);
  const undoBtn = await screen.findByRole('button', { name: 'Undo' });
  expect(undoBtn).toBeDisabled();
  fireEvent.change(m.container.querySelector('[data-hk-import-file]'), { target: { files: [new File(['a,b'], 'Sheet8.csv')] } });
  const commitBtn = await screen.findByRole('button', { name: 'Commit import' });
  expect(commitBtn).toBeDisabled();
});

test('Review opens on Imports with the picker when "+ New > Import list" sent the intent; a viewer gets no New import button', async () => {
  routes[`GET /api/hk/${HK}/imports`] = { runs: [] };
  routes[`GET /api/hk/${HK}/review/duplicates`] = { pairs: [] };
  routes[`GET /api/hk/${HK}/review/warnings`] = { warnings: [] };
  const click = jest.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
  const onIntentDone = jest.fn();
  const r = render(<ReviewScreen businessId={HK} shell={owner} canEdit compact={false} onOpenBrand={() => {}} onGo={() => {}} intent={{ kind: 'import', n: 1 }} onIntentDone={onIntentDone} />);
  await screen.findByText('No imports yet.');
  expect(screen.getByRole('tab', { name: 'Imports' })).toHaveAttribute('aria-selected', 'true');
  expect(click).toHaveBeenCalled();
  expect(onIntentDone).toHaveBeenCalled();
  click.mockRestore(); r.unmount();
  render(<ImportsPanel businessId={HK} shell={{ ...owner, me: { ...owner.me, role: 'viewer' } }} canEdit={false} compact={false} />);
  expect(screen.queryByRole('button', { name: 'New import' })).toBeNull();
});

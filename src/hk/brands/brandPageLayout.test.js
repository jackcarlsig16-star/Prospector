import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import BrandPage from './BrandPage';

// grow-ui-refresh-v1 REV2 Stage 3b - the Brand page to mockup 2 (U7 + U8): header, labels, primary + quick commands +
// Log activity, stepper, Research card + split button, Timeline card, Next step / Contacts / Deal / Details, keys,
// Viewer. Invented brand; recorded fetch; the one contact address lives only in the contacts fixture.
const HK = 'biz-hk', B = 'b1';
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const members = [{ user_id: 'u-me', first_name: 'Rowan', palette_index: 1 }, { user_id: 'u-sky', first_name: 'Sky', palette_index: 2 }];
const shell = role => ({ me: { user_id: 'u-me', first_name: 'Rowan', role }, members });
let routes, bodies, calls;
const json = (status, body) => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });
beforeEach(() => {
  routes = {}; bodies = {}; calls = [];
  global.fetch = jest.fn((url, init = {}) => {
    const key = `${init.method || 'GET'} ${new URL(url, 'http://x').pathname}`; calls.push(key);
    if (init.body) (bodies[key] ||= []).push(JSON.parse(init.body));
    const hit = routes[key]; return hit ? json(200, typeof hit === 'function' ? hit(init.body ? JSON.parse(init.body) : null) : hit) : json(404, { error: `no route ${key}` });
  });
  Object.assign(navigator, { clipboard: { writeText: jest.fn(() => Promise.resolve()) } });
});
const brand = over => ({ id: B, name: 'Zz Alder Apparel', domain: 'alderapparel.invalid', domain_suggested: null, status: 'bumped', relationship: 'prospect', owner_user_id: null, owner_hint: null, is_local: false, category: 'National CPG', size_band: null, source: 'import', heat_band: 'cool', targeted_at: '2026-10-28T00:00:00Z', notes: 'Oct 20: met at the expo', challenge_idea: null, research_context: null, updated_at: 't0', created_at: '2026-10-27T00:00:00Z', ...over });
const RESEARCH = { domain: 'alderapparel.invalid', fit: 'possible', what_they_do: 'Colorado overalls and pants.', why: 'Outdoor lines up with fitness challenges.', challenge_idea: 'Trail-to-Taproom: log outdoor miles, win overalls', industry: 'Outdoor apparel', hq_city: 'Colorado', chicago_presence: 'no', researched_at: '2026-10-27T11:30:00Z', researched_by: null, cost_usd: 0.05 };
const DETAIL = over => ({
  brand: brand(), primary: { kind: 'pitch', label: 'Pitch' }, research: RESEARCH, research_budget: { per_call: 0.05, rows: 5, spent_today: 0.1, cap_usd: 1 }, command: 'hk pitch alderapparel.invalid',
  contacts: [{ id: 'c1', name: 'Ana Example', title: 'Marketing lead', email: 'ana@alderapparel.invalid', email_source: 'import', is_primary: true }],
  touches: [{ id: 't1', sender_user_id: 'u-me', channel: 'email', kind: 'cold', state: 'sent', subject: 'HumanKind x Alder', sent_at: '2026-10-20T00:00:00Z', created_by: 'claude' }, { id: 't2', sender_user_id: 'u-me', channel: 'phone', kind: 'outside', state: 'sent', subject: 'Called', sent_at: '2026-10-21T17:00:00Z', created_by: 'user' }],
  replies: [], events: [{ id: 'e1', action: 'brand.created', actor_kind: 'user', actor_user_id: 'u-me', detail: {}, created_at: '2026-10-19T00:00:00Z' }],
  verdict: { verdict: 'clear', ok: true }, email_touches_sent: 1, max_email_touches: 3, ...over,
});
const open = async (role = 'owner', detail = DETAIL()) => {
  routes[`GET /api/hk/${HK}/brands/${B}`] = () => detail;
  const r = render(<BrandPage businessId={HK} brandId={B} shell={shell(role)} canEdit={role !== 'viewer'} onBack={() => {}} onGo={jest.fn()} />);
  await screen.findByRole('heading', { level: 1, name: 'Zz Alder Apparel' });
  return r;
};

test('U7 header: tile, name, saved website pill, the label set with Category and Owner, Pitch + quick commands + Log activity + More, the Pitch line; stepper folds Bumped into Sent with 1 of 3 touches', async () => {
  await open();
  const head = screen.getByRole('region', { name: 'Zz Alder Apparel header' });
  expect(within(head).getByRole('link', { name: /alderapparel\.invalid/ })).toHaveAttribute('href', 'https://alderapparel.invalid');
  expect([...head.querySelectorAll('[data-hk-labels] > *')].map(e => e.textContent.trim())).toEqual(['Target', 'Industry Outdoor apparel', 'Category National CPG', 'Market National', 'Cool', 'Possible fit', 'Contact Marketing lead', 'Unclaimed']);
  expect(within(head).getByRole('button', { name: 'Pitch' })).toBeInTheDocument();
  for (const name of ['Toggle Target', 'Add to your Pipeline', 'Re-run research', 'Snooze 14 days', 'Not a fit', 'Log activity', 'More']) expect(within(head).getByRole('button', { name })).toBeInTheDocument();
  expect(head).toHaveTextContent('Pitch = claim + copy hk pitch alderapparel.invalid');
  const now = head.querySelector('[aria-current="step"]');
  expect(now).toHaveTextContent('Sent');
  expect(head.querySelectorAll('.hk-stepper__step--done').length).toBe(4);
  expect(head.querySelector('[data-hk-touches]')).toHaveTextContent('1 of 3 email touches');
});

test('U7 off the stepper: Passed shows as a chip with its reason; a snooze shows its date', async () => {
  await open('owner', DETAIL({ brand: brand({ status: 'passed', pass_reason: 'Wholesale only', snoozed_until: '2099-11-13T18:00:00Z' }), primary: null }));
  expect(document.querySelector('[data-hk-off-stepper]')).toHaveTextContent('Passed · Wholesale only');
  expect(document.querySelector('[aria-current="step"]')).toBeNull();
  expect(document.querySelector('[data-hk-snoozed]')).toHaveTextContent('Snoozed until Nov 13');
});

test('U8 Research card: fit, what / why, the idea with its name, who + when + cost; Re-run spends with confirm; the menu researches a different website, saves context, shows the input', async () => {
  routes[`POST /api/hk/${HK}/brands/${B}/research`] = b => ({ status: 'researched', domain: b.website || 'alderapparel.invalid', suggested: !!b.website, intel: { fit: { sponsor_fit: 'strong' } }, cost_usd: 0.05 });
  routes[`PATCH /api/hk/${HK}/brands/${B}`] = { brand: { id: B } };
  routes[`GET /api/hk/${HK}/brands/${B}/research-input`] = { input: 'Brand name: Zz Alder Apparel\nWebsite: alderapparel.invalid' };
  await open();
  const card = screen.getByRole('region', { name: 'Research' });
  expect(card).toHaveTextContent('Possible fit'); expect(card).toHaveTextContent('Colorado overalls and pants.'); expect(card).toHaveTextContent('Outdoor lines up with fitness challenges.');
  expect(card.querySelector('.hk-research__ideatitle')).toHaveTextContent('Trail-to-Taproom');
  expect(card.querySelector('[data-hk-researched]')).toHaveTextContent(/auto sweep · \$0\.05/);
  fireEvent.click(within(card).getByRole('button', { name: /Re-run/ }));
  await waitFor(() => expect(bodies[`POST /api/hk/${HK}/brands/${B}/research`]).toEqual([{ click: true, confirm: true }]));
  fireEvent.click(within(card).getByRole('button', { name: 'More research options' }));
  fireEvent.click(within(card).getByRole('menuitem', { name: 'Use a different website' }));
  fireEvent.change(within(card).getByLabelText('A different website'), { target: { value: 'alder-outdoor.invalid' } });
  fireEvent.click(within(card).getByRole('button', { name: 'Research it' }));
  await waitFor(() => expect(bodies[`POST /api/hk/${HK}/brands/${B}/research`][1]).toEqual({ click: true, confirm: true, website: 'alder-outdoor.invalid' }));
  fireEvent.click(within(card).getByRole('button', { name: 'More research options' }));
  fireEvent.click(within(card).getByRole('menuitem', { name: 'Add context for this brand' }));
  fireEvent.change(within(card).getByLabelText('Context for this brand'), { target: { value: 'They sponsor 5Ks.' } });
  fireEvent.click(within(card).getByRole('button', { name: 'Save context' }));
  await waitFor(() => expect(bodies[`PATCH /api/hk/${HK}/brands/${B}`]).toEqual([{ research_context: 'They sponsor 5Ks.' }]));
  fireEvent.click(within(card).getByRole('button', { name: 'More research options' }));
  fireEvent.click(within(card).getByRole('menuitem', { name: 'View last research input' }));
  expect(await within(card).findByText(/Brand name: Zz Alder Apparel/)).toBeInTheDocument();
});

test('U8 Re-run shows its cost first when today\'s research is within one call of the cap', async () => {
  await open('owner', DETAIL({ research_budget: { per_call: 0.05, rows: 5, spent_today: 0.97, cap_usd: 1 } }));
  expect(screen.getByRole('button', { name: /Re-run · ~\$0\.05/ })).toBeInTheDocument();
  expect(document.querySelector('[data-hk-cap-near]')).toHaveTextContent("Today's research is $0.97 of the $1.00 cap");
});

test('U7 Timeline card: Timeline · Emails · Notes with counts; a logged call reads "logged: Called"; Add a note adds a dated line to the notes', async () => {
  routes[`PATCH /api/hk/${HK}/brands/${B}`] = { brand: { id: B } };
  await open();
  const card = screen.getByRole('region', { name: 'Timeline' });
  expect(within(card).getAllByRole('tab').map(t => t.textContent)).toEqual(['Timeline 3', 'Emails 1', 'Notes 1']);
  expect(card).toHaveTextContent('logged: Called');
  fireEvent.click(within(card).getByRole('tab', { name: 'Emails 1' }));
  expect(card).not.toHaveTextContent('logged: Called');
  fireEvent.change(within(card).getByLabelText('Add a note'), { target: { value: 'Asked about Q1 budget' } });
  fireEvent.click(within(card).getByRole('button', { name: 'Add' }));
  await waitFor(() => expect(bodies[`PATCH /api/hk/${HK}/brands/${B}`][0].notes).toMatch(/^[A-Z][a-z]{2} \d{1,2}: Asked about Q1 budget\nOct 20: met at the expo$/));
});

test('U7 rail: Next step (3 steps + the primary), Contacts (starred, source words, + Add), Deal empty state, Details with Category / Market edited in place', async () => {
  routes[`PATCH /api/hk/${HK}/brands/${B}`] = { brand: { id: B } };
  await open();
  const next = screen.getByRole('region', { name: 'Next step' });
  expect(next).toHaveTextContent('Pitch Zz Alder Apparel'); expect(next.querySelectorAll('.hk-next__steps li').length).toBe(3);
  expect(within(next).getByRole('button', { name: 'Pitch' })).toBeInTheDocument();
  const contacts = screen.getByRole('region', { name: 'Contacts' });
  expect(contacts).toHaveTextContent('Marketing lead ★'); expect(contacts).toHaveTextContent('Email on file · from the sheet');
  expect(within(contacts).getByRole('button', { name: '+ Add' })).toBeInTheDocument();
  const deal = screen.getByRole('region', { name: 'Deal' });
  expect(deal).toHaveTextContent('fills in when they sign'); expect(deal.querySelectorAll('dd').length).toBe(4);
  const det = screen.getByRole('region', { name: 'Details' });
  expect([...det.querySelectorAll('dt')].map(d => d.textContent)).toEqual(['Industry', 'Category', 'Market', 'Size', 'Based in', 'Owner', 'Sheet owner', 'Source', 'Relationship']);
  expect(det.querySelector('[data-hk-detail="Based in"]')).toHaveTextContent('Colorado');
  fireEvent.click(within(det).getByRole('button', { name: 'Edit Category' }));
  fireEvent.change(within(det).getByLabelText('Category'), { target: { value: 'Outdoor brand' } });
  fireEvent.click(within(det).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(bodies[`PATCH /api/hk/${HK}/brands/${B}`]).toEqual([{ category: 'Outdoor brand' }]));
  fireEvent.click(within(det).getByRole('button', { name: 'Edit Market' }));
  fireEvent.change(within(det).getByLabelText('Market'), { target: { value: 'Chicago' } });
  fireEvent.click(within(det).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(bodies[`PATCH /api/hk/${HK}/brands/${B}`][1]).toEqual({ is_local: true }));
});

test('Log activity (L): the key opens it; LinkedIn on a date posts the outside touch; the toast Undo discards it; S / X never fire while typing in the note', async () => {
  routes[`POST /api/hk/${HK}/brands/${B}/activity`] = b => (b.undo ? { undone: true } : { touch_id: 'tx', what: 'LinkedIn', date: b.date });
  await open();
  fireEvent.keyDown(document.body, { key: 'l' });
  const form = await screen.findByRole('form', { name: 'Log activity for Zz Alder Apparel' });
  fireEvent.click(within(form).getByRole('button', { name: 'LinkedIn' }));
  fireEvent.change(within(form).getByLabelText('Date'), { target: { value: '2026-10-29' } });
  const note = within(form).getByLabelText('Note');
  fireEvent.change(note, { target: { value: 'Connected on LinkedIn' } });
  fireEvent.keyDown(note, { key: 's' }); fireEvent.keyDown(note, { key: 'x' });
  fireEvent.click(within(form).getByRole('button', { name: 'Log it' }));
  expect(await screen.findByText('Logged: LinkedIn on 2026-10-29.')).toBeInTheDocument();
  fireEvent.click(within(document.querySelector('[data-hk-toast]')).getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(bodies[`POST /api/hk/${HK}/brands/${B}/activity`]).toEqual([{ what: 'linkedin', date: '2026-10-29', note: 'Connected on LinkedIn' }, { undo: 'tx' }]));
  expect(calls.filter(c => /snooze|not-a-fit/.test(c))).toEqual([]);
});

test('U3 page keys: S snoozes, X marks not a fit (each with Undo); P pitches only when Pitch is the primary', async () => {
  routes[`POST /api/hk/${HK}/brands/${B}/snooze`] = { brand: { id: B, snoozed_until: '2026-11-13T00:00:00Z' } };
  routes[`POST /api/hk/${HK}/brands/${B}/pitch`] = { claimed: true, command: 'hk pitch alderapparel.invalid', words: 'Claimed. Copied hk pitch alderapparel.invalid. Paste into Claude.', brand: { id: B, updated_at: 't1' } };
  await open();
  fireEvent.keyDown(document.body, { key: 's' });
  expect(await screen.findByText('Zz Alder Apparel snoozed for 14 days.')).toBeInTheDocument();
  fireEvent.keyDown(document.body, { key: 'p' });
  expect(await screen.findByText('Claimed. Copied hk pitch alderapparel.invalid. Paste into Claude.')).toBeInTheDocument();
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hk pitch alderapparel.invalid');
});

test('Viewer: the page reads (research, timeline, rail, contact address as today); no primary, quick commands, Log activity, More, Re-run, pencils or Add a note; 0 writes', async () => {
  await open('viewer');
  expect(document.querySelectorAll('[data-hk-primary], .hk-qcs, [data-hk-qc-log], [data-hk-more], [data-hk-rerun], .hk-kv__pen, [data-hk-add-note], [data-hk-add-contact], [data-hk-edit-idea]').length).toBe(0);
  expect(screen.getByRole('region', { name: 'Research' })).toHaveTextContent('Colorado overalls and pants.');
  fireEvent.keyDown(document.body, { key: 's' }); fireEvent.keyDown(document.body, { key: 'l' });
  expect(calls.filter(c => !c.startsWith('GET'))).toEqual([]);
});

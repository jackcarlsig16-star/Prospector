import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import Briefing, { importantNow } from './Briefing';
import InboxScreen from '../screens/InboxScreen';
import IntelSettings from '../screens/IntelSettings';

// grow-inbox-intel-v1 REV3 Stage 3 - the Briefing lane, Needs you by importance, the brand reach line and the research
// settings, against a recorded fetch. Invented brands; no address in any fixture; Viewers read only.
const HK = 'biz-hk';
// jsdom has no matchMedia: answer as the 1440 desktop (two panes).
window.matchMedia = q => { const m = /max-width:\s*(\d+)px/.exec(q); return { matches: m ? 1440 <= Number(m[1]) : false, addEventListener() {}, removeEventListener() {} }; };
const members = [{ user_id: 'u-me', first_name: 'Rowan', palette_index: 1 }];
const shell = role => ({ me: { user_id: 'u-me', first_name: 'Rowan', role }, members });
let calls, routes, bodies;
const json = (status, body) => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });
beforeEach(() => {
  calls = []; routes = {}; bodies = {};
  global.fetch = jest.fn((url, init = {}) => {
    const method = init.method || 'GET'; const u = new URL(url, 'http://x'); const key = `${method} ${u.pathname}`; calls.push(`${key}${u.search}`);
    if (init.body) (bodies[key] ||= []).push(JSON.parse(init.body));
    const hit = routes[key]; return hit ? json(200, typeof hit === 'function' ? hit(init.body ? JSON.parse(init.body) : null) : hit) : json(404, { error: `no route ${key}` });
  });
  Object.assign(navigator, { clipboard: { writeText: jest.fn(() => Promise.resolve()) } });
});
const card = over => ({ id: 'b1', name: 'Zz Alder Oats', domain: null, category: 'National CPG', city: null, is_local: false, status: 'candidate', owner_user_id: null, owner_hint: null, heat_band: 'cold', targeted_at: null, score: 25, why: ['has a contact to email', 'has a challenge idea'], parts: ['draftable', 'idea'], score_parts: [{ key: 'draftable', words: 'has a contact to email', points: 15 }, { key: 'idea', words: 'has a challenge idea', points: 10 }], primary: { kind: 'research', label: 'Research' }, research: null, suggestion: null, research_attempted_at: null, command: 'hk pitch Zz Alder Oats', contact: { name: 'Ana Example', title: 'Founder', has_email: true, source: 'Email on file · from the sheet' }, challenge_idea: null, ...over });
const RESEARCHED = { line: 'Oat bars · strong fit', fit: 'strong', researched_at: '2026-10-29T11:30:00Z', what_they_do: 'Chicago oat bar maker.', why: 'Breakfast fits a morning-run challenge', challenge_idea: '30-day oat run', industry: 'Snack bars', chicago_presence: 'yes', cost_usd: 0.05 };
const BRIEF = {
  owner: 'me', tiles: { replies_waiting: 3, hot: 1, drafts: 2, followups_due: 4, dms_due: 0, sent_week: 6, reply_rate_week: 17, researched_today: { n: 1, cap: 10 } },
  send: [card({ id: 'b2', name: 'Zz Birch Bars', domain: 'birchbars.invalid', targeted_at: '2026-10-28T00:00:00Z', score: 45, why: ['a target category', 'has a contact to email'], score_parts: [{ key: 'category', words: 'a target category', points: 20 }, { key: 'draftable', words: 'has a contact to email', points: 15 }, { key: 'fit_possible', words: 'possible fit', points: 10 }], primary: { kind: 'pitch', label: 'Pitch' }, research: RESEARCHED, command: 'hk pitch birchbars.invalid' }),
    card(), card({ id: 'b3', name: 'Zz Cedar Cola', score: 10, why: [], score_parts: [{ key: 'website', words: 'has a website', points: 10 }], contact: null, primary: { kind: 'add_email', label: 'Add email' }, research: { ...RESEARCHED, fit: 'possible', industry: null }, suggestion: { domain: 'cedar.invalid', confidence: 'low' } })],
  waiting: [{ id: 'b9', name: 'Zz Waiting Co', waiting_days: 9, touches_used: 1, max_email_touches: 3, next_due_at: '2026-10-28T00:00:00Z', due: true, heat_band: 'cold' }, { id: 'b8', name: 'Zz Patient Co', waiting_days: 2, touches_used: 1, max_email_touches: 3, next_due_at: null, due: false, heat_band: 'warm' }],
  signals: { prospects: [], sponsors: [] }, eligible: 216,
  research: { on: true, n: 10, cap_usd: 1, time: '06:30', today_calls: 1, today_spend: 0.05, last_run: null },
  weights: { draftable: 15, idea: 10, website: 10, researched: 5, local: 20, category: 20, fit_strong: 20, fit_possible: 10, heat_hot: 15, heat_warm: 8, targeted: 10, mine_untouched: 10, niche_overlap: -15, size_large: -5 },
  target_categories: ['National CPG', 'Wellness'],
};
const row = (id, score, why, over = {}) => ({ thread_id: id, lane: 'needs_you', from_name: `Person ${id}`, subject: `About ${id}`, snippet: 'hi', date: '2026-10-28T00:00:00Z', unread: false, chip: { kind: 'untracked' }, importance: { score, why, parts: [] }, ...over });
const ROWS = [row('t1', 5, 'New person'), row('t2', 60, 'Replied: pricing question'), row('t3', 25, 'Brand in conversation'), row('t4', 0, null), { ...row('t5', 99, 'x'), lane: 'other' }];
const routesFor = () => { routes[`GET /api/hk/${HK}/briefing`] = BRIEF; routes[`GET /api/hk/${HK}/signals`] = { prospects: [], sponsors: [], unseen_hot_warm: 0 }; };

test('Important now = the top 7 Needs-you rows by importance (Other never counts)', () => {
  const many = Array.from({ length: 9 }, (_, i) => row(`n${i}`, i * 10, 'x'));
  expect(importantNow([...many, ROWS[4]]).map(r => r.thread_id)).toEqual(['n8', 'n7', 'n6', 'n5', 'n4', 'n3', 'n2']);
});

const renderBrief = (role = 'owner', props = {}) => render(<Briefing businessId={HK} shell={shell(role)} owner="me" canEdit={role !== 'viewer'} rows={ROWS} listReady onOpenThread={jest.fn()} onOpenBrand={jest.fn()} onGo={jest.fn()} onLane={jest.fn()} {...props} />);
const rowOf = name => screen.getByText(name).closest('[data-hk-send-row]');

test('U5 status strip: non-zero counts are chips that jump to their list, zeros small; Sent this week / reply rate / research spend; "Nothing waiting on you" only when all are 0', async () => {
  routesFor();
  const onGo = jest.fn(), onLane = jest.fn();
  const { unmount } = renderBrief('owner', { onGo, onLane });
  const strip = await screen.findByRole('group', { name: 'Today in numbers' });
  fireEvent.click(within(strip).getByRole('button', { name: 'Replies 3' })); expect(onGo).toHaveBeenCalledWith('replies');
  fireEvent.click(within(strip).getByRole('button', { name: 'Follow-ups 4' })); expect(onGo).toHaveBeenCalledWith('today');
  expect(within(strip).queryByRole('button', { name: /DMs/ })).toBeNull();
  expect(within(strip).getByText('DMs')).toBeInTheDocument();
  expect(within(strip).queryByText('Nothing waiting on you')).toBeNull();
  fireEvent.click(within(strip).getByRole('button', { name: /Sent this week/ })); expect(onLane).toHaveBeenCalledWith('sent');
  expect(strip).toHaveTextContent('Reply rate 17%'); expect(strip).toHaveTextContent('Researched today 1/10 $0.05 of $1.00');
  expect(document.querySelector('[data-hk-tile="researched"]')).toBeInTheDocument();
  unmount();
  routes[`GET /api/hk/${HK}/briefing`] = { ...BRIEF, tiles: { ...BRIEF.tiles, replies_waiting: 0, hot: 0, drafts: 0, followups_due: 0, dms_due: 0 } };
  renderBrief();
  expect(await screen.findByText('Nothing waiting on you')).toBeInTheDocument();
});

test('U1-U4 rows: rank, website state, Why now, the label set in order with words, score, one primary by state; row 1 opens with research; the segmented filter', async () => {
  routesFor();
  renderBrief();
  const send = await screen.findByRole('region', { name: 'Send these 10' });
  expect(within(send).getByRole('heading', { level: 2 })).toHaveTextContent('Send these 3');
  expect(send).toHaveTextContent('Best of 216 you can pitch. Ranked by target, contact, fit and timing. Auto-research on: up to 10 a day by 06:30, $1.00 cap.');
  const r1 = rowOf('Zz Birch Bars'), r2 = rowOf('Zz Alder Oats'), r3 = rowOf('Zz Cedar Cola');
  expect(r1).toHaveTextContent('birchbars.invalid'); expect(r2).toHaveTextContent('no website yet'); expect(r3).toHaveTextContent('cedar.invalid · suggested');
  expect(within(r1).getByText(/Why now:/).closest('[data-hk-send-why]')).toHaveTextContent('Why now: a target category · has a contact to email · Breakfast fits a morning-run challenge');
  expect([...r1.querySelectorAll('[data-hk-labels] > *')].map(e => e.textContent.trim())).toEqual(['Target', 'Industry Snack bars', 'Market Chicago', 'Cold', 'Strong fit', 'Contact Founder']);
  expect([...r2.querySelectorAll('[data-hk-labels] > *')].map(e => e.textContent.trim())).toEqual(['Not a target', 'Category National CPG', 'Market National', 'Cold', 'Not researched', 'Contact Founder']);
  expect(within(r3).getByText('No email yet')).toBeInTheDocument();
  expect(within(r1).getByRole('button', { name: 'Pitch' })).toHaveAttribute('aria-keyshortcuts', 'P');
  expect(within(r2).getByRole('button', { name: 'Research' })).toBeInTheDocument();
  expect(within(r3).getByRole('button', { name: 'Add email' })).toHaveClass('hk-primary--amber');
  for (const r of [r1, r2, r3]) expect(within(r).getAllByRole('button', { name: /^(Toggle Target|Add to your Pipeline|Run research|Re-run research|Snooze 14 days|Not a fit)$/ }).length).toBe(5);
  expect(within(r1).getByRole('button', { name: 'Toggle Target' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(r1).getByRole('button', { name: 'Toggle Target' })).toHaveAttribute('data-tip', 'Toggle Target (T)');
  // Row 1 has research: open by default; one open at a time.
  expect(r1.querySelector('[data-hk-expand]')).not.toBeNull();
  fireEvent.click(within(r2).getByRole('button', { name: 'Expand Zz Alder Oats' }));
  expect(r1.querySelector('[data-hk-expand]')).toBeNull(); expect(r2.querySelector('[data-hk-expand]')).not.toBeNull();
  const seg = screen.getByRole('group', { name: 'Show' });
  expect(within(seg).getAllByRole('button').map(b => b.textContent)).toEqual(['Ready to pitch 1', 'Needs research 1', 'Needs email 1']);
  fireEvent.click(within(seg).getByRole('button', { name: 'Needs email 1' }));
  expect(document.querySelectorAll('[data-hk-send-row]').length).toBe(1); expect(rowOf('Zz Cedar Cola')).toBeInTheDocument();
  fireEvent.click(within(seg).getByRole('button', { name: 'Needs email 1' }));
  expect(document.querySelectorAll('[data-hk-send-row]').length).toBe(3);
});

test('U4 expand: what they do, the idea (Copy idea / Edit saves to the brand), researched date + cost, best contact in source words (no Apollo), Why score parts add up, More', async () => {
  routesFor();
  routes[`PATCH /api/hk/${HK}/brands/b2`] = { brand: { id: 'b2' } };
  renderBrief();
  await screen.findByText('Zz Birch Bars');
  const ex = rowOf('Zz Birch Bars').querySelector('[data-hk-expand]');
  expect(ex).toHaveTextContent('Chicago oat bar maker.'); expect(ex).toHaveTextContent('30-day oat run'); expect(ex).toHaveTextContent('$0.05');
  expect(ex).toHaveTextContent('Founder'); expect(ex).toHaveTextContent('Email on file · from the sheet'); expect(ex).not.toHaveTextContent(/Apollo/);
  expect(within(ex).getByRole('heading', { name: 'Why score 45' })).toBeInTheDocument();
  const pts = [...ex.querySelectorAll('.hk-parts dd')].map(d => Number(d.textContent));
  expect(pts.reduce((a, b) => a + b, 0)).toBe(45);
  expect(ex.querySelector('.hk-parts')).toHaveTextContent('A target category+20');
  for (const name of ['Claim only', 'Copy command: hk pitch birchbars.invalid', 'Open brand page', 'Do not contact']) expect(within(ex).getByRole('button', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toBeInTheDocument();
  expect(ex).toHaveTextContent('Pitch claims it as yours and copies hk pitch birchbars.invalid for Claude. Nothing sends.');
  fireEvent.click(within(ex).getByRole('button', { name: /Copy idea/ }));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('30-day oat run');
  fireEvent.click(within(ex).getByRole('button', { name: /Edit/ }));
  fireEvent.change(within(ex).getByLabelText('Challenge idea'), { target: { value: 'Oat miles month' } });
  fireEvent.click(within(ex).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(bodies[`PATCH /api/hk/${HK}/brands/b2`]).toEqual([{ challenge_idea: 'Oat miles month' }]));
});

test('J1 Pitch: the sheet question first, then claim + copy (no "@"), toast Undo releases with the stale-screen guard', async () => {
  routesFor();
  let n = 0;
  global.fetch.mockImplementation((url, init = {}) => {
    const u = new URL(url, 'http://x'), key = `${init.method || 'GET'} ${u.pathname}`; calls.push(key);
    if (init.body) (bodies[key] ||= []).push(JSON.parse(init.body));
    if (key === `POST /api/hk/${HK}/brands/b2/pitch`) { const b = JSON.parse(init.body); if (b.undo) return json(200, { undone: true, brand: { id: 'b2' } }); n += 1; return b.confirm_sheet_owner ? json(200, { claimed: true, command: 'hk pitch birchbars.invalid', words: 'Claimed. Copied hk pitch birchbars.invalid. Paste into Claude.', brand: { id: 'b2', updated_at: '2026-10-30T12:00:00Z' } }) : json(409, { error: "The sheet lists this as Pete's. Take it anyway?", confirm_sheet_owner: true, sheet_owner: 'Pete' }); }
    const hit = routes[key]; return hit ? json(200, typeof hit === 'function' ? hit() : hit) : json(404, { error: `no route ${key}` });
  });
  renderBrief();
  fireEvent.click(within(await screen.findByText('Zz Birch Bars').then(() => rowOf('Zz Birch Bars'))).getByRole('button', { name: 'Pitch' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Take it' }));
  expect(await screen.findByText('Claimed. Copied hk pitch birchbars.invalid. Paste into Claude.')).toBeInTheDocument();
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hk pitch birchbars.invalid');
  expect(navigator.clipboard.writeText.mock.calls.flat().join('')).not.toMatch('@');
  fireEvent.click(within(screen.getByRole('status', { name: '' }).closest('[data-hk-toast]') || document.querySelector('[data-hk-toast]')).getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(bodies[`POST /api/hk/${HK}/brands/b2/pitch`]).toEqual([{}, { confirm_sheet_owner: true }, { undo: true, expect_updated_at: '2026-10-30T12:00:00Z' }]));
});

test('U3 keys on a focused row: S snoozes (Undo unsnoozes); X = not a fit with an editable reason (Save, Undo with the guard); keys never fire while typing', async () => {
  routesFor();
  routes[`POST /api/hk/${HK}/brands/b1/snooze`] = { brand: { id: 'b1', snoozed_until: '2026-11-13T00:00:00Z' } };
  routes[`POST /api/hk/${HK}/brands/b1/not-a-fit`] = b => (b?.reason ? { brand: { id: 'b1', pass_reason: b.reason, updated_at: 't2' } } : b?.undo ? { brand: { id: 'b1', updated_at: 't3' } } : { brand: { id: 'b1', pass_reason: 'Not a fit', updated_at: 't1' } });
  renderBrief();
  await screen.findByText('Zz Alder Oats');
  const r2 = rowOf('Zz Alder Oats');
  r2.focus();
  fireEvent.keyDown(r2, { key: 's' });
  expect(await screen.findByText('Zz Alder Oats snoozed for 14 days.')).toBeInTheDocument();
  fireEvent.click(within(document.querySelector('[data-hk-toast]')).getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(bodies[`POST /api/hk/${HK}/brands/b1/snooze`]).toEqual([{ on: true }, { on: false }]));
  fireEvent.keyDown(rowOf('Zz Alder Oats'), { key: 'x' });
  expect(await screen.findByText('Zz Alder Oats: not a fit.')).toBeInTheDocument();
  const reason = screen.getByLabelText('Reason');
  fireEvent.keyDown(reason, { key: 's' });
  fireEvent.change(reason, { target: { value: 'Wholesale only' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Zz Alder Oats: Wholesale only.')).toBeInTheDocument();
  fireEvent.click(within(document.querySelector('[data-hk-toast]')).getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(bodies[`POST /api/hk/${HK}/brands/b1/not-a-fit`]).toEqual([{}, { reason: 'Wholesale only' }, { undo: true, expect_updated_at: 't2' }]));
  expect(bodies[`POST /api/hk/${HK}/brands/b1/snooze`].length).toBe(2);
});

test('Research the n: the estimate first ("no estimate yet" under 3 rows), then one batch; Copy batch command copies the ready rows', async () => {
  routesFor();
  routes[`POST /api/hk/${HK}/research/batch`] = b => (b.confirm ? { estimate: { n: 1 }, results: [{ brand_id: 'b1', status: 'researched', cost_usd: 0.04 }], stopped: null, cost_usd: 0.04 } : { estimate: { n: 1, per_call: null, total_usd: null, words: 'no estimate yet' } });
  renderBrief();
  fireEvent.click(await screen.findByRole('button', { name: 'Research the 1' }));
  const bar = await screen.findByRole('alertdialog', { name: 'Research these brands?' });
  expect(bar).toHaveTextContent('Research 1 brand · no estimate yet. One research each; it stops at the daily $1.00 cap.');
  fireEvent.click(within(bar).getByRole('button', { name: 'Research 1' }));
  expect(await screen.findByText('Researched 1 brand ($0.04).')).toBeInTheDocument();
  expect(bodies[`POST /api/hk/${HK}/research/batch`]).toEqual([{ brand_ids: ['b1'] }, { brand_ids: ['b1'], confirm: true }]);
  fireEvent.click(screen.getByRole('button', { name: 'Copy batch command (1)' }));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hk pitch birchbars.invalid');
});

test('Research the n runs one brand per request and stops at the first stop (the daily cap)', async () => {
  routesFor();
  routes[`GET /api/hk/${HK}/briefing`] = { ...BRIEF, send: [...BRIEF.send, card({ id: 'b4', name: 'Zz Dune Dates' }), card({ id: 'b5', name: 'Zz Elm Eggs' })] };
  let n = 0;
  routes[`POST /api/hk/${HK}/research/batch`] = b => (!b.confirm ? { estimate: { n: 3, per_call: 0.04, total_usd: 0.12, words: 'about $0.12' } } : (n += 1) === 1 ? { results: [{ brand_id: b.brand_ids[0], status: 'researched', cost_usd: 0.04 }], stopped: null } : { results: [], stopped: 'daily cap ($1.00)' });
  renderBrief();
  fireEvent.click(await screen.findByRole('button', { name: 'Research the 3' }));
  expect(await screen.findByRole('alertdialog', { name: 'Research these brands?' })).toHaveTextContent('Research 3 brands · about $0.12.');
  fireEvent.click(screen.getByRole('button', { name: 'Research 3' }));
  expect(await screen.findByText('Researched 1 brand ($0.04). Stopped: daily cap ($1.00).')).toBeInTheDocument();
  expect(bodies[`POST /api/hk/${HK}/research/batch`]).toEqual([{ brand_ids: ['b1', 'b4', 'b5'] }, { brand_ids: ['b1'], confirm: true }, { brand_ids: ['b4'], confirm: true }]);
});

test('U5 rail: Important now from the Inbox\'s own load; Waiting on them - Bump when due opens Today (never sends), else Open', async () => {
  routesFor();
  const onGo = jest.fn(), onOpenBrand = jest.fn(), onOpenThread = jest.fn();
  renderBrief('owner', { onGo, onOpenBrand, onOpenThread });
  const imp = await screen.findByRole('region', { name: 'Important now' });
  expect(within(imp).getAllByRole('button').map(b => b.dataset.hkImportant)).toEqual(['t2', 't3', 't1', 't4']);
  fireEvent.click(within(imp).getAllByRole('button')[0]); expect(onOpenThread).toHaveBeenCalledWith('t2');
  const wait = screen.getByRole('region', { name: 'Waiting on them' });
  fireEvent.click(within(wait).getByRole('button', { name: 'Bump' })); expect(onGo).toHaveBeenCalledWith('today');
  fireEvent.click(within(wait).getByRole('button', { name: 'Open' })); expect(onOpenBrand).toHaveBeenCalledWith('b8');
  expect(calls.filter(c => !c.startsWith('GET'))).toEqual([]);
});

test('grow-sheet-owner-respect F2: one muted line per sheet name skipped from Send these 10; none when nothing was skipped', async () => {
  routesFor();
  routes[`GET /api/hk/${HK}/briefing`] = { ...BRIEF, sheet_skipped: [{ hint: 'Pete', n: 673 }, { hint: 'Sky', n: 1 }] };
  const { unmount } = renderBrief();
  const send = await screen.findByRole('region', { name: 'Send these 10' });
  expect(within(send).getByText("673 brands are on Pete's sheet list. They stay out of your 10 until Pete claims them or you take one.")).toBeInTheDocument();
  expect(within(send).getByText("1 brand is on Sky's sheet list. It stays out of your 10 until Sky claims it or you take one.")).toBeInTheDocument();
  unmount();
  routes[`GET /api/hk/${HK}/briefing`] = { ...BRIEF, sheet_skipped: [] };
  renderBrief();
  await screen.findByText('Zz Alder Oats');
  expect(document.querySelector('[data-hk-sheet-skipped]')).toBeNull();
});

test('Viewer: rows, labels and the expand read; no checkbox, primary, quick commands, Research the n, Copy batch, Claim or Do not contact; 0 writes', async () => {
  routesFor();
  renderBrief('viewer');
  await screen.findByText('Zz Birch Bars');
  expect(document.querySelectorAll('[data-hk-send-row] input[type="checkbox"], [data-hk-primary], .hk-qcs, [data-hk-research-batch], [data-hk-copy-batch]').length).toBe(0);
  const ex = rowOf('Zz Birch Bars').querySelector('[data-hk-expand]');
  expect(within(ex).queryByRole('button', { name: /Claim only|Do not contact|Edit/ })).toBeNull();
  expect(within(ex).getByRole('button', { name: /Copy command/ })).toBeInTheDocument();
  fireEvent.keyDown(rowOf('Zz Birch Bars'), { key: 's' });
  expect(calls.filter(c => !c.startsWith('GET'))).toEqual([]);
});

test('Inbox opens on Briefing from ONE list load; Important now jumps to Needs you sorted by importance with the why chip; Newest restores Gmail order', async () => {
  routesFor();
  routes[`GET /api/hk/${HK}/inbox/threads`] = { tab: 'inbox', threads: ROWS, next_page_token: null, lane_counts: {}, unread: 0, fetched_at: '2026-10-29T15:00:00Z' };
  routes[`GET /api/hk/${HK}/inbox/threads/t2`] = { thread_id: 't2', subject: 'About t2', messages: [], chip: { kind: 'untracked' }, sender: { name: 'Person t2', domain: null }, brand: null, intel: null };
  render(<InboxScreen businessId={HK} shell={shell('owner')} gmail={{ mailbox: { linked: true, state: 'ok' } }} compact={false} canEdit owner="me" onOpenBrand={jest.fn()} onOpenConnections={jest.fn()} onUnread={jest.fn()} onGo={jest.fn()} />);
  expect(screen.getByRole('tab', { name: 'Briefing' })).toHaveAttribute('aria-selected', 'true');
  const imp = await screen.findByRole('region', { name: 'Important now' });
  await waitFor(() => expect(within(imp).getAllByRole('button').length).toBe(4));
  expect(calls.filter(c => c.startsWith('GET /api/hk/biz-hk/inbox/threads?')).length).toBe(1);
  fireEvent.click(within(imp).getAllByRole('button')[0]);
  await waitFor(() => expect(screen.getByRole('tab', { name: /^Needs you/ })).toHaveAttribute('aria-selected', 'true'));
  const order = () => [...document.querySelectorAll('[data-hk-inbox-list] [data-hk-thread]')].map(b => b.dataset.hkThread);
  expect(order()).toEqual(['t2', 't3', 't1', 't4']);
  expect(document.querySelector('[data-hk-thread="t2"] [data-hk-row-why]')).toHaveTextContent('Replied: pricing question');
  fireEvent.click(screen.getByRole('button', { name: 'Newest' }));
  expect(order()).toEqual(['t1', 't2', 't3', 't4']);
  expect(calls.filter(c => c.startsWith('GET /api/hk/biz-hk/inbox/threads?')).length).toBe(1);
});

test('Settings research: target categories edit, auto-research controls save as one intel patch, weights read-only; non-owners cannot change them', async () => {
  routesFor();
  routes[`PATCH /api/hk/${HK}/settings`] = { settings: {} };
  const { unmount } = render(<IntelSettings businessId={HK} shell={shell('owner')} canEdit />);
  await screen.findByRole('region', { name: 'Briefing and research' });
  expect(within(screen.getByRole('table')).getByText('Niche overlaps a sponsor').closest('tr')).toHaveTextContent('-15');
  fireEvent.click(screen.getByRole('button', { name: 'Remove Wellness' }));
  fireEvent.change(screen.getByLabelText('Add a target category'), { target: { value: 'gym/studio' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  fireEvent.change(screen.getByLabelText('Brands per day'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save research settings' }));
  await waitFor(() => expect(bodies[`PATCH /api/hk/${HK}/settings`]).toEqual([{ intel: { target_categories: ['National CPG', 'gym/studio'], sweep: { on: true, n: 1, cap_usd: 1, time: '06:30' } } }]));
  unmount();
  render(<IntelSettings businessId={HK} shell={shell('member')} canEdit />);
  await screen.findByRole('region', { name: 'Briefing and research' });
  expect(screen.queryByRole('button', { name: 'Save research settings' })).toBeNull();
  expect(screen.getByText('Only an owner-role member can change these.')).toBeInTheDocument();
});

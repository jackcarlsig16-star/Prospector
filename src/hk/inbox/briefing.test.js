import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import Briefing, { importantNow } from './Briefing';
import InboxScreen from '../screens/InboxScreen';
import ReachLine from '../brands/ReachLine';
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
const card = over => ({ id: 'b1', name: 'Zz Alder Oats', domain: null, category: 'National CPG', city: null, status: 'candidate', owner_user_id: null, heat_band: 'cold', score: 25, why: ['has a contact to email', 'has a challenge idea'], parts: ['draftable', 'idea'], research: null, suggestion: null, research_attempted_at: null, command: 'hk pitch Zz Alder Oats', ...over });
const BRIEF = {
  owner: 'me', tiles: { replies_waiting: 3, hot: 1, drafts: 2, followups_due: 4, dms_due: 0, sent_week: 6, reply_rate_week: 17, researched_today: { n: 0, cap: 10 } },
  send: [card(), card({ id: 'b2', name: 'Zz Birch Bars', score: 10, why: ['has a website'], research: { line: 'Oat bars · strong fit · idea: 30-day oat run', fit: 'strong' }, suggestion: { domain: 'birchbars.invalid', confidence: 'high' } }), card({ id: 'b3', name: 'Zz Cedar Cola', score: 0, why: [], suggestion: { domain: 'cedar.invalid', confidence: 'low' } })],
  waiting: [{ id: 'b9', name: 'Zz Waiting Co', waiting_days: 9, touches_used: 1, max_email_touches: 3, next_due_at: '2026-11-02T00:00:00Z' }],
  signals: { prospects: [], sponsors: [] }, eligible: 702,
  research: { on: true, n: 10, cap_usd: 1, time: '06:30', today_calls: 0, today_spend: 0, last_run: null },
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

test('Briefing: tiles link to their lists, Send these cards (why, research, website + Use, low confidence asks), Important now opens the thread, Waiting on them', async () => {
  routesFor();
  routes[`POST /api/hk/${HK}/brands/b2/use-domain`] = { brand: { id: 'b2' } };
  routes[`PATCH /api/hk/${HK}/brands/b1`] = { brand: { id: 'b1' } };
  const onGo = jest.fn(), onLane = jest.fn(), onOpenThread = jest.fn();
  render(<Briefing businessId={HK} shell={shell('owner')} owner="me" canEdit rows={ROWS} listReady onOpenThread={onOpenThread} onOpenBrand={jest.fn()} onGo={onGo} onLane={onLane} />);
  const send = await screen.findByRole('region', { name: 'Send these 10' });
  expect(within(send).getByRole('heading')).toHaveTextContent('Send these 3');
  expect(within(send).getByText('of 702 you can pitch')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Replies waiting').closest('button')); expect(onGo).toHaveBeenCalledWith('replies');
  fireEvent.click(screen.getByText('Sent this week').closest('button')); expect(onLane).toHaveBeenCalledWith('sent');
  expect(screen.getByText('17%')).toBeInTheDocument();
  const c1 = within(send).getByText('Zz Alder Oats').closest('[data-hk-send-card]');
  expect(within(c1).getByText('has a contact to email · has a challenge idea')).toBeInTheDocument();
  expect(within(c1).getByRole('button', { name: 'Research' })).toBeInTheDocument();
  const c2 = within(send).getByText('Zz Birch Bars').closest('[data-hk-send-card]');
  expect(within(c2).getByText('Oat bars · strong fit · idea: 30-day oat run')).toBeInTheDocument();
  expect(within(c2).getByText(/Website: birchbars.invalid/)).toBeInTheDocument();
  expect(within(c2).queryByRole('button', { name: 'Research' })).toBeNull();
  expect(within(send).getByText(/Possible website: cedar.invalid\?/)).toBeInTheDocument();
  fireEvent.click(within(c2).getByRole('button', { name: 'Use' }));
  await waitFor(() => expect(bodies[`POST /api/hk/${HK}/brands/b2/use-domain`]).toEqual([{}]));
  fireEvent.click(within(c1).getByRole('button', { name: 'Copy Claude command' }));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hk pitch Zz Alder Oats');
  fireEvent.click(within(c1).getByRole('button', { name: 'Claim' }));
  await waitFor(() => expect(bodies[`PATCH /api/hk/${HK}/brands/b1`]).toEqual([{ claim: true }]));
  const imp = screen.getByRole('region', { name: 'Important now' });
  const ordered = within(imp).getAllByRole('button').map(b => b.dataset.hkImportant);
  expect(ordered).toEqual(['t2', 't3', 't1', 't4']);
  expect(within(imp).getByText('Replied: pricing question')).toBeInTheDocument();
  fireEvent.click(within(imp).getAllByRole('button')[0]); expect(onOpenThread).toHaveBeenCalledWith('t2');
  expect(within(screen.getByRole('region', { name: 'Waiting on them' })).getByText(/waiting 9 days · 1 of 3 touches/)).toBeInTheDocument();
  expect(screen.getByText(/Auto-research on: up to 10 a day by 06:30, \$1.00 cap/)).toBeInTheDocument();
});

test('Research on a card posts the click flag and says what it found; Run research now posts the sweep and reports it', async () => {
  routesFor();
  routes[`POST /api/hk/${HK}/brands/b1/research`] = { status: 'researched', domain: 'alderoats.invalid', confidence: 'high', suggested: true, intel: { fit: { sponsor_fit: 'strong' } }, cost_usd: 0.04 };
  routes[`POST /api/hk/${HK}/jobs/research-sweep`] = { run: { id: 'r' }, counts: { calls: 1, cost_usd: 0.044, stopped: 'daily count' } };
  render(<Briefing businessId={HK} shell={shell('owner')} owner="me" canEdit rows={[]} listReady onOpenThread={jest.fn()} onOpenBrand={jest.fn()} onGo={jest.fn()} onLane={jest.fn()} />);
  const send = await screen.findByRole('region', { name: 'Send these 10' });
  fireEvent.click(within(send).getAllByRole('button', { name: 'Research' })[0]);
  expect(await screen.findByText('Zz Alder Oats: website alderoats.invalid (high confidence) · strong fit.')).toBeInTheDocument();
  expect(bodies[`POST /api/hk/${HK}/brands/b1/research`]).toEqual([{ click: true }]);
  fireEvent.click(screen.getByRole('button', { name: 'Run research now' }));
  expect(await screen.findByText('Researched 1 brand ($0.04), stopped at the daily count.')).toBeInTheDocument();
});

test('Viewer: the Briefing reads; no Claim, Research, Use or Run research now', async () => {
  routesFor();
  render(<Briefing businessId={HK} shell={shell('viewer')} owner="me" canEdit={false} rows={ROWS} listReady onOpenThread={jest.fn()} onOpenBrand={jest.fn()} onGo={jest.fn()} onLane={jest.fn()} />);
  await screen.findByRole('region', { name: 'Send these 10' });
  for (const name of ['Claim', 'Research', 'Use', 'Run research now']) expect(screen.queryByRole('button', { name })).toBeNull();
  expect(screen.getAllByRole('button', { name: 'Copy Claude command' }).length).toBe(3);
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

test('Brand page reach line: the score and why, a found website with Use, Research when there is none; Viewer reads only', async () => {
  routes[`GET /api/hk/${HK}/brands/b1/reach`] = { eligible: true, score: 25, why: ['has a contact to email', 'has a challenge idea'], parts: [], activity: {}, research: null, suggestion: { domain: 'alderoats.invalid', confidence: 'high' }, research_attempted_at: null };
  routes[`POST /api/hk/${HK}/brands/b1/use-domain`] = { brand: { id: 'b1' } };
  const onChanged = jest.fn();
  const { unmount } = render(<ReachLine businessId={HK} brandId="b1" canEdit onChanged={onChanged} />);
  expect(await screen.findByText('Reach-out score 25 · has a contact to email · has a challenge idea')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Research' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Use' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  unmount();
  render(<ReachLine businessId={HK} brandId="b1" canEdit={false} />);
  expect(await screen.findByText(/Website: alderoats.invalid/)).toBeInTheDocument();
  expect(screen.queryByRole('button')).toBeNull();
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

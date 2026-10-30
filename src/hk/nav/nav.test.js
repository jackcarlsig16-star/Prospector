import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import HkShell from '../HkShell';
import Buckets from './Buckets';
import { parseBrandQuery, brandQuery, brandRequest, toggleValue, layoutOf, parseInboxQuery, inboxQuery } from './filterState';
import { brandBuckets, inboxBuckets, inboxCounts } from './railBuckets';
import { ensureHkTheme } from '../hkTheme';

// grow-nav-filters-v1 Stage 3 - the rail, the spaces, the address, saved views and the one search, against a recorded
// fetch. Invented brands; no address in any fixture; 0 Gmail (no Inbox lane is opened here).
const HK = 'biz-hk', ME = '00000000-0000-4000-8000-000000000001', SKY = '00000000-0000-4000-8000-000000000002';
window.matchMedia = q => { const m = /max-width:\s*(\d+)px/.exec(q); return { matches: m ? 1440 <= Number(m[1]) : false, addEventListener() {}, removeEventListener() {} }; };
const members = [{ user_id: ME, first_name: 'Rowan', palette_index: 1, signed_up: true, role: 'owner' }, { user_id: SKY, first_name: 'Sky', palette_index: 2, signed_up: true, role: 'member' }];
const SHELL = role => ({ me: { user_id: ME, role, first_name: 'Rowan', owner_filter: 'all' }, members, modules: [{ key: 'email', label: 'Email', on: true }] });
const FACETS = {
  view: [['all', 953], ['pipeline', 252], ['my_open', 29], ['unclaimed', 611], ['overdue', 96], ['sponsors', 68], ['dnc', 0], ['hot', 0], ['targets', 0]],
  stage: [['candidate', 633], ['claimed', 71], ['sent', 106]], heat: [['cool', 1], ['cold', 952]],
  owner: [['sheet:pete', 673], ['unclaimed', 250], [ME, 30]], relationship: [['prospect', 885]], segment: [['sponsor_brand', 886], ['press', 32], ['podcast', 30]],
  category: [['none', 752]], email: [['never', 944]], due: [['overdue', 96], ['week', 11], ['later', 8], ['none', 838]], research: [['no', 952]], sponsor_months: [['yes', 68]], place: [],
};
const brand = (n, over = {}) => ({ id: `b${n}`, name: `Zz Brand ${n}`, status: 'sent', relationship: 'prospect', owner_user_id: null, owner_hint: 'pete', heat_band: 'cold', is_local: false, source: 'import', ...over });
let calls, bodies, prefs;
const json = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
const setup = (role = 'owner') => {
  calls = []; bodies = []; prefs = { saved_views: [], rail: {} };
  global.fetch = jest.fn((url, init = {}) => {
    const u = new URL(url, 'http://x'), method = init.method || 'GET', p = u.pathname.replace(`/api/hk/${HK}`, '');
    calls.push({ method, p, q: Object.fromEntries(u.searchParams) });
    if (init.body) bodies.push({ method, p, body: JSON.parse(init.body) });
    if (p === '/shell') return json(200, SHELL(role));
    if (p === '/me/prefs') { if (method === 'PUT') prefs = { ...prefs, ...JSON.parse(init.body) }; return json(200, { prefs }); }
    if (p === '/brands') { const q = Object.fromEntries(u.searchParams); return json(200, { view: q.view, total: q.stage ? 101 : 953, page: 1, limit: 100, next_page: null, rows: [brand(1), brand(2, { status: 'claimed' })], facets: q.facets ? FACETS : undefined }); }
    if (p === '/gmail/status') return json(200, { mailbox: { linked: false }, badges: { drafts: 1, replies: 2, tracked: 0, owner: u.searchParams.get('owner') } });
    if (p === '/jobs/today') return json(200, { owner_counts: { urgent: 0, replies: 1, drafts: 0, no_draft: 0, dm_ready: 0 }, digest: { counts: {}, sections: {} } });
    if (p === '/signals') return json(200, { prospects: [], sponsors: [], unseen_hot_warm: 0 });
    if (p === '/replies') return json(200, { replies: [{ id: 'r1', brand_id: 'b1', brand_name: 'Zz Brand 1', label: 'pricing', handled: false, received_at: '2026-10-28T00:00:00Z' }] });
    if (p === '/drafts') return json(200, { drafts: [] });
    if (p === '/search') return json(200, { q: u.searchParams.get('q'), brands: [], people: [], replies: [] });
    if (p === '/sponsors') return json(200, { sponsors: [], dnc: [] });
    return json(404, { error: `no route ${p}` });
  });
};
const mount = async (hash, role) => {
  setup(role);
  window.history.replaceState(null, '', `/${hash}`);
  const r = render(<HkShell business={{ id: HK, name: 'HumanKind' }} businesses={[]} userId={ME} compact={false} onSelectBusiness={() => {}} onAllWorkspaces={() => {}} onOpenAdmin={() => {}} onOpenConnections={() => {}} />);
  await screen.findByRole('navigation', { name: 'Grow' });
  return r;
};
const lastBrands = () => calls.filter(c => c.p === '/brands').at(-1).q;
beforeEach(() => { try { localStorage.clear(); } catch { /* jsdom */ } });

test('filter state: the address round-trips; the owner toggle is the default owner filter, an Owner bucket choice wins; Pipeline opens by stage', () => {
  const st = parseBrandQuery('view=pipeline&stage=sent,bumped&owner=me&sort=next_due&dir=desc');
  expect(st).toMatchObject({ view: 'pipeline', filters: { stage: ['sent', 'bumped'], owner: ['me'] }, sort: 'next_due', dir: 'desc' });
  expect(brandQuery(st)).toBe('view=pipeline&stage=sent,bumped&owner=me&sort=next_due&dir=desc');
  expect(brandRequest(parseBrandQuery(''), 'me')).toMatchObject({ owner: 'me', view: 'all' });
  expect(brandRequest(parseBrandQuery('owner=sheet:pete'), 'me').owner).toBe('sheet:pete');
  expect(brandRequest(parseBrandQuery(''), 'all').owner).toBeUndefined();
  expect(layoutOf(parseBrandQuery('view=pipeline'))).toBe('stage');
  expect(brandRequest(parseBrandQuery('view=pipeline'), 'all').sort).toBe('status');
  expect(toggleValue(toggleValue(parseBrandQuery(''), 'stage', 'sent'), 'stage', 'sent').filters).toEqual({});
  expect(parseInboxQuery('replies=open&reply=r9')).toEqual({ kind: 'replies', value: 'open', reply: 'r9' });
  expect(parseInboxQuery('lane=nope')).toEqual({ kind: 'lane', value: 'briefing' });
  expect(inboxQuery({ kind: 'drafts', value: 'older' })).toBe('drafts=older');
});

test('rail buckets: the nine views always (Hot leads, Targets, Do not contact at 0), values data-driven, Owner mirrors OwnerChip, saved views listed', () => {
  const b = brandBuckets({ facets: FACETS, state: parseBrandQuery('owner=me'), meId: ME, members, savedViews: [{ id: 'v1', name: 'Sent, unclaimed', space: 'brands', filters: {} }] });
  const views = b.find(x => x.key === 'views').items;
  expect(views.map(v => [v.label, v.count])).toEqual([['All', 953], ['Pipeline', 252], ['My open', 29], ['Unclaimed', 611], ['Overdue', 96], ['Sponsors', 68], ['Do not contact', 0], ['Hot leads', 0], ['Targets', 0], ['Sent, unclaimed', undefined]]);
  expect(b.find(x => x.key === 'owner').items.map(i => [i.id, i.label, i.count, i.active])).toEqual([['sheet:pete', 'Sheet: Pete · not in Grow yet', 673, false], ['unclaimed', 'Unclaimed', 250, false], ['me', 'Me', 30, true]]);
  expect(b.find(x => x.key === 'due').items.map(i => i.label)).toEqual(['Overdue', 'Due in 7 days', 'Due later', 'No due date']);
  expect(b.some(x => x.key === 'place')).toBe(false);
  const counts = inboxCounts([{ handled: false, label: 'pricing' }, { handled: false, label: 'interested', snoozed_until: '2999-01-01T00:00:00Z' }, { handled: true, label: 'other' }], [{ channel: 'email', lint_passed: false, age_days: 5 }, { channel: 'ig_dm', age_days: 1 }]);
  expect(counts).toEqual({ replies: { open: 1, snoozed: 1, handled: 1, pricing: 1 }, drafts: { all: 2, email: 1, ig_dm: 1, lint_failed: 1, older: 1 } });
  const ib = inboxBuckets({ sel: { kind: 'replies', value: 'open' }, laneCounts: { needs_you: 7 }, counts });
  expect(ib.map(x => x.label)).toEqual(['My mail', 'Tracked replies', 'Queued drafts']);
  expect(ib[0].items.find(i => i.id === 'needs_you').count).toBe(7);
  expect(ib[1].items.map(i => i.id)).toEqual(['open', 'pricing', 'snoozed', 'handled']);
});

test('N2 keyboard: ↓ / ↑ move through headers and items, Space toggles, ← collapses (from an item: back to its header), → expands', () => {
  const onPick = jest.fn(), onCollapse = jest.fn();
  render(<Buckets buckets={[{ key: 'stage', label: 'Stage', icon: 'flow', items: [{ id: 'sent', label: 'Sent', count: 106, active: false }, { id: 'claimed', label: 'Claimed', count: 71, active: true }] }]} collapsed={new Set()} onCollapse={onCollapse} onPick={onPick} />);
  const head = screen.getByRole('button', { name: /Stage/ });
  head.focus();
  fireEvent.keyDown(head, { key: 'ArrowDown' });
  const sent = screen.getByRole('button', { name: /Sent/ });
  expect(document.activeElement).toBe(sent);
  fireEvent.click(sent); expect(onPick).toHaveBeenCalledWith('stage', 'sent');
  expect(screen.getByRole('button', { name: /Claimed/ })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.keyDown(sent, { key: 'ArrowLeft' }); expect(document.activeElement).toBe(head);
  fireEvent.keyDown(head, { key: 'ArrowLeft' }); expect(onCollapse).toHaveBeenLastCalledWith('stage', true);
  fireEvent.keyDown(head, { key: 'ArrowRight' }); expect(onCollapse).toHaveBeenLastCalledWith('stage', false);
});

test('Brands space: the rail shows the counted buckets; Stage › Sent + Owner › Sheet Pete re-read the list, show chips, ride in the address; Clear all resets', async () => {
  await mount('#hk/brands');
  const rail = screen.getByRole('navigation', { name: 'Grow' });
  await within(rail).findByText('Podcast');
  expect(within(rail).getAllByRole('button', { name: /^Hot leads/ })).toHaveLength(1);
  for (const gone of ['Replies', 'Drafts']) expect(within(rail).queryByRole('button', { name: new RegExp(`^${gone}`) })).toBeNull();
  expect(rail.querySelector('[data-hk-nav="pipeline"], [data-hk-nav="sponsors"], [data-hk-nav="replies"], [data-hk-nav="drafts"]')).toBeNull();
  fireEvent.click(rail.querySelector('[data-hk-filter="stage:sent"]'));
  await waitFor(() => expect(lastBrands()).toMatchObject({ stage: 'sent', page: '1', facets: '1' }));
  fireEvent.click(rail.querySelector('[data-hk-filter="owner:sheet:pete"]'));
  await waitFor(() => expect(lastBrands()).toMatchObject({ stage: 'sent', owner: 'sheet:pete' }));
  expect(window.location.hash).toBe('#hk/brands?stage=sent&owner=sheet:pete');
  await waitFor(() => expect(document.querySelector('[data-hk-result-count]')).toHaveTextContent('101 brands'));
  expect(screen.getByText('Stage: Sent')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Remove Stage: Sent' }));
  await waitFor(() => expect(window.location.hash).toBe('#hk/brands?owner=sheet:pete'));
  fireEvent.click(screen.getByText('Clear all'));
  await waitFor(() => expect(window.location.hash).toBe('#hk/brands'));
});

test('N7 save -> listed under Views -> remove: stored with PUT /me/prefs, filters only', async () => {
  await mount('#hk/brands?stage=sent&owner=unclaimed');
  fireEvent.click(await screen.findByRole('button', { name: 'Save view' }));
  fireEvent.change(screen.getByLabelText('View name'), { target: { value: 'Sent, unclaimed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(prefs.saved_views).toHaveLength(1));
  expect(prefs.saved_views[0]).toMatchObject({ name: 'Sent, unclaimed', space: 'brands', view: 'all', filters: { stage: ['sent'], owner: ['unclaimed'] }, layout: 'table' });
  const rail = screen.getByRole('navigation', { name: 'Grow' });
  expect(await within(rail).findByRole('button', { name: 'Sent, unclaimed' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(within(rail).getByRole('button', { name: 'Remove Sent, unclaimed from your views' }));
  await waitFor(() => expect(prefs.saved_views).toEqual([]));
  expect(bodies.filter(b => b.p === '/me/prefs').every(b => !JSON.stringify(b.body).includes('@'))).toBe(true);
});

test('saved view rename is an inline rail field: Esc cancels with no write, Enter saves (spaces collapsed, <= 40), a refused name stays open with the reason', async () => {
  const prompt = jest.spyOn(window, 'prompt');
  setup();
  const seeded = { saved_views: [{ id: 'sent-unclaimed', name: 'Sent, unclaimed', space: 'brands', view: 'all', filters: { stage: ['sent'] } }], rail: {} };
  prefs = seeded;
  const base = global.fetch;
  global.fetch = jest.fn((url, init = {}) => {
    if (String(url).endsWith('/me/prefs') && init.method === 'PUT' && init.body.includes('@')) return json(400, { error: "saved view name can't hold an email address or phone number" });
    return base(url, init);
  });
  window.history.replaceState(null, '', '/#hk/brands');
  render(<HkShell business={{ id: HK, name: 'HumanKind' }} businesses={[]} userId={ME} compact={false} onSelectBusiness={() => {}} onAllWorkspaces={() => {}} onOpenAdmin={() => {}} onOpenConnections={() => {}} />);
  const rail = await screen.findByRole('navigation', { name: 'Grow' });
  const puts = () => bodies.filter(b => b.p === '/me/prefs' && b.body.saved_views).length;

  fireEvent.click(await within(rail).findByRole('button', { name: 'Rename Sent, unclaimed' }));
  let field = within(rail).getByLabelText('New name for Sent, unclaimed');
  expect(field).toHaveValue('Sent, unclaimed');
  expect(field).toHaveAttribute('maxLength', '40');
  fireEvent.change(field, { target: { value: 'Something else' } });
  fireEvent.keyDown(field, { key: 'Escape' });
  expect(within(rail).queryByLabelText('New name for Sent, unclaimed')).toBeNull();
  expect(within(rail).getByRole('button', { name: 'Sent, unclaimed' })).toBeInTheDocument();
  expect(puts()).toBe(0);

  fireEvent.click(within(rail).getByRole('button', { name: 'Rename Sent, unclaimed' }));
  field = within(rail).getByLabelText('New name for Sent, unclaimed');
  fireEvent.change(field, { target: { value: 'ask me@x.co' } });
  fireEvent.submit(field.closest('form'));
  expect(await within(rail).findByRole('alert')).toHaveTextContent("can't hold an email address");
  expect(within(rail).getByLabelText('New name for Sent, unclaimed')).toBeInTheDocument();
  expect(prefs.saved_views[0].name).toBe('Sent, unclaimed');

  fireEvent.change(within(rail).getByLabelText('New name for Sent, unclaimed'), { target: { value: '  Sent   to   Pete  ' } });
  fireEvent.submit(within(rail).getByLabelText('New name for Sent, unclaimed').closest('form'));
  await waitFor(() => expect(prefs.saved_views[0]).toMatchObject({ id: 'sent-unclaimed', name: 'Sent to Pete', filters: { stage: ['sent'] } }));
  expect(await within(rail).findByRole('button', { name: 'Sent to Pete' })).toBeInTheDocument();
  expect(within(rail).queryByRole('textbox', { name: /New name/ })).toBeNull();
  expect(prompt).not.toHaveBeenCalled();
  prompt.mockRestore();
});

test('rail heat dots: Cool and Cold are >= 3:1 against the rail (sand), Hot unchanged, the heat-bar tokens unchanged', () => {
  ensureHkTheme();
  const css = document.getElementById('hk-theme-css').textContent;
  const token = n => new RegExp(`--hk-${n}:(#[0-9A-F]{6})`, 'i').exec(css)[1];
  const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const rail = token('sand');
  expect(css).toMatch(/\.hk-dot--heat-cool \{ background:var\(--hk-heat-cool-dot\); \}/);
  expect(css).toMatch(/\.hk-dot--heat-cold \{ background:var\(--hk-heat-cold-dot\); \}/);
  const table = { cool: ratio(token('heat-cool-dot'), rail), cold: ratio(token('heat-cold-dot'), rail), hot: ratio(token('heat-hot-bar'), rail) };
  expect(table.cool).toBeGreaterThanOrEqual(3);
  expect(table.cold).toBeGreaterThanOrEqual(3);
  expect(table.hot).toBeGreaterThanOrEqual(3);
  expect([token('heat-hot-bar'), token('heat-warm-bar'), token('heat-cool-bar')]).toEqual(['#278245', '#8FC283', '#D2C19C']);
  expect(css).toMatch(/\.hk-heat--cool \{ background:var\(--hk-sand\)/);
});

test('N9 old links: #hk/pipeline lands on Views › Pipeline grouped by stage; #hk/sponsors hosts the Sponsors screen; #hk/replies opens Tracked replies › Open', async () => {
  const a = await mount('#hk/pipeline');
  await waitFor(() => expect(window.location.hash).toBe('#hk/brands?view=pipeline'));
  await waitFor(() => expect(lastBrands()).toMatchObject({ view: 'pipeline', sort: 'status' }));
  expect(screen.getByRole('button', { name: 'By stage' })).toHaveAttribute('aria-pressed', 'true');
  a.unmount();
  const b = await mount('#hk/sponsors');
  await waitFor(() => expect(window.location.hash).toBe('#hk/brands?view=sponsors'));
  expect(await screen.findByText('Current and past sponsors')).toBeInTheDocument();
  b.unmount();
  await mount('#hk/replies');
  await waitFor(() => expect(window.location.hash).toBe('#hk/inbox?replies=open'));
  await waitFor(() => expect(calls.some(c => c.p === '/replies' && c.q.snoozed === 'hide' && c.q.handled === 'false')).toBe(true));
  expect(calls.some(c => c.p.startsWith('/inbox'))).toBe(false);
});

test('N6 one search: "/" opens it; "pod" offers Segment › Podcast (30); Enter applies it in Brands; an address is never sent', async () => {
  await mount('#hk/today');
  fireEvent.keyDown(window, { key: '/' });
  const input = await screen.findByLabelText('Search brands, people, replies, filters', { selector: 'input[data-hk-search-input]' });
  fireEvent.change(input, { target: { value: 'pod' } });
  const hit = await screen.findByText('Segment › Podcast');
  expect(hit.closest('button')).toHaveTextContent('(30)');
  await waitFor(() => expect(calls.some(c => c.p === '/search' && c.q.q === 'pod')).toBe(true));
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(window.location.hash).toBe('#hk/brands?segment=podcast'));
  fireEvent.keyDown(window, { key: '/' });
  const again = await screen.findByLabelText('Search brands, people, replies, filters', { selector: 'input[data-hk-search-input]' });
  const before = calls.filter(c => c.p === '/search').length;
  fireEvent.change(again, { target: { value: 'ana@alder.invalid' } });
  expect(await screen.findByText(/an email address is never sent/)).toBeInTheDocument();
  await act(async () => { await new Promise(r => setTimeout(r, 300)); });
  expect(calls.filter(c => c.p === '/search').length).toBe(before);
});

test('collapse: the rail button and "[" make it a 56 px icon rail, remembered per browser; a bucket icon opens its flyout', async () => {
  await mount('#hk/brands');
  fireEvent.click(screen.getByRole('button', { name: /Collapse the rail/ }));
  expect(document.querySelector('[data-hk-rail="narrow"]')).not.toBeNull();
  expect(localStorage.getItem('prospector_hk_rail')).toBe('narrow');
  fireEvent.click(await screen.findByRole('button', { name: 'Stage' }));
  expect(screen.getByRole('dialog', { name: 'Stage' })).toBeInTheDocument();
  fireEvent.keyDown(document.body, { key: '[' });
  await waitFor(() => expect(document.querySelector('[data-hk-rail="wide"]')).not.toBeNull());
  expect(localStorage.getItem('prospector_hk_rail')).toBe('wide');
});

test('N8 + N13: badges ask for the owner toggle; a Viewer in Tracked replies sees no checkbox, no Mark handled, no drawer controls', async () => {
  await mount('#hk/inbox?replies=open', 'viewer');
  await screen.findByText('Zz Brand 1');
  await waitFor(() => expect(calls.filter(c => c.p === '/gmail/status').map(c => c.q.owner)).toEqual(['all']));
  expect(calls.filter(c => c.p === '/jobs/today').map(c => c.q.owner)).toEqual(['all']);
  expect(screen.queryByRole('checkbox')).toBeNull();
  fireEvent.click(screen.getByText('Zz Brand 1'));
  expect(await screen.findByRole('dialog', { name: /Reply from/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Mark handled' })).toBeNull();
  expect(screen.queryByLabelText('Reply label')).toBeNull();
  expect(calls.filter(c => c.method !== 'GET')).toEqual([]);
});

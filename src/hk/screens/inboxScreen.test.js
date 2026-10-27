import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import InboxScreen, { ONLY_YOU } from './InboxScreen';
import ConnectionsSettings from './ConnectionsSettings';
import { IMAGES_KEY } from '../inbox/inboxPrefs';

// hkos-inbox-v1 Stage 2 - the Inbox screen against a recorded fetch: chips per kind, the sandboxed frame, images blocked
// until Show images, the actions, no compose or Send, the phone pane switch, the Connections Inbox options. Invented
// senders on .invalid; the one address in the fixtures lives inside an html body (the owner's own, by ruling).
const HK = 'biz-hk';
const shell = { me: { user_id: 'u-jack', first_name: 'Jack', role: 'owner' }, members: [{ user_id: 'u-jack', first_name: 'Jack', palette_index: 1 }, { user_id: 'u-pete', first_name: 'Pete', palette_index: 2 }] };
const gmail = { mailbox: { linked: true, state: 'ok', email: 'jack.work@humankind.invalid' }, badges: { drafts: 0, replies: 0, tracked: 1 } };
let calls, routes;
const json = (status, body) => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });
beforeEach(() => {
  calls = []; routes = {}; localStorage.clear();
  global.fetch = jest.fn((url, init = {}) => {
    const method = init.method || 'GET'; const u = new URL(url, 'http://x'); calls.push(`${method} ${u.pathname}${u.search}`);
    const hit = routes[`${method} ${u.pathname}`]; if (!hit) return json(404, { error: `no route ${method} ${u.pathname}` });
    const v = typeof hit === 'function' ? hit(init.body ? JSON.parse(init.body) : null, u) : hit; return v && v.__status ? json(v.__status, v.body) : json(200, v);
  });
  Object.assign(navigator, { clipboard: { writeText: jest.fn(() => Promise.resolve()) } });
});

const row = (id, chip, over = {}) => ({ thread_id: id, unread: false, from_name: 'Sam Lee', from_domain: 'bluefin.invalid', from_hint: 'bluefin.invalid', date: '2026-10-26T15:00:00Z', subject: `Subject ${id}`, snippet: 'Saw the app, would love to chat', message_count: 1, has_attachments: false, chip, ...over });
const LIST = { tab: 'inbox', unread: 2, next_page_token: null, fetched_at: '2026-10-26T20:00:00Z', threads: [
  row('th-tracked', { kind: 'tracked', brand_id: 'b-yoga', brand_name: 'Harbor Yoga', status: 'sent', label: 'interested' }, { from_name: 'Ana', from_domain: 'harboryoga.invalid', from_hint: 'Owner', unread: true }),
  row('th-match', { kind: 'matches', brand_id: 'b-run', brand_name: 'Bluefin Run Club', status: 'candidate' }, { unread: true, from_hint: 'Co-founder' }),
  row('th-team', { kind: 'team' }, { from_name: 'Pete', from_domain: 'humankindcollective.app' }),
  row('th-bulk', { kind: 'not_tracked', reason: 'bulk' }, { from_name: 'shop.invalid', from_domain: 'shop.invalid' }),
  row('th-new', { kind: 'untracked' }, { from_name: 'Ana Ortiz', from_domain: 'newbrand.invalid', has_attachments: true }),
] };
const HTML = '<p>Saw the app. Reach me at sam@bluefin.invalid</p><img src="https://t.invalid/pixel.gif"><script>steal()</script><form><input></form>';
const thread = (id, over = {}) => ({ thread_id: id, subject: `Subject ${id}`, fetched_at: '2026-10-26T20:00:00Z', unhandled_reply_id: null, sender: { name: 'Sam Lee', domain: 'bluefin.invalid' }, chip: { kind: 'untracked' }, brand: null,
  messages: [{ id: 'm1', from_name: 'Sam Lee', from_domain: 'bluefin.invalid', is_mine: false, to_names: ['you'], cc_names: [], date: '2026-10-26T15:00:00Z', subject: `Subject ${id}`, unread: true, text: 'Saw the app', html: HTML, attachments: [{ name: 'Deck.pdf', size: 48213 }] }], ...over });
const BRAND = { id: 'b-run', name: 'Bluefin Run Club', domain: 'bluefin.invalid', status: 'candidate', relationship: 'prospect', owner_user_id: null, challenge_idea: 'A 5k streak', touch_count: 0, last_reply_label: null, verdict: { ok: true, reason: null, warnings: [] } };
const setup = (over = {}) => { routes[`GET /api/hk/${HK}/inbox/threads`] = LIST; return render(<InboxScreen businessId={HK} shell={shell} gmail={gmail} compact={false} canEdit onOpenBrand={jest.fn()} onOpenConnections={jest.fn()} onUnread={over.onUnread || jest.fn()} />); };

test('list: one row per thread with the chip for its kind, dimmed not-tracked rows, unread dots, badge callback, no compose or Send anywhere', async () => {
  const onUnread = jest.fn();
  const { container } = setup({ onUnread });
  await screen.findByText('Subject th-tracked');
  expect(container.querySelector('[data-hk-thread="th-tracked"]').textContent).toMatch(/Tracked · Sent/);
  expect(container.querySelector('[data-hk-thread="th-tracked"]').textContent).toMatch(/Interested/);
  expect(container.querySelector('[data-hk-thread="th-match"]').textContent).toMatch(/Matches Bluefin Run Club/);
  expect(container.querySelector('[data-hk-thread="th-team"]').textContent).toMatch(/Team/);
  expect(container.querySelector('[data-hk-thread="th-bulk"]').className).toMatch(/hk-inbox__row--dim/);
  expect(container.querySelector('[data-hk-thread="th-bulk"]').textContent).toMatch(/Not tracked/);
  expect(container.querySelector('[data-hk-thread="th-new"]').textContent).toMatch(/New sender/);
  expect(container.querySelector('[data-hk-thread="th-new"]').textContent).toMatch(/Attachment/);
  expect(container.querySelectorAll('.hk-inbox__dot')).toHaveLength(2);
  expect(onUnread).toHaveBeenCalledWith(2);
  expect(screen.getByText(ONLY_YOU)).toBeInTheDocument();
  expect(container.querySelector('textarea')).toBeNull();
  expect(screen.queryByRole('button', { name: /^send$/i })).toBeNull();
  expect(container.textContent).not.toMatch(/\bSend\b/);
  expect(container.textContent).not.toMatch(/[–—]/);
  expect(container.textContent).not.toMatch(/@/);
  expect(calls[0]).toBe(`GET /api/hk/${HK}/inbox/threads?tab=inbox`);
});

test('tabs and search hit the route with tab / q; Refresh sends refresh=1; Load more appends with the page token', async () => {
  const { container } = setup();
  await screen.findByText('Subject th-tracked');
  fireEvent.click(screen.getByRole('button', { name: 'Brands only' }));
  await waitFor(() => expect(calls).toContain(`GET /api/hk/${HK}/inbox/threads?tab=brands`));
  fireEvent.change(container.querySelector('[data-hk-inbox-search]'), { target: { value: 'from:bluefin.invalid' } });
  fireEvent.submit(container.querySelector('[data-hk-inbox-search]').closest('form'));
  await waitFor(() => expect(calls).toContain(`GET /api/hk/${HK}/inbox/threads?tab=brands&q=from%3Abluefin.invalid`));
  fireEvent.click(container.querySelector('[data-hk-inbox-refresh]'));
  await waitFor(() => expect(calls.some(c => c.endsWith('&refresh=1'))).toBe(true));
  routes[`GET /api/hk/${HK}/inbox/threads`] = (body, u) => (u.searchParams.get('pageToken') === 'p2' ? { ...LIST, threads: [row('th-6', { kind: 'untracked' })], next_page_token: null } : { ...LIST, next_page_token: 'p2' });
  fireEvent.click(container.querySelector('[data-hk-inbox-refresh]'));
  const more = await screen.findByRole('button', { name: 'Load more' });
  fireEvent.click(more);
  await screen.findByText('Subject th-6');
  expect(screen.getByText('Subject th-tracked')).toBeInTheDocument();
});

test('open: the html renders only in <iframe sandbox=""> from sanitized srcdoc, images blocked until Show images, Reply in Gmail, Track as brand / Ignore for a new sender', async () => {
  routes[`GET /api/hk/${HK}/inbox/threads/th-new`] = thread('th-new', { sender: { name: 'Ana Ortiz', domain: 'newbrand.invalid' } });
  const { container } = setup();
  fireEvent.click(await screen.findByText('Subject th-new'));
  const frame = await waitFor(() => { const f = container.querySelector('[data-hk-frame]'); if (!f) throw new Error('no frame'); return f; });
  expect(frame.tagName).toBe('IFRAME');
  expect(frame.getAttribute('sandbox')).toBe('');
  expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
  const doc = frame.getAttribute('srcdoc');
  expect(doc).not.toContain('<script'); expect(doc).not.toContain('<form'); expect(doc).not.toContain('<input');
  expect(doc).toContain('data-blocked-src="https://t.invalid/pixel.gif"');
  expect(doc).not.toMatch(/(?<![-\w])src="https:/);
  expect(container.querySelector('[data-hk-images-hidden]')).toBeTruthy();
  expect(container.querySelector('.hk-inbox__thread').innerHTML).not.toContain('steal()');
  fireEvent.click(container.querySelector('[data-hk-show-images]'));
  await waitFor(() => expect(container.querySelector('[data-hk-frame]').getAttribute('srcdoc')).toMatch(/(?<![-\w])src="https:\/\/t\.invalid\/pixel\.gif"/));
  expect(container.querySelector('[data-hk-images-hidden]')).toBeNull();
  const reply = container.querySelector('[data-hk-reply-gmail]');
  expect(reply.getAttribute('href')).toBe('https://mail.google.com/mail/?authuser=jack.work%40humankind.invalid#all/th-new');
  expect(reply.getAttribute('target')).toBe('_blank');
  expect(container.querySelector('[data-hk-copy-command]')).toBeNull();
  expect(container.querySelector('[data-hk-mark-handled]')).toBeNull();
  expect(screen.getByText('Deck.pdf · 47 KB')).toBeInTheDocument();
  const panel = container.querySelector('[data-hk-brand-panel="untracked"]');
  expect(panel.textContent).toMatch(/Not a brand yet/);
  expect(within(panel).getByRole('button', { name: 'Track as brand' })).toBeInTheDocument();
  expect(within(panel).getByRole('button', { name: 'Ignore this sender' })).toBeInTheDocument();
  expect(container.querySelector('[data-hk-messages] textarea')).toBeNull();
  expect(container.textContent).not.toMatch(/\bSend\b/);
  expect(container.querySelector('.hk-inbox__thread').textContent).not.toMatch(/@/);
});

test('Show images by default (localStorage) skips the strip; a tracked thread offers Copy Claude command and Mark handled', async () => {
  localStorage.setItem(IMAGES_KEY, '1');
  routes[`GET /api/hk/${HK}/inbox/threads/th-tracked`] = thread('th-tracked', { chip: { kind: 'tracked', brand_id: 'b-yoga', brand_name: 'Harbor Yoga', status: 'sent', label: 'interested' }, brand: { ...BRAND, id: 'b-yoga', name: 'Harbor Yoga', status: 'sent', owner_user_id: 'u-pete', touch_count: 2, last_reply_label: 'interested', verdict: { ok: false, reason: 'owned_by', warnings: [] } }, unhandled_reply_id: 'r1', sender: { name: 'Ana', domain: 'harboryoga.invalid' } });
  routes[`PATCH /api/hk/${HK}/replies/r1`] = { reply: { id: 'r1', handled: true }, changed: ['handled'] };
  const { container } = setup();
  fireEvent.click(await screen.findByText('Subject th-tracked'));
  await waitFor(() => expect(container.querySelector('[data-hk-frame]')).toBeTruthy());
  expect(container.querySelector('[data-hk-frame]').getAttribute('srcdoc')).toMatch(/(?<![-\w])src="https:\/\/t\.invalid\/pixel\.gif"/);
  expect(container.querySelector('[data-hk-images-hidden]')).toBeNull();
  fireEvent.click(container.querySelector('[data-hk-copy-command]'));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hk reply Harbor Yoga'));
  const panel = container.querySelector('[data-hk-brand-panel="tracked"]');
  expect(panel.textContent).toMatch(/Harbor Yoga/); expect(panel.textContent).toMatch(/Pete/); expect(panel.textContent).toMatch(/2 touches/); expect(panel.textContent).toMatch(/Blocked: owned by/);
  fireEvent.click(container.querySelector('[data-hk-mark-handled]'));
  await waitFor(() => expect(calls).toContain(`PATCH /api/hk/${HK}/replies/r1`));
  await waitFor(() => expect(calls).toContain(`GET /api/hk/${HK}/inbox/threads/th-tracked?refresh=1`));
});

test('Track as brand opens the Add brand modal prefilled with the sender and saves through inbox/track; Ignore posts the domain; a matching brand offers Link', async () => {
  routes[`GET /api/hk/${HK}/inbox/threads/th-new`] = thread('th-new', { sender: { name: 'Ana Ortiz', domain: 'newbrand.invalid' } });
  routes[`POST /api/hk/${HK}/brands/check`] = { results: [{ name: 'Ana Ortiz', domain: 'newbrand.invalid', verdict: 'clear', match: null, matches: [], legacy: [], warnings: [] }] };
  let trackBody = null;
  routes[`POST /api/hk/${HK}/inbox/track`] = body => { trackBody = body; return { brand: { id: 'b-new', name: body.name }, reply: { id: 'r9' } }; };
  routes[`POST /api/hk/${HK}/inbox/ignore`] = { domain: 'newbrand.invalid', ignored: true };
  const { container } = setup();
  fireEvent.click(await screen.findByText('Subject th-new'));
  fireEvent.click(await screen.findByRole('button', { name: 'Track as brand' }));
  let modal = container.querySelector('[data-hk-add-brand]');
  expect(modal.textContent).toMatch(/Track as brand/);
  expect(modal.querySelector('#hk-brand-name').value).toBe('Ana Ortiz');
  expect(modal.querySelector('#hk-brand-domain').value).toBe('newbrand.invalid');
  fireEvent.blur(modal.querySelector('#hk-brand-name'));
  fireEvent.click(within(modal).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(container.querySelector('[data-hk-add-brand]')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Track as brand' }));
  modal = container.querySelector('[data-hk-add-brand]');
  fireEvent.blur(modal.querySelector('#hk-brand-name'));
  await waitFor(() => expect(calls).toContain(`POST /api/hk/${HK}/brands/check`));
  fireEvent.click(await within(modal).findByRole('button', { name: 'Save' }));
  await waitFor(() => expect(trackBody).toBeTruthy());
  expect(trackBody.thread_id).toBe('th-new'); expect(trackBody.name).toBe('Ana Ortiz'); expect(trackBody.claim).toBe(false);
  expect(calls.filter(c => c === `POST /api/hk/${HK}/brands`)).toHaveLength(0);
  await screen.findByText('Tracking Ana Ortiz.');
  fireEvent.click(container.querySelector('[data-hk-ignore-sender]'));
  await waitFor(() => expect(calls).toContain(`POST /api/hk/${HK}/inbox/ignore`));
  routes[`GET /api/hk/${HK}/inbox/threads/th-match`] = thread('th-match', { chip: { kind: 'matches', brand_id: 'b-run', brand_name: 'Bluefin Run Club', status: 'candidate' }, brand: BRAND });
  routes[`POST /api/hk/${HK}/inbox/threads/th-match/link`] = { reply: { id: 'r2' }, brand_id: 'b-run' };
  fireEvent.click(screen.getByText('Subject th-match'));
  fireEvent.click(await screen.findByRole('button', { name: 'Link this thread to Bluefin Run Club' }));
  await waitFor(() => expect(calls).toContain(`POST /api/hk/${HK}/inbox/threads/th-match/link`));
  expect(container.querySelector('[data-hk-verdict="clear"]').textContent).toBe('Clear to draft');
});

test('states: no tether shows the Link your Gmail prompt (no list fetch repeats), reconnect banner, a Gmail error keeps the last list with Try again', async () => {
  routes[`GET /api/hk/${HK}/inbox/threads`] = { __status: 409, body: { error: 'Link a Google mailbox to this workspace for inbox first', needs_mailbox: 'inbox' } };
  const onOpenConnections = jest.fn();
  const r1 = render(<InboxScreen businessId={HK} shell={shell} gmail={{ mailbox: { linked: false } }} compact={false} canEdit onOpenBrand={jest.fn()} onOpenConnections={onOpenConnections} onUnread={jest.fn()} />);
  await screen.findByText('Link your HumanKind Gmail');
  fireEvent.click(screen.getByRole('button', { name: 'Open Connections' }));
  expect(onOpenConnections).toHaveBeenCalled();
  r1.unmount();
  routes[`GET /api/hk/${HK}/inbox/threads`] = { __status: 409, body: { error: 'Reconnect this Google account', needs_reconnect: 'g1' } };
  const r2 = render(<InboxScreen businessId={HK} shell={shell} gmail={gmail} compact={false} canEdit onOpenBrand={jest.fn()} onOpenConnections={jest.fn()} onUnread={jest.fn()} />);
  await waitFor(() => expect(r2.container.querySelector('[data-hk-inbox-state="reconnect"]')).toBeTruthy());
  r2.unmount();
  routes[`GET /api/hk/${HK}/inbox/threads`] = LIST;
  const { container } = render(<InboxScreen businessId={HK} shell={shell} gmail={gmail} compact={false} canEdit onOpenBrand={jest.fn()} onOpenConnections={jest.fn()} onUnread={jest.fn()} />);
  await screen.findByText('Subject th-tracked');
  routes[`GET /api/hk/${HK}/inbox/threads`] = { __status: 503, body: { error: 'Gmail: backend error' } };
  fireEvent.click(container.querySelector('[data-hk-inbox-refresh]'));
  const err = await waitFor(() => { const e = container.querySelector('[data-hk-inbox-error]'); if (!e) throw new Error('no banner'); return e; });
  expect(err.textContent).toMatch(/Showing the list from/); expect(err.textContent).toMatch(/Try again/);
  expect(screen.getByText('Subject th-tracked')).toBeInTheDocument();
});

test('phone: one pane at a time, the brand panel folds under the messages, Back returns to the list', async () => {
  routes[`GET /api/hk/${HK}/inbox/threads/th-new`] = thread('th-new', { sender: { name: 'Ana Ortiz', domain: 'newbrand.invalid' } });
  routes[`GET /api/hk/${HK}/inbox/threads`] = LIST;
  const { container } = render(<InboxScreen businessId={HK} shell={shell} gmail={gmail} compact canEdit onOpenBrand={jest.fn()} onOpenConnections={jest.fn()} onUnread={jest.fn()} />);
  await screen.findByText('Subject th-new');
  expect(container.querySelector('[data-hk-inbox-thread]')).toBeNull();
  fireEvent.click(screen.getByText('Subject th-new'));
  await waitFor(() => expect(container.querySelector('[data-hk-frame]')).toBeTruthy());
  expect(container.querySelector('[data-hk-inbox-list]')).toBeNull();
  const t = container.querySelector('[data-hk-inbox-thread]');
  expect(t.querySelector('[data-hk-brand-panel="untracked"]')).toBeTruthy();
  fireEvent.click(container.querySelector('[data-hk-inbox-back]'));
  expect(container.querySelector('[data-hk-inbox-list]')).toBeTruthy();
  expect(container.querySelector('[data-hk-inbox-thread]')).toBeNull();
});

test('Settings > Connections: Show images by default writes prospector_hk_inbox_images; Ignored senders list with Stop ignoring', async () => {
  routes[`GET /api/hk/${HK}/inbox/ignore`] = { domains: [{ domain: 'news.invalid', created_at: '2026-10-20T00:00:00Z' }] };
  routes[`DELETE /api/hk/${HK}/inbox/ignore/news.invalid`] = { domain: 'news.invalid', ignored: false };
  const { container } = render(<ConnectionsSettings businessId={HK} shell={shell} gmail={gmail} syncing={false} onSync={jest.fn()} onOpenConnections={jest.fn()} onGmailChanged={jest.fn()} />);
  const opts = await waitFor(() => { const o = container.querySelector('[data-hk-inbox-options]'); if (!o) throw new Error('no options'); return o; });
  await screen.findByText('news.invalid');
  const toggle = within(opts).getByRole('switch', { name: /Show images by default/ });
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(toggle);
  expect(localStorage.getItem(IMAGES_KEY)).toBe('1');
  await waitFor(() => expect(within(opts).getByRole('switch', { name: /Show images by default/ }).getAttribute('aria-checked')).toBe('true'));
  fireEvent.click(container.querySelector('[data-hk-unignore="news.invalid"]'));
  await waitFor(() => expect(calls).toContain(`DELETE /api/hk/${HK}/inbox/ignore/news.invalid`));
  expect(container.textContent).not.toMatch(/[–—]/);
});

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import TodayScreen, { todayBadge, ownerMatch, runLine } from './TodayScreen';
import FollowupSettings from './FollowupSettings';
import DigestSettings, { slackLine } from './DigestSettings';

// hkos-daily-check-v1 Stage 3 - Today's sections and actions against a recorded fetch, the owner toggle, the badge,
// the two settings sections. Invented brands; no address in any fixture; no Send control anywhere.
const HK = 'biz-hk';
const owner = { me: { user_id: 'u-jack', first_name: 'Jack', role: 'owner' }, members: [{ user_id: 'u-jack', first_name: 'Jack', palette_index: 1 }, { user_id: 'u-pete', first_name: 'Pete', palette_index: 2 }] };
let calls, routes, bodies;
const json = (status, body) => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });
beforeEach(() => {
  calls = []; routes = {}; bodies = {};
  global.fetch = jest.fn((url, init = {}) => {
    const method = init.method || 'GET'; const u = new URL(url, 'http://x'); const key = `${method} ${u.pathname}`; calls.push(key);
    if (init.body) bodies[key] = JSON.parse(init.body);
    const hit = routes[key]; return hit ? json(200, typeof hit === 'function' ? hit(init.body ? JSON.parse(init.body) : null) : hit) : json(404, { error: `no route ${key}` });
  });
  Object.assign(navigator, { clipboard: { writeText: jest.fn(() => Promise.resolve()) } });
});
const today = (over = {}) => ({
  run: { id: 'run-1', job: 'daily-check', trigger: 'pageload', chicago_day: '2026-10-27', started_at: '2026-10-27T12:35:00Z', finished_at: '2026-10-27T12:35:20Z', status: 'ok', counts: {}, error: null },
  ran_today: true, stats_stale: true, slack: { configured: false, env: 'HK_SLACK_WEBHOOK_URL' },
  mailboxes: [{ user_id: 'u-jack', first_name: 'Jack', state: 'ok' }, { user_id: 'u-pete', first_name: 'Pete', state: 'needs_reconnect' }],
  settings: { digest_time: '07:30', digest_days: 'weekdays', timezone: 'America/Chicago', quiet_weekends: true },
  digest: { day: '2026-10-27', sections: { urgent: [], replies: [], drafts: [], no_draft: [{ brand_id: 'b3', brand_name: 'Zz Granite Gym', owner: 'Pete', kind: 'bump', kind_text: 'bump', reason: 'reconnect', reason_text: 'reconnect Gmail to draft it', detail: null }], dm_ready: [] }, data_warnings: 2, stats_stale: true, done_yesterday: { sent: 3, replies_handled: 1, meetings: 0 }, counts: { urgent: 1, replies: 1, drafts: 1, no_draft: 1, dm_ready: 1, data_warnings: 2 }, empty: false },
  ...over,
});
const replies = [
  { id: 'r1', brand_id: 'b1', brand_name: 'Zz Northwind Juice', brand_owner_user_id: 'u-jack', handled: false, urgent: true, label: 'pricing', summary: 'Asked what a challenge costs', received_at: '2026-10-27T10:00:00Z', open_url: 'https://mail.google.com/mail/?authuser=x#all/m1', sender_user_id: 'u-jack', mine: true },
  { id: 'r2', brand_id: 'b2', brand_name: 'Zz Harbor Yoga', brand_owner_user_id: 'u-pete', handled: false, urgent: false, label: 'interested', summary: 'Wants to see the app', received_at: '2026-10-26T10:00:00Z', open_url: null, sender_user_id: 'u-pete', mine: false },
];
const drafts = [
  { id: 't1', brand_id: 'b2', brand_name: 'Zz Harbor Yoga', brand_owner_user_id: 'u-pete', channel: 'email', kind: 'bump', created_by: 'system', sender_user_id: 'u-pete', age_days: 4, mine: false, gmail_draft_url: null },
  { id: 't2', brand_id: 'b4', brand_name: 'Zz Cedar Coffee', brand_owner_user_id: 'u-jack', channel: 'ig_dm', kind: 'dm_text', created_by: 'system', sender_user_id: 'u-jack', age_days: 0, mine: true, gmail_draft_url: null },
];
const setup = (ownerValue = 'all', shell = owner) => {
  routes[`GET /api/hk/${HK}/jobs/today`] = today();
  routes[`GET /api/hk/${HK}/replies`] = { replies };
  routes[`GET /api/hk/${HK}/drafts`] = { drafts };
  const onGo = jest.fn(), onOpenBrand = jest.fn(), onCounts = jest.fn();
  const r = render(<TodayScreen businessId={HK} shell={shell} owner={ownerValue} compact={false} gmail={null} onOpenBrand={onOpenBrand} onGo={onGo} onOpenConnections={() => {}} onCounts={onCounts} />);
  return { ...r, onGo, onOpenBrand, onCounts };
};

test('pure: badge, owner match, run line', () => {
  expect(todayBadge({ urgent: 1, replies: 2, drafts: 3, no_draft: 4, dm_ready: 5, data_warnings: 9 })).toBe(15);
  expect(todayBadge(null)).toBe(0);
  expect(ownerMatch('u-pete', 'me', 'u-jack')).toBe(false); expect(ownerMatch('u-jack', 'me', 'u-jack')).toBe(true);
  expect(ownerMatch(null, 'me', 'u-jack')).toBe(true); expect(ownerMatch('u-pete', 'all', 'u-jack')).toBe(true); expect(ownerMatch('u-pete', 'u-pete', 'u-jack')).toBe(true);
  expect(runLine(null, false)).toBe('The daily check has not run yet.');
  expect(runLine({ started_at: '2026-10-27T12:35:00Z', finished_at: '2026-10-27T12:35:20Z', trigger: 'cron', status: 'partial' }, true)).toMatch(/^Daily check ran today at .*\(cron\), with some items\.$/);
  expect(runLine({ started_at: '2026-10-26T12:35:00Z', trigger: 'manual', status: 'ok' }, false)).toMatch(/^Last daily check Oct 26 \(manual\)\. Not run yet today\.$/);
  expect(slackLine({ configured: false, env: 'HK_SLACK_WEBHOOK_URL' })).toMatch(/not configured\. Set HK_SLACK_WEBHOOK_URL/);
  expect(slackLine({ configured: true })).toMatch(/configured\. The digest posts/);
});

test('Today (owner All): stats strip, reconnect banner, run line, sections A-F in order with the right rows, pricing strip, footer; no Send control; counts reported for the badge', async () => {
  const { container, onCounts, onGo } = setup('all');
  await screen.findByText('Urgent (1)');
  expect(container.querySelector('[data-hk-stats-strip]')).toBeInTheDocument();
  expect(screen.getByRole('alert', { name: '' }).textContent || container.querySelector('[data-hk-reconnect-banner]').textContent).toMatch(/Reconnect Gmail for Pete/);
  expect(container.querySelector('[data-hk-run-line]').textContent).toMatch(/^Daily check ran today at .*\(pageload\)\.$/);
  expect([...container.querySelectorAll('[data-hk-section]')].map(s => s.getAttribute('data-hk-section'))).toEqual(['urgent', 'replies', 'drafts', 'no_draft', 'dm_ready']);
  const urgent = container.querySelector('[data-hk-section="urgent"]');
  expect(within(urgent).getByText('Zz Northwind Juice')).toBeInTheDocument();
  expect(container.querySelector('[data-hk-pricing-strip]').textContent).toBe('Do not quote pricing in the reply.');
  expect(within(urgent).getByRole('link', { name: 'Open in Gmail' })).toHaveAttribute('href', 'https://mail.google.com/mail/?authuser=x#all/m1');
  const waiting = container.querySelector('[data-hk-section="replies"]');
  expect(within(waiting).getByText('Zz Harbor Yoga')).toBeInTheDocument();
  expect(within(waiting).getByRole('combobox', { name: 'Set status for Zz Harbor Yoga' })).toBeInTheDocument();
  const draftsSec = container.querySelector('[data-hk-section="drafts"]');
  expect(within(draftsSec).getByText('Written by the daily check')).toBeInTheDocument();
  expect(within(draftsSec).getByText('4 d, aging')).toBeInTheDocument();
  expect(within(draftsSec).getByRole('button', { name: 'Open in Gmail' })).toBeDisabled();
  const nd = container.querySelector('[data-hk-section="no_draft"]');
  expect(within(nd).getByText(/Reconnect Gmail to draft it/)).toBeInTheDocument();
  expect(container.querySelector('[data-hk-section="dm_ready"]')).toBeInTheDocument();
  expect(container.querySelector('[data-hk-today-foot]').textContent).toBe('2 data warnings · Done yesterday: 3 sent · 1 replies handled · 0 meetings');
  fireEvent.click(screen.getByRole('button', { name: '2 data warnings' }));
  expect(onGo).toHaveBeenCalledWith('review');
  expect(onCounts).toHaveBeenCalledWith(today().digest.counts);
  expect(container.textContent).not.toMatch(/\bSend\b/);
  expect(container.textContent).not.toMatch(/@/);
  expect(screen.getByRole('button', { name: 'Run daily check now' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sync Gmail now' })).toBeInTheDocument();
});

test('owner toggle Me: only the caller\'s brands (and unowned) show; a member sees no run buttons', async () => {
  const { container } = setup('me', { ...owner, me: { ...owner.me, role: 'member' } });
  await screen.findByText('Urgent (1)');
  expect([...container.querySelectorAll('[data-hk-section]')].map(s => s.getAttribute('data-hk-section'))).toEqual(['urgent', 'dm_ready']);
  expect(screen.queryByRole('button', { name: 'Run daily check now' })).toBeNull();
});

test('actions call the right routes: Mark handled, Retry draft, Skip this touch, Mark DM sent, Run daily check (and an already-ran note)', async () => {
  routes[`PATCH /api/hk/${HK}/replies/r1`] = { reply: {}, changed: ['handled'] };
  routes[`POST /api/hk/${HK}/jobs/retry-draft`] = { drafted: false, reason: 'reconnect', kind: 'bump' };
  routes[`POST /api/hk/${HK}/jobs/skip-touch`] = { ok: true };
  routes[`POST /api/hk/${HK}/drafts/t2/dm-sent`] = { ok: true };
  routes[`POST /api/hk/${HK}/jobs/daily-check`] = { skipped: 'already ran today', run: { started_at: '2026-10-27T12:35:00Z' } };
  const { container } = setup('all');
  await screen.findByText('Urgent (1)');
  fireEvent.click(container.querySelector('[data-hk-mark-handled]'));
  await waitFor(() => expect(calls).toContain(`PATCH /api/hk/${HK}/replies/r1`));
  expect(bodies[`PATCH /api/hk/${HK}/replies/r1`]).toEqual({ handled: true });
  const idle = sel => waitFor(() => expect(container.querySelector(sel)).not.toBeDisabled());
  await idle('[data-hk-retry-draft]');
  fireEvent.click(container.querySelector('[data-hk-retry-draft]'));
  await screen.findByText(/Still no draft for Zz Granite Gym: Reconnect Gmail to draft it/);
  expect(bodies[`POST /api/hk/${HK}/jobs/retry-draft`]).toEqual({ brand_id: 'b3' });
  await idle('[data-hk-skip-touch]');
  fireEvent.click(container.querySelector('[data-hk-skip-touch]'));
  await waitFor(() => expect(bodies[`POST /api/hk/${HK}/jobs/skip-touch`]).toEqual({ brand_id: 'b3' }));
  await idle('[data-hk-dm-sent]');
  fireEvent.click(container.querySelector('[data-hk-dm-sent]'));
  await waitFor(() => expect(calls).toContain(`POST /api/hk/${HK}/drafts/t2/dm-sent`));
  await idle('[data-hk-run-daily]');
  fireEvent.click(screen.getByRole('button', { name: 'Run daily check now' }));
  await screen.findByText(/Already ran today/);
  expect(calls.filter(c => /send$/i.test(c))).toHaveLength(0);
});

test('empty morning: the empty state with Find new brands copying the batch command', async () => {
  routes[`GET /api/hk/${HK}/jobs/today`] = today({ stats_stale: false, mailboxes: [{ user_id: 'u-jack', first_name: 'Jack', state: 'ok' }], digest: { ...today().digest, sections: { urgent: [], replies: [], drafts: [], no_draft: [], dm_ready: [] }, data_warnings: 0, counts: { urgent: 0, replies: 0, drafts: 0, no_draft: 0, dm_ready: 0, data_warnings: 0 }, empty: true } });
  routes[`GET /api/hk/${HK}/replies`] = { replies: [] };
  routes[`GET /api/hk/${HK}/drafts`] = { drafts: [] };
  const { container } = render(<TodayScreen businessId={HK} shell={owner} owner="all" compact={false} gmail={null} onOpenBrand={() => {}} onGo={() => {}} onOpenConnections={() => {}} />);
  await screen.findByText('Nothing needs you right now.');
  expect(container.querySelector('[data-hk-stats-strip]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Find new brands' }));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hk batch 15'));
});

test('Settings > Follow-up timing: loads the days, locks the cap, saves quiet weekends off; Digest: time + days saved, Slack line names the env, Send test digest renders the payload', async () => {
  routes[`GET /api/hk/${HK}/settings`] = { settings: { bump_after_days: 5, dm_after_days: 9, final_after_days: 14, max_email_touches: 3, quiet_weekends: true, digest_time: '07:30', digest_days: 'weekdays', timezone: 'America/Chicago' } };
  routes[`PATCH /api/hk/${HK}/settings`] = b => ({ settings: b });
  routes[`GET /api/hk/${HK}/jobs/today`] = today();
  routes[`POST /api/hk/${HK}/jobs/test-digest`] = { digest: { ...today().digest, test: true }, slack: 'skipped', slack_configured: false };
  const f = render(<FollowupSettings businessId={HK} shell={owner} canEdit />);
  await screen.findByLabelText('Bump after (days)');
  expect(screen.getByLabelText('Final after (days)')).toHaveValue(14);
  expect(f.container.querySelector('[data-hk-max-touches]').textContent).toMatch(/At most 3 email touches/);
  fireEvent.click(screen.getByRole('switch'));
  fireEvent.click(screen.getByRole('button', { name: 'Save follow-up timing' }));
  await waitFor(() => expect(bodies[`PATCH /api/hk/${HK}/settings`]).toEqual({ bump_after_days: 5, dm_after_days: 9, final_after_days: 14, quiet_weekends: false }));
  f.unmount();
  const d = render(<DigestSettings businessId={HK} shell={owner} canEdit />);
  await screen.findByLabelText('Time');
  expect(d.container.querySelector('[data-hk-slack-line]').textContent).toMatch(/not configured\. Set HK_SLACK_WEBHOOK_URL/);
  fireEvent.change(screen.getByLabelText('Days'), { target: { value: 'daily' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save digest settings' }));
  await waitFor(() => expect(bodies[`PATCH /api/hk/${HK}/settings`]).toEqual({ digest_time: '07:30', digest_days: 'daily' }));
  fireEvent.click(screen.getByRole('button', { name: 'Send test digest' }));
  const box = await screen.findByText(/Test digest for 2026-10-27/);
  expect(box.parentElement.textContent).toMatch(/Slack not configured, shown here/);
  expect(box.parentElement.textContent).toMatch(/Follow-ups with no draft \(1\)/);
});

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import TodayScreen, { checkLine, dayLine, igUrl, wantLine } from './TodayScreen';
import FollowupSettings from './FollowupSettings';
import DigestSettings from './DigestSettings';
import DaySettings from './DaySettings';

// grow-today-workflow-v1 Stage 2 - Your day against a recorded fetch: header line, progress, steps in order with their
// left / minutes / why, the collapse line, each one-click action with its Undo, Pitch all with the sheet question,
// Want more only with counts, Coming up, a Viewer sees no action. Invented brands; no address in any fixture.
const HK = 'biz-hk';
const owner = { me: { user_id: 'u-jack', first_name: 'Jack', role: 'owner' }, members: [{ user_id: 'u-jack', first_name: 'Jack', palette_index: 1, signed_up: true }, { user_id: 'u-pete', first_name: 'Pete', palette_index: 2, signed_up: true }] };
const viewer = { ...owner, me: { ...owner.me, role: 'viewer' } };
let calls, routes, bodies;
const json = (status, body) => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });
beforeEach(() => {
  calls = []; routes = {}; bodies = {};
  global.fetch = jest.fn((url, init = {}) => {
    const method = init.method || 'GET'; const u = new URL(url, 'http://x'); const key = `${method} ${u.pathname}`; calls.push(key);
    const b = init.body ? JSON.parse(init.body) : null;
    if (b) (bodies[key] = bodies[key] || []).push(b);
    const hit = routes[key]; if (!hit) return json(404, { error: `no route ${key}` });
    const out = typeof hit === 'function' ? hit(b) : hit;
    return out && out.__status ? json(out.__status, out.body) : json(200, out);
  });
  Object.assign(navigator, { clipboard: { writeText: jest.fn(() => Promise.resolve()) } });
});
const card = (id, name) => ({ id, name, command: `hk pitch ${name.toLowerCase().replace(/ /g, '')}.invalid`, primary: { kind: 'pitch' }, score: 60, score_parts: [{ key: 'local', words: 'chicago local', points: 20 }], research: null, contact: { title: 'Marketing lead', source: 'Apollo' }, labels: [] });
const pitch = (id, name, over = {}) => ({ kind: 'pitch', brand_id: id, brand_name: name, heat_band: 'cold', targeted: true, fit: 'strong', industry: 'Outdoor apparel', market: 'Chicago', contact_role: 'Marketing lead', idea: 'Trail-to-Taproom', command: card(id, name).command, owner_hint: null, card: card(id, name), ...over });
const day = (over = {}) => ({
  day: '2026-11-02', me: 'u-jack', first_name: 'Jack', total: 7, done: 2, left: 5, minutes_left: 11, badge: 5,
  progress: { sent_today: 2, pitched: 0, pitch_goal: 5, replies_answered: 0, replies_total: 2 },
  daily_check: { at: '2026-11-02T14:08:00Z', status: 'ok', today: true },
  steps: [
    { key: 'replies', n: 1, title: 'Answer replies', why: 'Someone wrote back - a person is waiting on you.', minutes_each: 3, left: 2, minutes: 6, collapsed: false, done: { n: 0, line: null }, items: [
      { kind: 'reply', reply_id: 'r1', brand_id: 'b1', brand_name: 'Zz Dark Matter', heat_band: 'hot', label: 'interested', urgent: true, summary: 'Who should we send our logo to?', age_days: 0, gmail_thread_id: 'th1', referral_name: null, command: 'hk reply darkmatter.invalid' },
      { kind: 'reply', reply_id: 'r2', brand_id: 'b2', brand_name: 'Zz Heritage Bikes', heat_band: 'cold', label: 'referral', urgent: false, summary: 'Looping in Sam Lee, our events manager', age_days: 1, gmail_thread_id: null, referral_name: 'Sam Lee', command: 'hk reply heritage.invalid' }] },
    { key: 'followups', n: 3, title: 'Send follow-ups that are due', why: 'Already written.', minutes_each: 1, left: 0, minutes: 0, collapsed: true, done: { n: 2, line: '2 sent · detected in Gmail 9:41 am' }, items: [] },
    { key: 'dms', n: 4, title: 'Send Instagram DMs that are due', why: 'The text is written.', minutes_each: 2, left: 1, minutes: 2, collapsed: false, done: { n: 0, line: null }, items: [
      { kind: 'dm', touch_id: 't9', brand_id: 'b9', brand_name: 'Zz Wildflower', heat_band: 'cold', text: 'Hi! We sent a note to your team about a HumanKind challenge.', instagram_handle: null, age_days: 0 }] },
    { key: 'pitches', n: 5, title: "Send today's pitches", why: 'New outreach.', minutes_each: 2, left: 2, minutes: 4, collapsed: false, done: { n: 0, line: null }, goal: 5, ready: 2, more_in_briefing: 3,
      items: [pitch('b5', 'Zz Allover'), pitch('b6', 'Zz BestSelf', { fit: 'possible', targeted: false })], pitch_all: { brand_ids: ['b5', 'b6'], command: 'hk pitch a, b' } },
  ],
  all_done: false, want_more: [], coming_up: [{ kind: 'followup_due', brand_id: 'b7', brand_name: 'Zz Logan Yoga', date: '2026-11-04' }, { kind: 'deal_month', brand_id: 'b8', brand_name: 'Zz Body High', deal_stage: 'confirmed', date: '2027-01-01' }], money: null,
  ...over,
});
const jobs = { run: null, stats_stale: false, mailboxes: [{ user_id: 'u-jack', first_name: 'Jack', state: 'ok' }], digest: { data_warnings: 0 } };
const gmail = { mailbox: { linked: true, state: 'ok', email: 'jack@humankind.invalid' } };
const greeting = { title: 'Good afternoon, Jack', date: 'Monday, November 2' };
const setup = (d = day(), shell = owner, canEdit = true) => {
  routes[`GET /api/hk/${HK}/today/day`] = d;
  routes[`GET /api/hk/${HK}/jobs/today`] = jobs;
  routes[`GET /api/hk/${HK}/signals`] = { prospects: [], sponsors: [], unseen_hot_warm: 0 };
  const onGo = jest.fn(), onFilterBrands = jest.fn(), onOpenBrand = jest.fn(), onOpenReply = jest.fn(), onCounts = jest.fn();
  const r = render(<TodayScreen businessId={HK} shell={shell} compact={false} gmail={gmail} canEdit={canEdit} greeting={greeting} syncing={false} onSync={jest.fn()} onOpenBrand={onOpenBrand} onOpenReply={onOpenReply} onGo={onGo} onFilterBrands={onFilterBrands} onOpenConnections={() => {}} onCounts={onCounts} />);
  return { ...r, onGo, onFilterBrands, onOpenBrand, onOpenReply, onCounts };
};
const step = key => document.querySelector(`[data-hk-step="${key}"]`);

test('pure: check line, day line, Instagram link, want-more words', () => {
  expect(checkLine(null)).toBe('daily check has not run yet');
  expect(checkLine({ at: '2026-11-02T14:08:00Z', today: true })).toMatch(/^daily check ran 8:08 am$/);
  expect(checkLine({ at: '2026-10-30T14:08:00Z', today: false })).toBe('daily check last ran Oct 30');
  expect(dayLine(day())).toBe('your day has 7 things, about 14 minutes');
  expect(igUrl('@wild.flower', 'Wild')).toBe('https://ig.me/m/wild.flower');
  expect(igUrl(null, 'Wild Flower')).toBe('https://www.instagram.com/explore/search/keyword/?q=Wild%20Flower');
  expect(wantLine({ key: 'research', n: 7, usd: 0.38 })).toBe('Research 7 brands (≈ $0.38)');
  expect(wantLine({ key: 'needs_email', n: 1 })).toBe('1 brand needs an email');
  expect(wantLine({ key: 'sheet_emails', n: 4, hint: 'Pete' })).toBe("4 brands on Pete's sheet list have emails. Take one");
});

test('Your day: header line + whose day, progress, steps in order with left / minutes / why, collapsed follow-ups reopen, badge reported, Coming up; one Today load = today/day + jobs/today, no Gmail call', async () => {
  const { container, onCounts, onOpenReply } = setup();
  await screen.findByText('Zz Dark Matter');
  expect(onCounts).toHaveBeenCalledWith(5);
  expect(container.querySelector('[data-hk-day-line]').textContent).toBe('Monday, November 2 · your day has 7 things, about 14 minutes · daily check ran 8:08 am');
  expect(container.textContent).toMatch(/Showing your day · Pete's is separate/);
  expect(container.querySelector('[data-hk-progress]').textContent).toMatch(/2 of 7 done.*about 11 minutes left.*Sent today 2.*Pitched 0\/5.*Replies answered 0\/2/);
  const order = [...container.querySelectorAll('[data-hk-step], [data-hk-step-done]')].map(e => e.getAttribute('data-hk-step') || `done:${e.getAttribute('data-hk-step-done')}`);
  expect(order).toEqual(['replies', 'done:followups', 'dms', 'pitches']);
  expect(step('replies').textContent).toMatch(/Answer replies 2 left · about 6 min/);
  expect(step('pitches').textContent).toMatch(/Your goal is 5 a day\. 2 are ready now; Briefing has 3 more\./);
  const folded = container.querySelector('[data-hk-step-done="followups"]');
  expect(folded.textContent).toMatch(/Send follow-ups that are due2 sent · detected in Gmail 9:41 am/);
  fireEvent.click(folded);
  expect(step('followups').textContent).toMatch(/Done today: 2 sent/);
  const own = within(step('replies')).getAllByText('Open reply')[0].closest('a');
  expect(own.getAttribute('href')).toBe('https://mail.google.com/mail/?authuser=jack%40humankind.invalid#all/th1');
  fireEvent.click(within(container.querySelector('[data-hk-day-item="reply:r2"]')).getByText('Open reply'));
  expect(onOpenReply).toHaveBeenCalledWith('r2');
  expect(container.querySelector('[data-hk-add-referral]').textContent).toBe(' Add Sam as contact');
  expect(container.querySelector('[data-hk-open-dm]').getAttribute('href')).toMatch(/instagram\.com\/explore\/search/);
  expect(container.querySelector('[data-hk-coming-up]').textContent).toMatch(/Nov 4Follow-up due · Zz Logan Yoga.*Jan 1Zz Body High · Confirmed month/);
  expect(calls.filter(c => c.startsWith('GET'))).toEqual(expect.arrayContaining([`GET /api/hk/${HK}/today/day`, `GET /api/hk/${HK}/jobs/today`]));
  expect(calls.some(c => /gmail|\/sync/.test(c))).toBe(false);
  expect(screen.queryByRole('button', { name: /^Send$/ })).toBeNull();
});

test('one-click actions each Undo: Mark handled, Not today, Mark sent, Skip this touch', async () => {
  routes[`PATCH /api/hk/${HK}/replies/r1`] = { reply: {}, changed: ['handled'] };
  routes[`POST /api/hk/${HK}/today/not-today`] = b => ({ day: '2026-11-02', brand_ids: b.on ? [b.brand_id] : [] });
  routes[`POST /api/hk/${HK}/drafts/t9/dm-sent`] = b => (b.undo ? { ok: true, undone: true } : { ok: true, touch_id: 't9', prev_last_touch_at: '2026-10-20T00:00:00Z' });
  routes[`POST /api/hk/${HK}/jobs/skip-touch`] = b => (b.undo ? { ok: true, undone: true } : { ok: true, brand_id: 'b3', was_due: '2026-11-02T12:00:00Z' });
  const d = day();
  d.steps[1] = { ...d.steps[1], left: 1, collapsed: false, items: [{ kind: 'draft', brand_id: 'b4', brand_name: 'Zz Quarry Club', touch_id: 't4', touch_kind: 'final', subject: 'Last one', gmail_draft_id: 'g4', gmail_message_id: 'm4', age_days: 1 }, { kind: 'draft_it', brand_id: 'b3', brand_name: 'Zz Granite Gym', touch_kind: 'bump', reason: 'no_contact' }] };
  const { container } = setup(d);
  await screen.findByText('Zz Dark Matter');
  const undo = async () => { fireEvent.click(await screen.findByRole('button', { name: 'Undo' })); await waitFor(() => expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()); await waitFor(() => expect(container.querySelector('[data-hk-not-today]')).not.toBeDisabled()); };
  fireEvent.click(container.querySelector('[data-hk-day-item="reply:r1"] [data-hk-mark-handled]'));
  await undo();
  expect(bodies[`PATCH /api/hk/${HK}/replies/r1`]).toEqual([{ handled: true }, { handled: false }]);
  fireEvent.click(screen.getByRole('button', { name: 'Not today: Zz Allover' }));
  expect(await screen.findByText("Zz Allover is off today's list. It's back tomorrow.")).toBeInTheDocument();
  await undo();
  expect(bodies[`POST /api/hk/${HK}/today/not-today`]).toEqual([{ brand_id: 'b5', on: true }, { brand_id: 'b5', on: false }]);
  fireEvent.click(container.querySelector('[data-hk-dm-sent]'));
  await undo();
  expect(bodies[`POST /api/hk/${HK}/drafts/t9/dm-sent`]).toEqual([{}, { undo: true, prev_last_touch_at: '2026-10-20T00:00:00Z' }]);
  fireEvent.click(container.querySelector('[data-hk-skip-touch]'));
  await undo();
  expect(bodies[`POST /api/hk/${HK}/jobs/skip-touch`]).toEqual([{ brand_id: 'b3' }, { brand_id: 'b3', undo: true, was_due: '2026-11-02T12:00:00Z' }]);
  fireEvent.click(container.querySelector('[data-hk-skip-draft]'));
  expect(await screen.findByText('Zz Quarry Club: follow-up skipped. The draft stays in your Gmail.')).toBeInTheDocument();
  await undo();
  expect(bodies[`POST /api/hk/${HK}/jobs/skip-touch`].slice(2)).toEqual([{ brand_id: 'b4' }, { brand_id: 'b4', undo: true, was_due: '2026-11-02T12:00:00Z' }]);
  expect(calls.some(c => c.startsWith('DELETE'))).toBe(false);
});

test('Pitch claims + copies with Undo; Pitch both asks the sheet question once, copies one command, Undo sends every item back', async () => {
  routes[`POST /api/hk/${HK}/brands/b5/pitch`] = b => (b.undo ? { undone: true, brand: { id: 'b5' } } : { claimed: true, command: 'hk pitch zzallover.invalid', words: 'Claimed. Copied hk pitch zzallover.invalid. Paste into Claude.', brand: { id: 'b5', updated_at: '2026-11-02T15:00:00Z' } });
  routes[`POST /api/hk/${HK}/today/pitch-all`] = b => (b.undo ? { done: [], refused: [], undone: true, command: null }
    : b.confirm_sheet_owner ? { done: [{ brand_id: 'b6', claimed: true, updated_at: 'u6', command: 'hk pitch zzbestself.invalid' }], refused: [], command: 'hk pitch zzbestself.invalid' }
      : { done: [{ brand_id: 'b5', claimed: true, updated_at: 'u5', command: 'hk pitch zzallover.invalid' }], refused: [{ brand_id: 'b6', error: "The sheet lists this as Pete's", needs_confirm: true, sheet_owner: 'Pete' }], command: 'hk pitch zzallover.invalid' });
  const { container } = setup();
  await screen.findByText('Zz Dark Matter');
  fireEvent.click(within(container.querySelector('[data-hk-day-item="pitch:b5"]')).getByRole('button', { name: /Pitch/ }));
  await screen.findByText('Claimed. Copied hk pitch zzallover.invalid. Paste into Claude.');
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(bodies[`POST /api/hk/${HK}/brands/b5/pitch`]).toEqual([{}, { undo: true, expect_updated_at: '2026-11-02T15:00:00Z' }]));
  fireEvent.click(container.querySelector('[data-hk-pitch-all]'));
  expect(container.querySelector('[data-hk-pitch-all]').textContent).toBe(' Pitch both');
  expect(await screen.findByText(/The sheet lists one of these as Pete's\. Take it anyway\?/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Take it' }));
  await screen.findByText(/Pitched 2\. Copied hk pitch zzallover\.invalid, zzbestself\.invalid\. Paste into Claude\./);
  expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('hk pitch zzallover.invalid, zzbestself.invalid');
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(bodies[`POST /api/hk/${HK}/today/pitch-all`].at(-1)).toEqual({ undo: true, items: [{ brand_id: 'b5', claimed: true, expect_updated_at: 'u5' }, { brand_id: 'b6', claimed: true, expect_updated_at: 'u6' }] }));
  fireEvent.click(container.querySelector('[data-hk-pitch-expand]'));
  expect(container.querySelector('[data-hk-expand="b5"]')).not.toBeNull();
});

test('never blank: all done shows what got done + Want more lines with counts (each one click away); nothing at all still offers Find new brands', async () => {
  const done = day({ total: 3, done: 3, left: 0, minutes_left: 0, badge: 0, all_done: true, coming_up: [],
    steps: [{ key: 'followups', n: 3, title: 'Send follow-ups that are due', why: '', minutes_each: 1, left: 0, minutes: 0, collapsed: true, done: { n: 3, line: '3 sent' }, items: [] }],
    want_more: [{ key: 'research', n: 7, usd: 0.38, to: 'briefing:research' }, { key: 'sheet_emails', hint: 'Pete', n: 4, to: 'brands:sheet' }] });
  const { container, onGo, onFilterBrands, onCounts, unmount } = setup(done);
  expect(await screen.findByText("You're done for today")).toBeInTheDocument();
  expect(onCounts).toHaveBeenCalledWith(0);
  expect(container.querySelector('[data-hk-all-done]').textContent).toMatch(/Send follow-ups that are due: 3 sent/);
  fireEvent.click(screen.getByText('Research 7 brands (≈ $0.38)'));
  expect(onGo).toHaveBeenLastCalledWith('inbox');
  fireEvent.click(screen.getByText("4 brands on Pete's sheet list have emails. Take one"));
  expect(onFilterBrands).toHaveBeenCalledWith('sheet:Pete');
  expect(onGo).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[data-hk-want="needs_email"]')).toBeNull();
  expect(container.querySelector('[data-hk-coming-up]')).toBeNull();
  unmount();
  setup(day({ total: 0, done: 0, left: 0, badge: 0, all_done: true, steps: [], want_more: [], coming_up: [] }));
  expect(await screen.findByText('Nothing is waiting on you right now')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Find new brands'));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hk batch 15'));
});

test('Viewer: the day reads, no Mark handled / Pitch / Not today / Mark sent / Pitch all, nothing written', async () => {
  const { container } = setup(day(), viewer, false);
  await screen.findByText('Zz Dark Matter');
  for (const sel of ['[data-hk-mark-handled]', '[data-hk-pitch]', '[data-hk-not-today]', '[data-hk-dm-sent]', '[data-hk-pitch-all]', '[data-hk-skip-touch]', '[data-hk-add-referral]']) expect(container.querySelector(sel)).toBeNull();
  expect(calls.filter(c => !c.startsWith('GET'))).toEqual([]);
});

test('Settings > Pitch > Your day: pitches per day saves into intel; Run daily check now lives here (owner role)', async () => {
  routes[`GET /api/hk/${HK}/settings`] = { settings: { intel: { pitch_goal: 5 } } };
  routes[`PATCH /api/hk/${HK}/settings`] = b => ({ settings: b });
  routes[`GET /api/hk/${HK}/jobs/today`] = { run: { started_at: '2026-11-02T12:30:00Z', finished_at: '2026-11-02T12:31:00Z', trigger: 'cron', status: 'ok' } };
  routes[`POST /api/hk/${HK}/jobs/daily-check`] = { skipped: true, run: { started_at: '2026-11-02T12:30:00Z' } };
  const { container, unmount } = render(<DaySettings businessId={HK} shell={owner} canEdit />);
  const input = await screen.findByLabelText('Pitches per day');
  expect(container.querySelector('[data-hk-daily-line]').textContent).toMatch(/Daily check last ran .*\(cron\)\./);
  fireEvent.change(input, { target: { value: '7' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(bodies[`PATCH /api/hk/${HK}/settings`]).toEqual([{ intel: { pitch_goal: 7 } }]));
  fireEvent.click(screen.getByRole('button', { name: 'Run daily check now' }));
  expect(await screen.findByText(/Already ran today/)).toBeInTheDocument();
  unmount();
  render(<DaySettings businessId={HK} shell={{ ...owner, me: { ...owner.me, role: 'member' } }} canEdit />);
  expect(await screen.findByLabelText('Pitches per day')).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Run daily check now' })).toBeNull();
});

test('Settings > Follow-up timing: loads the days, locks the cap, saves quiet weekends off; Digest: time + days saved, Slack line names the env, Send test digest renders the payload', async () => {
  routes[`GET /api/hk/${HK}/settings`] = { settings: { bump_after_days: 5, dm_after_days: 9, final_after_days: 14, max_email_touches: 3, quiet_weekends: true, digest_time: '07:30', digest_days: 'weekdays', timezone: 'America/Chicago' } };
  routes[`PATCH /api/hk/${HK}/settings`] = b => ({ settings: b });
  const digest = { day: '2026-10-27', sections: { urgent: [], replies: [], drafts: [], no_draft: [{ brand_id: 'b3', brand_name: 'Zz Granite Gym', owner: 'Pete', kind: 'bump', kind_text: 'bump', reason: 'reconnect', reason_text: 'reconnect Gmail to draft it', detail: null }], dm_ready: [] }, data_warnings: 2, stats_stale: true, done_yesterday: { sent: 3, replies_handled: 1, meetings: 0 }, counts: { urgent: 1, replies: 1, drafts: 1, no_draft: 1, dm_ready: 1, data_warnings: 2 }, empty: false };
  routes[`GET /api/hk/${HK}/jobs/today`] = { slack: { configured: false, env: 'HK_SLACK_WEBHOOK_URL' }, digest };
  routes[`POST /api/hk/${HK}/jobs/test-digest`] = { digest: { ...digest, test: true }, slack: 'skipped', slack_configured: false };
  const f = render(<FollowupSettings businessId={HK} shell={owner} canEdit />);
  await screen.findByLabelText('Bump after (days)');
  expect(screen.getByLabelText('Final after (days)')).toHaveValue(14);
  expect(f.container.querySelector('[data-hk-max-touches]').textContent).toMatch(/At most 3 email touches/);
  fireEvent.click(screen.getByRole('switch'));
  fireEvent.click(screen.getByRole('button', { name: 'Save follow-up timing' }));
  await waitFor(() => expect(bodies[`PATCH /api/hk/${HK}/settings`]).toEqual([{ bump_after_days: 5, dm_after_days: 9, final_after_days: 14, quiet_weekends: false }]));
  f.unmount();
  const d = render(<DigestSettings businessId={HK} shell={owner} canEdit />);
  await screen.findByLabelText('Time');
  expect(d.container.querySelector('[data-hk-slack-line]').textContent).toMatch(/not configured\. Set HK_SLACK_WEBHOOK_URL/);
  fireEvent.change(screen.getByLabelText('Days'), { target: { value: 'daily' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save digest settings' }));
  await waitFor(() => expect(bodies[`PATCH /api/hk/${HK}/settings`].at(-1)).toEqual({ digest_time: '07:30', digest_days: 'daily' }));
  fireEvent.click(screen.getByRole('button', { name: 'Send test digest' }));
  const box = await screen.findByText(/Test digest for 2026-10-27/);
  expect(box.parentElement.textContent).toMatch(/Slack not configured, shown here/);
  expect(box.parentElement.textContent).toMatch(/Follow-ups with no draft \(1\)/);
});

// node --test api/hk/jobs/runner.test.mjs
// hkos-daily-check-v1 Stage 2 - the runners on the in-memory Supabase, a fake Gmail (recorded calls) and a fixed clock:
// the once-per-day guard, drafts on each owner's own grant through the shared builder, lint failure / reconnect / no
// contact / no mailbox as items, owner_hint-only skipped and counted, quiet weekends, DM texts, Slack skipped or posted,
// the page-load fallback's two guards, gmail-sync-all over every tethered founder, and the cron registration. Invented
// names; the contact addresses live on hk_contacts rows only and must never reach a run row, a digest or Slack.
// 0 network, 0 Claude, 0 Gmail.
import test from 'node:test';
import assert from 'node:assert/strict';
process.env.GOOGLE_TOKEN_KEY ||= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const { fakeSupabase } = await import('../../sales/testing/fakeSupabase.mjs');
const { NeedsGoogle } = await import('../../lib/googleGrants.js');
const { gmailSyncAll, dailyCheck, pageloadJob, todayPayload, testDigest, retryDraft, skipTouch, markDmSent, DRAFTS_PER_RUN } = await import('./runner.js');
const { registerHkCron, SYNC_EXPR } = await import('./cron.js');

const HK = 'biz-hk', JACK = 'u-jack', PETE = 'u-pete';
const NOW = new Date('2026-10-27T15:00:00Z'); // Tuesday 10:00 Chicago, past the 07:30 digest time
const SAT = new Date('2026-10-31T15:00:00Z');
const EARLY = new Date('2026-10-27T12:00:00Z'); // 07:00 Chicago
const daysAgo = (n, from = NOW) => new Date(from.getTime() - n * 86400e3).toISOString();
const decode = raw => Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const hasAt = v => JSON.stringify(v).includes('@');
const brand = (id, name, over = {}) => ({ id, business_id: HK, name, normalized_name: name.toLowerCase(), aliases: [], segment: 'sponsor_brand', status: 'sent', relationship: 'prospect', owner_user_id: JACK, owner_hint: null, owner_unclear: false, source: 'import', domain: `${id}.invalid`, next_due_at: daysAgo(1), created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', archived_at: null, ...over });
const cold = (brandId, sender, sentDaysAgo, over = {}) => ({ id: `cold-${brandId}`, business_id: HK, brand_id: brandId, sender_user_id: sender, channel: 'email', kind: 'cold', state: 'sent', subject: `HumanKind x Zz ${brandId} - idea`, body_text: 'x', challenge_concept: 'a step streak', gmail_thread_id: `th-${brandId}`, gmail_message_id: `m-${brandId}`, gmail_draft_id: `d-${brandId}`, drafted_at: daysAgo(sentDaysAgo + 1), sent_at: daysAgo(sentDaysAgo), created_by: 'user', created_at: daysAgo(sentDaysAgo + 1), ...over });
const contact = (brandId, email = `ana@${brandId}.invalid`) => ({ id: `c-${brandId}`, business_id: HK, brand_id: brandId, name: 'Ana Example', email, is_primary: true, created_at: '2026-10-02T00:00:00Z' });

let sb, calls, tokens, flagged, mail, posts, now;
const fakeGmail = () => {
  const rec = (name, ret) => async (...a) => { calls.push([name, a[0], ...a.slice(1)]); return typeof ret === 'function' ? ret(...a) : ret; };
  return {
    createDraft: rec('createDraft', (t, { threadId }) => ({ id: `draft-${calls.length}`, message: { id: `dmsg-${calls.length}`, threadId: threadId || 'th-new' } })),
    deleteDraft: rec('deleteDraft', null), listDrafts: rec('listDrafts', []),
    getMessage: rec('getMessage', (t, id) => ({ id, threadId: 'th-1', labelIds: ['SENT'], payload: { headers: [{ name: 'Message-ID', value: `<${id}@mail.invalid>` }, { name: 'Date', value: 'Mon, 26 Oct 2026 10:00:00 -0500' }] } })),
    getThread: rec('getThread', { messages: [] }), listHistory: rec('listHistory', { history: [], historyId: '900' }),
    getProfile: rec('getProfile', { historyId: '1000', emailAddress: 'x' }), searchMessages: rec('searchMessages', { messages: [] }),
  };
};
const fresh = (seed = {}, { petePending = false } = {}) => {
  calls = []; tokens = []; flagged = []; posts = []; now = NOW;
  sb = fakeSupabase({
    business_members: [{ user_id: JACK, business_id: HK, name: 'Jack Carlson', role: 'owner', created_at: '2026-09-01T00:00:00Z' }, petePending ? { user_id: null, business_id: HK, name: 'Pete Invited', role: 'member', created_at: '2026-09-02T00:00:00Z' } : { user_id: PETE, business_id: HK, name: 'Pete Example', role: 'member', created_at: '2026-09-02T00:00:00Z' }],
    hk_brands: [], hk_contacts: [], hk_touches: [], hk_replies: [], hk_events: [], hk_sync_runs: [], hk_gmail_sync_state: [], hk_job_runs: [],
    hk_settings: [{ business_id: HK, members_stat: 1500, completions_stat: 6000, subject_format: 'HumanKind x [Brand] - [descriptor]', banned_phrases: ['synergies'], bump_after_days: 5, dm_after_days: 9, final_after_days: 14, max_email_touches: 3, digest_time: '07:30', digest_days: 'weekdays', timezone: 'America/Chicago', quiet_weekends: true, stats_confirmed_at: null }],
    hk_member_prefs: [{ business_id: HK, user_id: JACK, avatar_slot: 1, signature_text: 'Jack' }, { business_id: HK, user_id: PETE, avatar_slot: 2, signature_text: 'Pete' }],
    ...seed,
  }, { now: () => now.getTime(), unique: { hk_job_runs: r => (r.job === 'daily-check' && r.status !== 'error' ? `${r.business_id}:${r.chicago_day}` : null), hk_replies: r => `${r.business_id}:${r.gmail_message_id}` } });
  mail = { [JACK]: { grant: { id: 'g-jack', google_email: 'jack.work@humankind.invalid', features: ['gmail'], error: null }, tether: { purposes: ['drafts', 'inbox'] }, state: 'ok' }, [PETE]: { grant: { id: 'g-pete', google_email: 'pete.work@humankind.invalid', features: ['gmail'], error: null }, tether: { purposes: ['drafts', 'inbox'] }, state: 'ok' } };
};
const deps = (over = {}) => ({ supabase: sb, gmail: fakeGmail(), now: () => now, mailbox: async (b, u) => mail[u] || null, tokenForGrant: async grant => { tokens.push(grant.id); if (grant.error) throw new NeedsGoogle('gmail', grant); return `tok-${grant.id}`; }, flag: async id => { flagged.push(id); }, call: async () => ({ content: [] }), fetch: async (url, init) => { posts.push({ url, body: JSON.parse(init.body) }); return { ok: true }; }, slackUrl: null, ...over });
const due = () => ({ hk_brands: [brand('a', 'Zz Northwind Juice'), brand('b', 'Zz Harbor Yoga', { owner_user_id: PETE })], hk_contacts: [contact('a'), contact('b')], hk_touches: [cold('a', JACK, 6), cold('b', PETE, 7)] });
const noSend = () => assert.ok(!calls.some(c => /send/i.test(c[0])), 'no send call ever');

test('daily-check drafts the due bumps on each OWNER\'s own grant through the shared builder: Re: subject, in-thread, created_by system, one run row ok with counts; Slack skipped when unset; no address anywhere', async () => {
  fresh(due());
  const out = await dailyCheck({ businessId: HK, trigger: 'manual', startedBy: JACK, d: deps() });
  assert.equal(out.skipped, null);
  assert.deepEqual(tokens.sort(), ['g-jack', 'g-pete']);
  const drafts = calls.filter(c => c[0] === 'createDraft');
  assert.deepEqual(drafts.map(c => [c[1], c[2].threadId]).sort(), [['tok-g-jack', 'th-a'], ['tok-g-pete', 'th-b']], 'each draft on the owner\'s token, in the cold thread');
  const mimeA = decode(drafts.find(c => c[1] === 'tok-g-jack')[2].raw);
  assert.match(mimeA, /^To: ana@a\.invalid\r\nSubject: Re: HumanKind x Zz a - idea\r\nIn-Reply-To: <m-a@mail\.invalid>/);
  assert.match(mimeA, /Bumping this up in case it got buried/); assert.match(mimeA, /15[ -]minute|15 minutes/);
  const made = sb.db.hk_touches.filter(t => t.state === 'drafted');
  assert.deepEqual(made.map(t => [t.kind, t.created_by, t.sender_user_id, t.lint_passed]).sort(), [['bump', 'system', JACK, true], ['bump', 'system', PETE, true]]);
  assert.ok(sb.db.hk_events.filter(e => e.action === 'draft_created').every(e => e.actor_kind === 'system'));
  assert.equal(sb.db.hk_job_runs.length, 1);
  const run = sb.db.hk_job_runs[0];
  assert.deepEqual([run.job, run.trigger, run.chicago_day, run.status, run.started_by], ['daily-check', 'manual', '2026-10-27', 'ok', JACK]);
  assert.ok(run.finished_at);
  assert.deepEqual([out.counts.due_bump, out.counts.drafted, out.counts.no_draft, out.counts.slack, out.counts.errors], [2, 2, 0, 'skipped', 0]);
  assert.equal(out.digest.sections.drafts.length, 2); assert.equal(out.digest.counts.drafts, 2);
  assert.ok(!hasAt(run) && !hasAt(out.counts) && !hasAt(out.digest), 'no address on the run row or in the response');
  assert.equal(posts.length, 0);
  noSend();
});

test('once per Chicago day: a second daily-check the same day is skipped by the DB guard; an errored day may retry', async () => {
  fresh(due());
  await dailyCheck({ businessId: HK, d: deps() });
  const again = await dailyCheck({ businessId: HK, d: deps() });
  assert.deepEqual(again, { skipped: 'already ran today' });
  assert.equal(sb.db.hk_job_runs.length, 1);
  sb.db.hk_job_runs[0].status = 'error';
  const retry = await dailyCheck({ businessId: HK, d: deps() });
  assert.equal(retry.skipped, null); assert.equal(sb.db.hk_job_runs.length, 2);
  assert.equal(retry.counts.drafted, 0, 'the first run\'s drafts are still waiting, so nothing is drafted twice');
  assert.equal(retry.counts.skipped.draft_exists, 2);
  noSend();
});

test('a lint failure is an item, not a draft; a flagged grant / a token failure is a reconnect item (and flags the grant); no contact and no mailbox are items; owner_hint-only is skipped and counted', async () => {
  fresh({ ...due(), hk_settings: [{ business_id: HK, members_stat: 1500, completions_stat: 6000, banned_phrases: ['bumping this up'], bump_after_days: 5, final_after_days: 14, max_email_touches: 3, timezone: 'America/Chicago', quiet_weekends: true }] });
  let out = await dailyCheck({ businessId: HK, d: deps() });
  assert.equal(calls.filter(c => c[0] === 'createDraft').length, 0);
  assert.deepEqual(out.digest.sections.no_draft.map(x => [x.brand_name, x.kind, x.reason]).sort(), [['Zz Harbor Yoga', 'bump', 'lint'], ['Zz Northwind Juice', 'bump', 'lint']]);
  assert.match(out.digest.sections.no_draft[0].detail, /banned list/);
  assert.equal(out.run.status, 'ok', 'a lint miss is not a run error');
  assert.equal(sb.db.hk_touches.filter(t => t.state === 'drafted').length, 0);

  fresh({ hk_brands: [brand('a', 'Zz A'), brand('b', 'Zz B', { owner_user_id: PETE }), brand('c', 'Zz C', { owner_user_id: null, owner_hint: 'pete' }), brand('d', 'Zz D'), brand('e', 'Zz E', { owner_user_id: 'u-nomail' })], hk_contacts: [contact('a'), contact('b'), contact('c'), contact('e')], hk_touches: [cold('a', JACK, 6), cold('b', PETE, 6), cold('c', JACK, 6), cold('d', JACK, 6), cold('e', 'u-nomail', 6)] });
  mail[PETE].state = 'needs_reconnect'; mail[PETE].grant.error = 'needs_reconnect';
  mail[JACK].grant.error = 'needs_reconnect'; // the token refresh fails for Jack -> flagged + item
  out = await dailyCheck({ businessId: HK, d: deps() });
  const items = Object.fromEntries(out.digest.sections.no_draft.map(x => [x.brand_name, x.reason]));
  assert.deepEqual(items, { 'Zz A': 'reconnect', 'Zz B': 'reconnect', 'Zz D': 'no_contact', 'Zz E': 'no_mailbox' });
  assert.deepEqual(flagged, ['g-jack']);
  assert.equal(out.counts.skipped.owner_missing, 1, 'Zz C waits for Pete to sign in');
  assert.equal(out.run.status, 'partial');
  assert.equal(calls.filter(c => c[0] === 'createDraft').length, 0);
  noSend();
});

test('quiet weekend: nothing due, no Gmail call, the run still writes its row and digest', async () => {
  fresh(due()); now = SAT;
  const out = await dailyCheck({ businessId: HK, d: deps() });
  assert.equal(out.counts.quiet, true); assert.equal(out.counts.drafted, 0); assert.equal(calls.length, 0);
  assert.equal(sb.db.hk_job_runs[0].chicago_day, '2026-10-31');
});

test('DM text: a cold sent dm_after_days ago with no reply gets an ig_dm touch to copy (no Gmail), listed under DM text ready', async () => {
  fresh({ hk_brands: [brand('a', 'Zz Northwind Juice', { next_due_at: null })], hk_contacts: [contact('a')], hk_touches: [cold('a', JACK, 10)] });
  const out = await dailyCheck({ businessId: HK, d: deps() });
  const dm = sb.db.hk_touches.find(t => t.channel === 'ig_dm');
  assert.deepEqual([dm.kind, dm.state, dm.sender_user_id, dm.created_by], ['dm_text', 'drafted', JACK, 'system']);
  assert.match(dm.body_text, /1,500\+ members and 6,000\+ verified challenge completions/);
  assert.equal(calls.filter(c => c[0] === 'createDraft').length, 0);
  assert.deepEqual(out.digest.sections.dm_ready.map(x => [x.brand_name, x.touch_id]), [['Zz Northwind Juice', dm.id]]);
  assert.equal(out.counts.dm_texts, 1);
});

test('Slack: posted with one JSON POST of Block Kit when the webhook is set; a non-2xx answer counts as error; nothing posted carries an address', async () => {
  fresh({ ...due(), hk_replies: [{ id: 'r1', business_id: HK, brand_id: 'a', handled: false, urgent: true, label: 'pricing', summary: 'Asked what it costs', received_at: daysAgo(0.1), from_email: 'ana@a.invalid', gmail_message_id: 'gm-1' }] });
  const out = await dailyCheck({ businessId: HK, d: deps({ slackUrl: 'https://hooks.slack.invalid/T/B/x' }) });
  assert.equal(out.counts.slack, 'posted');
  assert.equal(posts.length, 1); assert.equal(posts[0].url, 'https://hooks.slack.invalid/T/B/x');
  assert.ok(posts[0].body.blocks.some(b => b.type === 'header'));
  assert.match(posts[0].body.text, /Urgent: 1/);
  assert.ok(!hasAt(posts[0].body));
  fresh(due());
  const bad = await dailyCheck({ businessId: HK, d: deps({ slackUrl: 'https://hooks.slack.invalid/T/B/x', fetch: async () => ({ ok: false, status: 500 }) }) });
  assert.equal(bad.counts.slack, 'error'); assert.equal(bad.run.status, 'ok', 'a Slack miss never fails the run');
});

test('gmail-sync-all: one sync per tethered founder in state ok, a flagged one counted as reconnect; per-mailbox rows read cron for a cron tick (Stage 4 migration), the job row too', async () => {
  fresh(due());
  mail[PETE].state = 'needs_reconnect'; mail[PETE].grant.error = 'needs_reconnect';
  const out = await gmailSyncAll({ businessId: HK, trigger: 'cron', d: deps() });
  assert.deepEqual([out.counts.mailboxes, out.counts.synced, out.counts.reconnect, out.counts.errors], [2, 1, 1, 0]);
  assert.deepEqual(tokens, ['g-jack']);
  assert.deepEqual(sb.db.hk_sync_runs.map(r => [r.user_id, r.trigger, r.status]), [[JACK, 'cron', 'ok']]);
  assert.deepEqual([out.run.job, out.run.trigger, out.run.status], ['gmail-sync-all', 'cron', 'ok']);
  assert.ok(calls.some(c => c[0] === 'getProfile'));
  noSend();
});

test('page load: the caller\'s sync with the 60-min guard, then the daily-check only past digest time and only once a day', async () => {
  fresh(due()); now = EARLY;
  let out = await pageloadJob({ businessId: HK, userId: JACK, d: deps() });
  assert.equal(out.sync.ran, true, JSON.stringify(out)); assert.deepEqual(out.daily, { skipped: 'before digest time' });
  assert.equal(sb.db.hk_job_runs.length, 0);
  now = new Date(EARLY.getTime() + 10 * 60e3);
  out = await pageloadJob({ businessId: HK, userId: JACK, d: deps() });
  assert.equal(out.sync.skipped, 'synced under 60 min ago');
  now = NOW;
  out = await pageloadJob({ businessId: HK, userId: JACK, d: deps() });
  assert.equal(out.daily.ran, true); assert.equal(out.daily.counts.drafted, 2);
  assert.equal(sb.db.hk_job_runs[0].trigger, 'pageload');
  now = new Date(NOW.getTime() + 2 * 3600e3);
  out = await pageloadJob({ businessId: HK, userId: PETE, d: deps() });
  assert.deepEqual(out.daily, { skipped: 'already ran today' });
  assert.equal(out.sync.ran, true, 'Pete\'s own mailbox syncs on his page load');
  out = await pageloadJob({ businessId: HK, userId: 'u-nomail', d: deps() });
  assert.deepEqual(out.sync, { skipped: 'no mailbox' });
  now = SAT;
  out = await pageloadJob({ businessId: HK, userId: JACK, d: deps() });
  assert.deepEqual(out.daily, { skipped: 'not a digest day' });
  noSend();
});

test('Today\'s read: a fresh digest from the current rows plus today\'s no-draft items, the last run, mailbox states, Slack env name; the test digest is marked TEST', async () => {
  fresh(due());
  mail[PETE].state = 'needs_reconnect'; mail[PETE].grant.error = 'needs_reconnect';
  await dailyCheck({ businessId: HK, d: deps() });
  const t = await todayPayload({ businessId: HK, d: deps() });
  assert.equal(t.run.job, 'daily-check'); assert.equal(t.ran_today, true);
  assert.equal(t.digest.sections.drafts.length, 1, 'Jack\'s bump is waiting');
  assert.deepEqual(t.digest.sections.no_draft.map(x => [x.brand_name, x.reason]), [['Zz Harbor Yoga', 'reconnect']]);
  assert.deepEqual(t.mailboxes.map(m => [m.first_name, m.state]), [['Jack', 'ok'], ['Pete', 'needs_reconnect']]);
  assert.deepEqual(t.slack, { configured: false, env: 'HK_SLACK_WEBHOOK_URL' });
  assert.equal(t.stats_stale, true);
  assert.ok(!hasAt(t));
  const td = await testDigest({ businessId: HK, d: deps() });
  assert.equal(td.digest.test, true); assert.equal(td.slack, 'skipped');
});

test('cron registration: two schedules per hk_sales workspace, timezone + noOverlap, the digest expression from settings; a tick runs the job with trigger cron', async () => {
  const scheduled = [];
  const cron = { schedule: (expr, fn, opts) => scheduled.push({ expr, fn, opts }) };
  const ran = [];
  const jobs = { gmailSyncAll: async a => { ran.push(['sync', a]); return { run: { status: 'ok' }, counts: {} }; }, dailyCheck: async a => { ran.push(['daily', a]); return { skipped: 'already ran today' }; } };
  const out = registerHkCron(cron, [{ businessId: HK, settings: { digest_time: '06:45', digest_days: 'weekdays', timezone: 'America/Chicago' } }], { log: () => {}, jobs });
  assert.deepEqual(out, [{ businessId: HK, job: 'gmail-sync-all', expr: SYNC_EXPR, timezone: 'America/Chicago' }, { businessId: HK, job: 'daily-check', expr: '45 6 * * 1-5', timezone: 'America/Chicago' }]);
  assert.ok(scheduled.every(s => s.opts.noOverlap === true && s.opts.timezone === 'America/Chicago'));
  await scheduled[0].fn(); await scheduled[1].fn();
  assert.deepEqual(ran, [['sync', { businessId: HK, trigger: 'cron' }], ['daily', { businessId: HK, trigger: 'cron' }]]);
  assert.equal(DRAFTS_PER_RUN, 25);
});

test('Today actions: Retry draft writes the one due draft on its owner\'s grant (quiet rule aside) or says why not; Skip this touch clears next_due_at + logs; Mark DM sent flips an ig_dm touch only', async () => {
  fresh({ hk_brands: [brand('a', 'Zz A'), brand('d', 'Zz D')], hk_contacts: [contact('a')], hk_touches: [cold('a', JACK, 6), cold('d', JACK, 6)] }); now = SAT;
  let r = await retryDraft({ businessId: HK, brandId: 'a', d: deps() });
  assert.equal(r.drafted, true); assert.equal(r.kind, 'bump'); assert.equal(calls.filter(c => c[0] === 'createDraft').length, 1);
  r = await retryDraft({ businessId: HK, brandId: 'a', d: deps() });
  assert.deepEqual([r.drafted, r.reason], [false, 'draft_exists']);
  r = await retryDraft({ businessId: HK, brandId: 'd', d: deps() });
  assert.deepEqual([r.drafted, r.reason], [false, 'no_contact']);
  await assert.rejects(retryDraft({ businessId: HK, brandId: 'nope', d: deps() }), /brand not found/);
  const sk = await skipTouch({ businessId: HK, brandId: 'd', userId: JACK, d: deps() });
  assert.equal(sk.ok, true); assert.equal(sb.db.hk_brands.find(b => b.id === 'd').next_due_at, null);
  assert.equal(sb.db.hk_events.at(-1).action, 'followup_skipped');
  const bump = sb.db.hk_touches.find(t => t.kind === 'bump');
  await assert.rejects(markDmSent({ businessId: HK, touchId: bump.id, userId: JACK, d: deps() }), /only an Instagram DM/);
  sb.db.hk_touches.push({ id: 'dm-1', business_id: HK, brand_id: 'a', sender_user_id: JACK, channel: 'ig_dm', kind: 'dm_text', state: 'drafted', body_text: 'x', created_by: 'system', created_at: daysAgo(0) });
  const ok = await markDmSent({ businessId: HK, touchId: 'dm-1', userId: JACK, d: deps() });
  assert.equal(ok.ok, true);
  const dm = sb.db.hk_touches.find(t => t.id === 'dm-1');
  assert.equal(dm.state, 'sent'); assert.ok(dm.sent_at);
  assert.equal(sb.db.hk_events.at(-1).action, 'touch_sent'); assert.equal(sb.db.hk_events.at(-1).detail.by_hand, true);
  await assert.rejects(markDmSent({ businessId: HK, touchId: 'dm-1', userId: JACK, d: deps() }), /that DM is sent/);
  noSend();
});

test('omitRecipientFor (the Stage 4 live check only): that brand\'s bump draft carries no To header, every other draft keeps its contact; the route never passes it', async () => {
  fresh(due());
  const out = await dailyCheck({ businessId: HK, d: deps(), omitRecipientFor: ['a'] });
  const drafts = calls.filter(c => c[0] === 'createDraft');
  assert.equal(drafts.length, 2);
  const mimeA = decode(drafts.find(c => c[1] === 'tok-g-jack')[2].raw), mimeB = decode(drafts.find(c => c[1] === 'tok-g-pete')[2].raw);
  assert.doesNotMatch(mimeA, /^To: /m, 'the omitted draft has no To');
  assert.match(mimeB, /^To: ana@b\.invalid$/m, 'the other draft keeps its contact');
  assert.equal(out.counts.drafted, 2);
  assert.equal(sb.db.hk_events.filter(e => e.action === 'draft_created').length, 2);
  const { dailyCheckRoute } = await import('../jobsRoutes.js');
  fresh(due());
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await dailyCheckRoute({ params: { businessId: HK }, body: { omitRecipientFor: ['a'], omit_recipient: true }, auth: { user: { id: JACK }, roles: new Map([[HK, 'owner']]) } }, res, deps());
  assert.equal(res.code, 200);
  for (const c of calls.filter(c => c[0] === 'createDraft')) assert.match(decode(c[2].raw), /^To: ana@[ab]\.invalid$/m, 'a route body cannot omit the recipient');
  noSend();
});

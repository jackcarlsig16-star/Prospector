// node --test api/hk/todayDay.test.mjs
// grow-today-workflow-v1 Stage 1 - Your day on the in-memory Supabase (invented brands, 0 network, 0 Claude, 0 Gmail):
// yours only (the owner toggle ignored), a draft without a Gmail draft never shows, done-today collapse lines, Want more
// only when the day is done and only lines with a count, badge = items left, Not today, Pitch all ready + Undo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const { seed, reqOf, call, hasAt, HK, JACK, PETE, ID, NOW } = await import('./testing.mjs');
const T = await import('./todayDay.js');
const { patchPrefsRoute } = await import('./opsRoutes.js');
const { pitchRoute } = await import('./brandActions.js');

const now = () => NOW; // 2026-10-26 3 pm in Chicago
const TODAY = '2026-10-26T18:00:00Z', YESTERDAY = '2026-10-25T18:00:00Z';
const members = [{ user_id: JACK, business_id: HK, name: 'Jack Example', role: 'owner', created_at: '2026-09-01T00:00:00Z' }, { user_id: PETE, business_id: HK, name: 'Pete Example', role: 'member', created_at: '2026-09-02T00:00:00Z' }];
const brand = (id, name, over = {}) => ({ id, business_id: HK, name, normalized_name: name.toLowerCase(), aliases: [], segment: 'sponsor_brand', is_local: false, status: 'candidate', relationship: 'prospect', owner_user_id: null, owner_unclear: false, source: 'import', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', archived_at: null, ...over });
const intel = domain => ({ id: `i-${domain}`, business_id: HK, domain, intel: { company: { what_they_do: 'Studio', industry: 'Fitness', hq_city: 'Chicago' }, fit: { sponsor_fit: 'strong', challenge_idea: 'Step month' } }, cost_usd: 0.05, researched_at: '2026-10-20T00:00:00Z' });
const contact = (brandId, over = {}) => ({ id: `c-${randomUUID()}`, business_id: HK, brand_id: brandId, name: 'Rae Example', title: 'Owner', email: `rae@${brandId.slice(0, 6)}.example`, email_source: 'site_published', is_primary: true, left_company: false, created_at: '2026-10-02T00:00:00Z', ...over });
const touch = over => ({ id: `t-${randomUUID()}`, business_id: HK, channel: 'email', kind: 'bump', state: 'drafted', created_by: 'system', created_at: '2026-10-20T00:00:00Z', drafted_at: '2026-10-25T00:00:00Z', ...over });

const P = Array.from({ length: 7 }, () => randomUUID());
let sb;
// 7 researched brands with an emailed contact (Pitch-ready for anyone), plus the testing seed (Pete's Harbor Yoga with
// an open reply on Pete's thread, Bluefin Run Club unresearched).
const fresh = (extra = {}) => {
  sb = seed({ business_members: members, business_anthropic_usage: [], hk_signals: [], hk_brand_threads: [], hk_job_runs: [], hk_domain_intel: [], ...extra });
  P.forEach((id, i) => { sb.db.hk_brands.push(brand(id, `Pitch Brand ${i}`, { domain: `pitch${i}.example` })); sb.db.hk_domain_intel.push(intel(`pitch${i}.example`)); sb.db.hk_contacts.push(contact(id)); });
};
const day = async (user = JACK, query = {}) => { const r = await call(T.dayRoute, reqOf({ user, query }), { supabase: sb, now }); assert.equal(r.code, 200, JSON.stringify(r.body)); return r.body; };
const stepOf = (d, key) => d.steps.find(s => s.key === key);
const post = (route, body, user = JACK) => call(route, reqOf({ method: 'POST', user, body }), { supabase: sb, now });

test('T1 yours only: replies by your brand or your thread, drafts / DMs by sender; ?owner=all changes nothing', async () => {
  fresh();
  const JB = randomUUID(); sb.db.hk_brands.push(brand(JB, 'Jack Bakery', { owner_user_id: JACK, status: 'claimed', domain: 'jackbakery.example' }));
  const jt = touch({ brand_id: ID.yoga, sender_user_id: JACK, kind: 'cold', state: 'sent', sent_at: '2026-10-05T00:00:00Z' });
  sb.db.hk_touches.push(jt);
  sb.db.hk_replies.push({ id: 'r-jack-thread', business_id: HK, brand_id: ID.yoga, touch_id: jt.id, label: 'pricing', handled: false, received_at: '2026-10-24T00:00:00Z', summary: 'Asked what it costs', created_at: '2026-10-24T00:00:00Z' },
    { id: 'r-jack-brand', business_id: HK, brand_id: JB, touch_id: null, label: 'referral', handled: false, received_at: '2026-10-25T00:00:00Z', summary: 'Referred us to Sam Lee, their marketing lead', created_at: '2026-10-25T00:00:00Z' });
  const jack = await day(JACK), all = await day(JACK, { owner: 'all' }), pete = await day(PETE);
  const ids = d => (stepOf(d, 'replies')?.items || []).map(i => i.reply_id).sort();
  assert.deepEqual(ids(jack), ['r-jack-brand', 'r-jack-thread']);
  assert.deepEqual(ids(all), ids(jack), 'the owner toggle never applies to Your day');
  assert.deepEqual(ids(pete), ['r-jack-thread', 'r1'], "Pete: both replies on his brand (his own thread and Jack's), not Jack Bakery's");
  const ref = stepOf(jack, 'replies').items.find(i => i.reply_id === 'r-jack-brand');
  assert.equal(ref.referral_name, 'Sam Lee');
  assert.equal(stepOf(jack, 'replies').items.find(i => i.reply_id === 'r-jack-thread').gmail_thread_id, null, 'no thread id stored on that reply - nothing to open');
  assert.equal(stepOf(jack, 'replies').items[0].reply_id, 'r-jack-thread', 'hottest first: pricing outranks a referral one day newer');
  assert.ok(!hasAt(jack) && !hasAt(pete), 'no address anywhere in the payload');
});

test('T2 step 3: only bump / final drafts with a real Gmail draft, sender = you; no-draft rows on your brands; step 4 DMs by sender', async () => {
  fresh();
  const JB = randomUUID(); sb.db.hk_brands.push(brand(JB, 'Jack Bakery', { owner_user_id: JACK, status: 'claimed', domain: 'jackbakery.example' }));
  sb.db.hk_touches.push(
    touch({ id: 't-real', brand_id: JB, sender_user_id: JACK, gmail_draft_id: 'r-123', subject: 'Re: hello' }),
    touch({ id: 't-none', brand_id: JB, sender_user_id: JACK, gmail_draft_id: null }),
    touch({ id: 't-imported', brand_id: JB, sender_user_id: JACK, state: 'imported', gmail_draft_id: null }),
    touch({ id: 't-cold', brand_id: JB, sender_user_id: JACK, kind: 'cold', gmail_draft_id: 'r-9' }),
    touch({ id: 't-pete', brand_id: ID.yoga, sender_user_id: PETE, gmail_draft_id: 'r-456' }),
    touch({ id: 't-dm', brand_id: JB, sender_user_id: JACK, channel: 'ig_dm', kind: 'dm_text', body_text: 'Hi Jack Bakery!' }),
    touch({ id: 't-dm-pete', brand_id: ID.yoga, sender_user_id: PETE, channel: 'ig_dm', kind: 'dm_text', body_text: 'Hi Harbor!' }));
  sb.db.hk_job_runs.push({ id: 'run1', business_id: HK, job: 'daily-check', chicago_day: '2026-10-26', status: 'ok', started_at: '2026-10-26T12:30:00Z', finished_at: '2026-10-26T12:31:00Z', digest: { sections: { no_draft: [{ brand_id: JB, kind: 'final', reason: 'no_contact' }, { brand_id: ID.yoga, kind: 'bump', reason: 'no_thread' }] } } });
  const d = await day(JACK);
  assert.deepEqual(stepOf(d, 'followups').items.map(i => i.touch_id || `draft_it:${i.touch_kind}`), ['t-real', 'draft_it:final']);
  assert.deepEqual(stepOf(d, 'dms').items.map(i => [i.touch_id, i.text, i.instagram_handle]), [['t-dm', 'Hi Jack Bakery!', null]]);
  assert.deepEqual([d.daily_check.today, d.daily_check.status], [true, 'ok']);
  const p = await day(PETE);
  assert.deepEqual(stepOf(p, 'followups').items.map(i => i.touch_id || `draft_it:${i.touch_kind}`), ['t-pete', 'draft_it:bump']);
  assert.deepEqual(stepOf(p, 'dms').items.map(i => i.touch_id), ['t-dm-pete']);
});

test('T2 step 1 also lists your linked threads waiting on us (not suggested-domain links, not one already a tracked reply)', async () => {
  fresh();
  const th = (id, over) => ({ id, business_id: HK, brand_id: ID.run, member_user_id: JACK, gmail_thread_id: `g-${id}`, matched_by: 'domain', link_state: 'linked', waiting_on: 'us', last_theirs_at: '2026-10-24T00:00:00Z', last_ours_at: '2026-10-20T00:00:00Z', deal_stage: 'scheduling', deal_month: '2026-12', summary: 'Asked for December', ...over });
  sb.db.hk_brand_threads.push(th('a', {}), th('b', { matched_by: 'suggested_domain' }), th('c', { member_user_id: PETE }), th('d', { waiting_on: 'them' }), th('e', { link_state: 'ignored' }));
  const d = await day(JACK);
  assert.deepEqual(stepOf(d, 'replies').items.map(i => [i.kind, i.thread_id, i.gmail_thread_id, i.age_days]), [['thread', 'a', 'g-a', 2]]);
  assert.deepEqual(d.coming_up.map(c => [c.kind, c.brand_name, c.date]), [['deal_month', 'Bluefin Run Club', '2026-12-01']], 'Coming up: one row per brand and month');
  assert.equal(d.badge, d.left);
});

test('T3 done today: a step with nothing left collapses to what happened; yesterday does not count', async () => {
  fresh();
  const JB = randomUUID(); sb.db.hk_brands.push(brand(JB, 'Jack Bakery', { owner_user_id: JACK, status: 'claimed' }));
  sb.db.hk_touches.push(touch({ brand_id: JB, sender_user_id: JACK, state: 'sent', sent_at: TODAY, gmail_draft_id: 'r-1' }), touch({ brand_id: JB, sender_user_id: JACK, state: 'sent', sent_at: YESTERDAY }),
    touch({ brand_id: JB, sender_user_id: JACK, channel: 'ig_dm', kind: 'dm_text', state: 'sent', sent_at: TODAY }));
  sb.db.hk_replies.push({ id: 'r-done', business_id: HK, brand_id: JB, touch_id: null, label: 'interested', handled: true, handled_at: TODAY, handled_by: JACK, received_at: '2026-10-24T00:00:00Z', created_at: '2026-10-24T00:00:00Z' });
  sb.db.hk_events.push({ id: randomUUID(), business_id: HK, actor_user_id: JACK, entity_id: P[0], action: 'brand.pitched', detail: {}, created_at: TODAY });
  const d = await day(JACK);
  const f = stepOf(d, 'followups'), r = stepOf(d, 'replies'), m = stepOf(d, 'dms'), p = stepOf(d, 'pitches');
  assert.deepEqual([f.left, f.collapsed, f.done.n], [0, true, 1]);
  assert.match(f.done.line, /^1 sent · detected in Gmail 1:00 pm$/);
  assert.deepEqual([r.collapsed, r.done.line, m.done.line], [true, '1 answered', '1 sent']);
  assert.deepEqual([p.done.n, p.left, p.items.some(i => i.brand_id === P[0])], [1, 4, false], 'pitched today: off the list, the goal room is 5 - 1');
  assert.deepEqual([d.progress.sent_today, d.progress.pitched, d.progress.replies_answered], [2, 1, 1]);
  assert.deepEqual([d.done, d.left, d.total, d.badge], [4, 4, 8, 4]);
});

test('T5 never blank: Want more only once the day is done, each line only with a count behind it; badge 0', async () => {
  fresh({ business_anthropic_usage: Array.from({ length: 3 }, (_, i) => ({ id: `u${i}`, business_id: HK, call_type: 'hk_research_sweep', cost_usd: 0.05, created_at: '2026-10-20T00:00:00Z', user_id: JACK })) });
  let d = await day(JACK);
  assert.ok(d.left > 0 && !d.want_more.length, 'work left: no Want more');
  // Every pitch-ready brand Not today -> nothing left; Bluefin Run Club (no research) is the one research line.
  for (const id of P) assert.equal((await post(T.notTodayRoute, { brand_id: id, on: true })).code, 200);
  d = await day(JACK);
  assert.deepEqual([d.all_done, d.badge, d.steps.length], [true, 0, 0]);
  assert.deepEqual(d.want_more.map(w => [w.key, w.n, w.usd ?? null]), [['research', 1, 0.05]]);
  // A researched brand without an email and a Pete-sheet brand with one bring their lines.
  const NE = randomUUID(), SH = randomUUID();
  sb.db.hk_brands.push(brand(NE, 'No Email Gym', { domain: 'noemail.example' }), brand(SH, 'Sable Socks', { owner_hint: 'pete', domain: 'sable.example' }));
  sb.db.hk_domain_intel.push(intel('noemail.example')); sb.db.hk_contacts.push(contact(SH));
  d = await day(JACK);
  assert.deepEqual(d.want_more.map(w => [w.key, w.n, w.hint || null]), [['research', 1, null], ['needs_email', 1, null], ['sheet_emails', 1, 'pete']]);
});

test('Not today: per member, per day; Undo; a rail save that echoes it keeps the stored list; tomorrow it is back', async () => {
  fresh();
  let r = await post(T.notTodayRoute, { brand_id: P[0], on: true });
  assert.deepEqual([r.code, r.body.day, r.body.brand_ids], [200, '2026-10-26', [P[0]]]);
  assert.ok(!stepOf(await day(JACK), 'pitches').items.some(i => i.brand_id === P[0]));
  assert.ok(stepOf(await day(PETE), 'pitches').items.some(i => i.brand_id === P[0]), "Jack's Not today is not Pete's");
  const save = await call(patchPrefsRoute, reqOf({ method: 'PATCH', body: { rail: { narrow: true, today_hidden: { day: '2026-10-26', brand_ids: [] } } } }), { supabase: sb, now });
  assert.equal(save.code, 200, JSON.stringify(save.body));
  assert.deepEqual([save.body.prefs.rail.narrow, save.body.prefs.rail.today_hidden.brand_ids], [true, [P[0]]], 'the stored list wins over an echoed one');
  const tomorrow = new Date(NOW.getTime() + 864e5);
  const t = await call(T.dayRoute, reqOf({}), { supabase: sb, now: () => tomorrow });
  assert.ok(stepOf(t.body, 'pitches').items.some(i => i.brand_id === P[0]), 'back the next day');
  r = await post(T.notTodayRoute, { brand_id: P[0], on: false });
  assert.deepEqual(r.body.brand_ids, []);
  assert.equal((await post(T.notTodayRoute, { brand_id: 'nope', on: true })).code, 404);
  assert.equal((await post(T.notTodayRoute, { brand_id: P[0] })).code, 400);
});

test('Pitch all ready: claims each, one "hk pitch a, b" command, ticks them off; Undo releases each; sheet owner asks first', async () => {
  fresh();
  const SH = randomUUID(); sb.db.hk_brands.push(brand(SH, 'Sable Socks', { owner_hint: 'pete', domain: 'sable.example' }));
  const d0 = await day(JACK);
  assert.deepEqual(stepOf(d0, 'pitches').pitch_all.brand_ids.length, 5, 'up to the daily goal');
  const r = await post(T.pitchAllRoute, { brand_ids: [P[0], P[1], SH] });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.done.map(x => [x.brand_id, x.claimed]), [[P[0], true], [P[1], true]]);
  assert.equal(r.body.command, 'hk pitch pitch0.example, pitch1.example');
  assert.deepEqual(r.body.refused.map(x => [x.brand_id, x.needs_confirm, x.sheet_owner]), [[SH, true, 'Pete']]);
  assert.ok(!hasAt(r.body));
  const d1 = await day(JACK);
  assert.deepEqual([stepOf(d1, 'pitches').done.n, stepOf(d1, 'pitches').items.some(i => i.brand_id === P[0])], [2, false]);
  const u = await post(T.pitchAllRoute, { undo: true, items: r.body.done.map(x => ({ brand_id: x.brand_id, claimed: x.claimed, expect_updated_at: x.updated_at })) });
  assert.equal(u.code, 200, JSON.stringify(u.body));
  assert.deepEqual([u.body.done.length, u.body.undone, sb.db.hk_brands.find(b => b.id === P[0]).owner_user_id], [2, true, null]);
  assert.equal(stepOf(await day(JACK), 'pitches').done.n, 0, 'Undo un-ticks them');
  assert.equal((await post(T.pitchAllRoute, { brand_ids: [] })).code, 400);
  assert.equal((await post(T.pitchAllRoute, { brand_ids: Array(11).fill(P[0]) })).code, 400);
});

test('Pitch on your own brand writes brand.pitched; its Undo ({ claimed: false }) writes brand.pitch_undone only', async () => {
  fresh();
  sb.db.hk_brands.find(b => b.id === P[2]).owner_user_id = JACK;
  const r = await call(pitchRoute, reqOf({ method: 'POST', params: { id: P[2] } }), { supabase: sb, now });
  assert.deepEqual([r.code, r.body.claimed], [200, false]);
  const u = await call(pitchRoute, reqOf({ method: 'POST', params: { id: P[2] }, body: { undo: true, claimed: false } }), { supabase: sb, now });
  assert.equal(u.code, 200, JSON.stringify(u.body));
  assert.deepEqual(sb.db.hk_events.filter(e => e.entity_id === P[2]).map(e => e.action), ['brand.pitched', 'brand.pitch_undone']);
  assert.equal(sb.db.hk_brands.find(b => b.id === P[2]).owner_user_id, JACK, 'nothing else changes');
  const pete = await call(pitchRoute, reqOf({ method: 'POST', user: PETE, params: { id: P[2] }, body: { undo: true, claimed: false } }), { supabase: sb, now });
  assert.equal(pete.code, 409, "Pete cannot undo Jack's Pitch");
});

test('referralName: a capitalised name after to / contact / ask for; none otherwise', () => {
  assert.equal(T.referralName('Referred us to Sam Lee, their marketing lead'), 'Sam Lee');
  assert.equal(T.referralName('Said to ask for Jo at the front desk'), 'Jo');
  assert.equal(T.referralName('Not the right person'), null);
  assert.equal(T.referralName(null), null);
});

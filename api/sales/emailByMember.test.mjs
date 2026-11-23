// node --test api/sales/emailByMember.test.mjs
// email-by-member-v1 Stage 1: the member dimension of the weekly registry (a row filter over the same functions - the
// member rows and the unassigned mailboxes add up to the team row), the mailbox map routes on sales_mailbox_owners
// (domain + first seen + count, never an address; the owner alone writes), and the Scout intent. Invented people and
// mailboxes; no address in any response.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { addDays } from './goalsShared.js';
import { hasPii } from './scrubText.js';
import { MEMBER_KEYS, UNASSIGNED, WORDING, memberRows } from './weeklyMetrics.js';
import { loadWeekly } from './weeklyRoutes.js';
import { buildWeeklyEmail, MEMBER_COLS } from './teamEmails/weeklyEmail.js';
import { GROUPS, METRICS } from './weeklyMetrics.js';
import { windowValues } from './pulseMath.js';
import { listMailboxes, saveMailbox, mailboxKey } from './mailboxMap.js';
import { parseAsk, mergeVocab } from '../scout/retrieve.js';
import { VOCABULARY } from './scoutEntities.js';
import { salesIntents } from './scoutIntents.js';

const B = '00000000-0000-4000-8000-0000000000b1';
const u = n => `${n}0000000-0000-4000-8000-000000000000`;
const AT = String.fromCharCode(64);
const NOW = Date.parse('2026-11-19T16:00:00Z'); // Thu Nov 19, 08:00 PST
const TODAY = '2026-11-19', MON = '2026-11-16', LAST = '2026-11-09';
const ANA1 = `ana${AT}one.test`, ANA2 = `ana${AT}two.test`, CY1 = `cy${AT}one.test`, CY2 = `cy${AT}two.test`;
const count = (mailbox, day, delivered, hard_bounced, spam_blocked, opened, replied = 0) => ({ business_id: B, day, mailbox, sequence_id: 's1', step: 1, delivered, hard_bounced, spam_blocked, opened, clicked: 0, replied });
const msg = (id, mailbox, day) => ({ business_id: B, apollo_message_id: id, contact_id: `c-${id}`, account_id: null, mailbox, delivered_at: `${day}T16:00:00Z`, delivered_day: day, sequence_id: 's1', step: 1 });
const act = (id, m, sender, event, at) => ({ id, business_id: B, apollo_message_id: m, sender, event, occurred_at: at, user_agent: 'Mozilla/5.0 (Macintosh)', tracking_service: null });
const DELIVERED = [msg('a1', ANA1, '2026-11-10'), msg('a2', ANA1, '2026-11-17'), msg('a3', ANA1, '2026-11-18'), msg('b1', ANA2, '2026-11-17'), msg('c1', CY1, '2026-11-11'), msg('c2', CY1, '2026-11-17')];
const seed = (extra = {}) => fakeSupabase({
  business_members: [
    { business_id: B, user_id: u('a'), role: 'owner', created_at: '2026-09-01T00:00:00Z' }, { business_id: B, user_id: u('c'), role: 'member', created_at: '2026-09-02T00:00:00Z' },
    { business_id: B, user_id: u('d'), role: 'member', created_at: '2026-09-03T00:00:00Z' }, { business_id: B, user_id: u('e'), role: 'viewer', created_at: '2026-09-04T00:00:00Z' },
  ],
  profiles: [{ id: u('a'), display_name: 'Ana Owner' }, { id: u('c'), display_name: 'Cy Member' }, { id: u('d'), display_name: 'Dee Member' }, { id: u('e'), display_name: 'Eve Viewer' }],
  sales_mailbox_owners: [{ business_id: B, mailbox_email: ANA1, user_id: u('a') }, { business_id: B, mailbox_email: CY1, user_id: u('c') }],
  microsoft_grants: [{ user_id: u('c'), account_email: CY2, connected_at: '2026-10-08T18:00:00Z', error: null }],
  sales_email_daily_counts: [
    count(ANA1, '2026-11-03', 60, 2, 1, 12), count(ANA1, '2026-11-10', 50, 1, 0, 10, 1), count(ANA1, '2026-11-11', 20, 0, 0, 4), count(ANA1, '2026-11-17', 40, 0, 1, 9), count(ANA1, '2026-11-18', 30, 1, 0, 6),
    count(CY1, '2026-11-03', 30, 3, 2, 2), count(CY1, '2026-11-11', 25, 2, 1, 1), count(CY1, '2026-11-17', 22, 1, 1, 2),
    count(ANA2, '2026-11-17', 5, 0, 0, 4),
  ],
  sales_email_delivered: DELIVERED,
  sales_email_messages: DELIVERED.map(d => ({ business_id: B, apollo_message_id: d.apollo_message_id, delivered_at: d.delivered_at, replied: ['a2', 'c1'].includes(d.apollo_message_id), reply_class: ['a2', 'c1'].includes(d.apollo_message_id) ? 'willing_to_meet' : null, replied_at: null, replied_seen_at: null })),
  sales_email_activity: [
    act(1, 'a1', ANA1, 'open', '2026-11-10T20:00:00Z'), act(2, 'a2', ANA1, 'open', '2026-11-17T20:00:00Z'), act(3, 'a2', ANA1, 'click', '2026-11-17T21:00:00Z'), act(4, 'a3', ANA1, 'open', '2026-11-18T16:00:01Z'),
    act(5, 'b1', ANA2, 'open', '2026-11-17T22:00:00Z'), act(6, 'b1', ANA2, 'click', '2026-11-17T23:00:00Z'), act(7, 'c1', CY1, 'click', '2026-11-11T21:00:00Z'), act(8, 'c2', CY1, 'open', '2026-11-17T20:00:00Z'), act(9, 'c1', CY1, 'open', '2026-11-11T20:00:00Z'),
  ],
  microsoft_events: [
    { id: 1, business_id: B, user_id: u('a'), graph_id: 'g1', ical_uid: 'i1', external_domains: ['acme.test'], start_at: '2026-11-20T18:00:00Z', is_cancelled: false, created_at_graph: '2026-11-17T18:00:00Z' },
    { id: 2, business_id: B, user_id: u('a'), graph_id: 'g2', ical_uid: 'i2', external_domains: ['beta.test'], start_at: '2026-11-24T18:00:00Z', is_cancelled: false, created_at_graph: '2026-11-10T18:00:00Z' },
    { id: 3, business_id: B, user_id: u('c'), graph_id: 'g3', ical_uid: 'i3', external_domains: ['beta.test'], start_at: '2026-11-25T18:00:00Z', is_cancelled: false, created_at_graph: '2026-11-18T18:00:00Z' },
  ],
  sales_prospect_state: [], partner_contacts: [], sales_opportunities: [], sales_targets: [], sales_goals: [], sales_sequenced_accounts: [], sales_people: [], web_visits: [], visit_pull_runs: [],
  sales_partner_events: [], sales_flow_events: [], sales_manual_metrics: [], sales_metric_targets: [], sales_daily_metrics: [],
  ...extra,
});
const weekly = (sb, member) => loadWeekly(sb, B, { weeks: 4, member, now: NOW });
const of = (metrics, key) => metrics.find(x => x.key === key);
const noAddress = (body, domains = false) => { const text = JSON.stringify(body); assert.ok(!text.includes(AT), 'an address shape in a response'); if (!domains) assert.ok(!text.includes('.test'), 'a mailbox domain in a weekly response'); };

test('M2: the member rows and the unassigned mailboxes add up to the team row, week by week, for every count', async () => {
  const { status, body } = await weekly(seed(), 'all');
  assert.equal(status, 200);
  assert.deepEqual(body.rows.map(r => r.name), ['Ana', 'Cy', UNASSIGNED.name, 'Team']);
  assert.deepEqual(body.members, [{ id: u('a'), name: 'Ana' }, { id: u('c'), name: 'Cy' }]);
  assert.equal(body.unassigned_mailboxes, 1);
  const team = body.rows[3], parts = body.rows.slice(0, 3);
  for (const key of ['delivered', 'human_clicks', 'replies', 'meetings_set']) {
    const t = of(team.metrics, key);
    t.series.forEach((cell, i) => assert.equal(parts.reduce((n, r) => n + (of(r.metrics, key).series[i].value || 0), 0), cell.value || 0, `${key} ${cell.week_start}`));
    assert.equal(parts.reduce((n, r) => n + (of(r.metrics, key).this_week.same_point_last_week || 0), 0), t.this_week.same_point_last_week || 0, `${key} same point`);
  }
  assert.equal(of(body.rows[0].metrics, 'delivered').this_week.to_date, 70);
  assert.equal(of(body.rows[1].metrics, 'delivered').this_week.to_date, 22);
  assert.equal(of(body.rows[2].metrics, 'delivered').this_week.to_date, 5);
  assert.equal(of(team.metrics, 'delivered').this_week.to_date, 97);
  assert.equal(of(body.rows[0].metrics, 'meetings_set').this_week.to_date, 1);
  assert.equal(of(body.rows[1].metrics, 'meetings_set').this_week.to_date, 1);
  assert.equal(of(body.rows[2].metrics, 'meetings_set').this_week.to_date, 0);
  for (const r of body.rows) assert.deepEqual(r.metrics.map(x => x.key), MEMBER_KEYS);
  noAddress(body);
});

test('M2: one member - the same functions over that member\'s rows; rates are never projected; goals stay the team\'s', async () => {
  const sb = seed();
  const all = (await weekly(sb, 'all')).body;
  const { status, body } = await weekly(sb, u('c'));
  assert.equal(status, 200);
  assert.deepEqual(body.member, { id: u('c'), name: 'Cy' });
  assert.deepEqual(body.metrics, all.rows[1].metrics);
  assert.deepEqual(body.metrics.map(x => x.key), MEMBER_KEYS);
  const counts = [count(CY1, '2026-11-17', 22, 1, 1, 2)], opens = [act(8, 'c2', CY1, 'open', '2026-11-17T20:00:00Z')];
  const w = windowValues({ from: MON, to: TODAY }, { counts, opens, deliveredAt: new Map(DELIVERED.map(d => [d.apollo_message_id, d.delivered_at])), events: [], visits: [], people: [], now: NOW });
  assert.equal(of(body.metrics, 'human_open_rate').this_week.to_date, w.human_open_rate);
  assert.ok(w.human_open_rate > 0);
  assert.equal(of(body.metrics, 'deliverability').this_week.to_date, 22 / 24);
  for (const x of body.metrics) {
    if (x.unit === 'rate') assert.equal(x.this_week.pace, null, x.key);
    assert.equal(x.this_week.goal, null, x.key);
  }
  assert.equal(of(body.metrics, 'delivered').this_week.pace, Math.round(22 / (4 / 7)));
  assert.equal(body.wording.member, WORDING.member);
  noAddress(body);
});

test('M2: an unmapped mailbox lands in Unassigned; a member with no mailbox reads empty, not zero; a stranger is refused', async () => {
  const sb = seed();
  const un = (await weekly(sb, UNASSIGNED.id)).body;
  assert.deepEqual(un.member, UNASSIGNED);
  assert.equal(of(un.metrics, 'delivered').this_week.to_date, 5);
  assert.equal(of(un.metrics, 'human_clicks').this_week.to_date, 1);
  const dee = (await weekly(sb, u('d'))).body;
  assert.equal(dee.member.name, 'Dee');
  assert.equal(of(dee.metrics, 'delivered').this_week.to_date, null);
  assert.equal(of(dee.metrics, 'human_open_rate').this_week.to_date, null);
  assert.equal((await weekly(sb, u('9'))).status, 400);
  assert.equal((await weekly(sb, 'somebody')).status, 400);
  const team = (await weekly(sb, undefined)).body;
  assert.deepEqual(team.member, { id: 'team', name: 'Team' });
  assert.ok(team.metrics.length > MEMBER_KEYS.length && team.groups.length === 4);
  for (const b of [un, dee, team]) noAddress(b);
  const narrowed = memberRows({ rows: { delivered: DELIVERED, events: [act(1, 'a1', null, 'open', '2026-11-10T20:00:00Z')], calEvents: [{ user_id: u('a') }] }, counts: [] }, m => m === CY1);
  assert.deepEqual([narrowed.rows.delivered.length, narrowed.rows.events.length, narrowed.rows.calEvents.length], [2, 0, 0]);
});

test('M1: the list is domain + first seen + delivered, keyed opaquely; only the owner maps; a connected account stays with its member', async () => {
  const sb = seed();
  const { status, body } = await listMailboxes(sb, B);
  assert.equal(status, 200);
  noAddress(body, true);
  assert.deepEqual(body.members.map(m => m.name), ['Ana', 'Cy', 'Dee']);
  assert.deepEqual(body.mailboxes.map(m => [m.domain, m.first_seen, m.delivered, m.user_id, m.suggested_user_id]), [
    ['one.test', '2026-11-03', 200, u('a'), null], ['one.test', '2026-11-03', 77, u('c'), null], ['two.test', '2026-11-17', 5, null, u('a')], ['two.test', '2026-10-08', 0, null, u('c')],
  ]);
  assert.deepEqual(Object.keys(body.mailboxes[0]).sort(), ['connected_account_of', 'delivered', 'domain', 'first_seen', 'key', 'suggested_user_id', 'user_id']);
  const [, , ana2, cy2] = body.mailboxes;
  assert.equal(ana2.key, mailboxKey(B, ANA2));
  const put = (isOwner, b) => saveMailbox(sb, { businessId: B, isOwner, body: b });
  assert.equal((await put(false, { key: ana2.key, user_id: u('a') })).status, 403);
  assert.equal((await sb.from('sales_mailbox_owners').select('*')).data.length, 2);
  assert.equal((await put(true, { key: ana2.key, user_id: u('a'), mailbox: 'x' })).status, 400);
  assert.equal((await put(true, { key: 'nope', user_id: u('a') })).status, 400);
  assert.equal((await put(true, { key: '0'.repeat(16), user_id: u('a') })).status, 404);
  assert.equal((await put(true, { key: ana2.key, user_id: u('e') })).status, 400);
  assert.equal((await put(true, { key: ana2.key, user_id: u('9') })).status, 400);
  assert.equal((await put(true, { key: cy2.key, user_id: u('a') })).status, 409);
  assert.equal((await put(true, { key: cy2.key, user_id: null })).status, 409);
  const ok = await put(true, { key: ana2.key, user_id: u('a') });
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.body.mailbox.domain, ok.body.mailbox.user_id], ['two.test', u('a')]);
  noAddress(ok.body, true);
  assert.equal((await put(true, { key: cy2.key, user_id: u('c') })).status, 200);
  assert.equal((await sb.from('sales_mailbox_owners').select('*')).data.length, 4);
  const after = (await weekly(sb, 'all')).body;
  assert.deepEqual(after.rows.map(r => r.name), ['Ana', 'Cy', 'Team']);
  assert.equal(after.unassigned_mailboxes, 0);
  assert.equal(of(after.rows[0].metrics, 'delivered').this_week.to_date, 75);
  assert.equal((await put(true, { key: ana2.key, user_id: u('c') })).status, 200);
  assert.equal(of((await weekly(sb, u('c'))).body.metrics, 'delivered').this_week.to_date, 27);
  assert.equal((await put(true, { key: ana2.key, user_id: null })).status, 200);
  assert.equal((await sb.from('sales_mailbox_owners').select('*')).data.length, 3);
  assert.equal((await weekly(sb, 'all')).body.unassigned_mailboxes, 1);
});

test('M6: the three asks route to the member intent alone; the lines carry the member, the numbers and the direction, no goal and no address', async () => {
  const vocab = mergeVocab([VOCABULARY, { members: [{ id: u('a'), name: 'Ana Owner' }, { id: u('c'), name: 'Cy Member' }] }]);
  const ids = q => salesIntents.filter(i => i.match(parseAsk(q, vocab, { today: TODAY }))).map(i => i.id);
  for (const q of ["how is Cy's open rate trending", 'who sent the most this week', 'my emails this week']) assert.deepEqual(ids(q), ['member_emails'], q);
  for (const q of ['how are we pacing this week', "what's our open rate trend", "did we hit last week's goals"]) assert.deepEqual(ids(q), ['weekly'], q);
  assert.deepEqual(ids('how are our emails doing this month'), ['emails']);
  assert.deepEqual(ids('show me my open tasks'), ['todos']);
  assert.ok(!ids("Cy's tasks").includes('member_emails') && !ids('who visited yesterday').includes('member_emails') && !ids('who opened our emails').includes('member_emails'));
  const sb = seed();
  const intent = salesIntents.find(i => i.id === 'member_emails');
  const run = (q, user = u('a')) => intent.run(sb, { businessId: B, ask: parseAsk(q, vocab, { today: TODAY }), now: NOW, auth: { user: { id: user } }, today: TODAY });
  const cy = await run("how is Cy's open rate trending");
  assert.equal(cy.read, 'goals/weekly?member=Cy · week of 2026-11-16 · day 4 of 7');
  assert.deepEqual(cy.items.map(x => x.id), [`${u('c')}:human_open_rate`, 'member:how']);
  assert.match(cy.items[0].text, /^Cy · Human open rate \(Outbound\) · this week to date \(Nov 16–22\): \d+\.\d % · same point last week: \d+\.\d % · /);
  // E-5: every week carries its dates, newest first; a week with no delivered email says so (never a bare, undated list)
  assert.match(cy.items[0].text, / · last week \(Nov 9–15\): \d+\.\d % · earlier weeks, newest first: Nov 2–8: no emails delivered, Oct 26–Nov 1: no emails delivered, /);
  assert.ok(!/oldest first/.test(cy.items[0].text));
  assert.ok(!/goal|on pace/.test(cy.items[0].text));
  const most = await run('who sent the most this week');
  assert.match(most.read, /^goals\/weekly\?member=all · week of 2026-11-16 · day 4 of 7 · 3 member rows \+ the team$/);
  const sent = most.items.filter(x => x.id.endsWith(':delivered'));
  assert.deepEqual(sent.map(x => x.title), ['Ana · Delivered', 'Cy · Delivered', `${UNASSIGNED.name} · Delivered`, 'Team · Delivered']);
  assert.match(sent[0].text, /^Ana · Delivered \(Outbound\) · this week to date \(Nov 16–22\): 70 · same point last week: 70 · flat against the same point last week · on pace for about 123 by Sunday · last week \(Nov 9–15\): 70 · /);
  const mine = await run('my emails this week', u('c'));
  assert.equal(mine.read, 'goals/weekly?member=Cy · week of 2026-11-16 · day 4 of 7');
  assert.equal(mine.items.length, MEMBER_KEYS.length + 1);
  const dee = await run('my emails this week', u('d'));
  assert.match(dee.items[0].text, /^Dee has no sending mailbox mapped/);
  assert.equal(mine.items[mine.items.length - 1].text, `${WORDING.member} ${WORDING.week} ${WORDING.pace}`);
  for (const it of [...cy.items, ...most.items, ...mine.items, ...dee.items]) { assert.ok(!hasPii(it.text), it.text); assert.ok(!it.text.includes(AT)); }
  assert.equal(addDays(MON, -7), LAST);
});

test("M5: member=all carries the team's whole read too, and the Friday email built from it gains one By member table under Outbound - last week vs the week before, names only", async () => {
  const all = (await weekly(seed(), 'all')).body, team = (await weekly(seed(), 'team')).body;
  assert.deepEqual(all.metrics, team.metrics);
  assert.deepEqual(all.groups, GROUPS);
  assert.equal(all.metrics.length, METRICS.length);
  const mail = buildWeeklyEmail(all), plain = buildWeeklyEmail(team);
  assert.equal(mail.member_rows, 4);
  assert.equal(mail.rows, plain.rows);
  assert.equal(plain.member_rows, 0);
  assert.ok(!plain.html.includes('By member') && !plain.text.includes('By member'));
  assert.equal(mail.html.split('By member').length, 2);
  assert.ok(mail.html.indexOf('By member') < mail.html.indexOf('>Site<') && mail.html.indexOf('By member') > mail.html.indexOf('>Outbound<'), 'the table sits under Outbound, above Site');
  for (const name of ['Ana', 'Cy', UNASSIGNED.name, 'Team']) assert.ok(mail.html.includes(`>${name}</div>`) && mail.text.includes(name), name);
  for (const [, label] of MEMBER_COLS) assert.ok(mail.html.includes(`>${label}</th>`), label);
  // Ana's last full week (Nov 9-15) and the week before, the row's own digits
  const ana = of(all.rows[0].metrics, 'delivered').series;
  assert.ok(mail.text.includes(`Ana`.padEnd(22) + ` ${`${ana[ana.length - 2].value ?? '—'} (${ana[ana.length - 3].value ?? '—'})`}`));
  const strip = t => t.replace(/https?:\/\/\S+/g, '');
  assert.ok(!strip(mail.html).includes(AT) && !mail.text.includes(AT) && !mail.html.includes('.test') && !mail.text.includes('.test'), 'no address or mailbox domain in the email');
});

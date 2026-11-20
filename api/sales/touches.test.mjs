// node --test api/sales/touches.test.mjs
// FIX touch-truth T1: the one touch reader over a fixture - a target with Apollo sends has touches, a company mailed
// before the delivered table existed and from Outlook has touches, opens / clicks / replies / visits are theirs and are
// never summed into ours, a partner's hook-written Apollo touch is not counted twice, a stage move written with a to-do
// is one touch, the batch form answers exactly what the single form answers, and nothing in the answer is an address.
// Invented people and companies.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { touchesFor, touchIndex, summarize, OUR_KINDS } from './touches.js';
import { lastTouchFor } from './companyPanel.js';

const B = '00000000-0000-4000-8000-0000000000b1';
const U1 = '00000000-0000-4000-8000-0000000000a1', U2 = '00000000-0000-4000-8000-0000000000a2';
const row = r => ({ business_id: B, ...r });
const seed = () => ({
  sales_opportunities: [
    row({ id: 'o1', organization: 'Harbor Hotels', apollo_account_id: 'acc-o1', domain: 'harborhotels.test' }),
    row({ id: 'o2', organization: 'Pine Outfitters', apollo_account_id: null, domain: 'pineoutfitters.test' }),
    row({ id: 'o3', organization: 'Quiet Co', apollo_account_id: null, domain: null }),
  ],
  sales_targets: [
    row({ id: 't1', name: 'Morton Events', apollo_account_id: 'acc-t1', employer_id: null, domain: 'mortonevents.test', source_note_id: null }),
    row({ id: 't2', name: 'Untouched Target', apollo_account_id: null, employer_id: null, domain: null, source_note_id: 'n2' }),
  ],
  sales_goals: [
    row({ id: 'g1', name: 'Lakeside Benefits', goal_type: 'partnership', last_touch_at: null }),
    row({ id: 'g2', name: 'Imported Partner', goal_type: 'partnership', last_touch_at: '2026-10-06T00:00:00Z' }),
  ],
  sales_prospect_state: [
    row({ contact_id: 'c-old', company: 'Pine Outfitters', opportunity_id: null, goal_id: null, status: 'new', updated_at: '2026-09-12T00:00:00Z' }),
    row({ contact_id: 'c-q', company: 'Quiet Co', opportunity_id: 'o3', goal_id: null, status: 'contacted', updated_at: '2026-11-12T18:00:03Z' }),
    row({ contact_id: 'c-g1', company: 'Lakeside Benefits', opportunity_id: null, goal_id: 'g1', status: 'new', updated_at: '2026-11-01T00:00:00Z' }),
  ],
  partner_contacts: [], sales_sequenced_accounts: [],
  sales_mailbox_owners: [row({ mailbox_email: 'sender-two@example.test', user_id: U2 })],
  sales_email_delivered: [
    row({ apollo_message_id: 'm1', contact_id: 'c1', account_id: 'acc-o1', mailbox: 'sender-two@example.test', delivered_at: '2026-11-05T16:00:00Z' }),
    row({ apollo_message_id: 'm2', contact_id: 'c2', account_id: 'acc-o1', mailbox: 'sender-two@example.test', delivered_at: '2026-11-09T16:00:00Z' }),
    row({ apollo_message_id: 'm3', contact_id: 'c3', account_id: 'acc-t1', mailbox: 'unmapped@example.test', delivered_at: '2026-11-10T16:00:00Z' }),
    row({ apollo_message_id: 'm4', contact_id: 'c-g1', account_id: null, mailbox: 'sender-two@example.test', delivered_at: '2026-11-11T16:00:00Z' }),
  ],
  sales_email_messages: [
    row({ apollo_message_id: 'm1', contact_id: 'c1', delivered_at: '2026-11-05T16:00:00Z', replied: true, replied_at: '2026-11-06T10:00:00Z', replied_seen_at: null }),
    row({ apollo_message_id: 'old1', contact_id: 'c-old', delivered_at: '2026-09-11T16:00:00Z', replied: false, replied_at: null, replied_seen_at: null }),
    row({ apollo_message_id: 'old2', contact_id: 'c-old', delivered_at: '2026-09-18T16:00:00Z', replied: false, replied_at: null, replied_seen_at: null }),
  ],
  sales_email_activity: [
    row({ id: 'e1', apollo_message_id: 'm2', contact_id: 'c2', event: 'open', occurred_at: '2026-11-09T19:00:00Z', user_agent: 'Mozilla', tracking_service: null }),
    row({ id: 'e2', apollo_message_id: 'm2', contact_id: 'c2', event: 'open', occurred_at: '2026-11-09T16:00:20Z', user_agent: 'Mozilla', tracking_service: null }), // 20 s after delivery: a scanner
    row({ id: 'e3', apollo_message_id: 'old2', contact_id: 'c-old', event: 'click', occurred_at: '2026-09-19T16:00:00Z', user_agent: 'Mozilla', tracking_service: null }),
  ],
  sales_week_goals: [
    row({ id: 'w1', kind: 'todo', status: 'done', link_type: 'employer', link_id: 'o3', completed_at: '2026-11-12T18:00:00Z', owner_user_id: U1, source_note_id: null }),
    row({ id: 'w2', kind: 'todo', status: 'open', link_type: 'employer', link_id: 'o1', completed_at: null, owner_user_id: U1, source_note_id: 'n1' }),
    row({ id: 'w3', kind: 'todo', status: 'open', link_type: 'employer', link_id: 'o1', completed_at: null, owner_user_id: U1, source_note_id: 'n1' }),
  ],
  sales_call_notes: [row({ id: 'n1', call_date: '2026-11-07', created_by: U1 }), row({ id: 'n2', call_date: '2026-10-20', created_by: U1 })],
  sales_opportunity_events: [row({ id: 'se1', opportunity_id: 'o3', event_type: 'stage_change', changed_at: '2026-11-12T18:00:02Z' }), row({ id: 'se0', opportunity_id: 'o3', event_type: 'created', changed_at: '2026-10-01T00:00:00Z' })],
  sales_partner_events: [
    row({ id: 'pe1', goal_id: 'g1', event: 'touch', at: '2026-11-11T16:05:00Z', touch_type: 'email', by_user: U1, meta: { apollo_key: 'sent:c-g1:x' } }),
    row({ id: 'pe2', goal_id: 'g1', event: 'touch', at: '2026-11-13T17:00:00Z', touch_type: 'call', by_user: U1, meta: {} }),
    row({ id: 'pe3', goal_id: 'g1', event: 'assign', at: '2026-11-14T17:00:00Z', touch_type: null, by_user: U1, meta: {} }),
  ],
  microsoft_messages: [
    row({ graph_id: 'x1', internet_message_id: 'im1', user_id: U1, direction: 'sent', occurred_at: '2026-10-28T17:00:00Z', external_domains: ['pineoutfitters.test'] }),
    row({ graph_id: 'x2', internet_message_id: 'im1', user_id: U2, direction: 'sent', occurred_at: '2026-10-28T17:00:00Z', external_domains: ['pineoutfitters.test'] }), // the same mail in a second mailbox
    row({ graph_id: 'x3', internet_message_id: 'im3', user_id: U1, direction: 'sent', occurred_at: '2026-10-30T17:00:00Z', external_domains: ['pineoutfitters.test', 'elsewhere.test'] }),
    row({ graph_id: 'x4', internet_message_id: 'im4', user_id: U1, direction: 'received', occurred_at: '2026-11-15T17:00:00Z', external_domains: ['pineoutfitters.test'] }),
  ],
  web_visits: [row({ id: 'v1', matched_type: 'target', matched_id: 't1', last_visit: '2026-11-19', pulled_on: '2026-11-20' })],
});
const RECORDS = [{ type: 'employer', id: 'o1' }, { type: 'employer', id: 'o2' }, { type: 'employer', id: 'o3' }, { type: 'target', id: 't1' }, { type: 'target', id: 't2' }, { type: 'partner', id: 'g1' }, { type: 'partner', id: 'g2' }];

test('a target with Apollo sends has touches; its visit is theirs', async () => {
  const t = await touchesFor(fakeSupabase(seed()), B, { type: 'target', id: 't1' });
  assert.equal(t.count, 1);
  assert.deepEqual(t.last, { at: '2026-11-10T16:00:00Z', kind: 'email', by: null, what: 'Apollo' });
  assert.equal(t.last_signal.kind, 'visit');
});

test('an employer: Apollo sends by account, the sender by mailbox owner, a call note once, opens and replies never summed', async () => {
  const t = await touchesFor(fakeSupabase(seed()), B, { type: 'employer', id: 'o1' });
  assert.equal(t.kinds.email, 2);
  assert.equal(t.kinds.call, 1, 'two to-dos from one call = one call');
  assert.equal(t.count, 3);
  assert.equal(t.kinds.open, 1, 'the scanner open is out');
  assert.equal(t.kinds.reply, 1);
  assert.equal(t.count, OUR_KINDS.reduce((n, k) => n + t.kinds[k], 0));
  assert.deepEqual(t.last, { at: '2026-11-09T16:00:00Z', kind: 'email', by: U2, what: 'Apollo' });
  assert.deepEqual(t.last_signal, { at: '2026-11-09T19:00:00Z', kind: 'open' });
});

test('mail from before the delivered table and from Outlook counts; a received mail and a second mailbox copy do not', async () => {
  const t = await touchesFor(fakeSupabase(seed()), B, { type: 'employer', id: 'o2' });
  assert.equal(t.kinds.email, 4, '2 old Apollo + 2 Outlook');
  assert.equal(t.last.what, 'Outlook');
  assert.equal(t.last.at, '2026-10-30T17:00:00Z');
  assert.equal(t.kinds.click, 1);
  assert.equal(t.count, 4);
});

test('a stage move and a contacted status written with a to-do are that one to-do', async () => {
  const t = await touchesFor(fakeSupabase(seed()), B, { type: 'employer', id: 'o3' });
  assert.equal(t.count, 1);
  assert.deepEqual(t.kinds.todo, 1);
  assert.equal(t.last.kind, 'todo');
  assert.equal(t.last.by, U1);
});

test('a partner: the hook-written Apollo touch is not a second email; an import stamp is a touch; an assign is not', async () => {
  const sb = fakeSupabase(seed());
  const g1 = await touchesFor(sb, B, { type: 'partner', id: 'g1' });
  assert.equal(g1.kinds.email, 1);
  assert.equal(g1.kinds.call, 1);
  assert.equal(g1.count, 2);
  const g2 = await touchesFor(sb, B, { type: 'partner', id: 'g2' });
  assert.equal(g2.count, 1);
  assert.equal(g2.last.what, 'logged');
});

test('a target made from a call has that call; nothing else is invented', async () => {
  const t = await touchesFor(fakeSupabase(seed()), B, { type: 'target', id: 't2' });
  assert.equal(t.count, 1);
  assert.equal(t.last.kind, 'call');
  assert.equal(summarize(null).count, 0);
  assert.equal(summarize(null).last, null);
});

test('batch = single, one read set, and no address in the answer', async () => {
  const sb = fakeSupabase(seed());
  let reads = 0;
  const counted = { from: t => { reads++; return sb.from(t); } };
  const batch = await touchesFor(counted, B, RECORDS);
  const batchReads = reads;
  const singles = [];
  for (const r of RECORDS) singles.push(await touchesFor(sb, B, r));
  assert.deepEqual(batch, singles);
  reads = 0;
  await touchesFor(counted, B, [...RECORDS, ...RECORDS]);
  assert.equal(reads, batchReads, 'twice the records, the same reads');
  assert.ok(!JSON.stringify(batch).includes('@'));
  assert.equal(touchIndex({}).size, 0);
});

test('lastTouchFor is the alias: the last of ours', async () => {
  const sb = fakeSupabase(seed());
  assert.deepEqual(await lastTouchFor(sb, B, { type: 'target', id: 't1' }), (await touchesFor(sb, B, { type: 'target', id: 't1' })).last);
});

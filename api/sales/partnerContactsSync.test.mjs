// node --test api/sales/partnerContactsSync.test.mjs  (partner-360-v1 Stage 3)
import test from 'node:test';
import assert from 'node:assert/strict';
import { contactRow, lastActivity, partnersToSync, PARTNER_CONTACTS_MAX_CALLS } from './partnerContactsSync.js';

test('cap is 20 on its own counter', () => {
  assert.equal(PARTNER_CONTACTS_MAX_CALLS, 20);
});

test('contactRow keeps named columns only: lowercased email, linkedin.com links, no phone, name fallback', () => {
  const row = contactRow('b1', 'g1', {
    id: 'c1', first_name: ' Dana ', last_name: 'Kim', title: ' VP Partnerships ', email: 'Dana.Kim@Example.com',
    linkedin_url: 'https://www.linkedin.com/in/danakim', sanitized_phone: '+15555550100', phone_numbers: [{ raw_number: '555' }], account_id: 'a1',
  });
  assert.deepEqual(Object.keys(row).sort(), ['apollo_contact_id', 'business_id', 'email', 'goal_id', 'linkedin_url', 'name', 'source', 'title', 'updated_at']);
  assert.equal(row.name, 'Dana Kim');
  assert.equal(row.email, 'dana.kim@example.com');
  assert.equal(row.title, 'VP Partnerships');
  assert.equal(row.source, 'apollo');
  assert.equal(JSON.stringify(row).includes('555'), false);
  assert.equal(contactRow('b1', 'g1', { id: 'c2', name: 'Pat Lee', email: 'not-an-email', linkedin_url: 'https://evil.example/linkedin.com/x' }).email, null);
  assert.equal(contactRow('b1', 'g1', { id: 'c2', name: 'Pat Lee', linkedin_url: 'https://evil.example/linkedin.com/x' }).linkedin_url, null);
  assert.equal(contactRow('b1', 'g1', { id: 'c3', email: 'x@example.com' }), null);
});

test('lastActivity: newest stored signal wins, bot opens skipped, reply beats sent at the same instant, null when nothing', () => {
  const messages = [
    { apollo_message_id: 'm1', delivered_at: '2026-10-01T10:00:00Z', replied: false, bounced: false },
    { apollo_message_id: 'm2', delivered_at: '2026-10-03T10:00:00Z', replied: true, bounced: false },
  ];
  const events = [
    { apollo_message_id: 'm1', event: 'open', occurred_at: '2026-10-01T10:00:30Z', user_agent: 'Mozilla', tracking_service: null },   // 30s after delivery = bot
    { apollo_message_id: 'm1', event: 'open', occurred_at: '2026-10-02T09:00:00Z', user_agent: 'Mozilla', tracking_service: null },
  ];
  assert.deepEqual(lastActivity(messages, events), { last_activity_at: '2026-10-03T10:00:00Z', last_activity_type: 'reply' });
  assert.deepEqual(lastActivity([messages[0]], events), { last_activity_at: '2026-10-02T09:00:00Z', last_activity_type: 'open' });
  assert.deepEqual(lastActivity([messages[0]], [events[0]]), { last_activity_at: '2026-10-01T10:00:00Z', last_activity_type: 'sent' });
  assert.deepEqual(lastActivity([{ apollo_message_id: 'm3', delivered_at: '2026-10-05T10:00:00Z', replied: false, bounced: true }], []), { last_activity_at: '2026-10-05T10:00:00Z', last_activity_type: 'bounce' });
  assert.equal(lastActivity([], []), null);
  assert.equal(lastActivity([{ apollo_message_id: 'm4', delivered_at: null, replied: true }], []), null);
});

test('partnersToSync: confirmed domain that is an Apollo account; name-only and unconfirmed matches are not synced', () => {
  const accounts = [{ id: 'a-jw', name: 'Justworks', domain: 'justworks.com' }, { id: 'a-ps', name: 'PerkSpot', domain: 'www.perkspot.com' }, { id: 'a-st', name: 'Stake', domain: 'stake.rent' }];
  const goals = [{ id: 'g1', name: 'Justworks' }, { id: 'g2', name: 'PerkSpot' }, { id: 'g3', name: 'Stake' }, { id: 'g4', name: 'Nobody' }];
  const rows = { g1: [{ domain: 'justworks.com', confirmed: true }], g2: [{ domain: 'perkspot.com', confirmed: true }], g3: [{ domain: 'stake.rent', confirmed: false }] };
  assert.deepEqual(partnersToSync(goals, rows, accounts).map(t => [t.goal.id, t.account.id]), [['g1', 'a-jw'], ['g2', 'a-ps']]);
  assert.deepEqual(partnersToSync(goals, {}, accounts), []);
});

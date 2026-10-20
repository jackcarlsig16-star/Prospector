import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { setVisitPriority, loadOverrides, effectiveVisit } from './visitPriority.js';
import { buildReport } from './visitReport.js';
import { visitedNoTouch } from './tidyRules.js';

const B = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222', U = 'u-jack';
const seed = () => ({
  web_visits: [
    { business_id: B, company_key: 'acme', company_name: 'Acme', priority: 'P3', pulled_on: '2026-10-20' },
    { business_id: OTHER, company_key: 'elsewhere', company_name: 'Elsewhere', priority: 'P1', pulled_on: '2026-10-20' },
  ],
  sales_visit_skip: [],
  visit_priority_override: [],
});
const unique = { sales_visit_skip: r => `${r.business_id}|${r.company_key}` };
const set = (db, body) => setVisitPriority(db, { businessId: B, userId: U, body });

test('a P value: stored with who + when, beats the pull; null goes back to the computed priority', async () => {
  const db = fakeSupabase(seed(), { unique });
  const r = await set(db, { company_key: 'acme', priority: 2 });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.override.priority, r.body.override.not_a_fit, r.body.override.set_by], [2, false, U]);
  assert.ok(r.body.override.set_at);
  const o = await loadOverrides(db, B);
  assert.equal(effectiveVisit({ priority: 'P3', priority_rule: 'Size unknown' }, o.get('acme')).priority, 'P2');
  const back = await set(db, { company_key: 'acme', priority: null });
  assert.deepEqual(back.body, { company_key: 'acme', override: null });
  assert.equal((await loadOverrides(db, B)).size, 0);
});

test('Not a fit: skip list + P4; picking a P value undoes both; Undo (null) removes only the Not a fit skip row', async () => {
  const db = fakeSupabase(seed(), { unique });
  await set(db, { company_key: 'acme', not_a_fit: true });
  let skip = (await db.from('sales_visit_skip').select('*').eq('business_id', B)).data;
  assert.deepEqual(skip.map(s => [s.company_key, s.reason]), [['acme', 'Not a fit']]);
  assert.equal(effectiveVisit({ priority: 'P1' }, (await loadOverrides(db, B)).get('acme')).priority, 'P4');
  await set(db, { company_key: 'acme', priority: 1 });
  skip = (await db.from('sales_visit_skip').select('*').eq('business_id', B)).data;
  assert.equal(skip.length, 0);
  assert.equal((await loadOverrides(db, B)).get('acme').not_a_fit, false);
  await set(db, { company_key: 'acme', not_a_fit: true });
  await set(db, { company_key: 'acme', not_a_fit: true });
  assert.equal((await db.from('sales_visit_skip').select('*').eq('business_id', B)).data.length, 1, 'twice = still one skip row');
  await set(db, { company_key: 'acme', priority: null });
  assert.equal((await db.from('sales_visit_skip').select('*').eq('business_id', B)).data.length, 0);
});

test('refuses bad input and a company this workspace never saw', async () => {
  const db = fakeSupabase(seed(), { unique });
  assert.equal((await set(db, { company_key: 'acme', priority: 5 })).status, 400);
  assert.equal((await set(db, { company_key: 'acme', priority: '2' })).status, 400);
  assert.equal((await set(db, { company_key: 'acme', priority: 2, not_a_fit: true })).status, 400);
  assert.equal((await set(db, { priority: 2 })).status, 400);
  assert.equal((await set(db, { company_key: 'elsewhere', priority: 2 })).status, 404);
});

test('report and Tidy read the effective priority', () => {
  const visits = [{ company_key: 'acme', company_name: 'Acme', priority: 'P3', priority_rule: 'Size unknown', pulled_on: '2026-10-20', top_paths: [] }];
  const overrides = new Map([['acme', { company_key: 'acme', priority: 1, not_a_fit: false, set_by: U, set_at: '2026-10-20T00:00:00Z' }]]);
  const r = buildReport({ visits, skipKeys: new Set(), records: new Map(), signals: [], sources: new Map(), today: '2026-10-20', overrides });
  assert.equal(r.rows[0].priority, 'P1');
  assert.equal(r.counts.P1, 1);
  assert.equal(r.rows[0].override.set_by, U);
  const fit = buildReport({ visits, skipKeys: new Set(), records: new Map(), signals: [], sources: new Map(), today: '2026-10-20', overrides: new Map([['acme', { priority: null, not_a_fit: true }]]) });
  assert.equal(fit.rows[0].priority, 'P4');
  const partners = [{ id: 'p1', name: 'Gallagher', last_touch_at: null }];
  const now = Date.parse('2026-10-20T18:00:00Z');
  assert.equal(visitedNoTouch({ partners, todos: [], visits: [{ matched_id: 'p1', last_visit: '2026-10-19', pulled_on: '2026-10-20' }], now }).length, 1);
});

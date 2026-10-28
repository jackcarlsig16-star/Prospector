// node --test api/sales/visitorRecords.test.mjs  (react-scripts' Jest only runs src/)
// visitor-to-record-v1 REV2 Stage 1 - the V1 auto-create decision, idempotency, caps, evidence text, the auto-accepted
// signal patch, V6 undo patches, and the migration text. Invented companies; 0 network, 0 DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { autoCreateDecision, autoCreatePlan, visitEvidence, recordPayload, autoSignalPatch, attachNote, undoPlan, matchLabel, recordDecision, isUS, hasBuyerTitle, AUTO_CREATE_DAILY_CAP, RECORD_MIN_EMPLOYEES, UNKNOWN_COUNTRY_IS_US } from './visitorRecords.js';

const B = 'biz-1', NOW = new Date('2026-10-27T17:00:00Z');
const visit = (name, over = {}) => ({ id: `v-${name.toLowerCase().replace(/\W/g, '')}`, company_name: name, company_key: name.toLowerCase(), domain: `${name.toLowerCase().replace(/\W/g, '')}.example`, priority: 'P1', priority_rule: 'US 500+ with 5+ visits in 7 days or 3+ unique visitors (Apollo)', noise_reason: null, maybe_user: false, us_500: true, visits_7d: 6, unique_visitors_7d: 3, top_paths: [{ path: '/pricing', visits: 3 }, { path: '/employer-partners', visits: 2 }, { path: '/', visits: 1 }, { path: '/blog', visits: 1 }], apollo_intent: 'high', last_visit: '2026-10-26', pulled_on: '2026-10-27', matched_type: null, matched_id: null, employees: 1200, ...over });

test('V1 bar: P1 creates; P2 creates only with us_500; P3 / noise / maybe_user / skip list wait with a named reason', () => {
  assert.equal(autoCreateDecision(visit('Zz Alder')).action, 'create');
  assert.deepEqual(autoCreateDecision(visit('Zz Birch', { priority: 'P2' })), { action: 'create', reason: 'US 500+ with 5+ visits in 7 days or 3+ unique visitors (Apollo)' });
  assert.deepEqual(autoCreateDecision(visit('Zz Cedar', { priority: 'P2', us_500: false })), { action: 'wait', reason: 'p2_without_us_500' });
  assert.deepEqual(autoCreateDecision(visit('Zz Dune', { priority: 'P3' })), { action: 'wait', reason: 'below_bar' });
  assert.deepEqual(autoCreateDecision(visit('Zz Elm', { priority: 'P4', noise_reason: 'ISP, hosting or bot traffic' })), { action: 'wait', reason: 'noise' });
  assert.deepEqual(autoCreateDecision(visit('Zz Fir', { maybe_user: true })), { action: 'wait', reason: 'maybe_user' });
  assert.deepEqual(autoCreateDecision(visit('Zz Gum'), { skip: new Set(['zz gum']) }), { action: 'wait', reason: 'skip_list' });
});

test('matched records attach, never a second record; an Upside-owned match is stamp-only', () => {
  assert.deepEqual(autoCreateDecision(visit('Zz Harbor', { matched_type: 'partner', matched_id: 'p1' })), { action: 'attach', reason: 'matched', stampOnly: false });
  assert.deepEqual(autoCreateDecision(visit('Zz Quarry', { matched_type: 'target', matched_id: 't1', match_owner_team: 'upside' })), { action: 'attach', reason: 'matched', stampOnly: true });
  assert.equal(autoCreateDecision(visit('Zz Both', { matched_type: 'opportunity', matched_id: 'o1', match_owner_team: 'both' })).stampOnly, true);
  const note = attachNote(visit('Zz Harbor', { matched_type: 'partner', matched_id: 'p1' }));
  assert.deepEqual([note.last_visit, note.matched_type, note.matched_id], ['2026-10-26', 'partner', 'p1']);
  assert.match(note.evidence, /^Visited 6 times in 7 days/);
});

test('idempotent per company_key: an existing created key is a duplicate; the same company twice in one plan creates once', () => {
  assert.deepEqual(autoCreateDecision(visit('Zz Ivy'), { existingKeys: new Set(['zz ivy']) }), { action: 'duplicate', reason: 'already_created' });
  const plan = autoCreatePlan([visit('Zz Ivy'), visit('Zz Ivy', { id: 'v-ivy-2' })], { businessId: B });
  assert.deepEqual(plan.items.map(i => i.action), ['create', 'duplicate']);
});

test('caps: the daily cap counts down across the plan; createdToday eats into it; the overflow is capped, not waited', () => {
  const rows = [visit('Zz A'), visit('Zz B'), visit('Zz C'), visit('Zz D', { priority: 'P3' })];
  const plan = autoCreatePlan(rows, { businessId: B, cap: 2 });
  assert.deepEqual(plan.items.map(i => [i.company_name, i.action]), [['Zz A', 'create'], ['Zz B', 'create'], ['Zz C', 'capped'], ['Zz D', 'wait']]);
  assert.deepEqual(plan.counts, { create: 2, attach: 0, wait: 1, duplicate: 0, capped: 1 });
  assert.equal(plan.capLeft, 0);
  assert.equal(autoCreatePlan(rows, { businessId: B, cap: AUTO_CREATE_DAILY_CAP, createdToday: AUTO_CREATE_DAILY_CAP }).counts.capped, 3);
  assert.equal(AUTO_CREATE_DAILY_CAP, 25);
});

test('evidence: count, top 3 pages, intent, last visit; singular; <= 400 chars; an address in a path never survives', () => {
  assert.equal(visitEvidence(visit('Zz Alder')), 'Visited 6 times in 7 days · pages: /pricing, /employer-partners, / · intent high · last 2026-10-26');
  assert.equal(visitEvidence(visit('Zz One', { visits_7d: 1, top_paths: [], apollo_intent: null, last_visit: null })), 'Visited 1 time in 7 days');
  const long = visitEvidence(visit('Zz Long', { top_paths: [{ path: '/' + 'x'.repeat(500), visits: 1 }] }));
  assert.ok(long.length <= 400);
  assert.ok(!visitEvidence(visit('Zz Leak', { top_paths: [{ path: '/u/ana@leak.example', visits: 1 }] })).includes('@'));
});

test('recordPayload: an employer target via insertCompanyRecord, channel website_visit, source web_visit, owner unassigned, employees from the row as apollo, visit id in noteMeta', () => {
  const p = recordPayload(visit('Zz Alder'), { businessId: B, userId: null });
  assert.deepEqual([p.to, p.kind, p.channel, p.owner, p.employees, p.employeesSource, p.domain, p.name], ['target', 'employer', 'website_visit', null, 1200, 'apollo', 'zzalder.example', 'Zz Alder']);
  assert.deepEqual(p.noteMeta, { visit_id: 'v-zzalder', priority_rule: 'US 500+ with 5+ visits in 7 days or 3+ unique visitors (Apollo)' });
  assert.deepEqual(p.targetExtra, { visit_id: 'v-zzalder', source: 'web_visit' });
  assert.deepEqual(p.source, { source_kind: 'website', source_note: 'Website visit 2026-10-27' });
  const none = recordPayload(visit('Zz Small', { employees: null }), { businessId: B });
  assert.deepEqual([none.employees, none.employeesSource], [null, null]);
  assert.ok(!JSON.stringify(p).includes('@'));
});

test('the auto-accepted signal: status accepted, auto true, decided_by null, target set', () => {
  assert.deepEqual(autoSignalPatch('t-1', { now: NOW }), { status: 'accepted', auto: true, decided_by: null, decided_at: NOW.toISOString(), target_id: 't-1' });
});

test('undo: reopens the signal, rejects the target (archive, never delete), archives the people not already archived, logs; refuses a signal that was not auto-created', () => {
  const signal = { id: 's-1', company_key: 'zz alder', status: 'accepted', auto: true };
  const plan = undoPlan({ signal, target: { id: 't-1' }, people: [{ id: 'p-1', archived_at: null }, { id: 'p-2', archived_at: '2026-10-20T00:00:00Z' }] }, { now: NOW });
  assert.deepEqual(plan.signal, { status: 'new', auto: false, target_id: null, decided_at: null, decided_by: null, updated_at: NOW.toISOString() });
  assert.deepEqual(plan.target, { id: 't-1', patch: { status: 'rejected', updated_at: NOW.toISOString() } });
  assert.deepEqual(plan.people, [{ id: 'p-1', patch: { archived_at: NOW.toISOString(), updated_at: NOW.toISOString() } }]);
  assert.deepEqual(plan.event, { action: 'visit_auto_create_undone', detail: { signal_id: 's-1', target_id: 't-1', people: 2, company_key: 'zz alder' } });
  assert.throws(() => undoPlan({ signal: { ...signal, auto: false } }), /only an auto-created signal/);
  assert.throws(() => undoPlan({ signal: { ...signal, status: 'new' } }), /only an auto-created signal/);
  assert.equal(undoPlan({ signal, target: null }, { now: NOW }).target, null);
});

test('match column: Created wins, then the match type, else None', () => {
  assert.equal(matchLabel(visit('Zz Alder'), { createdKeys: new Set(['zz alder']) }), 'Created');
  assert.equal(matchLabel(visit('Zz X', { matched_type: 'partner' })), 'Partner');
  assert.equal(matchLabel(visit('Zz X', { matched_type: 'opportunity' })), 'Employer');
  assert.equal(matchLabel(visit('Zz X', { matched_type: 'target' })), 'Target');
  assert.equal(matchLabel(visit('Zz X')), 'None');
});

test('migration text: sales_signals.auto, sales_people apollo_person_id / visit_id / archived_at + web_visit in the CHECK, sales_targets.visit_id, sales_settings with RLS + member read + the HomeLover seed, employees_source apollo on 3 tables, no deletes, 6 proof rows', () => {
  const sql = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'supabase', 'migrations', '20261027_visitor_to_record_v1.sql'), 'utf8');
  assert.ok(sql.includes('ALTER TABLE public.sales_signals ADD COLUMN IF NOT EXISTS auto boolean NOT NULL DEFAULT false;'));
  for (const c of ['apollo_person_id text', 'visit_id uuid REFERENCES public.web_visits(id) ON DELETE SET NULL', 'archived_at timestamptz']) assert.ok(sql.includes(`ALTER TABLE public.sales_people ADD COLUMN IF NOT EXISTS ${c}`), c);
  assert.match(sql, /ALTER TABLE public\.sales_people ADD CONSTRAINT sales_people_source_kind_check\s+CHECK \(source_kind IS NULL OR source_kind IN \('homelover_outreach', 'partner_referral', 'person_referral', 'campaign', 'website', 'scout', 'event', 'inbound', 'unknown', 'apollo', 'web_visit'\)\);/);
  assert.ok(sql.includes('ALTER TABLE public.sales_targets ADD COLUMN IF NOT EXISTS visit_id uuid REFERENCES public.web_visits(id) ON DELETE SET NULL;'));
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.sales_settings \(\s+business_id\s+uuid PRIMARY KEY REFERENCES public\.businesses\(id\) ON DELETE CASCADE,\s+buyer_titles\s+text\[\] NOT NULL DEFAULT '\{\}',\s+visitor_domains\s+text\[\],\s+visitor_filters\s+jsonb,/);
  assert.match(sql, /ALTER TABLE public\.sales_settings ENABLE ROW LEVEL SECURITY;/);
  assert.match(sql, /CREATE POLICY s5_read ON public\.sales_settings FOR SELECT TO authenticated USING \(public\.is_member\(business_id\)\);/);
  assert.match(sql, /REVOKE ALL ON public\.sales_settings FROM anon;/);
  assert.ok(sql.includes("ARRAY['homelover.ai', 'homelover.com']") && sql.includes("'Chief People Officer', 'CHRO', 'VP People'") && sql.includes('ON CONFLICT (business_id) DO NOTHING'));
  assert.ok(sql.includes("CHECK (employees_source IS NULL OR employees_source IN (''research'', ''manual'', ''apollo''))"));
  assert.doesNotMatch(sql, /DELETE FROM|DROP TABLE|DROP COLUMN|UPDATE public\./);
  assert.ok(sql.includes('-- Proof - expect 6 rows'));
  assert.ok(!sql.includes('@') || !/[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(sql), 'no address in the migration');
});

// V2a follow-up (choice 1): a record only for a US company of 500+ (or unknown size), or when a buyer title shows up.
test('recordDecision: buyer title wins; not US -> park; US under 500 -> park; US 500+ or unknown size -> create; an unknown country counts as US (REVISABLE)', () => {
  const titles = ['Chief People Officer', 'VP People'];
  assert.deepEqual(recordDecision({ country: 'Canada', employees: 20 }, [{ title: 'VP People Operations' }], { buyerTitles: titles }), { action: 'create', reason: 'buyer_title' });
  assert.deepEqual(recordDecision({ country: 'Canada', employees: 9000 }, [{ title: 'Engineer' }], { buyerTitles: titles }), { action: 'park', reason: 'not_us' });
  assert.deepEqual(recordDecision({ country: 'United States', employees: RECORD_MIN_EMPLOYEES - 1 }, [{ title: 'Owner' }], { buyerTitles: titles }), { action: 'park', reason: 'under_500' });
  assert.deepEqual(recordDecision({ country: 'US', employees: RECORD_MIN_EMPLOYEES }, [], { buyerTitles: titles }), { action: 'create', reason: 'us_500' });
  assert.deepEqual(recordDecision({ country: null, employees: null }, [], { buyerTitles: titles }), { action: UNKNOWN_COUNTRY_IS_US ? 'create' : 'park', reason: UNKNOWN_COUNTRY_IS_US ? 'us_size_unknown' : 'not_us' });
  assert.deepEqual([isUS('United States of America'), isUS('usa'), isUS(' U.S. '), isUS('Mexico'), isUS('')], [true, true, true, false, UNKNOWN_COUNTRY_IS_US]);
  assert.equal(hasBuyerTitle([{ title: 'Director of Benefits' }], ['benefits manager', 'Director of Benefits']), true);
  assert.equal(hasBuyerTitle([{ title: null }], ['CHRO']), false);
  assert.equal(hasBuyerTitle([{ title: 'CHRO' }], []), false);
});

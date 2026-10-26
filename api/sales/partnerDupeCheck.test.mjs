// node --test api/sales/partnerDupeCheck.test.mjs  (react-scripts' Jest only runs src/)
// partner-add-research-v1 REV3 Stage 1 - the dupe check against the
// in-memory Supabase: every source table, archived rows, rejected targets,
// confirmed vs dismissed domains, workspace bound, Member-only.
// 0 network, 0 Claude, 0 Apollo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { findDupes, loadDupeContext, dupeCheckRoute, MAX_PARTIAL } from './partnerDupeCheck.js';

const B = randomUUID(), OTHER = randomUUID();
const P = { gal: randomUUID(), bb: randomUUID(), perk: randomUUID(), other: randomUUID() };
const O = { fit: randomUUID(), old: randomUUID() };
const T = { lock: randomUUID(), zero: randomUUID() };
const seed = () => ({
  sales_goals: [
    { id: P.gal, business_id: B, goal_type: 'partnership', name: 'Gallagher', archived_at: null, pipeline_status: 'replied' },
    { id: P.bb, business_id: B, goal_type: 'partnership', name: 'Brown & Brown, Inc.', archived_at: '2026-10-01T00:00:00Z', pipeline_status: 'not_started' },
    { id: P.perk, business_id: B, goal_type: 'partnership', name: 'PerkSpot', archived_at: null, pipeline_status: null },
    { id: randomUUID(), business_id: B, goal_type: 'company', name: 'Gallagher', archived_at: null, pipeline_status: null },
    { id: P.other, business_id: OTHER, goal_type: 'partnership', name: 'Lockton', archived_at: null, pipeline_status: 'not_started' },
  ],
  sales_opportunities: [
    { id: O.fit, business_id: B, organization: '24 Hour Fitness', archived_at: null },
    { id: O.old, business_id: B, organization: 'Old Employer LLC', archived_at: '2026-09-01T00:00:00Z' },
  ],
  sales_sequenced_accounts: [
    { business_id: B, account_id: 'a-sc', name: '[solidcore]' },
    { business_id: B, account_id: 'a-null', name: null },
    { business_id: OTHER, account_id: 'a-other', name: 'Marriott' },
  ],
  sales_targets: [
    { id: T.lock, business_id: B, name: 'Lockton', status: 'researching' },
    { id: T.zero, business_id: B, name: 'ZeroBounce', status: 'rejected' },
  ],
  partner_domains: [
    { id: randomUUID(), business_id: B, goal_id: P.gal, domain: 'ajg.com', confirmed: true },
    { id: randomUUID(), business_id: B, goal_id: P.perk, domain: 'perkspot.com', confirmed: false },
    { id: randomUUID(), business_id: OTHER, goal_id: P.other, domain: 'lockton.com', confirmed: true },
  ],
});
const ctxFor = async (biz = B) => loadDupeContext(fakeSupabase(seed()), biz);
const ids = list => list.map(r => `${r.type}:${r.id}`);

test('context: partners incl. archived, opportunities incl. archived, named Apollo accounts, every target, confirmed domains - this workspace only', async () => {
  const ctx = await ctxFor();
  assert.deepEqual(ctx.partners.map(p => p.id).sort(), [P.gal, P.bb, P.perk].sort());
  assert.deepEqual(ctx.opportunities.map(o => o.id).sort(), [O.fit, O.old].sort());
  assert.deepEqual(ctx.companies.map(c => c.account_id), ['a-sc']);
  assert.deepEqual(ctx.targets.map(t => t.id).sort(), [T.lock, T.zero].sort());
  assert.deepEqual(ctx.domains, [{ goal_id: P.gal, domain: 'ajg.com' }]);
});

test('exact: partner by normalized name, archived flagged, "Perk Spot" = PerkSpot, name + domain is one entry', async () => {
  const ctx = await ctxFor();
  assert.deepEqual(findDupes({ name: 'gallagher inc.' }, ctx), { exact: [{ type: 'partner', id: P.gal, name: 'Gallagher', archived: false, via: 'name', pipeline_status: 'replied' }], partial: [] });
  const bb = findDupes({ name: 'Brown and Brown' }, ctx).exact;
  assert.equal(bb.length, 1); assert.equal(bb[0].id, P.bb); assert.equal(bb[0].archived, true);
  assert.equal(findDupes({ name: 'Perk Spot' }, ctx).exact[0].pipeline_status, 'not_started');
  const both = findDupes({ name: 'Gallagher', domain: 'https://www.ajg.com/about' }, ctx);
  assert.deepEqual(ids(both.exact), [`partner:${P.gal}`]);
  assert.equal(both.exact[0].via, 'name');
});

test('exact: pipeline employer (incl. archived), Apollo-only account by account_id, target incl. rejected with its status', async () => {
  const ctx = await ctxFor();
  assert.deepEqual(findDupes({ name: '24 Hour Fitness' }, ctx).exact, [{ type: 'opportunity', id: O.fit, name: '24 Hour Fitness', archived: false, via: 'name' }]);
  assert.equal(findDupes({ name: 'Old Employer' }, ctx).exact[0].archived, true);
  assert.deepEqual(findDupes({ name: 'solidcore' }, ctx).exact, [{ type: 'account', id: 'a-sc', name: '[solidcore]', archived: false, via: 'name' }]);
  assert.deepEqual(findDupes({ name: 'ZEROBOUNCE' }, ctx).exact, [{ type: 'target', id: T.zero, name: 'ZeroBounce', archived: false, via: 'name', status: 'rejected' }]);
  assert.equal(findDupes({ name: 'Lockton' }, ctx).exact[0].id, T.lock, 'the other workspace\'s Lockton partner never shows');
});

test('domain: a confirmed partner domain is an exact hit via domain; dismissed (confirmed=false) and unknown domains are not', async () => {
  const ctx = await ctxFor();
  const hit = findDupes({ name: 'Arthur J. Gallagher & Co', domain: 'AJG.com' }, ctx);
  assert.deepEqual(hit.exact.map(r => [r.id, r.via]), [[P.gal, 'domain']]);
  assert.equal(findDupes({ name: 'Perk Spot Deals', domain: 'perkspot.com' }, ctx).exact.length, 0);
  assert.equal(findDupes({ name: 'Nobody', domain: 'nobody.example.com' }, ctx).exact.length, 0);
});

test('partial: whole-word overlap is a warning list, never repeats an exact hit, capped', async () => {
  const ctx = await ctxFor();
  const r = findDupes({ name: 'Gallagher Bassett' }, ctx);
  assert.equal(r.exact.length, 0);
  assert.deepEqual(ids(r.partial), [`partner:${P.gal}`]);
  assert.deepEqual(findDupes({ name: 'Gallagher' }, ctx).partial, []);
  assert.equal(findDupes({ name: 'Fundrise' }, ctx).partial.length, 0);
  const many = { ...ctx, targets: Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, name: `Acme Holdings ${i}`, status: 'proposed' })) };
  assert.equal(findDupes({ name: 'Acme Holdings' }, many).partial.length, MAX_PARTIAL);
  // FIX dupe-generic-words: an Apollo-only account named just "Enterprise" is not a warning for Hewlett Packard Enterprise.
  const generic = { ...ctx, companies: [...ctx.companies, { account_id: 'a-ent', name: 'Enterprise' }] };
  assert.deepEqual(findDupes({ name: 'Hewlett Packard Enterprise' }, generic), { exact: [], partial: [] });
  assert.deepEqual(ids(findDupes({ name: 'Gallagher Bassett' }, generic).partial), [`partner:${P.gal}`]);
  assert.equal(findDupes({ name: 'Enterprise' }, generic).exact[0].id, 'a-ent', 'exact still finds the row itself');
});

const res = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const req = (role, query) => ({ params: { businessId: B }, query, auth: { isPlatformOwner: false, roles: new Map(role ? [[B, role]] : []) } });

test('route: Member+ (Viewer 403), name or domain required, reads this workspace', async () => {
  const sb = fakeSupabase(seed());
  let r = res(); await dupeCheckRoute(req('viewer', { name: 'Gallagher' }), r, sb); assert.equal(r.code, 403);
  r = res(); await dupeCheckRoute(req('member', { name: ' ' }), r, sb); assert.equal(r.code, 400);
  r = res(); await dupeCheckRoute(req('member', { name: 'G' }), r, sb); assert.equal(r.code, 400);
  r = res(); await dupeCheckRoute(req('member', { domain: 'ajg.com' }), r, sb); assert.equal(r.code, 200); assert.equal(r.body.exact[0].id, P.gal);
  r = res(); await dupeCheckRoute(req('member', { name: 'Lockton' }), r, sb); assert.equal(r.code, 200);
  assert.deepEqual(r.body, { exact: [{ type: 'target', id: T.lock, name: 'Lockton', archived: false, via: 'name', status: 'researching' }], partial: [] });
  r = res(); await dupeCheckRoute(req('owner', { name: 'Nobody Here' }), r, sb); assert.deepEqual(r.body, { exact: [], partial: [] });
});

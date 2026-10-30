// node --test api/hk/importedDrafts.test.mjs
// FIX hk-imported-drafts-noise F2 / F3 on the in-memory Supabase: which touches read 'imported', which brands move and
// where, a daily-check DM text and a real Gmail draft stay, apply writes state + Activity and never deletes, a row changed
// since the plan is left alone. Invented names. 0 network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeSupabase } from '../sales/testing/fakeSupabase.mjs';
import { planImportedDrafts, applyImportedDrafts, F3_REASON } from './importedDrafts.js';

const HK = 'biz-hk', ME = 'u-me', PEA = 'u-pea';
const NOW = new Date('2026-10-30T22:00:00Z');
const brand = (id, status, owner = null, over = {}) => ({ id, business_id: HK, name: `Zz ${id}`, status, owner_user_id: owner, owner_hint: owner ? 'pea' : null, archived_at: null, updated_at: '2026-10-01T00:00:00Z', ...over });
const touch = (id, brandId, over = {}) => ({ id, business_id: HK, brand_id: brandId, channel: 'email', kind: 'cold', state: 'drafted', gmail_draft_id: null, sender_user_id: PEA, created_by: 'system', ...over });
const seed = () => ({
  hk_brands: [brand('owned', 'drafted', PEA), brand('free', 'drafted'), brand('real', 'drafted', ME), brand('dmcheck', 'drafted', ME), brand('sent', 'sent', PEA), brand('gone', 'drafted', PEA, { archived_at: '2026-10-20T00:00:00Z' })],
  hk_touches: [
    touch('t-owned', 'owned'), touch('t-owned-dm', 'owned', { channel: 'ig_dm', kind: 'dm_text' }), touch('t-free', 'free'),
    touch('t-real', 'real', { gmail_draft_id: 'draft-1', sender_user_id: ME }), touch('t-dmcheck', 'dmcheck', { channel: 'ig_dm', kind: 'dm_text', sender_user_id: ME }),
    touch('t-sent', 'sent', { state: 'sent' }),
  ],
  hk_events: [{ id: 'e1', business_id: HK, action: 'draft_created', entity_id: 'dmcheck', detail: { touch_id: 't-dmcheck', kind: 'dm_text' } }],
});
const planOf = s => planImportedDrafts({ brands: s.hk_brands, touches: s.hk_touches, draftEvents: s.hk_events.filter(e => e.action === 'draft_created') });

test('F2 / F3 plan: id-less drafted touches -> imported (a daily-check DM text stays); drafted brands with no open draft -> claimed if owned, else candidate; a real draft or an archived brand stays', () => {
  const p = planOf(seed());
  assert.deepEqual(p.touches.map(t => t.id), ['t-owned', 't-owned-dm', 't-free']);
  assert.deepEqual(p.brands.map(b => [b.id, b.to]), [['owned', 'claimed'], ['free', 'candidate']]);
});

test('F2 / F3 apply: touch states + brand statuses + one brand.status Activity row per moved brand; nothing deleted; a row changed since the plan is left alone', async () => {
  const s = seed(), sb = fakeSupabase(s, { now: () => NOW.getTime() });
  const p = planOf(s);
  sb.db.hk_brands.find(b => b.id === 'free').status = 'claimed'; // someone claimed it after the dry run
  const out = await applyImportedDrafts(sb, { businessId: HK, plan: p, now: NOW });
  assert.deepEqual(out, { touches: 3, brands: 1 });
  assert.deepEqual(sb.db.hk_touches.map(t => [t.id, t.state]), [['t-owned', 'imported'], ['t-owned-dm', 'imported'], ['t-free', 'imported'], ['t-real', 'drafted'], ['t-dmcheck', 'drafted'], ['t-sent', 'sent']]);
  assert.deepEqual(sb.db.hk_brands.map(b => [b.id, b.status]), [['owned', 'claimed'], ['free', 'claimed'], ['real', 'drafted'], ['dmcheck', 'drafted'], ['sent', 'sent'], ['gone', 'drafted']]);
  assert.equal(sb.db.hk_brands[0].updated_at, NOW.toISOString());
  const ev = sb.db.hk_events.filter(e => e.action === 'brand.status');
  assert.deepEqual(ev.map(e => [e.entity_id, e.actor_kind, e.detail.prev.status, e.detail.reason]), [['owned', 'system', 'drafted', `${F3_REASON} -> claimed`]]);
  assert.deepEqual([sb.db.hk_touches.length, sb.db.hk_brands.length, sb.db.hk_events.length], [6, 6, 2], 'nothing deleted; Activity kept');
  assert.deepEqual(await applyImportedDrafts(sb, { businessId: HK, plan: p, now: NOW }), { touches: 0, brands: 0 }, 'a second apply writes nothing');
});

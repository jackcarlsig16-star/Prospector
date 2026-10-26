// Shared fixtures for the hk route tests: an invented HumanKind-shaped workspace on the in-memory Supabase. Names
// are invented; the one address lives on one contact and one reply so the tests can prove where it may and may not
// serialize. 0 network, 0 DB.
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from '../sales/testing/fakeSupabase.mjs';

export const HK = 'biz-hk', OTHER = 'biz-other', JACK = 'u-jack', PETE = 'u-pete';
export const ID = { juice: randomUUID(), yoga: randomUUID(), cafe: randomUUID(), run: randomUUID(), old: randomUUID() };
export const NOW = new Date('2026-10-26T20:00:00Z');
const brand = (id, name, over = {}) => ({ id, business_id: HK, name, normalized_name: name.toLowerCase(), aliases: [], segment: 'sponsor_brand', is_local: false, status: 'candidate', relationship: 'prospect', owner_user_id: null, owner_unclear: false, source: 'user_supplied', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', archived_at: null, ...over });

export const seed = (extra = {}) => fakeSupabase({
  hk_brands: [
    brand(ID.juice, 'Northwind Juice', { relationship: 'sponsor', status: 'sponsor', niche: 'cold-pressed juice', domain: 'northwindjuice.example' }),
    brand(ID.yoga, 'Harbor Yoga', { owner_user_id: PETE, status: 'claimed', domain: 'harboryoga.example', is_local: true, city: 'Chicago' }),
    brand(ID.cafe, 'Copperleaf Cafe', { relationship: 'do_not_contact', dnc_reason: 'asked us to stop' }),
    brand(ID.run, 'Bluefin Run Club', { domain: 'bluefinrun.example', aliases: ['Bluefin Runners'] }),
    brand(ID.old, 'Old Brand', { archived_at: '2026-09-01T00:00:00Z' }),
  ],
  hk_contacts: [{ id: 'c-ana', business_id: HK, brand_id: ID.yoga, name: 'Ana Example', title: 'Owner', email: 'ana@harboryoga.example', email_source: 'site_published', is_primary: true, left_company: false, created_at: '2026-10-02T00:00:00Z' }],
  hk_touches: [
    { id: 't1', business_id: HK, brand_id: ID.yoga, sender_user_id: PETE, channel: 'email', kind: 'cold', subject: 'HumanKind x Harbor Yoga - a mat-time challenge', body_text: 'secret body', state: 'sent', sent_at: '2026-10-03T00:00:00Z', created_by: 'claude', created_at: '2026-10-03T00:00:00Z' },
    { id: 't2', business_id: HK, brand_id: ID.yoga, sender_user_id: PETE, channel: 'email', kind: 'bump', subject: 'Re: HumanKind x Harbor Yoga', body_text: 'secret bump', state: 'sent', sent_at: '2026-10-09T00:00:00Z', created_by: 'claude', created_at: '2026-10-09T00:00:00Z' },
  ],
  hk_replies: [{ id: 'r1', business_id: HK, brand_id: ID.yoga, touch_id: 't2', from_name: 'Ana', from_domain: 'harboryoga.example', from_email: 'ana@harboryoga.example', received_at: '2026-10-10T00:00:00Z', label: 'interested', handled: false, created_at: '2026-10-10T00:00:00Z' }],
  hk_sponsor_periods: [], hk_events: [], hk_duplicate_decisions: [], hk_settings: [], hk_member_prefs: [],
  accounts: [{ id: 'acc-1', business_id: HK, account_kind: 'business', data: { name: 'Dunmore Mills' } }],
  projects: [{ id: 'p1', business_id: HK }],
  prospects: [{ id: 'pr-1', project_id: 'p1', name: 'Eastgate Hospital Partners' }],
  ...extra,
}, { now: () => NOW.getTime(), unique: { hk_brands: r => (r.archived_at ? null : `${r.business_id}:${r.normalized_name}`) } });

export const reqOf = ({ method = 'GET', params = {}, query = {}, body = {}, user = JACK, role = 'member', platformOwner = false, businessId = HK } = {}) =>
  ({ method, params: { businessId, ...params }, query, body, auth: { user: { id: user, name: 'Test User' }, isPlatformOwner: platformOwner, roles: new Map([[HK, role]]) } });
export const resOf = () => { const r = { code: 200, body: null }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; return r; };
export const call = async (route, req, deps) => { const res = resOf(); await route(req, res, deps); return res; };
export const hasAt = v => JSON.stringify(v).includes('@');

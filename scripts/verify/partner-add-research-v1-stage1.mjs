// partner-add-research-v1 REV3 Stage 1 bar 4 - GET goals/partners/dupe-check against a real server + real DB.
// TEMP data only: 1 workspace, 2 temp users (member, viewer), 8 seeded rows (3 partners incl. 1 archived, 1 opportunity,
// 1 Apollo-only sequenced account, 2 targets incl. 1 rejected, 2 partner_domains incl. 1 dismissed); all torn down via
// tempGuard. HomeLover: never read by the route (its business id isn't in any request), counts read before/after to prove it.
// 0 Claude, 0 Apollo, 0 browser. ~30 s, cap 120 s. Scope: 10 route calls, ~15 small DB reads/writes.
// Usage: node scripts/verify/partner-add-research-v1-stage1.mjs
import { createRequire } from 'module';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3974;
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const NAME = 'ZZ Dupe Check Temp';
const WATCH = ['businesses', 'business_members', 'profiles', 'sales_goals', 'sales_opportunities', 'sales_sequenced_accounts', 'sales_targets', 'partner_domains', 'research_runs'];
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const counts = async biz => { const o = {}; for (const t of WATCH) { let q = svc.from(t).select('*', { count: 'exact', head: true }); if (biz && t !== 'profiles' && t !== 'businesses') q = q.eq('business_id', biz); o[t] = (await q).count; } return o; };
let srv, B, users = [], pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
async function teardown() {
  if (srv) srv.kill(); srv = null;
  if (B) {
    for (const t of ['partner_domains', 'sales_targets', 'sales_sequenced_accounts', 'sales_opportunities', 'sales_goals', 'research_runs', 'auth_events', 'business_members']) await svc.from(t).delete().eq('business_id', B);
    await svc.from('businesses').delete().eq('id', B); B = null;
  }
  for (const u of users) { await svc.from('auth_events').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('actor_id', u.id); await svc.auth.admin.deleteUser(u.id); }
  users = [];
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 120000 });

const before = await counts(); const hlBefore = await counts(HOMELOVER);
console.log('counts before', JSON.stringify(before)); console.log('HomeLover before', JSON.stringify(hlBefore));
try {
  const tag = 'dupe1-' + Date.now();
  B = ins(await svc.from('businesses').insert({ name: NAME, website_url: 'https://dupe.example.com', color: '#6F8CF0', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
  const mk = async (name, role) => {
    const email = `${tag}-${name}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
    const { data: u, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(error.message);
    await svc.from('profiles').update({ display_name: `${name} Test`, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
    ins(await svc.from('business_members').insert({ business_id: B, email, name: `${name} Test`, user_id: u.user.id, role }).select());
    const anon = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data: s, error: sErr } = await anon.auth.signInWithPassword({ email, password });
    if (sErr) throw new Error(sErr.message);
    const u2 = { id: u.user.id, token: s.session.access_token }; users.push(u2); return u2;
  };
  const [gal, bb, perk] = ins(await svc.from('sales_goals').insert([
    { business_id: B, goal_type: 'partnership', name: 'Temp Gallagher', pipeline_status: 'replied' },
    { business_id: B, goal_type: 'partnership', name: 'Temp Brown & Brown, Inc.', archived_at: new Date().toISOString() },
    { business_id: B, goal_type: 'partnership', name: 'Temp PerkSpot' },
  ]).select('id, name'));
  const [opp] = ins(await svc.from('sales_opportunities').insert([{ business_id: B, organization: 'Temp 24 Hour Fitness' }]).select('id'));
  ins(await svc.from('sales_sequenced_accounts').insert([{ business_id: B, account_id: `${tag}-acct`, name: 'Temp Solidcore', first_sequenced_at: '2026-10-12T12:00:00Z', week_start: '2026-10-12' }]).select());
  const [lock, zero] = ins(await svc.from('sales_targets').insert([
    { business_id: B, name: 'Temp Lockton', kind: 'partner', status: 'researching' },
    { business_id: B, name: 'Temp ZeroBounce', kind: 'employer', status: 'rejected' },
  ]).select('id, name'));
  ins(await svc.from('partner_domains').insert([
    { business_id: B, goal_id: gal.id, domain: 'temp-ajg.example.com', source: 'manual', confirmed: true, is_primary: true },
    { business_id: B, goal_id: perk.id, domain: 'temp-perkspot.example.com', source: 'manual', confirmed: false, is_primary: false },
  ]).select());

  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const member = await mk('Member', 'member'), viewer = await mk('Viewer', 'viewer');
  const get = async (u, params) => {
    const r = await fetch(`http://localhost:${PORT}/api/sales/${B}/goals/partners/dupe-check?${new URLSearchParams(params)}`, { headers: { cookie: `prospector_at=${u.token}` } });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const key = r => `${r.type}:${r.id}`;

  let r = await get(member, { name: 'temp gallagher inc' });
  ok('exact partner by normalized name', r.status === 200 && r.body.exact.length === 1 && key(r.body.exact[0]) === `partner:${gal.id}` && r.body.exact[0].pipeline_status === 'replied' && r.body.exact[0].archived === false, JSON.stringify(r.body));
  r = await get(member, { name: 'Temp Brown and Brown' });
  ok('archived partner is an exact hit, flagged archived', r.body.exact.length === 1 && r.body.exact[0].id === bb.id && r.body.exact[0].archived === true, JSON.stringify(r.body.exact));
  r = await get(member, { name: 'Temp 24 Hour Fitness' });
  ok('pipeline employer -> type opportunity', r.body.exact.length === 1 && key(r.body.exact[0]) === `opportunity:${opp.id}`, JSON.stringify(r.body.exact));
  r = await get(member, { name: 'Temp Solidcore' });
  ok('Apollo-only sequenced account -> type account, id = account_id', r.body.exact.length === 1 && key(r.body.exact[0]) === `account:${tag}-acct`, JSON.stringify(r.body.exact));
  r = await get(member, { name: 'Temp Lockton' });
  ok('target -> type target with status', r.body.exact.length === 1 && key(r.body.exact[0]) === `target:${lock.id}` && r.body.exact[0].status === 'researching', JSON.stringify(r.body.exact));
  r = await get(member, { name: 'TEMP ZEROBOUNCE' });
  ok('rejected target still an exact hit, status rejected', r.body.exact.length === 1 && r.body.exact[0].id === zero.id && r.body.exact[0].status === 'rejected', JSON.stringify(r.body.exact));
  r = await get(member, { name: 'Arthur Gallagher', domain: 'https://TEMP-AJG.example.com/about' });
  ok('confirmed domain -> exact via domain', r.body.exact.length === 1 && r.body.exact[0].id === gal.id && r.body.exact[0].via === 'domain', JSON.stringify(r.body.exact));
  r = await get(member, { name: 'Perk Deals', domain: 'temp-perkspot.example.com' });
  ok('dismissed (confirmed=false) domain is not a hit', r.body.exact.length === 0, JSON.stringify(r.body));
  r = await get(member, { name: 'Temp Gallagher Bassett' });
  ok('partial -> warning list only', r.body.exact.length === 0 && r.body.partial.length === 1 && r.body.partial[0].id === gal.id, JSON.stringify(r.body));
  r = await get(viewer, { name: 'Temp Gallagher' });
  ok('viewer gets 403', r.status === 403, `status ${r.status}`);
  r = await get(member, { name: 'T' });
  ok('1-char name without domain -> 400', r.status === 400, `status ${r.status}`);
  const hl = await fetch(`http://localhost:${PORT}/api/sales/${HOMELOVER}/goals/partners/dupe-check?name=Gallagher`, { headers: { cookie: `prospector_at=${member.token}` } });
  ok('temp member cannot query HomeLover (403)', hl.status === 403, `status ${hl.status}`);
} catch (e) {
  console.log('ERROR', e.message);
} finally {
  await cleanup();
  const after = await counts(); const hlAfter = await counts(HOMELOVER);
  const same = JSON.stringify(before) === JSON.stringify(after), hlSame = JSON.stringify(hlBefore) === JSON.stringify(hlAfter);
  console.log('counts after ', JSON.stringify(after));
  console.log(`${pass}/${total} passed · temp rows removed: ${same ? 'yes' : 'NO - ' + JSON.stringify(after)} · HomeLover unchanged: ${hlSame ? 'yes' : 'NO'}`);
  console.log(`restored: ${same && hlSame ? 'yes' : 'NO'}`);
  process.exit(pass === total && same && hlSame ? 0 : 1);
}

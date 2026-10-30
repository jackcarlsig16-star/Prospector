// FIX hk-imported-drafts-noise Stage 2 live check (after the F2/F3 apply) on the REAL HumanKind workspace.
// Jack (ownerSession) through the real wiring (server.js spawned on localhost, HK_SCHEDULER off): GET /jobs/today?owner=me
// (Today's Drafts to review + the Today badge), /gmail/status?owner=me (Inbox badge), /drafts?owner=me|all. Peter by
// intercept: the same route handlers in-process with his user id and his mailbox stubbed to none - his Gmail is never read.
// Every number is compared to the DB (hk_touches / hk_replies), never to the UI.
// SCOPE (declared): 0 Claude, 0 Apollo, 0 Gmail; GETs only (~6 requests). Restore: Jack's session signed out +
// profiles.last_seen_at (sign-in rows kept by rule). "restored" THROWS if a HumanKind count moved (hk_job_runs /
// hk_sync_runs excluded: the prod cron writes them). Runtime ~20 s, cap 2 min.
// Usage: node scripts/verify/hk-imported-drafts-noise-stage2.mjs
import { createRequire } from 'module';
import path from 'path';
import { spawn } from 'child_process';
import { ownerSession } from './lib/ownerSession.mjs';
import { realGet } from './lib/realWiring.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { selectAllPages } = await import('../../api/lib/selectAllPages.js');
const { isOpenDraft } = await import('../../api/hk/rules.js');
const R = await import('../../api/hk/gmailRoutes.js');
const { todayPayload } = await import('../../api/hk/jobs/runner.js');
const PORT = 3994, BASE = `http://localhost:${PORT}`;
const HK_TABLES = ['hk_brands', 'hk_contacts', 'hk_touches', 'hk_replies', 'hk_events', 'hk_signals', 'hk_settings', 'hk_member_prefs'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const must = r => { if (r.error) throw new Error(r.error.message); return r; };
const hk = (await svc.from('businesses').select('id, features').eq('name', 'HumanKind')).data?.find(b => b.features?.hk_sales);
if (!hk) { console.log('ABORT: no HumanKind workspace with hk_sales on'); process.exit(1); }
const B = hk.id;
const counts = async () => { const o = {}; for (const t of HK_TABLES) o[t] = must(await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', B)).count; return o; };
const members = must(await svc.from('business_members').select('user_id, name').eq('business_id', B)).data;
const peter = members.find(m => /^pete/i.test(m.name || ''))?.user_id;
const results = [];
const ok = (name, pass, detail = '') => { results.push(pass); console.log(pass ? 'PASS' : 'FAIL', name, detail); };
const before = await counts();
let srv, owner;
const timer = setTimeout(() => { console.log('ABORT: over the 2 min cap'); srv?.kill(); process.exit(1); }, 120000); timer.unref();
try {
  const touches = await selectAllPages(() => svc.from('hk_touches').select('id, state, channel, gmail_draft_id, sender_user_id').eq('business_id', B).order('id'));
  const dbDrafts = id => touches.filter(t => isOpenDraft(t) && t.sender_user_id === id).length;
  ok('DB: no drafted email without a Gmail draft id; 101 imported', touches.filter(t => t.state === 'drafted' && t.channel === 'email' && !t.gmail_draft_id).length === 0 && touches.filter(t => t.state === 'imported').length === 101, `states ${JSON.stringify(touches.reduce((o, t) => ({ ...o, [t.state]: (o[t.state] || 0) + 1 }), {}))}`);
  const brandsDrafted = must(await svc.from('hk_brands').select('id', { count: 'exact', head: true }).eq('business_id', B).eq('status', 'drafted').is('archived_at', null)).count;
  ok('DB: live brands at status drafted', brandsDrafted === 0, `${brandsDrafted}`);
  const moved = must(await svc.from('hk_events').select('id', { count: 'exact', head: true }).eq('business_id', B).eq('action', 'brand.status').like('detail->>reason', 'sheet said drafted%')).count;
  ok('DB: 42 brand.status Activity rows from the apply', moved === 42, `${moved}`);

  owner = await ownerSession(svc);
  const jack = owner.userId;
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const get = p => realGet({ base: BASE, businessId: B, session: owner.session, path: p });
  const today = await get('/jobs/today?owner=me');
  const status = await get('/gmail/status?owner=me');
  const mine = await get('/drafts?owner=me'), all = await get('/drafts?owner=all');
  ok('real wiring: all four GETs 200', [today, status, mine, all].every(r => r.code === 200), [today, status, mine, all].map(r => r.code).join(','));
  const todayDrafts = today.body.digest?.sections?.drafts?.length ?? -1;
  ok("Jack: Today's Drafts to review (All) = open email drafts in the DB", todayDrafts === touches.filter(t => t.channel === 'email' && isOpenDraft(t)).length, `${todayDrafts}`);
  ok('Jack: Today badge sections (me)', !!today.body.owner_counts, JSON.stringify(today.body.owner_counts));
  ok('Jack: Inbox badge drafts (me) = DB open drafts he sent', status.body.badges?.drafts === dbDrafts(jack), `${status.body.badges?.drafts} vs ${dbDrafts(jack)}`);
  const openReplies = must(await svc.from('hk_replies').select('id', { count: 'exact', head: true }).eq('business_id', B).eq('handled', false)).count;
  ok('Jack: Inbox badge replies (me) <= workspace open replies', status.body.badges?.replies <= openReplies, `${status.body.badges?.replies} of ${openReplies}`);
  ok('Jack: /drafts lists (me / all) = DB open drafts', mine.body.drafts?.length === dbDrafts(jack) && all.body.drafts?.length === touches.filter(isOpenDraft).length, `${mine.body.drafts?.length} / ${all.body.drafts?.length}`);

  const res = () => { const r = { code: 200, body: null }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; return r; };
  const req = q => ({ method: 'GET', params: { businessId: B }, query: q, body: {}, auth: { user: { id: peter, name: 'Peter' }, isPlatformOwner: false, roles: new Map([[B, 'member']]) } });
  const d = { supabase: svc, mailbox: async () => null };
  const ps = res(); await R.gmailStatusRoute(req({ owner: 'me' }), ps, d);
  const pl = res(); await R.listDraftsRoute(req({ owner: 'me' }), pl, d);
  const pt = await todayPayload({ businessId: B, owner: 'me', meId: peter, d: { supabase: svc, mailbox: async () => null } });
  ok('Peter (intercept): Inbox badge drafts = DB open drafts he sent (was 101)', ps.code === 200 && ps.body.badges.drafts === dbDrafts(peter), `${ps.body?.badges?.drafts} vs ${dbDrafts(peter)}`);
  ok('Peter (intercept): /drafts list', pl.code === 200 && pl.body.drafts.length === dbDrafts(peter), `${pl.body?.drafts?.length}`);
  ok('Peter (intercept): Today badge sections', !!pt.owner_counts && pt.owner_counts.drafts === 0 && pt.owner_counts.dm_ready === 0, JSON.stringify(pt.owner_counts));
} finally {
  srv?.kill();
  if (owner) console.log(await owner.release());
  const after = await counts();
  const movedT = HK_TABLES.filter(t => after[t] !== before[t]);
  if (movedT.length) throw new Error(`restored: NO - counts moved: ${movedT.map(t => `${t} ${before[t]} -> ${after[t]}`).join(', ')}`);
  console.log(`restored: yes (HumanKind counts identical: ${JSON.stringify(after)})`);
  console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
}
process.exit(results.every(Boolean) ? 0 : 1);

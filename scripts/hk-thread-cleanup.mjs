// grow-mailbox-link-v1 rulings (1) + (2), Nov 1, for the rows the first backfill / read already wrote:
// (1) each linked thread is re-checked with ONE threads.get metadata on its member's own grant (From / To / Cc / Date /
//     List-Unsubscribe + labels): a thread that is bulk mail only -> link_state 'ignored' (archived, never deleted), with
//     ONE Activity line per brand; any other unread thread gets its facts again without the bulk messages (a thread only
//     they wrote -> waiting_on 'none').
// (2) rows read as 'interested' get read_message_count cleared, so the next thread-read (tightened prompt) re-reads them
//     inside the day's cap.
// SCOPE (declared): HumanKind hk_brand_threads link_state linked (65 today); Gmail <= 40 units a thread (~2,600 units,
// cap 5,000); 0 Claude. --apply needs migration 20261101_grow_mailbox_link_v1c.sql (link_state 'ignored') and snapshots
// the rows to audits/ first. Runtime < 60 s, cap 120 s.  Usage: node scripts/hk-thread-cleanup.mjs [--dry-run | --apply]
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { jobDeps } = await import('../api/hk/jobs/runner.js');
const { messagesOf, threadFacts } = await import('../api/hk/threadLinks.js');
const { logEvent } = await import('../api/hk/hkShared.js');
const APPLY = process.argv.includes('--apply');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
setTimeout(() => { console.log('ABORT: over the 120 s cap'); process.exit(1); }, 120000).unref();
const hk = must(await svc.from('businesses').select('id, features').eq('name', 'HumanKind')).find(b => b.features?.hk_sales);
const B = hk.id, D = jobDeps({ supabase: svc }), now = new Date();
const rows = must(await svc.from('hk_brand_threads').select('*').eq('business_id', B).eq('link_state', 'linked'));
const names = Object.fromEntries(must(await svc.from('hk_brands').select('id, name').in('id', [...new Set(rows.map(r => r.brand_id))])).map(b => [b.id, b.name]));
const tally = rs => ({ linked: rs.filter(r => r.link_state === 'linked').length, waiting_us: rs.filter(r => r.link_state === 'linked' && r.waiting_on === 'us').length, stages: rs.filter(r => r.link_state === 'linked').reduce((o, r) => (o[r.deal_stage || 'unread'] = (o[r.deal_stage || 'unread'] || 0) + 1, o), {}) });
const tokens = new Map();
let units = 0;
const plan = [];
for (const r of rows) {
  if (!tokens.has(r.member_user_id)) { const m = await D.mailbox(B, r.member_user_id, 'inbox').catch(() => null); tokens.set(r.member_user_id, m ? { m, token: await D.tokenForGrant(m.grant, 'gmail') } : null); }
  const t = tokens.get(r.member_user_id);
  if (!t) { plan.push({ r, skip: 'no mailbox' }); continue; }
  if (units + 40 > 5000) { plan.push({ r, skip: 'unit cap' }); continue; }
  units += 40;
  const th = await D.gmail.getThreadPeople(t.token, r.gmail_thread_id).catch(() => null);
  if (!th) { plan.push({ r, skip: 'gone' }); continue; }
  const all = messagesOf(th), keep = all.filter(m => !m.bulk);
  if (!keep.length) { plan.push({ r, patch: { link_state: 'ignored' }, why: 'bulk' }); continue; }
  const own = [t.m.grant.google_email].filter(Boolean);
  const f = threadFacts(keep, { ownEmails: own, ownDomains: own.map(e => e.split('@')[1]) });
  const patch = { message_count: f.message_count, first_at: f.first_at, last_at: f.last_at, last_ours_at: f.last_ours_at, last_theirs_at: f.last_theirs_at, ...(r.read_at ? {} : { waiting_on: f.waiting_on }), ...(r.deal_stage === 'interested' ? { read_message_count: null } : {}) };
  plan.push({ r, patch, why: r.deal_stage === 'interested' ? 're-read' : 'facts' });
}
const after = rows.map(r => ({ ...r, ...(plan.find(p => p.r.id === r.id)?.patch || {}) }));
const ignoredBy = plan.filter(p => p.why === 'bulk').reduce((o, p) => (o[p.r.brand_id] = (o[p.r.brand_id] || 0) + 1, o), {});
console.log(`hk-thread-cleanup (${APPLY ? 'APPLY' : 'dry run - nothing written'}) · ${rows.length} linked rows · Gmail units ${units}`);
console.log('before', JSON.stringify(tally(rows)));
console.log('after ', JSON.stringify(tally(after)));
console.log('bulk -> ignored by brand:', Object.entries(ignoredBy).map(([b, n]) => `${names[b]} ${n}`).join(' · ') || 'none');
console.log('re-read queued (interested):', plan.filter(p => p.why === 're-read').map(p => names[p.r.brand_id]).join(', ') || 'none', '· skipped:', JSON.stringify(plan.filter(p => p.skip).map(p => p.skip)));
if (!APPLY) process.exit(0);
const snap = path.join(ROOT, 'audits', `hk-thread-cleanup-apply-${now.toISOString().replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(snap, JSON.stringify({ at: now.toISOString(), rows }, null, 2));
console.log('snapshot:', path.relative(ROOT, snap));
// bulk rows first: without migration v1c the first 'ignored' write fails on the CHECK before any other row changes
for (const p of plan.filter(x => x.patch).sort((a, b) => (b.why === 'bulk') - (a.why === 'bulk'))) must(await svc.from('hk_brand_threads').update({ ...p.patch, updated_at: new Date().toISOString() }).eq('id', p.r.id).select('id'));
for (const [brandId, n] of Object.entries(ignoredBy)) await logEvent(svc, { businessId: B, actorKind: 'system', entityType: 'brand', entityId: brandId, action: 'thread.ignored_bulk', detail: { threads: n, reason: 'bulk mail (newsletter / promotion) never links - grow-mailbox-link ruling, Nov 1' } });
console.log(`applied: ${plan.filter(x => x.patch).length} rows updated, ${Object.values(ignoredBy).reduce((a, b) => a + b, 0)} ignored, ${Object.keys(ignoredBy).length} Activity rows`);
process.exit(0);

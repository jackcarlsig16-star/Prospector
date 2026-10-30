// FIX hk-imported-drafts-noise F2 / F3 for HumanKind, through planImportedDrafts / applyImportedDrafts (api/hk/importedDrafts.js).
// SCOPE (declared): service-key SELECTs on HumanKind hk_brands (~950), hk_touches (~300), hk_events action draft_created
// (a handful), business_members. 0 Claude, 0 Gmail, 0 Apollo. Runtime < 10 s, cap 60 s.
// --dry-run (default): writes NOTHING, prints the touches that would read 'imported' and the brands that would move, STOP.
// --apply (only on Jack's "apply"): snapshots the planned rows to audits/hk-imported-drafts-apply-<stamp>.json first, then
// touches -> 'imported', brands -> claimed / candidate + one brand.status Activity row each. Never deletes.
// Usage: node scripts/hk-imported-drafts.mjs [--dry-run | --apply]
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { selectAllPages } = await import('../api/lib/selectAllPages.js');
const { planImportedDrafts, applyImportedDrafts } = await import('../api/hk/importedDrafts.js');
const APPLY = process.argv.includes('--apply');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const timer = setTimeout(() => { console.log('ABORT: over the 60 s cap'); process.exit(1); }, 60000); timer.unref();

const hk = must(await svc.from('businesses').select('id, features').eq('name', 'HumanKind')).find(b => b.features?.hk_sales);
if (!hk) { console.log('ABORT: no HumanKind workspace with hk_sales on'); process.exit(1); }
const B = hk.id, now = new Date();
const brands = await selectAllPages(() => svc.from('hk_brands').select('id, name, status, owner_user_id, owner_hint, archived_at').eq('business_id', B).order('id'));
const touches = await selectAllPages(() => svc.from('hk_touches').select('id, brand_id, channel, kind, state, gmail_draft_id, sender_user_id, created_by').eq('business_id', B).order('id'));
const draftEvents = await selectAllPages(() => svc.from('hk_events').select('detail').eq('business_id', B).eq('action', 'draft_created').order('id'));
const members = must(await svc.from('business_members').select('user_id, name').eq('business_id', B));
const first = id => (id ? (members.find(m => m.user_id === id)?.name || 'unknown member').split(/\s+/)[0] : 'none');
const plan = planImportedDrafts({ brands, touches, draftEvents });

const tally = (rows, key) => Object.entries(rows.reduce((o, r) => { const k = key(r); o[k] = (o[k] || 0) + 1; return o; }, {})).map(([k, n]) => `${k} ${n}`).join(' · ') || 'none';
const drafted = touches.filter(t => t.state === 'drafted');
console.log(`hk-imported-drafts (${APPLY ? 'APPLY' : 'dry run - nothing written'}) · HumanKind · ${brands.length} brands, ${touches.length} touches, ${draftEvents.length} draft_created events`);
console.log(`hk_touches drafted now: ${drafted.length} (with a Gmail draft id: ${drafted.filter(t => t.gmail_draft_id).length})`);
console.log(`F2 -> imported: ${plan.touches.length} · by channel/kind: ${tally(plan.touches, t => `${t.channel}/${t.kind}`)} · by sender: ${tally(plan.touches, t => first(t.sender_user_id))} · by created_by: ${tally(plan.touches, t => t.created_by)}`);
console.log(`F2 kept as drafted: ${drafted.length - plan.touches.length}`);
console.log(`F3 brands at 'drafted' with no open draft: ${plan.brands.length} · ${tally(plan.brands, b => `${b.to} (${b.owner_user_id ? first(b.owner_user_id) : b.owner_hint ? `sheet ${b.owner_hint}, no member` : 'nobody'})`)}`);
for (const b of [...plan.brands].sort((x, y) => x.to.localeCompare(y.to) || x.name.localeCompare(y.name))) console.log(`  ${b.to.padEnd(9)} ${b.name} · owner ${b.owner_user_id ? first(b.owner_user_id) : 'none'}${b.owner_hint ? ` · sheet ${b.owner_hint}` : ''}`);

if (APPLY) {
  const file = path.join(ROOT, 'audits', `hk-imported-drafts-apply-${now.toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ at: now.toISOString(), business_id: B, plan }, null, 2));
  console.log(`snapshot: ${path.relative(ROOT, file)}`);
  const out = await applyImportedDrafts(svc, { businessId: B, plan, now });
  const after = await selectAllPages(() => svc.from('hk_touches').select('state').eq('business_id', B).order('id'));
  console.log(`applied: ${out.touches} touches -> imported, ${out.brands} brands moved (+ ${out.brands} Activity rows) · hk_touches now: ${tally(after, t => t.state)}`);
} else console.log('STOP - re-run with --apply on Jack\'s "apply".');
process.exit(0);

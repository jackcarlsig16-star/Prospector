// HumanKind: the brands whose last touch is in the future because the sheet cells were typed 2027 (Jack Outreach rows
// 2-9, Aug 3-5 2027). Jack's ruling Oct 31: last_touch_at and each touch's drafted_at / sent_at move back ONE year;
// next_due_at is CLEARED (not moved to Aug 2026, which would make old bumps due); one Activity row per brand.
// SCOPE (declared): service-key SELECTs on HumanKind hk_brands (last_touch_at > now, expected 8) and their hk_touches;
// with --apply: snapshot to audits/ first, then 8 hk_brands + their touch updates + 8 hk_events inserts. Never deletes.
// 0 Claude, 0 Gmail, 0 Apollo. Runtime < 10 s, cap 60 s.
// Usage: node scripts/hk-future-touch-fix.mjs [--dry-run | --apply]
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { logEvent } = await import('../api/hk/hkShared.js');
const APPLY = process.argv.includes('--apply');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
setTimeout(() => { console.log('ABORT: over the 60 s cap'); process.exit(1); }, 60000).unref();

const hk = must(await svc.from('businesses').select('id, features').eq('name', 'HumanKind')).find(b => b.features?.hk_sales);
if (!hk) { console.log('ABORT: no HumanKind workspace with hk_sales on'); process.exit(1); }
const B = hk.id, now = new Date(), nowIso = now.toISOString();
const back = iso => { const d = new Date(iso); d.setUTCFullYear(d.getUTCFullYear() - 1); return d.toISOString(); };
const brands = must(await svc.from('hk_brands').select('*').eq('business_id', B).gt('last_touch_at', nowIso).is('archived_at', null).order('name'));
const touches = brands.length ? must(await svc.from('hk_touches').select('*').eq('business_id', B).in('brand_id', brands.map(b => b.id))) : [];
const plan = brands.map(b => {
  const to = back(b.last_touch_at);
  const tPlans = touches.filter(t => t.brand_id === b.id).map(t => ({ t, patch: Object.fromEntries(['drafted_at', 'sent_at'].filter(k => t[k] && t[k] > nowIso).map(k => [k, back(t[k])])) })).filter(x => Object.keys(x.patch).length);
  return { b, to, tPlans, ok: to < nowIso && tPlans.every(x => Object.values(x.patch).every(v => v < nowIso)) };
});
console.log(`hk-future-touch-fix (${APPLY ? 'APPLY' : 'dry run - nothing written'}) · ${brands.length} brands with last_touch_at in the future`);
for (const p of plan) console.log(`  ${p.ok ? 'ok ' : 'SKIP'} ${p.b.name} · ref ${p.b.import_ref} · last_touch ${p.b.last_touch_at.slice(0, 10)} -> ${p.to.slice(0, 10)} · next_due ${p.b.next_due_at ? p.b.next_due_at.slice(0, 10) : '-'} -> cleared · touches ${p.tPlans.map(x => Object.entries(x.patch).map(([k, v]) => `${k} ${x.t[k].slice(0, 10)}->${v.slice(0, 10)}`).join(' ')).join('; ') || 'none'}`);
const go = plan.filter(p => p.ok);
if (!APPLY) { console.log(`would change ${go.length} brands, ${go.reduce((n, p) => n + p.tPlans.length, 0)} touches, ${go.length} Activity rows. Re-run with --apply on Jack's word.`); process.exit(0); }

const stamp = nowIso.replace(/[:.]/g, '-');
const snap = path.join(ROOT, 'audits', `hk-future-touch-fix-apply-${stamp}.json`);
fs.writeFileSync(snap, JSON.stringify({ at: nowIso, brands: go.map(p => p.b), touches: go.flatMap(p => p.tPlans.map(x => x.t)) }, null, 2));
console.log(`snapshot: ${path.relative(ROOT, snap)}`);
let nb = 0, nt = 0;
for (const p of go) {
  for (const x of p.tPlans) { must(await svc.from('hk_touches').update(x.patch).eq('id', x.t.id).select('id')); nt++; }
  must(await svc.from('hk_brands').update({ last_touch_at: p.to, next_due_at: null, updated_at: nowIso }).eq('id', p.b.id).select('id')); nb++;
  await logEvent(svc, { businessId: B, actorKind: 'system', entityType: 'brand', entityId: p.b.id, action: 'brand.updated', detail: { changed: ['last_touch_at', 'next_due_at'], prev: { last_touch_at: p.b.last_touch_at, next_due_at: p.b.next_due_at }, reason: 'sheet date typed 2027 -> moved back one year; next due cleared (Jack, Oct 31)' } });
}
const left = must(await svc.from('hk_brands').select('id').eq('business_id', B).gt('last_touch_at', new Date().toISOString()).is('archived_at', null));
console.log(`applied: ${nb} brands, ${nt} touches, ${nb} Activity rows · brands still dated in the future: ${left.length}`);

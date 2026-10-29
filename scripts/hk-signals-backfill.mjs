// grow-signals-v1 Stage 2 - the 30-day signal backfill for HumanKind, through the same signalsFromRows + writeSignal the
// live writers use (so a later live write of the same reply / touch / month is a no-op, and a re-run writes nothing).
// SCOPE (declared): service-key SELECTs on HumanKind hk_brands (~952), hk_touches, hk_replies, hk_contacts,
// hk_domain_intel, hk_sponsor_periods, hk_settings, hk_events (brand.status, last 30 d), hk_signals. 0 Claude, 0 Gmail,
// 0 Apollo. --dry-run (default): writes NOTHING, prints counts per kind + the Hot / Warm / Cool / Cold preview, STOP.
// --apply (only on Jack's "apply"): inserts those signals (unique per ref; existing ones skipped) and recomputes heat
// for every live brand. Runtime < 1 min, cap 120 s.
// Usage: node scripts/hk-signals-backfill.mjs [--dry-run | --apply]
import { createRequire } from 'module';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { selectAllPages } = await import('../api/lib/selectAllPages.js');
const { dueFollowups } = await import('../api/hk/jobs/plan.js');
const S = await import('../api/hk/signals.js');
const APPLY = process.argv.includes('--apply');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const timer = setTimeout(() => { console.log('ABORT: over the 120 s cap'); process.exit(1); }, 120000); timer.unref();

const hk = must(await svc.from('businesses').select('id, features').eq('name', 'HumanKind')).find(b => b.features?.hk_sales);
if (!hk) { console.log('ABORT: no HumanKind workspace with hk_sales on'); process.exit(1); }
const B = hk.id, now = new Date(), since = new Date(now.getTime() - S.BACKFILL_DAYS * 864e5).toISOString();
const all = t => selectAllPages(() => svc.from(t).select('*').eq('business_id', B).order('id'));
const [brands, touches, replies, contacts, intel, periods] = await Promise.all(['hk_brands', 'hk_touches', 'hk_replies', 'hk_contacts', 'hk_domain_intel', 'hk_sponsor_periods'].map(all));
const settings = must(await svc.from('hk_settings').select('*').eq('business_id', B).maybeSingle()) || {};
const byId = Object.fromEntries(brands.map(b => [b.id, b]));
// hk_events don't store the new status, so a brand.status event counts as meeting_set when the brand is at meeting now
// and the event's prev status was something else.
const meetings = (await selectAllPages(() => svc.from('hk_events').select('id, entity_id, detail, created_at').eq('business_id', B).eq('action', 'brand.status').gte('created_at', since).order('id')))
  .filter(e => byId[e.entity_id]?.status === 'meeting' && e.detail?.prev?.status && e.detail.prev.status !== 'meeting');
const fu = dueFollowups({ brands: brands.filter(b => !b.archived_at), touches, replies, contacts, settings, now });
const sigs = S.signalsFromRows({ businessId: B, brands, touches, replies, intel, periods, meetings, followups: fu.items || [], now, since });
const existing = await selectAllPages(() => svc.from('hk_signals').select('kind, ref_type, ref_id, brand_id, points, occurred_at, dismissed_at').eq('business_id', B).order('id'));
const have = new Set(existing.map(s => `${s.kind}|${s.ref_type}|${s.ref_id}`));
const fresh = sigs.filter(s => !have.has(`${s.kind}|${s.refType}|${String(s.refId)}`));
const perKind = Object.fromEntries(Object.keys(S.POINTS).map(k => [k, fresh.filter(s => s.kind === k).length]));
const skippedAuto = replies.filter(r => r.received_at >= since && S.replyKind(r.label) === null).length;

const preview = { hot: 0, warm: 0, cool: 0, cold: 0 }, top = [];
const pool = [...existing, ...fresh.map(s => ({ kind: s.kind, brand_id: s.brandId, points: S.POINTS[s.kind], occurred_at: s.occurredAt, dismissed_at: null }))];
const by = {}; for (const s of pool) if (s.brand_id) (by[s.brand_id] ||= []).push(s);
for (const b of brands.filter(x => !x.archived_at)) { const h = S.heatOf(b, by[b.id] || [], now); preview[S.bandOf(h)]++; if (h > 0) top.push({ name: b.name, heat: h, band: S.bandOf(h), top: (by[b.id] || []).filter(s => !S.SPONSOR_KINDS.has(s.kind)).sort((x, y) => y.points - x.points)[0]?.kind }); }
top.sort((a, b) => b.heat - a.heat);

console.log(`grow-signals backfill (${APPLY ? 'APPLY' : 'dry run - nothing written'}) · HumanKind · window ${since.slice(0, 10)} .. ${now.toISOString().slice(0, 10)}`);
console.log(`would write ${fresh.length} signals (${sigs.length - fresh.length} already exist) · auto-replies skipped: ${skippedAuto}`);
console.log('per kind:', JSON.stringify(Object.fromEntries(Object.entries(perKind).filter(([, n]) => n))), '· every other kind 0');
console.log(`heat preview (prospects only): Hot ${preview.hot} · Warm ${preview.warm} · Cool ${preview.cool} · Cold ${preview.cold}`);
console.log('top 10:', top.slice(0, 10).map(t => `${t.name} ${t.heat} (${t.band}, ${t.top})`).join(' · ') || 'none');

if (APPLY) {
  const out = await S.writeAll(svc, fresh);
  const heat = await S.recomputeHeat(svc, B, { now });
  console.log(`applied: ${out.written} written, ${out.skipped} skipped as duplicates · heat recomputed for ${heat.brands} brands (${heat.changed} changed)`);
} else console.log('STOP - re-run with --apply on Jack\'s "apply".');
process.exit(0);

// FIX grow-sheet-owner-respect live check - the real route functions, in process, as Jack on the REAL HumanKind workspace.
//   --root <checkout> --briefing-only : Send these 10 + the eligible count from another checkout's code (the "before").
//   (default)                         : the same Briefing read on this checkout, hk_check on rumpl.com + "dark matter
//                                       coffee" through the connector's tool runner, and ONE + Pipeline on a Pete-sheet
//                                       candidate: ask (409) -> Take it -> Undo.
// SCOPE (declared): reads ~953 hk_brands rows per Briefing read, 2 hk_check items, 1 brand row. 0 Claude, 0 Apollo,
// 0 Gmail (the connector's mailbox is stubbed to "none", so the live warm search never runs). Writes: the 3 pipeline
// calls on one brand + the Activity rows they and the connector call add (KEPT by rule). Restore: that brand's row back
// to its snapshot exactly (incl. updated_at). "restored" THROWS if any hk_* count other than hk_events moved.
// Runtime ~15 s, cap 120 s.  Usage: node scripts/verify/grow-sheet-owner-respect-v1.mjs [--root <dir> --briefing-only]
import { createRequire } from 'module';
import path from 'path';
const HERE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const arg = k => { const i = process.argv.indexOf(k); return i === -1 ? null : process.argv[i + 1]; };
const ROOT = arg('--root') ? path.resolve(arg('--root')) : HERE, BRIEFING_ONLY = process.argv.includes('--briefing-only');
const require = createRequire(HERE + '/package.json');
require('dotenv').config({ path: HERE + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const must = r => { if (r.error) throw new Error(r.error.message); return r; };
const T0 = Date.now();
setTimeout(() => { console.log('ABORT: over the 120 s cap'); process.exit(2); }, 120_000).unref();

const hk = (await svc.from('businesses').select('id, features').eq('name', 'HumanKind')).data?.find(b => b.features?.hk_sales);
if (!hk) { console.log('ABORT: no HumanKind workspace with hk_sales on'); process.exit(1); }
const jackId = must(await svc.from('profiles').select('id').eq('is_platform_owner', true)).data[0].id;
const role = must(await svc.from('business_members').select('role').eq('business_id', hk.id).eq('user_id', jackId).single()).data.role;
const auth = { user: { id: jackId, name: 'Jack' }, isPlatformOwner: true, roles: new Map([[hk.id, role]]) };
const req = (params = {}, body = {}, query = {}) => ({ method: 'POST', params: { businessId: hk.id, ...params }, query, body, auth });
const call = async (route, r, deps) => { const out = { code: 200, body: null }; const res = { status(c) { out.code = c; return res; }, json(b) { out.body = b; return res; } }; await route(r, res, deps); return out; };

const { briefingRoute } = await import(ROOT + '/api/hk/briefingRoutes.js');
const brief = await call(briefingRoute, req({}, {}, { owner: 'me' }));
if (brief.code !== 200) throw new Error(`briefing ${brief.code} ${JSON.stringify(brief.body)}`);
const owners = Object.fromEntries(must(await svc.from('business_members').select('user_id, name').eq('business_id', hk.id)).data.map(m => [m.user_id, String(m.name || '').split(/\s+/)[0]]));
const sheetOf = c => (c.owner_user_id ? owners[c.owner_user_id] || 'member' : c.owner_hint ? `Sheet: ${c.owner_hint}` : 'Unclaimed');
console.log(JSON.stringify({ code: ROOT === HERE ? 'this checkout' : ROOT, eligible: brief.body.eligible, sheet_skipped: brief.body.sheet_skipped ?? '(field absent)', send: brief.body.send.map(c => `${c.name} [${sheetOf(c)}]`) }, null, 1));
if (BRIEFING_ONLY) process.exit(0);

const HK_TABLES = ['hk_brands', 'hk_contacts', 'hk_touches', 'hk_replies', 'hk_signals', 'hk_events'];
const counts = async () => { const o = {}; for (const t of HK_TABLES) o[t] = must(await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', hk.id)).count; return o; };
const c0 = await counts();

// hk_check through the connector's tool runner (the same handler /mcp calls), mailbox stubbed: 0 Gmail.
const { runTool } = await import(HERE + '/api/mcp/tools.js');
const noGmail = new Proxy({}, { get: () => () => { throw new Error('Gmail must not be called'); } });
const chk = await runTool({ auth, businessId: hk.id, origin: 'https://prospector-chtj.onrender.com', d: { mailbox: async () => null, gmail: noGmail } }, 'hk_check', { brands: [{ name: 'rumpl.com', domain: 'rumpl.com' }, { name: 'dark matter coffee' }] });
const results = JSON.parse(chk.content[0].text).results || JSON.parse(chk.content[0].text);
console.log('hk_check:', JSON.stringify(Array.isArray(results) ? results.map(r => ({ name: r.name, verdict: r.verdict, exact: r.exact, headline: r.headline ?? null })) : results));

// One Take it + Undo on a Pete-sheet candidate.
const pick = must(await svc.from('hk_brands').select('*').eq('business_id', hk.id).is('archived_at', null).is('owner_user_id', null).eq('owner_unclear', false).eq('relationship', 'prospect').eq('status', 'candidate').ilike('owner_hint', 'pete').order('name').limit(1)).data[0];
if (!pick) { console.log('ABORT: no Pete-sheet candidate'); process.exit(1); }
const snap = { ...pick };
const { pipelineRoute } = await import(HERE + '/api/hk/signalsRoutes.js');
let restoredLine = 'NOT RUN';
try {
  const ask = await call(pipelineRoute, req({ id: pick.id }, {}));
  console.log('ask:', ask.code, ask.body.error, JSON.stringify({ sheet_owner: ask.body.sheet_owner, confirm_sheet_owner: ask.body.confirm_sheet_owner }));
  const take = await call(pipelineRoute, req({ id: pick.id }, { confirm_sheet_owner: true }));
  const ev = must(await svc.from('hk_events').select('action, detail').eq('business_id', hk.id).eq('entity_id', pick.id).order('created_at', { ascending: false }).limit(1)).data[0];
  console.log('take it:', take.code, JSON.stringify({ name: pick.name, owner_is_jack: take.body.brand?.owner_user_id === jackId, status: take.body.brand?.status, event: ev?.action, note: ev?.detail?.note }));
  const undo = await call(pipelineRoute, req({ id: pick.id }, { undo: true, expect_updated_at: take.body.brand.updated_at }));
  console.log('undo:', undo.code, JSON.stringify({ undone: undo.body.undone }));
} finally {
  const { id, business_id } = snap;
  // A claim / release touches only these; everything else is then compared field by field.
  must(await svc.from('hk_brands').update({ owner_user_id: snap.owner_user_id, owner_unclear: snap.owner_unclear, status: snap.status, updated_at: snap.updated_at }).eq('id', id).eq('business_id', business_id));
  const now = must(await svc.from('hk_brands').select('*').eq('id', id).single()).data;
  const diff = Object.keys(snap).filter(k => JSON.stringify(snap[k]) !== JSON.stringify(now[k]) && !(typeof snap[k] === 'string' && Date.parse(snap[k]) === Date.parse(now[k])));
  const c1 = await counts();
  const moved = HK_TABLES.filter(t => t !== 'hk_events' && c1[t] !== c0[t]);
  if (diff.length || moved.length) throw new Error(`NOT RESTORED: row fields ${diff.join(',') || '-'}; counts moved ${moved.map(t => `${t} ${c0[t]}->${c1[t]}`).join(', ') || '-'}`);
  restoredLine = `restored: yes (brand row identical incl. updated_at; hk_events +${c1.hk_events - c0.hk_events} kept)`;
  console.log(restoredLine, `· ${Math.round((Date.now() - T0) / 1000)} s`);
}

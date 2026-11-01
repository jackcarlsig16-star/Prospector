// company-progress-bar-v1 Stage 1 live check - as Jack on the REAL HomeLover workspace, through the real route functions
// in process: Mark contacted moves a test employer Target -> Contacted (the DB trigger logs the stage_change) and Undo
// (the opportunity PATCH with allow_backward, what companyReach's Undo sends) puts Target back; at Meeting it stays put;
// a test partner Not started -> Sent and the partner Undo restores it; Advance moves the partner one step and a stale
// screen (old expect) is 409.
// SCOPE (declared): 1 sales_opportunities + 1 sales_goals row created for the check ("Zz Verify Progress ..."), ~8
// event / to-do rows on them; all deleted in finally. 0 Claude, 0 Gmail, 0 Apollo. Runtime ~10 s, cap 60 s.
// "restored" THROWS unless HomeLover's counts on the 5 touched tables are identical before and after.
// Usage: node scripts/verify/company-progress-bar-v1-stage1.mjs
import { createRequire } from 'module';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
setTimeout(() => { console.log('ABORT: over the 60 s cap'); process.exit(2); }, 60_000).unref();
const hl = must(await svc.from('businesses').select('id, name').ilike('name', 'HomeLover%'));
if (hl.length !== 1) { console.log(`ABORT: expected one HomeLover workspace, found ${hl.length}`); process.exit(1); }
const B = hl[0].id;
const jackId = must(await svc.from('profiles').select('id').eq('is_platform_owner', true))[0].id;
const TABLES = ['sales_opportunities', 'sales_goals', 'sales_opportunity_events', 'sales_partner_events', 'sales_week_goals'];
const counts = async () => { const o = {}; for (const t of TABLES) { const { count, error } = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', B); if (error) throw new Error(`count ${t}: ${error.message}`); o[t] = count; } return o; };
const auth = { user: { id: jackId, email: 'verify', name: 'Jack' }, isPlatformOwner: true, roles: new Map([[B, 'owner']]) };
const call = async (route, req) => { const out = { code: 200, body: null }; const res = { status(c) { out.code = c; return res; }, json(b) { out.body = b; return res; } }; await route({ ...req, auth }, res); return out; };
const { markContactedRoute, advanceStageRoute } = await import(ROOT + '/api/sales/companyPanel.js');
const { updateOpportunityRoute } = await import(ROOT + '/api/sales/pipelineRoutes.js');
const { partnerUndoRoute } = await import(ROOT + '/api/sales/partnersRoutes.js');
let pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${String(d).slice(0, 300)}` : ''}`); };
const c0 = await counts();
let oppId = null, goalId = null;
try {
  oppId = must(await svc.from('sales_opportunities').insert({ business_id: B, organization: 'Zz Verify Progress Employer', stage: 'target', org_type: 'employer' }).select('id').single()).id;
  goalId = must(await svc.from('sales_goals').insert({ business_id: B, goal_type: 'partnership', name: 'Zz Verify Progress Partner', pipeline_status: 'not_started' }).select('id').single()).id;
  const stage = async () => must(await svc.from('sales_opportunities').select('stage').eq('id', oppId).single()).stage;
  const pstage = async () => must(await svc.from('sales_goals').select('pipeline_status').eq('id', goalId).single()).pipeline_status;

  const m1 = await call(markContactedRoute, { params: { businessId: B, type: 'employer', id: oppId }, body: {} });
  const ev = must(await svc.from('sales_opportunity_events').select('from_stage, to_stage').eq('opportunity_id', oppId).eq('event_type', 'stage_change'));
  ok('1 employer at Target: Mark contacted -> Contacted + stage_change event + done to-do', m1.code === 200 && await stage() === 'contacted' && ev.length === 1 && ev[0].to_stage === 'contacted' && m1.body.todo?.status === 'done', JSON.stringify(m1.body?.stage));
  const u1 = await call(updateOpportunityRoute, { params: { businessId: B, id: oppId }, body: { stage: m1.body.stage.before, allow_backward: true } });
  ok('2 Undo puts the employer back at Target', u1.code === 200 && await stage() === 'target', u1.code);
  must(await svc.from('sales_opportunities').update({ stage: 'meeting' }).eq('id', oppId));
  const m2 = await call(markContactedRoute, { params: { businessId: B, type: 'employer', id: oppId }, body: {} });
  ok('3 employer at Meeting: Mark contacted = to-do only, stage stays', m2.code === 200 && await stage() === 'meeting' && m2.body.stage.after === 'meeting');

  const m3 = await call(markContactedRoute, { params: { businessId: B, type: 'partner', id: goalId }, body: {} });
  ok('4 partner Not started: Mark contacted -> Sent (first_email_sent)', m3.code === 200 && await pstage() === 'first_email_sent', JSON.stringify(m3.body?.stage));
  const u2 = await call(partnerUndoRoute, { params: { businessId: B, id: goalId }, body: { event_id: m3.body.event.id } });
  ok('5 partner Undo restores Not started', u2.code === 200 && await pstage() === 'not_started', `${u2.code} ${JSON.stringify(u2.body)}`);
  const a1 = await call(advanceStageRoute, { params: { businessId: B, type: 'partner', id: goalId }, body: { expect: 'not_started' } });
  ok('6 Advance moves the partner one step (Researching)', a1.code === 200 && await pstage() === 'researching', JSON.stringify(a1.body));
  const a2 = await call(advanceStageRoute, { params: { businessId: B, type: 'partner', id: goalId }, body: { expect: 'not_started' } });
  ok('7 a stale screen (old expect) is 409 "changed elsewhere", nothing moves', a2.code === 409 && a2.body?.code === 'stale_stage' && await pstage() === 'researching', JSON.stringify(a2.body));
} finally {
  if (oppId) {
    must(await svc.from('sales_week_goals').delete().eq('business_id', B).eq('link_type', 'opportunity').eq('link_id', oppId));
    must(await svc.from('sales_opportunity_events').delete().eq('business_id', B).eq('opportunity_id', oppId));
    must(await svc.from('sales_opportunities').delete().eq('business_id', B).eq('id', oppId));
  }
  if (goalId) {
    must(await svc.from('sales_week_goals').delete().eq('business_id', B).eq('link_type', 'partner').eq('link_id', goalId));
    must(await svc.from('sales_partner_events').delete().eq('business_id', B).eq('goal_id', goalId));
    must(await svc.from('sales_goals').delete().eq('business_id', B).eq('id', goalId));
  }
  const c1 = await counts();
  const moved = TABLES.filter(t => c0[t] !== c1[t]);
  console.log(`checks ${pass}/${total}`);
  if (moved.length) throw new Error(`restored: NO - ${moved.map(t => `${t} ${c0[t]} -> ${c1[t]}`).join(', ')}`);
  console.log(`restored: yes (HomeLover ${TABLES.map(t => `${t} ${c1[t]}`).join(' · ')}; both test records and their rows deleted)`);
}

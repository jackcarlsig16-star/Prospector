// visitor-people-follow-record-v1 V6 - one-time backfill on HomeLover: every live sales_people row on an ACCEPTED target
// whose promoted record exists moves onto that record through V1's code path (api/sales/visitorPeopleMove.js
// moveTargetPeople - employer re-pointed, partner -> partner_contacts + the old row archived; nothing deleted).
//   node scripts/backfill/visitor-people-follow-record.mjs --dry-run   lists from -> to, writes nothing
//   node scripts/backfill/visitor-people-follow-record.mjs --apply     moves them, then one score recompute (0 Claude, 0 Apollo)
// Idempotent: a second dry run finds 0. Promoted record = a partner by the target's promoted_goal_id, an employer by
// the "from target <id>" its notes carry. Scope: HomeLover's accepted targets (11 on Oct 28), a few rows each.
import { createRequire } from 'module';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { moveTargetPeople } = await import('../../api/sales/visitorPeopleMove.js');
const { recomputeScores } = await import('../../api/sales/intentScoreRun.js');

const APPLY = process.argv.includes('--apply');
if (!APPLY && !process.argv.includes('--dry-run')) { console.log('usage: --dry-run | --apply'); process.exit(2); }
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const biz = must(await svc.from('businesses').select('id').eq('name', 'HomeLover'));
if (biz.length !== 1) throw new Error('expected one HomeLover workspace');
const B = biz[0].id;

const targets = must(await svc.from('sales_targets').select('id, name, promoted_goal_id').eq('business_id', B).eq('status', 'accepted'));
const opps = must(await svc.from('sales_opportunities').select('id, organization, notes, archived_at').eq('business_id', B));
const goals = must(await svc.from('sales_goals').select('id, name, archived_at').eq('business_id', B).eq('goal_type', 'partnership'));
const plan = [];
for (const t of targets) {
  const people = must(await svc.from('sales_people').select('id, name, title').eq('business_id', B).eq('target_id', t.id).is('archived_at', null));
  if (!people.length) continue;
  const g = t.promoted_goal_id && goals.find(x => x.id === t.promoted_goal_id);
  const o = !g && opps.find(x => (x.notes || '').includes(`from target ${t.id}`));
  if (!g && !o) { console.log(`skip  ${t.name}: accepted, ${people.length} people, no promoted record found`); continue; }
  plan.push({ t, people, to: g ? 'partner' : 'employer', id: g ? g.id : o.id, toName: g ? g.name : o.organization, archived: !!(g || o).archived_at });
}
for (const p of plan) for (const x of p.people) console.log(`${APPLY ? 'move ' : 'would'} ${x.name}${x.title ? ` (${x.title})` : ''}: target ${p.t.name} ${p.t.id.slice(0, 8)} -> ${p.to} ${p.toName} ${p.id.slice(0, 8)}${p.archived ? ' (archived record)' : ''}`);
console.log(`${APPLY ? 'apply' : 'dry run'}: ${plan.reduce((n, p) => n + p.people.length, 0)} people on ${plan.length} accepted targets with a promoted record`);
if (!APPLY || !plan.length) process.exit(0);

let moved = 0;
for (const p of plan) moved += await moveTargetPeople(svc, { businessId: B, userId: null, targetId: p.t.id, to: p.to, id: p.id, undo: null });
console.log(`moved ${moved}`);
const r = await recomputeScores(svc, { businessId: B, trigger: 'manual' });
console.log(`recompute: ${r.counts.companies} companies scored · ${r.counts.removed} score rows removed · P1 ${r.counts.P1} · P2 ${r.counts.P2}`);

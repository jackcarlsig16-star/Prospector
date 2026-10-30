// FIX linkedin-url-normalize live check - as Jack on the REAL HomeLover workspace, through the real route functions in
// process: the company window's "Save contact" (addContactRoute) on one HomeLover partner with a link typed WITHOUT
// https ("linkedin.com/in/zz-verify-linkedin-normalize") -> stored as https://www.linkedin.com/in/…; then the existing
// People remove (deletePersonRoute) takes it out.
// SCOPE (declared): 1 partner_contacts insert + its delete on one partner; reads 1 partner row + 2 counts. 0 Claude,
// 0 Gmail, 0 Apollo, no event rows. Runtime ~5 s, cap 60 s. "restored" THROWS if the partner's contact count moved.
// Usage: node scripts/verify/linkedin-url-normalize-v1.mjs
import { createRequire } from 'module';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const must = r => { if (r.error) throw new Error(r.error.message); return r; };
setTimeout(() => { console.log('ABORT: over the 60 s cap'); process.exit(2); }, 60_000).unref();
const hl = must(await svc.from('businesses').select('id, name').ilike('name', 'HomeLover%')).data;
if (hl.length !== 1) { console.log(`ABORT: expected one HomeLover workspace, found ${hl.length}`); process.exit(1); }
const B = hl[0].id;
const jackId = must(await svc.from('profiles').select('id').eq('is_platform_owner', true)).data[0].id;
const partner = must(await svc.from('sales_goals').select('id, name').eq('business_id', B).eq('goal_type', 'partnership').order('created_at').limit(1)).data[0];
if (!partner) { console.log('ABORT: no HomeLover partner'); process.exit(1); }
const count = async () => must(await svc.from('partner_contacts').select('*', { count: 'exact', head: true }).eq('business_id', B).eq('goal_id', partner.id)).count;
const c0 = await count();
const auth = { user: { id: jackId, name: 'Jack' }, isPlatformOwner: true, roles: new Map([[B, 'owner']]) };
const call = async (route, req) => { const out = { code: 200, body: null }; const res = { status(c) { out.code = c; return res; }, json(b) { out.body = b; return res; } }; await route(req, res); return out; };
const { addContactRoute } = await import(ROOT + '/api/sales/companyPanel.js');
const { deletePersonRoute } = await import(ROOT + '/api/sales/partnerPeople.js');
const TYPED = 'linkedin.com/in/zz-verify-linkedin-normalize';
let id = null, line = 'NOT RUN';
try {
  const saved = await call(addContactRoute, { method: 'POST', params: { businessId: B, type: 'partner', id: partner.id }, body: { name: 'Zz Verify LinkedIn', title: 'Test row', linkedin_url: TYPED }, auth });
  id = saved.body?.person?.id || null;
  const row = id ? must(await svc.from('partner_contacts').select('linkedin_url, source').eq('id', id).single()).data : null;
  console.log(JSON.stringify({ partner: partner.name, typed: TYPED, status: saved.code, stored: row?.linkedin_url, source: row?.source }));
  if (saved.code !== 201 || row?.linkedin_url !== 'https://www.linkedin.com/in/zz-verify-linkedin-normalize') throw new Error(`save: ${saved.code} ${JSON.stringify(saved.body)}`);
  const bad = await call(addContactRoute, { method: 'POST', params: { businessId: B, type: 'partner', id: partner.id }, body: { name: 'Zz Verify Bad', linkedin_url: 'linkedin.com.evil.com/in/x' }, auth });
  console.log(JSON.stringify({ bad: bad.code, error: bad.body?.error }));
  if (bad.code !== 400) throw new Error('a non-LinkedIn link was not refused');
} finally {
  if (id) { const del = await call(deletePersonRoute, { method: 'DELETE', params: { businessId: B, id: partner.id, personId: id }, auth }); console.log('remove:', del.code, JSON.stringify(del.body)); }
  const c1 = await count();
  if (c1 !== c0) throw new Error(`restored: NO - partner_contacts on ${partner.name} ${c0} -> ${c1}`);
  line = `restored: yes (partner_contacts on ${partner.name} ${c0} -> ${c1}; the test row removed through the People remove route)`;
  console.log(line);
}

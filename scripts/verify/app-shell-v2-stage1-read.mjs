// app-shell-v2 Stage 1 - READ-ONLY (0 writes, 0 Claude, 0 Apollo). The sales workspace only: THREE searches through
// the route function behind GET /api/search (each = 8 limited reads + at most 8 small follow-ups), as the platform
// owner and as a stand-in viewer / outsider role map (no user is created). Estimated 6 s; hard cap 60 s. Prints
// company names, counts and timings; a person or a to-do prints as a count only.
// Usage: node scripts/verify/app-shell-v2-stage1-read.mjs
import { createRequire } from 'module';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { ensureRegistry } = await import('../../api/scout/registry.js');
const { search } = await import('../../api/search.js');
setTimeout(() => { console.log('CAP: 60 s'); process.exit(1); }, 60000).unref();
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const server = (await import('fs')).readFileSync(ROOT + '/server.js', 'utf8');
const registry = await ensureRegistry([...server.matchAll(/'(api\/[a-z0-9_-]+\/scoutEntities\.js)'/g)].map(m => path.join(ROOT, m[1])));
const all = (await svc.from('businesses').select('id, features').order('created_at')).data;
const W = all.find(b => b.features?.goals_sales), OTHER = all.find(b => !b.features?.goals_sales);
let pass = 0, fail = 0;
const check = (ok, label) => { ok ? pass++ : fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); };
const owner = { user: { id: 'owner' }, isPlatformOwner: true, roles: new Map() };
for (const q of ['met', 'hilton', 'zzyx']) {
  const t = Date.now();
  const r = await search(svc, registry, { auth: owner, q, business: W.id });
  const g = k => r.body.groups.find(x => x.key === k);
  console.log(`     "${q}" · ${Date.now() - t} ms · companies ${g('companies').count} [${g('companies').items.map(i => `${i.title}${i.pill ? ` ${i.pill.label} ${i.pill.value}` : ''}${i.owner ? ` · ${i.owner.name}` : ''}`).join(' | ')}] · people ${g('people').count} (${g('people').items.filter(i => i.pill).length} with a heat pill) · to-dos ${g('todos').count}`);
  check(r.status === 200 && r.body.groups.length === 3 && r.body.groups.every(x => x.items.length <= 3 && x.count >= x.items.length), `"${q}": 200, three groups, at most 3 rows each`);
  check(!JSON.stringify(r.body).includes('@') && !/\+?\d[\d\s().-]{8,}\d/.test(JSON.stringify(r.body.groups.map(x => x.items.map(i => [i.title, i.sub])))), `"${q}": no address or phone shape`);
  if (q !== 'zzyx') check(g('companies').items.every(i => /^(partner|employer|target)-/.test(i.id) && i.open.params.open === i.id), `"${q}": every company row carries its opener`);
  else check(r.body.groups.every(x => x.count === 0), '"zzyx": nothing matches');
}
check((await search(svc, registry, { auth: { user: { id: 'v' }, isPlatformOwner: false, roles: new Map([[W.id, 'viewer']]) }, q: 'met', business: W.id })).status === 200, 'a Viewer role reads (200)');
check((await search(svc, registry, { auth: { user: { id: 'x' }, isPlatformOwner: false, roles: new Map([[OTHER.id, 'owner']]) }, q: 'met', business: W.id })).status === 403, 'a member of another workspace only is refused (403)');
console.log(`${pass}/${pass + fail} · writes: 0 · Claude 0 · Apollo 0 · restored: yes (nothing changed)`);
process.exit(fail ? 1 : 0);

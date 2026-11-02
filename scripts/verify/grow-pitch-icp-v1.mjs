// grow-pitch-icp REV2 live check - as Jack (ownerSession) on the REAL HumanKind workspace, localhost server.js (this
// build) through the real wiring and cookie auth. SCOPE (declared): 0 Claude, 0 Apollo, 0 Gmail. Reads: briefing,
// today/day, brands?view=partnerships, one brand page. Writes: ONE Move to Partnerships (segment) on the one sponsor brand
// whose research reads as media, then its Undo. Restore: that brand's segment + updated_at exactly; Activity rows are kept
// by rule; Jack's session is released (last_seen_at restored). "restored" THROWS on any mismatch. Runtime < 1 min, cap 3.
// Usage: node scripts/verify/grow-pitch-icp-v1.mjs
import { createRequire } from 'module';
import path from 'path';
import { spawn } from 'child_process';
import { ownerSession } from './lib/ownerSession.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { loadIntel } = await import('../../api/hk/intelData.js');
const { icpOf, intelFor } = await import('../../api/hk/intelScore.js');
setTimeout(() => { console.log('ABORT: over the 3 min cap'); process.exit(1); }, 180000).unref();
const PORT = 3995, BASE = `http://localhost:${PORT}`;
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const hk = (await svc.from('businesses').select('id, features').eq('name', 'HumanKind')).data.find(b => b.features?.hk_sales);
const B = hk.id, results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`); };

const d = await loadIntel(svc, B, new Date());
const target = d.brands.find(b => icpOf(b, intelFor(b, d.intelByDomain), d.settings.icp).looks_like);
const snap = target ? (await svc.from('hk_brands').select('id, segment, updated_at').eq('id', target.id).single()).data : null;
const srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
let owner, finished = false;
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 500)); } }
  owner = await ownerSession(svc);
  const api = async (method, p, body) => { const r = await fetch(`${BASE}/api/hk/${B}${p}`, { method, headers: { cookie: `prospector_at=${owner.session.access_token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { code: r.status, body: await r.json().catch(() => null) }; };
  const br = await api('GET', '/briefing');
  check('briefing 200', br.code === 200, String(br.code));
  console.log('Send these 10:'); for (const c of br.body.send) console.log(`   ${c.name} · ICP ${c.icp?.label} ${c.icp?.points} · score ${c.score} · why[0] ${c.score_parts[0]?.words}`);
  check('every Send these 10 card carries ICP as its first score part', br.body.send.every(c => c.icp && c.score_parts[0]?.key === 'icp'));
  check('no media brand in Send these 10', br.body.send.every(c => c.icp.key !== 'media'));
  const day = await api('GET', '/today/day');
  const pitches = day.body.steps.find(s => s.key === 'pitches')?.items || [];
  console.log(`Your day pitches: ${pitches.map(p => `${p.brand_name} (ICP ${p.icp?.label})`).join(' · ') || 'none'}`);
  check('Your day pitches carry ICP', pitches.every(p => p.icp));
  const part = await api('GET', '/brands?page=1&limit=1&view=partnerships&owner=all&facets=1');
  const seg = Object.fromEntries(part.body.facets.segment);
  console.log(`Partnerships view: ${part.body.total} ${JSON.stringify(seg)}`);
  check('Partnerships view lists only partnership segments', Object.keys(seg).every(k => ['press', 'podcast', 'nonprofit', 'university', 'creator'].includes(k)));
  if (!target) console.log('no sponsor brand reads as media - Move skipped');
  else {
    const page = await api('GET', `/brands/${target.id}`);
    check(`${target.name}: brand page ICP offers Move to ${page.body.icp?.looks_like}`, !!page.body.icp?.looks_like, page.body.icp?.label);
    const mv = await api('PATCH', `/brands/${target.id}`, { segment: page.body.icp.looks_like });
    check('Move to Partnerships', mv.code === 200 && mv.body.brand.segment === page.body.icp.looks_like);
    const inView = await api('GET', `/brands?page=1&limit=200&view=partnerships&owner=all&q=${encodeURIComponent(target.name)}`);
    check('moved brand is in the Partnerships view', inView.body.rows.some(r => r.id === target.id));
    const un = await api('PATCH', `/brands/${target.id}`, { segment: snap.segment });
    check('Undo puts the segment back', un.code === 200 && un.body.brand.segment === snap.segment);
  }
  finished = true;
} finally {
  if (snap) await svc.from('hk_brands').update({ segment: snap.segment, updated_at: snap.updated_at }).eq('id', snap.id);
  const rel = owner ? await owner.release() : [];
  srv.kill();
  if (snap) { const now = (await svc.from('hk_brands').select('id, segment, updated_at').eq('id', snap.id).single()).data; if (JSON.stringify(now) !== JSON.stringify(snap)) throw new Error(`restored: NO - ${JSON.stringify(now)} vs ${JSON.stringify(snap)}`); }
  console.log(`session released: ${JSON.stringify(rel)}`);
  console.log(`${finished ? '' : 'RUN DID NOT FINISH · '}${results.filter(r => r.ok).length}/${results.length} passed · restored: yes (brand row compared exactly)`);
}
process.exit(results.every(r => r.ok) ? 0 : 1);

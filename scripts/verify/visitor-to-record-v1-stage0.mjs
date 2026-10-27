// visitor-to-record-v1 REV2 Stage 0 follow-up - DECLARED: two Apollo searches on /mixed_people/api_search + two 0-credit
// balance reads (4 HTTP, hard cap at the seam), 0 credits expected, 0 writes. Prints counts, field KEYS, names/titles
// only - never an address. Reads APOLLO_API_KEY directly because api_search is off the allowlist until Stage 2.
// Usage: node scripts/verify/visitor-to-record-v1-stage0.mjs
import { createRequire } from 'module';
const require = createRequire((new URL('../../package.json', import.meta.url).pathname));
require('dotenv').config({ path: new URL('../../.env', import.meta.url).pathname });
const { createClient } = require('@supabase/supabase-js');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const KEY = process.env.APOLLO_API_KEY; if (!KEY) throw new Error('no key');
const CAP = 4; let n = 0;
const ADDR = /[^\s@<>()"',;=&#]+@[^\s@<>()"',;=&#]+\.[a-z]{2,}/gi;
const safe = v => JSON.stringify(v).replace(ADDR, '<address>');
async function apollo(method, path, body) {
  if (n >= CAP) throw new Error(`cap ${CAP}`); n++;
  const r = await fetch(`https://api.apollo.io/api/v1${path}`, { method, headers: { 'x-api-key': KEY, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text: text.slice(0, 400) };
}
const DOMAINS = ['homelover.ai', 'homelover.com'];
const personLine = p => `${[p.first_name, p.last_name].filter(Boolean).join(' ') || p.name || '?'} · ${p.title || '-'} · org ${p.organization?.name || p.organization_name || p.account?.name || '-'}`;
const visitorKeys = p => Object.keys(p).filter(k => /visit|intent|website|page/i.test(k));
const shape = p => Object.keys(p).sort().map(k => `${k}:${p[k] == null ? 'null' : Array.isArray(p[k]) ? `array(${p[k].length})` : typeof p[k] === 'object' ? `object{${Object.keys(p[k]).slice(0, 12).join(',')}}` : typeof p[k] === 'string' ? (/email|phone/i.test(k) ? (ADDR.test(p[k]) ? '<address>' : JSON.stringify(p[k]).slice(0, 40)) : 'string') : typeof p[k]}`).join(' ');
const before = (await apollo('GET', '/users/api_profile?include_credit_usage=true')).json?.num_credits_remaining;
console.log('balance before:', before);
const a = await apollo('POST', '/mixed_people/api_search', { website_visitors_from_domains: DOMAINS, website_visitors_from_past: 14, per_page: 5, page: 1 });
const pa = [...(a.json?.people || []), ...(a.json?.contacts || [])];
console.log(`(1) POST /mixed_people/api_search website_visitors_* from_past 14 per_page 5 -> HTTP ${a.status} · top keys ${Object.keys(a.json || {}).join(',')} · pagination ${safe(a.json?.pagination || null)} · people ${(a.json?.people || []).length} contacts ${(a.json?.contacts || []).length}${a.status !== 200 ? ` · ${a.text.replace(ADDR, '<address>')}` : ''}`);
if (pa.length) { console.log('   shape:', shape(pa[0])); console.log('   visitor-ish keys:', visitorKeys(pa[0]).join(',') || 'none'); for (const k of visitorKeys(pa[0])) console.log(`   ${k} =`, safe(pa[0][k]).slice(0, 400)); for (const p of pa) console.log('   -', personLine(p)); if (pa[0].organization) console.log('   organization keys:', Object.keys(pa[0].organization).sort().join(',')); }
else if (a.json) console.log('   body:', safe(a.json).slice(0, 400));
const dom = (await svc.from('partner_domains').select('domain').limit(1)).data?.[0]?.domain || null;
const b = await apollo('POST', '/mixed_people/api_search', { q_organization_domains: [dom], person_titles: ['Chief People Officer', 'VP People'], per_page: 2, page: 1 });
const pb = [...(b.json?.people || []), ...(b.json?.contacts || [])];
console.log(`(2) POST /mixed_people/api_search q_organization_domains [1 partner domain, not printed] + 2 titles per_page 2 -> HTTP ${b.status} · top keys ${Object.keys(b.json || {}).join(',')} · pagination ${safe(b.json?.pagination || null)} · people ${(b.json?.people || []).length} contacts ${(b.json?.contacts || []).length}${b.status !== 200 ? ` · ${b.text.replace(ADDR, '<address>')}` : ''}`);
if (pb.length) { console.log('   shape:', shape(pb[0])); for (const p of pb) console.log('   -', personLine(p)); if (pb[0].organization) console.log('   organization keys:', Object.keys(pb[0].organization).sort().join(',')); }
else if (b.json) console.log('   body:', safe(b.json).slice(0, 400));
const after = (await apollo('GET', '/users/api_profile?include_credit_usage=true')).json?.num_credits_remaining;
console.log(`balance after: ${after} · spent ${before - after} · HTTP calls ${n} (2 searches + 2 balance reads) · writes 0`);

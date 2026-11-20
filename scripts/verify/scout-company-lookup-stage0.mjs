// FIX scout-company-lookup Stage 0 - READ-ONLY, in process (no HTTP route, no model call). HomeLover only.
// Declared: the glossary once (~5 requests); one ILIKE read of each of sales_goals / sales_opportunities /
// sales_targets for one name (ids, name, owner only); web_visits for that name (id, name, pulled_on, matched_*);
// one paged read of names + ids of the three tables and of web_visits (90 d) to size the S1 index;
// 12 asks through parseAsk + splitAsk offline. ~25 requests, under 1 MB, ~15 s; cap 90 s.
// 0 writes (a write throws in the guard), 0 Claude, 0 Apollo. Prints company names and member first names only.
import { svc, HL, cap, footer } from './homelover-data-model-v1-lib.mjs';
cap(90);
const { createRegistry } = await import('../../api/scout/registry.js');
const { parseAsk, splitAsk, mergeVocab } = await import('../../api/scout/retrieve.js');
const sales = await import('../../api/sales/scoutEntities.js');
const { normName } = await import('../../api/sales/normName.js');
const { laDateString } = await import('../../api/sales/laDate.js');
const { addDays } = await import('../../api/sales/goalsShared.js');
const { selectAllPages } = await import('../../api/lib/selectAllPages.js');
const reg = createRegistry(); await sales.register(reg);
const mod = reg.modules[0];
const today = laDateString(new Date());
const g = await sales.glossary(svc, { businessId: HL });
const vocab = mergeVocab([mod.vocabulary, g.vocabulary]);
const first = id => (g.members.find(m => m.id === id)?.name || '').split(/\s+/)[0] || (id ? 'a former member' : 'Unassigned');
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };

const NAME = process.argv[2] || 'greyorange';
console.log(`(a) is "${NAME}" a record?`);
const like = `%${NAME.replace(/\s+/g, '%')}%`;
const [partners, employers, targets, visits] = await Promise.all([
  svc.from('sales_goals').select('id, name, owner_user_id, archived_at').eq('business_id', HL).eq('goal_type', 'partnership').ilike('name', like).then(must),
  svc.from('sales_opportunities').select('id, organization, owner_user_id, stage, archived_at').eq('business_id', HL).ilike('organization', like).then(must),
  svc.from('sales_targets').select('id, name, owner_user_id, status').eq('business_id', HL).ilike('name', like).then(must),
  svc.from('web_visits').select('id, company_name, pulled_on, last_visit, visits_7d, matched_type, matched_id').eq('business_id', HL).ilike('company_name', like).order('pulled_on', { ascending: false }).then(must),
]);
for (const p of partners) console.log(`  partner · ${p.name} · owner ${first(p.owner_user_id)}${p.archived_at ? ' · ARCHIVED' : ''}`);
for (const o of employers) console.log(`  employer · ${o.organization} · stage ${o.stage} · owner ${first(o.owner_user_id)}${o.archived_at ? ' · ARCHIVED' : ''}`);
for (const t of targets) console.log(`  target · ${t.name} · status ${t.status} · owner ${first(t.owner_user_id)}`);
if (!partners.length && !employers.length && !targets.length) console.log('  no row in sales_goals / sales_opportunities / sales_targets');
console.log(`  web_visits rows ${visits.length}${visits.length ? ` · names: ${[...new Set(visits.map(v => v.company_name))].join(' | ')} · pulled ${visits[visits.length - 1].pulled_on} … ${visits[0].pulled_on} · last visit ${String(visits[0].last_visit || '').slice(0, 10) || '—'} · matched: ${[...new Set(visits.map(v => v.matched_type || 'none'))].join(', ')}` : ''}`);

console.log('\n(a2) the S1 index, sized (names + ids only)');
const all = (t, cols, build = x => x) => selectAllPages(() => build(svc.from(t).select(cols).eq('business_id', HL)).order('id'));
const since = addDays(today, -90);
const [ag, ao, at, av] = await Promise.all([
  all('sales_goals', 'id, name', x => x.eq('goal_type', 'partnership').is('archived_at', null)),
  all('sales_opportunities', 'id, organization', x => x.is('archived_at', null)),
  all('sales_targets', 'id, name'),
  all('web_visits', 'id, company_name, pulled_on, matched_id', x => x.gte('pulled_on', since)),
]);
const visitorOnly = new Map();
for (const v of av) if (!v.matched_id && normName(v.company_name)) visitorOnly.set(normName(v.company_name), v.company_name);
const recordKeys = new Set([...ag.map(x => normName(x.name)), ...ao.map(x => normName(x.organization)), ...at.map(x => normName(x.name))]);
for (const k of recordKeys) visitorOnly.delete(k);
const words = k => k.split(' ').length;
const keys = [...recordKeys, ...visitorOnly.keys()].filter(Boolean);
console.log(`  partners ${ag.length} · employers ${ao.length} · targets ${at.length} · web_visits rows 90 d ${av.length} → visitor-only names ${visitorOnly.size}`);
console.log(`  index keys ${keys.length} · by words: ${[1, 2, 3].map(n => `${n}w ${keys.filter(k => words(k) === n).length}`).join(' · ')} · 4+w ${keys.filter(k => words(k) > 3).length} (not reachable by a 1-3 word n-gram)`);
const common = ['target', 'state', 'lead', 'people', 'visa', 'apple', 'next', 'open', 'hot', 'summit', 'pace', 'notes', 'tasks', 'owner', 'today', 'who', 'company'];
console.log(`  one-word keys that are also everyday words (checked list of ${common.length}): ${common.filter(w => keys.includes(w)).join(', ') || 'none'}`);
const short = keys.filter(k => k.length <= 2);
console.log(`  keys of 1-2 chars: ${short.length}${short.length ? ` (${short.slice(0, 12).join(', ')})` : ''}`);

console.log('\n(d) 12 asks through the parser as it is today');
const signature = a => { const ids = mod.intents.filter(x => x.match(a)).map(x => x.id); return ids.length ? `${ids.join('+')}|${a.entity || ''}` : ''; };
const visitorName = [...visitorOnly.values()][0] || 'Acme Visitor';
const ASKS = ['tell me about greyorange', 'greyorange', 'who owns greyorange', 'GreyOrange owner', "what's up with metlife", 'tell me about Cloudflare and who owns it', 'who owns the second one', "cyrus's targets", 'tell me about nothingco', 'tell me about grey orange', 'what do we know about "mission lane"', `tell me about ${visitorName.toLowerCase()}`, 'tell me about greyorange and who owns'];
for (const q of ASKS) {
  const parts = splitAsk(q, vocab, { today, signature }).parts;
  const a = parseAsk(parts[0], vocab, { today });
  const intents = mod.intents.filter(i => i.match(a)).map(i => i.id);
  console.log(`  "${q}" → parts ${parts.length} · company [${a.company.join(' | ')}] · member ${a.member?.name || '—'} · terms [${a.terms.join(' ')}] · intents ${intents.join('+') || 'NONE (default reads)'}`);
}

// Stage 1 read check: the same asks through buildContext with the name index (the route's reads, no model call).
console.log('\n(e) after the fix: buildContext, 0 Claude');
const { buildContext } = await import('../../api/scout/retrieve.js');
const { ownerLead } = await import('../../api/scout/ask.js');
const ownerId = (await svc.from('profiles').select('id').eq('is_platform_owner', true)).data[0].id;
const auth = { user: { id: ownerId, name: 'Jack' }, isPlatformOwner: true, roles: new Map([[HL, 'owner']]) };
for (const q of ['tell me about greyorange and who owns', "what's up with metlife", 'who owns metlife', 'greyorange', 'tell me about grey orange', "cyrus's targets", 'tell me about nothingco', 'who owns greyorang', `tell me about ${visitorName.toLowerCase()}`, 'show me my open tasks', 'who visited yesterday', 'what needs attention']) {
  const t = performance.now();
  const c = await buildContext(svc, reg, { auth, scope: HL, q });
  const ms = Math.round(performance.now() - t);
  if (c.cant) { console.log(`  "${q}" → CAN'T: ${c.cant.reason}${c.cant.add ? ` · [${c.cant.add.label}]` : ''}${c.cant.candidates ? ` · did you mean ${c.cant.candidates.map(x => x.title).join(', ')}` : ''} · ${ms} ms`); continue; }
  const p = c.parts[0], grid = p.brief?.grid ? Object.fromEntries(p.brief.grid.map(g => [g.label, g.value])) : null;
  console.log(`  "${q}" → parts ${c.parts.length} · company [${p.ask.company.join(' | ')}] · intent ${c.stats.intent} · reads ${c.stats.reads.length} · lines ${c.lines.length}${grid ? ` · Owner row "${grid.Owner}"` : ''}${ownerLead(c) ? ` · LEAD "${ownerLead(c).line}"${ownerLead(c).offer ? ' + assign offer' : ''}` : ''} · ${ms} ms`);
}
footer();

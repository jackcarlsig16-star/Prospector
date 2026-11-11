// scout-v3 Stage 0 - READ-ONLY, in process (no HTTP route, no model call). Declared: the glossary once (~5 requests),
// 3 table schemas (the audit_table_schema read RPC), sales_prospect_state paged (owner / status / snooze_until only,
// no name), one people-activity read (7 d) for the person-key kinds; ~60 requests, under 2 MB, ~15 s; cap 90 s.
// 0 writes (a write throws in the guard), 0 Claude, 0 Apollo. Prints counts only - no name, no address.
import { svc, HL, cap, footer } from './homelover-data-model-v1-lib.mjs';
cap(90);
const { createRegistry } = await import('../../api/scout/registry.js');
const { parseAsk, mergeVocab } = await import('../../api/scout/retrieve.js');
const sales = await import('../../api/sales/scoutEntities.js');
const { salesReads } = await import('../../api/sales/scoutIntents.js');
const { laDateString } = await import('../../api/sales/laDate.js');
const reg = createRegistry(); await sales.register(reg);
const mod = reg.modules[0];
const today = laDateString(new Date());
const g = await sales.glossary(svc, { businessId: HL });
const vocab = mergeVocab([mod.vocabulary, g.vocabulary]);

console.log('(b) schemas');
for (const t of ['sales_prospect_state', 'sales_week_goals', 'sales_flow_events']) {
  const s = await svc.rpc('audit_table_schema', { target_table: t });
  const cols = (s.data?.columns || s.data || []).map(c => c.column_name || c.name).filter(Boolean);
  console.log(`  ${t}: ${cols.length} columns · snooze-like: ${cols.filter(c => /snooz/.test(c)).join(', ') || 'none'} · owner-like: ${cols.filter(c => /owner/.test(c)).join(', ') || 'none'} · origin/source-like: ${cols.filter(c => /origin|source/.test(c)).join(', ') || 'none'}`);
}
const rows = []; for (let from = 0; ; from += 1000) { const r = await svc.from('sales_prospect_state').select('owner, status, snooze_until, opportunity_id, goal_id').eq('business_id', HL).order('contact_id').range(from, from + 999); if (r.error) throw new Error(r.error.message); rows.push(...r.data); if (r.data.length < 1000) break; }
const tally = k => Object.entries(rows.reduce((m, r) => (m[r[k] ?? 'null'] = (m[r[k] ?? 'null'] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v} ${n}`).join(' · ');
const ownerLabel = Object.entries(rows.reduce((m, r) => { const k = r.owner === 'unassigned' || r.owner == null ? 'unassigned' : 'a named member'; m[k] = (m[k] || 0) + 1; return m; }, {})).map(([k, n]) => `${k} ${n}`).join(' · ');
console.log(`  sales_prospect_state rows ${rows.length} · status: ${tally('status')}`);
console.log(`  snooze_until set ${rows.filter(r => r.snooze_until).length} (in the future ${rows.filter(r => r.snooze_until && r.snooze_until > today).length}) · owner enum: ${ownerLabel} · distinct owner values ${new Set(rows.map(r => r.owner)).size}`);
console.log(`  linked to an employer ${rows.filter(r => r.opportunity_id).length} · to a partner ${rows.filter(r => r.goal_id).length} · to neither ${rows.filter(r => !r.opportunity_id && !r.goal_id).length}`);
const pa = await salesReads.peopleActivity(svc, HL, { window: '7' });
const people = pa.body?.people || pa.body?.rows || [];
const kind = k => String(k || '').split(':')[0];
const byKind = people.reduce((m, p) => { const k = kind(p.key || p.person_key); m[k] = m[k] || { n: 0, withCompany: 0 }; m[k].n += 1; if (p.company?.id) m[k].withCompany += 1; return m; }, {});
console.log(`  people rows (7 d read) ${people.length}: ${Object.entries(byKind).map(([k, v]) => `${k} ${v.n} (company record ${v.withCompany}, none ${v.n - v.withCompany})`).join(' · ')}`);

const ASKS = [
  'pull me 5 most important prospects who are visiting and hot and show 5 most important tasks',
  "who are our hottest prospects at Cloudflare and what's due this week",
  'show me hot targets and also my open tasks',
  'who visited yesterday; what needs attention',
  '1. top companies by score 2. people who opened our emails 3. tasks due this week',
  'list our clients then show the referral funnel',
  "what's our email to site rate and who replied this week",
  'pull the intel on Northrop Grumman and show my tasks for them',
  'which partners did we touch last week and which targets are hot',
  'hottest people on the site this week and the companies they work for',
];
// THIS SCRIPT's splitter (the app has none): D2's separators only - "and show", "and also", "then", ";", "1. 2.".
const split = q => { const n = q.split(/\s*\b\d\.\s+/).filter(Boolean); if (n.length > 1) return n; return q.split(/\s*;\s*|\s+and also\s+|\s+and show\s+|\s+then\s+/).filter(Boolean); };
const show = q => { const a = parseAsk(q, vocab, { today }); const intents = mod.intents.filter(i => i.match(a)).map(i => i.id); const flags = Object.entries(a.flags).filter(([, v]) => v).map(([k]) => k); return { a, line: `entity ${a.entity || '-'} · band ${a.band || '-'}${a.bandKind ? ` (${a.bandKind})` : ''} · sort ${a.sort || '-'} · since ${a.since_kind || '-'} · mine ${a.mine} · company [${a.company.join(' | ')}] · flags [${flags.join(', ')}] · terms [${a.terms.join(', ')}] -> intents ${intents.join(' + ') || 'none (search + standing)'}`, intents }; };
console.log('\n(c) parseAsk today (one parse per ask; the app has no splitter) and, below each, the same parser on the parts a D2 separator split would hand it');
ASKS.forEach((q, i) => {
  const whole = show(q);
  console.log(`\n${i + 1}. "${q}"\n   TODAY  parts 1 · ${whole.line}`);
  const parts = split(q);
  console.log(`   D2 separators would find ${parts.length} part${parts.length === 1 ? '' : 's'}`);
  if (parts.length > 1) parts.forEach((p, j) => console.log(`     part ${j + 1} "${p}" · ${show(p).line}`));
});
// the word filter on the to-do part (scoutIntents.js:81), counted on the real open list - text never printed
const t = await salesReads.openTodosFor(svc, HL, null, { cap: 60 });
const terms = parseAsk('show 5 most important tasks', vocab, { today }).terms;
const kept = t.rows.filter(r => !terms.length || terms.some(w => String(r.text || '').toLowerCase().includes(w)));
console.log(`\nword filter on the part "show 5 most important tasks": terms [${terms.join(', ')}] · open ${t.total} · read ${t.rows.length} · kept ${kept.length}`);
footer();

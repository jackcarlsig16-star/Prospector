// intent-score-v1 Stage 0 - READ-ONLY (0 writes, 0 model, 0 Apollo). For every live HomeLover company (partner / employer /
// target) gather the S1 raw inputs and apply the PROPOSED weights offline with the planner's rulings: unresearched = 0
// research points and -3; research older than 60 d = unresearched; closed-won (launched / live / contract) and pilot
// (proposal_pilot) are FLAGGED OUT of the ranking; lost / paused / rejected = closed (score forced <= 10). Prints counts,
// distributions and NAMES ONLY (never a person, address or phone). Usage: node scripts/verify/intent-score-v1-stage0.mjs
import { createRequire } from 'module';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { selectAllPages } = await import('../../api/lib/selectAllPages.js');
const { normName } = await import('../../api/sales/intakeMatch.js');
const { scoreProspect } = await import('../../api/sales/heatScore.js');
const { laDateString } = await import('../../api/sales/laDate.js');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = (await svc.from('businesses').select('id').ilike('name', '%homelover%')).data[0].id;
const NOW = Date.now(), TODAY = laDateString(new Date(NOW)), DAY = 864e5;
const all = (t, cols, build = x => x) => selectAllPages(() => build(svc.from(t).select(cols).eq('business_id', HL)).order('id'));
const [partners, opps, targets, visits, skip, research, people, settings, prospects, messages, events, partnerEvents] = await Promise.all([
  all('sales_goals', 'id, name, pipeline_status, owner_team, co_owner_name, source_kind, source_partner_id, employees, last_touch_at, category, archived_at, updated_at', x => x.eq('goal_type', 'partnership')),
  all('sales_opportunities', 'id, organization, stage, owner_team, co_owner_name, source_kind, source_partner_id, employees, archived_at, updated_at'),
  all('sales_targets', 'id, name, kind, status, owner_team, co_owner_name, source_kind, source_partner_id, employees, visit_id, updated_at'),
  all('web_visits', 'company_key, company_name, matched_type, matched_id, priority, visits_7d, unique_visitors_7d, apollo_intent, intent_score, top_paths, maybe_user, us_500, last_visit, pulled_on'),
  all('sales_visit_skip', 'company_key'),
  all('research_runs', 'entity_type, entity_id, status, result, created_at', x => x.eq('status', 'done')),
  all('sales_people', 'title, source_kind, opportunity_id, target_id, archived_at', x => x.eq('source_kind', 'web_visit').is('archived_at', null)),
  svc.from('sales_settings').select('buyer_titles').eq('business_id', HL).maybeSingle().then(r => r.data),
  selectAllPages(() => svc.from('sales_prospect_state').select('contact_id, company, opportunity_id, goal_id').eq('business_id', HL).order('contact_id')),
  selectAllPages(() => svc.from('sales_email_messages').select('contact_id, apollo_message_id, delivered_at, replied, reply_class, num_opens, num_clicks, last_opened_at, last_clicked_at').eq('business_id', HL).order('apollo_message_id')),
  selectAllPages(() => svc.from('sales_email_activity').select('contact_id, apollo_message_id, event, occurred_at, user_agent, tracking_service').eq('business_id', HL).order('id')),
  selectAllPages(() => svc.from('sales_partner_events').select('goal_id, at').eq('business_id', HL).order('id')),
]);
const buyer = settings?.buyer_titles || [];
const isBuyer = t => { const x = String(t || '').toLowerCase(); return !!x && buyer.some(b => x.includes(b.toLowerCase()) || b.toLowerCase().includes(x)); };
const upsideNames = new Set(partners.filter(p => /upside/i.test(p.name)).map(p => p.id));
const daysAgo = iso => (iso ? (NOW - Date.parse(iso)) / DAY : Infinity);

// latest visit row per company_key; join by matched record first, then by name
const latest = new Map();
for (const v of [...visits].sort((a, b) => a.pulled_on.localeCompare(b.pulled_on))) latest.set(v.company_key, v);
const visitByRecord = new Map();
for (const v of latest.values()) if (v.matched_type && v.matched_id) visitByRecord.set(`${v.matched_type}:${v.matched_id}`, v);
const skipKeys = new Set(skip.map(s => s.company_key));
const researchBy = new Map();
for (const r of [...research].sort((a, b) => a.created_at.localeCompare(b.created_at))) researchBy.set(`${r.entity_type}:${r.entity_id}`, r);
const peopleBy = new Map();
for (const p of people) { const k = p.opportunity_id ? `opportunity:${p.opportunity_id}` : `target:${p.target_id}`; if (!peopleBy.has(k)) peopleBy.set(k, []); peopleBy.get(k).push(p); }
// heat per prospect -> max per company (by opportunity_id / goal_id, else by company name)
const msgsBy = new Map(), evsBy = new Map();
for (const m of messages) { if (!msgsBy.has(m.contact_id)) msgsBy.set(m.contact_id, []); msgsBy.get(m.contact_id).push(m); }
for (const e of events) { if (!evsBy.has(e.contact_id)) evsBy.set(e.contact_id, []); evsBy.get(e.contact_id).push(e); }
const heatBy = new Map();
const heatPush = (k, h) => { const prev = heatBy.get(k); if (!prev || h.score > prev.score) heatBy.set(k, h); };
for (const p of prospects) {
  const s = scoreProspect(msgsBy.get(p.contact_id) || [], evsBy.get(p.contact_id) || []);
  const h = { score: s.score ?? s.total ?? 0, replied: (msgsBy.get(p.contact_id) || []).some(m => m.replied), opens: (msgsBy.get(p.contact_id) || []).reduce((n, m) => n + (m.num_opens || 0), 0), clicks: (msgsBy.get(p.contact_id) || []).reduce((n, m) => n + (m.num_clicks || 0), 0) };
  if (p.opportunity_id) heatPush(`opportunity:${p.opportunity_id}`, h);
  if (p.goal_id) heatPush(`partner:${p.goal_id}`, h);
  if (p.company) heatPush(`name:${normName(p.company)}`, h);
}
const lastPartnerTouch = new Map();
for (const e of partnerEvents) { const prev = lastPartnerTouch.get(e.goal_id); if (!prev || e.at > prev) lastPartnerTouch.set(e.goal_id, e.at); }

const CLOSED_WON = new Set(['launched', 'live', 'contract', 'verbal']), PILOT = new Set(['proposal_pilot']), CLOSED = new Set(['lost', 'paused', 'rejected', 'on_hold']);
const STAGE_PTS = { contacted: 2, first_email_sent: 2, in_sequence: 2, responded: 4, replied: 4, meeting: 8, meeting_set: 8 };
const PAGE_HOT = /\/(pricing|employer|partner|product|benefits|for-)/i, PAGE_USER = /^\/(auth|help|privacy|terms)(\/|$)/i;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const lg = (n, max) => Math.log(1 + Math.max(0, n)) / Math.log(1 + max);

function score(c) {
  const comp = {};
  const v = visitByRecord.get(c.key) || latest.get(normName(c.name)) || null;
  const vAge = v ? daysAgo(v.last_visit ? `${v.last_visit}T12:00:00Z` : `${v.pulled_on}T12:00:00Z`) : Infinity;
  comp.visits = v && vAge <= 14 ? Math.round(14 * lg(v.visits_7d || 0, 20) + 6 * lg(v.unique_visitors_7d || 0, 5)) : 0;
  const paths = (v?.top_paths || []).map(p => p.path);
  comp.pages = !v || v.maybe_user || (paths.length && paths.every(p => PAGE_USER.test(p))) ? 0 : paths.some(p => PAGE_HOT.test(p)) ? 8 : paths.some(p => p && p !== '/') ? 4 : paths.length ? 2 : 0;
  comp.apollo_intent = v ? (v.intent_score != null ? clamp(Math.round(v.intent_score / 10), 0, 10) : { high: 10, medium: 6, low: 2 }[String(v.apollo_intent || '').toLowerCase()] || 0) : 0;
  const ppl = peopleBy.get(c.key) || [];
  comp.people = clamp(ppl.reduce((n, p) => n + (isBuyer(p.title) ? 6 : 2), 0), 0, 12);
  const emp = c.employees ?? null;
  comp.fit = skipKeys.has(normName(c.name)) ? 0 : (v?.us_500 || (emp != null && emp >= 500)) ? 15 : emp != null && emp >= 200 ? 8 : c.type === 'partner' ? (c.category ? 10 : 5) : 0;
  const r = researchBy.get(c.key);
  const fresh = r && daysAgo(r.created_at) <= 60;
  if (!fresh) comp.research = -3;
  else {
    const x = r.result || {};
    let pts = (x.why_homelover ? 4 : 0) + (x.first_angle ? 3 : 0) + (x.titles ? 3 : 0);
    if (x.housing_perk && !/no housing perk found/i.test(x.housing_perk)) pts -= 10;
    if (/acqui|wrong audience|not .*audience|sells to (consumers|individuals)/i.test(x.watch_outs || '')) pts -= 5;
    comp.research = clamp(pts, -10, 10);
  }
  const heat = heatBy.get(c.key) || heatBy.get(`name:${normName(c.name)}`) || null;
  const sk = c.source_kind || 'unknown';
  const viaUpside = sk === 'partner_referral' && (upsideNames.has(c.source_partner_id) || ['upside', 'both'].includes(c.owner_team));
  comp.source = viaUpside ? 15 : { partner_referral: 12, person_referral: 10, campaign: heat?.replied ? 10 : 4, website: 6, inbound: 12, homelover_outreach: 3, scout: 4, event: 4 }[sk] || 0;
  comp.engagement = heat ? clamp(Math.round(heat.replied ? 10 : heat.clicks ? 6 : heat.opens ? 3 : 0), 0, 10) : 0;
  const st = c.stage;
  const closedWon = CLOSED_WON.has(st), pilot = PILOT.has(st), closed = CLOSED.has(st);
  comp.stage = closed ? 0 : STAGE_PTS[st] || 0;
  const lastTouch = Math.min(daysAgo(c.last_touch_at), vAge);
  comp.recency = lastTouch <= 30 ? 0 : lastTouch <= 60 ? -5 : -10;
  let total = clamp(Object.values(comp).reduce((a, b) => a + b, 0), 0, 100);
  if (closed) total = Math.min(total, 10);
  const band = total >= 70 ? 'P1' : total >= 45 ? 'P2' : total >= 20 ? 'P3' : 'P4';
  return { ...c, comp, total, band, closed, flaggedOut: closedWon || pilot, hasVisit: !!v, heat, sourceLabel: viaUpside ? 'upside' : sk };
}
const companies = [
  ...partners.filter(p => !p.archived_at).map(p => ({ key: `partner:${p.id}`, type: 'partner', name: p.name, stage: p.pipeline_status, owner_team: p.owner_team, source_kind: p.source_kind, source_partner_id: p.source_partner_id, employees: p.employees, category: p.category, last_touch_at: p.last_touch_at || lastPartnerTouch.get(p.id) || null })),
  ...opps.filter(o => !o.archived_at).map(o => ({ key: `opportunity:${o.id}`, type: 'employer', name: o.organization, stage: o.stage, owner_team: o.owner_team, source_kind: o.source_kind, source_partner_id: o.source_partner_id, employees: o.employees, last_touch_at: o.updated_at })),
  ...targets.filter(t => t.status !== 'rejected').map(t => ({ key: `target:${t.id}`, type: 'target', name: t.name, stage: t.status, owner_team: t.owner_team, source_kind: t.source_kind, source_partner_id: t.source_partner_id, employees: t.employees, last_touch_at: t.updated_at })),
].map(score);
const ranked = companies.filter(c => !c.flaggedOut).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
const tally = (arr, f) => arr.reduce((o, x) => { const k = f(x); o[k] = (o[k] || 0) + 1; return o; }, {});
const fmt = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ');
const top3 = c => Object.entries(c.comp).filter(([, n]) => n !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3).map(([k, n]) => `${k} ${n > 0 ? '+' : ''}${n}`).join(', ');
const todayVisits = [...latest.values()].filter(v => v.pulled_on === TODAY);
const bucket = (vals, edges) => edges.map((e, i) => `${i ? edges[i - 1] : '-inf'}..${e}: ${vals.filter(x => (i ? x > edges[i - 1] : true) && x <= e).length}`).join(' · ');

console.log(`intent-score-v1 Stage 0 · HomeLover · ${TODAY} · companies ${companies.length} (partners ${partners.filter(p => !p.archived_at).length}, employers ${opps.filter(o => !o.archived_at).length}, targets ${targets.filter(t => t.status !== 'rejected').length}) · flagged out (closed-won / pilot) ${companies.filter(c => c.flaggedOut).length} · closed (lost/paused) ${companies.filter(c => c.closed).length} · ranked ${ranked.length}`);
console.log(`bands (proposed thresholds 70/45/20): ${fmt(tally(ranked, c => c.band))}   vs today's visitor P (web_visits pulled_on ${TODAY}, ${todayVisits.length} companies): ${fmt(tally(todayVisits, v => v.priority))}`);
console.log(`visitor rows today with a matching record: ${todayVisits.filter(v => v.matched_type).length}; companies with any visit row in 14 d: ${companies.filter(c => c.hasVisit).length}`);
console.log('TOP 10:');  for (const c of ranked.slice(0, 10)) console.log(`  ${String(c.total).padStart(3)} ${c.band} ${c.type.padEnd(8)} ${c.name} - ${top3(c)}`);
console.log('BOTTOM 10:'); for (const c of ranked.slice(-10)) console.log(`  ${String(c.total).padStart(3)} ${c.band} ${c.type.padEnd(8)} ${c.name} - ${top3(c) || 'nothing'}`);
console.log('component distributions (ranked companies):');
for (const k of ['visits', 'pages', 'apollo_intent', 'people', 'fit', 'research', 'source', 'engagement', 'stage', 'recency']) { const vals = ranked.map(c => c.comp[k]); console.log(`  ${k.padEnd(13)} non-zero ${vals.filter(x => x !== 0).length}/${vals.length} · ${fmt(tally(vals, x => String(x)))}`); }
const withR = companies.filter(c => researchBy.has(c.key)), freshR = withR.filter(c => daysAgo(researchBy.get(c.key).created_at) <= 60);
console.log(`research coverage: ${withR.length}/${companies.length} researched (fresh <= 60 d: ${freshR.length}; decayed: ${withR.length - freshR.length}) · housing perk exists: ${withR.filter(c => { const h = researchBy.get(c.key).result?.housing_perk; return h && !/no housing perk found/i.test(h); }).length} · why_homelover present: ${withR.filter(c => researchBy.get(c.key).result?.why_homelover).length}`);
console.log(`sources (source_kind): ${fmt(tally(companies, c => c.source_kind || 'unknown'))} · via Upside/Brad: ${companies.filter(c => c.sourceLabel === 'upside').length} · owner_team upside/both: ${companies.filter(c => ['upside', 'both'].includes(c.owner_team)).length}`);
console.log(`employees bands: ${fmt(tally(companies, c => (c.employees == null ? 'unknown' : c.employees >= 500 ? '500+' : c.employees >= 200 ? '200-499' : '<200')))} · us_500 visitor flag on a record: ${companies.filter(c => (visitByRecord.get(c.key) || latest.get(normName(c.name)))?.us_500).length}`);
console.log(`stages: employers ${fmt(tally(opps.filter(o => !o.archived_at), o => o.stage))} | partners ${fmt(tally(partners.filter(p => !p.archived_at), p => p.pipeline_status))} | targets ${fmt(tally(targets, t => t.status))}`);
console.log(`heat: prospects ${prospects.length}, companies with any heat ${companies.filter(c => c.heat).length} (replied ${companies.filter(c => c.heat?.replied).length}, clicks only ${companies.filter(c => c.heat && !c.heat.replied && c.heat.clicks).length}, opens only ${companies.filter(c => c.heat && !c.heat.replied && !c.heat.clicks && c.heat.opens).length})`);
console.log(`visitor inputs by today's P: ${['P1', 'P2', 'P3', 'P4'].map(p => { const rows = todayVisits.filter(v => v.priority === p); const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; }; return `${p} n=${rows.length} visits_7d med ${med(rows.map(r => r.visits_7d || 0))} max ${Math.max(0, ...rows.map(r => r.visits_7d || 0))} · uniques med ${med(rows.map(r => r.unique_visitors_7d || 0))} · intent ${fmt(tally(rows, r => r.apollo_intent || 'none'))}`; }).join(' | ')}`);
console.log(`people identified (sales_people web_visit): ${people.length} on ${peopleBy.size} companies · buyer titles ${people.filter(p => isBuyer(p.title)).length}`);
console.log(`score distribution (ranked): ${bucket(ranked.map(c => c.total), [10, 20, 30, 45, 60, 70, 85, 100])}`);
console.log('writes: 0 · model calls: 0 · Apollo calls: 0');

// brad-attribution-v1 Stage 0 - READ-ONLY on HomeLover (service key, counts + company names only; no address, no
// person's name printed). For each funnel stage (F1): which table / column dates it today and how many companies carry
// one, by source kind; the real reply_class / touch_type / event values; referred companies with a later stage; stages
// with NO dated source (F3 yes / no). 0 Apollo, 0 Claude, 0 writes. Report: .screenshots/brad-attribution-v1/stage0-report.json
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { selectAllPages } = await import('../../api/lib/selectAllPages.js');
const { normName } = await import('../../api/sales/intakeMatch.js');
const OUT = path.join(ROOT, '.screenshots', 'brad-attribution-v1'); fs.mkdirSync(OUT, { recursive: true });
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = (await svc.from('businesses').select('id').ilike('name', '%homelover%')).data[0].id;
const all = (t, cols, build = x => x) => selectAllPages(() => build(svc.from(t).select(cols).eq('business_id', HL)).order('id'));
const keysOf = async t => { const r = await svc.from(t).select('*').eq('business_id', HL).limit(1); return r.error ? `ERR ${r.error.message}` : Object.keys(r.data?.[0] || {}); };
const YELLOW_P = new Set(['meeting_set', 'proposal_pilot']), GREEN_P = new Set(['live']), LOST_P = new Set(['paused']);
const YELLOW_E = new Set(['meeting', 'proposal_pilot']), GREEN_E = new Set(['verbal', 'contract', 'launched']), LOST_E = new Set(['lost', 'nurture', 'on_hold']);
const day = v => (v ? String(v).slice(0, 10) : null);
const minDay = (...vs) => vs.filter(Boolean).sort()[0] || null;
const tally = (rows, f) => rows.reduce((o, r) => { const k = f(r) ?? 'null'; o[k] = (o[k] || 0) + 1; return o; }, {});

const [partners, opps, targets, visits, srcEvents, prospects, msgs, pEvents, oEventsRaw, todos, signals] = await Promise.all([
  all('sales_goals', 'id, name, pipeline_status, source_kind, source_set_at, source_person, co_owner_name, created_at, last_touch_at', x => x.eq('goal_type', 'partnership').is('archived_at', null)),
  all('sales_opportunities', 'id, organization, stage, source_kind, source_set_at, source_person, co_owner_name, created_at'),
  all('sales_targets', 'id, name, status, source_kind, source_set_at, source_person, co_owner_name, created_at, decided_at', x => x.neq('status', 'rejected')),
  all('web_visits', 'id, company_key, company_name, matched_type, matched_id, seen_from, pulled_on'),
  all('sales_source_events', 'record_type, record_id, reason, at'),
  selectAllPages(() => svc.from('sales_prospect_state').select('contact_id, opportunity_id, goal_id').eq('business_id', HL).order('contact_id')),
  selectAllPages(() => svc.from('sales_email_messages').select('contact_id, replied, replied_at, delivered_at, reply_class').eq('business_id', HL).order('apollo_message_id')),
  all('sales_partner_events', 'goal_id, event, from_status, to_status, touch_type, at'),
  selectAllPages(() => svc.from('sales_opportunity_events').select('*').eq('business_id', HL).order('id')),
  all('sales_week_goals', 'link_type, link_id, text, completed_at', x => x.eq('kind', 'todo').eq('status', 'done')),
  all('sales_signals', 'source, kind, status, decided_at, target_id, company_key'),
]);
const oeKeys = Object.keys(oEventsRaw[0] || {});
const toStageKey = oeKeys.find(k => /^(to_stage|new_stage|stage_to|to)$/.test(k)) || oeKeys.find(k => /to_?stage/.test(k)) || null;
const atKey = oeKeys.includes('changed_at') ? 'changed_at' : oeKeys.includes('at') ? 'at' : 'created_at';
const oEvents = oEventsRaw.filter(e => e.event_type === 'stage_change');

// company records in one shape
const recs = [
  ...partners.map(p => ({ key: `partner:${p.id}`, type: 'partner', id: p.id, name: p.name, stage: p.pipeline_status, source_kind: p.source_kind, source_set_at: p.source_set_at, source_person: p.source_person, co_owner_name: p.co_owner_name, created_at: p.created_at })),
  ...opps.map(o => ({ key: `opportunity:${o.id}`, type: 'opportunity', id: o.id, name: o.organization, stage: o.stage, source_kind: o.source_kind, source_set_at: o.source_set_at, source_person: o.source_person, co_owner_name: o.co_owner_name, created_at: o.created_at })),
  ...targets.map(t => ({ key: `target:${t.id}`, type: 'target', id: t.id, name: t.name, stage: t.status, source_kind: t.source_kind, source_set_at: t.source_set_at, source_person: t.source_person, co_owner_name: t.co_owner_name, created_at: t.created_at, decided_at: t.decided_at })),
];
const createEvt = new Set(srcEvents.filter(e => e.reason === 'create').map(e => `${e.record_type}:${e.record_id}`));
const byNorm = new Map(); for (const r of recs) { const k = normName(r.name); if (k && !byNorm.has(k)) byNorm.set(k, r.key); }
const contactCompany = new Map(); for (const p of prospects) { if (p.opportunity_id) contactCompany.set(p.contact_id, `opportunity:${p.opportunity_id}`); else if (p.goal_id) contactCompany.set(p.contact_id, `partner:${p.goal_id}`); }
const NEG = new Set(['not_interested', 'unsubscribe', 'out_of_office', 'wrong_person', 'no_longer_at_company', 'bounce']);

const stage = new Map(recs.map(r => [r.key, { referred: null, visited: null, replied: null, meeting: null, pilot: null, lost: null, src: {} }]));
const set = (key, s, d, src) => { const row = stage.get(key); if (!row || !d) return; if (!row[s] || d < row[s]) { row[s] = d; row.src[s] = src; } };
for (const r of recs) {
  if (['partner_referral', 'person_referral'].includes(r.source_kind) && r.source_set_at) set(r.key, 'referred', day(r.source_set_at), 'source_set_at');
  else if (r.source_kind && createEvt.has(`${r.type === 'opportunity' ? 'employer' : r.type}:${r.id}`) || (r.source_kind && createEvt.has(r.key))) set(r.key, 'referred', day(r.created_at), 'created_at+source_event create');
}
for (const v of visits) {
  const key = v.matched_type && v.matched_id ? `${v.matched_type}:${v.matched_id}` : byNorm.get(normName(v.company_name));
  if (key) set(key, 'visited', day(v.seen_from || v.pulled_on), v.matched_id ? 'web_visits.seen_from (matched_id)' : 'web_visits.seen_from (normName)');
}
for (const m of msgs) { if (!m.replied || NEG.has(m.reply_class)) continue; const key = contactCompany.get(m.contact_id); if (key) set(key, 'replied', day(m.replied_at || m.delivered_at), 'sales_email_messages.replied_at'); }
for (const e of pEvents) {
  const key = `partner:${e.goal_id}`;
  if (e.event === 'status' && e.to_status === 'replied') set(key, 'replied', day(e.at), 'partner_events status->replied');
  if (e.event === 'status' && YELLOW_P.has(e.to_status)) set(key, 'meeting', day(e.at), `partner_events status->${e.to_status}`);
  if (e.event === 'status' && GREEN_P.has(e.to_status)) set(key, 'pilot', day(e.at), `partner_events status->${e.to_status}`);
  if (e.event === 'status' && LOST_P.has(e.to_status)) set(key, 'lost', day(e.at), `partner_events status->${e.to_status}`);
  if (e.event === 'touch' && e.touch_type === 'meeting') set(key, 'meeting', day(e.at), 'partner_events touch meeting');
}
for (const e of oEvents) {
  const key = `opportunity:${e.opportunity_id}`, to = toStageKey ? e[toStageKey] : null, at = day(e[atKey]);
  if (YELLOW_E.has(to)) set(key, 'meeting', at, `opportunity_events ${toStageKey}->${to}`);
  if (GREEN_E.has(to)) set(key, 'pilot', at, `opportunity_events ${toStageKey}->${to}`);
  if (LOST_E.has(to)) set(key, 'lost', at, `opportunity_events ${toStageKey}->${to}`);
}
for (const t of todos) { if (/meeting/i.test(t.text || '') && t.link_type && t.link_id) set(`${t.link_type === 'opportunity' ? 'opportunity' : t.link_type}:${t.link_id}`, 'meeting', day(t.completed_at), 'done to-do "meeting"'); }
for (const t of targets) if (t.status === 'rejected' && t.decided_at) set(`target:${t.id}`, 'lost', day(t.decided_at), 'targets.decided_at');

// undated: at a yellow / green / lost stage today with no dated row reaching it
const undated = { meeting: [], pilot: [], lost: [] };
for (const r of recs) {
  const s = stage.get(r.key);
  const yellow = r.type === 'partner' ? YELLOW_P.has(r.stage) : r.type === 'opportunity' ? YELLOW_E.has(r.stage) : false;
  const green = r.type === 'partner' ? GREEN_P.has(r.stage) : r.type === 'opportunity' ? GREEN_E.has(r.stage) : false;
  const lost = r.type === 'partner' ? LOST_P.has(r.stage) : r.type === 'opportunity' ? LOST_E.has(r.stage) : false;
  if ((yellow || green) && !s.meeting && !s.pilot) undated.meeting.push(`${r.name} (${r.type} ${r.stage})`);
  if (green && !s.pilot) undated.pilot.push(`${r.name} (${r.type} ${r.stage})`);
  if (lost && !s.lost) undated.lost.push(`${r.name} (${r.type} ${r.stage})`);
}
const bySrc = (s) => tally(recs.filter(r => stage.get(r.key)[s]), r => r.source_kind || 'none');
const referred = recs.filter(r => stage.get(r.key).referred);
const laterOf = r => ['visited', 'replied', 'meeting', 'pilot'].filter(k => stage.get(r.key)[k]);
const referredWithLater = referred.filter(r => laterOf(r).length);
const report = {
  tables: { opportunity_events_keys: oeKeys, to_stage_key: toStageKey, at_key: atKey, email_message_keys: Object.keys(msgs[0] || {}) },
  values: { reply_class: tally(msgs.filter(m => m.replied), m => m.reply_class), touch_type: tally(pEvents.filter(e => e.event === 'touch'), e => e.touch_type), partner_event: tally(pEvents, e => e.event), partner_to_status: tally(pEvents.filter(e => e.event === 'status'), e => e.to_status), opportunity_event_type: tally(oEventsRaw, e => e.event_type), opportunity_to_stage: tally(oEvents, e => (toStageKey ? e[toStageKey] : 'n/a')), signal_source: tally(signals, s => s.source), signal_status: tally(signals, s => s.status), source_event_reason: tally(srcEvents, e => e.reason) },
  records: { partners: partners.length, employers: opps.length, targets: targets.length, by_source_kind: tally(recs, r => r.source_kind || 'none') },
  stages: Object.fromEntries(['referred', 'visited', 'replied', 'meeting', 'pilot', 'lost'].map(s => [s, { companies: recs.filter(r => stage.get(r.key)[s]).length, by_source_kind: bySrc(s), dated_by: tally(recs.filter(r => stage.get(r.key)[s]), r => stage.get(r.key).src[s]) }])),
  referred: { total: referred.length, with_a_later_stage: referredWithLater.length, by_later_stage: tally(referredWithLater.flatMap(r => laterOf(r).map(k => ({ k }))), x => x.k), examples_visited: referred.filter(r => stage.get(r.key).visited).slice(0, 3).map(r => `${r.name}: referred ${stage.get(r.key).referred} -> visited ${stage.get(r.key).visited}`), named_referrals: referred.filter(r => r.source_person || r.co_owner_name).length },
  undated: { meeting: undated.meeting.length, pilot: undated.pilot.length, lost: undated.lost.length, meeting_examples: undated.meeting.slice(0, 5), pilot_examples: undated.pilot.slice(0, 5) },
  f3: undated.meeting.length + undated.pilot.length > 0 ? `YES - ${undated.meeting.length} companies sit at Meeting+ and ${undated.pilot.length} at Pilot/Live with no dated row reaching the stage` : 'NO - every current Meeting / Pilot stage has a dated row',
};
fs.writeFileSync(path.join(OUT, 'stage0-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));

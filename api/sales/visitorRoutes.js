import { getSupabase, findRow } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { laDateString } from './laDate.js';
import { apolloRequest } from './apolloClient.js';
import { loadDupeContext, findDupes } from './partnerDupeCheck.js';
import { insertCompanyRecord } from './companyPanel.js';
import { loadOverrides, effectiveVisit } from './visitPriority.js';
import { normName } from './intakeMatch.js';
import { cleanText } from './scrubText.js';
import { autoCreatePlan, autoSignalPatch } from './visitorRecords.js';
import { peopleSearchRequest, mapPeople, parseVisitedPeopleCsv, capLeft } from './peopleFind.js';
import { unionRows, searchPeople, TIES } from './peopleUnion.js';

// visitor-to-record-v1 REV2 Stage 2 - the runner behind the pure modules: V1 inside the visitor pull (and on demand
// from Signals), V2a the Visited People export, V2b the domain-scoped people search, V3 the People search. Reads and
// writes go through the service client; nothing here returns an address (sales_people never holds one; partner_contacts'
// email is read only to answer has_email).
const err = (status, error) => Object.assign(new Error(error), { status });
const must = r => { if (r.error) throw err(500, r.error.message); return r.data; };
const reply = (status, body) => ({ status, body });
const send = (res, r) => res.status(r.status).json(r.body);
const slash = d => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const RANK = { partner: 0, opportunity: 1, target: 2 };
const ADDRESS = /[^\s@<>()"',;=&#]+@[^\s@<>()"',;=&#]+\.[a-z]{2,}/i;
const SIGNAL_COLS = 'id, source, signal_week, company_name, company_key, kind, kind_guessed, who, signal, why_now, first_line, score, upside_joint, match, status, dismissed_until, target_id, todo_id, created_at, decided_by, decided_at, auto';
export const SETTINGS_DEFAULTS = { buyer_titles: [], visitor_domains: null, visitor_filters: null, auto_create_daily_cap: 25, people_search_daily_cap: 25, people_per_company: 3 };
export const CSV_MAX_CHARS = 2_000_000;
export const CSV_MAX_PEOPLE = 500;

export async function salesSettings(supabase, businessId) {
  const { data, error } = await supabase.from('sales_settings').select('*').eq('business_id', businessId).maybeSingle();
  if (error) throw err(500, error.message);
  return { ...SETTINGS_DEFAULTS, ...(data || {}) };
}

// The record a company resolves to (V0): a live exact name / confirmed-domain match, partner > employer > target.
export const exactRecord = (name, domain, ctx) => findDupes({ name, domain }, ctx).exact.filter(h => h.type in RANK && !h.archived).sort((a, b) => RANK[a.type] - RANK[b.type])[0] || null;

// Targets the pull created today (daily cap) - by LA day of created_at.
async function createdToday(supabase, businessId, today) {
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 36 * 3600e3).toISOString();
  const rows = must(await supabase.from('sales_targets').select('id, created_at').eq('business_id', businessId).eq('source', 'web_visit').not('visit_id', 'is', null).gte('created_at', since));
  return rows.filter(r => laDateString(new Date(r.created_at)) === today).length;
}

async function filePerson(supabase, { businessId, userId, type, id, person, existingKeys }) {
  const key = normName(person.name);
  if (!key || existingKeys.has(key)) return false;
  if (type === 'partner') {
    must(await supabase.from('partner_contacts').insert({ business_id: businessId, goal_id: id, name: person.name, title: person.title || null, linkedin_url: person.linkedin_url || null, source: 'manual', created_by: userId }).select('id').single());
  } else {
    must(await supabase.from('sales_people').insert({
      business_id: businessId, company_type: type, ...(type === 'employer' ? { opportunity_id: id } : { target_id: id }),
      name: person.name, title: person.title || null, location: person.location || null, linkedin_url: person.linkedin_url || null, note: person.note || null,
      source_kind: 'web_visit', source_note: person.source_note || null, apollo_person_id: person.apollo_person_id || null, visit_id: person.visit_id || null, created_by: userId,
    }).select('id').single());
  }
  existingKeys.add(key);
  return true;
}

async function peopleKeys(supabase, businessId, type, id) {
  const rows = type === 'partner'
    ? must(await supabase.from('partner_contacts').select('name').eq('business_id', businessId).eq('goal_id', id))
    : must(await supabase.from('sales_people').select('name').eq('business_id', businessId).eq(type === 'employer' ? 'opportunity_id' : 'target_id', id).is('archived_at', null));
  return new Set(rows.map(r => normName(r.name)).filter(Boolean));
}

// V1 (+ V2b) over scored visit rows that already have their web_visits id. A company is created only when its
// signal this week is still 'new' (a dismissed or parked company is never auto-created); the signal then reads
// accepted / auto with the target. apollo (the pull's call context) enables V2b; null = no people search.
export async function autoCreateFromVisits(supabase, { businessId, userId = null, visits, apollo = null, dupeCtx, settings, skip = new Set(), week, now = new Date() }) {
  const today = laDateString(now);
  const signals = await selectAllPages(() => supabase.from('sales_signals').select(SIGNAL_COLS).eq('business_id', businessId).eq('source', 'web_visit').eq('signal_week', week).order('id'));
  const existingKeys = new Set(dupeCtx.targets.map(t => normName(t.name)).filter(Boolean));
  const made = await createdToday(supabase, businessId, today);
  const plan = autoCreatePlan(visits, { skip, existingKeys, cap: settings.auto_create_daily_cap, createdToday: made, businessId, userId });
  let searchesLeft = apollo ? capLeft(made, settings.people_search_daily_cap) : 0;
  if (apollo) apollo.callCounter.max += searchesLeft;
  const out = { created: [], people: 0, searches: 0, search_errors: 0, no_signal: 0, attached: plan.counts.attach, waited: plan.counts.wait, duplicates: plan.counts.duplicate, capped: plan.counts.capped };
  for (const item of plan.items.filter(i => i.action === 'create')) {
    const sig = signals.find(s => s.company_key === item.company_key);
    if (!sig || sig.status !== 'new') { out.no_signal++; continue; }
    const p = item.payload;
    const r = await insertCompanyRecord(supabase, { businessId, userId, name: p.name, domain: p.domain, to: 'target', kind: 'employer', channel: 'website_visit', evidence: p.evidence, source: p.source, owner: null, employees: null, now });
    if (r.already) { out.duplicates++; continue; }
    const targetId = r.created.id;
    must(await supabase.from('sales_targets').update({ visit_id: item.visit_id, source: 'web_visit', signal_id: sig.id, research_notes: `(${slash(today)}) ${p.evidence}`, updated_at: now.toISOString() }).eq('id', targetId));
    must(await supabase.from('sales_signals').update({ ...autoSignalPatch(targetId, { now }), match: { type: 'target', id: targetId, name: p.name, via: 'new_target' }, updated_at: now.toISOString() }).eq('id', sig.id).eq('status', 'new').select('id'));
    const created = { target_id: targetId, name: p.name, company_key: item.company_key, signal_id: sig.id, visit_id: item.visit_id, people: 0 };
    out.created.push(created);
    if (!apollo || !p.domain || !settings.buyer_titles.length || searchesLeft <= 0) continue;
    searchesLeft--; out.searches++;
    let json = null;
    try { const req = peopleSearchRequest({ domain: p.domain, titles: settings.buyer_titles }); json = await apolloRequest({ method: req.method, path: req.path, body: req.body, ctx: apollo }); }
    catch (e) { out.search_errors++; console.error('[visitors/people-search]', cleanText(String(e.message || ''), 160)); continue; }
    const keys = await peopleKeys(supabase, businessId, 'target', targetId);
    for (const person of mapPeople(json, { visitId: item.visit_id, max: settings.people_per_company, day: today })) {
      if (await filePerson(supabase, { businessId, userId, type: 'target', id: targetId, person, existingKeys: keys })) { out.people++; created.people++; }
    }
  }
  return out;
}

// POST /goals/signals/:id/auto-create (Member) -> { signal, record, people } | 409 { error, reason }
export async function autoCreateSignal(supabase, { businessId, userId, id, now = new Date() }) {
  const { data: s, error } = await findRow(supabase, 'sales_signals', businessId, id);
  if (error) return reply(500, { error: error.message });
  if (!s) return reply(404, { error: 'signal not found' });
  if (s.source !== 'web_visit') return reply(409, { error: 'only a website-visit signal can be auto-created' });
  if (s.status !== 'new') return reply(409, { error: `${s.company_name} was already ${s.status}` });
  const latest = must(await supabase.from('web_visits').select('*').eq('business_id', businessId).eq('company_key', s.company_key).order('pulled_on', { ascending: false }).limit(1));
  if (!latest.length) return reply(409, { error: `${s.company_name} has no stored visit` });
  const [dupeCtx, settings, overrides, skipRows] = await Promise.all([loadDupeContext(supabase, businessId), salesSettings(supabase, businessId), loadOverrides(supabase, businessId), selectAllPages(() => supabase.from('sales_visit_skip').select('id, company_key').eq('business_id', businessId).order('id'))]);
  const v = effectiveVisit(latest[0], overrides.get(s.company_key));
  const apollo = { callCounter: { count: 0, max: 0 }, endpointCounts: {} };
  const out = await autoCreateFromVisits(supabase, { businessId, userId, visits: [v], apollo, dupeCtx, settings, skip: new Set(skipRows.map(x => x.company_key)), week: s.signal_week, now });
  if (!out.created.length) {
    const d = autoCreatePlan([v], { skip: new Set(skipRows.map(x => x.company_key)), existingKeys: new Set(dupeCtx.targets.map(t => normName(t.name))), cap: settings.auto_create_daily_cap, businessId }).items[0];
    return reply(409, { error: `${s.company_name} does not qualify: ${d.action === 'create' ? 'daily cap or a signal already decided' : d.reason}`, reason: d.action === 'create' ? 'cap_or_signal' : d.reason });
  }
  const c = out.created[0];
  const rows = must(await supabase.from('sales_signals').select(SIGNAL_COLS).eq('id', s.id));
  return reply(200, { signal: rows[0], record: { type: 'target', id: c.target_id, name: c.name }, people: c.people, searches: out.searches });
}
export async function autoCreateSignalRoute(req, res) {
  send(res, await autoCreateSignal(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, id: req.params.id }));
}

// V2a - POST /goals/visits/people-csv { text } (Member): Apollo's Visited People export. Each company -> its matched
// record (V0) or a new employer target; each person -> sales_people (partner_contacts on a partner), names as given
// (obfuscated too), never an email. -> { companies: [{ name, action, type, id, people_added, already_in }], skipped }
export async function uploadVisitedPeople(supabase, { businessId, userId, body, now = new Date() }) {
  const text = body?.text;
  if (typeof text !== 'string' || !text.trim()) return reply(400, { error: 'text (the CSV) is required' });
  if (text.length > CSV_MAX_CHARS) return reply(413, { error: 'That file is too large - split it' });
  let parsed;
  try { parsed = parseVisitedPeopleCsv(text, { max: CSV_MAX_PEOPLE }); } catch (e) { return reply(e.status || 400, { error: e.message }); }
  const today = laDateString(now), stamp = slash(today);
  const ctx = await loadDupeContext(supabase, businessId);
  const companies = [];
  try {
    for (const c of parsed.companies) {
      const people = parsed.people.filter(p => (normName(p.company) || p.domain) === c.company_key);
      const m = exactRecord(c.name, c.domain, ctx);
      let type, id, action;
      if (m) { type = m.type === 'opportunity' ? 'employer' : m.type; id = m.id; action = 'matched'; }
      else {
        const evidence = cleanText(`Identified visitor${people.length === 1 ? '' : 's'}: ${people.length} (Apollo Visited People)${c.last_visit ? ` · last visit ${c.last_visit}` : ''}`, 400);
        const r = await insertCompanyRecord(supabase, { businessId, userId, name: c.name, domain: c.domain, to: 'target', kind: 'employer', channel: 'website_visit', evidence, source: { source_kind: 'website', source_note: 'Apollo Visited People export' }, owner: null, employees: null, now });
        if (r.already) { type = r.already.type; id = r.already.id; action = 'matched'; }
        else {
          type = 'target'; id = r.created.id; action = 'created';
          must(await supabase.from('sales_targets').update({ source: 'web_visit', research_notes: `(${stamp}) ${evidence}`, updated_at: now.toISOString() }).eq('id', id));
          ctx.targets.push({ id, name: c.name, status: 'researching' });
        }
      }
      const keys = await peopleKeys(supabase, businessId, type, id);
      let added = 0, already = 0;
      for (const p of people) {
        const ok = await filePerson(supabase, { businessId, userId, type, id, person: { ...p, source_note: 'Apollo Visited People export' }, existingKeys: keys });
        if (ok) added++; else already++;
      }
      companies.push({ name: c.name, action, type, id, people_added: added, already_in: already, last_visit: c.last_visit });
    }
  } catch (e) {
    if (!e.status || e.status >= 500) console.error('[visits/people-csv]', e.message);
    return reply(e.status || 500, { error: e.message, companies });
  }
  const out = { companies, skipped: parsed.skipped, header_row: parsed.header_row, people: parsed.people.length };
  if (ADDRESS.test(JSON.stringify(out))) return reply(500, { error: 'refused: an address reached the reply' });
  return reply(200, out);
}
export async function uploadVisitedPeopleRoute(req, res) {
  send(res, await uploadVisitedPeople(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, body: req.body }));
}

// V3 - GET /goals/people?q=&company=&tie=&title= (Viewer+) -> { people, n }. has_email is a boolean; the address stays
// on the server.
export async function peopleSearch(supabase, { businessId, query = {} }) {
  const q = cleanText(String(query.q || ''), 120), company = cleanText(String(query.company || ''), 160), title = cleanText(String(query.title || ''), 120), tie = String(query.tie || '');
  if (tie && !TIES.includes(tie)) return reply(400, { error: `tie must be one of ${TIES.join('|')}` });
  const all = (table, cols, build = x => x) => selectAllPages(() => build(supabase.from(table).select(cols).eq('business_id', businessId)).order('id'));
  const [salesPeople, partnerContacts, prospects, opportunities, targets, partners, campaigns] = await Promise.all([
    all('sales_people', 'id, company_type, opportunity_id, target_id, name, title, note, source_kind, source_partner_id, source_campaign_id, visit_id, archived_at, created_at, updated_at'),
    all('partner_contacts', 'id, goal_id, name, title, email, source, first_seen, last_activity_at'),
    selectAllPages(() => supabase.from('sales_prospect_state').select('contact_id, name, title, company, opportunity_id, updated_at').eq('business_id', businessId).order('contact_id')),
    all('sales_opportunities', 'id, organization, owner_team, co_owner_name'),
    all('sales_targets', 'id, name, owner_team, co_owner_name'),
    all('sales_goals', 'id, name, owner_team, co_owner_name', x => x.eq('goal_type', 'partnership')),
    all('sales_outreach_campaigns', 'id, name'),
  ]);
  const visitIds = [...new Set(salesPeople.map(p => p.visit_id).filter(Boolean))];
  const visits = visitIds.length ? await selectAllPages(() => supabase.from('web_visits').select('id, last_visit, pulled_on').eq('business_id', businessId).in('id', visitIds).order('id')) : [];
  const rows = unionRows({ salesPeople, partnerContacts, prospects, opportunities, targets, partners, visits, campaignNames: Object.fromEntries(campaigns.map(c => [c.id, c.name])) });
  const people = searchPeople(rows, { q, company, tie, title });
  return reply(200, { people, n: people.length, total: rows.length });
}
export async function peopleSearchRoute(req, res) {
  try { send(res, await peopleSearch(getSupabase(), { businessId: req.params.businessId, query: req.query || {} })); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}

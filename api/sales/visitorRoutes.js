import { getSupabase, findRow } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { scheduleRecompute } from './intentScoreRun.js';
import { laDateString } from './laDate.js';
import { apolloRequest } from './apolloClient.js';
import { loadDupeContext, findDupes } from './partnerDupeCheck.js';
import { insertCompanyRecord } from './companyPanel.js';
import { loadOverrides, effectiveVisit } from './visitPriority.js';
import { normName } from './intakeMatch.js';
import { cleanText, hasPii } from './scrubText.js';
import { autoCreatePlan, autoSignalPatch, recordDecision } from './visitorRecords.js';
import { peopleSearchRequest, mapPeople, parseVisitedPeopleCsv, capLeft } from './peopleFind.js';
import { unionRows, searchPeople, TIES } from './peopleUnion.js';
import { VISITOR_ROLE, SKIP_NOTE, relinkParked } from './visitorPeopleMove.js';
import { normalizeLinkedinUrl, LINKEDIN_ERROR } from '../lib/linkedinUrl.js';

// visitor-to-record-v1 REV2 Stage 2 - the runner behind the pure modules: V1 inside the visitor pull (and on demand
// from Signals), V2a the Visited People export + the list pull's filer (visitorPeoplePull.js calls fileVisitedPeople),
// V2b the domain-scoped people search, V3 the People search. Reads and
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

// existing = { names, ids } on the record: a person is already there by name or by Apollo contact id.
const known = (existing, person) => { const key = normName(person.name); return !key || existing.names.has(key) || (!!person.apollo_person_id && existing.ids.has(person.apollo_person_id)); };
async function filePerson(supabase, { businessId, userId, type, id, person, existingKeys }) {
  const key = normName(person.name);
  if (known(existingKeys, person)) return false;
  if (type === 'partner') {
    must(await supabase.from('partner_contacts').insert({ business_id: businessId, goal_id: id, name: person.name, title: person.title || null, linkedin_url: person.linkedin_url || null, role_in_notes: VISITOR_ROLE, source: 'manual', created_by: userId }).select('id').single());
  } else {
    must(await supabase.from('sales_people').insert({
      business_id: businessId, company_type: type, ...(type === 'employer' ? { opportunity_id: id } : { target_id: id }),
      name: person.name, title: person.title || null, location: person.location || null, linkedin_url: person.linkedin_url || null, note: person.note || null,
      source_kind: 'web_visit', source_note: person.source_note || null, apollo_person_id: person.apollo_person_id || null, visit_id: person.visit_id || null, created_by: userId,
    }).select('id').single());
  }
  existingKeys.names.add(key);
  if (person.apollo_person_id) existingKeys.ids.add(person.apollo_person_id);
  return true;
}

async function peopleKeys(supabase, businessId, type, id) {
  const rows = type === 'partner'
    ? must(await supabase.from('partner_contacts').select('name').eq('business_id', businessId).eq('goal_id', id))
    : must(await supabase.from('sales_people').select('name, apollo_person_id').eq('business_id', businessId).eq(type === 'employer' ? 'opportunity_id' : 'target_id', id).is('archived_at', null));
  return { names: new Set(rows.map(r => normName(r.name)).filter(Boolean)), ids: new Set(rows.map(r => r.apollo_person_id).filter(Boolean)) };
}
// The errors Postgres answers with before the V2a follow-up migration ran (no 'parked' company_type / no company_name).
const MIGRATION_PENDING = e => ['23514', '42703', '22P02'].includes(e?.code) || /company_type|company_name|check constraint|does not exist/i.test(String(e?.message || ''));
export const PARKED_MIGRATION = 'parked people need the migration 20261027_visitor_to_record_v1_v2a.sql';
// Every parked person of the workspace, keyed by their company (normName) -> { names, ids } (idempotent parking).
async function parkedKeys(supabase, businessId) {
  let rows;
  try { rows = await selectAllPages(() => supabase.from('sales_people').select('id, name, company_name, apollo_person_id').eq('business_id', businessId).eq('company_type', 'parked').is('archived_at', null).order('id')); }
  catch (e) { if (MIGRATION_PENDING(e)) return new Map(); throw e; }
  const by = new Map();
  for (const r of rows) {
    const k = normName(r.company_name);
    const e = by.get(k) || { names: new Set(), ids: new Set() };
    const n = normName(r.name); if (n) e.names.add(n);
    if (r.apollo_person_id) e.ids.add(r.apollo_person_id);
    by.set(k, e);
  }
  return by;
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
  scheduleRecompute(supabase, businessId, 'signal');
  return reply(200, { signal: rows[0], record: { type: 'target', id: c.target_id, name: c.name }, people: c.people, searches: out.searches });
}
export async function autoCreateSignalRoute(req, res) {
  send(res, await autoCreateSignal(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, id: req.params.id }));
}

// The record's own headcount: Apollo's count fills an empty one ('apollo'), never a typed ('manual') or researched one.
const EMP_TABLE = { partner: 'sales_goals', employer: 'sales_opportunities', target: 'sales_targets' };
async function fillEmployees(supabase, { type, id, employees, now }) {
  if (!employees || !EMP_TABLE[type]) return false;
  const row = must(await supabase.from(EMP_TABLE[type]).select('id, employees').eq('id', id).maybeSingle());
  if (!row || row.employees != null) return false;
  must(await supabase.from(EMP_TABLE[type]).update({ employees, employees_source: 'apollo', employees_at: now.toISOString(), updated_at: now.toISOString() }).eq('id', id));
  return true;
}

// V2a - the one filer behind the CSV upload and the list pull: each company -> its matched record (V0) or, when the
// record rule says so (recordDecision: US and 500+ / unknown, or a buyer title), a new employer target - else its people
// are PARKED (sales_people company_type 'parked', company name only, no record; Add in People search files them later).
// A company on the visit skip list (Cloudflare, Lovable, ...) gets no record; its people are PARKED with the note
// SKIP_NOTE (visitor-people-follow-record-v1 V4 - they used to be dropped unstored) and never re-link on their own. Each person ->
// sales_people (partner_contacts on a partner), names as given, never an email; idempotent by name and by Apollo contact
// id. preview: the same decisions with no write. -> { companies: [{ name, action: matched | created | parked |
// would_create | would_park | skipped, type, id, people_added, already_in, reason }], people: n, counts, sample }
export async function fileVisitedPeople(supabase, { businessId, userId, parsed, sourceNote, now = new Date(), preview = false }) {
  const today = laDateString(now), stamp = slash(today);
  const [ctx, skipRows, settings, parked] = await Promise.all([loadDupeContext(supabase, businessId), selectAllPages(() => supabase.from('sales_visit_skip').select('id, company_key').eq('business_id', businessId).order('id')), salesSettings(supabase, businessId), parkedKeys(supabase, businessId)]);
  const skip = new Set(skipRows.map(r => r.company_key));
  const companies = [], sample = [];
  const counts = { companies: parsed.companies.length, matched: 0, created: 0, parked: 0, skipped_companies: 0, people_added: 0, people_parked: 0, already_in: 0, employees_filled: 0, parked_unfiled: 0 };
  let parkedStore = true;
  for (const c of parsed.companies) {
    const people = parsed.people.filter(p => (normName(p.company) || p.domain) === c.company_key);
    const m = exactRecord(c.name, c.domain, ctx);
    let type = null, id = null, action, reason = null, skipListed = false;
    if (m) { type = m.type === 'opportunity' ? 'employer' : m.type; id = m.id; action = 'matched'; }
    else if (skip.has(normName(c.name))) { counts.skipped_companies++; skipListed = true; reason = SKIP_NOTE; action = preview ? 'would_park' : 'parked'; }
    else {
      const d = recordDecision(c, people, { buyerTitles: settings.buyer_titles });
      reason = d.reason;
      if (d.action === 'park') action = preview ? 'would_park' : 'parked';
      else if (preview) { type = 'target'; action = 'would_create'; }
      else {
        const evidence = cleanText(`Identified visitor${people.length === 1 ? '' : 's'}: ${people.length} (${sourceNote})${c.last_visit ? ` · seen ${c.last_visit}` : ''}`, 400);
        const r = await insertCompanyRecord(supabase, { businessId, userId, name: c.name, domain: c.domain, to: 'target', kind: 'employer', channel: 'website_visit', evidence, source: { source_kind: 'website', source_note: sourceNote }, owner: null, employees: c.employees, employeesSource: 'apollo', dupeCtx: ctx, now });
        if (r.already) { type = r.already.type; id = r.already.id; action = 'matched'; }
        else {
          type = 'target'; id = r.created.id; action = 'created';
          must(await supabase.from('sales_targets').update({ source: 'web_visit', research_notes: `(${stamp}) ${evidence}`, updated_at: now.toISOString() }).eq('id', id));
          ctx.targets.push({ id, name: c.name, status: 'researching' });
        }
      }
    }
    const parking = action === 'parked' || action === 'would_park';
    counts[action === 'matched' ? 'matched' : parking ? 'parked' : 'created']++;
    if (action === 'matched' && !preview && await fillEmployees(supabase, { type, id, employees: c.employees, now })) counts.employees_filled++;
    const keys = parking ? (parked.get(normName(c.name)) || { names: new Set(), ids: new Set() }) : id ? await peopleKeys(supabase, businessId, type, id) : { names: new Set(), ids: new Set() };
    if (parking && !parked.has(normName(c.name))) parked.set(normName(c.name), keys);
    let added = 0, already = 0;
    for (const p of people) {
      const fresh = !known(keys, p);
      if (fresh && !preview && parking) {
        if (parkedStore) {
          const ins = await supabase.from('sales_people').insert({ business_id: businessId, company_type: 'parked', company_name: c.name, company_domain: c.domain, name: p.name, title: p.title || null, note: skipListed ? SKIP_NOTE : p.note || null, source_kind: 'web_visit', source_note: cleanText([sourceNote, p.lists].filter(Boolean).join(' · '), 300), apollo_person_id: p.apollo_person_id || null, created_by: userId }).select('id').single();
          if (ins.error && MIGRATION_PENDING(ins.error)) parkedStore = false; else must(ins);
        }
        if (!parkedStore) counts.parked_unfiled++;
        const key = normName(p.name); if (key) keys.names.add(key); if (p.apollo_person_id) keys.ids.add(p.apollo_person_id);
      } else if (fresh && !preview) await filePerson(supabase, { businessId, userId, type, id, person: { ...p, source_note: cleanText([sourceNote, p.lists].filter(Boolean).join(' · '), 300) }, existingKeys: keys });
      else if (fresh) { const key = normName(p.name); if (key) keys.names.add(key); if (p.apollo_person_id) keys.ids.add(p.apollo_person_id); }
      if (fresh) added++; else already++;
      if (sample.length < 3) sample.push({ name: p.name, company: c.name, action: fresh ? (parking ? 'parked' : 'new') : 'already' });
    }
    if (parking) counts.people_parked += added; else counts.people_added += added;
    counts.already_in += already;
    companies.push({ name: c.name, action, type, id, people_added: parking ? 0 : added, people_parked: parking ? added : 0, already_in: already, employees: c.employees, reason });
  }
  return { companies, people: parsed.people.length, counts, sample, migration_pending: !parkedStore ? PARKED_MIGRATION : null };
}

// V2a follow-up - POST /goals/people/:id/add-record (Member): a parked person's company becomes an employer target (or
// joins the record that now matches) and every parked person of that company moves onto it.
export async function addRecordFromPerson(supabase, { businessId, userId, id, now = new Date() }) {
  const { data: p, error } = await findRow(supabase, 'sales_people', businessId, id);
  if (error) return reply(500, { error: error.message });
  if (!p) return reply(404, { error: 'person not found' });
  if (p.company_type !== 'parked' || !p.company_name) return reply(409, { error: `${p.name} already has a record` });
  const key = normName(p.company_name);
  const siblings = (await selectAllPages(() => supabase.from('sales_people').select('id, name, title, company_name, apollo_person_id').eq('business_id', businessId).eq('company_type', 'parked').is('archived_at', null).order('id'))).filter(r => normName(r.company_name) === key);
  const today = laDateString(now);
  try {
    const evidence = cleanText(`Identified visitor${siblings.length === 1 ? '' : 's'}: ${siblings.length} · added from People search ${today}`, 400);
    const r = await insertCompanyRecord(supabase, { businessId, userId, name: p.company_name, domain: p.company_domain || null, to: 'target', kind: 'employer', channel: 'website_visit', evidence, source: { source_kind: 'website', source_note: 'Added from People search' }, owner: null, now , relink: false });
    const rec = r.already || r.created;
    const type = r.already ? r.already.type : 'target';
    if (!r.already) must(await supabase.from('sales_targets').update({ source: 'web_visit', research_notes: `(${slash(today)}) ${evidence}`, updated_at: now.toISOString() }).eq('id', rec.id));
    // The explicit Add moves every parked person of this company - skip-listed ones too (V4 / V5).
    const moved = await relinkParked(supabase, { businessId, userId, type, id: rec.id, name: p.company_name, now, includeSkipped: true });
    scheduleRecompute(supabase, businessId, 'signal');
    return reply(r.already ? 200 : 201, { record: { type, id: rec.id, name: rec.name || p.company_name }, people_moved: moved, already: !!r.already });
  } catch (e) { return reply(e.status || 500, { error: e.message }); }
}
// FIX pipeline-quick-fixes-v1 A - POST /goals/people (Member): one person by hand from "+ Add ▾ › Person".
// body { name, title?, linkedin_url?, company: { type: partner | employer | target, id } | { name, domain? } }
// A partner gets a partner_contacts row, an employer / target a sales_people row, a company Prospector has no record
// for a PARKED sales_people row (company name only - Add in People search files it later). Never an email or a
// phone: any other field, or one hiding in the text, is 400. -> 201 { person: { id, name }, company: { type, id, name } }
const PERSON_TYPES = ['partner', 'employer', 'target'];
export async function addPerson(supabase, { businessId, userId, body, now = new Date() }) {
  const extra = Object.keys(body || {}).find(k => !['name', 'title', 'linkedin_url', 'company'].includes(k));
  if (extra) return reply(400, { error: 'Add person takes name, title, LinkedIn URL and the company only' });
  const text = (v, max, label) => {
    if (v == null || v === '') return { value: null };
    if (typeof v !== 'string') return { error: `${label} must be text` };
    const t = v.trim().replace(/\s+/g, ' ');
    if (t.length > max) return { error: `${label} must be at most ${max} characters` };
    if (hasPii(t)) return { error: `${label} can't hold an email address or phone number` };
    return { value: t || null };
  };
  const name = text(body?.name, 120, 'name'), title = text(body?.title, 160, 'title'), linkedin = text(body?.linkedin_url, 300, 'linkedin_url');
  const c = body?.company || {};
  const cName = text(c.name, 160, 'company name'), cDomain = text(c.domain, 120, 'company domain');
  const bad = [name, title, linkedin, cName, cDomain].find(x => x.error);
  if (bad) return reply(400, { error: bad.error });
  if (!name.value) return reply(400, { error: 'name is required' });
  const linkedinUrl = linkedin.value ? normalizeLinkedinUrl(linkedin.value) : null;
  if (linkedin.value && !linkedinUrl) return reply(400, { error: LINKEDIN_ERROR });
  const onRecord = PERSON_TYPES.includes(c.type) && typeof c.id === 'string' && c.id;
  if (!onRecord && !cName.value) return reply(400, { error: 'company is required: a record (type + id) or a new company name' });
  const person = { name: name.value, title: title.value, linkedin_url: linkedinUrl, note: null, apollo_person_id: null, visit_id: null, source_note: 'Added from Pipeline' };
  try {
    if (onRecord) {
      const ctx = await loadDupeContext(supabase, businessId);
      const rec = (c.type === 'partner' ? ctx.partners : c.type === 'employer' ? ctx.opportunities : ctx.targets).find(r => r.id === c.id && !r.archived_at) || null;
      if (!rec) return reply(404, { error: `${c.type} not found` });
      const keys = await peopleKeys(supabase, businessId, c.type, c.id);
      if (known(keys, person)) return reply(409, { error: `${person.name} is already listed on ${rec.name || rec.organization}` });
      await filePerson(supabase, { businessId, userId, type: c.type, id: c.id, person, existingKeys: keys });
      const row = c.type === 'partner'
        ? must(await supabase.from('partner_contacts').select('id, name').eq('business_id', businessId).eq('goal_id', c.id).order('created_at', { ascending: false }).limit(1))[0]
        : must(await supabase.from('sales_people').select('id, name').eq('business_id', businessId).eq(c.type === 'employer' ? 'opportunity_id' : 'target_id', c.id).order('created_at', { ascending: false }).limit(1))[0];
      return reply(201, { person: { id: row?.id || null, name: person.name }, company: { type: c.type, id: c.id, name: rec.name || rec.organization } });
    }
    const ctx = await loadDupeContext(supabase, businessId);
    const m = exactRecord(cName.value, cDomain.value, ctx);
    if (m) return addPerson(supabase, { businessId, userId, body: { name: name.value, title: title.value, linkedin_url: linkedinUrl, company: { type: m.type === 'opportunity' ? 'employer' : m.type, id: m.id } }, now });
    const parked = (await parkedKeys(supabase, businessId)).get(normName(cName.value)) || { names: new Set(), ids: new Set() };
    if (known(parked, person)) return reply(409, { error: `${person.name} is already parked under ${cName.value}` });
    const ins = await supabase.from('sales_people').insert({ business_id: businessId, company_type: 'parked', company_name: cName.value, company_domain: cDomain.value, name: person.name, title: person.title, linkedin_url: person.linkedin_url, source_kind: null, source_note: 'Added from Pipeline', created_by: userId }).select('id, name').single();
    if (ins.error && MIGRATION_PENDING(ins.error)) return reply(409, { error: PARKED_MIGRATION });
    const row = must(ins);
    return reply(201, { person: { id: row.id, name: row.name }, company: { type: 'parked', id: null, name: cName.value } });
  } catch (e) { return reply(e.status || 500, { error: e.message }); }
}
export async function addPersonRoute(req, res) {
  send(res, await addPerson(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, body: req.body }));
}

export async function addRecordFromPersonRoute(req, res) {
  send(res, await addRecordFromPerson(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, id: req.params.id }));
}

// V2a - POST /goals/visits/people-csv { text, preview? } (Member): Apollo's contacts export (Visited People), the real
// header map (peopleFind.js). preview true = counts only, no write. -> { companies, skipped, header_row, people, counts, preview }
export async function uploadVisitedPeople(supabase, { businessId, userId, body, now = new Date() }) {
  const text = body?.text, preview = body?.preview === true;
  if (typeof text !== 'string' || !text.trim()) return reply(400, { error: 'text (the CSV) is required' });
  if (text.length > CSV_MAX_CHARS) return reply(413, { error: 'That file is too large - split it' });
  let parsed;
  try { parsed = parseVisitedPeopleCsv(text, { max: CSV_MAX_PEOPLE, seenOn: laDateString(now) }); } catch (e) { return reply(e.status || 400, { error: e.message }); }
  let filed;
  try { filed = await fileVisitedPeople(supabase, { businessId, userId, parsed, sourceNote: 'Apollo Visited People export', now, preview }); }
  catch (e) {
    if (!e.status || e.status >= 500) console.error('[visits/people-csv]', e.message);
    return reply(e.status || 500, { error: e.message });
  }
  const out = { ...filed, skipped: parsed.skipped, header_row: parsed.header_row, columns_dropped: parsed.columns_dropped, preview };
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
  const PEOPLE_COLS = 'id, company_type, opportunity_id, target_id, name, title, note, source_kind, source_partner_id, visit_id, archived_at, created_at, updated_at';
  const salesPeople = await all('sales_people', `${PEOPLE_COLS}, company_name`).catch(e => { if (MIGRATION_PENDING(e)) return all('sales_people', PEOPLE_COLS); throw e; });
  const [partnerContacts, prospects, opportunities, targets, partners, campaigns] = await Promise.all([
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

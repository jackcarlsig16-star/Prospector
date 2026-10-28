import { cleanText } from './scrubText.js';
import { PRIORITY_LABEL } from './visitRules.js';

// visitor-to-record-v1 REV2 V1 / V6 - pure decisions over the rows the visitor pull already scored (visitRules.js
// stays the only scorer). The runner (Stage 2) feeds it web_visits rows and acts on the plan; nothing here reads or
// writes the database, and no row carries an address or phone (web_visits has none by construction).
export const AUTO_CREATE_DAILY_CAP = 25; // REVISABLE
export const CREATE_PRIORITIES = new Set(['P1']);
export const UPSIDE_TEAMS = ['upside', 'both'];
const PAGES_SHOWN = 3;

// Why a visit does not become a record. Order = the spec's V1 rule.
export function autoCreateDecision(v, { skip = new Set(), existingKeys = new Set(), capLeft = AUTO_CREATE_DAILY_CAP } = {}) {
  if (v.matched_type && v.matched_id) return { action: 'attach', reason: 'matched', stampOnly: UPSIDE_TEAMS.includes(v.match_owner_team || '') };
  if (v.noise_reason) return { action: 'wait', reason: 'noise' };
  if (v.maybe_user) return { action: 'wait', reason: 'maybe_user' };
  if (skip.has(v.company_key)) return { action: 'wait', reason: 'skip_list' };
  const eligible = CREATE_PRIORITIES.has(v.priority) || (v.priority === 'P2' && v.us_500 === true);
  if (!eligible) return { action: 'wait', reason: v.priority === 'P2' ? 'p2_without_us_500' : 'below_bar' };
  if (existingKeys.has(v.company_key)) return { action: 'duplicate', reason: 'already_created' };
  if (capLeft <= 0) return { action: 'capped', reason: 'daily_cap' };
  return { action: 'create', reason: v.priority_rule || v.priority };
}

// "Visited 6 times in 7 days · pages: /pricing, /employer-partners · intent high" (<= 400 chars, scrubbed).
export function visitEvidence(v) {
  const n = v.visits_7d ?? 0;
  const pages = (Array.isArray(v.top_paths) ? v.top_paths : []).slice(0, PAGES_SHOWN).map(p => p.path).filter(Boolean);
  const parts = [`Visited ${n} time${n === 1 ? '' : 's'} in 7 days`];
  if (pages.length) parts.push(`pages: ${pages.join(', ')}`);
  if (v.apollo_intent) parts.push(`intent ${v.apollo_intent}`);
  if (v.last_visit) parts.push(`last ${v.last_visit}`);
  return cleanText(parts.join(' · '), 400);
}

// The insertCompanyRecord call for a 'create' decision: an employer target, channel website_visit, source web_visit,
// owner unassigned (Actions' Unassigned bucket), employees from the visit row when Apollo gave one (employees_source
// 'apollo' - the Stage 1 migration widens the CHECK), noteMeta carries the visit id + rule.
export function recordPayload(v, { businessId, userId = null }) {
  const employees = Number.isInteger(v.employees) && v.employees > 0 ? v.employees : null;
  return {
    businessId, userId, name: v.company_name, domain: v.domain || null, to: 'target', kind: 'employer', channel: 'website_visit',
    evidence: visitEvidence(v), source: { source_kind: 'website', source_note: `Website visit ${v.pulled_on || ''}`.trim() }, owner: null,
    employees, employeesSource: employees != null ? 'apollo' : null, noteMeta: { visit_id: v.id, priority_rule: v.priority_rule || null },
    targetExtra: { visit_id: v.id || null, source: 'web_visit' },
  };
}

// The signal row for an auto-created company: created as today AND accepted by nobody (decided_by null, auto true).
export function autoSignalPatch(targetId, { now = new Date() } = {}) {
  return { status: 'accepted', auto: true, decided_by: null, decided_at: now.toISOString(), target_id: targetId };
}

// A matched record gets the visit stamped, never a second record (V1 idempotency; V5 Brad tie for an Upside match):
// the evidence line to append and the visit date to carry. Stage 2 decides the column (notes / evidence) per table.
export function attachNote(v) {
  return { last_visit: v.last_visit || v.pulled_on || null, evidence: visitEvidence(v), matched_type: v.matched_type, matched_id: v.matched_id };
}

// One plan for a pull's scored rows: create / attach / wait / duplicate / capped, in row order, cap counted down.
export function autoCreatePlan(visits, { skip, existingKeys = new Set(), cap = AUTO_CREATE_DAILY_CAP, createdToday = 0, businessId, userId = null } = {}) {
  let capLeft = Math.max(0, cap - createdToday);
  const seen = new Set(existingKeys);
  const items = [];
  for (const v of visits) {
    const d = autoCreateDecision(v, { skip, existingKeys: seen, capLeft });
    const item = { company_key: v.company_key, company_name: v.company_name, visit_id: v.id || null, priority: v.priority, ...d };
    if (d.action === 'create') { capLeft--; seen.add(v.company_key); item.payload = recordPayload(v, { businessId, userId }); }
    if (d.action === 'attach') item.note = attachNote(v);
    items.push(item);
  }
  const counts = items.reduce((o, i) => ({ ...o, [i.action]: (o[i.action] || 0) + 1 }), { create: 0, attach: 0, wait: 0, duplicate: 0, capped: 0 });
  return { items, counts, capLeft };
}

// V6 Undo: archive the target (status rejected - sales_targets has no archived_at; never a delete) and its visit
// people (archived_at), reopen the signal. Patches only; the runner applies them and logs the event.
export function undoPlan({ signal, target, people = [] }, { now = new Date() } = {}) {
  if (!signal?.auto || signal.status !== 'accepted') throw Object.assign(new Error('only an auto-created signal can be undone here'), { status: 409 });
  const at = now.toISOString();
  return {
    signal: { status: 'new', auto: false, target_id: null, decided_at: null, decided_by: null, updated_at: at },
    target: target ? { id: target.id, patch: { status: 'rejected', updated_at: at } } : null,
    people: people.filter(p => !p.archived_at).map(p => ({ id: p.id, patch: { archived_at: at, updated_at: at } })),
    event: { action: 'visit_auto_create_undone', detail: { signal_id: signal.id, target_id: target?.id || null, people: people.length, company_key: signal.company_key } },
  };
}

// The "Created" chip / "filed by Prospector" tag on the Web visitors view: what a row's match column reads.
export function matchLabel(v, { createdKeys = new Set() } = {}) {
  if (createdKeys.has(v.company_key)) return 'Created';
  if (v.matched_type === 'partner') return 'Partner';
  if (v.matched_type === 'opportunity') return 'Employer';
  if (v.matched_type === 'target') return 'Target';
  return 'None';
}
export const priorityWord = p => PRIORITY_LABEL[p] || p;

// V2a follow-up (Oct 27 ruling, choice 1): a visitor's company becomes an employer target only when it is US and 500+
// (or its headcount is unknown), or one of its identified people carries a buyer title (sales_settings.buyer_titles);
// otherwise its people wait as 'parked' rows (company name only, no record) until Add in People search. REVISABLE.
export const RECORD_MIN_EMPLOYEES = 500;
export const UNKNOWN_COUNTRY_IS_US = true; // contacts/search carries no country on most rows; the CSV does
const US = /^(us|usa|u\.s\.a?\.?|united states( of america)?)$/i;
export const isUS = country => (country == null || String(country).trim() === '' ? UNKNOWN_COUNTRY_IS_US : US.test(String(country).trim()));
export const hasBuyerTitle = (people = [], titles = []) => {
  const wanted = titles.map(t => String(t).toLowerCase().trim()).filter(Boolean);
  return people.some(p => { const title = String(p.title || '').toLowerCase(); return wanted.some(w => title.includes(w)); });
};
export function recordDecision(company, people, { buyerTitles = [] } = {}) {
  if (hasBuyerTitle(people, buyerTitles)) return { action: 'create', reason: 'buyer_title' };
  if (!isUS(company.country)) return { action: 'park', reason: 'not_us' };
  if (company.employees != null && company.employees < RECORD_MIN_EMPLOYEES) return { action: 'park', reason: 'under_500' };
  return { action: 'create', reason: company.employees == null ? 'us_size_unknown' : 'us_500' };
}

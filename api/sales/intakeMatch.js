import { cleanText } from './scrubText.js';
import { isDate } from './goalsShared.js';
import { laDateString } from './laDate.js';
import { touchDedupe } from './touchDedupe.js';
import { touchStageMove, TOUCH_TYPE_IDS } from '../../src/constants/partnerPipeline.js';
import { OWNER_TEAMS, doubleTouchWarning } from '../../src/constants/ownership.js';
import { toDeal } from './intakeDeal.js';
import { cleanReferral } from './leadSource.js';

// call-notes-targets-v1 REV3 - the four Intake lists the model returns
// (companies, people, touches, facts) checked against this workspace. The
// model only names things; every match, id, old value and dedupe hit is
// worked out here, and anything that doesn't resolve is shown but never
// stored. Matching order: partner -> employer (sales_opportunities) ->
// employer in Apollo only (sales_sequenced_accounts) -> target.

export const MAX_ITEMS = 30;
export const ROLES = ['champion', 'blocker', 'referrer', 'counterpart', 'other'];
export const FACT_FIELDS = ['champion', 'angle', 'watch_outs', 'next_step', 'do_not_say', 'target_titles', 'their_words'];
const KINDS = ['partner', 'employer', 'not_target', 'unclear'];
// fact field -> the column it lands in. their_words has no column of its own.
export const PARTNER_FACT_COLUMN = { champion: 'champion', angle: 'angle', watch_outs: 'watch_outs', next_step: 'next_step', do_not_say: 'do_not_say', target_titles: 'target_titles', their_words: 'angle' };
export const EMPLOYER_FACT_COLUMN = { champion: 'champion', watch_outs: 'objections', do_not_say: 'objections', next_step: 'next_action' };
export const SINGLE_VALUED = new Set(['next_step', 'next_action']);


const SUFFIX = /\b(inc|llc|ltd|corp|corporation|co|plc)$/;
export function normName(s) {
  let n = String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ').replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  while (SUFFIX.test(n)) n = n.replace(SUFFIX, '').trim();
  return n.replace(/^the /, '');
}
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWords = (inner, outer) => new RegExp(`(^| )${escape(inner)}( |$)`).test(outer);
// FIX dupe-generic-words-v1 - words that name nothing on their own: a stored row called "Enterprise" must not
// flag every pasted company with that word. REVISABLE list; 'insurance', 'financial', 'bank', 'health' are
// deliberately not here, they tell companies in this pipeline apart.
export const GENERIC_WORDS = new Set(['company', 'companies', 'group', 'holdings', 'enterprise', 'enterprises',
  'international', 'global', 'national', 'worldwide', 'services', 'solutions', 'partners', 'industries', 'systems',
  'technologies', 'associates', 'brands', 'america', 'american', 'usa', 'us', 'of', 'and', 'the']);
const meaningful = n => n.split(' ').some(w => w && !GENERIC_WORDS.has(w));

// Exact = same normalized name or the same with spaces removed ("Perk Spot"
// = PerkSpot). Partial = one name is a whole-word part of the other, and a
// partial needs at least one non-generic word on the contained side.
export function nameMatches(name, rows, key, partial) {
  const n = normName(name);
  if (n.length < 2) return [];
  const tight = n.replace(/ /g, '');
  return rows.filter(r => {
    const rn = normName(r[key]);
    if (!partial) return rn === n || rn.replace(/ /g, '') === tight;
    return rn.length >= 4 && n.length >= 4 && ((hasWords(rn, n) && meaningful(rn)) || (hasWords(n, rn) && meaningful(n)));
  });
}

// Intake wants one answer: a hit only when exactly one row fits.
export function findByName(name, rows, key, partial) {
  const hits = nameMatches(name, rows, key, partial);
  return hits.length === 1 ? hits[0] : null;
}

const SOURCES = [['partner', 'partners', 'name'], ['opportunity', 'opportunities', 'organization'], ['account', 'companies', 'name'], ['target', 'targets', 'name']];

// The record a company name is, exact matches first across every source.
export function resolveCompany(name, ctx) {
  for (const partial of [false, true]) {
    for (const [type, list, key] of SOURCES) {
      const row = findByName(name, ctx[list] || [], key, partial);
      if (row) return { type, id: type === 'account' ? row.account_id : row.id, name: row[key] || row.account_id, partial, row };
    }
  }
  return null;
}

const ownershipOf = m => (m && m.type !== 'account' ? { owner_team: m.row.owner_team ?? null, co_owner_name: m.row.co_owner_name ?? null, no_double_touch: !!m.row.no_double_touch } : null);
const publicMatch = m => (m ? { type: m.type, id: m.id, name: m.name, partial: m.partial, ...(m.type === 'partner' ? { pipeline_status: m.row.pipeline_status || 'not_started' } : {}), ...(m.type === 'target' ? { status: m.row.status } : {}) } : null);
const list = (raw, k) => (Array.isArray(raw?.[k]) ? raw[k] : []).slice(0, MAX_ITEMS).filter(x => x && typeof x === 'object');

// The model names the owner; the server picks the member. Every word of the
// name must be in exactly one member's name, starting with their first name,
// so someone outside the workspace (Seif) comes back Unassigned instead of
// landing on the nearest member.
const nameWords = s => (typeof s === 'string' ? s.toLowerCase().replace(/[^a-z\s'-]/g, ' ').split(/\s+/).filter(Boolean) : []);
export function matchOwner(name, members) {
  const w = nameWords(name);
  if (!w.length) return null;
  const hits = members.filter(m => { const mw = nameWords(m.name); return mw[0] === w[0] && w.every(x => mw.includes(x)); });
  return hits.length === 1 ? hits[0].id : null;
}

export function toIntake(raw, ctx, noteDate, today = laDateString()) {
  const companies = [], rejected = [];
  const seen = new Set();
  for (const [i, c] of list(raw, 'companies').entries()) {
    const name = cleanText(c.name, 160);
    if (!name || seen.has(normName(name))) continue;
    seen.add(normName(name));
    const kind = KINDS.includes(c.kind) ? c.kind : 'unclear';
    const m = resolveCompany(name, ctx);
    if (m?.type === 'target' && m.row.status === 'rejected') { rejected.push(name); continue; }
    const action = m ? (m.type === 'account' ? 'none' : 'note') : kind === 'partner' ? 'target_partner' : kind === 'employer' ? 'target_employer' : 'skip';
    companies.push({
      key: `c${i}`, name, kind, evidence: cleanText(c.evidence, 200), match: publicMatch(m), _m: m, action,
      category: kind === 'partner' && (ctx.categories || []).includes(c.category) ? c.category : null,
      on: action !== 'skip' && action !== 'none', _ownership: c.ownership,
      // lead-source-v1: who brought it, as a proposal the review can edit; applied only to a record Accept creates.
      referred_by: cleanReferral(c.referred_by, ctx.partners || []),
    });
  }
  // A person / touch / fact names its company; it belongs to the listed
  // company of that name, else to whatever the name resolves to directly.
  const companyOf = name => {
    const listed = findByName(name, companies, 'name', false) || findByName(name, companies, 'name', true);
    if (listed) return { company: listed.name, company_key: listed.key, m: listed._m, newTarget: !listed._m && listed.action.startsWith('target_') };
    const m = resolveCompany(name, ctx);
    if (m?.type === 'target' && m.row.status === 'rejected') return { company: cleanText(name, 160), company_key: null, m: null, newTarget: false };
    return { company: m?.name || cleanText(name, 160), company_key: null, m, newTarget: false };
  };
  const employer = m => m && (m.type === 'opportunity' || m.type === 'account');

  const ownership = [];
  for (const c of companies) {
    const o = c._ownership;
    if (!o || typeof o !== 'object') continue;
    const next = {
      owner_team: OWNER_TEAMS.includes(o.owner_team) ? o.owner_team : null,
      co_owner_name: cleanText(o.co_owner_name, 120) || null,
      no_double_touch: typeof o.no_double_touch === 'boolean' ? o.no_double_touch : null,
    };
    if (next.owner_team === null && next.co_owner_name === null && next.no_double_touch === null) continue;
    const dest = c._m ? c._m.type : c.action.startsWith('target_') ? 'new_target' : null;
    ownership.push({
      key: `o${ownership.length}`, company: c.name, company_key: c.key, match: c.match, ...next,
      owner_name: cleanText(o.owner_name, 80) || null, evidence: cleanText(o.evidence, 200),
      old: ownershipOf(c._m), creates_opportunity: c._m?.type === 'account', dest, on: dest !== null,
    });
  }

  const people = [];
  for (const p of list(raw, 'people')) {
    const name = cleanText(p.name, 120);
    if (!name || matchOwner(name, ctx.members || [])) continue;
    const at = companyOf(p.company);
    const moved = p.moved_from ? resolveCompany(p.moved_from, ctx) : null;
    const dest = at.m?.type === 'partner' ? 'partner_contacts' : employer(at.m) ? 'decision_makers' : at.newTarget ? 'research_notes' : null;
    people.push({
      key: `p${people.length}`, name, company: at.company, company_key: at.company_key, match: publicMatch(at.m),
      title: cleanText(p.title, 160) || null, role: ROLES.includes(p.role) ? p.role : 'other',
      moved_from: cleanText(p.moved_from, 160) || null, moved_from_match: moved?.type === 'partner' ? publicMatch(moved) : null,
      evidence: cleanText(p.evidence, 200), dest, existing: null, creates_opportunity: at.m?.type === 'account', on: dest !== null,
    });
  }

  const touches = [];
  for (const t of list(raw, 'touches')) {
    const at = companyOf(t.company);
    const touch_type = TOUCH_TYPE_IDS.includes(t.touch_type) ? t.touch_type : 'other';
    const latest = noteDate > today ? today : noteDate;
    const date = isDate(t.date) && t.date <= today ? t.date : latest;
    const names = (Array.isArray(t.people) ? t.people : []).map(n => cleanText(n, 80)).filter(Boolean).slice(0, 10);
    const partner = at.m?.type === 'partner' ? at.m : null;
    // Only a move the notes state (a reply, a booked meeting) - never the Log
    // touch form's auto rule: an internal call that mentions a partner is not
    // the team emailing them.
    let stage = null;
    if (partner && ['replied', 'meeting_set'].includes(t.stage)) {
      const move = touchStageMove(partner.row.pipeline_status, touch_type, t.stage);
      stage = move && !move.error ? move : null;
    }
    touches.push({
      key: `t${touches.length}`, company: at.company, company_key: at.company_key, match: publicMatch(at.m), touch_type, people: names, date,
      direction: t.direction === 'in' ? 'in' : 'out', stage, stage_on: !!stage, evidence: cleanText(t.evidence, 200),
      kept_with_note: !partner, duplicate: null,
      warning: partner ? doubleTouchWarning(partner.row) : null,
      on: !!partner,
    });
  }

  const facts = [];
  for (const f of list(raw, 'facts')) {
    if (!FACT_FIELDS.includes(f.field)) continue;
    let text = cleanText(f.text, 400);
    if (!text) continue;
    const at = companyOf(f.company);
    const column = at.m?.type === 'partner' ? PARTNER_FACT_COLUMN[f.field] : employer(at.m) ? EMPLOYER_FACT_COLUMN[f.field] || null : at.newTarget ? 'research_notes' : null;
    if (f.field === 'their_words' && column === 'angle') text = `They said: ${text}`;
    const row = at.m && at.m.type !== 'account' ? at.m.row : null;
    facts.push({
      key: `f${facts.length}`, company: at.company, company_key: at.company_key, match: publicMatch(at.m), field: f.field, column, text,
      single: SINGLE_VALUED.has(column), old: column && row ? row[column] ?? null : null,
      due_date: column === 'next_action' && isDate(f.due_date) ? f.due_date : null,
      evidence: cleanText(f.evidence, 200), creates_opportunity: at.m?.type === 'account', on: column !== null,
    });
  }

  const deal = toDeal(raw, { companyOf, isMember: n => !!matchOwner(n, ctx.members || []), noteDate });
  return { companies: companies.map(({ _m, _ownership, ...c }) => c), ownership, people, touches, facts, ...deal, rejected };
}

// What only the DB can say, for the partners the notes resolved to: who we
// already have on file (any source, Apollo included) and which touches are
// already recorded.
export async function enrichIntake(supabase, businessId, intake) {
  const ids = [...new Set([...intake.people, ...intake.touches].filter(x => x.match?.type === 'partner').map(x => x.match.id))];
  if (!ids.length) return intake;
  const [contacts, events] = await Promise.all([
    supabase.from('partner_contacts').select('id, goal_id, name, title, role_in_notes, source').eq('business_id', businessId).in('goal_id', ids),
    supabase.from('sales_partner_events').select('goal_id, event, at, contact_names, touch_type, source').eq('business_id', businessId).eq('event', 'touch').in('goal_id', ids),
  ]);
  for (const r of [contacts, events]) if (r.error) throw new Error(r.error.message);
  for (const p of intake.people) {
    if (p.dest !== 'partner_contacts') continue;
    const hit = contacts.data.find(c => c.goal_id === p.match.id && c.name.trim().toLowerCase() === p.name.toLowerCase());
    p.existing = hit ? { id: hit.id, title: hit.title, role_in_notes: hit.role_in_notes, source: hit.source } : null;
  }
  const dedupe = touchDedupe(events.data);
  for (const t of intake.touches) {
    if (t.match?.type !== 'partner') continue;
    let hit = null;
    for (const n of t.people) if ((hit = dedupe.prior(t.match.id, n, null, t.date))) break;
    if (!t.people.length) hit = dedupe.priorOfType(t.match.id, t.touch_type, t.date);
    if (hit) { t.duplicate = hit; t.on = false; t.stage_on = false; }
  }
  return intake;
}

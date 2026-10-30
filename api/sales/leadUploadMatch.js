import { cleanText } from './scrubText.js';
import { normName } from './intakeMatch.js';
import { findDupes } from './partnerDupeCheck.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { ownershipChip } from '../../src/constants/ownership.js';
import { SOURCE_KINDS, SOURCE_LABEL } from '../../src/constants/leadSources.js';
import { normalizeDomain } from '../../src/constants/partnerDomains.js';
import { normalizeLinkedinUrl } from '../lib/linkedinUrl.js';

// lead-upload-v1 S2/S3 - a lead list the model read (companies + people) checked against this workspace. The model
// only names things; every match, owner chip, existing source and "Already in" is worked out here from stored rows.

export const MAX_PEOPLE = 30; // REVISABLE
export const KIND_GUESSES = ['partner', 'employer', 'unclear'];
export const KINDS = ['employer', 'partner', 'target'];
export const ACTIONS = ['create', 'add_people', 'skip'];
// The picker -> source_kind. "Other" is unknown.
export const PICKS = { apollo: 'apollo', partner_referral: 'partner_referral', person_referral: 'person_referral', event: 'event', campaign: 'campaign', website: 'website', inbound: 'inbound', other: 'unknown' };
const int = v => (Number.isInteger(v) && v > 0 && v < 1e8 ? v : typeof v === 'string' && /^\d[\d,]*$/.test(v.trim()) ? Number(v.replace(/,/g, '')) : null);

export class LeadError extends Error { constructor(status, message) { super(message); this.status = status; } }

// The model's reply -> { companies, people }; people are grouped under their company (one company row per name).
export function toLeads(raw, categories = []) {
  const companies = [];
  const byName = new Map();
  const companyFor = (name, extra = {}) => {
    const clean = cleanText(name, 160);
    const k = normName(clean);
    if (!k) return null;
    if (!byName.has(k)) {
      const kind_guess = KIND_GUESSES.includes(extra.kind_guess) ? extra.kind_guess : 'unclear';
      const c = {
        key: `c${companies.length}`, name: clean, domain: normalizeDomain(extra.domain) || null, employees: int(extra.employees),
        hq: cleanText(extra.hq, 120) || null, kind_guess, category: kind_guess === 'partner' && categories.includes(extra.category) ? extra.category : null,
        evidence: cleanText(extra.evidence, 200), people: [],
      };
      byName.set(k, c);
      companies.push(c);
    }
    return byName.get(k);
  };
  for (const c of Array.isArray(raw?.companies) ? raw.companies : []) if (c && typeof c === 'object') companyFor(c.name, c);
  let count = 0;
  for (const p of Array.isArray(raw?.people) ? raw.people : []) {
    if (!p || typeof p !== 'object') continue;
    const name = cleanText(p.name, 120);
    const company = companyFor(p.company);
    if (!name || !company) continue;
    if (company.people.some(x => x.name.toLowerCase() === name.toLowerCase())) continue;
    company.people.push({
      name, title: cleanText(p.title, 160) || null, location: cleanText(p.location, 120) || null,
      linkedin_url: normalizeLinkedinUrl(p.linkedin_url), why: cleanText(p.why, 300) || null,
    });
    count++;
  }
  if (count > MAX_PEOPLE) throw new LeadError(413, `The list has ${count} people - split the list (up to ${MAX_PEOPLE} per upload)`);
  return { companies, people_count: count };
}

const OWNER_COLS = 'owner_team, co_owner_name, no_double_touch, source_kind, source_partner_id, source_person';

// Everything the cross-check reads, once per request. Same row sets as the dupe check, plus owner and source
// columns and the people already stored.
export async function loadLeadContext(supabase, businessId) {
  const page = build => selectAllPages(() => build(supabase).eq('business_id', businessId));
  const [partners, opportunities, companies, targets, domains, contacts, people] = await Promise.all([
    page(s => s.from('sales_goals').select(`id, name, archived_at, pipeline_status, category, ${OWNER_COLS}`).eq('goal_type', 'partnership').order('id')),
    page(s => s.from('sales_opportunities').select(`id, organization, archived_at, stage, org_type, notes, ${OWNER_COLS}`).order('id')),
    page(s => s.from('sales_sequenced_accounts').select('account_id, name, employees').order('account_id')),
    page(s => s.from('sales_targets').select(`id, name, status, kind, research_notes, ${OWNER_COLS}`).order('id')),
    page(s => s.from('partner_domains').select('goal_id, domain').eq('confirmed', true).order('goal_id').order('domain')),
    page(s => s.from('partner_contacts').select('id, goal_id, name').order('id')),
    page(s => s.from('sales_people').select('id, company_type, opportunity_id, target_id, name').order('id')),
  ]);
  return { partners, opportunities, companies: companies.filter(c => c.name), targets, domains, contacts, people };
}

const ROW_OF = { partner: ['partners', 'id'], opportunity: ['opportunities', 'id'], target: ['targets', 'id'], account: ['companies', 'account_id'] };
const STATUS_OF = { partner: 'partner', opportunity: 'employer', target: 'target', account: 'apollo_only' };
const ORDER = { partner: 0, opportunity: 1, account: 2, target: 3 };

export function sourceLabel(row, partners) {
  if (!row?.source_kind) return null;
  const partner = row.source_partner_id ? partners.find(p => p.id === row.source_partner_id)?.name : null;
  return [SOURCE_LABEL[row.source_kind] || row.source_kind, partner, row.source_person].filter(Boolean).join(' · ');
}

// One company -> its status, the record it matched, the owner chip, its existing source, people "Already in",
// and the review's defaults (kind, action, reason).
export function checkCompany(c, ctx) {
  const dupes = findDupes({ name: c.name, domain: c.domain }, ctx);
  const live = dupes.exact.filter(h => h.type in ROW_OF && !(h.type === 'target' && h.status === 'rejected'));
  const hit = live.sort((a, b) => a.archived - b.archived || ORDER[a.type] - ORDER[b.type])[0] || null;
  const [list, key] = hit ? ROW_OF[hit.type] : [];
  const row = hit ? ctx[list].find(r => r[key] === hit.id) : null;
  const status = hit ? STATUS_OF[hit.type] : dupes.partial.length ? 'possible_duplicate' : 'new';
  const chip = row && hit.type !== 'account' ? ownershipChip(row) : null;
  const stored = hit?.type === 'partner' ? ctx.contacts.filter(p => p.goal_id === hit.id)
    : hit?.type === 'opportunity' ? ctx.people.filter(p => p.opportunity_id === hit.id)
    : hit?.type === 'target' ? ctx.people.filter(p => p.target_id === hit.id) : [];
  const people = c.people.map(p => ({ ...p, already_in: stored.some(s => s.name.trim().toLowerCase() === p.name.toLowerCase()) }));
  const kind = hit?.type === 'partner' ? 'partner' : hit?.type === 'target' ? 'target' : hit ? 'employer'
    : c.kind_guess === 'partner' ? 'partner' : c.kind_guess === 'employer' ? 'employer' : 'target';
  let action = status === 'new' || status === 'apollo_only' ? 'create' : status === 'possible_duplicate' ? 'skip' : 'add_people';
  let reason = status === 'possible_duplicate' ? `Looks like ${dupes.partial.map(d => d.name).join(', ')} - check before creating` : null;
  if (chip?.skip) { action = 'skip'; reason = chip.text; }
  if (action === 'add_people' && !people.some(p => !p.already_in)) { action = 'skip'; reason = reason || 'Everyone here is already in'; }
  return {
    ...c, people, status, kind, action, reason, chip,
    match: hit && hit.type !== 'account' ? { type: hit.type, id: hit.id, name: hit.name, ...(hit.type === 'partner' ? { pipeline_status: row.pipeline_status || 'not_started' } : {}), ...(hit.type === 'opportunity' ? { stage: row.stage } : {}), ...(hit.type === 'target' ? { status: row.status } : {}) } : null,
    apollo_account_id: hit?.type === 'account' ? hit.id : null,
    existing_source: row && hit.type !== 'account' ? sourceLabel(row, ctx.partners) : null,
    possible: dupes.partial.map(d => ({ type: d.type, id: d.id, name: d.name })),
  };
}

export const crossCheck = (leads, ctx) => leads.companies.map(c => checkCompany(c, ctx));

// The upload's source from the picker -> source columns (a partner referral must name a partner in Pipeline).
export function uploadSource({ pick, partner_id = null, person = null, note = null }, partners) {
  const kind = PICKS[pick];
  if (!kind || !SOURCE_KINDS.includes(kind)) throw new LeadError(400, `source must be one of ${Object.keys(PICKS).join('|')}`);
  const partner = kind === 'partner_referral' ? partners.find(p => p.id === partner_id) : null;
  if (kind === 'partner_referral' && !partner) throw new LeadError(400, 'pick the partner that referred these leads');
  const who = cleanText(person, 120) || null;
  if (kind === 'person_referral' && !who) throw new LeadError(400, 'type the name of the person who referred these leads');
  return { source_kind: kind, source_partner_id: partner?.id || null, source_person: who, source_note: cleanText(note, 300) || null };
}

// The dated line a company gets: "Apollo recommended Oct 26: VP HR Operations; 377,000 employees".
export function contextLine(source, c, day) {
  const md = new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const what = source.source_kind === 'apollo' ? 'Apollo recommended' : `Lead list (${SOURCE_LABEL[source.source_kind]})`;
  const facts = [[...new Set(c.people.map(p => p.title).filter(Boolean))].slice(0, 3).join(', '), c.employees ? `${c.employees.toLocaleString('en-US')} employees` : null].filter(Boolean).join('; ');
  return cleanText(`${what} ${md}${facts ? `: ${facts}` : ''}`, 400);
}

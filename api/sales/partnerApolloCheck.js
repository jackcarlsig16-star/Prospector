import { getSupabase, weekIsFinal, FINAL_ERROR, addDays } from './goalsShared.js';
import { laDateString } from './laDate.js';
import { CallCapError } from './apolloClient.js';
import { latestAccounts, partnersToSync, fetchContacts, storeContacts, applyStoredActivity, contactRow } from './partnerContactsSync.js';
import { matchApolloAccounts } from '../../src/constants/partnerDomains.js';

// partner-add-research-v1 Stage 3 - the Apollo people check for ONE partner,
// run after Confirm site or from "Check Apollo". The account match is the
// sync's own (confirmed domain vs the latest stored accounts snapshot, no
// call); the read is the sync's /contacts/search (0 credits) on its own
// counter, max 2 calls, and rows upsert exactly like the sync. No account,
// or an account with nobody in it -> ONE open "Enrich <X> in Apollo" to-do
// for whoever clicked; never a second while one is open. (A Tidy 'enrich'
// suggestion replaces the to-do in a later follow-on.)
// sales-ia-v2 P4: the same check for an employer (matched by its Apollo id or
// name) and a target (by name). They have no contacts table, so the people
// found come back as names + titles only and nothing is stored; the enrich
// to-do links to the opportunity / target.
export const CHECK_MAX_CALLS = 2;
export const ENRICH_DUE_DAYS = 2; // REVISABLE
export const ENRICH_CATEGORY = 'Apollo';
const enrichPrefix = name => `Enrich ${name} in Apollo`;
export const enrichText = (name, why) => `${enrichPrefix(name)}: ${why === 'no_account' ? 'not in Apollo yet' : 'no people found'}`;
const laMonday = d => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));
const err = (status, error) => Object.assign(new Error(error), { status });
const must = r => { if (r.error) throw err(500, r.error.message); return r.data; };

async function ensureEnrichTodo(supabase, { businessId, goal, userId, why, today, linkType = 'partner' }) {
  const open = must(await supabase.from('sales_week_goals').select('id, text, due_date, owner_user_id, week_start')
    .eq('business_id', businessId).eq('kind', 'todo').eq('status', 'open').eq('link_type', linkType).eq('link_id', goal.id));
  const existing = open.find(t => t.text.startsWith(enrichPrefix(goal.name)));
  if (existing) return { todo: existing, created: false };
  const week = laMonday(today);
  if (await weekIsFinal(supabase, businessId, week)) throw err(409, FINAL_ERROR);
  const todo = must(await supabase.from('sales_week_goals').insert({
    business_id: businessId, week_start: week, kind: 'todo', status: 'open', text: enrichText(goal.name, why),
    owner_user_id: userId, due_date: addDays(today, ENRICH_DUE_DAYS), link_type: linkType, link_id: goal.id,
    category: ENRICH_CATEGORY, sort_order: 0, created_by: userId,
  }).select('id, text, due_date, owner_user_id, week_start').single());
  return { todo, created: true };
}

// -> { status: 'found' | 'no_account' | 'no_people' | 'skipped', account, people: [{ name, title }],
//      inserted, updated, calls, todo, todo_created, reason? }. Names and titles only - no emails out.
export async function checkPartnerApollo(supabase, { businessId, goalId, userId, today = laDateString() }) {
  const goal = must(await supabase.from('sales_goals').select('id, name').eq('business_id', businessId).eq('id', goalId).eq('goal_type', 'partnership').maybeSingle());
  if (!goal) throw err(404, 'partner not found');
  const [domains, accounts] = await Promise.all([
    supabase.from('partner_domains').select('goal_id, domain, confirmed').eq('business_id', businessId).eq('goal_id', goalId).eq('confirmed', true).then(must),
    latestAccounts(supabase, businessId),
  ]);
  const ctx = { callCounter: { count: 0, max: CHECK_MAX_CALLS }, endpointCounts: {} };
  const out = { status: null, account: null, people: [], inserted: 0, updated: 0, calls: 0, todo: null, todo_created: false };
  const [match] = partnersToSync([goal], { [goal.id]: domains }, accounts);
  if (match) {
    out.account = { name: match.account.name || null };
    let result;
    try { result = await fetchContacts(ctx, match.account.id); }
    catch (e) { if (!(e instanceof CallCapError)) throw e; result = { contacts: null, reason: `call cap (${CHECK_MAX_CALLS}) hit` }; }
    out.calls = ctx.callCounter.count;
    if (!result.contacts) return { ...out, status: 'skipped', reason: result.reason };
    const rows = result.contacts.map(c => contactRow(businessId, goal.id, c)).filter(Boolean);
    if (rows.length) {
      Object.assign(out, await storeContacts(supabase, businessId, goal.id, rows));
      await applyStoredActivity(supabase, businessId, rows.map(r => r.apollo_contact_id));
      return { ...out, status: 'found', people: rows.map(r => ({ name: r.name, title: r.title })), truncated: !!result.truncated };
    }
  }
  const why = match ? 'no_people' : 'no_account';
  const { todo, created } = await ensureEnrichTodo(supabase, { businessId, goal, userId, why, today });
  return { ...out, status: why, todo, todo_created: created };
}

export const CHECK_TYPES = ['partner', 'employer', 'target'];
const LINK_TYPE = { employer: 'opportunity', target: 'target' };

// An employer or target: same shape as checkPartnerApollo; people are
// returned, not stored.
async function checkRecordApollo(supabase, { businessId, type, id, userId, today }) {
  const record = type === 'employer'
    ? must(await supabase.from('sales_opportunities').select('id, organization, apollo_account_id').eq('business_id', businessId).eq('id', id).is('archived_at', null).maybeSingle())
    : must(await supabase.from('sales_targets').select('id, name').eq('business_id', businessId).eq('id', id).maybeSingle());
  if (!record) throw err(404, `${type} not found`);
  const goal = { id: record.id, name: record.organization || record.name };
  const accounts = await latestAccounts(supabase, businessId);
  const account = (record.apollo_account_id && accounts.find(a => a.id === record.apollo_account_id)) || matchApolloAccounts({ name: goal.name }, accounts).byName[0] || null;
  const ctx = { callCounter: { count: 0, max: CHECK_MAX_CALLS }, endpointCounts: {} };
  const out = { status: null, account: null, people: [], inserted: 0, updated: 0, calls: 0, todo: null, todo_created: false };
  if (account) {
    out.account = { name: account.name || null };
    let result;
    try { result = await fetchContacts(ctx, account.id); }
    catch (e) { if (!(e instanceof CallCapError)) throw e; result = { contacts: null, reason: `call cap (${CHECK_MAX_CALLS}) hit` }; }
    out.calls = ctx.callCounter.count;
    if (!result.contacts) return { ...out, status: 'skipped', reason: result.reason };
    const people = result.contacts.map(c => contactRow(businessId, goal.id, c)).filter(Boolean).map(r => ({ name: r.name, title: r.title }));
    if (people.length) return { ...out, status: 'found', people, truncated: !!result.truncated };
  }
  const why = account ? 'no_people' : 'no_account';
  const { todo, created } = await ensureEnrichTodo(supabase, { businessId, goal, userId, why, today, linkType: LINK_TYPE[type] });
  return { ...out, status: why, todo, todo_created: created };
}

export async function checkCompanyApollo(supabase, { businessId, type, id, userId, today = laDateString() }) {
  if (!CHECK_TYPES.includes(type)) throw err(400, `type must be one of ${CHECK_TYPES.join('|')}`);
  if (type === 'partner') return checkPartnerApollo(supabase, { businessId, goalId: id, userId, today });
  return checkRecordApollo(supabase, { businessId, type, id, userId, today });
}

const sendCheck = (res, label, p) => p.then(r => res.json(r)).catch(e => {
  if (!e.status || e.status >= 500) console.error(`[${label}]`, e.message);
  res.status(e.status || 500).json({ error: e.message });
});

// POST /goals/partners/:id/apollo-check -> the shape above. Member+ (salesGate).
export function checkPartnerApolloRoute(req, res) {
  return sendCheck(res, 'partners/apollo-check', checkPartnerApollo(getSupabase(), { businessId: req.params.businessId, goalId: req.params.id, userId: req.auth.user.id }));
}

// POST /goals/company/:type/:id/apollo-check (sales-ia-v2 P4).
export function checkCompanyApolloRoute(req, res) {
  return sendCheck(res, 'company/apollo-check', checkCompanyApollo(getSupabase(), { businessId: req.params.businessId, type: req.params.type, id: req.params.id, userId: req.auth.user.id }));
}

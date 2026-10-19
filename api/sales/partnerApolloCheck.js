import { getSupabase, weekIsFinal, FINAL_ERROR, addDays } from './goalsShared.js';
import { laDateString } from './laDate.js';
import { CallCapError } from './apolloClient.js';
import { latestAccounts, partnersToSync, fetchContacts, storeContacts, applyStoredActivity, contactRow } from './partnerContactsSync.js';

// partner-add-research-v1 Stage 3 - the Apollo people check for ONE partner,
// run after Confirm site or from "Check Apollo". The account match is the
// sync's own (confirmed domain vs the latest stored accounts snapshot, no
// call); the read is the sync's /contacts/search (0 credits) on its own
// counter, max 2 calls, and rows upsert exactly like the sync. No account,
// or an account with nobody in it -> ONE open "Enrich <X> in Apollo" to-do
// for whoever clicked; never a second while one is open. (A Tidy 'enrich'
// suggestion replaces the to-do in a later follow-on.)
export const CHECK_MAX_CALLS = 2;
export const ENRICH_DUE_DAYS = 2; // REVISABLE
export const ENRICH_CATEGORY = 'Apollo';
const enrichPrefix = name => `Enrich ${name} in Apollo`;
export const enrichText = (name, why) => `${enrichPrefix(name)}: ${why === 'no_account' ? 'not in Apollo yet' : 'no people found'}`;
const laMonday = d => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));
const err = (status, error) => Object.assign(new Error(error), { status });
const must = r => { if (r.error) throw err(500, r.error.message); return r.data; };

async function ensureEnrichTodo(supabase, { businessId, goal, userId, why, today }) {
  const open = must(await supabase.from('sales_week_goals').select('id, text, due_date, owner_user_id, week_start')
    .eq('business_id', businessId).eq('kind', 'todo').eq('status', 'open').eq('link_type', 'partner').eq('link_id', goal.id));
  const existing = open.find(t => t.text.startsWith(enrichPrefix(goal.name)));
  if (existing) return { todo: existing, created: false };
  const week = laMonday(today);
  if (await weekIsFinal(supabase, businessId, week)) throw err(409, FINAL_ERROR);
  const todo = must(await supabase.from('sales_week_goals').insert({
    business_id: businessId, week_start: week, kind: 'todo', status: 'open', text: enrichText(goal.name, why),
    owner_user_id: userId, due_date: addDays(today, ENRICH_DUE_DAYS), link_type: 'partner', link_id: goal.id,
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

// POST /goals/partners/:id/apollo-check -> the shape above. Member+ (salesGate).
export async function checkPartnerApolloRoute(req, res) {
  try {
    res.json(await checkPartnerApollo(getSupabase(), { businessId: req.params.businessId, goalId: req.params.id, userId: req.auth.user.id }));
  } catch (e) {
    if (!e.status || e.status >= 500) console.error('[partners/apollo-check]', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
}

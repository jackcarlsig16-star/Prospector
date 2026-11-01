// grow-nav-filters-v1 S1 - the Brands space's filter engine: per-brand bucket values, faceted counts, the built-in
// views, server sort and paging. Pure functions over rows the route loads once per request (every workspace table read
// whole and paged on a unique column - never an id list in a URL). Contacts are read as brand_id where an address
// exists: the address itself never leaves the database.
import { HkError, STATUS_ORDER, selectAllPages, normName } from './hkShared.js';
import { activityOf } from './intelScore.js';
import { loadIntel } from './intelData.js';

const DAY = 864e5;
export const CLOSED = new Set(['passed', 'skipped', 'sponsor']);
export const WAITING_DAYS = 7; // REVISABLE (spec N3 Email > Waiting on them > n days)
export const PAGE_DEFAULT = 100, PAGE_MAX = 200;
// Built-in views (N3 Views): always listed, even at 0 (planner ruling 2). Pipeline = claimed onward, the old screen.
export const VIEWS = ['all', 'pipeline', 'my_open', 'unclaimed', 'overdue', 'sponsors', 'dnc', 'hot', 'targets'];
const PIPELINE_HIDDEN = new Set(['candidate', 'passed', 'skipped', 'sponsor']);
const SPONSORS = new Set(['sponsor', 'founding_partner']);
export const HEAT = ['hot', 'warm', 'cool', 'cold'];
export const RELATIONSHIPS = ['prospect', 'sponsor', 'founding_partner', 'do_not_contact'];
export const EMAIL = ['has_contact', 'no_contact', 'never', 'emailed', 'replied', 'waiting'];
export const DUE = ['overdue', 'week', 'later', 'none'];
// Buckets in rail order (N3). `fixed` = values listed in this order; otherwise most rows first.
// grow-mailbox-link-v1 L6 - Conversation (from linked Gmail threads) and Deal stage (from the thread reads).
export const CONVERSATION = ['waiting_us', 'waiting_them', 'discussing', 'any', 'none'];
export const DEAL = ['interested', 'discussing', 'scheduling', 'confirmed', 'declined', 'other'];
export const THEM_WAIT_DAYS = 3; // REVISABLE ("Waiting on them > 3 d")
export const BUCKETS = ['stage', 'heat', 'owner', 'relationship', 'segment', 'category', 'email', 'due', 'research', 'sponsor_months', 'place', 'conversation', 'deal'];
const FIXED = { stage: STATUS_ORDER, heat: HEAT, relationship: RELATIONSHIPS, email: EMAIL, due: DUE, research: ['yes', 'no'], sponsor_months: ['yes'], conversation: CONVERSATION, deal: DEAL };
export const SORTS = ['name', 'status', 'last_touch', 'next_due', 'created', 'heat', 'score'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FREE = /^[^@\n]{1,80}$/;

// One bucket value, checked. owner: me | <member uuid> | sheet:<owner_hint> | unclaimed | unclear (ruling 1, OwnerChip).
const VALID = {
  stage: v => STATUS_ORDER.includes(v), heat: v => HEAT.includes(v), relationship: v => RELATIONSHIPS.includes(v),
  owner: v => v === 'me' || v === 'unclaimed' || v === 'unclear' || UUID.test(v) || /^sheet:[^@\n]{1,40}$/.test(v),
  segment: v => /^[a-z_]{1,40}$/.test(v), category: v => FREE.test(v), email: v => EMAIL.includes(v), due: v => DUE.includes(v),
  research: v => v === 'yes' || v === 'no', sponsor_months: v => v === 'yes', place: v => FREE.test(v),
  conversation: v => CONVERSATION.includes(v), deal: v => DEAL.includes(v),
};
export const isFilterValue = (key, v) => typeof v === 'string' && !!VALID[key]?.(v);

// ?stage=sent,bumped&owner=me -> { stage: ['sent', 'bumped'], owner: ['me'] }. Unknown values are a 400, never ignored.
export function parseFilters(src = {}) {
  const out = {};
  for (const key of BUCKETS) {
    const raw = src[key];
    if (raw == null || raw === '') continue;
    const vals = [...new Set((Array.isArray(raw) ? raw : String(raw).split(',')).map(v => String(v).trim()).filter(Boolean))];
    if (vals.length > 30) throw new HkError(400, `too many ${key} values`);
    for (const v of vals) if (!isFilterValue(key, v)) throw new HkError(400, `unknown ${key} value`);
    if (vals.length) out[key] = vals;
  }
  return out;
}

// grow-ui-refresh U6 - one read for the list: the Briefing's loadIntel (brands, touches, replies, contacts with the address
// dropped, domain intel, members, settings) plus the sponsor months. `intelData` carries it on for the row score.
export async function loadFilterData(supabase, businessId, now = new Date()) {
  const [d, periods, threads, prefs] = await Promise.all([loadIntel(supabase, businessId, now), selectAllPages(() => supabase.from('hk_sponsor_periods').select('id, brand_id').eq('business_id', businessId).order('id')),
    selectAllPages(() => supabase.from('hk_brand_threads').select('id, brand_id, member_user_id, waiting_on, deal_stage, last_at, last_ours_at, last_theirs_at').eq('business_id', businessId).eq('link_state', 'linked').order('id')),
    supabase.from('hk_member_prefs').select('user_id, share_deal_status').eq('business_id', businessId)]);
  const threadsBy = {}; for (const t of threads) (threadsBy[t.brand_id] ||= []).push(t);
  const sharing = new Map((prefs.data || []).map(r => [r.user_id, r.share_deal_status !== false]));
  return { brands: d.brands, hasEmail: new Set(Object.entries(d.contactsBy).filter(([, cs]) => cs.some(c => c.has_email)).map(([id]) => id)), touches: d.touchesBy, replies: d.repliesBy, intel: new Set(Object.keys(d.intelByDomain)), months: new Set(periods.map(p => p.brand_id)), threads: threadsBy, sharing, intelData: d };
}

// Every bucket value one brand carries, plus the built-in views it belongs to.
export function valuesOf(b, data, { meId, now }) {
  const ts = data.touches[b.id] || [], rs = data.replies[b.id] || [];
  const waiting = activityOf(ts, rs, { now }).waiting_days;
  const due = b.next_due_at ? Date.parse(b.next_due_at) : null, t = now.getTime();
  const overdue = due != null && due < t && !CLOSED.has(b.status);
  const owner = [b.owner_user_id ? b.owner_user_id : b.owner_hint && String(b.owner_hint).trim() ? `sheet:${String(b.owner_hint).trim()}` : 'unclaimed'];
  if (b.owner_unclear) owner.push('unclear');
  const view = ['all'];
  if (!PIPELINE_HIDDEN.has(b.status)) view.push('pipeline');
  if (meId && b.owner_user_id === meId && !CLOSED.has(b.status)) view.push('my_open');
  if (!b.owner_user_id && b.status === 'candidate' && b.relationship === 'prospect') view.push('unclaimed');
  if (overdue) view.push('overdue');
  if (SPONSORS.has(b.relationship)) view.push('sponsors');
  if (b.relationship === 'do_not_contact') view.push('dnc');
  if (b.heat_band === 'hot' || b.heat_band === 'warm') view.push('hot');
  if (b.targeted_at) view.push('targets');
  return {
    view, stage: [b.status], heat: [b.heat_band || 'cold'], owner, relationship: [b.relationship], segment: [b.segment],
    category: [b.category || 'none'],
    email: [data.hasEmail.has(b.id) ? 'has_contact' : 'no_contact', ts.some(x => x.channel === 'email' && x.state === 'sent') ? 'emailed' : 'never', ...(rs.length ? ['replied'] : []), ...(waiting != null && waiting > WAITING_DAYS ? ['waiting'] : [])],
    // Overdue excludes closed statuses (ruling 4) - a closed brand's past date counts as no due date.
    due: [due == null || (due < t && !overdue) ? 'none' : overdue ? 'overdue' : due < t + 7 * DAY ? 'week' : 'later'],
    research: [(b.domain && data.intel.has(b.domain)) || (b.domain_suggested && data.intel.has(b.domain_suggested)) ? 'yes' : 'no'],
    sponsor_months: data.months.has(b.id) ? ['yes'] : [],
    place: [...(b.is_local ? ['local'] : []), ...(b.city ? [b.city] : [])],
    ...conversationOf(data.threads?.[b.id] || [], data.sharing, { meId, now }),
  };
}

// Existence counts every linked thread; who is waiting and the deal stage only from threads the caller may see in full
// (their own, or a member who shares their deal status).
function conversationOf(ts, sharing = new Map(), { meId, now }) {
  if (!ts.length) return { conversation: ['none'], deal: [] };
  const vis = ts.filter(r => r.member_user_id === meId || sharing.get(r.member_user_id) !== false), t = now.getTime();
  const c = [];
  if (vis.some(r => r.waiting_on === 'us')) c.push('waiting_us');
  if (vis.some(r => r.waiting_on === 'them' && r.last_ours_at && t - Date.parse(r.last_ours_at) > THEM_WAIT_DAYS * DAY)) c.push('waiting_them');
  if (vis.some(r => r.deal_stage === 'discussing')) c.push('discussing');
  return { conversation: [...c, 'any'], deal: [...new Set(vis.map(r => r.deal_stage).filter(Boolean))] };
}

// The list row's "Last contact <n> ago · <who>" + "Waiting on us / them <n> d" (L6): the newest linked thread; who is
// waiting only from a thread the caller may see in full. null = no linked conversation.
export function conversationSummary(ts, sharing = new Map(), { meId, now }) {
  if (!ts.length) return null;
  const newest = [...ts].sort((a, b) => String(b.last_at || '').localeCompare(String(a.last_at || '')))[0];
  const vis = ts.filter(r => r.member_user_id === meId || sharing.get(r.member_user_id) !== false).sort((a, b) => String(b.last_at || '').localeCompare(String(a.last_at || '')))[0];
  const since = iso => (iso ? Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / DAY)) : null);
  const w = vis && vis.waiting_on !== 'none' ? vis.waiting_on : null;
  return { last_at: newest.last_at, member_user_id: newest.member_user_id, waiting_on: w, waiting_days: w === 'us' ? since(vis.last_theirs_at) : w === 'them' ? since(vis.last_ours_at) : null };
}

const matchesQ = (b, q) => { const n = normName(q), raw = String(q).trim().toLowerCase(); return normName(b.name).includes(n) || (b.domain || '').includes(raw) || (b.aliases || []).some(a => normName(a).includes(n)); };
const SORT_KEY = { name: b => b.name.toLowerCase(), status: b => STATUS_ORDER.indexOf(b.status), last_touch: b => b.last_touch_at || null, next_due: b => b.next_due_at || null, created: b => b.created_at, heat: b => b.heat ?? 0, score: b => b.reach_score ?? null };
const DEFAULT_DIR = { name: 'asc', status: 'asc', last_touch: 'desc', next_due: 'asc', created: 'desc', heat: 'desc', score: 'desc' };

// { view, filters, q, sort, dir, page, limit, facets } -> { total, rows (brands), facets?, next_page }
// Within a bucket values OR, across buckets AND; a value's facet count = rows matching every OTHER active bucket (and
// the view) plus that value. Zero-count filter values are left out unless active; views always list all nine.
export function applyFilters(data, { view = 'all', filters = {}, q = '', sort = 'name', dir, page = 1, limit = PAGE_DEFAULT, facets = false, meId, now = new Date() }) {
  const resolve = (k, v) => (k === 'owner' && v === 'me' ? meId : v);
  const active = Object.fromEntries(Object.entries(filters).map(([k, vs]) => [k, new Set(vs.map(v => resolve(k, v)))]));
  const rows = data.brands.filter(b => !q || matchesQ(b, q)).map(b => ({ b, v: valuesOf(b, data, { meId, now }) }));
  const inView = r => r.v.view.includes(view);
  const passes = (r, skip) => Object.entries(active).every(([k, set]) => k === skip || r.v[k].some(x => set.has(x)));
  const hits = rows.filter(r => inView(r) && passes(r));
  const by = SORT_KEY[sort] || SORT_KEY.name, sign = (dir || DEFAULT_DIR[sort] || 'asc') === 'asc' ? 1 : -1;
  hits.sort((x, y) => {
    const a = by(x.b), c = by(y.b);
    if (a == null || c == null) return (a == null) - (c == null) || x.b.id.localeCompare(y.b.id);
    return (a < c ? -sign : a > c ? sign : 0) || x.b.id.localeCompare(y.b.id);
  });
  const start = (page - 1) * limit;
  const out = { total: hits.length, rows: hits.slice(start, start + limit).map(r => r.b), next_page: start + limit < hits.length ? page + 1 : null };
  if (facets) {
    const f = { view: VIEWS.map(v => [v, rows.filter(r => r.v.view.includes(v) && passes(r)).length]) };
    for (const k of BUCKETS) {
      const c = new Map();
      for (const r of rows) if (inView(r) && passes(r, k)) for (const x of r.v[k]) c.set(x, (c.get(x) || 0) + 1);
      for (const x of active[k] || []) if (!c.has(x)) c.set(x, 0);
      const order = FIXED[k];
      f[k] = [...c.entries()].filter(([x, n]) => n > 0 || active[k]?.has(x)).sort((a, z) => (order ? order.indexOf(a[0]) - order.indexOf(z[0]) : z[1] - a[1] || String(a[0]).localeCompare(String(z[0]))));
    }
    out.facets = f;
  }
  return out;
}

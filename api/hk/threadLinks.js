// grow-mailbox-link-v1 L1 / L3 / L4 - which brand a Gmail thread belongs to, the derived facts kept for it, and the hourly
// upkeep. A thread links when a participant's address is a brand contact (contact), its domain is the brand's saved
// domain (domain) or a high-confidence suggested one (suggested_domain - shown, never auto-acted on until saved); a brand
// name / alias in the subject alone is a 'review' row only (Review > Email links), never used by the backfill or any
// automatic action. Generic mail domains never match by domain; the team's and the member's own domains and ignored
// senders never match at all. Rows hold derived fields only - no subject, body, snippet or address.
import { parseAddress } from './gmailMime.js';
import { splitAddresses } from './inboxRules.js';
import { normName, TEAM_DOMAINS } from './hkShared.js';
import { GENERIC_WORDS } from '../sales/intakeMatch.js';

export const GENERIC_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'icloud.com', 'hotmail.com', 'aol.com', 'me.com', 'live.com', 'msn.com']); // REVISABLE
export const BACKFILL_DAYS = 180, READ_DAYS = 60; // REVISABLE (L2, L5)
export const AUTO_MATCHES = new Set(['domain', 'contact', 'manual']);
// grow-mailbox-link ruling (1): bulk mail never links - a List-Unsubscribe header or Gmail's Promotions / Updates tab.
export const BULK_LABELS = new Set(['CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES']);
export const isBulk = m => !!m.listUnsubscribe || (m.labelIds || []).some(l => BULK_LABELS.has(l));
// A link the automatic paths (thread reads, nudges, signals) may act on.
export const autoOk = row => row.link_state === 'linked' && AUTO_MATCHES.has(row.matched_by);

const NAME_MIN = 4;
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// brands: hk_brands rows; contacts: hk_contacts rows (with email); ignored: hk_ignored_senders.domain values;
// ownDomains: the mailbox owner's domain(s). -> { match(participants, subject) -> { brand_id, matched_by, link_state } | null,
// queries: { domains, suggested, addresses } for the backfill search }
export function buildMatcher({ brands = [], contacts = [], ignored = [], ownDomains = [] } = {}) {
  const blocked = new Set([...TEAM_DOMAINS, ...ownDomains, ...ignored].map(d => String(d || '').toLowerCase()).filter(Boolean));
  const live = new Map(brands.filter(b => !b.archived_at).map(b => [b.id, b]));
  const byDomain = new Map(), bySuggested = new Map(), byAddress = new Map(), names = [];
  const add = (m, k, id) => { if (!m.has(k)) m.set(k, id); };
  for (const b of live.values()) {
    const d = String(b.domain || '').toLowerCase();
    if (d && !GENERIC_DOMAINS.has(d) && !blocked.has(d)) add(byDomain, d, b.id);
    const s = String(b.domain_suggested || '').toLowerCase();
    if (!d && s && b.domain_confidence === 'high' && !GENERIC_DOMAINS.has(s) && !blocked.has(s)) add(bySuggested, s, b.id);
    for (const n of [b.name, ...(b.aliases || [])]) { const k = normName(n || ''); if (k.length >= NAME_MIN && !GENERIC_WORDS.has(k)) names.push({ re: new RegExp(`(^|[^a-z0-9])${escapeRe(k)}([^a-z0-9]|$)`), id: b.id }); }
  }
  for (const c of contacts) {
    const e = String(c.email || '').trim().toLowerCase(), dom = e.split('@')[1];
    if (live.has(c.brand_id) && dom && !blocked.has(dom)) add(byAddress, e, c.brand_id);
  }
  const match = (participants = [], subject = '') => {
    const ps = participants.filter(p => p?.email && !blocked.has(p.domain));
    for (const p of ps) if (byAddress.has(p.email)) return { brand_id: byAddress.get(p.email), matched_by: 'contact', link_state: 'linked' };
    for (const p of ps) if (byDomain.has(p.domain)) return { brand_id: byDomain.get(p.domain), matched_by: 'domain', link_state: 'linked' };
    for (const p of ps) if (bySuggested.has(p.domain)) return { brand_id: bySuggested.get(p.domain), matched_by: 'suggested_domain', link_state: 'linked' };
    const subj = normName(subject || '');
    const hit = subj && names.find(n => n.re.test(subj));
    return hit ? { brand_id: hit.id, matched_by: 'name', link_state: 'review' } : null;
  };
  return { match, queries: { domains: [...byDomain.keys()], suggested: [...bySuggested.keys()], addresses: [...byAddress.keys()] } };
}

// "From" / "To" / "Cc" header values -> [{ email, domain }]
export const peopleOf = (...headers) => headers.flatMap(h => splitAddresses(h)).map(parseAddress).filter(a => a.email).map(a => ({ email: a.email, domain: a.domain }));

// One thread's messages ([{ date ISO, from: { email, domain }, people }]) -> the L3 facts. ours = the mailbox owner's
// addresses / domains (own + team). waiting_on: the newest message is ours -> them, theirs -> us; a thread where only
// they wrote is 'none' until a read says otherwise (ruling 1: an unanswered one-way mail is not a reply we owe).
export function threadFacts(messages, { ownEmails = [], ownDomains = [] } = {}) {
  const own = new Set(ownEmails.map(e => e.toLowerCase())), ownD = new Set([...TEAM_DOMAINS, ...ownDomains].map(d => d.toLowerCase()));
  const isOurs = m => !!m.from?.email && (own.has(m.from.email) || ownD.has(m.from.domain));
  const ms = messages.filter(m => m.date).sort((a, b) => a.date.localeCompare(b.date));
  if (!ms.length) return { message_count: 0, first_at: null, last_at: null, last_ours_at: null, last_theirs_at: null, waiting_on: 'none' };
  const ours = ms.filter(isOurs), theirs = ms.filter(m => !isOurs(m)), last = ms[ms.length - 1];
  return {
    message_count: ms.length, first_at: ms[0].date, last_at: last.date,
    last_ours_at: ours.length ? ours[ours.length - 1].date : null, last_theirs_at: theirs.length ? theirs[theirs.length - 1].date : null,
    waiting_on: !ours.length ? 'none' : !theirs.length ? 'them' : isOurs(last) ? 'them' : 'us',
  };
}

// A metadata-format thread -> [{ date, from, people }] (headers From / To / Cc / Date; nothing else is read).
export function messagesOf(thread) {
  const h = (m, n) => (m.payload?.headers || []).find(x => x.name.toLowerCase() === n.toLowerCase())?.value || null;
  return (thread?.messages || []).map(m => {
    const d = Date.parse(h(m, 'Date') || '');
    const date = !Number.isNaN(d) ? new Date(d).toISOString() : m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null;
    const from = peopleOf(h(m, 'From'))[0] || null;
    const row = { date, from, people: peopleOf(h(m, 'From'), h(m, 'To'), h(m, 'Cc')), subject: h(m, 'Subject'), labelIds: m.labelIds || [], listUnsubscribe: !!h(m, 'List-Unsubscribe') };
    return { ...row, bulk: isBulk(row) };
  });
}

// The workspace has started linking once its first backfill run exists (Stage 3, on Jack's go). Until then the hourly
// upkeep, the automatic backfill for other members and the thread reads do nothing.
export async function linkingStarted(supabase, businessId) {
  const { data, error } = await supabase.from('hk_job_runs').select('id').eq('business_id', businessId).eq('job', 'thread-backfill').limit(1);
  if (error) throw new Error(error.message);
  return (data || []).length > 0;
}

export async function matcherFor(supabase, businessId, ownDomains) {
  const { selectAllPages } = await import('../lib/selectAllPages.js');
  const [brands, contacts, ign] = await Promise.all([
    selectAllPages(() => supabase.from('hk_brands').select('id, name, aliases, domain, domain_suggested, domain_confidence, archived_at').eq('business_id', businessId).is('archived_at', null).order('id')),
    selectAllPages(() => supabase.from('hk_contacts').select('brand_id, email').eq('business_id', businessId).not('email', 'is', null).order('id')),
    supabase.from('hk_ignored_senders').select('domain').eq('business_id', businessId),
  ]);
  if (ign.error) throw new Error(ign.error.message);
  return buildMatcher({ brands, contacts, ignored: (ign.data || []).map(r => r.domain), ownDomains });
}

// L4 - the hourly sync's new messages ([{ threadId, date, from, people, subject, labelIds }]) on this member's mailbox:
// a linked thread gets its last / ours / theirs / waiting_on and count moved forward; an unlinked one whose participants
// match is linked (a name-only match lands in Review). -> { updated, linked, review }
export async function linkSyncedMessages({ supabase, businessId, uid, messages, ownEmails = [], ownDomains = [], now = new Date() }) {
  const out = { updated: 0, linked: 0, review: 0 };
  const ms = (messages || []).filter(m => m.threadId && m.date && !isBulk(m));
  if (!ms.length || !(await linkingStarted(supabase, businessId))) return out;
  const matcher = await matcherFor(supabase, businessId, ownDomains);
  const { data: rows, error } = await supabase.from('hk_brand_threads').select('*').eq('business_id', businessId).eq('member_user_id', uid).in('gmail_thread_id', [...new Set(ms.map(m => m.threadId))]);
  if (error) throw new Error(error.message);
  const byThread = new Map((rows || []).map(r => [r.gmail_thread_id, r]));
  const own = new Set(ownEmails.map(e => e.toLowerCase())), ownD = new Set([...TEAM_DOMAINS, ...ownDomains]);
  for (const m of ms.sort((a, b) => a.date.localeCompare(b.date))) {
    const ours = !!m.from?.email && (own.has(m.from.email) || ownD.has(m.from.domain));
    const row = byThread.get(m.threadId);
    if (row) {
      if (row.last_at && m.date <= row.last_at) continue;
      const patch = { message_count: row.message_count + 1, last_at: m.date, waiting_on: ours ? 'them' : row.last_ours_at ? 'us' : 'none', updated_at: now.toISOString(), ...(ours ? { last_ours_at: m.date } : { last_theirs_at: m.date }) };
      const { error: e } = await supabase.from('hk_brand_threads').update(patch).eq('id', row.id);
      if (e) throw new Error(e.message);
      Object.assign(row, patch); out.updated++;
      continue;
    }
    const hit = matcher.match(m.people || [m.from], m.subject);
    if (!hit) continue;
    const ins = { business_id: businessId, brand_id: hit.brand_id, member_user_id: uid, gmail_thread_id: m.threadId, matched_by: hit.matched_by, link_state: hit.link_state, message_count: 1, first_at: m.date, last_at: m.date, last_ours_at: ours ? m.date : null, last_theirs_at: ours ? null : m.date, waiting_on: ours ? 'them' : 'none' };
    const { data: created, error: e } = await supabase.from('hk_brand_threads').upsert(ins, { onConflict: 'business_id,member_user_id,gmail_thread_id' }).select().single();
    if (e) throw new Error(e.message);
    byThread.set(m.threadId, created);
    out[hit.link_state === 'review' ? 'review' : 'linked']++;
  }
  return out;
}

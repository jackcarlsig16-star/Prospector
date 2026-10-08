// microsoft-connect-v1 Stage 3 - stage moves proposed from the Outlook read
// layer (microsoft_messages / microsoft_events), the same shape as the Apollo
// moves: the dry run proposes, Jack OKs keys, apply writes each move through
// applyPartnerSignal as a touch "from Outlook". Dedupe keys live in the
// event's meta.outlook_key once applied or dismissed.
import { selectAllPages } from '../lib/selectAllPages.js';
import { getSupabase } from './goalsShared.js';
import { hasRole } from '../lib/requireAuth.js';
import { laDateString } from './laDate.js';
import { isBehind } from './partnerApolloTouches.js';

export const SENT = 'first_email_sent', REPLIED = 'replied', MEETING = 'meeting_set';
export const TARGET_RANK = { [SENT]: 1, [REPLIED]: 2, [MEETING]: 3 };
// Jack, 2026-10-08: these never count as a reply - skipped and counted.
export const AUTO_SUBJECT_PREFIXES = ['automatic reply', 'out of office', 'undeliverable', 'delivery status notification'];
export const AUTO_SENDER_PREFIXES = ['postmaster@', 'noreply@', 'no-reply@', 'mailer-daemon@'];
export const NEEDS_OK = { cold_reply: 'reply outside a thread we started - needs Jack', meeting: 'meeting from the calendar - needs Jack' };

export const messageKey = m => `outlook:${m.internet_message_id || m.graph_id}`;
export const eventKey = e => `event:${e.ical_uid || e.graph_id}`;
export const personKey = c => `person:${c.goal_id}:${c.email}`;

export const isAutoMessage = m => {
  const subject = String(m.subject || '').trim().toLowerCase();
  return AUTO_SUBJECT_PREFIXES.some(p => subject.startsWith(p)) || (m.external_emails || []).some(e => AUTO_SENDER_PREFIXES.some(p => e.startsWith(p)));
};

// Confirmed domain first, then a known contact's address. Two partners on
// one message is ambiguous and never guessed.
export function buildIndex({ domains, contacts }) {
  const byDomain = new Map(), byEmail = new Map();
  for (const d of domains) if (d.confirmed !== false) byDomain.set(d.domain, d.goal_id);
  for (const c of contacts) if (c.email) byEmail.set(c.email.toLowerCase(), c.goal_id);
  return { byDomain, byEmail };
}

export function matchPartner(row, index) {
  const viaDomain = [...new Set((row.external_domains || []).map(d => index.byDomain.get(d)).filter(Boolean))];
  if (viaDomain.length > 1) return { ambiguous: viaDomain };
  if (viaDomain.length === 1) return { goal_id: viaDomain[0], via: 'domain', matched: (row.external_domains || []).find(d => index.byDomain.get(d) === viaDomain[0]) };
  const viaEmail = [...new Set((row.external_emails || []).map(e => index.byEmail.get(e)).filter(Boolean))];
  if (viaEmail.length > 1) return { ambiguous: viaEmail };
  if (viaEmail.length === 1) return { goal_id: viaEmail[0], via: 'email', matched: (row.external_emails || []).find(e => index.byEmail.get(e) === viaEmail[0]) };
  return null;
}

// The person a move names: the matched contact, else the first external
// address at the matched domain, shown as "Name <email>" or the email alone.
function personOf(row, match) {
  const emails = row.external_emails || [], names = row.external_names || [];
  let i = match.via === 'email' ? emails.indexOf(match.matched) : emails.findIndex(e => e.endsWith('@' + match.matched));
  if (i < 0) i = 0;
  return { email: emails[i] || null, name: names[i] || '', label: names[i] ? `${names[i]} <${emails[i]}>` : (emails[i] || '?') };
}

const dateOf = iso => laDateString(new Date(iso));

// One proposal per partner: the furthest target it is behind. Auto = safe
// for the daily step (a sent mail, or a reply inside a thread we started);
// everything else waits for an OK (held). Returns the people a Sent mail
// would add to partner_contacts too.
export function proposeOutlookMoves({ partners, domains, contacts, messages, events, partnerEvents, mailboxOwners = [], now = new Date() }) {
  const index = buildIndex({ domains, contacts });
  const partnerById = new Map(partners.map(p => [p.id, p]));
  const domainsByGoal = new Map();
  for (const d of domains) if (d.confirmed !== false) { if (!domainsByGoal.has(d.goal_id)) domainsByGoal.set(d.goal_id, new Set()); domainsByGoal.get(d.goal_id).add(d.domain); }
  const known = new Set(contacts.filter(c => c.email).map(c => `${c.goal_id}:${c.email.toLowerCase()}`));
  const ownerByMailbox = new Map(mailboxOwners.map(o => [o.mailbox_email, o.user_id]));
  const settled = new Map(partnerEvents.filter(e => e.meta?.outlook_key).map(e => [e.meta.outlook_key, e.meta.dismissed ? 'dismissed' : 'applied']));
  const ourThreads = new Set(messages.filter(m => m.direction === 'sent' && m.conversation_id).map(m => m.conversation_id));
  const today = laDateString(now);
  const counts = { messages: messages.length, events: events.length, skipped_auto: 0, unmatched: 0, ambiguous: 0, cancelled: 0 };
  const candidates = [], people = new Map();

  for (const m of messages) {
    if (m.direction === 'received' && isAutoMessage(m)) { counts.skipped_auto++; continue; }
    const match = matchPartner(m, index);
    if (!match) { counts.unmatched++; continue; }
    if (match.ambiguous) { counts.ambiguous++; continue; }
    const p = partnerById.get(match.goal_id);
    if (!p) continue;
    const person = personOf(m, match);
    const base = { goal_id: p.id, partner: p.name, from: p.pipeline_status || 'not_started', key: messageKey(m), source_at: m.occurred_at, date: dateOf(m.occurred_at),
      person: person.label, person_email: person.email, person_name: person.name, subject: m.subject || '', by_user: ownerByMailbox.get(m.mailbox_email) || null, mailbox: m.mailbox_email, via: match.via };
    if (m.direction === 'sent') {
      candidates.push({ ...base, to: SENT, auto: true, reason: `sent to ${person.label} on ${base.date}` });
      const mine = domainsByGoal.get(p.id) || new Set();
      for (let i = 0; i < (m.external_emails || []).length; i++) {
        const email = m.external_emails[i];
        if (!mine.has(email.slice(email.lastIndexOf('@') + 1)) || known.has(`${p.id}:${email}`)) continue;
        const prev = people.get(`${p.id}:${email}`);
        if (!prev || base.date < prev.first_seen) people.set(`${p.id}:${email}`, { key: personKey({ goal_id: p.id, email }), goal_id: p.id, partner: p.name, email, name: (m.external_names || [])[i] || prev?.name || '', first_seen: base.date, source_key: base.key });
      }
    } else {
      const inThread = !!(m.conversation_id && ourThreads.has(m.conversation_id));
      candidates.push({ ...base, to: REPLIED, auto: inThread, reason: `reply from ${person.label} on ${base.date}${inThread ? '' : ' (not in a thread we started)'}`, hold_reason: inThread ? null : NEEDS_OK.cold_reply });
    }
  }
  for (const e of events) {
    if (e.is_cancelled) { counts.cancelled++; continue; }
    const match = matchPartner(e, index);
    if (!match) { counts.unmatched++; continue; }
    if (match.ambiguous) { counts.ambiguous++; continue; }
    const p = partnerById.get(match.goal_id);
    if (!p) continue;
    const person = personOf(e, match);
    const start = dateOf(e.start_at);
    // A touch can't be dated in the future; a meeting booked for next week is
    // dated today and the meeting day travels in the reason + meta.
    candidates.push({ goal_id: p.id, partner: p.name, from: p.pipeline_status || 'not_started', key: eventKey(e), to: MEETING, auto: false, source_at: e.start_at, date: start > today ? today : start, meeting_date: start,
      person: person.label, person_email: person.email, person_name: person.name, subject: e.subject || '', by_user: ownerByMailbox.get(e.mailbox_email) || null, mailbox: e.mailbox_email, via: match.via,
      reason: `meeting "${e.subject || '(no subject)'}" with ${person.label} on ${start}`, hold_reason: NEEDS_OK.meeting });
  }

  // Per partner: furthest target it is behind; among equals the earliest.
  const byGoal = new Map();
  for (const c of candidates) { if (!byGoal.has(c.goal_id)) byGoal.set(c.goal_id, []); byGoal.get(c.goal_id).push(c); }
  const proposed = [], held = [], skipped = [];
  for (const [goalId, list] of byGoal) {
    const p = partnerById.get(goalId);
    const settledReason = c => `already ${settled.get(c.key)} (${c.key})`;
    const open = list.filter(c => !settled.has(c.key));
    for (const c of list.filter(c => settled.has(c.key))) skipped.push({ ...c, reason: `${c.reason} - ${settledReason(c)}` });
    if (p.pipeline_status === 'paused') { for (const c of open) skipped.push({ ...c, reason: `${c.reason} - partner is paused` }); continue; }
    const behind = open.filter(c => isBehind(p.pipeline_status, c.to));
    for (const c of open.filter(c => !isBehind(p.pipeline_status, c.to))) skipped.push({ ...c, reason: `${c.reason} - already at or past ${c.to} (${c.from})` });
    if (!behind.length) continue;
    behind.sort((a, b) => TARGET_RANK[b.to] - TARGET_RANK[a.to] || a.source_at.localeCompare(b.source_at));
    const pick = behind[0];
    for (const c of behind.slice(1)) skipped.push({ ...c, reason: `${c.reason} - ${pick.key} covers this partner this run` });
    (pick.auto ? proposed : held).push(pick);
  }
  const byName = (a, b) => a.partner.localeCompare(b.partner) || a.source_at.localeCompare(b.source_at);
  proposed.sort(byName); held.sort(byName); skipped.sort(byName);
  const wouldAdd = [...people.values()].sort((a, b) => a.partner.localeCompare(b.partner) || a.email.localeCompare(b.email));
  return { proposed, held, skipped, people: wouldAdd, counts: { ...counts, candidates: candidates.length, proposed: proposed.length, held: held.length, skipped: skipped.length, people: wouldAdd.length } };
}

export async function loadOutlookTouchInputs(supabase, businessId) {
  const [partners, domains, contacts, messages, events, partnerEvents, mailboxOwners] = await Promise.all([
    selectAllPages(() => supabase.from('sales_goals').select('id, name, pipeline_status, first_email_at, last_touch_at')
      .eq('business_id', businessId).eq('goal_type', 'partnership').is('archived_at', null).order('id')),
    selectAllPages(() => supabase.from('partner_domains').select('goal_id, domain, confirmed').eq('business_id', businessId).eq('confirmed', true).order('id')),
    selectAllPages(() => supabase.from('partner_contacts').select('goal_id, email, name').eq('business_id', businessId).not('email', 'is', null).order('id')),
    selectAllPages(() => supabase.from('microsoft_messages').select('graph_id, internet_message_id, conversation_id, direction, mailbox_email, external_emails, external_names, external_domains, subject, occurred_at')
      .eq('business_id', businessId).order('occurred_at').order('id')),
    selectAllPages(() => supabase.from('microsoft_events').select('graph_id, ical_uid, mailbox_email, organizer_email, external_emails, external_names, external_domains, subject, start_at, is_cancelled')
      .eq('business_id', businessId).order('start_at').order('id')),
    selectAllPages(() => supabase.from('sales_partner_events').select('goal_id, meta').eq('business_id', businessId).eq('source', 'outlook').order('id')),
    selectAllPages(() => supabase.from('sales_mailbox_owners').select('mailbox_email, user_id').eq('business_id', businessId).order('mailbox_email')),
  ]);
  return { partners, domains, contacts, messages, events, partnerEvents, mailboxOwners };
}

export async function dryRun(supabase, businessId, now = new Date()) {
  const inputs = await loadOutlookTouchInputs(supabase, businessId);
  const out = proposeOutlookMoves({ ...inputs, now });
  return { dry_run: true, computed_at: now.toISOString(), ...out, counts: { ...out.counts, partners: inputs.partners.length, confirmed_domains: inputs.domains.length, contacts: inputs.contacts.length, settled_before: inputs.partnerEvents.filter(e => e.meta?.outlook_key).length } };
}

// GET /goals/partners/outlook-touches - the dry run. Lists who wrote to whom,
// so members only (a GET passes salesGate at viewer level).
export async function outlookTouchesDryRunRoute(req, res) {
  const businessId = req.params.businessId;
  if (!hasRole(req, businessId, 'member')) return res.status(403).json({ error: 'You need member access to this workspace' });
  try {
    res.json(await dryRun(getSupabase(), businessId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

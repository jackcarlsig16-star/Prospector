import { selectAllPages } from '../lib/selectAllPages.js';
import { isAutoMessage } from './partnerOutlookTouches.js';

// microsoft-connect-v1 Stage 4a - the exact reply time Apollo never gives.
// A reply Apollo recorded (replied = true) is matched to the synced Outlook
// inbox: a received mail from that prospect's address (sales_prospect_state
// .email, from the Apollo payload) that landed after the Apollo message was
// delivered, never an auto-reply / bounce. The earliest such mail after each
// delivery wins, one Outlook mail serves one Apollo message, and replied_at
// is written once (rows that already carry it are never touched). No
// address, subject or body leaves the tables - counts only.

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

export function matchReplyTimes({ messages, prospects, received }) {
  const emailByContact = new Map(prospects.filter(p => p.email).map(p => [p.contact_id, p.email.toLowerCase()]));
  const mailsByEmail = new Map();
  for (const r of received) {
    if (r.direction !== 'received' || isAutoMessage(r)) continue;
    for (const e of r.external_emails || []) {
      const k = e.toLowerCase();
      if (!mailsByEmail.has(k)) mailsByEmail.set(k, []);
      mailsByEmail.get(k).push(r);
    }
  }
  for (const list of mailsByEmail.values()) list.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const counts = { candidates: 0, already: 0, no_email: 0, no_mail: 0, matched: 0 };
  const matched = [];
  const used = new Set();
  const candidates = messages.filter(m => m.replied).sort((a, b) => (a.delivered_at || '').localeCompare(b.delivered_at || ''));
  for (const m of candidates) {
    if (m.replied_at) { counts.already++; continue; }
    counts.candidates++;
    const email = emailByContact.get(m.contact_id);
    if (!email) { counts.no_email++; continue; }
    const after = m.delivered_at || '';
    const mail = (mailsByEmail.get(email) || []).find(r => r.occurred_at > after && !used.has(r.internet_message_id || r.graph_id));
    if (!mail) { counts.no_mail++; continue; }
    used.add(mail.internet_message_id || mail.graph_id);
    counts.matched++;
    matched.push({ apollo_message_id: m.apollo_message_id, contact_id: m.contact_id, replied_at: mail.occurred_at, replied_message_id: mail.internet_message_id || mail.graph_id, seen_at: m.replied_seen_at || null });
  }
  return { counts, matched };
}

export async function loadReplyTimeInputs(supabase, businessId) {
  const messages = await selectAllPages(() => supabase.from('sales_email_messages').select('apollo_message_id, contact_id, delivered_at, replied, replied_seen_at, replied_at')
    .eq('business_id', businessId).eq('replied', true).order('apollo_message_id'));
  const contactIds = [...new Set(messages.map(m => m.contact_id))];
  const prospects = [];
  for (const part of chunk(contactIds, 150)) {
    prospects.push(...await selectAllPages(() => supabase.from('sales_prospect_state').select('contact_id, email').eq('business_id', businessId).in('contact_id', part).not('email', 'is', null).order('contact_id')));
  }
  const received = await selectAllPages(() => supabase.from('microsoft_messages').select('graph_id, internet_message_id, direction, external_emails, subject, occurred_at')
    .eq('business_id', businessId).eq('direction', 'received').order('occurred_at').order('id'));
  return { messages, prospects, received };
}

export async function runOutlookReplyTimes(supabase, businessId, { dryRun = false } = {}) {
  const t0 = Date.now();
  const inputs = await loadReplyTimeInputs(supabase, businessId);
  const { counts, matched } = matchReplyTimes(inputs);
  let written = 0;
  if (!dryRun) {
    for (const m of matched) {
      const { data, error } = await supabase.from('sales_email_messages').update({ replied_at: m.replied_at, replied_message_id: m.replied_message_id })
        .eq('business_id', businessId).eq('apollo_message_id', m.apollo_message_id).is('replied_at', null).select('apollo_message_id');
      if (error) throw new Error(`reply times: write failed: ${error.message}`);
      written += data.length;
    }
  }
  console.log(`[outlook/reply-times] business=${businessId}${dryRun ? ' dry' : ''} replied=${counts.candidates + counts.already} already=${counts.already} no_email=${counts.no_email} no_mail=${counts.no_mail} matched=${counts.matched} written=${written} ${Date.now() - t0}ms`);
  return { ...counts, written, matches: matched.map(m => ({ apollo_message_id: m.apollo_message_id, replied_at: m.replied_at, seen_at: m.seen_at })) };
}

import { selectAllPages } from '../lib/selectAllPages.js';
import { laDateString } from './laDate.js';
import { tracksOf, senderLoad, changeContact, advancePatch } from './outreachRoutes.js';

// seif-campaign-v1 B6 / B6a - campaign sends and replies read off the
// sender's own Outlook (microsoft_messages, metadata only). Runs after each
// real Outlook sync of the sender; Prospector still never sends. A message
// to a contact's exact address = that contact's current step went out
// (same as clicking Sent; at most one step per contact per LA day); a
// message from that address after the first send = a reply. A manual Sent
// clicked the same LA day or later is that send, folded, never doubled. Bounces
// stay manual: non-delivery reports are not in the metadata (Stage 0).
// Addresses are compared here and nowhere else; nothing below returns or
// logs one.

const LIVE_CAMPAIGNS = ['active', 'paused'];
// A contact whose mail is no longer of interest drops out of the B6a keep set.
const UNTRACKED = ['opted_out', 'bounced', 'not_interested'];
export const RECENT_SYNC_MS = 3 * 864e5;
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };

// B6a: the exact addresses (lower-cased) graphSync keeps even when every
// outside address is a personal domain.
export async function campaignAddresses(supabase, businessId) {
  const campaigns = must(await supabase.from('sales_outreach_campaigns').select('id').eq('business_id', businessId).in('status', LIVE_CAMPAIGNS));
  if (!campaigns.length) return new Set();
  const rows = await selectAllPages(() => supabase.from('sales_outreach_contacts').select('id, email, status').eq('business_id', businessId).in('campaign_id', campaigns.map(c => c.id)).order('id'));
  return new Set(rows.filter(r => !UNTRACKED.includes(r.status)).map(r => r.email.toLowerCase()));
}

// -> { campaigns, contacts, sent, replied, folded, skipped }
export async function runCampaignOutlookMatch(supabase, { businessId, userId, now = new Date() }) {
  const counts = { campaigns: 0, contacts: 0, sent: 0, replied: 0, folded: 0, skipped: 0 };
  const campaigns = must(await supabase.from('sales_outreach_campaigns').select('id, name, sender_user_id, status, created_at').eq('business_id', businessId).eq('sender_user_id', userId).in('status', LIVE_CAMPAIGNS));
  if (!campaigns.length) return counts;
  counts.campaigns = campaigns.length;
  const since = campaigns.map(c => c.created_at).sort()[0];
  const [contacts, tracks, messages] = await Promise.all([
    selectAllPages(() => supabase.from('sales_outreach_contacts').select('id, business_id, campaign_id, name, email, track_id, status, current_step, next_due_date, last_sent_at, replied_at').eq('business_id', businessId).in('campaign_id', campaigns.map(c => c.id)).in('status', ['active', 'done']).order('id')),
    tracksOf(supabase, campaigns.map(c => c.id)),
    selectAllPages(() => supabase.from('microsoft_messages').select('id, direction, external_emails, occurred_at').eq('business_id', businessId).eq('user_id', userId)
      .gte('synced_at', new Date(now.getTime() - RECENT_SYNC_MS).toISOString()).gte('occurred_at', since).order('id')),
  ]);
  counts.contacts = contacts.length;
  if (!contacts.length || !messages.length) return counts;
  const events = await selectAllPages(() => supabase.from('sales_outreach_events').select('id, contact_id, kind, step_no, at, source, meta').eq('business_id', businessId).in('contact_id', contacts.map(c => c.id)).order('id'));
  const used = new Set(events.map(e => e.meta?.message_id).filter(Boolean));
  const byCampaign = new Map(campaigns.map(c => [c.id, c]));
  const loads = new Map();
  const loadFor = async campaign => {
    if (!loads.has(campaign.id)) loads.set(campaign.id, await senderLoad(supabase, businessId, campaign));
    return loads.get(campaign.id);
  };
  const byAddress = new Map();
  for (const m of [...messages].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))) {
    for (const e of m.external_emails || []) {
      const k = e.toLowerCase();
      if (!byAddress.has(k)) byAddress.set(k, []);
      byAddress.get(k).push(m);
    }
  }
  for (const contact of contacts) {
    const mine = (byAddress.get(contact.email.toLowerCase()) || []).filter(m => !used.has(m.id));
    if (!mine.length) continue;
    const steps = tracks.find(t => t.id === contact.track_id)?.steps || [];
    const evs = events.filter(e => e.contact_id === contact.id);
    for (const m of mine) {
      const day = laDateString(new Date(m.occurred_at));
      const at = new Date(m.occurred_at);
      try {
        if (m.direction === 'sent') {
          const sentThatDay = evs.filter(e => e.kind === 'sent' && laDateString(new Date(e.at)) === day);
          // The click that already counted this send: same LA day, or any
          // time after it (sent in the evening, marked Sent next morning).
          const manual = evs.filter(e => e.kind === 'sent' && e.source === 'manual' && !e.meta?.message_id
            && (laDateString(new Date(e.at)) === day || Date.parse(e.at) >= at.getTime())).sort((a, b) => a.at.localeCompare(b.at))[0];
          if (manual) {
            must(await supabase.from('sales_outreach_events').update({ meta: { ...manual.meta, message_id: m.id, folded: true } }).eq('id', manual.id).select('id'));
            manual.meta = { ...manual.meta, message_id: m.id };
            counts.folded++;
            continue;
          }
          if (contact.status !== 'active' || sentThatDay.length || !steps.length) { counts.skipped++; continue; }
          const patch = { ...advancePatch(steps, contact.current_step, day, await loadFor(byCampaign.get(contact.campaign_id))), last_sent_at: m.occurred_at };
          const r = await changeContact(supabase, { contact, now, patch, event: { kind: 'sent', step_no: contact.current_step, at: m.occurred_at, source: 'outlook', by_user: null, meta: { message_id: m.id } } });
          evs.push({ ...r.event, meta: { message_id: m.id } });
          Object.assign(contact, r.contact);
          counts.sent++;
        } else {
          const firstSend = evs.filter(e => e.kind === 'sent').map(e => Date.parse(e.at)).sort((a, b) => a - b)[0];
          if (!['active', 'done'].includes(contact.status) || firstSend == null || at.getTime() <= firstSend) { counts.skipped++; continue; }
          const r = await changeContact(supabase, { contact, now, patch: { status: 'replied', replied_at: m.occurred_at, next_due_date: null }, event: { kind: 'replied', at: m.occurred_at, source: 'outlook', by_user: null, meta: { message_id: m.id } } });
          Object.assign(contact, r.contact);
          counts.replied++;
          break;
        }
      } catch (e) {
        // A teammate's click on the same contact in between: theirs stands.
        if (e.status === 409) { counts.skipped++; break; }
        throw e;
      }
    }
  }
  return counts;
}

import { apolloRequest, CallCapError } from './apolloClient.js';

// sales-hot-prospects-v1 Stage 2. Values decided by Jack 2026-10-01 after
// the Stage 1 discovery. The date filter is on DELIVERY date (Apollo's own
// breadcrumb label), so the window is wide enough to catch opens on older
// emails.
const WINDOW_DAYS = 30;
const PER_PAGE = 100;
const MAX_PAGES_PER_STAT = 4;
const ACTIVITIES_PER_RUN = 30;
const ACTIVITIES_FIRST_BACKFILL = 60;
const RECHECK_AFTER_HOURS = 20;
// bounced/unsubscribed are not searched: those filter values were never
// confirmed live, and an ignored filter returns unfiltered messages.
// Bounce comes from each message's own `bounce` field instead, unsubscribe
// from contact.email_unsubscribed / reply_class.
const STATS = ['opened', 'clicked', 'replied'];

// Backstop for this step's own call counter - sync.js gives it a separate
// budget so it can't starve the metrics adapters' 50-call cap.
export const ACTIVITY_MAX_CALLS = STATS.length * MAX_PAGES_PER_STAT + ACTIVITIES_FIRST_BACKFILL;

const EVENT_TYPES = { open: 'open', click: 'click', reply: 'reply', bounce: 'bounce', unsubscribe: 'unsub' };

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function chunk(rows, size) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

function ownerForSender(email) {
  const local = (email || '').split('@')[0].toLowerCase();
  return local === 'jack' || local === 'cyrus' ? local : 'unassigned';
}

// No pagination object comes back (Stage 1), so a full page means "maybe
// more" - stop on a short page or at MAX_PAGES_PER_STAT.
async function searchMessages(ctx, stat, missing) {
  const now = Date.now();
  const out = [];
  for (let page = 1; page <= MAX_PAGES_PER_STAT; page++) {
    const query = new URLSearchParams({
      'emailer_message_stats[]': stat,
      emailer_message_date_range_mode: 'completed_at',
      'emailer_message_date_range[min]': isoDate(new Date(now - WINDOW_DAYS * 864e5)),
      // max is exclusive in Apollo ("Before <date>"), so tomorrow includes today.
      'emailer_message_date_range[max]': isoDate(new Date(now + 864e5)),
      per_page: String(PER_PAGE),
      page: String(page),
    }).toString();
    const json = await apolloRequest({ method: 'GET', path: '/emailer_messages/search', query, ctx });
    const messages = (json && json.emailer_messages) || [];
    out.push(...messages);
    if (messages.length < PER_PAGE) return out;
  }
  missing.push(`activity: ${stat} search filled ${MAX_PAGES_PER_STAT} pages - older messages not pulled`);
  return out;
}

function summaryRow(businessId, m) {
  return {
    business_id: businessId,
    apollo_message_id: m.id,
    contact_id: m.contact_id,
    sequence_id: m.emailer_campaign_id || null,
    step: typeof m.campaign_position === 'number' ? m.campaign_position : null,
    sender: m.from_email || null,
    delivered_at: m.completed_at || null,
    replied: !!m.replied,
    reply_class: m.reply_class || null,
    bounced: !!m.bounce,
    updated_at: new Date().toISOString(),
  };
}

export async function syncActivity({ ctx, supabase, businessId }) {
  const missing = [];
  const byId = new Map();
  const clickedIds = new Set();
  for (const stat of STATS) {
    for (const m of await searchMessages(ctx, stat, missing)) {
      if (!m.id || !m.contact_id) continue;
      byId.set(m.id, m);
      if (stat === 'clicked') clickedIds.add(m.id);
    }
  }
  const messages = [...byId.values()];

  const fetchedAtById = new Map();
  for (const ids of chunk(messages.map(m => m.id), 150)) {
    const { data, error } = await supabase
      .from('sales_email_messages')
      .select('apollo_message_id, activities_fetched_at')
      .eq('business_id', businessId)
      .in('apollo_message_id', ids);
    if (error) throw new Error(`activity: read messages failed: ${error.message}`);
    for (const r of data) fetchedAtById.set(r.apollo_message_id, r.activities_fetched_at);
  }

  const { count: everFetched, error: countErr } = await supabase
    .from('sales_email_messages')
    .select('apollo_message_id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .not('activities_fetched_at', 'is', null);
  if (countErr) throw new Error(`activity: count failed: ${countErr.message}`);
  const cap = everFetched ? ACTIVITIES_PER_RUN : ACTIVITIES_FIRST_BACKFILL;

  const isHot = m => !!m.replied || clickedIds.has(m.id);
  const newestFirst = (a, b) => (b.completed_at || '').localeCompare(a.completed_at || '');
  const neverFetched = messages.filter(m => !fetchedAtById.get(m.id));
  const recheckBefore = Date.now() - RECHECK_AFTER_HOURS * 3600 * 1000;
  const recheck = messages
    .filter(m => isHot(m) && fetchedAtById.get(m.id) && new Date(fetchedAtById.get(m.id)).getTime() < recheckBefore)
    .sort((a, b) => new Date(fetchedAtById.get(a.id)) - new Date(fetchedAtById.get(b.id)));
  const queue = [
    ...neverFetched.filter(isHot).sort(newestFirst),
    ...recheck,
    ...neverFetched.filter(m => !isHot(m)).sort(newestFirst),
  ].slice(0, cap);
  const queueBacklog = neverFetched.length + recheck.length - queue.length;

  const fetchedRows = [];
  const eventRows = [];
  const contacts = new Map();
  const unknownEventTypes = new Set();
  let capHit = false;

  for (const m of queue) {
    let json;
    try {
      json = await apolloRequest({ method: 'GET', path: `/emailer_messages/${m.id}/activities`, ctx });
    } catch (err) {
      if (err instanceof CallCapError) { capHit = true; break; }
      missing.push(`activity: activities for message ${m.id} failed: ${err.message}`);
      continue;
    }
    const em = (json && json.emailer_message) || {};
    fetchedRows.push({
      ...summaryRow(businessId, m),
      num_opens: typeof em.num_opens === 'number' ? em.num_opens : null,
      num_clicks: typeof em.num_clicks === 'number' ? em.num_clicks : null,
      last_opened_at: em.last_opened_at || null,
      last_clicked_at: em.last_clicked_at || null,
      activities_fetched_at: new Date().toISOString(),
    });

    for (const ev of em.emailer_message_events || []) {
      const event = EVENT_TYPES[ev.type];
      if (!event) { unknownEventTypes.add(ev.type); continue; }
      if (!ev.created_at) continue;
      eventRows.push({
        business_id: businessId,
        apollo_message_id: m.id,
        contact_id: m.contact_id,
        sequence_id: m.emailer_campaign_id || null,
        step: typeof m.campaign_position === 'number' ? m.campaign_position : null,
        sender: m.from_email || null,
        event,
        occurred_at: ev.created_at,
        reply_class: event === 'reply' ? (m.reply_class || null) : null,
        user_agent: ev.readable_user_agent || null,
        tracking_service: ev.third_party_tracking_service || null,
      });
    }

    const c = em.contact;
    if (c && c.id) {
      const prev = contacts.get(c.id);
      contacts.set(c.id, {
        snapshot: {
          business_id: businessId,
          contact_id: c.id,
          name: c.name || null,
          title: c.title || null,
          company: c.organization_name || null,
          linkedin_url: c.linkedin_url || null,
          // No phone, permanently (Jack, 2026-10-01): Apollo phone reveals cost
          // credits. Don't store it and don't add a reveal/enrich endpoint.
          email_unsubscribed: !!c.email_unsubscribed || m.reply_class === 'unsubscribe' || !!(prev && prev.snapshot.email_unsubscribed),
          updated_at: new Date().toISOString(),
        },
        owner: (prev && prev.owner) || ownerForSender(m.from_email),
      });
    }
  }
  if (unknownEventTypes.size) missing.push(`activity: unmapped event types skipped: ${[...unknownEventTypes].join(', ')}`);
  if (capHit) missing.push('activity: call cap hit mid-run - remaining messages carried to the next run');

  // Two upserts with uniform columns each - a mixed batch would null out the
  // activity columns on rows not fetched this run.
  const fetchedIds = new Set(fetchedRows.map(r => r.apollo_message_id));
  const summaryOnly = messages.filter(m => !fetchedIds.has(m.id)).map(m => summaryRow(businessId, m));
  for (const rows of [summaryOnly, fetchedRows]) {
    for (const part of chunk(rows, 500)) {
      const { error } = await supabase.from('sales_email_messages').upsert(part, { onConflict: 'business_id,apollo_message_id' });
      if (error) throw new Error(`activity: upsert messages failed: ${error.message}`);
    }
  }

  let eventsInserted = 0;
  for (const part of chunk(eventRows, 500)) {
    const { data, error } = await supabase
      .from('sales_email_activity')
      .upsert(part, { onConflict: 'business_id,apollo_message_id,event,occurred_at', ignoreDuplicates: true })
      .select('id');
    if (error) throw new Error(`activity: insert events failed: ${error.message}`);
    eventsInserted += data.length;
  }

  const contactIds = [...contacts.keys()];
  const existingContacts = new Set();
  for (const ids of chunk(contactIds, 150)) {
    const { data, error } = await supabase
      .from('sales_prospect_state')
      .select('contact_id')
      .eq('business_id', businessId)
      .in('contact_id', ids);
    if (error) throw new Error(`activity: read prospects failed: ${error.message}`);
    for (const r of data) existingContacts.add(r.contact_id);
  }
  // Existing rows get the snapshot columns only, so the huddle-owned fields
  // (owner, status, next action, notes) are never touched by a sync.
  const newProspects = contactIds.filter(id => !existingContacts.has(id))
    .map(id => ({ ...contacts.get(id).snapshot, owner: contacts.get(id).owner }));
  const snapshotUpdates = contactIds.filter(id => existingContacts.has(id)).map(id => contacts.get(id).snapshot);
  for (const part of chunk(newProspects, 500)) {
    const { error } = await supabase.from('sales_prospect_state').insert(part);
    if (error) throw new Error(`activity: insert prospects failed: ${error.message}`);
  }
  for (const part of chunk(snapshotUpdates, 500)) {
    const { error } = await supabase.from('sales_prospect_state').upsert(part, { onConflict: 'business_id,contact_id' });
    if (error) throw new Error(`activity: update prospects failed: ${error.message}`);
  }

  return {
    missing,
    counts: {
      messages_seen: messages.length,
      activities_fetched: fetchedRows.length,
      activities_cap: cap,
      backlog_after_run: queueBacklog + (queue.length - fetchedRows.length),
      events_inserted: eventsInserted,
      prospects_new: newProspects.length,
      prospects_updated: snapshotUpdates.length,
    },
  };
}

// email-by-member-v1 Stage 0 - READ-ONLY (0 writes, 0 Claude, 0 Apollo, no sends). HomeLover only.
// Declared scope: one paged read each of sales_email_daily_counts (day, mailbox, delivered, opened, clicked),
// sales_email_delivered (id, mailbox, day), sales_email_activity (message id, sender, event), sales_email_messages
// (id, sender), microsoft_events (user, mailbox), plus sales_mailbox_owners, microsoft_grants and the member list.
// Estimated 15 s and a few MB; hard cap 120 s. A mailbox prints as its DOMAIN and a per-domain ordinal - the local
// part of an address is never printed.
// Usage: node scripts/verify/email-by-member-v1-stage0.mjs
import { createRequire } from 'module';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { selectAllPages } = await import('../../api/lib/selectAllPages.js');
const { loadMembers } = await import('../../api/sales/teamEmails/send.js');

const t0 = Date.now();
setTimeout(() => { console.log('CAP: 120 s'); process.exit(1); }, 120000).unref();
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = (await svc.from('businesses').select('id').ilike('name', '%homelover%')).data[0].id;
const all = (table, cols, order, build = q => q) => selectAllPages(() => { let q = build(svc.from(table).select(cols).eq('business_id', HL)); for (const o of order) q = q.order(o); return q; });
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };

const [counts, delivered, activity, messages, events, owners, members] = await Promise.all([
  all('sales_email_daily_counts', 'day, mailbox, sequence_id, step, delivered, opened, clicked, replied', ['day', 'mailbox', 'sequence_id', 'step']),
  all('sales_email_delivered', 'apollo_message_id, mailbox, delivered_day', ['apollo_message_id']),
  all('sales_email_activity', 'id, apollo_message_id, sender, event', ['id'], q => q.in('event', ['open', 'click'])),
  all('sales_email_messages', 'apollo_message_id, sender, replied', ['apollo_message_id']),
  all('microsoft_events', 'id, user_id, mailbox_email, ical_uid, external_domains, is_cancelled', ['id']),
  svc.from('sales_mailbox_owners').select('mailbox_email, user_id').eq('business_id', HL).then(must),
  loadMembers(svc, HL),
]);
const grants = must(await svc.from('microsoft_grants').select('user_id, account_email, error').in('user_id', members.map(m => m.userId)));

const nameOf = new Map(members.map(m => [m.userId, m.firstName || 'a member']));
const domainOf = a => String(a || '').split('@')[1] || '(none)';
const localOf = a => String(a || '').split('@')[0];
const known = [...new Set([...counts.map(r => r.mailbox), ...delivered.map(r => r.mailbox), ...owners.map(o => o.mailbox_email), ...grants.map(g => (g.account_email || '').toLowerCase()).filter(Boolean)])].sort();
const ordinal = new Map();
for (const a of known) { const d = domainOf(a); const n = [...ordinal.keys()].filter(k => domainOf(k) === d).length + 1; ordinal.set(a, `${d} #${n}`); }
const tag = a => ordinal.get(a) || `${domainOf(a)} #?`;
const ownerOf = new Map(owners.map(o => [o.mailbox_email, o.user_id]));
const who = a => (ownerOf.has(a) ? nameOf.get(ownerOf.get(a)) || 'a non-member user' : 'UNMAPPED');

console.log('(a) mailboxes in sales_email_daily_counts');
for (const a of [...new Set(counts.map(r => r.mailbox))].sort()) {
  const rs = counts.filter(r => r.mailbox === a);
  console.log(`  ${tag(a)} · ${who(a)} · first ${rs[0].day} · last ${rs[rs.length - 1].day} · delivered ${rs.reduce((n, r) => n + r.delivered, 0)} · opened ${rs.reduce((n, r) => n + r.opened, 0)} · clicked ${rs.reduce((n, r) => n + r.clicked, 0)}`);
}
console.log('(a) mailboxes in sales_email_delivered');
for (const a of [...new Set(delivered.map(r => r.mailbox))].sort()) {
  const days = delivered.filter(r => r.mailbox === a).map(r => r.delivered_day).sort();
  console.log(`  ${tag(a)} · ${who(a)} · first ${days[0]} · last ${days[days.length - 1]} · rows ${days.length}`);
}

console.log('(b) microsoft_grants.account_email vs the map');
for (const g of grants) {
  const a = (g.account_email || '').toLowerCase();
  console.log(`  ${nameOf.get(g.user_id)} · ${tag(a)} · grant ${g.error ? 'errored' : 'ok'} · row in sales_mailbox_owners: ${ownerOf.has(a) ? (ownerOf.get(a) === g.user_id ? 'yes, same member' : 'yes, ANOTHER member') : 'NO'} · sends in daily_counts: ${counts.some(r => r.mailbox === a) ? 'yes' : 'no'}`);
}

console.log('(c) human filter inputs per mailbox');
const mailboxOfMsg = new Map(delivered.map(d => [d.apollo_message_id, d.mailbox]));
const senderOfMsg = new Map(messages.filter(m => m.sender).map(m => [m.apollo_message_id, m.sender.toLowerCase()]));
const countBoxes = new Set(counts.map(r => r.mailbox));
for (const ev of ['open', 'click']) {
  const rs = activity.filter(e => e.event === ev);
  const withSender = rs.filter(e => e.sender), inCounts = withSender.filter(e => countBoxes.has(e.sender.toLowerCase()));
  const viaDelivered = rs.filter(e => mailboxOfMsg.has(e.apollo_message_id)), viaMessage = rs.filter(e => senderOfMsg.has(e.apollo_message_id));
  const agree = rs.filter(e => e.sender && mailboxOfMsg.has(e.apollo_message_id)), same = agree.filter(e => e.sender.toLowerCase() === mailboxOfMsg.get(e.apollo_message_id));
  console.log(`  ${ev}: ${rs.length} rows · sender set ${withSender.length} · sender is a daily_counts mailbox ${inCounts.length} · message in sales_email_delivered ${viaDelivered.length} · message in sales_email_messages with sender ${viaMessage.length} · sender = delivered.mailbox on ${same.length} of ${agree.length}`);
}
console.log(`  replied messages: ${messages.filter(m => m.replied).length} · with sender ${messages.filter(m => m.replied && m.sender).length} · in sales_email_delivered ${messages.filter(m => m.replied && mailboxOfMsg.has(m.apollo_message_id)).length}`);

console.log('(d) meetings: microsoft_events by calendar');
const live = events.filter(e => !e.is_cancelled && (e.external_domains || []).length);
for (const a of [...new Set(events.map(e => e.mailbox_email))].sort()) console.log(`  ${domainOf(a)} · calendar of ${nameOf.get(events.find(e => e.mailbox_email === a).user_id)} · mapped to ${who(a)} · external events ${live.filter(e => e.mailbox_email === a).length}`);
const byUid = new Map();
for (const e of live) { const k = e.ical_uid || e.id; if (!byUid.has(k)) byUid.set(k, new Set()); byUid.get(k).add(e.mailbox_email); }
console.log(`  external meetings ${byUid.size} · on more than one calendar ${[...byUid.values()].filter(s => s.size > 1).length}`);

console.log('(f) sales_mailbox_owners today');
for (const o of [...owners].sort((x, y) => x.mailbox_email.localeCompare(y.mailbox_email))) console.log(`  ${tag(o.mailbox_email)} · ${nameOf.get(o.user_id) || 'a non-member user'}`);
console.log('(f) seed check: the .ai and .com form of each member address');
const swap = a => { const [l, d] = a.split('@'); const m = /^(.*)\.(ai|com)$/.exec(d || ''); return m ? `${l}@${m[1]}.${m[2] === 'ai' ? 'com' : 'ai'}` : null; };
const memberAddresses = new Map();
for (const o of owners) { if (!memberAddresses.has(o.user_id)) memberAddresses.set(o.user_id, new Set()); memberAddresses.get(o.user_id).add(o.mailbox_email); }
for (const g of grants) if (g.account_email) { if (!memberAddresses.has(g.user_id)) memberAddresses.set(g.user_id, new Set()); memberAddresses.get(g.user_id).add(g.account_email.toLowerCase()); }
for (const m of members) {
  const set = memberAddresses.get(m.userId);
  if (!set) { console.log(`  ${m.firstName} (${m.role}) · no mapped mailbox and no Microsoft grant`); continue; }
  for (const a of [...set].sort()) {
    const s = swap(a);
    const state = x => (x == null ? 'n/a' : ownerOf.get(x) === m.userId ? 'mapped' : ownerOf.has(x) ? 'mapped to ANOTHER member' : 'NOT mapped');
    console.log(`  ${m.firstName} (${m.role}) · ${domainOf(a)} ${state(a)} · ${s ? domainOf(s) : 'no sibling form'} ${state(s)}${s ? ` · sibling seen sending: ${countBoxes.has(s) ? 'yes' : 'no'}` : ''}`);
  }
}
const unmappedSenders = [...countBoxes].filter(a => !ownerOf.has(a));
console.log(`  daily_counts mailboxes with no row: ${unmappedSenders.length}${unmappedSenders.length ? ` (${unmappedSenders.map(tag).join(', ')})` : ''}`);
console.log(`  distinct local parts across every known mailbox: ${new Set(known.map(localOf)).size} over ${known.length} addresses`);
console.log(`rows read: counts ${counts.length} · delivered ${delivered.length} · activity ${activity.length} · messages ${messages.length} · events ${events.length} · ${((Date.now() - t0) / 1000).toFixed(1)} s · 0 writes`);

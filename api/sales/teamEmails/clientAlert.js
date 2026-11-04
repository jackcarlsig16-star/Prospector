import { SOURCE_LABEL } from '../../../src/constants/leadSources.js';
import { CLIENT_STATUS_LABEL } from '../../../src/constants/clients.js';
import { referredBy } from '../sourceRoutes.js';
import { claimSlot } from './scheduler.js';
import { sendTeamEmail, loadMembers } from './send.js';
import { esc, shell, table, link, recordUrl, withFooter, ACCENT, MUTED } from './format.js';

// homelover-team-emails-v1 T5 - "New client: <Company>" once per company. A client made after the settings'
// client_alert_since (and in the last day) alerts once its 2-minute Undo window has passed: right away when its
// lookalikes are in (add_lookalikes files them in one call), else after WAIT_MIN without them. The claim is a
// sales_job_slots row (job client-alert, slot = the company id), so an edit, a second instance or a restart never
// sends it again; an Undo before the alert leaves it unsent (the company is no longer a client).
export const UNDO_MS = 2 * 60e3;
export const WAIT_MIN = 30;
export const LOOKBACK_MS = 24 * 3600e3;
export const LOOKALIKES_SHOWN = 10;
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
export const ALERT_COLS = 'id, organization, client_status, eligible_now, eligible_added, eligible_added_note, expected_signing_date, expected_launch, source_kind, source_partner_id, source_person, source_note, owner_user_id, champion, notes, next_action, next_action_date, archived_at';
const mdy = d => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : null);
// champion is "Name, Title": only the title may go out.
const titleOnly = champion => { const i = String(champion || '').indexOf(', '); return i > 0 ? champion.slice(i + 2).trim() || null : null; };
const hqOf = notes => (String(notes || '').split('\n').find(l => l.startsWith('HQ: ')) || '').slice(4) || null;
export const lookalikeTag = org => `Lookalike of ${org}`;

export async function lookalikesOf(supabase, businessId, org) {
  return must(await supabase.from('sales_targets').select('id, name, employees, apollo_firmographics, evidence, owner_team, created_at').eq('business_id', businessId).eq('source_kind', 'lookalike').eq('source_note', lookalikeTag(org)).order('created_at'));
}

// Rulings Nov 4 (3): an alert that hit a blocked sender keeps its claim (status error, detail needs_reconnect +
// grant_at) and is not tried again until the sender's grant changes (a reconnect writes a new connected_at).
const heldFor = (slot, grantAt) => slot.detail?.status === 'needs_reconnect' && (slot.detail.grant_at ?? null) !== (grantAt ?? null);

// Clients due an alert now: [{ event, row, lookalikes }]. grantAt = the sender grant's connected_at now.
export async function dueAlerts(supabase, businessId, settings, now = Date.now(), grantAt = null) {
  const from = Math.max(Date.parse(settings.client_alert_since), now - LOOKBACK_MS);
  const events = must(await supabase.from('sales_client_events').select('id, opportunity_id, to_status, at').eq('business_id', businessId).eq('kind', 'made_client').gte('at', new Date(from).toISOString()).order('at'))
    .filter(e => now - Date.parse(e.at) >= UNDO_MS);
  if (!events.length) return [];
  const ids = [...new Set(events.map(e => e.opportunity_id))];
  const sent = new Set(must(await supabase.from('sales_job_slots').select('slot, detail').eq('job', 'client-alert').eq('scope', businessId).in('slot', ids)).filter(s => !heldFor(s, grantAt)).map(r => r.slot));
  const rows = new Map(must(await supabase.from('sales_opportunities').select(ALERT_COLS).eq('business_id', businessId).in('id', ids)).map(r => [r.id, r]));
  const out = [];
  for (const id of ids.filter(i => !sent.has(i))) {
    const row = rows.get(id), event = events.filter(e => e.opportunity_id === id).pop();
    if (!row || row.archived_at || !row.client_status) continue;
    const lookalikes = await lookalikesOf(supabase, businessId, row.organization);
    if (lookalikes.length || now - Date.parse(event.at) >= WAIT_MIN * 60e3) out.push({ event, row, lookalikes });
  }
  return out;
}

export function buildClientAlert(row, { lookalikes = [], partnerName = null, network = null, ownerName = null }) {
  const status = CLIENT_STATUS_LABEL[row.client_status] || row.client_status;
  const subject = `New client: ${row.organization} — ${status}`;
  const lives = [row.eligible_now != null ? `${row.eligible_now.toLocaleString('en-US')} eligible now` : null, row.eligible_added ? `+${row.eligible_added.toLocaleString('en-US')} being added${row.eligible_added_note ? ` (${row.eligible_added_note})` : ''}` : null].filter(Boolean).join(' · ');
  const source = row.source_kind ? `${SOURCE_LABEL[row.source_kind] || row.source_kind}${partnerName ? ` · ${partnerName}` : ''}` : 'Not set';
  const facts = [
    ['Status', status], ['Eligible lives', lives || null], ['Expected signing', mdy(row.expected_signing_date)], ['Launch', mdy(row.expected_launch)],
    ['Source', source], ['Owner', ownerName || 'Unassigned'], ['Primary contact', titleOnly(row.champion)], ['HQ', hqOf(row.notes)],
    ['Next step', row.next_action ? `${row.next_action}${row.next_action_date ? ` (${mdy(row.next_action_date)})` : ''}` : null],
  ].filter(([, v]) => v);
  const net = partnerName && network ? `Referred by ${partnerName} — ${partnerName}'s network: ${network.clients} ${network.clients === 1 ? 'client' : 'clients'} · ${network.lives.toLocaleString('en-US')} lives` : null;
  const shown = lookalikes.slice(0, LOOKALIKES_SHOWN);
  const why = t => String(t.evidence || '').split(' · ').filter(p => !p.startsWith('Lookalike of ')).join(' · ') || null;
  const laText = t => [t.name, t.employees != null ? `${t.employees.toLocaleString('en-US')} employees` : null, t.apollo_firmographics?.industry || null, why(t), t.owner_team === 'upside' ? 'Upside-owned' : null].filter(Boolean).join(' · ');
  const none = 'No lookalikes yet — run /apollo-deals';
  const head = shown.length ? `${shown.length} lookalikes` : null;
  const text = withFooter([
    subject, '', ...facts.map(([k, v]) => `${k}: ${v}`), recordUrl('employer', row.id), ...(net ? ['', net] : []), '',
    ...(shown.length ? [head, ...shown.map((t, i) => `${i + 1}. ${laText(t)}\n   ${recordUrl('target', t.id)}`)] : [none]),
  ].join('\n'));
  const factRows = facts.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:${MUTED};font-size:13px;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:4px 0;font-size:13px">${esc(v)}</td></tr>`).join('');
  const html = shell({
    eyebrow: 'HomeLover · New client', title: `${row.organization} — ${status}`, sub: null,
    body: [
      `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 10px">${factRows}</table>`,
      `<p style="margin:0 0 16px">${link(recordUrl('employer', row.id), `Open ${row.organization} →`)}</p>`,
      ...(net ? [`<p style="margin:0 0 16px">${esc(net)}</p>`] : []),
      shown.length
        ? `<div style="font-size:15px;font-weight:700;margin:8px 0">${esc(head)}</div>${table(['Company', 'Employees', 'Industry', 'Why'], shown.map(t2 => [
          `${link(recordUrl('target', t2.id), t2.name, 'font-weight:600')}${t2.owner_team === 'upside' ? ` <span style="font-size:11px;font-weight:700;color:${ACCENT}">Upside-owned</span>` : ''}`,
          t2.employees != null ? esc(t2.employees.toLocaleString('en-US')) : '—', esc(t2.apollo_firmographics?.industry || '—'), esc(why(t2) || '—'),
        ]))}`
        : `<p>${esc(none)}</p>`,
    ].join('\n'),
  });
  return { subject, html, text, lookalikes: shown.length };
}

// The alert for one client row: its referring partner's network, the owner's first name, its lookalikes.
export async function composeAlert(supabase, businessId, row, lookalikes) {
  const members = await loadMembers(supabase, businessId);
  let partnerName = null, network = null;
  if (row.source_kind === 'partner_referral' && row.source_partner_id) {
    const r = await referredBy(supabase, { businessId, id: row.source_partner_id });
    if (r.status === 200) { partnerName = r.body.partner.name; network = r.body.network.header; }
  }
  const ownerName = members.find(m => m.userId === row.owner_user_id)?.firstName || null;
  return buildClientAlert(row, { lookalikes, partnerName, network, ownerName });
}

// One alert: claim, build, send, mark the company's Activity. -> { status, recipients } or null when already claimed.
async function claimAlert(supabase, businessId, id, grantAt) {
  if (await claimSlot(supabase, 'client-alert', businessId, id)) return true;
  const prior = must(await supabase.from('sales_job_slots').select('slot, detail').eq('job', 'client-alert').eq('scope', businessId).eq('slot', id).maybeSingle());
  if (!prior || !heldFor(prior, grantAt)) return false;
  must(await supabase.from('sales_job_slots').delete().eq('job', 'client-alert').eq('scope', businessId).eq('slot', id).eq('status', 'error').select('slot'));
  return claimSlot(supabase, 'client-alert', businessId, id);
}

export async function sendClientAlert(supabase, businessId, { event, row, lookalikes }, deps, { grantAt = null } = {}) {
  if (!(await claimAlert(supabase, businessId, row.id, grantAt))) return null;
  const mail = await composeAlert(supabase, businessId, row, lookalikes);
  const sent = await sendTeamEmail(supabase, businessId, { kind: 'client', subject: mail.subject, html: mail.html, text: mail.text, slot: row.id, refId: row.id }, deps);
  if (sent.status === 'sent') {
    must(await supabase.from('sales_client_events').insert({ business_id: businessId, opportunity_id: row.id, kind: 'alert_sent', via: 'scheduler', to_status: row.client_status, meta: { recipients: sent.recipients, lookalikes: mail.lookalikes, send_id: sent.send_id, event_id: event.id } }).select('id'));
  }
  await supabase.from('sales_job_slots').update({ status: sent.status === 'sent' || sent.status === 'skipped' ? 'ok' : 'error', detail: { status: sent.status, recipients: sent.recipients, ...(sent.status === 'needs_reconnect' ? { grant_at: sent.grant_at ?? null } : {}) }, finished_at: new Date().toISOString() }).eq('job', 'client-alert').eq('scope', businessId).eq('slot', row.id);
  return sent;
}

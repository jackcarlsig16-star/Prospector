import { SA } from '../../theme';

// seif-campaign-v1 Stage 3 - the pure pieces behind Pipeline > Campaigns and
// the Actions campaign rows. A contact never carries an address here (the
// server sends has_email only).

export const CAMPAIGN_STATUS = { draft: 'Draft', active: 'Active', paused: 'Paused', done: 'Finished' };
export const CAMPAIGN_TONE = { draft: 'off', active: 'ok', paused: 'warn', done: 'off' };
export const CONTACT_STATUS = {
  queued: 'Not scheduled', active: 'Scheduled', replied: 'Replied', meeting: 'Meeting', not_interested: 'Not interested',
  bounced: 'Bounced', opted_out: 'Opted out', done: 'Finished',
};
// R5 status chips: each status its own hue, the label always on it.
export const CONTACT_STATUS_COLOR = {
  queued: SA.borderStrong, active: SA.accent, replied: SA.good, meeting: SA.good, not_interested: SA.muted,
  bounced: SA.bad, opted_out: SA.warn, done: SA.borderStrong,
};
export const SEGMENT_LABEL = { consultant_broker: 'Consultant / broker', corporate: 'Corporate' };
export const WARMTH_LABEL = { warm: 'Knows the sender', cold: "Doesn't know the sender" };
export const LINK_LABEL = { partner: 'Partner', employer: 'Employer', target: 'Target', opportunity: 'Employer' };

// A contact's own record link, as the company window expects it.
export function contactLink(c) {
  if (c.goal_id) return { type: 'partner', id: c.goal_id };
  if (c.opportunity_id) return { type: 'opportunity', id: c.opportunity_id };
  if (c.target_id) return { type: 'target', id: c.target_id };
  return null;
}

// What Promote makes by default: consultants / brokers become partners, corporate contacts employers.
export const defaultPromoteTo = segment => (segment === 'corporate' ? 'employer' : 'partner');
export const PROMOTE_OPTIONS = [['partner', 'Partner'], ['employer', 'Employer'], ['target', 'Target']];
// The statuses a person sets by hand (Mark…); bounces are manual (no bounce detection).
export const MARK_OPTIONS = [['meeting', 'Meeting booked'], ['not_interested', 'Not interested'], ['opted_out', 'Opted out'], ['bounced', 'Bounced']];

export const SAMPLE_CONTACT = { name: 'Alex Sample', title: 'Benefits Lead', company: 'Sample Co' };
const first = n => String(n || '').trim().split(/\s+/)[0] || '';
// The server's merge (outreachRoutes.js merge): {first_name} {company} {title}.
export const mergeFields = (text, c) => String(text || '').replace(/\{(first_name|company|title)\}/g, (_, k) => (k === 'first_name' ? first(c.name) : c[k] || ''));
export const MERGE_HELP = 'Merge fields: {first_name} {company} {title}';
export const clipboardText = d => `Subject: ${d.subject}\n\n${d.body}`;

export const EMPTY_FILTERS = { track: '', owner: '', status: '', due: '', q: '' };
export const activeFilterCount = f => ['track', 'owner', 'status', 'due', 'q'].filter(k => f[k]).length;
export const DUE_OPTIONS = [['today', 'Due today or late'], ['week', 'Due in 7 days'], ['none', 'No date']];

const plusDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
export function filterContacts(contacts, f, today) {
  const needle = f.q.trim().toLowerCase();
  return contacts.filter(c => (!f.track || c.track_id === f.track)
    && (!f.owner || c.owner_user_id === f.owner)
    && (!f.status || c.status === f.status)
    && (!f.due || (f.due === 'none' ? !c.next_due_date : !!c.next_due_date && c.next_due_date <= (f.due === 'today' ? today : plusDays(today, 7))))
    && (!needle || `${c.name} ${c.title || ''} ${c.company || ''}`.toLowerCase().includes(needle)));
}

// "1: 12 · 2: 4" - sends per step, in step order.
export const sentByStepText = byStep => Object.keys(byStep || {}).sort((a, b) => a - b).map(n => `Step ${n}: ${byStep[n]}`).join(' · ') || 'None yet';
export const rateText = r => (r == null ? '—' : `${r}%`);

// The buttons a contact's state allows (Actions rows and the contacts table share them).
export function contactMoves(c) {
  if (c.status === 'active') return { send: true, stop: true, skip: true, replied: true, mark: true, pause: true };
  if (c.status === 'replied') return { mark: true, promote: true };
  if (c.status === 'queued') return { stop: true, replied: true, resume: !!c.track_id };
  if (c.status === 'done') return { replied: true, mark: true, promote: true };
  if (c.status === 'meeting') return { mark: true, promote: true };
  return {};
}

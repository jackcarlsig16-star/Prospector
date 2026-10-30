import { STATUS_LABELS, STATUS_TONE, RELATIONSHIP_LABELS } from '../brands/verdict';
import { HEAT_WORDS } from '../signals/Heat';
import { sheetOwnerLabel } from '../brands/OwnerChip';
import { LABELS as REPLY_LABELS } from '../screens/RepliesScreen';

// grow-nav-filters-v1 N2-N4 + N9 - what the rail shows and how it rides in the address. The Brands space's state is
// view + bucket filters + sort + layout; the Inbox space's is one selection (a Gmail lane, a tracked-replies item or a
// queued-drafts item). Values and counts come from the server (GET /brands facets); nothing here lists data values.

export const VIEW_LABELS = { all: 'All', pipeline: 'Pipeline', my_open: 'My open', unclaimed: 'Unclaimed', overdue: 'Overdue', sponsors: 'Sponsors', dnc: 'Do not contact', hot: 'Hot leads', targets: 'Targets' };
export const BRAND_BUCKETS = [
  { key: 'stage', label: 'Stage', icon: 'flow' },
  { key: 'heat', label: 'Heat', icon: 'trend' },
  { key: 'owner', label: 'Owner', icon: 'people' },
  { key: 'relationship', label: 'Relationship', icon: 'link' },
  { key: 'segment', label: 'Segment', icon: 'grid' },
  { key: 'category', label: 'Category', icon: 'label' },
  { key: 'email', label: 'Email', icon: 'mail' },
  { key: 'due', label: 'Due', icon: 'clock' },
  { key: 'research', label: 'Research', icon: 'radar' },
  { key: 'sponsor_months', label: 'Sponsor months', icon: 'calendar' },
  { key: 'place', label: 'Place', icon: 'map' },
];
const BUCKET_KEYS = BRAND_BUCKETS.map(b => b.key);
const SEGMENTS = { sponsor_brand: 'Sponsor brand', press: 'Press', podcast: 'Podcast', nonprofit: 'Nonprofit', creator: 'Creator', university: 'University' };
const EMAIL = { has_contact: 'Has an email contact', no_contact: 'No email contact', never: 'Never emailed', emailed: 'Emailed', replied: 'Has a reply', waiting: 'Waiting on them over 7 days' };
const DUE = { overdue: 'Overdue', week: 'Due in 7 days', later: 'Due later', none: 'No due date' };
const words = v => String(v).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

// A bucket value as the rail and the chips say it. owner: the caller's own id reads "Me"; others by first name.
export function valueLabel(key, v, { meId, members = [] } = {}) {
  switch (key) {
    case 'stage': return STATUS_LABELS[v] || words(v);
    case 'heat': return HEAT_WORDS[v] || words(v);
    case 'owner': return v === 'me' || v === meId ? 'Me' : v === 'unclaimed' ? 'Unclaimed' : v === 'unclear' ? 'Unclear' : v.startsWith('sheet:') ? sheetOwnerLabel(v.slice(6)) : members.find(m => m.user_id === v)?.first_name || 'A former member';
    case 'relationship': return RELATIONSHIP_LABELS[v] || words(v);
    case 'segment': return SEGMENTS[v] || words(v);
    case 'category': return v === 'none' ? 'No category' : v;
    case 'email': return EMAIL[v] || v;
    case 'due': return DUE[v] || v;
    case 'research': return v === 'yes' ? 'Researched' : 'Not researched';
    case 'sponsor_months': return 'Has sponsor months';
    case 'place': return v === 'local' ? 'Local' : v;
    default: return v;
  }
}
// The colored dot beside a value - a chip tone class, never the only signal (the label is always there).
export const valueTone = (key, v) => (key === 'stage' ? STATUS_TONE[v] || 'grey' : key === 'heat' ? `heat-${v}` : null);
// The caller's own id is kept in the address as "me", so a shared link opens the viewer's own brands.
export const ownerValueOf = (v, meId) => (v === meId ? 'me' : v);

export function parseBrandQuery(qs = '') {
  const p = new URLSearchParams(qs);
  const filters = {};
  for (const k of BUCKET_KEYS) { const vs = (p.get(k) || '').split(',').map(x => x.trim()).filter(Boolean); if (vs.length) filters[k] = [...new Set(vs)]; }
  const view = VIEW_LABELS[p.get('view')] ? p.get('view') : p.get('saved') ? null : 'all';
  return { view: view || 'all', saved: p.get('saved') || null, filters, q: p.get('q') || '', sort: p.get('sort') || null, dir: p.get('dir') || null, layout: p.get('layout') === 'stage' || p.get('layout') === 'table' ? p.get('layout') : null };
}
export function brandQuery({ view = 'all', saved = null, filters = {}, q = '', sort = null, dir = null, layout = null }) {
  const p = new URLSearchParams();
  if (view && view !== 'all') p.set('view', view);
  if (saved) p.set('saved', saved);
  for (const k of BUCKET_KEYS) if (filters[k]?.length) p.set(k, filters[k].join(','));
  if (q) p.set('q', q);
  if (sort) p.set('sort', sort);
  if (dir) p.set('dir', dir);
  if (layout) p.set('layout', layout);
  return p.toString().replace(/%2C/g, ',').replace(/%3A/g, ':');
}
export const toggleValue = (state, key, v) => {
  const cur = state.filters[key] || [];
  const next = cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v];
  const filters = { ...state.filters, [key]: next };
  if (!next.length) delete filters[key];
  return { ...state, saved: null, filters };
};
export const activeCount = state => Object.values(state.filters).reduce((n, vs) => n + vs.length, 0) + (state.view !== 'all' ? 1 : 0) + (state.q ? 1 : 0);
// The Pipeline view opens grouped by stage unless the address says otherwise.
export const layoutOf = state => state.layout || (state.view === 'pipeline' ? 'stage' : 'table');

// The /brands?page= request for this state. The owner toggle is the default owner filter; an Owner bucket choice wins.
export function brandRequest(state, owner, { page = 1, limit = 100, facets = false } = {}) {
  const req = { page, limit, view: state.view };
  for (const [k, vs] of Object.entries(state.filters)) req[k] = vs.join(',');
  if (!state.filters.owner && owner && owner !== 'all') req.owner = owner;
  if (state.q) req.q = state.q;
  const sort = state.sort || (layoutOf(state) === 'stage' ? 'status' : null);
  if (sort) req.sort = sort;
  if (state.dir) req.dir = state.dir;
  if (facets) req.facets = '1';
  return req;
}

// Inbox space (N4): one selection at a time. lane = a Gmail lane; replies / drafts = the hosted DB lists.
export const MAIL_LANES = [['briefing', 'Briefing'], ['needs_you', 'Needs you'], ['brands', 'Brands'], ['other', 'Other'], ['sent', 'Sent'], ['drafts', 'Drafts']];
export const REPLY_ITEMS = [['open', 'Open'], ...REPLY_LABELS.map(([v, l]) => [v, l]), ['snoozed', 'Snoozed'], ['handled', 'Handled']];
export const DRAFT_ITEMS = [['all', 'All queued'], ['email', 'Email'], ['ig_dm', 'Instagram DM'], ['lint_failed', 'Lint failed'], ['older', 'Older than 3 days']];
export function parseInboxQuery(qs = '') {
  const p = new URLSearchParams(qs);
  if (REPLY_ITEMS.some(([v]) => v === p.get('replies'))) return { kind: 'replies', value: p.get('replies'), reply: p.get('reply') || null };
  if (DRAFT_ITEMS.some(([v]) => v === p.get('drafts'))) return { kind: 'drafts', value: p.get('drafts') };
  return { kind: 'lane', value: MAIL_LANES.some(([v]) => v === p.get('lane')) ? p.get('lane') : 'briefing' };
}
export const inboxQuery = ({ kind, value, reply = null }) => (kind === 'lane' ? (value === 'briefing' ? '' : `lane=${value}`) : `${kind}=${value}${reply ? `&reply=${reply}` : ''}`);

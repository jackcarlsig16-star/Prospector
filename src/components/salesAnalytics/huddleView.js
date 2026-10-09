// sales-huddle-v2 REV1 - how the Daily Huddle filters, ranks and groups
// prospects. Pure functions (tested in huddleView.test.js); the scores,
// Next Best Action, heat band and last signal all come from /huddle.

export const OWNER_LABELS = { jack: 'Jack', cyrus: 'Cyrus', unassigned: 'Unassigned' };
export const NEXT_ACTION_LABELS = { call: 'Call', email: 'Email', linkedin: 'LinkedIn', send_collateral: 'Send collateral', wait: 'Wait' };
export const ACTIVE_STATUSES = ['new', 'claimed', 'contacted'];
export const HEAT_LABELS = { hot: 'Hot', warm: 'Warm', cold: 'Cold' };

export function plusDays(isoDate, n) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// Sunday that ends today's Mon-Sun week.
export function weekEnd(today) {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  return plusDays(today, dow === 0 ? 0 : 7 - dow);
}

export function dueBucket(p, today) {
  const d = p.next_action_due;
  if (!d) return 'none';
  if (d < today) return 'overdue';
  if (d === today) return 'today';
  return d <= weekEnd(today) ? 'week' : 'later';
}

// Replies and real clicks first, in NBA_RULES order (next_best_action.rank),
// then overdue human actions, due today, LinkedIn touch, the rest.
function signalTier(p, today) {
  const nba = p.next_best_action;
  if (!['linkedin_touch', 'let_run'].includes(nba.id)) return [0, nba.rank];
  const due = dueBucket(p, today);
  if (due === 'overdue') return [1, 0];
  if (due === 'today') return [2, 0];
  return [nba.id === 'linkedin_touch' ? 3 : 4, 0];
}

const bySignal = today => (a, b) => {
  const [ta, ra] = signalTier(a, today), [tb, rb] = signalTier(b, today);
  return ta - tb || ra - rb || b.score - a.score;
};
export const SORTS = {
  signal: { label: 'Signal (reply first)', cmp: bySignal },
  heat: { label: 'Heat', cmp: () => (a, b) => b.score - a.score },
  due: { label: 'Due date', cmp: today => (a, b) => (a.next_action_due || '9999').localeCompare(b.next_action_due || '9999') || bySignal(today)(a, b) },
  activity: { label: 'Last activity', cmp: today => (a, b) => (b.last_signal_at || '').localeCompare(a.last_signal_at || '') || bySignal(today)(a, b) },
};

// "Needs action today": a human-set next action that's due/overdue, or no
// next action set and Next Best Action says something other than "let it run".
// Once Done (contacted) - or booked - the suggestion is handled and the row
// leaves (Jack, Stage 2); a due date someone set explicitly still brings it back.
export function needsAction(p, today) {
  if (!ACTIVE_STATUSES.includes(p.status)) return false;
  const due = dueBucket(p, today);
  if (due === 'overdue' || due === 'today') return true;
  if (p.status === 'contacted') return false;
  return !p.next_action && p.next_best_action.id !== 'let_run';
}
// Autopilot = nothing to do: the sequence runs and nobody has set a next action.
export const onAutopilot = (p, today) => ACTIVE_STATUSES.includes(p.status) && !needsAction(p, today) && p.next_best_action.id === 'let_run' && !p.next_action;

export function actionText(p, today) {
  const due = dueBucket(p, today);
  if (due === 'overdue' || due === 'today') return `${NEXT_ACTION_LABELS[p.next_action] || 'Follow up'} · ${due === 'overdue' ? 'overdue' : 'due today'}`;
  return p.next_action ? NEXT_ACTION_LABELS[p.next_action] : p.next_best_action.label;
}

// filters: { owner: 'team'|'jack'|'cyrus', heat: 'all'|band, due: 'all'|bucket, stale: bool }
export function applyFilters(prospects, f, today) {
  return prospects.filter(p =>
    (f.owner === 'team' || p.owner === f.owner)
    && (f.heat === 'all' || p.heat_band === f.heat)
    && (f.due === 'all' || (f.due === 'week' ? ['today', 'week'].includes(dueBucket(p, today)) : dueBucket(p, today) === f.due))
    && (!f.stale || p.stale));
}

export function sortProspects(list, sort, today) {
  return [...list].sort(SORTS[sort].cmp(today));
}

const BAND_ORDER = { hot: 0, warm: 1, cold: 2 };
export function byCompany(prospects, sort, today) {
  const groups = new Map();
  for (const p of prospects) {
    const key = (p.company || 'No company').trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  return [...groups.entries()].map(([company, people]) => {
    const sorted = sortProspects(people, sort, today);
    return { company, people: sorted, band: sorted.map(p => p.heat_band).sort((a, b) => BAND_ORDER[a] - BAND_ORDER[b])[0], owners: [...new Set(people.map(p => p.owner))] };
  }).sort((a, b) => BAND_ORDER[a.band] - BAND_ORDER[b.band] || b.people.length - a.people.length || a.company.localeCompare(b.company));
}

const md = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
// Chip + one-line context for a row, from the server's last_human_signal.
export function signalOf(p, today) {
  const s = p.last_human_signal;
  const due = dueBucket(p, today);
  const chip = s?.kind === 'reply' ? { label: 'Replied', tone: 'reply' }
    : s?.kind === 'click' ? { label: 'Clicked', tone: 'click' }
    : s?.kind === 'open' ? { label: `Opened ×${s.count}`, tone: 'open' }
    : due === 'overdue' ? { label: 'Overdue', tone: 'over' }
    : due === 'today' ? { label: 'Due', tone: 'due' } : null;
  const step = s?.step ? ` step ${s.step}` : '';
  const context = !s ? null
    : s.kind === 'reply' ? `Replied to${step || ' an email'}${s.reply_class && s.reply_class !== 'none_of_the_above' ? ` · ${s.reply_class.replace(/_/g, ' ')}` : ''}${s.at ? ` · ${s.exact ? 'replied' : 'seen'} ${md(s.at)}` : ''}`
    : s.kind === 'click' ? `Clicked${step} · ${md(s.at)}`
    : `Opened${step}${s.count > 1 ? ` ×${s.count}` : ''} · ${md(s.at)}`;
  return { chip, context };
}

// ── Recent activity feed (Stage 2) ──────────────────────────────────────────
const ORD = n => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`;
const TIME = iso => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' });
export const laDay = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

export function feedText(i) {
  const step = i.step ? ` step ${i.step}` : '';
  if (i.kind === 'reply') return `replied${step ? ` to${step}` : ''}${i.reply_class && i.reply_class !== 'none_of_the_above' ? `: ${i.reply_class.replace(/_/g, ' ')}` : ''} · ${i.seen_at_sync === false ? '' : 'seen at '}${TIME(i.at)}`;
  if (i.kind === 'click') return `clicked${step}`;
  return `opened${step}${i.nth > 1 ? ` (${ORD(i.nth)} time)` : ''}`;
}

export function timeAgo(iso, now = Date.now()) {
  const min = Math.round((now - Date.parse(iso)) / 60000);
  if (min < 60) return `${Math.max(min, 1)}m ago`;
  if (min < 24 * 60) return `${Math.round(min / 60)}h ago`;
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
}

// Today / Yesterday / Earlier, newest first, with the "new since last huddle"
// divider placed before the first item at or before the huddle.
export function groupFeed(items, today, lastHuddleAt) {
  const yesterday = plusDays(today, -1);
  const order = ['Today', 'Yesterday', 'Earlier'];
  const groups = new Map(order.map(d => [d, []]));
  let dividerAt = null;
  for (const i of items) {
    if (lastHuddleAt && !dividerAt && i.at <= lastHuddleAt && items[0].at > lastHuddleAt) dividerAt = i.key;
    const d = laDay(i.at);
    groups.get(d === today ? 'Today' : d === yesterday ? 'Yesterday' : 'Earlier').push(i);
  }
  return { days: order.map(day => ({ day, items: groups.get(day) })).filter(g => g.items.length), dividerAt };
}

// Feed rows follow the rail: person, heat (via the prospect's band), stale, and
// the bot toggle. Prospects the Huddle doesn't list (bounced, unsubscribed...)
// only show for "All" heat.
// kind (optional): 'open' | 'click' | 'reply' - a Huddle strip number or a
// Goals number opening the feed on one kind of event.
export function filterFeed(items, { owner, heat, stale, hideBots, kind }, bandById, staleById) {
  return items.filter(i => (!hideBots || !i.automated)
    && (!kind || i.kind === kind)
    && (owner === 'team' || i.owner === owner)
    && (heat === 'all' || bandById.get(i.contact_id) === heat)
    && (!stale || staleById.get(i.contact_id)));
}

// ── Flag for ... (Stage 3) ──────────────────────────────────────────────────
export const FLAG_STEPS = { email: 'Send a follow-up email', linkedin: 'Send a LinkedIn message' };
const EMAIL_ACTIONS = ['reply_today', 'book_meeting', 'contact_referral', 'find_contact', 'snooze', 'close'];
// Checklist from Next Best Action: replies -> email; opens / LinkedIn touch ->
// LinkedIn; a click (or anything else) -> both.
export function flagDefaults(p) {
  const id = p.next_best_action?.id;
  if (EMAIL_ACTIONS.includes(id)) return [FLAG_STEPS.email];
  if (id === 'linkedin_touch' || p.last_human_signal?.kind === 'open') return [FLAG_STEPS.linkedin];
  return [FLAG_STEPS.email, FLAG_STEPS.linkedin];
}

// Default assignee: the other of Jack / Cyrus from the prospect's owner; for
// unassigned prospects, the first member who isn't the person flagging.
export function defaultAssignee(p, members, myUserId) {
  const firstOf = m => m.name.split(' ')[0].toLowerCase();
  const other = { jack: 'cyrus', cyrus: 'jack' }[p.owner];
  return (other && members.find(m => firstOf(m) === other)) || members.find(m => m.user_id !== myUserId) || members[0] || null;
}

export const flagsFor = (flags, userId) => flags.filter(f => f.owner_user_id === userId);
export const allStepsDone = f => f.steps.length > 0 && f.steps.every(s => s.done);

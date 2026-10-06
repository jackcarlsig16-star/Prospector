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
export function needsAction(p, today) {
  if (!ACTIVE_STATUSES.includes(p.status)) return false;
  const due = dueBucket(p, today);
  if (due === 'overdue' || due === 'today') return true;
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
    : s.kind === 'reply' ? `Replied to${step || ' an email'}${s.reply_class && s.reply_class !== 'none_of_the_above' ? ` · ${s.reply_class.replace(/_/g, ' ')}` : ''}`
    : s.kind === 'click' ? `Clicked${step} · ${md(s.at)}`
    : `Opened${step}${s.count > 1 ? ` ×${s.count}` : ''} · ${md(s.at)}`;
  return { chip, context };
}

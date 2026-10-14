import { selectAllPages } from '../lib/selectAllPages.js';
import { addDays, laStartOfDayMs } from './goalsShared.js';
import { laDateString } from './laDate.js';
import { replyAt, replyWindow } from './replyTime.js';
import { scoreProspect } from './heatScore.js';
import { nextBestAction } from './nextBestAction.js';
import { openFlagRows } from './huddleFlags.js';
import { loadPartnerData, partnerWeekMetrics, isContact, PEOPLE_METRIC } from './partnerMetrics.js';
import { weekStripCounts } from './weekStripRoutes.js';
import { PIPELINE_STATUSES, stepOf } from '../../src/constants/partnerPipeline.js';

// weekly-plan-v1 - the compact context "Plan this week" sends to Claude, for
// one owner and one week. Read-only. Names, titles, companies, stages, dates
// and counts - never an email address or phone number (no email/phone
// column is selected anywhere below).

export const INPUT_MAX_CHARS = 40000;
const CAPS = { commitments: 20, todos: 60, replies: 30, partners: 60, flags: 30, last_week: 20 };
const TODO_WEEKS_BACK = 8;
// REVISABLE: a reply older than this isn't "waiting" any more.
const REPLY_DAYS = 21;
const HANDLED = ['contacted', 'booked', 'not_now', 'dead'];
const WAITING_NBA = ['reply_today', 'book_meeting', 'contact_referral'];
const COLD_DAYS = 60;
const DAY_MS = 864e5;

const stageLabel = id => PIPELINE_STATUSES.find(s => s.id === id)?.label || 'Not started';
const days = (fromMs, nowMs) => Math.floor((nowMs - fromMs) / DAY_MS);
const normName = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export async function loadPlanData(supabase, businessId, ownerId, weekStart) {
  const lastWeek = addDays(weekStart, -7);
  const replySince = new Date(Date.now() - REPLY_DAYS * DAY_MS).toISOString();
  const lastWeekIso = new Date(laStartOfDayMs(lastWeek)).toISOString();
  const q = (table, cols) => supabase.from(table).select(cols).eq('business_id', businessId);
  const [goals, partnerData, partnerExtra, mailboxes, replied, recentDelivered, recentReplies, dailyCounts, targets, accounts] = await Promise.all([
    selectAllPages(() => q('sales_week_goals', 'id, kind, text, status, owner_user_id, week_start, due_date, link_type, link_id, carried_from_id, prospect_contact_id, flag_note, why_not_done, plan_id, created_at, steps:sales_week_goal_steps(done)')
      .gte('week_start', addDays(weekStart, -7 * TODO_WEEKS_BACK)).lte('week_start', weekStart).order('week_start').order('id')),
    loadPartnerData(supabase, businessId),
    selectAllPages(() => q('sales_goals', 'id, last_touch_at, next_step, snoozed_until').eq('goal_type', 'partnership').is('archived_at', null).order('id')),
    q('sales_mailbox_owners', 'mailbox_email, user_id'),
    selectAllPages(() => replyWindow(q('sales_email_messages', 'apollo_message_id, contact_id, sender, replied, reply_class, replied_at, replied_seen_at').eq('replied', true), replySince).order('apollo_message_id')),
    selectAllPages(() => q('sales_email_messages', 'apollo_message_id, sender, delivered_at').gte('delivered_at', lastWeekIso).order('apollo_message_id')),
    selectAllPages(() => replyWindow(q('sales_email_messages', 'apollo_message_id, sender, reply_class, replied_at, replied_seen_at').eq('replied', true), lastWeekIso).order('apollo_message_id')),
    selectAllPages(() => q('sales_email_daily_counts', 'day, mailbox, sequence_id, step, delivered').gte('day', lastWeek).lte('day', addDays(lastWeek, 6)).order('day').order('mailbox').order('sequence_id').order('step')),
    q('sales_metric_targets', 'period_start, metric_key, goal, actual').eq('period', 'week').in('period_start', [lastWeek, weekStart]),
    selectAllPages(() => q('sales_sequenced_accounts', 'account_id, name').order('account_id')),
  ]);
  for (const r of [mailboxes, targets]) if (r.error) throw new Error(r.error.message);

  const contactIds = [...new Set([...replied.map(m => m.contact_id), ...goals.map(g => g.prospect_contact_id).filter(Boolean)])];
  const prospects = contactIds.length ? await selectAllPages(() => q('sales_prospect_state', 'contact_id, name, title, company, status, snooze_until, email_unsubscribed')
    .in('contact_id', contactIds).order('contact_id')) : [];
  return {
    goals, partnerData, partnerExtra, mailboxes: mailboxes.data, replied, recentDelivered, recentReplies,
    dailyCounts, targets: targets.data, accounts, prospects,
  };
}

// Pure: raw rows -> { inputs, text, ids }. ids are what a proposal may link to.
export function assemblePlanContext(data, { ownerId, weekStart, nowMs = Date.now(), maxChars = INPUT_MAX_CHARS }) {
  const today = laDateString(new Date(nowMs));
  const weekEnd = addDays(weekStart, 6), lastWeek = addDays(weekStart, -7);
  const mine = r => !ownerId || r.owner_user_id === ownerId;
  const ownerMailboxes = new Set(data.mailboxes.filter(m => !ownerId || m.user_id === ownerId).map(m => m.mailbox_email));
  const prospectById = new Map(data.prospects.map(p => [p.contact_id, p]));
  const partnerById = new Map(data.partnerData.partners.map(p => [p.id, p]));
  const accountById = new Map(data.accounts.map(a => [a.account_id, a]));
  const linkName = g => {
    if (g.link_type === 'partner') { const p = partnerById.get(g.link_id); return p ? `partner ${p.name} (${stageLabel(p.pipeline_status)})` : null; }
    if (g.link_type === 'company') return accountById.get(g.link_id)?.name ? `company ${accountById.get(g.link_id).name}` : null;
    if (g.link_type === 'metric') return `metric ${g.link_id}`;
    if (g.link_type === 'commitment') return 'commitment';
    return null;
  };

  // Newest copy only: a to-do carried to a later week is the later row.
  const current = openFlagRows(data.goals);
  const unfinished = g => !(g.kind === 'todo' && g.steps?.length && g.steps.every(s => s.done));
  const commitments = current.filter(g => g.kind === 'commitment' && g.week_start === weekStart && g.status === 'open' && (g.owner_user_id === ownerId || !g.owner_user_id))
    .map(g => ({ id: g.id, text: g.text, team: !g.owner_user_id, planned: !!g.plan_id }));
  const allTodos = current.filter(g => g.kind === 'todo' && g.status === 'open' && unfinished(g));
  const todos = allTodos.filter(g => !g.prospect_contact_id && mine(g) && (!g.due_date || g.due_date <= weekEnd))
    .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.created_at.localeCompare(b.created_at))
    .map(g => ({
      id: g.id, text: g.text, due_date: g.due_date, overdue: !!g.due_date && g.due_date < today,
      link_type: g.link_type, link_id: g.link_id, link: linkName(g),
      steps: g.steps?.length ? `${g.steps.filter(s => s.done).length}/${g.steps.length}` : null,
      carried: !!g.carried_from_id, age_days: days(Date.parse(g.created_at), nowMs),
    }));
  const flags = allTodos.filter(g => g.prospect_contact_id && mine(g)).map(g => {
    const p = prospectById.get(g.prospect_contact_id) || {};
    return { id: g.id, person: p.name || null, title: p.title || null, company: p.company || null, note: g.flag_note || g.text, age_days: days(Date.parse(g.created_at), nowMs) };
  });

  // Replies waiting: only replied messages are loaded, which is enough - for a
  // contact with a reply nextBestAction never reaches the click/open rules.
  const repliesByContact = new Map();
  for (const m of data.replied) { if (!repliesByContact.has(m.contact_id)) repliesByContact.set(m.contact_id, []); repliesByContact.get(m.contact_id).push(m); }
  const accountByName = new Map();
  for (const a of data.accounts) { const n = normName(a.name); if (n) accountByName.set(n, accountByName.has(n) ? null : a.account_id); }
  const replies = [];
  for (const [contactId, msgs] of repliesByContact) {
    const p = prospectById.get(contactId);
    if (!p || p.email_unsubscribed || HANDLED.includes(p.status) || (p.snooze_until && p.snooze_until > today)) continue;
    const latest = msgs.reduce((a, b) => ((replyAt(b) || '') > (replyAt(a) || '') ? b : a));
    if (ownerId && !ownerMailboxes.has((latest.sender || '').toLowerCase())) continue;
    const nba = nextBestAction(msgs, [], scoreProspect(msgs, []));
    if (!WAITING_NBA.includes(nba.id)) continue;
    replies.push({
      person: p.name || null, title: p.title || null, company: p.company || null, company_id: accountByName.get(normName(p.company)) || null,
      action: nba.label, reason: nba.reason, rank: nba.rank, replied_on: replyAt(latest) ? laDateString(new Date(replyAt(latest))) : null,
    });
  }
  replies.sort((a, b) => a.rank - b.rank || (b.replied_on || '').localeCompare(a.replied_on || ''));

  const extra = new Map(data.partnerExtra.map(p => [p.id, p]));
  const openTasksByPartner = new Map();
  for (const t of allTodos) if (t.link_type === 'partner') openTasksByPartner.set(t.link_id, (openTasksByPartner.get(t.link_id) || 0) + 1);
  const owned = data.partnerData.partners.filter(p => p.owner_user_id === ownerId);
  const partners = (owned.length ? data.partnerData.partners.filter(p => !p.owner_user_id || p.owner_user_id === ownerId) : data.partnerData.partners).map(p => {
    const x = extra.get(p.id) || {};
    const touch = (data.partnerData.byGoal.get(p.id) || []).filter(e => !data.partnerData.undone.has(e.id) && e.event !== 'undo' && isContact(e)).pop();
    return {
      id: p.id, name: p.name, tier: p.tier || null, stage: stageLabel(p.pipeline_status), step: p.pipeline_status === 'paused' ? -1 : stepOf(p.pipeline_status),
      last_touch: x.last_touch_at ? laDateString(new Date(x.last_touch_at)) : null,
      channel: touch ? (touch.event === 'touch' ? touch.touch_type : 'stage move') : null,
      days_since: x.last_touch_at ? days(Date.parse(x.last_touch_at), nowMs) : null,
      next_step: x.next_step || null, open_tasks: openTasksByPartner.get(p.id) || 0,
      snoozed: !!(x.snoozed_until && x.snoozed_until > today),
    };
  }).sort((a, b) => b.step - a.step || (b.days_since ?? -1) - (a.days_since ?? -1));

  const lastWeekCommitments = data.goals.filter(g => g.kind === 'commitment' && g.week_start === lastWeek && (g.owner_user_id === ownerId || !g.owner_user_id))
    .map(g => ({ id: g.id, text: g.text, status: g.status, why_not_done: g.why_not_done || null }));
  const strip = weekStripCounts({ from: lastWeek, delivered: data.recentDelivered, opens: [], replies: data.recentReplies, events: data.partnerData.events, deliveredAt: new Map() });
  const inLastWeek = r => r.day >= lastWeek && r.day <= addDays(lastWeek, 6);
  const ownSender = r => !ownerId || ownerMailboxes.has((r.sender || r.mailbox || '').toLowerCase());
  const pm = partnerWeekMetrics(data.partnerData, lastWeek, ownerId, nowMs);
  const lastWeekNumbers = {
    sent: data.dailyCounts.filter(ownSender).reduce((n, r) => n + (r.delivered || 0), 0),
    real_replies: strip.senders.filter(r => inLastWeek(r) && ownSender(r)).reduce((n, r) => n + r.tracked_real_replies, 0),
    meetings_team: strip.days.filter(inLastWeek).reduce((n, r) => n + r.meetings, 0),
    partners_first_touched: pm.partners_first_touched.value,
    people_first_touched: pm[PEOPLE_METRIC].value,
  };
  const targetRows = week => data.targets.filter(t => t.period_start === week).map(t => ({ metric: t.metric_key, goal: t.goal == null ? null : Number(t.goal), actual: t.actual == null ? null : Number(t.actual) }));

  const sections = {
    this_week_commitments: commitments.slice(0, CAPS.commitments),
    todos: todos.slice(0, CAPS.todos),
    replies_waiting: replies.slice(0, CAPS.replies),
    partners: partners.slice(0, CAPS.partners),
    flags: flags.slice(0, CAPS.flags),
    last_week: { commitments: lastWeekCommitments.slice(0, CAPS.last_week), numbers: lastWeekNumbers, targets: targetRows(lastWeek) },
    targets_this_week: targetRows(weekStart),
  };
  const full = { this_week_commitments: [commitments, CAPS.commitments], todos: [todos, CAPS.todos], replies_waiting: [replies, CAPS.replies],
    partners: [partners, CAPS.partners], flags: [flags, CAPS.flags], last_week_commitments: [lastWeekCommitments, CAPS.last_week] };
  const trimmed = {
    capped: Object.fromEntries(Object.entries(full).filter(([, [all, cap]]) => all.length > cap).map(([k, [all, cap]]) => [k, all.length - cap])),
    closed_last_week: 0, cold_partners: 0, undated_todos: 0,
  };

  // Over budget: drop closed last-week commitments, then partners untouched
  // 60+ days (or never), then undated to-dos - each from the least useful end.
  let text = renderText(sections, { weekStart, today });
  const shed = [
    ['closed_last_week', () => { const i = findLastIndex(sections.last_week.commitments, c => c.status !== 'open'); if (i < 0) return false; sections.last_week.commitments.splice(i, 1); return true; }],
    ['cold_partners', () => { const i = findLastIndex(sections.partners, p => p.days_since === null || p.days_since >= COLD_DAYS); if (i < 0) return false; sections.partners.splice(i, 1); return true; }],
    ['undated_todos', () => { const i = findLastIndex(sections.todos, t => !t.due_date); if (i < 0) return false; sections.todos.splice(i, 1); return true; }],
  ];
  for (const [key, drop] of shed) {
    while (text.length > maxChars && drop()) { trimmed[key]++; text = renderText(sections, { weekStart, today }); }
  }

  const ids = {
    commitment: new Set(sections.this_week_commitments.map(c => c.id)),
    partner: new Set(sections.partners.map(p => p.id)),
    company: new Set([...sections.replies_waiting.map(r => r.company_id), ...sections.todos.filter(t => t.link_type === 'company').map(t => t.link_id)].filter(Boolean)),
    todo: new Set([...sections.todos.map(t => t.id), ...sections.flags.map(f => f.id)]),
  };
  const counts = {
    this_week_commitments: sections.this_week_commitments.length, todos: sections.todos.length, replies_waiting: sections.replies_waiting.length,
    partners: sections.partners.length, flags: sections.flags.length,
    last_week_done: lastWeekCommitments.filter(c => c.status === 'done').length, last_week_total: lastWeekCommitments.length,
  };
  return { inputs: { week_start: weekStart, owner_user_id: ownerId, sections, counts, trimmed, chars: text.length }, text, ids };
}

function findLastIndex(arr, fn) { for (let i = arr.length - 1; i >= 0; i--) if (fn(arr[i])) return i; return -1; }

const line = (...parts) => parts.filter(p => p !== null && p !== undefined && p !== '').join(' | ');
function renderText(s, { weekStart, today }) {
  const out = [`WEEK OF ${weekStart} (today ${today})`];
  out.push('', `THIS WEEK'S COMMITMENTS (${s.this_week_commitments.length})`);
  for (const c of s.this_week_commitments) out.push(line(`commitment:${c.id}`, c.text, c.team ? 'team' : null, c.planned ? 'planned' : null));
  out.push('', `OPEN TO-DOS (${s.todos.length}) - point at one with existing_todo_id`);
  for (const t of s.todos) {
    out.push(line(`todo:${t.id}`, t.text, t.due_date ? `due ${t.due_date}${t.overdue ? ' OVERDUE' : ''}` : 'no due date',
      t.link ? `for ${t.link}${t.link_type === 'company' ? ` [company:${t.link_id}]` : ''}` : null, t.steps ? `steps ${t.steps}` : null, t.carried ? 'carried over' : null, `${t.age_days}d old`));
  }
  out.push('', `REPLIES WAITING (${s.replies_waiting.length})`);
  for (const r of s.replies_waiting) out.push(line(r.person, r.title, r.company, r.company_id ? `company:${r.company_id}` : null, r.action, r.reason, r.replied_on ? `replied ${r.replied_on}` : null));
  out.push('', `PARTNERS (${s.partners.length}) - warmest stage first`);
  for (const p of s.partners) {
    out.push(line(`partner:${p.id}`, p.name, p.tier ? `tier ${p.tier}` : null, p.stage,
      p.last_touch ? `last touch ${p.last_touch} (${p.days_since}d ago${p.channel ? `, ${p.channel}` : ''})` : 'never touched',
      p.next_step ? `next: ${p.next_step}` : null, p.open_tasks ? `${p.open_tasks} open tasks` : null, p.snoozed ? 'snoozed' : null));
  }
  out.push('', `HUDDLE FLAGS (${s.flags.length})`);
  for (const f of s.flags) out.push(line(`todo:${f.id}`, f.person, f.title, f.company, f.note, `${f.age_days}d old`));
  const lw = s.last_week;
  out.push('', `LAST WEEK - commitments ${lw.commitments.filter(c => c.status === 'done').length}/${lw.commitments.length} done`);
  for (const c of lw.commitments) out.push(line(c.text, c.status, c.why_not_done ? `why not: ${c.why_not_done}` : null));
  const n = lw.numbers;
  out.push(`numbers: sent ${n.sent}, real replies ${n.real_replies}, meetings (team) ${n.meetings_team}, partners first touched ${n.partners_first_touched}, people first touched ${n.people_first_touched}`);
  for (const t of lw.targets) out.push(line(`target ${t.metric}`, `goal ${t.goal ?? '-'}`, `actual ${t.actual ?? '-'}`));
  out.push('', `TARGETS THIS WEEK (${s.targets_this_week.length})`);
  for (const t of s.targets_this_week) out.push(line(t.metric, `goal ${t.goal ?? '-'}`));
  return out.join('\n');
}

export async function buildPlanContext(supabase, businessId, ownerId, weekStart) {
  return assemblePlanContext(await loadPlanData(supabase, businessId, ownerId, weekStart), { ownerId, weekStart });
}

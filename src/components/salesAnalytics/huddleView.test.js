import { applyFilters, sortProspects, needsAction, onAutopilot, byCompany, dueBucket, weekEnd, signalOf, actionText } from './huddleView';

// Tue 2026-10-06; its Mon-Sun week ends Sun 2026-10-11.
const T = '2026-10-06';
const nba = (id, rank) => ({ id, rank, label: id });
const P = (o) => ({ contact_id: o.id, name: o.id, company: 'Co', owner: 'jack', status: 'new', score: 0, heat_band: 'cold', stale: false,
  next_action: null, next_action_due: null, next_best_action: nba('let_run', 9), last_human_signal: null, last_signal_at: null, ...o });

const reply = P({ id: 'reply', score: 5, heat_band: 'hot', owner: 'cyrus', next_best_action: nba('reply_today', 2), last_human_signal: { kind: 'reply', step: 2, reply_class: 'follow_up_question' } });
const meet = P({ id: 'meet', score: 103, heat_band: 'hot', next_best_action: nba('book_meeting', 1), last_human_signal: { kind: 'reply', step: 1, reply_class: 'willing_to_meet' } });
const clicker = P({ id: 'clicker', score: 900, heat_band: 'hot', company: 'Big', next_best_action: nba('follow_up_clicked', 7), last_human_signal: { kind: 'click', step: 2, at: '2026-10-03T20:00:00Z' }, last_signal_at: '2026-10-03T20:00:00Z' });
const overdue = P({ id: 'overdue', score: 15, heat_band: 'warm', next_action: 'email', next_action_due: '2026-10-02' });
const dueToday = P({ id: 'dueToday', score: 3, next_action: 'call', next_action_due: T });
const opener = P({ id: 'opener', score: 15, heat_band: 'warm', owner: 'cyrus', company: 'Big', next_best_action: nba('linkedin_touch', 8), last_human_signal: { kind: 'open', step: 1, count: 3, at: '2026-10-05T17:00:00Z' } });
const quiet = P({ id: 'quiet', stale: true });
const later = P({ id: 'later', next_action: 'wait', next_action_due: '2026-10-20' });
const booked = P({ id: 'booked', status: 'booked', next_best_action: nba('reply_today', 2) });
const all = [quiet, opener, dueToday, overdue, clicker, reply, meet, later, booked];
const F = { owner: 'team', heat: 'all', due: 'all', stale: false };

test('signal sort: replies in rule order, then clicks, overdue, due today, LinkedIn - heat only breaks ties', () => {
  const needs = sortProspects(all.filter(p => needsAction(p, T)), 'signal', T).map(p => p.id);
  expect(needs).toEqual(['meet', 'reply', 'clicker', 'overdue', 'dueToday', 'opener']);
});

test('needs action excludes autopilot, future-dated and booked rows; autopilot is the let-run remainder', () => {
  expect(all.filter(p => needsAction(p, T)).map(p => p.id)).not.toEqual(expect.arrayContaining(['quiet', 'later', 'booked']));
  expect(all.filter(p => onAutopilot(p, T)).map(p => p.id)).toEqual(['quiet']);
});

test('other sorts', () => {
  expect(sortProspects([reply, clicker, meet], 'heat', T).map(p => p.id)).toEqual(['clicker', 'meet', 'reply']);
  expect(sortProspects([later, dueToday, overdue, quiet], 'due', T).map(p => p.id)).toEqual(['overdue', 'dueToday', 'later', 'quiet']);
  expect(sortProspects([opener, clicker, quiet], 'activity', T).map(p => p.id)).toEqual(['clicker', 'opener', 'quiet']);
});

test('filters: person, heat, due buckets, stale', () => {
  expect(applyFilters(all, { ...F, owner: 'cyrus' }, T).map(p => p.id).sort()).toEqual(['opener', 'reply']);
  expect(applyFilters(all, { ...F, heat: 'warm' }, T).map(p => p.id).sort()).toEqual(['opener', 'overdue']);
  expect(applyFilters(all, { ...F, due: 'overdue' }, T).map(p => p.id)).toEqual(['overdue']);
  expect(applyFilters(all, { ...F, due: 'today' }, T).map(p => p.id)).toEqual(['dueToday']);
  expect(applyFilters(all, { ...F, due: 'week' }, T).map(p => p.id)).toEqual(['dueToday']);
  expect(applyFilters(all, { ...F, due: 'none' }, T).length).toBe(6);
  expect(applyFilters(all, { ...F, stale: true }, T).map(p => p.id)).toEqual(['quiet']);
});

test('due buckets across the week end', () => {
  expect(weekEnd(T)).toBe('2026-10-11');
  expect(weekEnd('2026-10-11')).toBe('2026-10-11');
  expect(dueBucket(P({ next_action_due: '2026-10-11' }), T)).toBe('week');
  expect(dueBucket(P({ next_action_due: '2026-10-12' }), T)).toBe('later');
});

test('by company: one group per company, hottest first, people inside sorted', () => {
  const groups = byCompany([opener, clicker, quiet], 'signal', T);
  expect(groups.map(g => g.company)).toEqual(['Big', 'Co']);
  expect(groups[0].people.map(p => p.id)).toEqual(['clicker', 'opener']);
  expect(groups[0].band).toBe('hot');
  expect(groups[0].owners.sort()).toEqual(['cyrus', 'jack']);
});

test('row chip, context and action text', () => {
  expect(signalOf(reply, T)).toEqual({ chip: { label: 'Replied', tone: 'reply' }, context: 'Replied to step 2 · follow up question' });
  expect(signalOf(clicker, T).context).toBe('Clicked step 2 · Oct 3');
  expect(signalOf(opener, T)).toEqual({ chip: { label: 'Opened ×3', tone: 'open' }, context: 'Opened step 1 ×3 · Oct 5' });
  expect(signalOf(overdue, T).chip.label).toBe('Overdue');
  expect(actionText(overdue, T)).toBe('Email · overdue');
  expect(actionText(clicker, T)).toBe('follow_up_clicked');
});

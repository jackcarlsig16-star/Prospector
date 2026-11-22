// An invented GET goals/weekly?member=all body for tests (Thursday Nov 5: day 4 of 7) - two members, one unassigned
// mailbox, the team. Counts add up; a rate carries no pace. No address anywhere.
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
export const WEEKS = Array.from({ length: 12 }, (_, i) => addDays('2026-11-02', -7 * (11 - i)));
const DEFS = [['delivered', 'Delivered', 'count'], ['deliverability', 'Deliverability', 'rate'], ['human_open_rate', 'Human open rate', 'rate'], ['human_clicks', 'Human clicks', 'count'], ['replies', 'Replies', 'count'], ['meetings_set', 'Meetings set', 'count']];
// vals: { key: [last week, this week to date, same point last week] }
const metricsOf = vals => DEFS.map(([key, name, unit]) => {
  const [last, cur, same] = vals[key];
  const series = WEEKS.map((w, i) => ({ week_start: w, value: i === 11 ? cur : i === 10 ? last : i === 9 ? (unit === 'rate' ? 0.5 : 9) : null, goal: null, ...(i === 11 ? { current: true } : {}) }));
  return {
    key, name, group: 'Outbound', source: 'Apollo', unit, kind: 'flow', direction: 'up', goalable: true, goal_key: key, hint: `${name} hint`, series,
    this_week: { week_start: WEEKS[11], to_date: cur, same_point_last_week: same, delta: cur == null || same == null ? null : cur - same, pace: unit === 'count' && cur != null ? Math.round(cur / (4 / 7)) : null, goal: null, progress: null },
    last_week: { week_start: WEEKS[10], value: last, goal: null, hit: null },
    next_week: { week_start: '2026-11-09', goal: null },
  };
});
export const BY_MEMBER = {
  today: '2026-11-05', week_start: '2026-11-02', weeks: WEEKS, elapsed: { days: 4, share: 4 / 7 }, same_point: { from: '2026-10-26', to: '2026-10-29' }, groups: ['Outbound'],
  wording: { week: 'A week runs Monday to Sunday, Pacific time.', pace: 'Pace = this week to date ÷ the share of the week gone, for counts only.', member: "A member's email numbers are the emails sent from the mailboxes mapped to that member." },
  members: [{ id: 'u1', name: 'Jack' }, { id: 'u2', name: 'Cyrus' }], unassigned_mailboxes: 1,
  rows: [
    { id: 'u1', name: 'Jack', metrics: metricsOf({ delivered: [216, 161, 180], deliverability: [0.99, 0.994, 0.99], human_open_rate: [0.15, 0.141, 0.162], human_clicks: [4, 3, 1], replies: [2, 1, 1], meetings_set: [1, 2, 1] }) },
    { id: 'u2', name: 'Cyrus', metrics: metricsOf({ delivered: [35, null, 30], deliverability: [0.97, null, 0.97], human_open_rate: [0.086, null, 0.1], human_clicks: [0, null, 0], replies: [1, null, 1], meetings_set: [0, 1, 0] }) },
    { id: 'unassigned', name: 'Unassigned mailbox', metrics: metricsOf({ delivered: [0, 5, 0], deliverability: [null, 1, null], human_open_rate: [null, 0.2, null], human_clicks: [0, 0, 0], replies: [0, 0, 0], meetings_set: [0, 0, 0] }) },
    { id: 'team', name: 'Team', metrics: metricsOf({ delivered: [251, 166, 210], deliverability: [0.987, 0.994, 0.987], human_open_rate: [0.141, 0.143, 0.153], human_clicks: [4, 3, 1], replies: [3, 1, 2], meetings_set: [1, 3, 1] }) },
  ],
};
BY_MEMBER.metrics = BY_MEMBER.rows[3].metrics;

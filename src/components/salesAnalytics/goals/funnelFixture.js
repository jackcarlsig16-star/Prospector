// A funnel route body for the Jest suites (invented numbers, no names): the shape GET goals/funnel returns.
const win = (key, from, to, delivered, steps, cr, pr) => ({ key, from, to, delivered, human_opens: steps[0], human_clicks: steps[1], companies_visited: steps[2], people_identified: steps[3], replies: steps[4], meetings: steps[5], people_emailed: pr[1], companies_emailed: cr[1], companies_no_record: 0, company_rate: { n: cr[0], d: cr[1], rate: cr[1] ? cr[0] / cr[1] : null }, person_rate: { n: pr[0], d: pr[1], rate: pr[1] ? pr[0] / pr[1] : null }, companies_visited_names: [] });
const day = (d, emailed, visited) => ({ day: d, delivered: emailed * 2, people_emailed: emailed * 2, companies_emailed: emailed, companies_no_record: 0, human_opens: 0, human_clicks: 0, companies_visited: visited, people_identified: 0, replies: 0, meetings: 0, sides_present: emailed ? 'both' : 'visits', window_days: 1 });
export const FUNNEL = {
  today: '2026-11-10', since: '2026-10-26', ready: true,
  steps: ['delivered', 'human_opens', 'human_clicks', 'companies_visited', 'people_identified', 'replies', 'meetings'],
  step_words: { delivered: 'delivered', human_opens: 'human opens', human_clicks: 'clicks', companies_visited: 'companies visited', people_identified: 'people identified', replies: 'replies', meetings: 'meetings' },
  wording: { company: 'Company rate: of the companies we delivered email to in the window, the share with a website visit in the same window.', person: 'Person rate: of the people we delivered email to in the window, the share identified on the site.', cohort: 'of emails sent that day/week, so far', since: 'The funnel starts Oct 26, the first day website visits were tracked.' },
  windows: {
    yesterday: win('yesterday', '2026-11-09', '2026-11-09', 87, [4, 1, 1, 0, 0, 1], [1, 66], [0, 87]),
    '7d': win('7d', '2026-11-04', '2026-11-10', 416, [20, 3, 5, 1, 2, 3], [5, 178], [1, 400]),
    '30d': win('30d', '2026-10-12', '2026-11-10', 1828, [61, 9, 7, 2, 4, 6], [7, 217], [2, 780]),
    this_week: win('this_week', '2026-11-09', '2026-11-10', 135, [5, 1, 2, 0, 0, 1], [2, 90], [0, 130]),
    last_week: win('last_week', '2026-11-02', '2026-11-08', 380, [18, 3, 4, 1, 2, 4], [4, 160], [1, 370]),
  },
  series: [day('2026-11-06', 40, 1), day('2026-11-07', 0, 0), day('2026-11-08', 0, 0), day('2026-11-09', 66, 1), day('2026-11-10', 25, 2)],
  trend_30d: null,
};

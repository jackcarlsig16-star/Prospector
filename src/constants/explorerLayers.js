// dashboard-v3 Stage 3 (E) - the Explorer's layer registry, one leaf for the server (api/sales/explorerMath.js builds
// the series) and the browser (the chips, before any read). kind: count = columns on the left axis, rate = lines on
// the right axis; band = a delivery layer that draws the threshold band. Replies % is lavender (the mockup gave it
// Delivered's green). First-touched uses PARTNER_COLOR (the mockup's #C97626 is a member color - never reused).
export const LAYERS = {
  sent: { label: 'Sent', kind: 'count', color: '#8FA8FF', group: 'email' },
  delivered_rate: { label: 'Delivered %', kind: 'rate', color: '#3DD68C', group: 'email' },
  human_open_rate: { label: 'Human opens %', kind: 'rate', color: '#AFC0FF', group: 'email' },
  reply_rate: { label: 'Replies %', kind: 'rate', color: '#B39DDB', group: 'email' },
  hard_bounce_rate: { label: 'Hard bounce %', kind: 'rate', color: '#FF7878', group: 'email', band: true },
  spam_rate: { label: 'Spam %', kind: 'rate', color: '#F2B544', group: 'email', band: true },
  visitors: { label: 'Visitors', kind: 'count', color: '#FF9F57', group: 'visits' },
  meetings: { label: 'Meetings', kind: 'count', color: '#F2C94C', group: 'calendar', sub: 'Outlook' },
  first_touched: { label: 'First-touched', kind: 'count', color: '#A8D04A', group: 'partners', sub: 'partners' },
};
export const LAYER_IDS = Object.keys(LAYERS);
export const SPLITS = [['team', 'Team'], ['person', 'Person'], ['mailbox', 'Mailbox'], ['sequence', 'Sequence'], ['cohort', 'Cohort']];
export const BY = [['week', 'Week'], ['day', 'Day']];
export const SHOWS = [['lines', 'Lines'], ['columns', 'Columns'], ['table', 'Table']];
export const HEIGHTS = [['compact', 'Compact', 220], ['standard', 'Standard', 300], ['tall', 'Tall', 420]];
// E: the threshold band behind a delivery layer (hard bounce / spam): good below 2 %, concerning from 5 %.
export const BAND = { good: 0.02, concerning: 0.05 };
export const HOME_LAYERS = ['sent', 'human_open_rate', 'visitors', 'reply_rate'];

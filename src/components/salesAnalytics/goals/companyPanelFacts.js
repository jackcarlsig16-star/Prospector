import { CHANNEL_LABEL, PRIORITY_WORD } from '../../../constants/salesChannels';
import { TEAM_LABEL } from '../../../constants/ownership';
import { stageLabel, stageOptions, needsRecord } from './companyPanelModel';

// company-panel-v2 L2 / L5 / L6 - what the window shows for each row type
// (pure, unit-tested): the labelled facts row, the Last touch wording, the
// forward-only Stage choices, which Edit controls a type has, and the People
// filter. No email or phone ever passes through here.
export const md = d => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—');

const TOUCH_WORD = { email: 'Email sent', call: 'Call', linkedin: 'LinkedIn', meeting: 'Meeting', event: 'Event', other: 'Touch', stage: 'Stage moved', done: 'To-do done' };

// "Oct 17 · Email sent" when the touch has a kind, "Touched Oct 17" when only
// the stamp is known, "No touch yet" otherwise (the caller mutes that one).
export function lastTouchText(lastTouch, lastTouchAt) {
  const at = lastTouch?.at || lastTouchAt;
  if (!at) return { text: 'No touch yet', empty: true };
  const word = lastTouch?.touch_type && TOUCH_WORD[lastTouch.touch_type];
  return { text: word ? `${md(at)} · ${word}` : `Touched ${md(at)}`, empty: false };
}

export const sourceLabel = row => (row.type === 'apollo' ? 'Apollo' : row.type === 'visitor' ? 'Website' : row.channel && row.channel !== 'unknown' ? CHANNEL_LABEL[row.channel] || row.channel : '—');

export const priorityText = row => (row.not_a_fit ? 'Not a fit' : row.priority != null ? `P${row.priority} · ${PRIORITY_WORD[row.priority] || ''}`.trim() : '—');

// The seven facts (fewer for the record-less rows), [label, value, muted?].
export function factsFor(row, record) {
  const touch = lastTouchText(record?.last_touch, row.last_touch_at);
  const next = record?.next_step ?? row.next_step;
  const nextText = next ? `${next}${record?.next_step_due || row.next_step_due ? ` · due ${md(record?.next_step_due || row.next_step_due)}` : ''}` : '—';
  if (row.type === 'visitor') {
    return [['Priority', priorityText(row), row.priority == null], ['Source', 'Website', false], ['Last visit', row.visited?.last_visit ? md(row.visited.last_visit) : '—', !row.visited?.last_visit]];
  }
  if (row.type === 'apollo') {
    return [['Stage', 'In sequence', false], ['Source', 'Apollo', false], ['Last touch', touch.text, touch.empty]];
  }
  if (row.type === 'target') {
    return [['Stage', stageLabel(row), false], ['Team', row.owner_team ? TEAM_LABEL[row.owner_team] : '—', !row.owner_team], ['Source', sourceLabel(row), false], ['Last touch', touch.text, touch.empty]];
  }
  return [
    ['Stage', stageLabel(row), false],
    ['Priority', priorityText(row), row.priority == null && !row.not_a_fit],
    ['Owner', row.owner || 'Unassigned', !row.owner],
    ['Team', row.owner_team ? TEAM_LABEL[row.owner_team] : '—', !row.owner_team],
    ['Source', sourceLabel(row), false],
    ['Last touch', touch.text, touch.empty],
    ['Next step', nextText, !next],
  ];
}

// L5: the Stage select lists the current stage and forward moves only; Jump
// to stage (confirm) is the only way back.
export const forwardStages = row => stageOptions(row).filter(s => s.dir === 'now' || s.dir === 'forward');

// L5 per the matrix: partner / employer all four; target Stage + Team (a target
// has no owner); visitor Priority only; Apollo-only nothing.
export function editControls(row) {
  if (row.type === 'partner' || row.type === 'employer') return ['stage', 'owner', 'team', 'priority'];
  if (row.type === 'target') return ['stage', 'team'];
  if (row.type === 'visitor') return ['priority'];
  return [];
}

export const showsNotNow = row => !needsRecord(row.type);

export const linkedinSearchUrl = (name, company) => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent([name, company].filter(Boolean).join(' '))}`;

export const filterPeople = (people, q) => {
  const needle = (q || '').trim().toLowerCase();
  return needle ? people.filter(p => `${p.name || ''} ${p.title || ''}`.toLowerCase().includes(needle)) : people;
};

// The colour word for a Signals & visits row (never colour alone: the text says it too).
export const TIMELINE_KIND = { replied: ['Replied', 'good'], clicked: ['Clicked', 'warn'], opened: ['Opened', 'link'], visited: ['Visited', 'warn'], signal: ['Signal', 'accent'] };

export const bandText = interest => {
  if (!interest?.strongest) return '';
  const rest = interest.items.filter(i => i !== interest.strongest).map(i => i.text);
  return [interest.strongest.text, ...rest].join(' · ');
};

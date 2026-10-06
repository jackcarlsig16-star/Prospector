import { feedText, groupFeed, filterFeed, timeAgo } from './huddleView';

const T = '2026-10-06'; // Tue
const I = o => ({ key: o.key, contact_id: o.c || 'x', owner: o.owner || 'jack', kind: 'open', step: 1, automated: false, nth: 1, ...o });

test('feed wording: opens with nth, clicks, replies labelled with sync time', () => {
  expect(feedText(I({ step: 2, nth: 1 }))).toBe('opened step 2');
  expect(feedText(I({ step: 2, nth: 3 }))).toBe('opened step 2 (3rd time)');
  expect(feedText(I({ step: 2, nth: 11 }))).toBe('opened step 2 (11th time)');
  expect(feedText(I({ kind: 'click', step: 1 }))).toBe('clicked step 1');
  expect(feedText(I({ kind: 'reply', step: 2, reply_class: 'willing_to_meet', at: '2026-10-05T21:10:00Z' }))).toBe('replied to step 2: willing to meet · seen at Oct 5, 2:10 PM');
});

test('groups by LA day and places the new-since-last-huddle divider', () => {
  const items = [
    I({ key: 'a', at: '2026-10-06T16:00:00Z' }),            // Oct 6 9am LA
    I({ key: 'b', at: '2026-10-06T08:00:00Z' }),            // Oct 6 1am LA
    I({ key: 'c', at: '2026-10-06T05:00:00Z' }),            // Oct 5 10pm LA -> Yesterday
    I({ key: 'd', at: '2026-10-02T17:00:00Z' }),            // Earlier
  ];
  const g = groupFeed(items, T, '2026-10-06T07:30:00Z');
  expect(g.days.map(d => [d.day, d.items.map(i => i.key)])).toEqual([['Today', ['a', 'b']], ['Yesterday', ['c']], ['Earlier', ['d']]]);
  expect(g.dividerAt).toBe('c');
  expect(groupFeed(items, T, '2026-10-07T00:00:00Z').dividerAt).toBe(null); // nothing new
});

test('feed filters: bots hidden by default, person, heat, stale', () => {
  const items = [I({ key: 'h', c: 'p1' }), I({ key: 'b', c: 'p1', automated: true }), I({ key: 'cy', c: 'p2', owner: 'cyrus' })];
  const bands = new Map([['p1', 'hot'], ['p2', 'cold']]), stale = new Map([['p2', true]]);
  const base = { owner: 'team', heat: 'all', stale: false, hideBots: true };
  expect(filterFeed(items, base, bands, stale).map(i => i.key)).toEqual(['h', 'cy']);
  expect(filterFeed(items, { ...base, hideBots: false }, bands, stale).map(i => i.key)).toEqual(['h', 'b', 'cy']);
  expect(filterFeed(items, { ...base, owner: 'cyrus' }, bands, stale).map(i => i.key)).toEqual(['cy']);
  expect(filterFeed(items, { ...base, heat: 'hot' }, bands, stale).map(i => i.key)).toEqual(['h']);
  expect(filterFeed(items, { ...base, stale: true }, bands, stale).map(i => i.key)).toEqual(['cy']);
});

test('time ago', () => {
  const now = Date.parse('2026-10-06T17:00:00Z');
  expect(timeAgo('2026-10-06T16:46:00Z', now)).toBe('14m ago');
  expect(timeAgo('2026-10-06T14:00:00Z', now)).toBe('3h ago');
  expect(timeAgo('2026-10-03T17:00:00Z', now)).toBe('Sat, Oct 3');
});

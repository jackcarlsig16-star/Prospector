import { buildTimeline, eventText, lastTouch, inFilter } from './activityTimeline';
import { memberLookup } from '../goalsUi';

// partner-360-v1 Stage 1 - timeline merge, noise rules, last touch.
const lookup = memberLookup([{ user_id: 'u-jack', name: 'Jack Carlson' }]);

test('noise: undo rows + what they undid, hot on/off pairs; a lone hot stays', () => {
  const events = [
    { id: 'a', event: 'hot', meta: { hot: true }, at: '2026-10-01T10:00:00Z', by_user: 'u-jack' },
    { id: 'b', event: 'hot', meta: { hot: false }, at: '2026-10-01T10:01:00Z', by_user: 'u-jack' },
    { id: 'c', event: 'snooze', meta: { until: '2026-10-08' }, at: '2026-10-01T10:02:00Z', by_user: 'u-jack' },
    { id: 'd', event: 'undo', meta: { undid: 'c', undid_event: 'snooze' }, at: '2026-10-01T10:03:00Z', by_user: 'u-jack' },
    { id: 'e', event: 'status', from_status: 'not_started', to_status: 'researching', at: '2026-10-01T10:04:00Z', by_user: 'u-jack' },
    { id: 'f', event: 'hot', meta: { hot: true }, at: '2026-10-01T10:05:00Z', by_user: 'u-jack' },
    { id: 'g', event: 'touch', touch_type: 'call', contact_names: ['Jane Doe'], note: 'Intro call', to_status: 'first_email_sent', from_status: 'researching', at: '2026-10-02T19:00:00Z', by_user: 'u-jack' },
  ];
  const items = buildTimeline({ events, tasks: [], lookup });
  expect(items.map(i => i.id)).toEqual(['g', 'f', 'e', 'd', 'c', 'b', 'a']);
  expect(items.filter(i => i.noise).map(i => i.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  expect(items.find(i => i.id === 'c').undone).toBe(true);
  expect(items.find(i => i.id === 'g')).toMatchObject({ kind: 'meeting', text: 'Called Jane Doe → Sent', sub: 'Intro call', by: 'Jack' });
  expect(items.find(i => i.id === 'e').kind).toBe('stage');
});

test('tasks join the timeline as notes; filters pick by kind', () => {
  const items = buildTimeline({
    events: [{ id: 't1', event: 'touch', touch_type: 'email', contact_names: [], at: '2026-10-03T12:00:00Z', by_user: 'u-jack' }],
    tasks: [{ id: 'k1', text: 'Send deck', created_at: '2026-10-04T12:00:00Z', owner_user_id: 'u-jack', status: 'done', steps: [] }],
    lookup,
  });
  expect(items.map(i => i.text)).toEqual(['Task: Send deck', 'Emailed the partner']);
  expect(items[0]).toMatchObject({ kind: 'note', done: true });
  expect(items.filter(i => inFilter(i, 'email')).length).toBe(1);
  expect(items.filter(i => inFilter(i, 'note')).length).toBe(1);
  expect(items.filter(i => inFilter(i, 'all')).length).toBe(2);
});

test('eventText covers every event, including Apollo-sourced touches', () => {
  expect(eventText({ event: 'status', from_status: 'replied', to_status: 'meeting_set' }, lookup)).toBe('Replied → Meeting');
  expect(eventText({ event: 'assign', meta: { to_owner: 'u-jack' } }, lookup)).toBe('Assigned to Jack');
  expect(eventText({ event: 'touch', touch_type: 'meeting', contact_names: ['A', 'B'] }, lookup)).toBe('Met with A, B');
  expect(eventText({ event: 'touch', touch_type: 'email', contact_names: [] }, lookup)).toBe('Emailed the partner');
  expect(eventText({ event: 'note', note: 'hi' }, lookup)).toBe('Note: hi');
});

test('lastTouch: latest touch or contact-stage move beats last_touch_at; undone ignored; undated fallback', () => {
  const events = [
    { id: '1', event: 'status', to_status: 'first_email_sent', at: '2026-09-20T12:00:00Z', by_user: 'u-jack' },
    { id: '2', event: 'touch', touch_type: 'call', at: '2026-10-02T19:00:00Z', by_user: 'u-jack', source: 'manual' },
    { id: '3', event: 'touch', touch_type: 'meeting', at: '2026-10-05T19:00:00Z', by_user: 'u-jack' },
    { id: '4', event: 'undo', meta: { undid: '3' }, at: '2026-10-05T19:01:00Z', by_user: 'u-jack' },
  ];
  expect(lastTouch({ last_touch_at: '2026-10-06T00:00:00Z' }, events, lookup)).toMatchObject({ what: 'Call', at: '2026-10-02T19:00:00Z', by: 'Jack' });
  expect(lastTouch({ last_touch_at: '2026-10-06T00:00:00Z' }, [], lookup)).toMatchObject({ at: '2026-10-06T00:00:00Z', what: null });
  expect(lastTouch({ pipeline_status: 'replied' }, [], lookup)).toMatchObject({ undated: true });
  expect(lastTouch({ pipeline_status: 'researching' }, [], lookup)).toBeNull();
  expect(lastTouch({}, [{ id: 'x', event: 'touch', touch_type: 'email', at: '2026-10-01T00:00:00Z', source: 'apollo' }], lookup)).toMatchObject({ what: 'Email', source: 'from Apollo' });
});

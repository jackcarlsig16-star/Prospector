import { mergePeople, parseKnownContacts } from './partnerPeople';

// partner-360-v1 Stage 1 - the one merge the drop-down and the row count share.
test('parseKnownContacts: semicolons, newlines, parenthetical notes', () => {
  expect(parseKnownContacts('Rocky Foroutan; Alex Aydin (intro)\nGerri Vagadori (VP New BD);;')).toEqual([
    { name: 'Rocky Foroutan', note: null }, { name: 'Alex Aydin', note: 'intro' }, { name: 'Gerri Vagadori', note: 'VP New BD' },
  ]);
  expect(parseKnownContacts(null)).toEqual([]);
  expect(parseKnownContacts('   ')).toEqual([]);
});

test('mergePeople: DB row wins, logged names next, sheet last; one person per name', () => {
  const people = mergePeople({
    contacts: [{ id: 'c1', name: 'Jane Doe', title: 'VP', email: 'jane@example.com', source: 'manual' }, { id: 'c2', name: 'Al Apollo', source: 'apollo', last_activity_at: '2026-10-06T10:00:00Z', last_activity_type: 'reply' }],
    events: [
      { id: 'e1', event: 'touch', touch_type: 'call', contact_names: ['jane doe', 'Ken'], at: '2026-10-02T19:00:00Z' },
      { id: 'e2', event: 'touch', touch_type: 'email', contact_names: ['Ken', 'alex aydin'], at: '2026-10-04T19:00:00Z' },
      { id: 'e3', event: 'touch', touch_type: 'meeting', contact_names: ['Zed'], at: '2026-10-05T19:00:00Z' },
      { id: 'e4', event: 'undo', meta: { undid: 'e3' }, at: '2026-10-05T19:01:00Z' },
      { id: 'e5', event: 'status', to_status: 'replied', at: '2026-10-05T19:02:00Z' },
    ],
    knownContacts: 'Jane Doe (champion); Alex Aydin (intro)',
  });
  expect(people.map(p => [p.name, p.source, p.last_activity_type, p.deletable])).toEqual([
    ['Al Apollo', 'apollo', 'reply', false], ['Alex Aydin', 'logged', 'email', false], ['Ken', 'logged', 'email', false], ['Jane Doe', 'manual', 'call', true],
  ]);
  expect(people.find(p => p.name === 'Jane Doe').title).toBe('VP');
  expect(people.find(p => p.name === 'Alex Aydin').note).toBe('intro');
  expect(people.find(p => p.name === 'Ken').last_activity_at).toBe('2026-10-04T19:00:00Z');
  expect(people.some(p => p.name === 'Zed')).toBe(false);
});

test('mergePeople: empty everything is an empty list', () => {
  expect(mergePeople({})).toEqual([]);
});

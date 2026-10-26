import { HK_SCREENS, visibleScreens, phoneTabs, moreScreens, parseHkHash, hkHash, ownerOptions, chicagoGreeting } from './hkScreens';
import { HK_MODULES } from '../constants/hkModules';

// hkos-project-shell-v1 Stage 2 - the screen config, the #hk/ address, the owner toggle and Today's greeting.
const screens = visibleScreens(HK_MODULES);

test('ten screens in nav order, Settings last after the divider; reserved slots hidden while their module is off', () => {
  expect(screens.map(s => s.label)).toEqual(['Today', 'Inbox', 'Replies', 'Drafts', 'Pipeline', 'Brands', 'Sponsors', 'Review', 'Activity', 'Settings']);
  expect(screens.filter(s => s.divider).map(s => s.id)).toEqual(['settings']);
  expect(HK_SCREENS.filter(s => s.reserved).map(s => s.id)).toEqual(['creators', 'dms', 'segments', 'campaigns', 'sourcing', 'reports']);
  expect(screens.some(s => s.reserved)).toBe(false);
  const withCreators = visibleScreens(HK_MODULES.map(m => (m.key === 'creators' ? { ...m, on: true } : m)));
  expect(withCreators.map(s => s.id)).toContain('creators');
  expect(withCreators.map(s => s.id)).toContain('dms');
});

test('phone: four tabs + More; the More sheet lists the rest', () => {
  expect(phoneTabs(screens).map(s => s.label)).toEqual(['Today', 'Replies', 'Drafts', 'Brands']);
  expect(moreScreens(screens).map(s => s.label)).toEqual(['Inbox', 'Pipeline', 'Sponsors', 'Review', 'Activity', 'Settings']);
});

test('every screen has copy without em or en dashes', () => {
  for (const s of screens.filter(x => x.id !== 'settings')) {
    expect(s.emptyTitle).toBeTruthy(); expect(s.emptyLine).toBeTruthy();
    expect(`${s.label}${s.emptyTitle}${s.emptyLine}`).not.toMatch(/[–—]/);
  }
});

test('hash: parse and compose round-trip; anything not ours is null', () => {
  expect(parseHkHash('#hk/today')).toEqual({ screen: 'today', section: null });
  expect(parseHkHash('#hk/settings/modules')).toEqual({ screen: 'settings', section: 'modules' });
  expect(parseHkHash('#hk/settings')).toEqual({ screen: 'settings', section: 'members' });
  for (const h of ['', '#', '#sfdc_token=x&sfdc_instance=y', '#hk/', '#hk/nope', '#hk/creators', '#hk/today/extra', '#hk/settings/nope', '#HK/today']) {
    expect(parseHkHash(h)).toBeNull();
  }
  for (const s of screens) {
    const back = parseHkHash(hkHash(s.id, s.id === 'settings' ? 'modules' : null));
    expect(back.screen).toBe(s.id);
  }
  expect(hkHash('settings')).toBe('#hk/settings/members');
});

test('owner toggle: Me, each other signed-in member by first name, All; never the unsigned', () => {
  const me = { user_id: 'u1', first_name: 'Sam' };
  const members = [
    { user_id: 'u1', first_name: 'Sam', signed_up: true },
    { user_id: 'u2', first_name: 'Riley', signed_up: true },
    { user_id: null, first_name: 'Invited member', signed_up: false },
  ];
  expect(ownerOptions(me, members)).toEqual([{ id: 'me', label: 'Me' }, { id: 'u2', label: 'Riley' }, { id: 'all', label: 'All' }]);
  expect(ownerOptions(me, members.slice(0, 1)).map(o => o.label)).toEqual(['Me', 'All']);
  expect(ownerOptions(undefined, undefined).map(o => o.id)).toEqual(['me', 'all']);
});

test("Today's greeting uses Chicago time, not the browser's", () => {
  expect(chicagoGreeting(new Date('2026-10-26T14:00:00Z'), 'Sam')).toEqual({ title: 'Good morning, Sam', date: 'Monday, October 26' });
  expect(chicagoGreeting(new Date('2026-10-26T19:30:00Z'), 'Sam').title).toBe('Good afternoon, Sam');
  expect(chicagoGreeting(new Date('2026-10-27T02:00:00Z'), 'Sam')).toEqual({ title: 'Good evening, Sam', date: 'Monday, October 26' });
});

import { statsState, previewLine, STALE_DAYS } from './PitchSettings';
import { periodLabel } from './SponsorsScreen';
import { detailText } from './ActivityScreen';
import { SETTINGS_SECTIONS, parseHkHash, hkHash } from '../hkScreens';

// hkos-data-foundation-v1 Stage 4 - the pure bits of part B: the stats state, the preview line, period chips, the
// activity detail text and the Pitch settings section address.
test('stats: unconfirmed until confirmed, fresh within 14 days, stale after', () => {
  const now = Date.UTC(2026, 9, 26);
  expect(statsState(null, now)).toBe('unconfirmed');
  expect(statsState(new Date(now - 3 * 86400e3).toISOString(), now)).toBe('fresh');
  expect(statsState(new Date(now - (STALE_DAYS + 1) * 86400e3).toISOString(), now)).toBe('stale');
});

test('preview line reads as the intro sentence and never carries an em or en dash', () => {
  const line = previewLine('Jack', 'launched in Chicago in April and built for our Chicago members');
  expect(line).toBe("I'm Jack, co-founder of HumanKind, a free community wellness platform launched in Chicago in April and built for our Chicago members.");
  expect(line).not.toMatch(/[–—]/);
  expect(previewLine('Pete', '')).toMatch(/platform …\.$/);
});

test('period chips: launch, YYYY-MM as Mon YY, anything else as given', () => {
  expect(['launch', '2026-07', '2027-01', 'odd'].map(periodLabel)).toEqual(['Launch', 'Jul 26', 'Jan 27', 'odd']);
});

test('activity detail text summarises the logged detail without dumping JSON', () => {
  expect(detailText({ changed: ['notes', 'niche'], prev: { notes: null } })).toBe('notes, niche');
  expect(detailText({ changed: ['status'], prev: { status: 'candidate' } })).toBe('status · was candidate');
  expect(detailText({ name: 'Harbor Yoga', verdict: 'clear' })).toBe('Harbor Yoga · verdict clear');
  expect(detailText({ period: '2026-07', kind: 'monthly' })).toBe('2026-07 monthly');
  expect(detailText({ loser_name: 'Harbor Yoga Studio', moved: { hk_contacts: 1 } })).toBe('Harbor Yoga Studio archived');
  expect(detailText({ reason: 'asked us to stop', changed: ['relationship'] })).toBe('relationship · reason: asked us to stop');
  expect(detailText(null)).toBe('');
});

test('Settings has a Pitch section first, and #hk/settings/pitch round-trips', () => {
  expect(SETTINGS_SECTIONS.map(([id]) => id)).toEqual(['pitch', 'members', 'modules']);
  expect(parseHkHash('#hk/settings/pitch')).toEqual({ screen: 'settings', section: 'pitch' });
  expect(hkHash('settings', 'pitch')).toBe('#hk/settings/pitch');
  expect(parseHkHash('#hk/settings')).toEqual({ screen: 'settings', section: 'members' });
});

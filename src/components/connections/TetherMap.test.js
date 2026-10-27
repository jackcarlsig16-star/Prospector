import { tethersOf } from './TetherMap';
import { lineColor, contrast } from './tetherColor';

// mailbox-connections-v1 REV2 (M6) - the lines the map draws, and the 3:1 line color rule.
const HK = 'b-hk', HL = 'b-hl', KK = 'b-kk';
const data = {
  accounts: [{ id: 'g1', email: 'personal@example.test', is_default: true, features: ['gmail', 'calendar'], state: 'ok', linked_business_ids: [] }, { id: 'g2', email: 'work@humankind.test', is_default: false, features: ['gmail'], state: 'needs_reconnect', linked_business_ids: [HK] }],
  microsoft: { email: 'me@homelover.test', features: ['Mail.Read'], state: 'ok', business_ids: [HL] },
  apollo: [{ business_id: HL, mailbox_count: 2 }],
  workspaces: [
    { id: HK, name: 'HumanKind', color: '#22c55e', role: 'owner', google_link: { account_id: 'g2', purposes: ['drafts', 'inbox'], state: 'needs_reconnect' }, microsoft_derived: [], apollo_derived: false },
    { id: HL, name: 'HomeLover', color: '#ec4899', role: 'owner', google_link: null, microsoft_derived: ['voice', 'sync'], apollo_derived: true },
    { id: KK, name: 'Kopi Kita', color: '#8B4513', role: 'viewer', google_link: null, microsoft_derived: [], apollo_derived: false },
  ],
};

test('tethers: a google link, derived Outlook + Apollo lines, and the default to Personal tools; the flagged link is amber dashed with the reconnect pill', () => {
  const t = tethersOf(data, '#0d150d');
  expect(t.map(x => [x.kind, x.from, x.to])).toEqual([['google', 'account:g2', `workspace:${HK}`], ['microsoft', 'microsoft', `workspace:${HL}`], ['apollo', 'apollo', `workspace:${HL}`], ['default', 'account:g1', 'personal']]);
  const g = t[0];
  expect([g.state, g.dash, g.color, g.pill]).toEqual(['needs_reconnect', '6 4', '#B7791F', 'Outreach drafts · Inbox']);
  expect(t[1].pill).toBe('Voice · Outlook sync');
  expect(t[2].pill).toBe('Apollo · read-only');
  expect([t[3].dash, t[3].pill]).toEqual(['6 4', 'Default · tools with no workspace']);
  expect(tethersOf(null)).toEqual([]);
  expect(JSON.stringify(t)).not.toMatch(/[–—]/);
});

test('line color: passes untouched at 3:1, otherwise nudged toward the opposite of the surface until it passes', () => {
  expect(lineColor('#ec4899', '#0d150d').adjusted).toBe(false);
  const hkLight = lineColor('#22c55e', '#FFFFFF');
  expect(hkLight.adjusted).toBe(true); expect(hkLight.ratio).toBeGreaterThanOrEqual(3); expect(contrast(hkLight.color, '#FFFFFF')).toBeGreaterThanOrEqual(3);
  const kkDark = lineColor('#8B4513', '#0d150d');
  expect(kkDark.adjusted).toBe(true); expect(kkDark.ratio).toBeGreaterThanOrEqual(3);
  expect(lineColor('not a color', '#0d150d').color).toBe('#888888');
  expect(lineColor('#22c55e', '#0d150d').color).toBe('#22c55e');
});

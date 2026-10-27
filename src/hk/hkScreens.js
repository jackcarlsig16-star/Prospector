// hkos-project-shell-v1 S5 - the HumanKind Sales OS screens, one config. `module` = the HK_MODULES key that must be on
// for the screen to render (src/constants/hkModules.js); reserved slots stay hidden until their module's SPEC turns
// it on (never shown disabled). No em or en dashes in any UI text.
export const HK_SCREENS = [
  { id: 'today', label: 'Today', icon: 'today', phoneTab: true, module: 'email', emptyTitle: 'Nothing needs you right now.', emptyLine: 'Today fills in once Gmail is connected and the daily check runs.' },
  { id: 'inbox', label: 'Inbox', icon: 'inbox', phoneTab: false, module: 'email', emptyTitle: 'Your Gmail shows here.', emptyLine: 'Connect Gmail in a later step to read your own inbox here.' },
  { id: 'replies', label: 'Replies', icon: 'replies', phoneTab: true, module: 'email', emptyTitle: 'No replies waiting.', emptyLine: 'Replies show here once Gmail is connected.' },
  { id: 'drafts', label: 'Drafts', icon: 'drafts', phoneTab: true, module: 'email', emptyTitle: 'No drafts waiting.', emptyLine: 'Drafts show here once Gmail is connected. Nothing is ever sent from here.' },
  { id: 'pipeline', label: 'Pipeline', icon: 'pipeline', phoneTab: false, module: 'email', emptyTitle: 'No brands in motion yet.', emptyLine: 'Fills in after the Sheet import.' },
  { id: 'brands', label: 'Brands', icon: 'brands', phoneTab: true, module: 'email', emptyTitle: 'No brands yet.', emptyLine: 'Brands arrive with the Sheet import.' },
  { id: 'sponsors', label: 'Sponsors', icon: 'sponsors', phoneTab: false, module: 'email', emptyTitle: 'No sponsors yet.', emptyLine: 'Sponsors and the do-not-contact list arrive with the Sheet import.' },
  { id: 'review', label: 'Review', icon: 'review', phoneTab: false, module: 'email', emptyTitle: 'Nothing to review.', emptyLine: 'Possible duplicates and data warnings show here after the import.' },
  { id: 'activity', label: 'Activity', icon: 'activity', phoneTab: false, module: 'email', emptyTitle: 'No activity yet.', emptyLine: 'Every change by a teammate, Claude or the system is logged here.' },
  { id: 'creators', label: 'Creators', icon: 'brands', module: 'creators', reserved: true },
  { id: 'dms', label: 'DMs', icon: 'replies', module: 'creators', reserved: true },
  { id: 'segments', label: 'Segments', icon: 'review', module: 'nonprofits_press', reserved: true },
  { id: 'campaigns', label: 'Campaigns', icon: 'pipeline', module: 'campaigns_sourcing', reserved: true },
  { id: 'sourcing', label: 'Sourcing', icon: 'activity', module: 'campaigns_sourcing', reserved: true },
  { id: 'reports', label: 'Reports', icon: 'activity', module: 'sponsor_ops', reserved: true },
  { id: 'settings', label: 'Settings', icon: 'settings', phoneTab: false, divider: true },
];

export const SETTINGS_SECTIONS = [['pitch', 'Pitch'], ['members', 'Members'], ['modules', 'Modules']];

// Screens that render: no module (Settings) or its module on.
export function visibleScreens(modules) {
  const on = new Set((modules || []).filter(m => m.on).map(m => m.key));
  return HK_SCREENS.filter(s => !s.module || on.has(s.module));
}

export const phoneTabs = screens => screens.filter(s => s.phoneTab);
export const moreScreens = screens => screens.filter(s => !s.phoneTab);

// S10 - the address: #hk/<screen>, #hk/settings/<members|modules> and (data-foundation Stage 3) #hk/brands/<brand id>.
// Anything else is not ours (null).
const BRAND_ID = /^[0-9a-f-]{8,64}$/i;
export function parseHkHash(hash) {
  const m = /^#hk\/([a-z]+)(?:\/([a-z0-9-]+))?$/.exec(hash || '');
  if (!m) return null;
  const screen = HK_SCREENS.find(s => s.id === m[1] && !s.reserved);
  if (!screen) return null;
  if (screen.id === 'brands') return m[2] ? (BRAND_ID.test(m[2]) ? { screen: 'brands', section: null, brandId: m[2] } : null) : { screen: 'brands', section: null, brandId: null };
  if (screen.id !== 'settings') return m[2] ? null : { screen: screen.id, section: null };
  const section = m[2] || 'members';
  return SETTINGS_SECTIONS.some(([id]) => id === section) ? { screen: 'settings', section } : null;
}

export const hkHash = (screen, section, brandId) => (screen === 'settings' ? `#hk/settings/${section || 'members'}` : screen === 'brands' && brandId ? `#hk/brands/${brandId}` : `#hk/${screen}`);

// S6 - "Me", each other signed-in member's first name, "All". Built from members, never a fixed name list.
export function ownerOptions(me, members) {
  const others = (members || []).filter(m => m.signed_up && m.user_id && m.user_id !== me?.user_id);
  return [{ id: 'me', label: 'Me' }, ...others.map(m => ({ id: m.user_id, label: m.first_name })), { id: 'all', label: 'All' }];
}

const CHICAGO = 'America/Chicago';

// Today's header: "Good <morning|afternoon|evening>, <first name>" by Chicago time, plus the Chicago date.
export function chicagoGreeting(now, firstName) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: CHICAGO, hour: 'numeric', hourCycle: 'h23' }).format(now));
  const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const date = new Intl.DateTimeFormat('en-US', { timeZone: CHICAGO, weekday: 'long', month: 'long', day: 'numeric' }).format(now);
  return { title: `Good ${part}, ${firstName}`, date };
}

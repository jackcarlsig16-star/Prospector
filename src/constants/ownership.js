// call-notes-targets-v1 - who owns an account across HomeLover and its joint
// partner. Upside is named because it is the only joint partner today; a
// second one makes this a lookup table (own line).
export const OWNER_TEAMS = ['homelover', 'upside', 'both'];
export const TEAM_LABEL = { homelover: 'HomeLover', upside: 'Upside', both: 'Both' };

// A touch on an account someone else owns and asked not to double-touch.
export const doubleTouchWarning = row => (row?.no_double_touch && row.owner_team && row.owner_team !== 'homelover'
  ? `${TEAM_LABEL[row.owner_team]} owns this${row.co_owner_name ? ` (${row.co_owner_name})` : ''} - don't double-touch` : null);

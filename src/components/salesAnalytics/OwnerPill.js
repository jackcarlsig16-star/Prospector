import { SA, saSans } from './theme';
import { TEAM_LABEL } from '../../constants/ownership';

// call-notes-targets-v1 - who owns this account across HomeLover and Upside
// (owner_team / co_owner_name / no_double_touch on a partner, employer or
// target). Nothing when ownership was never set.
export default function OwnerPill({ row, style }) {
  if (!row?.owner_team) return null;
  const text = `${TEAM_LABEL[row.owner_team]}${row.co_owner_name ? ` · ${row.co_owner_name}` : ''}${row.no_double_touch ? ' · one owner' : ''}`;
  const title = `Owner: ${TEAM_LABEL[row.owner_team]}${row.co_owner_name ? `, co-owner ${row.co_owner_name}` : ''}${row.no_double_touch ? " - don't double-touch" : ''}`;
  return (
    <span title={title} aria-label={title}
      style={{ ...saSans, display: 'inline-flex', alignItems: 'center', gap: 4, height: 20, padding: '0 8px', borderRadius: 999, fontSize: 11, whiteSpace: 'nowrap',
        border: `1px solid ${row.no_double_touch ? SA.warn : SA.border}`, color: row.owner_team === 'homelover' ? SA.soft : SA.text, background: 'transparent', ...style }}>
      {text}
    </span>
  );
}

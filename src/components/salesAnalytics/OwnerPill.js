import { SA } from './theme';
import '../../ui/kitTheme';
import { TEAM_LABEL } from '../../constants/ownership';

// call-notes-targets-v1 - who owns this account across HomeLover and Upside
// (owner_team / co_owner_name / no_double_touch on a partner, employer or
// target). Nothing when ownership was never set. ui-clarity-v1 R5: a kit Tag
// (wash + dot + words); the warn hue marks "one owner, don't double-touch".
export default function OwnerPill({ row, style }) {
  if (!row?.owner_team) return null;
  const text = `${TEAM_LABEL[row.owner_team]}${row.co_owner_name ? ` · ${row.co_owner_name}` : ''}${row.no_double_touch ? ' · one owner' : ''}`;
  const title = `Owner: ${TEAM_LABEL[row.owner_team]}${row.co_owner_name ? `, co-owner ${row.co_owner_name}` : ''}${row.no_double_touch ? " - don't double-touch" : ''}`;
  return (
    <span className="ui-tag ui-tag--sm" title={title} aria-label={title} style={{ '--tag-color': row.no_double_touch ? SA.warn : row.owner_team === 'homelover' ? SA.accent : SA.borderStrong, ...style }}>
      <span className="ui-tag__dot" aria-hidden="true" />{text}
    </span>
  );
}

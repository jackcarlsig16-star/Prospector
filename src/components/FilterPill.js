import { mono } from '../constants/colors';

// account-taxonomy-gaps-fix-v1 Stage 3 - the single shared pill style. Every
// filter/segment pill across the Accounts page (Relationship Type, Stage,
// Tier, Favorites, At Risk, Business/Influencer segment, list switcher) was
// previously styled ad hoc per call site - visibly uneven gaps/sizing
// between groups (different heights, paddings, radii - some used
// borderRadius:20, some :2, some no fixed height at all). One shape/size/
// spacing everywhere now; color is the only thing that varies by category.
export const pillStyle = (active, color) => ({
  ...mono,
  fontSize: 11,
  height: 26,
  padding: '0 12px',
  borderRadius: 4,
  border: `1px solid ${active ? color : '#333'}`,
  background: active ? `${color}18` : 'transparent',
  color: active ? color : '#888',
  fontWeight: active ? 600 : 400,
  letterSpacing: '0.04em',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  whiteSpace: 'nowrap',
  transition: 'all 0.12s',
});

export default function FilterPill({ active, color = '#39FF14', onClick, children, count, icon, title }) {
  return (
    <button onClick={onClick} title={title} style={pillStyle(active, color)}>
      {icon && <span>{icon}</span>}
      {children}
      {count != null && <span style={{ fontSize: 10, opacity: 0.7 }}>{count}</span>}
    </button>
  );
}

import { mono } from '../../constants/colors';
import { CARD, RADIUS } from './tokens';

// Generic small pill primitive reused across header/state-bar/actions.
// `tone` accepts a hex color and derives bg/border from it; omit for neutral.
export default function AccountBadge({ children, tone, size = 10, filled = false, onClick, title }) {
  const color = tone || CARD.textSecondary;
  const style = {
    ...mono,
    fontSize: size,
    fontWeight: 600,
    letterSpacing: "0.04em",
    color: filled ? CARD.bg : color,
    background: filled ? color : `${color}14`,
    border: `1px solid ${tone ? `${color}55` : CARD.border}`,
    borderRadius: RADIUS.sm,
    padding: "2px 7px",
    whiteSpace: "nowrap",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    cursor: onClick ? "pointer" : "default",
  };
  return <span style={style} onClick={onClick} title={title}>{children}</span>;
}

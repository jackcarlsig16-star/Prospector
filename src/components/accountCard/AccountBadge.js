import { mono } from '../../constants/colors';
import { CARD, RADIUS } from './tokens';

// Generic small pill primitive reused across header/state-bar/actions.
// `tone` accepts a hex color and derives bg/border from it; omit for neutral.
// `glow` (A1b) adds a faint tone-matched glow — reserved for identity
// badges (kind BUSINESS/INFLUENCER), not signal/state pills in general.
// `textTone` overrides the label colour only — for tones dark enough that
// using them as text (the default) falls below readable contrast on their
// own tint, e.g. the Slag tier's #555566.
export default function AccountBadge({ children, tone, size = 10, filled = false, onClick, title, glow = false, textTone }) {
  const color = tone || CARD.textSecondary;
  const style = {
    ...mono,
    fontSize: size,
    fontWeight: 600,
    letterSpacing: "0.04em",
    color: filled ? CARD.bg : (textTone || color),
    background: filled ? color : `${color}14`,
    border: `1px solid ${tone ? `${color}55` : CARD.border}`,
    borderRadius: RADIUS.sm,
    padding: "2px 7px",
    whiteSpace: "nowrap",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    cursor: onClick ? "pointer" : "default",
    boxShadow: glow && tone ? `0 0 5px ${color}66` : "none",
  };
  return <span style={style} onClick={onClick} title={title}>{children}</span>;
}

import { useState } from 'react';
import { CARD, RADIUS, kindTokens } from './tokens';

// Outer container per Section 7. Pure shell — no click/expand logic of its
// own (that lives in AccountHeader's identity row); just the visual frame:
// dark surface, thin border, restrained radius, kind-accent left edge,
// subtle hover treatment.
export default function AccountCardShell({ accountKind, expanded, children, id }) {
  const kind = kindTokens(accountKind);
  const [hover, setHover] = useState(false);

  return (
    <div
      id={id}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: expanded ? CARD.surface2 : CARD.surface,
        border: `1px solid ${hover && !expanded ? CARD.borderStrong : CARD.border}`,
        borderLeft: `3px solid ${kind.accent}`,
        borderRadius: RADIUS.lg,
        marginBottom: 6,
        overflow: "hidden",
        position: "relative",
        transition: "background 0.15s, border-color 0.15s",
      }}
    >
      {children}
    </div>
  );
}

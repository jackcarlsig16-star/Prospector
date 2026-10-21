import React from 'react';
import { ui } from './kitTheme';
import { KIT_TYPE } from './tokens';

// State is never color alone: every pill carries a glyph and a text label.
// ui-clarity-v1 R5: a filled wash with no border, no hover and no pointer, so
// it never reads as a button (buttons are the bordered / filled pill shapes).
const STATES = {
  ok:   { color: ui.good, glyph: '✓' },
  warn: { color: ui.warn, glyph: '!' },
  bad:  { color: ui.bad,  glyph: '✕' },
  off:  { color: ui.off,  glyph: '–' },
};

export default function StatusPill({ status = 'off', children }) {
  const s = STATES[status] || STATES.off;
  return (
    <span data-status={status} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 22, padding: '0 8px 0 4px', borderRadius: 6, background: `color-mix(in srgb, ${s.color} 22%, ${ui.surface})`, ...KIT_TYPE.small, fontSize: 12, fontWeight: 500, color: ui.text, whiteSpace: 'nowrap', cursor: 'default' }}>
      <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, borderRadius: '50%', background: s.color, color: ui.ground, fontSize: 9, fontWeight: 700, lineHeight: 1 }}>{s.glyph}</span>
      {children}
    </span>
  );
}

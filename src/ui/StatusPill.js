import React from 'react';
import { ui } from './kitTheme';
import { KIT_RADIUS, KIT_TYPE } from './tokens';

// State is never color alone: every pill carries a glyph and a text label.
const STATES = {
  ok:   { color: ui.good, glyph: '✓' },
  warn: { color: ui.warn, glyph: '!' },
  bad:  { color: ui.bad,  glyph: '✕' },
  off:  { color: ui.off,  glyph: '–' },
};

export default function StatusPill({ status = 'off', children }) {
  const s = STATES[status] || STATES.off;
  return (
    <span data-status={status} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 22, padding: '0 8px 0 4px', borderRadius: KIT_RADIUS.pill, border: `1px solid color-mix(in srgb, ${s.color} 40%, transparent)`, background: `color-mix(in srgb, ${s.color} 12%, transparent)`, ...KIT_TYPE.small, fontSize: 12, color: ui.text, whiteSpace: 'nowrap' }}>
      <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, borderRadius: '50%', background: s.color, color: ui.surface, fontSize: 9, fontWeight: 700, lineHeight: 1 }}>{s.glyph}</span>
      {children}
    </span>
  );
}

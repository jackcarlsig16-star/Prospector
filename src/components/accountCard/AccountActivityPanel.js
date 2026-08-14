import { useState } from 'react';
import { mono } from '../../constants/colors';
import { CARD } from './tokens';
import AccountActivityTimeline from '../AccountActivityTimeline';

// Section 13/24 — reuses AccountActivityTimeline.js's internals unchanged
// (it renders the full parsed handoffNotes list with no built-in
// compact/expand), just gives it a collapsed-by-default frame here via a
// max-height clamp rather than a second competing activity implementation.
const COLLAPSED_HEIGHT = 92;

export default function AccountActivityPanel({ acc }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <p style={{ ...mono, margin: "0 0 8px", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: CARD.textSubtle }}>Activity</p>
      {/* A2 — hard cutoff, no fade mask: the default preview must stay fully
          readable, "show full history" is the only expand affordance. */}
      <div style={{ maxHeight: open ? "none" : COLLAPSED_HEIGHT, overflow: "hidden" }}>
        <AccountActivityTimeline acc={acc} />
      </div>
      <button onClick={() => setOpen(o => !o)} style={{ ...mono, marginTop: 6, fontSize: 10, color: CARD.textMuted, background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
        {open ? "▲ show less" : "▼ show full history"}
      </button>
    </div>
  );
}

import React from 'react';
import { ui } from './kitTheme';
import { KIT_TYPE } from './tokens';

// Controls inside a Field take className="ui-input" (input, select, textarea).
export default function Field({ label, htmlFor, hint, error, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label htmlFor={htmlFor} style={{ ...KIT_TYPE.label, color: ui.muted }}>{label}</label>
      {children}
      {error
        ? <div role="alert" style={{ ...KIT_TYPE.small, color: ui.dangerInk }}>{error}</div>
        : hint && <div style={{ ...KIT_TYPE.small, color: ui.muted }}>{hint}</div>}
    </div>
  );
}

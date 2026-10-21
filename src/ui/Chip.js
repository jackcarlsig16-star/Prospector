import React from 'react';
import './kitTheme';

// ui-clarity-v1 R3 - a toggle chip (channel buttons): off = bordered pill,
// on = accent fill with ground text; the count in tabular numbers.
export function ToggleChip({ pressed, count, children, ...rest }) {
  return (
    <button type="button" className="ui-chip" aria-pressed={!!pressed} {...rest}>
      {children}
      {count != null && <span className="ui-chip__count">{count}</span>}
    </button>
  );
}

// R4 - an active filter: accent-outlined chip; the whole chip removes it.
export function ActiveFilterChip({ onRemove, children }) {
  return (
    <button type="button" className="ui-chip ui-chip--active" aria-label={`Remove filter ${children}`} onClick={onRemove}>
      {children}
      <span className="ui-chip__x" aria-hidden="true">×</span>
    </button>
  );
}

// R7 - a row of controls with its short label to the left.
export function Group({ label, role = 'group', children }) {
  return (
    <div role={role} aria-label={label} className="ui-group">
      <span className="ui-group-label" aria-hidden="true">{label}</span>
      {children}
    </div>
  );
}

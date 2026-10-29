import React from 'react';
import { ui } from './kitTheme';

// ui-clarity-v1 R3 - a toggle chip (channel buttons): off = bordered pill,
// on = accent fill with ground text; the count in tabular numbers.
export function ToggleChip({ pressed, count, className, children, ...rest }) {
  return (
    <button type="button" className={className ? `ui-chip ${className}` : 'ui-chip'} aria-pressed={!!pressed} {...rest}>
      {children}
      {count != null && <span className="ui-chip__count">{count}</span>}
    </button>
  );
}

// R4 - an active filter: accent-outlined chip; the whole chip removes it.
export function ActiveFilterChip({ onRemove, children }) {
  const text = [].concat(children).filter(c => typeof c === 'string' || typeof c === 'number').join('');
  return (
    <button type="button" className="ui-chip ui-chip--active" aria-label={`Remove filter ${text}`} onClick={onRemove}>
      {children}
      <span className="ui-chip__x" aria-hidden="true">×</span>
    </button>
  );
}

// priorities-v2 F / companies-v2 C3 - the line under a filter card while something narrows the set: the summary
// ("Showing n of m ·"), one removable chip per active filter ({ key, text }), Clear all.
export function ActiveFilterLine({ summary, active, onRemove, onClear, style }) {
  if (!active.length) return null;
  return (
    <div data-active-filters style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12, color: ui.muted, ...style }}>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{summary}</span>
      {active.map(a => <ActiveFilterChip key={a.key} onRemove={() => onRemove(a.key)}>{a.text}</ActiveFilterChip>)}
      <button type="button" className="ui-link" onClick={onClear}>Clear all</button>
    </div>
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

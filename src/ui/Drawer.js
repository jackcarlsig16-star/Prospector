import React, { useId, useState } from 'react';
import './kitTheme';

// partner-details-drawers-v1 - a header row (label · summary · count · Show ▸ /
// Hide ▾) that folds a body; the summary shows only while closed (the body
// says it in full). Uncontrolled; persistKey remembers the choice in
// localStorage (per key, never per item), in-memory otherwise. The chevron
// text is the state - color is never the only signal.
// company-window-v4 D3 (amended): the same Drawer also draws the company window's drawers - `dense` = one 40 px row
// (▸ · mono label · count pill · one-line preview · the section's action link at the right); `action` sits beside the
// head button, never inside it; `countTone` 'warn' colors the pill; `open` + `onOpenChange` make it controlled (the
// window keeps the state per viewer per company itself).
const readOpen = key => { try { const v = localStorage.getItem(key); return v === 'open' ? true : v === 'closed' ? false : null; } catch { return null; } };
const writeOpen = (key, open) => { try { localStorage.setItem(key, open ? 'open' : 'closed'); } catch { /* private mode */ } };

export default function Drawer({ label, summary, count, countTone = null, defaultOpen = false, persistKey, onToggle, open: controlled, onOpenChange, action = null, dense = false, testId, children }) {
  const id = useId();
  const [own, setOwn] = useState(() => (persistKey ? readOpen(persistKey) : null) ?? defaultOpen);
  const open = controlled ?? own;
  const toggle = () => {
    const next = !open;
    if (controlled == null) setOwn(next);
    if (persistKey) writeOpen(persistKey, next);
    if (onOpenChange) onOpenChange(next);
    if (onToggle) onToggle(next);
  };
  const onKeyDown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
  return (
    <section aria-label={label} className={`ui-drawer${dense ? ' ui-drawer--dense' : ''}`} data-open={open ? 'true' : 'false'} data-drawer={testId}>
      <div className="ui-drawer__row">
        <button type="button" className="ui-drawer__head" aria-expanded={open} aria-controls={`${id}-body`} onClick={toggle} onKeyDown={onKeyDown}>
          {dense && <span className="ui-drawer__glyph" aria-hidden="true">{open ? '▾' : '▸'}</span>}
          <span className="ui-drawer__label">{label}</span>
          {!dense && !open && summary != null && summary !== '' && <span className="ui-drawer__summary">{summary}</span>}
          {count != null && <span className={`ui-drawer__count${countTone ? ` ui-drawer__count--${countTone}` : ''}`}>{count}</span>}
          {dense && summary != null && summary !== '' && <span className="ui-drawer__summary">{summary}</span>}
          {!dense && <span className="ui-drawer__toggle" aria-hidden="true">{open ? 'Hide ▾' : 'Show ▸'}</span>}
        </button>
        {action && <span className="ui-drawer__action">{action}</span>}
      </div>
      {open && <div id={`${id}-body`} className="ui-drawer__body">{children}</div>}
    </section>
  );
}

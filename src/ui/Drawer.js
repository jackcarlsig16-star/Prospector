import React, { useId, useState } from 'react';
import './kitTheme';

// partner-details-drawers-v1 - a header row (label · summary · count · Show ▸ /
// Hide ▾) that folds a body; the summary shows only while closed (the body
// says it in full). Uncontrolled; persistKey remembers the choice in
// localStorage (per key, never per item), in-memory otherwise. The chevron
// text is the state - color is never the only signal.
const readOpen = key => { try { const v = localStorage.getItem(key); return v === 'open' ? true : v === 'closed' ? false : null; } catch { return null; } };
const writeOpen = (key, open) => { try { localStorage.setItem(key, open ? 'open' : 'closed'); } catch { /* private mode */ } };

export default function Drawer({ label, summary, count, defaultOpen = false, persistKey, onToggle, children }) {
  const id = useId();
  const [open, setOpen] = useState(() => (persistKey ? readOpen(persistKey) : null) ?? defaultOpen);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (persistKey) writeOpen(persistKey, next);
    if (onToggle) onToggle(next);
  };
  const onKeyDown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
  return (
    <section aria-label={label} className="ui-drawer" data-open={open ? 'true' : 'false'}>
      <button type="button" className="ui-drawer__head" aria-expanded={open} aria-controls={`${id}-body`} onClick={toggle} onKeyDown={onKeyDown}>
        <span className="ui-drawer__label">{label}</span>
        {!open && summary != null && summary !== '' && <span className="ui-drawer__summary">{summary}</span>}
        {count != null && <span className="ui-drawer__count">{count}</span>}
        <span className="ui-drawer__toggle" aria-hidden="true">{open ? 'Hide ▾' : 'Show ▸'}</span>
      </button>
      {open && <div id={`${id}-body`} className="ui-drawer__body">{children}</div>}
    </section>
  );
}

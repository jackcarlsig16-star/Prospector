import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './HkMarks';

// hkos-sheet-import-v1 (ruling recorded in Stage 0) - the top bar's "+ New": Add brand, Add contact, Import list, Log
// outside touch. "Paste notes" stays out of the menu until hkos-notes-intake-v1 ships (never shown disabled).
export const NEW_ITEMS = [
  { id: 'add_brand', label: 'Add brand' },
  { id: 'add_contact', label: 'Add contact' },
  { id: 'import', label: 'Import list' },
  { id: 'log_touch', label: 'Log outside touch', disabled: true, note: 'Arrives with Gmail (step 3)' },
];

export default function NewMenu({ onPick, compact }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return;
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) close(); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, close]);
  return (
    <div className="hk-anchor" ref={ref}>
      <button type="button" className={`hk-btn hk-new${compact ? ' hk-new--compact' : ''}`} aria-haspopup="menu" aria-expanded={open} aria-label="New" onClick={() => setOpen(o => !o)} data-hk-new>
        <Icon name="plus" size={16} />{!compact && 'New'}
      </button>
      {open && (
        <div className="hk-menu hk-menu--right" role="menu" data-hk-new-menu>
          {NEW_ITEMS.map(it => (
            <button key={it.id} type="button" role="menuitem" className="hk-btn hk-menu__item" disabled={it.disabled} title={it.note} onClick={() => { setOpen(false); onPick(it.id); }} data-hk-new-item={it.id}>{it.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

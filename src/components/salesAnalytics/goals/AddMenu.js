import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SA, SA_THEME_ROOT_ID } from '../theme';

// FIX pipeline-quick-fixes-v1 A - the one primary "+ Add ▾" on Pipeline › Companies: a menu with Employer · Partner ·
// Target · Person. Enter / Space opens (the button's own click), arrows move, Esc closes, a click outside closes.
// On a phone the menu is a full-width sheet. Members only - the parent never renders this for a Viewer.
export const ADD_ITEMS = [['employer', 'Employer', 'A company in the pipeline (the employer panel)'], ['partner', 'Partner', 'A partner, with the dupe check'], ['target', 'Target', 'A company to research first (employer or partner kind)'], ['person', 'Person', 'Someone at a company - name, title, LinkedIn; never an email or phone']];

export default function AddMenu({ phone = false, onPick }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const btnRef = useRef(null);
  const itemRefs = useRef([]);
  useEffect(() => {
    if (!open) return undefined;
    itemRefs.current[active]?.focus();
    const close = e => { if (!e.target.closest('[data-add-menu]')) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, active]);
  const pick = id => { setOpen(false); btnRef.current?.focus(); onPick(id); };
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btnRef.current?.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % ADD_ITEMS.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + ADD_ITEMS.length) % ADD_ITEMS.length); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(ADD_ITEMS.length - 1); }
  };
  const items = (
    <div role="menu" aria-label="Add" data-add-menu onKeyDown={onKey}
      style={phone
        ? { display: 'flex', flexDirection: 'column', gap: 4 }
        : { position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 4010, background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: 10, padding: 6, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 220, boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>
      {ADD_ITEMS.map(([id, label, hint], i) => (
        <button key={id} type="button" role="menuitem" ref={el => { itemRefs.current[i] = el; }} tabIndex={i === active ? 0 : -1} data-add-item={id} title={hint}
          className="ui-btn ui-btn--tertiary" style={{ justifyContent: 'flex-start', width: '100%', height: phone ? 44 : 32, fontSize: phone ? 15 : 13 }}
          onClick={() => pick(id)} onFocus={() => setActive(i)}>{label}</button>
      ))}
    </div>
  );
  const root = document.getElementById(SA_THEME_ROOT_ID) || document.body;
  return (
    <span data-add-menu style={{ position: 'relative', display: 'inline-flex', flex: 'none' }}>
      <button ref={btnRef} type="button" className="ui-btn ui-btn--primary no-print" aria-haspopup="menu" aria-expanded={open} data-add-button
        onClick={() => { setActive(0); setOpen(o => !o); }}
        onKeyDown={e => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setActive(0); setOpen(true); } }}>+ Add ▾</button>
      {open && !phone && items}
      {open && phone && createPortal(
        <div data-add-menu className="no-print" style={{ position: 'fixed', inset: 0, zIndex: 4012 }}>
          <div onClick={() => setOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
          <div role="dialog" aria-label="Add" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: SA.surface, borderTop: `1px solid ${SA.border}`, borderRadius: '14px 14px 0 0', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="ui-group-label">Add</span>
            {items}
            <button type="button" className="ui-btn ui-btn--secondary" style={{ width: '100%' }} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>, root)}
    </span>
  );
}

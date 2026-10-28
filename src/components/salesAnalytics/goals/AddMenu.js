import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { SA, SA_THEME_ROOT_ID } from '../theme';

// FIX pipeline-quick-fixes-v1 A / one-plus-button-v1 - the one "+" menu, rendered in two places (the workspace header's
// "+" and Pipeline › Companies' "+ Add ▾") so they cannot drift. groups: [{ id, label, items: [{ id, label, meta?, hint? }] }]
// drawn with a rule between them. The menu is PORTALED and fixed-positioned under the button (one-plus-button P3: an
// absolute menu inside the fixed-height frame tools row was clipped to its first item - the "Employer" box); on a phone
// it is a full-width sheet. Enter / Space open (the button's own click), arrows / Home / End move across every item,
// Esc and a click outside close.
export const ADD_ITEMS = [['employer', 'Employer', 'A company in the pipeline (the employer panel)'], ['partner', 'Partner', 'A partner, with the dupe check'], ['target', 'Target', 'A company to research first (employer or partner kind)'], ['person', 'Person', 'Someone at a company - name, title, LinkedIn; never an email or phone']];
export const ADD_GROUP = { id: 'add', label: 'Add', items: ADD_ITEMS.map(([id, label, hint]) => ({ id, label, hint })) };
const MENU_Z = 4010;

export default function AddMenu({ phone = false, onPick, groups = [ADD_GROUP], label = 'Add', buttonLabel = '+ Add ▾', buttonProps = {} }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [anchor, setAnchor] = useState(null);
  const btnRef = useRef(null);
  const itemRefs = useRef([]);
  const flat = groups.flatMap(g => g.items.map(it => ({ ...it, group: g.id })));
  // The anchor is measured BEFORE the menu opens (a hidden menu cannot take focus, so Esc would have nothing to close).
  const place = () => { const r = btnRef.current?.getBoundingClientRect(); return r ? { top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) } : { top: 0, right: 8 }; };
  const toggle = () => { setActive(0); setAnchor(place()); setOpen(o => !o); };
  useLayoutEffect(() => {
    if (!open || phone) return undefined;
    const move = () => setAnchor(place());
    window.addEventListener('resize', move); window.addEventListener('scroll', move, true);
    return () => { window.removeEventListener('resize', move); window.removeEventListener('scroll', move, true); };
  }, [open, phone]);
  useEffect(() => {
    if (!open) return undefined;
    itemRefs.current[active]?.focus();
    const close = e => { if (!e.target.closest('[data-add-menu]')) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, active, anchor]);
  const pick = id => { setOpen(false); btnRef.current?.focus(); onPick(id); };
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btnRef.current?.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % flat.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + flat.length) % flat.length); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(flat.length - 1); }
  };
  let i = -1;
  const items = (
    <div role="menu" aria-label={label} data-add-menu onKeyDown={onKey}
      style={phone
        ? { display: 'flex', flexDirection: 'column', gap: 4 }
        : { position: 'fixed', top: anchor?.top ?? 0, right: anchor?.right ?? 8, zIndex: MENU_Z, background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: 10, padding: 6, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 220, boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>
      {groups.map((g, gi) => (
        <div key={g.id} role="group" aria-label={g.label} data-add-group={g.id} style={{ display: 'flex', flexDirection: 'column', gap: 2, ...(gi > 0 ? { borderTop: `1px solid ${SA.border}`, marginTop: 4, paddingTop: 6 } : {}) }}>
          {groups.length > 1 && <span className="ui-group-label" aria-hidden="true" style={{ padding: '2px 8px' }}>{g.label}</span>}
          {g.items.map(it => { i += 1; const idx = i; return (
            <button key={it.id} type="button" role="menuitem" ref={el => { itemRefs.current[idx] = el; }} tabIndex={idx === active ? 0 : -1} data-add-item={it.id} title={it.hint}
              className="ui-btn ui-btn--tertiary" style={{ justifyContent: 'space-between', width: '100%', height: phone ? 44 : 32, fontSize: phone ? 15 : 13 }}
              onClick={() => pick(it.id)} onFocus={() => setActive(idx)}>
              <span>{it.label}</span>{it.meta && <span className="ui-seg__meta" aria-hidden="true">{it.meta}</span>}
            </button>
          ); })}
        </div>
      ))}
    </div>
  );
  const root = document.getElementById(SA_THEME_ROOT_ID) || document.body;
  return (
    <span data-add-menu style={{ position: 'relative', display: 'inline-flex', flex: 'none' }}>
      <button ref={btnRef} type="button" className="ui-btn ui-btn--primary no-print" aria-haspopup="menu" aria-expanded={open} data-add-button {...buttonProps}
        onClick={toggle}
        onKeyDown={e => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); toggle(); } }}>{buttonLabel}</button>
      {open && !phone && createPortal(<span data-add-menu className="ui-theme-dark">{items}</span>, root)}
      {open && phone && createPortal(
        <div data-add-menu className="no-print ui-theme-dark" style={{ position: 'fixed', inset: 0, zIndex: MENU_Z + 2 }}>
          <div onClick={() => setOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
          <div role="dialog" aria-label={label} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: SA.surface, borderTop: `1px solid ${SA.border}`, borderRadius: '14px 14px 0 0', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items}
            <button type="button" className="ui-btn ui-btn--secondary" style={{ width: '100%' }} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>, root)}
    </span>
  );
}

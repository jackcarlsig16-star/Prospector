import { useState, useEffect, useLayoutEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { SA_THEME_ROOT_ID, SA_THEME_CLASS } from '../theme';
import { memberColor } from '../../../constants/memberColors';
import { ASSIGN_CSS } from './assignStyles';

// person-owner-v1 O3 + FIX people-assign-design-v1 - the ONE Assign control for a person (the People row's Owner cell,
// the pinned card's quick menu, the company window's People rows, the phone sheet). At rest it is the owner as plain
// text (dot + first name; a hollow dot + "—" when unassigned); hover / focus add the fill, the hairline and the caret.
// The list is a listbox: it opens on the current owner, ↑↓ wrap, Home / End, a first letter jumps, ↵ picks, Esc gives
// focus back to the trigger. Unassigned is last, under a hairline. A person's owner is separate from their company's.
const firstName = m => String(m?.name || '').trim().split(/\s+/)[0] || 'Member';
// A2: business_members has no per-member title (id, business_id, email, name, role, member_color …), so the row says
// the workspace role.
const ROLE = { owner: 'Owner', admin: 'Admin', member: 'Member' };
const assignable = members => members.filter(m => m.role !== 'viewer');
export const ownerOf = (members, userId) => {
  const i = members.findIndex(m => m.user_id === userId);
  return i < 0 ? null : { name: firstName(members[i]), color: members[i].color || memberColor(i) };
};
export function useAssignCss() {
  useLayoutEffect(() => {
    if (document.getElementById('asg-css')) return;
    const s = document.createElement('style');
    s.id = 'asg-css'; s.textContent = ASSIGN_CSS;
    document.head.appendChild(s);
  }, []);
}
const Dot = ({ color, size = 8 }) => <i aria-hidden="true" data-owner-dot={color ? '' : 'none'} className={color ? 'asg-dot' : 'asg-dot asg-dot--none'} style={{ width: size, height: size, background: color || undefined }} />;
const Svg = ({ size, d }) => <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={d} /></svg>;
const CARET = 'M4.5 6.5 8 10l3.5-3.5', CHECK = 'M3.5 8.5l3 3 6-7';

// "● Jack" / "○ —" (Unassigned). An owner who is no longer a member reads "Former member".
export function OwnerMark({ members, userId }) {
  useAssignCss();
  if (!userId) return <span data-owner="unassigned" className="asg-mark" title="Unassigned"><Dot /><span className="asg-dash">—</span></span>;
  const o = ownerOf(members, userId);
  return <span data-owner={userId} className="asg-mark" title={`Owner: ${o ? o.name : 'a former member'}`}><Dot color={o ? o.color : 'var(--sa-faint)'} /><span>{o ? o.name : 'Former member'}</span></span>;
}

// onClose(why): 'pick' | 'esc' | 'tab'. A pick of the current owner closes and writes nothing.
export function AssignList({ members, ownerUserId, label, onPick, onClose, sheet = false }) {
  useAssignCss();
  const rows = [...assignable(members).map(m => ({ id: m.user_id, ...ownerOf(members, m.user_id), role: ROLE[m.role] || '' })), { id: null, name: 'Unassigned', color: null, role: '' }];
  const checked = rows.findIndex(r => r.id === (ownerUserId || null));
  const [active, setActive] = useState(checked < 0 ? 0 : checked);
  const box = useRef(null);
  const uid = useId();
  useEffect(() => { box.current?.focus({ preventScroll: true }); }, []);
  const pick = i => { onClose('pick'); if (i !== checked) onPick(rows[i].id); };
  const onKeyDown = e => {
    const n = rows.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % n); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + n) % n); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(n - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); pick(active); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose('esc'); }
    else if (e.key === 'Tab') onClose('tab');
    else if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const hit = rows.map((_, k) => (active + 1 + k) % n).find(k => rows[k].name.toLowerCase().startsWith(e.key.toLowerCase()));
      if (hit !== undefined) { e.preventDefault(); setActive(hit); }
    }
  };
  return (
    <div ref={box} role="listbox" tabIndex={0} aria-label={label} aria-activedescendant={`${uid}-${active}`} className="asg-box" onKeyDown={onKeyDown}>
      {rows.map((r, i) => (
        <div key={r.id || 'none'} id={`${uid}-${i}`} role="option" aria-selected={i === checked} data-active={i === active ? '' : undefined} className={r.id ? 'asg-mi' : 'asg-mi asg-mi--un'}
          onMouseEnter={() => setActive(i)} onClick={e => { e.stopPropagation(); pick(i); }}>
          <Dot color={r.color} size={sheet ? 10 : 8} /><span>{r.name}</span><em>{r.role}</em><span className="asg-k">{i === checked && <Svg size={sheet ? 17 : 13} d={CHECK} />}</span>
        </div>
      ))}
    </div>
  );
}

// The trigger + its list. variant: 'cell' (the People table's 64-px column: the caret takes no room until hover and
// then sits in the cell's gutter) | 'row' | 'big' (the phone card, 44 px). sheet = the phone's bottom sheet; subtitle
// = the sheet's second line ("<title> · <company>"). children = a button of the caller's own (the pinned card on a
// phone) instead of the owner text.
export default function AssignButton({ members, ownerUserId, name, onPick, sheet = false, variant = 'row', subtitle = '', className, style, children }) {
  useAssignCss();
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(null);
  const btn = useRef(null), menu = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = e => { if (!menu.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const show = () => {
    const r = btn.current.getBoundingClientRect();
    const up = r.bottom + 160 > window.innerHeight && r.top > 170;
    setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - 208)), ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) });
    setOpen(true);
  };
  const toggle = e => { e.stopPropagation(); if (open) setOpen(false); else show(); };
  const close = () => { setOpen(false); btn.current?.focus({ preventScroll: true }); };
  const root = document.getElementById(SA_THEME_ROOT_ID) || document.body;
  const label = `Assign ${name}`;
  const list = <AssignList members={members} ownerUserId={ownerUserId} label={label} onPick={onPick} onClose={close} sheet={sheet} />;
  return (
    <>
      <button ref={btn} type="button" data-assign className={children ? className : `asg-ow asg-ow--${variant}${open ? ' is-open' : ''}`} aria-haspopup="listbox" aria-expanded={open} aria-label={label}
        title={`${label} - a person's owner is separate from their company's`} onClick={toggle} onKeyDown={e => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); show(); } }} style={style}>
        {children || <><OwnerMark members={members} userId={ownerUserId} /><span className="asg-c"><Svg size={11} d={CARET} /></span></>}
      </button>
      {open && createPortal(sheet
        ? <div className={`${SA_THEME_CLASS} no-print asg-sheet-wrap`}>
            <div className="asg-scrim" onClick={e => { e.stopPropagation(); setOpen(false); }} />
            <div ref={menu} role="dialog" aria-modal="true" aria-label={label} data-assign-menu="sheet" className="asg-sheet" onClick={e => e.stopPropagation()}>
              <div className="asg-grip" aria-hidden="true" />
              <div className="asg-sheet-title">{label}</div>
              <div className="asg-sheet-note">{subtitle ? `${subtitle}. ` : ''}A person’s owner is separate from their company’s.</div>
              {list}
              <button type="button" className="asg-cancel" onClick={close}>Cancel</button>
            </div>
          </div>
        : <div ref={menu} data-assign-menu="menu" className={`${SA_THEME_CLASS} no-print asg-menu`} style={{ position: 'fixed', zIndex: 4004, ...at }} onClick={e => e.stopPropagation()}>{list}</div>, root)}
    </>
  );
}

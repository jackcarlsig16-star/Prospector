import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SA, SA_THEME_ROOT_ID } from '../theme';
import { goalsApi } from '../goals/goalsApi';
import { memberColor } from '../../../constants/memberColors';

// person-owner-v1 O3 - the ONE Assign control for a person (the People row's Owner cell, the pinned card's quick menu,
// the company window's People rows, the phone sheet): the workspace's members with their colour dots, then Unassigned.
// A person's owner is separate from their company's.
const firstName = m => String(m?.name || '').trim().split(/\s+/)[0] || 'Member';
const assignable = members => members.filter(m => m.role !== 'viewer');
export const ownerOf = (members, userId) => {
  const i = members.findIndex(m => m.user_id === userId);
  return i < 0 ? null : { name: firstName(members[i]), color: members[i].color || memberColor(i) };
};
const dot = (color, size = 8) => <span aria-hidden="true" data-owner-dot style={{ width: size, height: size, borderRadius: 999, background: color, flex: 'none' }} />;

// "● Jack" / "—" (Unassigned). An owner who is no longer a member reads "Former member".
export function OwnerMark({ members, userId }) {
  if (!userId) return <span data-owner="unassigned" className="ui-table__dim" title="Unassigned">—</span>;
  const o = ownerOf(members, userId);
  return <span data-owner={userId} title={`Owner: ${o ? o.name : 'a former member'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 }}>{dot(o ? o.color : SA.muted, 6)}<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o ? o.name : 'Former member'}</span></span>;
}

// The write: optimistic (onLocal shows the new owner at once), the toast's Undo for 10 s (the event's own Undo), a 409
// (someone else changed the owner) reloads and says so, any other failure puts the old owner back.
export async function assignPerson({ businessId, personKey, name, from, to, members, onLocal, onToast, onChanged }) {
  onLocal(to);
  try {
    const out = await goalsApi.assignPerson(businessId, personKey, { owner_user_id: to, expect: { owner_user_id: from } });
    onChanged();
    const word = to ? ownerOf(members, to)?.name || 'a member' : 'Unassigned';
    onToast({
      text: to ? `${name} assigned to ${word}` : `${name} is unassigned`,
      undo: out.event ? async () => {
        onLocal(from);
        try { await goalsApi.undoPersonEvent(businessId, out.event.id); } catch (e) { onLocal(undefined); onChanged(); throw e; }
        onChanged();
      } : undefined,
    });
  } catch (e) {
    onLocal(undefined);
    if (e.status === 409) { onChanged(); onToast({ text: `${name}: the owner changed since you opened this - reloaded` }); } else onToast({ text: e.message });
  }
}

// trigger = what the button shows (the owner mark in a row, "Assign ▸" in a menu). sheet = the phone's bottom sheet.
export default function AssignButton({ members, ownerUserId, name, onPick, sheet = false, className = 'ui-btn ui-btn--tertiary ui-btn--sm', style, children }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(null);
  const btn = useRef(null), menu = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btn.current?.focus(); } };
    const away = e => { if (!menu.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', key, true); document.addEventListener('mousedown', away);
    menu.current?.querySelector('[role="menuitemradio"]')?.focus();
    return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('mousedown', away); };
  }, [open]);
  const toggle = e => {
    e.stopPropagation();
    if (!open) { const r = btn.current.getBoundingClientRect(); setAt({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 216)) }); }
    setOpen(o => !o);
  };
  const pick = (e, userId) => { e.stopPropagation(); setOpen(false); if ((userId || null) !== (ownerUserId || null)) onPick(userId); };
  const items = (
    <>
      {assignable(members).map(m => { const o = ownerOf(members, m.user_id); return (
        <button key={m.user_id} type="button" role="menuitemradio" aria-checked={ownerUserId === m.user_id} className="ui-btn ui-btn--tertiary ui-btn--sm" style={{ justifyContent: 'flex-start', gap: 8, minHeight: sheet ? 44 : undefined }} onClick={e => pick(e, m.user_id)}>{dot(o.color)}{o.name}{ownerUserId === m.user_id ? <span aria-hidden="true" style={{ marginLeft: 'auto', color: SA.muted }}>✓</span> : null}</button>
      ); })}
      <button type="button" role="menuitemradio" aria-checked={!ownerUserId} className="ui-btn ui-btn--tertiary ui-btn--sm" style={{ justifyContent: 'flex-start', color: SA.muted, minHeight: sheet ? 44 : undefined }} onClick={e => pick(e, null)}>Unassigned{!ownerUserId ? <span aria-hidden="true" style={{ marginLeft: 'auto' }}>✓</span> : null}</button>
    </>
  );
  const root = document.getElementById(SA_THEME_ROOT_ID) || document.body;
  const label = `Assign ${name}`;
  return (
    <>
      <button ref={btn} type="button" data-assign className={className} aria-haspopup="menu" aria-expanded={open} aria-label={label} title={`${label} - a person's owner is separate from their company's`} onClick={toggle} style={style}>{children}</button>
      {open && createPortal(sheet
        ? <div className="no-print" style={{ position: 'fixed', inset: 0, zIndex: 4004 }}>
            <div onClick={e => { e.stopPropagation(); setOpen(false); }} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
            <div ref={menu} role="menu" aria-label={label} data-assign-menu="sheet" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: SA.surface, borderTop: `1px solid ${SA.border}`, borderRadius: '14px 14px 0 0', padding: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="ui-group-label" style={{ padding: '0 8px 6px' }}>{label}</span>
              {items}
            </div>
          </div>
        : <div ref={menu} role="menu" aria-label={label} data-assign-menu="menu" className="no-print" style={{ position: 'fixed', top: at.top, left: at.left, zIndex: 4004, minWidth: 200, padding: 4, display: 'flex', flexDirection: 'column', gap: 2, background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>{items}</div>, root)}
    </>
  );
}

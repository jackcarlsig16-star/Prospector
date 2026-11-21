import { useState, useEffect, useRef } from 'react';
import Icon from './icons';

// app-shell-v2 - the 56 px header: the one field (a slot), then "Needs attention" (a slot - the workspace's own drawer
// button), "+ To-do" (absent for a Viewer) and the account menu. The 2 px rule under it is the workspace's hue.
//   menu: [{ id, label, onClick, danger? } | 'sep']
export function AccountMenu({ name, sub, items, onClose, style }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.querySelector('[role=menuitem]')?.focus();
    const out = e => { if (!ref.current?.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', out);
    return () => document.removeEventListener('mousedown', out);
  }, [onClose]);
  const onKeyDown = e => {
    const rows = [...ref.current.querySelectorAll('[role=menuitem]')], i = rows.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); onClose(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); rows[(i + 1) % rows.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); rows[(i - 1 + rows.length) % rows.length]?.focus(); }
  };
  return (
    <div ref={ref} className="sh-pan sh-menu" role="menu" aria-label="Account" onKeyDown={onKeyDown} style={style} data-shell-account>
      <div className="sh-menuhead"><div style={{ fontWeight: 600 }}>{name}</div>{sub && <div className="sh-note">{sub}</div>}</div>
      {items.map((it, i) => (it === 'sep' ? <div key={`sep-${i}`} className="sh-sep" style={{ margin: '4px 0' }} />
        : <button key={it.id} type="button" role="menuitem" className="sh-row" onClick={() => { onClose(); it.onClick(); }} data-account-item={it.id}>{it.label}</button>))}
    </div>
  );
}

export const SHORTCUTS = [['/', 'Search or ask Scout'], ['⌘K / Ctrl K', 'Search or ask Scout'], ['↑ ↓', 'Move through the results'], ['Tab', 'Next group of results'], ['↵', 'Open the selected row'], ['⌘↵ / Ctrl ↵', 'Ask Scout'], ['Esc', 'Close and go back to where you were']];
export function ShortcutsDialog({ onClose }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <>
      <div className="sh-scrim" style={{ zIndex: 98 }} onClick={onClose} />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="sh-shortcuts-title" className="sh-pan" onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
        style={{ position: 'fixed', top: '18vh', left: '50%', transform: 'translateX(-50%)', width: 380, maxWidth: 'calc(100vw - 32px)', zIndex: 99, padding: 16 }} data-shell-shortcuts>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}><h2 id="sh-shortcuts-title" style={{ margin: 0, fontSize: 16, fontWeight: 600, flex: 1 }}>Keyboard shortcuts</h2><button type="button" className="sh-icon" aria-label="Close keyboard shortcuts" onClick={onClose}><Icon name="close" size={14} /></button></div>
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 14px', alignItems: 'center' }}>
          {SHORTCUTS.map(([k, v]) => [<dt key={`k-${k}`}><span className="sh-kbd">{k}</span></dt>, <dd key={`v-${k}`} style={{ margin: 0, color: 'var(--sh-mut)', fontSize: 13 }}>{v}</dd>])}
        </dl>
      </div>
    </>
  );
}

export default function ShellHeader({ search, attention, onAddTodo, user, menu }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  return (
    <header className="sh-hdr" data-shell-header>
      {search}
      <span style={{ flex: 1 }} />
      {attention}
      {onAddTodo && <button type="button" className="sh-btn sh-btn--pri" onClick={onAddTodo} data-add-todo><Icon name="plus" size={13} />To-do</button>}
      <div style={{ position: 'relative', flex: 'none', display: 'inline-flex' }}>
        <button ref={btnRef} type="button" className="sh-ua" aria-label={`Account menu: ${user.first}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)} style={user.color ? { background: user.color } : undefined}>{user.initials}</button>
        {open && <AccountMenu name={user.name} sub={user.sub} items={menu} style={{ top: 40, right: 0 }} onClose={refocus => { setOpen(false); if (refocus) btnRef.current?.focus(); }} />}
      </div>
    </header>
  );
}

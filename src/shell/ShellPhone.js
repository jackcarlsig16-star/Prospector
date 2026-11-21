import { useState, useEffect, useRef } from 'react';
import Icon from './icons';
import { WorkspaceSwitcher } from './ShellNav';

// app-shell-v2 S5 - the phone shell (under 900 px): a 52 px top bar (workspace, Needs attention as a number, + as an
// icon), the page, and 64 px bottom tabs - up to three of the workspace's items, the centre button that opens the one
// search full screen, and More (the rest of the nav, the workspace switch, the account). Every target is 44 px or more.
export function PhoneTop({ workspace, attention, onAddTodo, title }) {
  return (
    <header className="sh-phonetop" data-shell-header="phone">
      <span className="sh-av">{workspace ? (workspace.name || '?')[0].toUpperCase() : <Icon name="grid" size={13} />}</span>
      <span style={{ fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{workspace?.name || title || 'Workspaces'}</span>
      {attention}
      {onAddTodo && <button type="button" className="sh-btn sh-btn--pri" style={{ width: 44, height: 44, padding: 0, justifyContent: 'center' }} aria-label="Add a to-do" onClick={onAddTodo} data-add-todo><Icon name="plus" size={16} /></button>}
    </header>
  );
}

export function MoreSheet({ workspace, role, workspaces, items, active, user, menu, onGo, onPickWorkspace, onAllWorkspaces, onClose }) {
  const ref = useRef(null);
  const [switching, setSwitching] = useState(false);
  const [account, setAccount] = useState(false);
  useEffect(() => { ref.current?.querySelector('button')?.focus(); }, []);
  return (
    <>
      <div className="sh-scrim" style={{ zIndex: 94 }} onClick={onClose} />
      <div ref={ref} className="sh-sheet" role="dialog" aria-modal="true" aria-label="More" onKeyDown={e => { if (e.key === 'Escape') onClose(); }} data-shell-more>
        <div aria-hidden="true" style={{ width: 36, height: 4, borderRadius: 999, background: '#6B7480', margin: '0 auto 12px' }} />
        <div style={{ position: 'relative' }}>
          <button type="button" className="sh-wscard" aria-haspopup="listbox" aria-expanded={switching} onClick={() => setSwitching(o => !o)}>
            <span className="sh-av">{workspace ? (workspace.name || '?')[0].toUpperCase() : <Icon name="grid" size={13} />}</span>
            <span style={{ flex: 1, minWidth: 0 }}><span style={{ fontWeight: 600, display: 'block' }}>{workspace?.name || 'All workspaces'}</span><span className="sh-note">{[role, 'switch workspace'].filter(Boolean).join(' · ')}</span></span>
            <span style={{ color: 'var(--sh-dim)', display: 'inline-flex' }}><Icon name="switch" size={14} /></span>
          </button>
          {switching && <WorkspaceSwitcher workspaces={workspaces} activeId={workspace?.id || null} style={{ position: 'static', width: '100%', marginBottom: 8 }} onClose={() => setSwitching(false)}
            onPick={w => { onClose(); onPickWorkspace(w); }} onAll={() => { onClose(); onAllWorkspaces(); }} />}
        </div>
        {items.map(it => (
          <button key={it.id} type="button" className="sh-sheetrow" aria-current={active === it.id ? 'page' : undefined} onClick={() => { onClose(); onGo(it); }} data-nav-item={it.id}>
            {it.icon ? <Icon name={it.icon} size={18} /> : <span className="sh-glyph" aria-hidden="true">{it.glyph || '•'}</span>}{it.label}
            <small>{it.soon ? 'soon' : it.badge > 0 ? it.badge : it.hint || ''}</small>
          </button>
        ))}
        <button type="button" className="sh-sheetrow" style={{ height: 56, borderBottom: 0 }} aria-expanded={account} onClick={() => setAccount(a => !a)}>
          <span className="sh-ua" style={user.color ? { background: user.color } : undefined}>{user.initials}</span>
          <span style={{ flex: 1, minWidth: 0 }}><span style={{ fontWeight: 500, display: 'block', fontSize: 14 }}>{user.name}</span><span className="sh-note">{menu.filter(m => m !== 'sep').slice(0, 2).map(m => m.label).join(' · ')} · Sign out</span></span>
        </button>
        {account && <div role="menu" aria-label="Account">{menu.filter(m => m !== 'sep').map(m => <button key={m.id} type="button" role="menuitem" className="sh-sheetrow" style={{ height: 44, fontSize: 14, paddingLeft: 44 }} onClick={() => { onClose(); m.onClick(); }}>{m.label}</button>)}</div>}
      </div>
    </>
  );
}

export function PhoneTabs({ tabs, active, onGo, onSearch, onMore, moreActive, canSearch }) {
  const tab = it => (
    <button key={it.id} type="button" className="sh-tab" aria-current={active === it.id ? 'page' : undefined} onClick={() => onGo(it)} data-nav-item={it.id}>
      {it.icon ? <Icon name={it.icon} size={18} /> : <span className="sh-glyph" aria-hidden="true">{it.glyph || '•'}</span>}{it.label}
      {it.badge > 0 && <span className="sh-bd sh-num" style={{ position: 'absolute', top: 2, right: 6, margin: 0, fontSize: 10, padding: '0 5px' }}>{it.badge}</span>}
    </button>
  );
  const half = Math.ceil(tabs.length / 2);
  return (
    <nav className="sh-tabs" aria-label="Main" data-shell-tabs>
      {tabs.slice(0, canSearch ? 2 : half).map(tab)}
      {canSearch && <button type="button" className="sh-centre" aria-label="Search or ask Scout" onClick={onSearch} data-shell-centre><Icon name="star" size={20} /></button>}
      {tabs.slice(canSearch ? 2 : half).map(tab)}
      <button type="button" className="sh-tab" aria-haspopup="dialog" aria-current={moreActive ? 'page' : undefined} onClick={onMore} data-shell-morebtn><Icon name="more" size={18} />More</button>
    </nav>
  );
}

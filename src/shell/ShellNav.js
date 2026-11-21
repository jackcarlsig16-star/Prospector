import { useState, useEffect, useRef } from 'react';
import Icon from './icons';

// app-shell-v2 - the left nav: sections only. 232 px, or the 60 px rail (icons with tooltips). The workspace card on
// top opens the switcher - a listbox of the workspaces this member belongs to, read only once it is opened; the active
// item carries the workspace's own hue (a 3 px bar + the icon), never neon.
//   items: [{ id, label, icon | glyph, group?, badge? (number), soon? }]   footer: [{ same }]   active: item id
export function WorkspaceSwitcher({ workspaces, activeId, onPick, onAll, onClose, style }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.querySelector('[aria-selected=true], [role=option]')?.focus();
    const out = e => { if (!ref.current?.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', out);
    return () => document.removeEventListener('mousedown', out);
  }, [onClose]);
  const onKeyDown = e => {
    const opts = [...ref.current.querySelectorAll('[role=option]')], i = opts.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); onClose(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); opts[(i + 1) % opts.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); opts[(i - 1 + opts.length) % opts.length]?.focus(); }
  };
  return (
    <div ref={ref} className="sh-pan sh-menu" role="listbox" aria-label="Switch workspace" onKeyDown={onKeyDown} style={style} data-shell-switcher>
      {workspaces.map(w => (
        <button key={w.id} type="button" role="option" aria-selected={w.id === activeId} className="sh-row" onClick={() => onPick(w)}>
          <span className="sh-av" style={{ background: w.color || undefined, width: 20, height: 20, fontSize: 11, borderRadius: 6 }}>{(w.name || '?')[0].toUpperCase()}</span>
          <span className="sh-ttl">{w.name}</span>
        </button>
      ))}
      {workspaces.length > 0 && <div className="sh-sep" />}
      <button type="button" role="option" aria-selected={!activeId} className="sh-row" onClick={onAll}><span className="sh-ico"><Icon name="grid" size={13} /></span><span className="sh-ttl">All workspaces</span></button>
    </div>
  );
}

export function NavItem({ item, active, rail, onGo }) {
  return (
    <button type="button" className="sh-ni" aria-current={active ? 'page' : undefined} title={rail ? item.label : undefined} aria-label={rail ? `${item.label}${item.badge ? `, ${item.badge}` : ''}${item.soon ? ', coming soon' : ''}` : undefined} onClick={() => onGo(item)} data-nav-item={item.id}>
      {item.icon ? <Icon name={item.icon} /> : <span className="sh-glyph" aria-hidden="true">{item.glyph || '•'}</span>}
      {!rail && item.label}
      {item.badge > 0 && <span className="sh-bd sh-num" aria-label={rail ? undefined : `${item.badge} open`}>{item.badge}</span>}
      {!rail && item.soon && <span className="sh-soon">Soon</span>}
    </button>
  );
}

export default function ShellNav({ workspace, role, workspaces, items, footer = [], active, rail, onRail, onGo, onPickWorkspace, onAllWorkspaces }) {
  const [switching, setSwitching] = useState(false);
  const wsRef = useRef(null);
  const groups = [];
  for (const it of items) { const g = groups.find(x => x.name === (it.group || null)); if (g) g.items.push(it); else groups.push({ name: it.group || null, items: [it] }); }
  const close = refocus => { setSwitching(false); if (refocus) wsRef.current?.focus(); };
  return (
    <nav className={`sh-nav${rail ? ' sh-nav--rail' : ''}`} aria-label="Main" data-shell-nav={rail ? 'rail' : 'wide'}>
      <div style={{ position: 'relative', flex: 'none' }}>
        <button ref={wsRef} type="button" className="sh-ws" aria-haspopup="listbox" aria-expanded={switching} aria-label={`Workspace: ${workspace?.name || 'All workspaces'}`} title={rail ? workspace?.name || 'All workspaces' : undefined} onClick={() => setSwitching(o => !o)}>
          <span className="sh-av">{workspace ? (workspace.name || '?')[0].toUpperCase() : <Icon name="grid" size={13} />}</span>
          {!rail && <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2, flex: 1, minWidth: 0 }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--sh-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{workspace?.name || 'All workspaces'}</span>
            {role && <span style={{ fontSize: 11, color: 'var(--sh-mut)' }}>{role}</span>}
          </span>}
          {!rail && <span style={{ color: 'var(--sh-dim)', display: 'inline-flex' }}><Icon name="switch" size={14} /></span>}
        </button>
        {switching && <WorkspaceSwitcher workspaces={workspaces} activeId={workspace?.id || null} onClose={close} style={{ top: 50, left: 8 }}
          onPick={w => { close(); onPickWorkspace(w); }} onAll={() => { close(); onAllWorkspaces(); }} />}
      </div>
      {groups.map((g, i) => (
        <div key={g.name || 'main'} style={{ paddingTop: i ? 0 : 10 }}>
          {g.name && (rail ? <div className="sh-sep" style={{ margin: '8px 14px' }} /> : <div className="sh-grp sh-lbl">{g.name}</div>)}
          <div className="sh-items">{g.items.map(it => <NavItem key={it.id} item={it} active={active === it.id} rail={rail} onGo={onGo} />)}</div>
        </div>
      ))}
      <div className="sh-navfoot">
        {footer.map(it => <NavItem key={it.id} item={it} active={active === it.id} rail={rail} onGo={onGo} />)}
        <div className="sh-brand">
          {!rail && <span>PROSPECTOR</span>}
          <button type="button" className="sh-icon" aria-label={rail ? 'Expand menu' : 'Collapse menu'} aria-pressed={rail} onClick={() => onRail(!rail)}><Icon name={rail ? 'expand' : 'collapse'} size={14} /></button>
        </div>
      </div>
    </nav>
  );
}

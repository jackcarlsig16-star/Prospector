import React, { useEffect, useRef, useState } from 'react';
import Segmented from '../ui/Segmented';
import { Icon, Sprout, Avatar } from './HkMarks';
import { ROLE_LABELS } from '../constants/roles';

// hkos-project-shell-v1 S3/S4/S6/S7/S9 - the shell's own chrome. Nothing here is shared with the Prospector shell.

// Closes a menu on an outside click or Esc.
function useDismiss(open, close) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) close(); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, close]);
  return ref;
}

export function OwnerToggle({ options, value, onChange }) {
  return <Segmented label="Whose work" items={options} value={value} onChange={onChange} />;
}

export function SideNav({ screens, current, onGo, owner }) {
  return (
    <nav className="hk-nav" aria-label="Sales OS">
      <div className="hk-logo">
        <Sprout size={28} />
        <div>
          <div className="hk-logo__name">HumanKind</div>
          <div className="hk-logo__sub">Sales OS</div>
        </div>
      </div>
      {owner}
      <div className="hk-nav__list">
        {screens.map(s => (
          <React.Fragment key={s.id}>
            {s.divider && <div className="hk-nav__divider" role="separator" />}
            <button type="button" className="hk-btn hk-nav__item" aria-current={current === s.id ? 'page' : undefined} onClick={() => onGo(s.id)} data-hk-nav={s.id}>
              <Icon name={s.icon} size={18} />
              {s.label}
              {s.count > 0 && <span className="hk-nav__badge">{s.count}</span>}
            </button>
          </React.Fragment>
        ))}
      </div>
      <div className="hk-nav__foot">A Project in Prospector</div>
    </nav>
  );
}

export function WorkspaceMenu({ business, businesses, onSelectBusiness, onAllWorkspaces }) {
  const [open, setOpen] = useState(false);
  const close = React.useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  const others = businesses.filter(b => b.id !== business.id);
  const pick = fn => () => { setOpen(false); fn(); };
  return (
    <div className="hk-anchor" ref={ref}>
      <button type="button" className="hk-btn hk-pill" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)} data-hk-workspace>
        <span className="hk-pill__dot" aria-hidden="true" />
        HumanKind Sales OS
        <Icon name="chevron" size={16} />
      </button>
      {open && (
        <div className="hk-menu hk-menu--left" role="menu">
          {others.length > 0 && <div className="hk-menu__label">Workspaces</div>}
          {others.map(b => (
            <button key={b.id} type="button" role="menuitem" className="hk-btn hk-menu__item" onClick={pick(() => onSelectBusiness(b))}>{b.name}</button>
          ))}
          {others.length > 0 && <div className="hk-menu__rule" role="separator" />}
          <button type="button" role="menuitem" className="hk-btn hk-menu__item" onClick={pick(onAllWorkspaces)}>All workspaces</button>
        </div>
      )}
    </div>
  );
}

export function AvatarMenu({ me, paletteIndex, size, onBack, onSignOut }) {
  const [open, setOpen] = useState(false);
  const close = React.useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  return (
    <div className="hk-anchor" ref={ref}>
      <button type="button" className="hk-btn" aria-label="Your account" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)} data-hk-avatar
        style={{ borderRadius: '50%', display: 'inline-flex' }}>
        <Avatar name={me.first_name} index={paletteIndex} size={size} />
      </button>
      {open && (
        <div className="hk-menu hk-menu--right" role="menu">
          <div className="hk-menu__head">
            <div style={{ fontWeight: 600 }}>{me.first_name}</div>
            <div className="hk-meta">{ROLE_LABELS[me.role] || me.role}</div>
          </div>
          <div className="hk-menu__rule" role="separator" />
          <button type="button" role="menuitem" className="hk-btn hk-menu__item" onClick={() => { setOpen(false); onBack(); }}>Back to Prospector</button>
          <button type="button" role="menuitem" className="hk-btn hk-menu__item" onClick={onSignOut}>Sign out</button>
        </div>
      )}
    </div>
  );
}

export function SearchPill({ onOpen }) {
  return (
    <button type="button" className="hk-btn hk-search" onClick={onOpen} data-hk-search>
      <Icon name="search" size={16} />
      Jump to a screen<span className="hk-kbd" aria-hidden="true">⌘K</span>
    </button>
  );
}

export function TabBar({ tabs, current, moreOpen, onGo, onMore }) {
  const inMore = !tabs.some(t => t.id === current);
  return (
    <nav className="hk-tabbar" aria-label="Sales OS">
      {tabs.map(t => (
        <button key={t.id} type="button" className="hk-btn hk-tab" aria-current={current === t.id ? 'page' : undefined} onClick={() => onGo(t.id)} data-hk-tab={t.id}>
          <Icon name={t.icon} size={22} />{t.label}
        </button>
      ))}
      <button type="button" className="hk-btn hk-tab" aria-current={inMore ? 'page' : undefined} aria-expanded={moreOpen} onClick={onMore} data-hk-tab="more">
        <Icon name="more" size={22} />More
      </button>
    </nav>
  );
}

export function MoreSheet({ screens, onGo, onBack, onSignOut, onClose }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      <div className="hk-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="hk-sheet" role="dialog" aria-modal="true" aria-label="More" data-hk-more>
        {screens.map(s => (
          <button key={s.id} type="button" className="hk-btn hk-sheet__item" onClick={() => onGo(s.id)}><Icon name={s.icon} size={20} />{s.label}</button>
        ))}
        <div className="hk-menu__rule" role="separator" />
        <button type="button" className="hk-btn hk-sheet__item" onClick={onBack}>Back to Prospector</button>
        <button type="button" className="hk-btn hk-sheet__item" onClick={onSignOut}>Sign out</button>
      </div>
    </>
  );
}

// S9 - type to filter the screens, arrows move, Enter or click jumps, Esc closes.
export function Palette({ screens, onGo, onClose }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const hits = screens.filter(s => s.label.toLowerCase().includes(q.trim().toLowerCase()));
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(i => Math.min(i + 1, hits.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && hits[sel]) { e.preventDefault(); onGo(hits[sel].id); }
  };
  return (
    <>
      <div className="hk-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="hk-palette" role="dialog" aria-modal="true" aria-label="Jump to a screen" data-hk-palette>
        <input className="hk-palette__input" autoFocus placeholder="Jump to a screen" aria-label="Jump to a screen" value={q}
          onChange={e => { setQ(e.target.value); setSel(0); }} onKeyDown={onKey} />
        <ul className="hk-palette__list" role="listbox" aria-label="Screens">
          {hits.map((s, i) => (
            <li key={s.id} role="option" aria-selected={i === sel}>
              <button type="button" className="hk-btn hk-palette__item" data-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => onGo(s.id)}>
                <Icon name={s.icon} size={18} />{s.label}
              </button>
            </li>
          ))}
          {!hits.length && <li className="hk-palette__none">No screen matches.</li>}
        </ul>
      </div>
    </>
  );
}

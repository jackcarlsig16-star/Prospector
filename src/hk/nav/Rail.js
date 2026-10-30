import React, { useEffect, useRef, useState } from 'react';
import { Icon, Sprout } from '../HkMarks';
import Buckets from './Buckets';

// grow-nav-filters-v1 N1 / N2 - the desktop rail: search · owner toggle · the three spaces · the active space's
// buckets · the Workspace group. Collapsed ( [ key or the button ) it is a 56 px icon rail: spaces and bucket icons
// with tooltips, a bucket icon opening its items as a flyout. The rail scrolls on its own.
export const RAIL_KEY = 'prospector_hk_rail'; // 'narrow' | 'wide', per browser
export const readNarrow = () => { try { return localStorage.getItem(RAIL_KEY) === 'narrow'; } catch { return false; } };
export const writeNarrow = v => { try { localStorage.setItem(RAIL_KEY, v ? 'narrow' : 'wide'); } catch { /* private mode */ } };

function SpaceButton({ s, current, onGo, narrow }) {
  const badge = s.count > 0 ? s.count : null;
  return (
    <button type="button" className="hk-btn hk-nav__item" aria-current={current === s.id ? 'page' : undefined} onClick={() => onGo(s.id)} data-hk-nav={s.id}
      aria-label={narrow ? `${s.label}${badge ? `, ${badge}` : ''}${s.hot > 0 ? `, ${s.hot} unseen Hot or Warm signals` : ''}` : undefined} title={narrow ? s.label : undefined}>
      <Icon name={s.icon} size={18} />
      {!narrow && s.label}
      {s.hot > 0 && (narrow ? <span className="hk-nav__dot" aria-hidden="true" /> : <span className="hk-nav__badge hk-nav__badge--green" title="Unseen signals on Hot or Warm brands" data-hk-hot-badge>{s.hot}<span className="ui-sr-only"> unseen Hot or Warm signals</span></span>)}
      {badge && !narrow && <span className="hk-nav__badge" style={s.hot > 0 ? { marginLeft: 4 } : undefined} data-hk-badge={s.id}>{badge}</span>}
    </button>
  );
}

export default function Rail({ spaces, workspace, current, onGo, owner, buckets, collapsed, onCollapse, onPick, narrow, onNarrow, onSearch }) {
  const [flyout, setFlyout] = useState(null);
  const flyRef = useRef(null);
  useEffect(() => {
    if (!flyout) return undefined;
    const close = e => { if (e.type === 'keydown' ? e.key === 'Escape' : !flyRef.current?.contains(e.target)) setFlyout(null); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [flyout]);
  if (narrow) {
    // The rail scrolls on its own, so a flyout inside it would be clipped at 56 px: it is fixed beside its icon instead.
    const open = buckets.find(b => b.key === flyout?.key);
    return (
      <nav className="hk-nav hk-rail hk-rail--narrow" aria-label="Grow" data-hk-rail="narrow">
        <div className="hk-logo"><Sprout size={26} /></div>
        <button type="button" className="hk-btn hk-icon-btn hk-rail__toggle" aria-label="Expand the rail ( [ )" title="Expand the rail" onClick={() => onNarrow(false)} data-hk-rail-toggle><Icon name="rail" size={18} /></button>
        <button type="button" className="hk-btn hk-icon-btn" aria-label="Search brands, people, replies, filters" title="Search" onClick={() => onSearch('')} data-hk-rail-search><Icon name="search" size={18} /></button>
        <div className="hk-nav__list">{spaces.map(s => <SpaceButton key={s.id} s={s} current={current} onGo={onGo} narrow />)}</div>
        <div className="hk-rail__icons" ref={flyRef}>
          {buckets.map(b => { const on = b.items.some(it => it.active && !(b.key === 'views' && it.id === 'all')); return (
            <button key={b.key} type="button" className="hk-btn hk-icon-btn" aria-label={b.label} title={b.label} aria-expanded={flyout?.key === b.key} aria-pressed={on} onClick={e => { const top = e.currentTarget.getBoundingClientRect().top; setFlyout(f => (f?.key === b.key ? null : { key: b.key, top })); }} data-hk-rail-bucket={b.key}>
              <Icon name={b.icon} size={18} />{on && <span className="hk-nav__dot" aria-hidden="true" />}
            </button>
          ); })}
          {open && <div className="hk-flyout" role="dialog" aria-label={open.label} data-hk-flyout={open.key} style={{ top: Math.max(8, Math.min(flyout.top, window.innerHeight - 320)) }}><Buckets buckets={[open]} collapsed={new Set()} onCollapse={() => {}} onPick={onPick} label={open.label} /></div>}
        </div>
        <div className="hk-rail__foot">{workspace.map(s => <SpaceButton key={s.id} s={s} current={current} onGo={onGo} narrow />)}</div>
      </nav>
    );
  }
  return (
    <nav className="hk-nav hk-rail" aria-label="Grow" data-hk-rail="wide">
      <div className="hk-rail__top">
        <div className="hk-logo">
          <Sprout size={28} />
          <div><div className="hk-logo__name">HumanKind</div><div className="hk-logo__sub">Grow</div></div>
        </div>
        <button type="button" className="hk-btn hk-icon-btn hk-rail__toggle" aria-label="Collapse the rail ( [ )" title="Collapse the rail" onClick={() => onNarrow(true)} data-hk-rail-toggle><Icon name="rail" size={18} /></button>
      </div>
      <label className="hk-rail__search">
        <Icon name="search" size={16} />
        <span className="ui-sr-only">Search brands, people, replies, filters</span>
        <input type="search" placeholder="Search brands, people, replies, filters" value="" onChange={e => onSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') onSearch(''); }} data-hk-rail-search />
        <span className="hk-kbd" aria-hidden="true">/</span>
      </label>
      {owner}
      <div className="hk-nav__list" aria-label="Spaces">{spaces.map(s => <SpaceButton key={s.id} s={s} current={current} onGo={onGo} />)}</div>
      {buckets.length > 0 && <Buckets buckets={buckets} collapsed={collapsed} onCollapse={onCollapse} onPick={onPick} />}
      <div className="hk-rail__foot">
        <div className="hk-menu__label">Workspace</div>
        {workspace.map(s => <SpaceButton key={s.id} s={s} current={current} onGo={onGo} />)}
      </div>
    </nav>
  );
}

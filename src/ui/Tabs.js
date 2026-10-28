import React, { useRef } from 'react';
import { ui } from './kitTheme';
import { KIT_SUBTAB } from './tokens';
import Tag from './Tag';

// ui-clarity-v1 R1 - main tabs: text with a 3 px underline (accent + bold when
// selected, the border colour when not); a disabled tab keeps a dashed edge,
// cursor not-allowed and says why. items: [{ id, label, disabled?, note? }].
// companies-v2 C1 - level="sub": the second-level row (a page's sub-views) - icon + word, 2 px accent underline on the
// selected tab only, one rule under the row, no box. items may carry `icon` (a src/ui/icons.js component). One tab stop
// (the selected tab); Left / Right / Home / End move and select, as the tab pattern expects.
export default function Tabs({ label, items, value, onChange, level = 'main' }) {
  const refs = useRef({});
  const sub = level === 'sub';
  const live = items.filter(it => !it.disabled);
  const onKeyDown = e => {
    const i = live.findIndex(it => it.id === value);
    const next = { ArrowRight: live[(i + 1) % live.length], ArrowLeft: live[(i - 1 + live.length) % live.length], Home: live[0], End: live[live.length - 1] }[e.key];
    if (!next) return;
    e.preventDefault();
    onChange(next.id);
    refs.current[next.id]?.focus();
    refs.current[next.id]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };
  return (
    <div role="tablist" aria-label={label} className={sub ? 'ui-tabs ui-tabs--sub' : 'ui-tabs'} onKeyDown={sub ? onKeyDown : undefined}>
      {items.map(it => (
        <button key={it.id} ref={el => { refs.current[it.id] = el; }} type="button" role="tab" className="ui-tab" aria-selected={it.id === value} tabIndex={sub ? (it.id === value ? 0 : -1) : undefined}
          disabled={it.disabled} title={it.disabled ? it.note : undefined} onClick={() => onChange(it.id)}>
          {sub && it.icon && <it.icon size={KIT_SUBTAB.icon} />}
          {it.label}
          {it.disabled && it.note && <Tag color={ui.off}>{it.note}</Tag>}
        </button>
      ))}
    </div>
  );
}

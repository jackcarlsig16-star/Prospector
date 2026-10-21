import React from 'react';
import { ui } from './kitTheme';
import Tag from './Tag';

// ui-clarity-v1 R1 - main tabs: text with a 3 px underline (accent + bold when
// selected, the border colour when not); a disabled tab keeps a dashed edge,
// cursor not-allowed and says why. items: [{ id, label, disabled?, note? }].
export default function Tabs({ label, items, value, onChange }) {
  return (
    <div role="tablist" aria-label={label} className="ui-tabs">
      {items.map(it => (
        <button key={it.id} type="button" role="tab" className="ui-tab" aria-selected={it.id === value} disabled={it.disabled} title={it.disabled ? it.note : undefined} onClick={() => onChange(it.id)}>
          {it.label}
          {it.disabled && it.note && <Tag color={ui.off}>{it.note}</Tag>}
        </button>
      ))}
    </div>
  );
}

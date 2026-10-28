import React from 'react';
import './kitTheme';

// sales-ia-v1 - items: [{ id, label, color?, meta?, icon?, ariaLabel?, title? }]; the pressed item is `value`.
// icon (priorities-v2): an src/ui/icons.js element before the word; an icon-only item passes label '' + ariaLabel.
export default function Segmented({ label, items, value, onChange }) {
  return (
    <div role="group" aria-label={label} className="ui-seg">
      {items.map(it => (
        <button key={it.id} type="button" className="ui-seg__btn" aria-pressed={it.id === value} aria-label={it.ariaLabel} title={it.title} onClick={() => onChange(it.id)}>
          {it.icon}
          {it.color && <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: it.color }} />}
          {it.label}
          {it.meta != null && <span className="ui-seg__meta">{it.meta}</span>}
        </button>
      ))}
    </div>
  );
}

import React from 'react';
import './kitTheme';

// ui-clarity-v1 R5 - a status chip (stage, priority, type, channel): a filled
// wash of `color` with a solid dot and a text label. Not a control: no border,
// no hover, no pointer. The colour never carries the meaning alone.
export default function Tag({ color, title, children }) {
  return (
    <span className="ui-tag" title={title} style={{ '--tag-color': color }}>
      <span className="ui-tag__dot" aria-hidden="true" />
      {children}
    </span>
  );
}

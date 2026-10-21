import React from 'react';
import './kitTheme';

// ui-clarity-v1 R6: primary (one per area) · secondary · tertiary (a link-looking
// text action) · danger. `ghost` is the pre-Stage-2 name callers still pass for
// the text action; it renders as tertiary.
const VARIANTS = ['primary', 'secondary', 'tertiary', 'danger'];

export default function Button({ variant = 'secondary', type = 'button', disabledReason, children, ...rest }) {
  const v = variant === 'ghost' ? 'tertiary' : VARIANTS.includes(variant) ? variant : 'secondary';
  const title = rest.disabled && disabledReason ? disabledReason : rest.title;
  return <button type={type} className={`ui-btn ui-btn--${v}`} {...rest} title={title}>{children}</button>;
}

export function ButtonRow({ align = 'end', children }) {
  const justifyContent = { start: 'flex-start', end: 'flex-end', between: 'space-between' }[align];
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent, gap: 8, flexWrap: 'wrap' }}>{children}</div>;
}

// A tertiary action that is a real link (href) - underlined, link colour.
export function Link({ href, children, ...rest }) {
  return <a className="ui-link" href={href} {...rest}>{children}</a>;
}

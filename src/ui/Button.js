import React from 'react';
import './kitTheme';

// ui-clarity-v1 R6: primary (one per area) · secondary · tertiary (a link-looking
// text action) · danger. size 'sm' = the 24 px button a dense table row holds.
const VARIANTS = ['primary', 'secondary', 'tertiary', 'danger'];

export default function Button({ variant = 'secondary', size, type = 'button', disabledReason, className, children, ...rest }) {
  const v = VARIANTS.includes(variant) ? variant : 'secondary';
  const title = rest.disabled && disabledReason ? disabledReason : rest.title;
  const cls = ['ui-btn', `ui-btn--${v}`, size === 'sm' && 'ui-btn--sm', className].filter(Boolean).join(' ');
  return <button type={type} className={cls} {...rest} title={title}>{children}</button>;
}

export function ButtonRow({ align = 'end', children }) {
  const justifyContent = { start: 'flex-start', end: 'flex-end', between: 'space-between' }[align];
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent, gap: 8, flexWrap: 'wrap' }}>{children}</div>;
}

// A tertiary action that is a real link (href) - underlined, link colour.
export function Link({ href, children, ...rest }) {
  return <a className="ui-link" href={href} {...rest}>{children}</a>;
}

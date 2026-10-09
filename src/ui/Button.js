import React from 'react';
import './kitTheme';

const VARIANTS = ['primary', 'secondary', 'ghost', 'danger'];

export default function Button({ variant = 'secondary', type = 'button', children, ...rest }) {
  const v = VARIANTS.includes(variant) ? variant : 'secondary';
  return <button type={type} className={`ui-btn ui-btn--${v}`} {...rest}>{children}</button>;
}

export function ButtonRow({ align = 'end', children }) {
  const justifyContent = { start: 'flex-start', end: 'flex-end', between: 'space-between' }[align];
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent, gap: 8, flexWrap: 'wrap' }}>{children}</div>;
}

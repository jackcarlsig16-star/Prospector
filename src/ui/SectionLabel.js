import React from 'react';
import { ui } from './kitTheme';
import { KIT_TYPE } from './tokens';

export default function SectionLabel({ children, as: Tag = 'div' }) {
  return <Tag style={{ ...KIT_TYPE.label, color: ui.muted, margin: '0 0 8px', fontWeight: 400 }}>{children}</Tag>;
}

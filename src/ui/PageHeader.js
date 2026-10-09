import React from 'react';
import { ui } from './kitTheme';
import { KIT_TYPE } from './tokens';

export default function PageHeader({ title, subtitle, actions }) {
  return (
    <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
      <div style={{ minWidth: 0 }}>
        <h1 style={{ ...KIT_TYPE.title, color: ui.text, margin: 0 }}>{title}</h1>
        {subtitle && <div style={{ ...KIT_TYPE.subtitle, color: ui.muted, marginTop: 4 }}>{subtitle}</div>}
      </div>
      {actions && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
    </header>
  );
}

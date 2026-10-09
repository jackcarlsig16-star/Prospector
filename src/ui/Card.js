import React from 'react';
import { ui } from './kitTheme';
import { KIT_RADIUS, KIT_TYPE } from './tokens';

export default function Card({ title, subtitle, actions, footer, children }) {
  const hasHead = title || subtitle || actions;
  return (
    <section className="ui-card" style={{ background: ui.surface, border: `1px solid ${ui.border}`, borderRadius: KIT_RADIUS.card, ...KIT_TYPE.body, color: ui.text }}>
      {hasHead && (
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: children ? 16 : 0 }}>
          <div style={{ minWidth: 0 }}>
            {title && <h2 style={{ ...KIT_TYPE.cardTitle, color: ui.text, margin: 0 }}>{title}</h2>}
            {subtitle && <div style={{ ...KIT_TYPE.small, color: ui.muted, marginTop: 4 }}>{subtitle}</div>}
          </div>
          {actions && <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>{actions}</div>}
        </div>
      )}
      {children}
      {footer && <div style={{ borderTop: `1px solid ${ui.border}`, marginTop: 16, paddingTop: 16 }}>{footer}</div>}
    </section>
  );
}

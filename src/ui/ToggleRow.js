import React, { useId } from 'react';
import { ui } from './kitTheme';
import { KIT_TYPE } from './tokens';

// help is one line, shown on hover / focus of the ⓘ (title + aria-describedby), never a paragraph under the row.
export default function ToggleRow({ label, help, checked, onChange, disabled }) {
  const id = useId();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, padding: '6px 0', borderBottom: `1px solid ${ui.border}` }}>
      <span style={{ ...KIT_TYPE.body, color: ui.text, flex: 1, minWidth: 0 }}>
        <span id={`${id}-label`}>{label}</span>
        {help && <span tabIndex={0} title={help} aria-label={help} style={{ marginLeft: 6, color: ui.muted, cursor: 'help', fontSize: 12 }}>ⓘ</span>}
        {help && <span id={`${id}-help`} hidden>{help}</span>}
      </span>
      <button type="button" role="switch" className="ui-switch" aria-checked={!!checked} aria-labelledby={`${id}-label`} aria-describedby={help ? `${id}-help` : undefined} disabled={disabled} onClick={() => onChange && onChange(!checked)} />
    </div>
  );
}

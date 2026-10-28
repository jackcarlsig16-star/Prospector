import React, { useId } from 'react';
import './kitTheme';
import { KIT_FILTER_PILL } from './tokens';

// ui-clarity-v1 R4 - a filter is a labelled dropdown that shows its value
// ("Owner: Jack"), never a pill. options: [{ value, label }].
// companies-v2 C3 - variant="pill": the same select drawn as one pill ("Owner  All ▾"); the edge turns accent when the
// value isn't the first option (the default), so a narrowed filter shows at a glance.
export default function FilterSelect({ label, value, options, onChange, disabled, variant }) {
  const id = useId();
  const pill = variant === 'pill';
  return (
    <span className={pill ? 'ui-filter ui-filter--pill' : 'ui-filter'} data-active={pill && options.length && value !== options[0].value ? '' : undefined}>
      <label htmlFor={id} className="ui-filter__label">{label}</label>
      <select id={id} className="ui-filter__select" value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {pill && (
        <svg className="ui-filter__caret" width={KIT_FILTER_PILL.caret} height={KIT_FILTER_PILL.caret} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M4.5 6.5 8 10l3.5-3.5" /></svg>
      )}
    </span>
  );
}

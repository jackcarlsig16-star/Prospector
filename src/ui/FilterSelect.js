import React, { useId } from 'react';
import './kitTheme';

// ui-clarity-v1 R4 - a filter is a labelled dropdown that shows its value
// ("Owner: Jack"), never a pill. options: [{ value, label }].
export default function FilterSelect({ label, value, options, onChange, disabled }) {
  const id = useId();
  return (
    <span className="ui-filter">
      <label htmlFor={id} className="ui-filter__label">{label}</label>
      <select id={id} className="ui-filter__select" value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </span>
  );
}

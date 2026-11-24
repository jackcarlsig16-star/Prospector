import { useMemo } from 'react';
import { SA } from '../theme';
import { labelStyle } from '../goals/goalsUi';
import LinkPicker, { chipStyle } from './LinkPicker';
import { LINK_GROUPS } from './linkTargets';

// fathom-notes-v1 REV 2 F12 (1) - "This call is about": the ONE company a call note is filed under. value =
// { type: 'partner' | 'employer' | 'target', id, name? } or null ("none"); candidates = the records the server's rules
// found when they did not land on one. The picker searches partners, employers and targets only.
const TYPES = ['partner', 'employer', 'target'];
const chipOf = type => LINK_GROUPS.find(g => g.type === type)?.chip || type;

export default function CallAbout({ value, candidates = [], links, onChange, disabled = false, hint = null }) {
  const only = useMemo(() => ({
    load: links.load,
    options: Object.fromEntries(TYPES.map(t => [t, links.options[t] || []])),
    labelFor: (type, id) => (value?.name && value.type === type && value.id === id ? `${chipOf(type)}: ${value.name}` : links.labelFor(type, id)),
  }), [links, value]);
  const pick = (type, id) => onChange(type ? { type, id, name: (links.options[type] || []).find(o => o.id === id)?.label || null } : null);
  const others = candidates.filter(c => !(value && c.type === value.type && c.id === value.id));
  return (
    <div data-call-about style={{ padding: '10px 12px', borderRadius: 8, border: `1px solid ${SA.border}`, background: SA.surface, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ ...labelStyle, fontSize: 11 }}>This call is about</span>
        <LinkPicker link={value ? { type: value.type, id: value.id } : null} links={only} taskText="this call" disabled={disabled}
          placeholder="Partner, employer or target" empty="None · pick a company" onChange={pick} />
      </div>
      {others.length > 0 && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: SA.muted }}>
          <span>{value ? 'Also matches' : 'Could be'}</span>
          {others.map(c => (
            <button key={`${c.type}:${c.id}`} type="button" disabled={disabled} style={chipStyle} onClick={() => onChange({ type: c.type, id: c.id, name: c.name })}>{chipOf(c.type)}: {c.name}</button>
          ))}
        </div>
      )}
      {hint && <span style={{ fontSize: 12, color: SA.muted }}>{hint}</span>}
    </div>
  );
}

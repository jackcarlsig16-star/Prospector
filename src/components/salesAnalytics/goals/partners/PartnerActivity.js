import { useState } from 'react';
import { SA, saSans } from '../../theme';
import { labelStyle, subStyle } from '../goalsUi';
import { FILTERS, inFilter } from './activityTimeline';

const when = iso => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const chip = on => ({ ...saSans, height: 26, padding: '0 10px', borderRadius: 999, fontSize: 12, cursor: 'pointer', border: `1px solid ${on ? SA.accent : SA.border}`, background: on ? 'color-mix(in srgb, var(--sa-accent) 18%, transparent)' : 'transparent', color: on ? SA.text : SA.soft });

// partner-360-v1 - everything that happened, newest first. Noise (undone
// changes, hot on/off pairs) stays behind "Show all activity (n)".
export default function PartnerActivity({ items }) {
  const [filter, setFilter] = useState('all');
  const [showAll, setShowAll] = useState(false);
  const inScope = items.filter(i => inFilter(i, filter));
  const shown = showAll ? inScope : inScope.filter(i => !i.noise);
  const hidden = inScope.length - shown.length;
  const hiddenAll = inScope.filter(i => i.noise).length;
  return (
    <section aria-label="Activity" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={labelStyle}>Activity</span>
        <div role="group" aria-label="Activity filter" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {FILTERS.map(f => <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} style={chip(filter === f.id)}>{f.label}</button>)}
        </div>
      </div>
      {!shown.length && <span style={{ ...subStyle, fontSize: 13 }}>{items.length ? 'Nothing here for this filter.' : 'Nothing yet. Log a touch or move the stage and it shows here.'}</span>}
      {shown.length > 0 && (
        <ol aria-label="Activity timeline" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
          {shown.map(i => (
            <li key={i.id} style={{ display: 'flex', gap: 10, fontSize: 13, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span style={{ color: SA.muted, minWidth: 108, fontVariantNumeric: 'tabular-nums' }}>{when(i.at)}</span>
              <span style={{ flex: '1 1 200px', minWidth: 0, color: i.undone || i.done ? SA.muted : SA.text, textDecoration: i.undone || i.done ? 'line-through' : 'none', overflowWrap: 'anywhere' }}>
                {i.text}{i.source && <span style={{ color: SA.muted }}> · {i.source}</span>}
                {i.sub && <span style={{ display: 'block', color: SA.soft, fontSize: 12, whiteSpace: 'pre-wrap' }}>{i.sub}</span>}
              </span>
              <span style={{ color: SA.muted }}>{i.by}</span>
            </li>
          ))}
        </ol>
      )}
      {(hidden > 0 || showAll) && (
        <button type="button" aria-expanded={showAll} onClick={() => setShowAll(s => !s)} style={{ all: 'unset', cursor: 'pointer', color: SA.link, fontSize: 12, minHeight: 24, alignSelf: 'flex-start' }}>
          {showAll ? `Hide the noise (${hiddenAll})` : `Show all activity (${hidden})`}
        </button>
      )}
    </section>
  );
}

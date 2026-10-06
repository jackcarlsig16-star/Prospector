import { useState } from 'react';
import { SA, SA_TYPE, SA_SHAPE, saSans } from './theme';

// sales-goals-v1 REV4 - shared right rail: view switcher (with a small count
// per view), person filter, then any summary cards the page passes as
// children (peopleSummary sits inside the person-filter card). Built for Goals; the Huddle reuses it later. On narrow screens
// (compact) it becomes a bar above the content, summary cards behind a
// toggle.
const card = { background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusCard };
const label = { ...SA_TYPE.label, color: SA.muted, fontWeight: 500 };

function PeopleToggle({ people, owner, onOwner }) {
  return (
    <div role="group" aria-label="Filter by person"
      style={{ display: 'grid', gridTemplateColumns: `repeat(${people.length}, minmax(0, 1fr))`, gap: 6, background: SA.inset, border: `1px solid ${SA.border}`, borderRadius: 12, padding: 4 }}>
      {people.map(p => {
        const on = owner === p.id;
        return (
          <button key={p.id} type="button" onClick={() => onOwner(p.id)} aria-pressed={on}
            style={{ ...saSans, height: 40, borderRadius: 9, border: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 14, fontWeight: 500, background: on ? SA.border : 'transparent', color: on ? SA.text : SA.muted, minWidth: 0 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: p.color, flex: 'none' }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function RightRail({ views, view, onView, people, owner, onOwner, peopleSummary, compact, children }) {
  const [showSummary, setShowSummary] = useState(false);

  if (compact) {
    return (
      <div className="no-print" style={{ ...card, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <nav aria-label="Views" style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
          {views.map(v => {
            const on = v.id === view;
            return (
              <button key={v.id} type="button" onClick={() => onView(v.id)} aria-pressed={on}
                style={{ ...saSans, flex: 'none', minHeight: 44, padding: '0 14px', borderRadius: 10, border: `1px solid ${on ? SA.accent : SA.border}`, background: on ? SA.track : 'transparent', color: on ? SA.text : SA.soft, fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                {v.name}{v.meta ? <span style={{ color: SA.muted, fontSize: 12, marginLeft: 6 }}>{v.meta}</span> : null}
              </button>
            );
          })}
        </nav>
        <PeopleToggle people={people} owner={owner} onOwner={onOwner} />
        {(children || peopleSummary) && (
          <button type="button" onClick={() => setShowSummary(s => !s)} aria-expanded={showSummary}
            style={{ ...saSans, minHeight: 44, border: 0, background: 'transparent', color: SA.link, fontSize: 13, cursor: 'pointer', textAlign: 'left', padding: '0 4px' }}>
            {showSummary ? 'Hide summary' : 'Show summary'}
          </button>
        )}
        {showSummary && <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{peopleSummary}{children}</div>}
      </div>
    );
  }

  return (
    <aside className="no-print" aria-label="Goals panel" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <nav aria-label="Views" style={{ ...card, padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ ...label, padding: '8px 12px 4px' }}>View</span>
        {views.map(v => {
          const on = v.id === view;
          return (
            <button key={v.id} type="button" onClick={() => onView(v.id)} aria-pressed={on}
              style={{ ...saSans, minHeight: 44, width: '100%', borderRadius: 10, border: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', fontSize: 14, fontWeight: 500, textAlign: 'left', background: on ? SA.track : 'transparent', color: on ? SA.text : SA.soft }}>
              <span style={{ width: 3, height: 18, borderRadius: 2, background: on ? SA.accent : 'transparent', flex: 'none' }} />
              <span style={{ flex: 1 }}>{v.name}</span>
              <span style={{ fontSize: 12, color: SA.muted, fontVariantNumeric: 'tabular-nums' }}>{v.meta}</span>
            </button>
          );
        })}
      </nav>
      <div style={{ ...card, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <span style={label}>Show</span>
        <PeopleToggle people={people} owner={owner} onOwner={onOwner} />
        {peopleSummary}
      </div>
      {children}
    </aside>
  );
}

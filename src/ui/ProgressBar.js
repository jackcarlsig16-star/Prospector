import React, { useEffect, useRef } from 'react';
import { ui } from './kitTheme';
import { KIT_TYPE } from './tokens';

// company-progress-bar-v1 D1 - one 28 px pill per step. steps: [{ id, label, at?, sub? }] (at = a short date, sub = a
// word, both in the pill's name and tooltip, never a second line). current: index of the step the record is on (-1 =
// off the path; side = the grey state shown at the end instead). onStep(i): makes each pill a button (members);
// without it the bar only reads (viewers). Done = filled, current = accent outline + tint, later = outlined; the word
// "done" / "now" is in each pill's name, so state is never color alone. Wraps onto more rows when narrow - the page
// never scrolls sideways.
// homelover-flow-v1 Stage 3 (Jack's carried fix): nowrap = one row that scrolls sideways when narrow, the current step kept in view.
export default function ProgressBar({ label, steps, current, side = null, onStep = null, nowrap = false }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!nowrap) return;
    const el = ref.current?.querySelector('[data-state="now"]');
    if (el?.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [nowrap, current]);
  return (
    <ol ref={ref} aria-label={label} data-progress-bar data-nowrap={nowrap || undefined} style={{ listStyle: 'none', margin: 0, padding: nowrap ? '0 0 4px' : 0, display: 'flex', flexWrap: nowrap ? 'nowrap' : 'wrap', overflowX: nowrap ? 'auto' : 'visible', gap: 4, minWidth: 0 }}>
      {steps.map((s, i) => {
        // homelover-flow-v1 F8: s.state overrides the index rule (Researched / Assigned sit before Contacted but are their own facts).
        const state = s.state || (side ? 'later' : i < current ? 'done' : i === current ? 'now' : 'later');
        const word = state === 'done' ? `done${s.sub ? ` ${s.sub}` : ''}${s.at ? ` ${s.at}` : ''}` : state === 'now' ? `now${s.at ? `, since ${s.at}` : ''}` : 'not yet';
        const box = {
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', width: '100%',
          height: 28, padding: '0 10px', borderRadius: 999, font: 'inherit', ...KIT_TYPE.small, fontSize: 12, fontWeight: state === 'now' ? 600 : 500, whiteSpace: 'nowrap',
          border: `1px solid ${state === 'now' ? ui.accent : state === 'done' ? `color-mix(in srgb, ${ui.accent} 70%, ${ui.surface})` : ui.border}`,
          background: state === 'done' ? `color-mix(in srgb, ${ui.accent} 26%, ${ui.surface})` : state === 'now' ? `color-mix(in srgb, ${ui.accent} 12%, ${ui.surface})` : 'transparent',
          color: state === 'later' ? ui.muted : ui.text, cursor: onStep ? 'pointer' : 'default',
        };
        const name = `${s.label}, ${word}`;
        const body = <>{state === 'done' ? '✓ ' : ''}{s.label}</>;
        return (
          <li key={s.id} data-step={s.id} data-state={state} aria-current={state === 'now' ? 'step' : undefined} style={{ display: 'flex', flex: nowrap ? '1 0 auto' : '1 1 auto', minWidth: 0 }}>
            {onStep
              ? <button type="button" aria-label={name} title={name} onClick={() => onStep(i)} style={box}>{body}</button>
              : <span aria-label={name} title={name} style={box}>{body}</span>}
          </li>
        );
      })}
      {side && (
        <li data-side={side} style={{ display: 'flex', alignItems: 'center', padding: '0 10px', height: 28, borderRadius: 999, background: `color-mix(in srgb, ${ui.off} 22%, ${ui.surface})`, ...KIT_TYPE.small, fontSize: 12, fontWeight: 600, color: ui.text, whiteSpace: 'nowrap' }}>{side}</li>
      )}
    </ol>
  );
}

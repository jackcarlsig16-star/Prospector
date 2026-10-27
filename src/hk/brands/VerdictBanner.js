import React from 'react';
import { verdictView } from './verdict';

// hkos-data-foundation-v1 D6 - the one Verdict banner. Every state shows its word (never color alone); the actions
// (Open match, Save anyway) come from the caller so the same banner serves Add brand and the Brand page.
export default function VerdictBanner({ verdict, members, brandName, onOpenMatch, onForce, forced, checking }) {
  if (checking) return <div className="hk-banner hk-banner--grey" role="status" data-hk-verdict="checking"><span className="hk-banner__title">Checking…</span></div>;
  const v = verdictView(verdict, { members, brandName });
  if (!v) return null;
  return (
    <div className={`hk-banner hk-banner--${v.tone}`} role={v.blocks ? 'alert' : 'status'} data-hk-verdict={v.verdict}>
      <div className="hk-banner__text">
        <span className="hk-banner__title">{v.title}</span>
        <span className="hk-banner__line">{v.line}{v.note ? ` ${v.note}` : ''}</span>
      </div>
      {(v.matchId && onOpenMatch) || (v.needsForce && onForce) ? (
        <div className="hk-banner__actions">
          {v.matchId && onOpenMatch && <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => onOpenMatch(v.matchId)}>Open match</button>}
          {v.needsForce && onForce && <button type="button" className="ui-btn ui-btn--tertiary ui-btn--sm" aria-pressed={!!forced} onClick={onForce}>{forced ? 'Saving anyway' : 'Save anyway'}</button>}
        </div>
      ) : null}
    </div>
  );
}

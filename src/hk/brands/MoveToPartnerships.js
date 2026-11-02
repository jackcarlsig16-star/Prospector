import React, { useState } from 'react';
import { hkPatch } from '../hkApi';

// grow-pitch-icp I2 - a sponsor brand whose research reads as media / a nonprofit / a university: "Looks like media ·
// Move to Partnerships" moves its segment (Activity row brand.segment) with Undo. Stays mounted after the move so the
// Undo line survives the reload (the brand no longer "looks like" anything once moved).
const SEGMENTS = [['press', 'Press'], ['podcast', 'Podcast'], ['nonprofit', 'Nonprofit'], ['university', 'University']];

export default function MoveToPartnerships({ businessId, brand, icp, canEdit, onChanged }) {
  const [seg, setSeg] = useState(icp?.looks_like || 'press');
  const [moved, setMoved] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!canEdit || (!icp?.looks_like && !moved)) return null;
  const go = async (segment, after) => {
    setBusy(true); setError('');
    try { await hkPatch(businessId, `/brands/${brand.id}`, { segment }); after(); await onChanged(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const label = SEGMENTS.find(([v]) => v === moved?.to)?.[1];
  return (
    <div className="hk-banner hk-banner--mustard" data-hk-move-partnerships>
      {moved ? (
        <div className="hk-banner__text"><span className="hk-banner__title">{brand.name} moved to Partnerships ({label}).</span>
          <span className="hk-banner__actions"><button type="button" className="hk-btn hk-link" disabled={busy} onClick={() => go(moved.from, () => setMoved(null))} data-hk-move-undo>Undo</button></span></div>
      ) : (
        <>
          <div className="hk-banner__text"><span className="hk-banner__title">{icp.label} · Move to Partnerships</span>
            <span className="hk-banner__line">Media, podcasts, press and nonprofits rank low in Send these 10 and live in Brands › Partnerships.</span></div>
          <div className="hk-banner__actions">
            <select className="ui-input" aria-label="Partnership type" value={seg} onChange={e => setSeg(e.target.value)} data-hk-move-segment>
              {SEGMENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button type="button" className="hk-btn hk-chipbtn" disabled={busy} onClick={() => go(seg, () => setMoved({ from: brand.segment, to: seg }))} data-hk-move-go>Move</button>
          </div>
        </>
      )}
      {error && <p className="hk-error" role="alert">{error}</p>}
    </div>
  );
}

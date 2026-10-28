import React, { useEffect, useState } from 'react';
import { mono } from '../constants/colors';
import { loadAssayProgress } from '../utils/bulkAssay';

const NEON = '#39FF14';
const SESSION_DISMISS_KEY = 'prospector_assay_banner_dismissed';
// FIX auto-assay-on-click-v1 - the offer: more than OFFER_MIN unscored Territory accounts and no run going -> one quiet
// line with "Score <n>" (one AI call per account - bulkAssay.js scores them one at a time). "Not now" hides it for 24 h
// (prospector_auto_assay_last, the old auto-run stamp); prospector_auto_assay_disabled = '1' hides it for good.
export const OFFER_MIN = 10;
const LAST_KEY = 'prospector_auto_assay_last', OFF_KEY = 'prospector_auto_assay_disabled', COOLDOWN = 24 * 60 * 60 * 1000;
const offerHidden = () => {
  try { return localStorage.getItem(OFF_KEY) === '1' || Date.now() - (parseInt(localStorage.getItem(LAST_KEY) || '0', 10) || 0) < COOLDOWN; } catch { return false; }
};
const stamp = () => { try { localStorage.setItem(LAST_KEY, String(Date.now())); } catch { /* private mode */ } };

export default function AssayBanner({ unscored = 0, onScore, canScore = false }) {
  const [progress, setProgress] = useState(loadAssayProgress);
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(SESSION_DISMISS_KEY) === '1'; } catch { return false; }
  });
  const [flashUntil, setFlashUntil] = useState(0);
  const [offerOff, setOfferOff] = useState(offerHidden);

  useEffect(() => {
    const onUpdate = (e) => {
      const next = e.detail || loadAssayProgress();
      setProgress(next);
      if (next?.done) setFlashUntil(Date.now() + 3000);
    };
    window.addEventListener('prospector_assay_updated', onUpdate);
    // Poll once a second as a fallback for cross-tab updates / events missed during reload.
    const t = setInterval(() => setProgress(loadAssayProgress()), 1000);
    return () => { window.removeEventListener('prospector_assay_updated', onUpdate); clearInterval(t); };
  }, []);

  const running = progress && !progress.done && progress.total > 0 && progress.completed < progress.total;
  if (!running && !(progress?.done && Date.now() < flashUntil) && canScore && onScore && unscored > OFFER_MIN && !offerOff) {
    return (
      <div data-assay-offer style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 14px', background: '#050f05', borderBottom: `1px solid ${NEON}33`, flexWrap: 'wrap', ...mono }}>
        <span style={{ fontSize: 12, color: NEON }} aria-hidden="true">⛏</span>
        <span style={{ fontSize: 11, color: '#c8d8c8' }}>{unscored} accounts haven't been scored · Score them <span style={{ color: '#8a9a8a' }}>(one AI call each)</span></span>
        <button type="button" onClick={() => { stamp(); setOfferOff(true); onScore(); }} style={{ ...mono, fontSize: 11, padding: '3px 10px', background: 'transparent', border: `1px solid ${NEON}88`, borderRadius: 4, color: NEON, cursor: 'pointer' }}>Score {unscored}</button>
        <button type="button" onClick={() => { stamp(); setOfferOff(true); }} style={{ ...mono, fontSize: 11, padding: '3px 8px', background: 'transparent', border: 'none', color: '#8a9a8a', cursor: 'pointer' }}>Not now</button>
      </div>
    );
  }
  if (dismissed) return null;
  if (!progress) return null;

  const { completed = 0, total = 0, done = false } = progress;
  const flashing = done && Date.now() < flashUntil;
  if (done && !flashing) return null;
  if (!done && completed >= total && total > 0) return null;
  if (total === 0) return null;

  const handleDismiss = () => {
    try { sessionStorage.setItem(SESSION_DISMISS_KEY, '1'); } catch {}
    setDismissed(true);
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '6px 14px',
      background: '#050f05',
      borderBottom: `1px solid ${NEON}33`,
      ...mono,
    }}>
      <span style={{ fontSize: 12, color: NEON, textShadow: `0 0 6px ${NEON}66` }}>⛏</span>
      {flashing ? (
        <span style={{ fontSize: 11, color: NEON, fontWeight: 600, letterSpacing: '0.06em' }}>
          ✓ Territory analysis complete — {total} account{total !== 1 ? 's' : ''} scored
        </span>
      ) : (
        <>
          <span style={{ fontSize: 11, color: NEON, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Analyzing territory
          </span>
          <span style={{ fontSize: 11, color: '#8a9a8a' }}>
            {completed} of {total} accounts scored
          </span>
          <div style={{ flex: 1, height: 2, background: '#1a3a1a', borderRadius: 1, overflow: 'hidden', minWidth: 60, maxWidth: 200 }}>
            <div style={{ height: '100%', width: `${total ? (completed/total)*100 : 0}%`, background: NEON, transition: 'width 0.4s', boxShadow: `0 0 6px ${NEON}88` }}/>
          </div>
          <button onClick={handleDismiss}
            style={{ ...mono, fontSize: 10, padding: '2px 8px', background: 'transparent', border: 'none', color: '#5a6a5a', cursor: 'pointer' }}>
            dismiss
          </button>
        </>
      )}
    </div>
  );
}

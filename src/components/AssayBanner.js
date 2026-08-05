import React, { useEffect, useState } from 'react';
import { mono } from '../constants/colors';
import { loadAssayProgress } from '../utils/bulkAssay';

const NEON = '#39FF14';
const SESSION_DISMISS_KEY = 'prospector_assay_banner_dismissed';

export default function AssayBanner() {
  const [progress, setProgress] = useState(loadAssayProgress);
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(SESSION_DISMISS_KEY) === '1'; } catch { return false; }
  });
  const [flashUntil, setFlashUntil] = useState(0);

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

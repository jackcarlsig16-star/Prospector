import { useEffect, useState } from 'react';

// Google access is held server-side per user (api/lib/googleGrants.js); the
// browser never sees a Google token, only which features are granted. The
// Gmail/Calendar/Slides routes answer 409 { needs_google: feature } when the
// feature isn't granted yet - show a Connect button, never redirect on your own.

export const GOOGLE_FEATURE_LABELS = { gmail: 'Gmail', calendar: 'Google Calendar', slides: 'Google Slides' };

const NONE = { email: null, features: [] };
let statusPromise = null;

export function googleStatus() {
  if (!statusPromise) {
    statusPromise = fetch('/api/google/status')
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .catch(() => { statusPromise = null; return NONE; });
  }
  return statusPromise;
}

export async function hasGoogle(feature) {
  return (await googleStatus()).features.includes(feature);
}

export function connectGoogle(feature) {
  const back = window.location.pathname + window.location.search;
  window.location.assign(`/api/google/connect?feature=${feature}&return=${encodeURIComponent(back)}`);
}

export async function disconnectGoogle() {
  await fetch('/api/google/disconnect', { method: 'POST' });
  statusPromise = null;
}

// null while loading, then { email, features }.
export function useGoogleStatus() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let live = true;
    googleStatus().then(s => { if (live) setStatus(s); });
    return () => { live = false; };
  }, []);
  return status;
}

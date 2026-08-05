// Resolve a stable id for a user object.
//
// Priority cascade:
//   1. user.id if it's already set — keep it, never overwrite a known id.
//   2. prospector_user_id (gate-generated UUID) — written when the user first
//      passes through ProspectorGate. Stable across sessions, lost on cache wipe.
//   3. Owner deterministic slug — for OWNER_EMAILS, derive `owner_{local}` from
//      the email so seed data and migrations can target Owners by a stable key.
//   4. Fresh crypto.randomUUID() — last resort. Persisted to prospector_user_id
//      so subsequent calls return the same value within the same browser.
//
// Used by:
//   - OnboardingPage.finish() to stamp user.id at creation
//   - App.js one-time migration to repair existing prospector_user objects that
//     were written before the onboarding fix shipped (every existing user).

import { OWNER_EMAILS } from '../constants/appConfig';

const ownerSlug = (email) => {
  const local = String(email).split('@')[0] || 'owner';
  return `owner_${local.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`;
};

export function resolveUserId(user) {
  // Owner ALWAYS gets the deterministic slug — even if user.id or
  // prospector_user_id already hold a UUID from a prior gate visit. Owners
  // need a stable, predictable id so seed data and migrations can target
  // them by a known key (owner@example.com → "owner_owner").
  if (user?.email && OWNER_EMAILS.includes(String(user.email).toLowerCase())) {
    const slug = ownerSlug(user.email);
    try { localStorage.setItem('prospector_user_id', slug); } catch {}
    return slug;
  }

  if (user?.id) return user.id;

  let stored = null;
  try { stored = localStorage.getItem('prospector_user_id'); } catch {}
  if (stored) return stored;

  const fresh = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  try { localStorage.setItem('prospector_user_id', fresh); } catch {}
  return fresh;
}

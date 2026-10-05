// Resolve a stable id for a user object.
//
// Priority cascade:
//   1. user.id if it's already set — keep it, never overwrite a known id.
//   2. prospector_user_id — a UUID older builds wrote in this browser.
//      Stable across sessions, lost on cache wipe.
//   3. Fresh crypto.randomUUID() — last resort. Persisted to prospector_user_id
//      so subsequent calls return the same value within the same browser.
//
// Used by:
//   - App.js one-time migration to repair existing prospector_user objects that
//     were written before the onboarding fix shipped (every existing user).

export function resolveUserId(user) {
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

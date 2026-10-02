// prospector-auth-v1 - the ONE place workspace role names live (REVISABLE).
// Mirrored by the business_members/workspace_invites CHECK constraints and
// role_rank() in supabase/migrations/20261002_prospector_auth_v1.sql.
//   owner  - everything, incl. deleting the workspace / transferring ownership
//   admin  - members, invites, settings, integrations, all data
//   member - full use of data and tools; no member management or settings
//   viewer - read-only dashboards and reports; no edits, no syncs
export const ROLES = ['owner', 'admin', 'member', 'viewer'];

export const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer' };

const RANK = { viewer: 1, member: 2, admin: 3, owner: 4 };

export function roleAtLeast(role, minRole) {
  return (RANK[role] || 0) >= RANK[minRole];
}

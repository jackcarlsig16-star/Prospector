// Manager team-account scoping — extracted from ManagerCommandCenter.js so
// App.js's persistent Scout mount can compute the same "my team's accounts,
// optionally filtered to one AE" view without duplicating the filter logic.
export function getManagerScopedAccounts(accounts, teamAEs, selectedAeId) {
  if (!teamAEs.length) return [];
  const ids = new Set(teamAEs.map(ae => ae.id));
  const teamAccounts = accounts.filter(a => a.aeId && ids.has(a.aeId));
  return selectedAeId === 'all' ? teamAccounts : teamAccounts.filter(a => a.aeId === selectedAeId);
}

export function getAeMap(teamAEs) {
  return Object.fromEntries(teamAEs.map(ae => [ae.id, ae.name]));
}

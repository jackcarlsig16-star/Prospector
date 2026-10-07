// sales-partners-workflow-v1 - manual partner order (sales_goals.sort_rank).
//
// The client sends a group's whole order after a move. Ranked rows sort
// first (ascending), unranked after, so the moved row can usually take a
// rank between its neighbours - one row written. When a row above it is
// still unranked (a group nobody has ordered by hand yet), a single rank
// can't hold the spot: it would jump above every unranked row. Then the
// rows from the top down to the moved one get ranks once, and later moves
// in that group are back to one row.
const MIN_GAP = 1e-6; // below this, bisecting again loses precision - renumber

// order: ids top to bottom; rankById: Map id -> number|null; movedId in order.
// Returns [{ id, sort_rank }] for rows whose rank changes.
export function planRanks(order, rankById, movedId) {
  const k = order.indexOf(movedId);
  const rank = id => rankById.get(id) ?? null;
  const above = order.slice(0, k);
  const hi = order.slice(k + 1).map(rank).find(r => r !== null) ?? null;
  const lo = k > 0 ? rank(order[k - 1]) : null;
  const aboveRanked = above.every((id, i) => rank(id) !== null && (i === 0 || rank(id) > rank(above[i - 1])));
  const fits = aboveRanked && (lo === null || hi === null || hi - lo > MIN_GAP);
  const current = rank(movedId);
  if (aboveRanked && current !== null && (lo === null || current > lo) && (hi === null || current < hi)) return [];
  if (fits) {
    const next = lo === null && hi === null ? 0 : lo === null ? hi - 1 : hi === null ? lo + 1 : (lo + hi) / 2;
    return [{ id: movedId, sort_rank: next }];
  }
  // Renumber the top of the group down to the moved row, all below hi.
  return order.slice(0, k + 1)
    .map((id, i) => ({ id, sort_rank: hi === null ? i + 1 : hi - (k + 1 - i) }))
    .filter(u => u.sort_rank !== rank(u.id));
}

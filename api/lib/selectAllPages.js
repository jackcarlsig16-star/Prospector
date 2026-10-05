// PostgREST caps every response at 1,000 rows (max-rows) and says nothing
// when it truncates, so a growing table silently loses its newest rows.
// buildQuery() must return a fresh query with a total, stable ORDER BY (end
// on a unique column) or pages can overlap or skip rows.
const PAGE = 1000;

export async function selectAllPages(buildQuery) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await buildQuery().range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

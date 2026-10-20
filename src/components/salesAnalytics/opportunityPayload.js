// An edit sends only the fields the person changed: the row carries
// server-only columns (record_id, apollo_account_id, ...) that the update
// route refuses, so echoing the whole row back 400s every save.
export function savePayload(opportunity, draft) {
  const payload = {};
  for (const key of Object.keys(draft)) {
    if (['id', 'business_id', 'source', 'archived_at', 'created_at', 'updated_at', 'priority_set_by', 'priority_set_at'].includes(key)) continue;
    let v = draft[key];
    if (v === '') v = null;
    if (['covered_lives', 'probability', 'est_value', 'priority'].includes(key) && v !== null) v = Number(v);
    if (opportunity && v === (opportunity[key] ?? null)) continue;
    payload[key] = v;
  }
  return payload;
}

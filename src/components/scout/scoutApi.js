// scout-v2 REV3 Stage 2 - the bar's two calls (Stage 1's routes). Search is free and not behind aiLimit; ask is one
// Claude call on the server (callType scout_ask), never /proxy from here. Errors carry the status so the bar can tell
// the daily cap (429) from a server it can't reach (network / 5xx).
async function call(url, init) {
  let res;
  try { res = await fetch(url, init); } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw Object.assign(new Error('offline'), { status: 0, offline: true });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status, body: data });
  return data;
}

const post = (url, body) => call(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const scoutApi = {
  search: (q, scope, { signal } = {}) => call(`/api/scout/search?${new URLSearchParams({ q, scope })}`, { signal }),
  ask: body => call('/api/scout/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  // scout-v3 S1: plan writes nothing (the card, an "open" or the can't-do state); act runs it; undo reverses it; pack = Copy for Claude.
  plan: body => post('/api/scout/plan', body), act: body => post('/api/scout/act', body), undo: body => post('/api/scout/undo', body), pack: body => post('/api/scout/pack', body),
};

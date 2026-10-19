// Fixture Apollo: replaces fetch for api.apollo.io ONLY, so apolloClient's real
// allowlist + call counter run with 0 real Apollo calls. POST /contacts/search
// answers from `accounts` ({ <account id>: [{ id, first_name, last_name, title }] },
// names and titles only - no emails or phones); anything else Apollo-bound
// throws. Every other URL goes to the real fetch.
// Node tests: installApolloFixture(accounts). A server: node --import
// ./api/sales/testing/apolloFixture.mjs server.js with APOLLO_FIXTURE='<json>'.
export const apolloFixtureCalls = [];

export function installApolloFixture(accounts) {
  const realFetch = globalThis.fetch;
  process.env.APOLLO_API_KEY ||= 'fixture-key-not-real';
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (!u.startsWith('https://api.apollo.io/')) return realFetch(url, init);
    const path = new URL(u).pathname.replace('/api/v1', '');
    apolloFixtureCalls.push(`${init.method} ${path}`);
    if (process.env.APOLLO_FIXTURE) console.log(`[apollo fixture] answered ${init.method} ${path}`);
    if (init.method !== 'POST' || path !== '/contacts/search') throw new Error(`fixture Apollo: ${init.method} ${path} is not faked`);
    const body = JSON.parse(init.body);
    const id = body.account_ids?.[0];
    const all = (accounts[id] || []).map(c => ({ ...c, account_id: id }));
    const per = body.per_page || 100, page = body.page || 1;
    const json = {
      breadcrumbs: [{ signal_field_name: 'account_ids', value: [id] }],
      contacts: all.slice((page - 1) * per, page * per),
      pagination: { page, per_page: per, total_entries: all.length, total_pages: Math.max(1, Math.ceil(all.length / per)) },
    };
    return new Response(JSON.stringify(json), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return () => { globalThis.fetch = realFetch; };
}

if (process.env.APOLLO_FIXTURE) {
  installApolloFixture(JSON.parse(process.env.APOLLO_FIXTURE));
  console.log('[apollo fixture] installed - no real Apollo calls');
}

// Fixture Apollo: replaces fetch for api.apollo.io ONLY, so apolloClient's real
// allowlist + call counter run with 0 real Apollo calls. POST /contacts/search
// answers from `accounts` ({ <account id>: [{ id, first_name, last_name, title }] },
// names and titles only - no emails or phones); anything else Apollo-bound
// throws. Every other URL goes to the real fetch.
// Node tests: installApolloFixture(accounts). A server: node --import
// ./api/sales/testing/apolloFixture.mjs server.js with APOLLO_FIXTURE='<json>'.
export const apolloFixtureCalls = [];

// signals-v1 Stage 4: `visitors` = { all, us, balances } also answers
// GET /users/api_profile (balances in order, the last one repeats) and the
// website-visitor POST /mixed_companies/search (`us` when the US/500+
// filters are on, else `all`; each { organizations, accounts }).
// FIX people-apollo-visibility-v1: `email` = { messages: [{ id, contact_id, completed_at, stats: ['opened'…] }],
// activities: { <message id>: emailer_message } } answers GET /emailer_messages/search (by the stat filter, paged)
// and GET /emailer_messages/:id/activities. empty: true answers every other allowlisted call with an empty
// result instead of throwing (a whole Sync now against the fixture). Made-up rows only; no emails or phones.
// visitor-to-record-v1: `people` = { <domain>: [{ id, first_name, last_name_obfuscated, title, ... }] } answers
// POST /mixed_people/api_search by q_organization_domains[0] (a request without a domain never gets here: the
// allowlist guard throws first). Made-up rows; a row may carry email / phone keys ON PURPOSE so tests prove they are
// never mapped.
export function installApolloFixture(accounts, visitors = null, email = null, people = null) {
  const realFetch = globalThis.fetch;
  process.env.APOLLO_API_KEY ||= 'fixture-key-not-real';
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (!u.startsWith('https://api.apollo.io/')) return realFetch(url, init);
    const path = new URL(u).pathname.replace('/api/v1', '');
    apolloFixtureCalls.push(`${init.method} ${path}`);
    if (process.env.APOLLO_FIXTURE) console.log(`[apollo fixture] answered ${init.method} ${path}`);
    const answer = json => new Response(JSON.stringify(json), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (visitors && init.method === 'GET' && path === '/users/api_profile') {
      const n = visitors.balances.length > 1 ? visitors.balances.shift() : visitors.balances[0];
      return answer({ num_credits_remaining: n, total_unified_credits_used: 0 });
    }
    if (visitors && init.method === 'POST' && path === '/mixed_companies/search') {
      const body = JSON.parse(init.body);
      if (visitors.fail) return new Response(JSON.stringify({ error: 'fixture failure' }), { status: 422, headers: { 'Content-Type': 'application/json' } });
      const set = (body.organization_locations ? visitors.us : visitors.all) || {};
      const total = (set.organizations || []).length + (set.accounts || []).length;
      return answer({ organizations: set.organizations || [], accounts: set.accounts || [], pagination: { page: body.page || 1, per_page: body.per_page, total_entries: total, total_pages: 1 } });
    }
    if (people && init.method === 'POST' && path === '/mixed_people/api_search') {
      const body = JSON.parse(init.body);
      const rows = people[body.q_organization_domains?.[0]] || [];
      return answer({ total_entries: rows.length, people: rows.slice(0, body.per_page || 10) });
    }
    if (email && init.method === 'GET' && path === '/emailer_messages/search') {
      const q = new URL(u).searchParams;
      const per = Number(q.get('per_page')) || 100, page = Number(q.get('page')) || 1;
      const hits = (email.messages || []).filter(m => (m.stats || []).includes(q.get('emailer_message_stats[]')));
      return answer({ emailer_messages: hits.slice((page - 1) * per, page * per) });
    }
    const act = path.match(/^\/emailer_messages\/([^/]+)\/activities$/);
    if (email && init.method === 'GET' && act) return answer({ emailer_message: (email.activities || {})[act[1]] || { emailer_message_events: [] } });
    if (email?.empty && !(init.method === 'POST' && path === '/contacts/search')) return answer({ emailer_campaigns: [], accounts: [], contacts: [], email_accounts: [], emailer_messages: [], pagination: { page: 1, per_page: 100, total_entries: 0, total_pages: 1 } });
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
    return answer(json);
  };
  return () => { globalThis.fetch = realFetch; };
}

if (process.env.APOLLO_FIXTURE) {
  installApolloFixture(JSON.parse(process.env.APOLLO_FIXTURE), null, process.env.APOLLO_FIXTURE_EMAIL ? JSON.parse(process.env.APOLLO_FIXTURE_EMAIL) : null);
  console.log('[apollo fixture] installed - no real Apollo calls');
}

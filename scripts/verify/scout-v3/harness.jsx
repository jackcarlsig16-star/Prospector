// scout-v3 Stage 2 - the visual harness: the REAL Scout components (PersistentScout and everything under it) mounted on
// a blank page with window.fetch answered from fixtures - the design mockups' own example rows. No server, no database,
// no sign-in, no model call: nothing can be written. The driver (scout-v3-stage2.mjs) sets window.__replies per state.
import { createRoot } from 'react-dom/client';
import PersistentScout from '../../../src/components/PersistentScout';

const B = { id: 'b1', name: 'HomeLover', color: '#E2418A', features: { goals_sales: true } };
const me = { profile: { id: 'u1' }, memberships: [{ business_id: 'b1', role: 'member' }] };
const emp = (id, name, stage) => ({ type: 'employer', id, name, stage });
const person = (i, name, title, heat, co, visit, email) => ({ entity: 'people', id: `prospect:p${i}`, title: name, score: heat, workspace_id: 'b1', workspace_name: 'HomeLover', open: { page: 'sales', params: { tab: 'pipeline', view: 'people', open: `person:prospect:p${i}` } }, why: `${name} · ${title}`,
  row: { kind: 'person', key: `prospect:p${i}`, name, title, company: co, heat, heat_band: 'hot', last_visit: visit, last_email: { at: '2026-10-29', what: email }, status: 'new', sequenced: true } });
const task = (i, text, due, overdue, owner) => ({ entity: 'todos', id: `t${i}`, title: text, date: due, workspace_id: 'b1', workspace_name: 'HomeLover', open: { page: 'sales', params: { tab: 'actions', open: `todo:t${i}` } }, why: text, row: { kind: 'task', id: `t${i}`, text, due, overdue, owner, link: null } });
const CF = emp('e1', 'Cloudflare', 'target'), NG = emp('e2', 'Northrop Grumman', 'contacted');
const PEOPLE = [person(1, 'Danilea Mayer', 'Principal People Team', 48, CF, '2026-11-08', 'opened'), person(2, 'Meagan Earley', 'Principal People Team', 46, CF, '2026-11-08', 'sent'), person(3, 'Paola Ball', 'Global Wellbeing', 46, CF, '2026-11-08', 'sent'), person(4, 'James Curcio', 'Director, Global Head', 46, CF, '2026-11-08', 'sent'), person(5, 'Person Five', 'Benefits Lead', 41, NG, '2026-11-09', 'opened')];
const TASKS = [task(1, "Send 24HF joint note to Upside with Brad cc'd", '2026-11-08', true, 'mine'), task(2, 'Intro Upside to Justworks, Access Development and OneDigital', '2026-11-10', false, 'mine'), task(3, 'Create user reporting draft for Seif', '2026-11-11', false, 'mine'), task(4, 'Reach out to PerkSpot and Corestream as potential partners', '2026-11-12', false, 'mine'), task(5, 'Find contact + personalize Step 1', '2026-11-13', false, 'another owner')];
const base = { usage: { input_tokens: 3026, output_tokens: 306, cost_usd: 0.014 }, withheld: false, ask: { sort: 'heat' }, context_stats: { reads: ['people + visitors', 'open to-dos', 'glossary'], rows_by_entity: { people: 19, todos: 342 } }, cap: { used: 3, max: 40 }, scope: 'b1' };
const ANSWER = { ...base, answer_md: 'Two parts.', summary: 'Two parts. 5 hot prospects whose companies visited this week, four of them at Cloudflare. 5 tasks, most urgent first; one is overdue.',
  sections: [
    { title: 'Hot prospects visiting', count: 5, total: 19, rule: 'Hot = heat ≥ 40 · visiting = company seen in the last 7 days · sorted by heat', read: 'people + visitors (19)', rows: PEOPLE, line: null, brief: null },
    { title: 'Most important tasks', count: 5, total: 342, rule: "Important = overdue first, then due soonest; yours before the team's", read: 'open to-dos (342)', rows: TASKS, line: null, brief: null },
  ], items: [...PEOPLE, ...TASKS] };
const co = (i, name, kind, owner) => ({ entity: kind === 'partner' ? 'partners' : 'employers', id: `c${i}`, title: name, score: 80 - i * 4, workspace_id: 'b1', workspace_name: 'HomeLover', open: { page: 'sales', params: { tab: 'pipeline', view: 'companies', open: `${kind}-c${i}` } }, why: name, row: { kind: 'company', type: kind, id: `c${i}`, name, score: 80 - i * 4, band: 'P1', owner, stage: 'contacted' } });
const COMPANIES = [co(1, 'Northrop Grumman', 'employer', 'Jack'), co(2, 'MetLife', 'partner', 'Jack'), co(3, 'Flowserve Corporation', 'employer', 'Jack'), co(4, 'Mace', 'employer', 'Cyrus'), co(5, 'IXL Learning', 'employer', 'Cyrus')];
const COMPANY_ANSWER = { ...base, ask: { sort: 'score' }, answer_md: 'Five companies.', summary: 'Your five highest-intent companies this week.', sections: [{ title: 'Top companies', count: 5, total: 40, rule: 'Ranked by intent score.', read: 'goals/scores (40)', rows: COMPANIES, line: null, brief: null }], items: COMPANIES };
const BRIEF = { ...base, answer_md: 'Northrop Grumman is an employer at Contacted, owned by Jack. Five visits by eight people this week, mostly on the wealth-manager pages.', summary: 'Northrop Grumman is an employer at Contacted, owned by Jack. Five visits by eight people this week, mostly on the wealth-manager pages.',
  sections: [{ title: 'Brief', count: 1, total: 1, rule: 'Everything on file for the record named.', read: 'goals/brief/employer/c1', rows: [COMPANIES[0]], line: null, brief: { entity: 'employers', id: 'c1' } }], items: [COMPANIES[0]] };
window.__fixtures = { ANSWER, COMPANY_ANSWER, BRIEF };
window.__replies = { ask: ANSWER, plan: { command: false }, act: {}, undo: { line: 'undone', rows: [] }, pack: { text: 'Question: …', records: 1, chars: 2100, trimmed: 0 }, delay: {}, status: {} };
window.__calls = [];
window.fetch = async (url, init = {}) => {
  const u = String(url), k = u.split('/').pop().split('?')[0];
  window.__calls.push({ url: u, method: init.method || 'GET' });
  const R = window.__replies;
  const body = u.includes('/api/scout/search') ? { groups: [] } : u.endsWith('/members') ? { members: [{ user_id: 'u1', name: 'Jack' }, { user_id: 'u2', name: 'Cyrus' }, { user_id: 'u3', name: 'Seif' }] } : R[k] ?? {};
  if (R.delay[k]) await new Promise(r => setTimeout(r, R.delay[k]));
  const status = R.status[k] || 200;
  return { ok: status < 400, status, json: async () => body };
};
const q = new URLSearchParams(window.location.search);
document.body.style.cssText = 'margin:0;background:#12161B;min-height:100vh;';
const root = document.getElementById('root');
root.style.cssText = q.get('phone') ? 'padding:8px;display:flex;justify-content:flex-end;' : 'padding:16px 24px;display:flex;justify-content:flex-end;';
createRoot(root).render(<main aria-label="Scout harness" className="ui-theme-dark" style={{ width: '100%', display: 'flex', justifyContent: 'flex-end' }}><h1 style={{ position: 'absolute', left: -9999 }}>Scout</h1><PersistentScout compact businesses={[B]} activeBusiness={B} me={me} onOpen={() => {}} /></main>);

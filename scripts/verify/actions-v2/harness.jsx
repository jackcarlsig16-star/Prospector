// actions-v2 Stage 2 - the visual harness: the REAL Today components (TodayList, TodayFixes) inside the sales theme
// root, with window.fetch answered from fixtures - the mockups' own example rows. No server, no database, no sign-in,
// no model call: nothing can be written. The driver (actions-v2-stage2.mjs) sets window.__replies per state.
import { createRoot } from 'react-dom/client';
import '../../../src/ui/kitTheme';
import '../../../src/components/scout/scoutStyles';
import { SA, SA_THEME_CSS, SA_THEME_ROOT_ID, saSans } from '../../../src/components/salesAnalytics/theme';
import { memberLookup } from '../../../src/components/salesAnalytics/goals/goalsUi';
import TodayList from '../../../src/components/salesAnalytics/goals/today/TodayList';
import TodayFixes from '../../../src/components/salesAnalytics/goals/today/TodayFixes';

const TODAY = '2026-11-19';
const MEMBERS = [{ user_id: 'u1', name: 'Jack Carlson' }, { user_id: 'u2', name: 'Cyrus Radjoo' }, { user_id: 'u3', name: 'Seif Example' }];
const uid = i => `00000000-0000-4000-8000-00000000000${i}`;
const co = (i, name, band, score, extra = {}) => ({ type: 'employer', id: uid(i), key: `employer-${uid(i)}`, name, score, band, pinned: false, visits_7d: 0, ...extra });
let n = 0;
const row = (text, extra = {}) => ({ key: `todo:t${++n}`, kind: 'todo', id: `t${n}`, text, company: null, person: null, owner_user_id: 'u1', owner: 'Jack', due: null, overdue: false, late_days: 0, source: 'manual', verb: 'next_steps', virtual: false, ...extra });
const group = (id, label, note, rows, extra = {}) => ({ id, label, note, n: rows.length, collapsed: id === 'rest', fold: null, rows, ...extra });
const old = Array.from({ length: 4 }, (_, i) => row(`Older overdue to-do ${i + 1}`, { due: '2026-10-08', overdue: true, late_days: 42 - i * 6, folded: true, source: 'call_notes' }));
const due = [...old,
  row('Send the benefits one-pager', { due: '2026-11-16', overdue: true, late_days: 3, folded: false, company: co(1, 'Northrop Grumman', 'P1', 72, { pinned: true }), source: 'call_notes', verb: 'draft_email' }),
  row('Reply to the intro thread', { due: TODAY, company: co(2, 'MetLife', 'P1', 68), verb: 'draft_reply' }),
  row('Confirm the December demo time', { due: TODAY, source: 'scout' })];
const top = [row('Find the benefits lead', { company: co(3, 'Flowserve Corporation', 'P1', 73), verb: 'find_people', source: 'signal' }),
  row('Email the People team', { due: '2026-11-20', company: co(4, 'Cloudflare', 'P1', 65), person: { key: 'prospect:p1', name: 'Danilea Mayer', title: 'Principal People Team', heat: 48, heat_band: 'hot' }, verb: 'draft_email', source: 'panel' })];
const visited = [row('Follow up after the pricing visit', { company: co(5, 'Qubika', 'P2', 56, { visits_7d: 4 }), verb: 'draft_email', source: 'tidy' })];
const reply = [{ ...row('Reply to Crystal Pringle', { verb: 'draft_reply', source: 'reply', company: co(6, 'Solidcore', 'P3', 38), person: { key: 'prospect:p2', name: 'Crystal Pringle', title: null, heat: 108, heat_band: 'hot' }, replied_at: '2026-11-17T10:00:00Z' }), key: 'reply:prospect:p2', kind: 'reply', id: null, virtual: true },
  { ...row('Waiting on Pat: the signed MSA', { source: 'waiting', owner_user_id: null, owner: null, company: { ...co(7, 'MetLife', 'P1', 68), type: 'partner' }, verb: 'draft_email' }), kind: 'waiting' }];
const rest = [row('Draft the partner recap', { source: 'plan' }), row('Read the S-1', { owner_user_id: 'u2', owner: 'Cyrus' }), row('Ask about the January budget', { owner_user_id: null, owner: null, source: 'call_notes' })];
const groups = [group('due', 'Due and overdue', 'due today or earlier, earliest first', due, { fold: { overdue: 5, hidden: 4, oldest_days: 42 } }), group('top', 'Pinned or P1 company', 'the company is pinned or in the top band', top), group('visited', 'Visited this week', 'the company was on the site in the last 7 days', visited), group('reply', 'Waiting on a reply', 'they wrote back and nobody has answered, or we are waiting on them', reply), group('rest', 'Everything else', 'no date, no ranked company · newest first', rest)];
let rank = 0; for (const g of groups) for (const r of g.rows) r.rank = ++rank;
const RULE = '1 due today or overdue · 2 at a pinned or P1 company · 3 the company visited in the last 7 days · 4 a reply is owed · 5 everything else. Inside a group: earliest due, then company score, then newest. A to-do appears once, in the first group it fits. This week’s five sit above the list.';
const VIEW = { today: TODAY, rule: RULE, strip: [], five: { used: 0, max: 5 }, badge: 9, members: MEMBERS.map(m => ({ id: m.user_id, name: m.name })), counts: { shown: 164, mine: 164, team: 342, overdue: 65, undated: 271, snoozed: 2, open_todos: 342, sources: {} }, verbs: {}, groups };
const STRIP = [{ slot: 1, id: 'c1', text: 'Send the benefits one-pager', company: 'Northrop Grumman', due: '2026-11-16', late_days: 3 }, { slot: 2, id: 'c2', text: 'Email the People team', company: 'Cloudflare', due: '2026-11-20', late_days: 0 }, { slot: 3, id: 'c3', text: 'Draft the partner recap', company: null, due: null, late_days: 0 }];
const emptied = keep => ({ ...VIEW, counts: { ...VIEW.counts, shown: keep ? 3 : 0 }, groups: groups.map(g => (keep && g.id === 'rest' ? g : { ...g, n: 0, rows: [], fold: null })) });
const FIXES = { n: 4, today: TODAY, items: [
  { id: 'replies', n: 4, title: '4 replies have no to-do', note: 'People wrote back and nothing on the list answers them.', action: { label: 'Add 4 to-dos', verb: 'reply_todos', rows: [{ entity: 'people', id: 'prospect:p2', title: 'Crystal Pringle', company: null }] } },
  { id: 'unowned', n: 118, title: '118 to-dos have no owner', note: 'They show under Team only, so nobody’s Today has them. The card takes 25 at a time.', action: { label: 'Assign with Scout', verb: 'assign_owner', rows: [{ entity: 'todos', id: 't1', title: 'Ask about the January budget' }] } },
  { id: 'unlinked', n: 251, title: '251 to-dos have no company', note: 'They can’t be ranked by score or visits. 26 name a company in their text (8 name more than one).', action: { label: 'Link 18', verb: 'link_named', rows: [{ entity: 'todos', id: 't2', title: 'Call Cloudflare about the pilot' }] } },
  { id: 'undated', n: 271, title: '271 of your to-dos have no date', note: 'They sit in Everything else until dated. The card takes 25 at a time.', action: { label: 'Date with Scout', verb: 'task_due', needs: 'date', rows: [{ entity: 'todos', id: 't3', title: 'Draft the partner recap' }] } },
], feeds: [] };
window.__fixtures = { VIEW, WITH_STRIP: { ...VIEW, strip: STRIP, five: { used: 3, max: 5 } }, EMPTY_RANKED: emptied(true), EMPTY_NONE: emptied(false), FIXES };
window.__replies = { today: VIEW, fixes: FIXES, plan: { command: false }, act: {}, undo: { line: 'undone', rows: [] }, status: {} };
window.__calls = [];
window.fetch = async (url, init = {}) => {
  const u = String(url), k = u.split('?')[0].split('/').pop();
  window.__calls.push({ url: u, method: init.method || 'GET', body: init.body || null });
  const status = window.__replies.status[k] || 200;
  return { ok: status < 400, status, json: async () => window.__replies[k] ?? {} };
};
const q = new URLSearchParams(window.location.search);
if (window.__fixtures[q.get('fixture')]) window.__replies.today = window.__fixtures[q.get('fixture')];
const phone = !!q.get('phone'), viewer = !!q.get('viewer'), fixes = !!q.get('fixes');
document.body.style.cssText = 'margin:0;background:#0B0D10;min-height:100vh;';
createRoot(document.getElementById('root')).render(
  <div className="ui-theme-dark">
    <div id={SA_THEME_ROOT_ID} style={{ ...saSans, background: SA.ground, color: SA.text, minHeight: '100vh', padding: phone ? 16 : '24px 24px 32px', boxSizing: 'border-box' }}>
      <style>{SA_THEME_CSS}</style>
      <main aria-label="Today harness">
        <h1 style={{ margin: '0 0 12px', fontSize: phone ? 22 : 28, fontWeight: 600, letterSpacing: '-.02em' }}>Today <span style={{ fontSize: 14, fontWeight: 400, color: SA.soft, marginLeft: 8 }}>Thu Nov 19</span></h1>
        {fixes
          ? <div style={{ width: phone ? 'auto' : 380, background: SA.ground }}><h2 style={{ fontSize: 17, margin: 0 }}>Needs attention (4)</h2><TodayFixes businessId="b1" canEdit={!viewer} /></div>
          : <TodayList businessId="b1" canEdit={!viewer} lookup={memberLookup(MEMBERS)} compact={phone} />}
      </main>
    </div>
  </div>,
);

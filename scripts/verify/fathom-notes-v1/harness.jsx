// fathom-notes-v1 Stage 2 - the visual harness: the REAL Settings card, Today list and Intake review inside the sales
// theme root, with window.fetch answered from fixtures (made-up names; no key, no address, no phone). No server, no
// database, no sign-in, no model call, no Fathom call: nothing can be written. ?view=card&state=… | ?view=today.
import { createRoot } from 'react-dom/client';
import '../../../src/ui/kitTheme';
import '../../../src/components/scout/scoutStyles';
import { SA, SA_THEME_CSS, SA_THEME_ROOT_ID, saSans } from '../../../src/components/salesAnalytics/theme';
import { memberLookup } from '../../../src/components/salesAnalytics/goals/goalsUi';
import TodayList from '../../../src/components/salesAnalytics/goals/today/TodayList';
import FathomCard from '../../../src/components/salesAnalytics/goals/FathomCard';

const TODAY = '2026-11-20';
const MEMBERS = [{ user_id: 'u1', name: 'Jack Carlson' }, { user_id: 'u2', name: 'Cyrus Radjoo' }];
const member = (over = {}) => ({ user_id: 'u1', name: 'Jack', connected: true, status: 'connected', connected_at: '2026-11-20T17:00:00Z', last_event_at: '2026-11-20T18:12:00Z', webhook: true, webhook_id_tail: '3456', pull: { started: false, more: false, finished: false }, stored: 4, last_recording: '2026-11-19', ...over });
const status = (over = {}) => ({ connected: true, me: 'u1', owner: true, members: [member()], others: [{ user_id: 'u2', name: 'Cyrus' }], extracts: { cap: 10, used: 2, left: 8 }, stored: 4, ...over });
const CARDS = {
  connected: status({ members: [member(), member({ user_id: 'u2', name: 'Cyrus', stored: 1, last_recording: '2026-11-18', last_event_at: null, webhook: false, webhook_id_tail: null })], others: [] }),
  disconnected: status({ connected: false, members: [member({ connected: false, status: 'disconnected', webhook: false, webhook_id_tail: null })] }),
  new: status({ connected: false, members: [], stored: 0 }),
  error: status(),
};
const row = (i, text, extra = {}) => ({ key: `todo:t${i}`, kind: 'todo', id: `t${i}`, text, company: null, person: null, owner_user_id: 'u1', owner: 'Jack', due: null, overdue: false, late_days: 0, source: 'manual', verb: 'next_steps', virtual: false, ...extra });
const review = (id, text, verb = 'review') => ({ key: `review:${id}`, kind: 'review', id, note_id: id, text, company: null, person: null, owner_user_id: 'u1', owner: 'Jack', due: null, overdue: false, late_days: 0, source: 'call_notes', verb, virtual: true, group: 'due', call_date: TODAY });
const group = (id, label, note, rows) => ({ id, label, note, n: rows.length, collapsed: id === 'rest', fold: null, rows });
const groups = [
  group('due', 'Due and overdue', 'due today or earlier, earliest first', [review('n1', 'Review call notes · Northwind weekly · 3 tasks · 2 companies · 4 facts · Nov 20'), review('n2', 'Call notes not read yet · Partner sync · Nov 18', 'extract'),
    row(1, 'Send the benefits one-pager', { due: '2026-11-17', overdue: true, late_days: 3, source: 'call_notes', company: { type: 'employer', id: '00000000-0000-4000-8000-000000000001', key: 'k', name: 'Northwind', score: 72, band: 'P1', pinned: true, visits_7d: 0 }, verb: 'draft_email' }), row(2, 'Confirm the December demo time', { due: TODAY })]),
  group('top', 'Pinned or P1 company', 'the company is pinned or in the top band', []), group('visited', 'Visited this week', 'the company was on the site in the last 7 days', []),
  group('reply', 'Waiting on a reply', 'they wrote back and nobody has answered, or we are waiting on them', []), group('rest', 'Everything else', 'no date, no ranked company · newest first', [row(3, 'Draft the partner recap')]),
];
let rank = 0; for (const g of groups) for (const r of g.rows) { r.rank = ++rank; r.rank_open = rank; }
const VIEW = { today: TODAY, rule: '1 due today or overdue · 2 at a pinned or P1 company · 3 the company visited in the last 7 days · 4 a reply is owed · 5 everything else.', strip: [], five: { used: 0, max: 5, can_add: false }, badge: 4, members: MEMBERS.map(m => ({ id: m.user_id, name: m.name })),
  counts: { shown: 5, mine: 5, team: 9, overdue: 1, undated: 1, snoozed: 0, open_todos: 3, sources: {} }, verbs: {}, groups };
const task = (text, extra = {}) => ({ text, owner_user_id: 'u1', due_date: null, link_type: null, link_id: null, company_name: null, steps: [], evidence: '', similar_to: null, ...extra });
const NOTE = { id: 'n1', title: 'Northwind weekly', call_date: TODAY, source_type: 'call', source_label: 'Fathom · Northwind weekly', accepted_at: null, fathom_url: 'https://fathom.video/share/example', attendees: [] };
const REVIEW = { note: NOTE, call_date: TODAY, summary: ['Northwind will pilot in January.', 'Dana owes the employer list.', 'Next call is set for December.'], categories: [], recent_accepts: [],
  tasks: [task('Send Northwind the pilot one-pager', { evidence: 'Jack to send the one-pager', due_date: '2026-11-24' }), task('Book the December kickoff', { owner_user_id: 'u2', evidence: 'Cyrus will book the kickoff' }), task('Draft the pilot success measures', { evidence: 'we should write down what good looks like' })],
  companies: [], ownership: [], people: [], touches: [], facts: [], decisions: [], waiting_on: [], terms: [], next_meeting: [], insights: { track: [], optimize: [], channel_links: [] },
  ideas: [{ text: 'A pilot dashboard the employer can open', kind: 'product', company: 'Northwind', evidence: 'could we see it live' }] };

window.__fixtures = { CARDS, VIEW, REVIEW };
const q = new URLSearchParams(window.location.search);
window.__replies = { today: VIEW, fathom: CARDS[q.get('state')] || CARDS.connected, members: { members: MEMBERS }, review: REVIEW, status: {} };
window.__calls = [];
window.fetch = async (url, init = {}) => {
  const u = String(url), k = u.split('?')[0].split('/').pop();
  window.__calls.push({ url: u, method: init.method || 'GET' });
  const code = window.__replies.status[k] || 200;
  return { ok: code < 400, status: code, json: async () => window.__replies[k] ?? {} };
};
const phone = !!q.get('phone');
document.body.style.cssText = 'margin:0;background:#0B0D10;min-height:100vh;';
createRoot(document.getElementById('root')).render(
  <div className="ui-theme-dark">
    <div id={SA_THEME_ROOT_ID} style={{ ...saSans, background: SA.ground, color: SA.text, minHeight: '100vh', padding: phone ? 16 : '24px 24px 32px', boxSizing: 'border-box' }}>
      <style>{SA_THEME_CSS}</style>
      <main aria-label="Fathom harness">
        <h1 style={{ margin: '0 0 12px', fontSize: phone ? 22 : 28, fontWeight: 600, letterSpacing: '-.02em' }}>{q.get('view') === 'card' ? 'Settings · Connections' : 'Today'}</h1>
        {q.get('view') === 'card' ? <FathomCard businessId="b1" canEdit /> : <TodayList businessId="b1" canEdit lookup={memberLookup(MEMBERS)} compact={phone} />}
      </main>
    </div>
  </div>,
);

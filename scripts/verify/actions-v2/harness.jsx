// actions-v2 - the visual harness: the REAL Today components (the frame row's title, Needs attention drawer and
// + To-do; TodayList with its work panel) inside the sales theme root, with window.fetch answered from fixtures - the
// mockups' own example rows. No server, no database, no sign-in, no model call: nothing can be written, and the
// clipboard is a stub that records what Copy would have written. The driver (actions-v2-stage3.mjs) sets
// window.__replies per state.
import { createRoot } from 'react-dom/client';
import '../../../src/ui/kitTheme';
import '../../../src/components/scout/scoutStyles';
import { SA, SA_THEME_CSS, SA_THEME_ROOT_ID, saSans } from '../../../src/components/salesAnalytics/theme';
import { memberLookup } from '../../../src/components/salesAnalytics/goals/goalsUi';
import TodayList from '../../../src/components/salesAnalytics/goals/today/TodayList';
import AttentionDrawer from '../../../src/components/salesAnalytics/goals/AttentionDrawer';

const TODAY = '2026-11-19';
const MEMBERS = [{ user_id: 'u1', name: 'Jack Carlson' }, { user_id: 'u2', name: 'Cyrus Radjoo' }, { user_id: 'u3', name: 'Seif Example' }];
const uid = i => `00000000-0000-4000-8000-00000000000${i}`;
const co = (i, name, band, score, extra = {}) => ({ type: 'employer', id: uid(i), key: `employer-${uid(i)}`, name, score, band, pinned: false, visits_7d: 0, ...extra });
let n = 0;
const row = (text, extra = {}) => ({ key: `todo:t${++n}`, kind: 'todo', id: `t${n}`, text, company: null, person: null, owner_user_id: 'u1', owner: 'Jack', due: null, overdue: false, late_days: 0, source: 'manual', verb: 'next_steps', virtual: false, ...extra });
const group = (id, label, note, rows, extra = {}) => ({ id, label, note, n: rows.length, collapsed: id === 'rest', fold: null, rows, ...extra });
const old = Array.from({ length: 4 }, (_, i) => row(`Older overdue to-do ${i + 1}`, { due: '2026-10-08', overdue: true, late_days: 42 - i * 6, folded: true, source: 'call_notes' }));
const due = [
  row('Send the benefits one-pager', { due: '2026-11-16', overdue: true, late_days: 3, folded: false, company: co(1, 'Northrop Grumman', 'P1', 72, { pinned: true }), source: 'call_notes', verb: 'draft_email' }),
  row('Reply to the intro thread', { due: TODAY, company: co(2, 'MetLife', 'P1', 68), verb: 'draft_reply' }),
  row('Confirm the December demo time', { due: TODAY, source: 'scout' }), ...old];
const top = [row('Find the benefits lead', { company: co(3, 'Flowserve Corporation', 'P1', 73), verb: 'find_people', source: 'signal' }),
  row('Email the People team', { due: '2026-11-20', company: co(4, 'Cloudflare', 'P1', 65), person: { key: 'prospect:p1', name: 'Danilea Mayer', title: 'Principal People Team', heat: 48, heat_band: 'hot' }, verb: 'draft_email', source: 'panel' })];
const visited = [row('Follow up after the pricing visit', { company: co(5, 'Qubika', 'P2', 56, { visits_7d: 4 }), verb: 'draft_email', source: 'tidy' })];
const reply = [{ ...row('Reply to Crystal Pringle', { verb: 'draft_reply', source: 'reply', company: co(6, 'Solidcore', 'P3', 38), person: { key: 'prospect:p2', name: 'Crystal Pringle', title: null, heat: 108, heat_band: 'hot' }, replied_at: '2026-11-17T10:00:00Z' }), key: 'reply:prospect:p2', kind: 'reply', id: null, virtual: true },
  { ...row('Waiting on Pat: the signed MSA', { source: 'waiting', owner_user_id: null, owner: null, company: { ...co(7, 'MetLife', 'P1', 68), type: 'partner' }, verb: 'draft_email' }), kind: 'waiting' }];
const rest = [row('Draft the partner recap', { source: 'plan' }), row('Read the S-1', { owner_user_id: 'u2', owner: 'Cyrus', stale: true }), row('Ask about the January budget', { owner_user_id: null, owner: null, source: 'call_notes', stale: true })];
const groups = [group('due', 'Due and overdue', 'due today or earlier, earliest first', due, { fold: { overdue: 5, hidden: 4, oldest_days: 42 } }), group('top', 'Pinned or P1 company', 'the company is pinned or in the top band', top), group('visited', 'Visited this week', 'the company was on the site in the last 7 days', visited), group('reply', 'Waiting on a reply', 'they wrote back and nobody has answered, or we are waiting on them', reply), group('rest', 'Everything else', 'no date, no ranked company · newest first', rest)];
let rank = 0, rankOpen = 0; for (const g of groups) for (const r of g.rows) { r.rank = r.folded ? null : ++rank; r.rank_open = ++rankOpen; }
const RULE = '1 due today or overdue · 2 at a pinned or P1 company · 3 the company visited in the last 7 days · 4 a reply is owed · 5 everything else. Inside a group: earliest due, then company score, then newest. A to-do appears once, in the first group it fits. This week’s five sit above the list.';
const VIEW = { today: TODAY, rule: RULE, strip: [], five: { used: 0, max: 5, can_add: false }, badge: 9, members: MEMBERS.map(m => ({ id: m.user_id, name: m.name })), counts: { shown: 164, mine: 164, team: 342, overdue: 65, undated: 271, snoozed: 2, open_todos: 342, sources: {} }, verbs: {}, groups };
const STRIP = [{ slot: 1, id: 'c1', todo_id: 't5', text: 'Send the benefits one-pager', company: 'Northrop Grumman', due: '2026-11-16', late_days: 3 }, { slot: 2, id: 'c2', text: 'Email the People team', company: 'Cloudflare', due: '2026-11-20', late_days: 0 }, { slot: 3, id: 'c3', text: 'Draft the partner recap', company: null, due: null, late_days: 0 }];
const emptied = keep => ({ ...VIEW, counts: { ...VIEW.counts, shown: keep ? 3 : 0 }, groups: groups.map(g => (keep && g.id === 'rest' ? g : { ...g, n: 0, rows: [], fold: null })) });
const FIXES = { n: 4, today: TODAY, items: [
  { id: 'replies', n: 4, title: '4 replies have no to-do', note: 'People wrote back and nothing on the list answers them.', action: { label: 'Add 4 to-dos', verb: 'reply_todos', rows: [{ entity: 'people', id: 'prospect:p2', title: 'Crystal Pringle', company: null }] } },
  { id: 'unowned', n: 118, title: '118 to-dos have no owner', note: 'They show under Team only, so nobody’s Today has them. The card takes 25 at a time.', action: { label: 'Assign with Scout', verb: 'assign_owner', rows: [{ entity: 'todos', id: 't1', title: 'Ask about the January budget' }] } },
  { id: 'unlinked', n: 251, title: '251 to-dos have no company', note: 'They can’t be ranked by score or visits. 26 name a company in their text (8 name more than one).', action: { label: 'Link 18', verb: 'link_named', rows: [{ entity: 'todos', id: 't2', title: 'Call Cloudflare about the pilot' }] } },
  { id: 'undated', n: 271, title: '271 of your to-dos have no date', note: 'They sit in Everything else until dated. The card takes 25 at a time.', action: { label: 'Date with Scout', verb: 'task_due', needs: 'date', rows: [{ entity: 'todos', id: 't3', title: 'Draft the partner recap' }] } },
], feeds: [{ id: 'apollo', label: 'Apollo sync', status: 'ok', failed: false, line: 'Last ran today' }, { id: 'visitors', label: 'Site visitors', status: 'ok', failed: false, line: 'Last ran today' }, { id: 'call_notes', label: 'Call-note intake', status: 'ok', failed: false, line: 'Last note 2026-11-18 · 6 to-dos made' }] };
const src = (id, label, status, extra = {}) => ({ id, label, status, last_at: '2026-11-19T15:00:00Z', error: null, ...extra });
const ATTENTION = { today: TODAY, n: 0, counts: { overdue_todos: 0, overdue_waiting: 0, held_apollo: 0, held_outlook: 0, campaign_sends: 0, campaign_replies: 0 }, sources: [src('apollo', 'Apollo sync', 'ok'), src('outlook', 'Outlook (mail + calendar)', 'ok'), src('visitors', 'Site visitors', 'ok')] };
const FEED_DOWN = { attention: { ...ATTENTION, sources: [src('apollo', 'Apollo sync', 'ok'), src('outlook', 'Outlook (mail + calendar)', 'ok'), src('visitors', 'Site visitors', 'failed', { error: 'The visitor list could not be read (500)' })] },
  fixes: { ...FIXES, n: 5, items: [{ id: 'feed:visitors', n: 1, title: 'Site visitors failed', note: 'The visitor list could not be read (500)', action: null }, ...FIXES.items], feeds: FIXES.feeds.map(f => (f.id === 'visitors' ? { ...f, status: 'failed', failed: true, line: 'The visitor list could not be read (500)' } : f)) } };
const GROUNDS = [{ id: 'G1', kind: 'visit', text: 'Cloudflare was on the site: 1 visit in 7 days, last Nov 8; top page /terms' }, { id: 'G2', kind: 'activity', text: 'Danilea Mayer: 2 sent, 2 opened, 0 clicked, 0 replied; last opened Nov 12' }, { id: 'G3', kind: 'nba', rule: 'linkedin_touch', text: 'LinkedIn touch: opened twice, no click' }, { id: 'G4', kind: 'note', text: 'Call note Nov 9 (Intro call): they asked what it costs the employer' }, { id: 'G5', kind: 'note', text: 'Call note Nov 18 (Follow-up): benefits renewal is in January' }];
const PACK = { records: 1, asks: [['sequence', 'Write a 3-touch sequence'], ['research', 'Research the account'], ['call', 'Prep me for a call']].map(([id, label]) => { const text = `Question: ${label} for this record, using only the facts below.\n\nCloudflare · employer · Target · P1 65 · pinned\nVisits: 1 in 7 days, last Nov 8, top page /terms\nPeople: Danilea Mayer (Principal People Team), Meagan Earley, Frank Wagner (Benefits Manager)\nLast email: Oct 29, opened\nNotes: 2 excerpts`; return { id, label, text, chars: text.length }; }) };
const WORK_ROW = { text: 'Email the People team', company: { type: 'employer', id: uid(4), name: 'Cloudflare' }, person: { key: 'prospect:p1', name: 'Danilea Mayer', title: 'Principal People Team' } };
const WORK = { key: 'todo:t9', verb: 'draft_email', row: WORK_ROW, grounds: GROUNDS, prompt_pack: PACK, usage: { calls: 1, cost_usd: 0.0183, cap: { used: 4, max: 30 } },
  steps: [{ text: 'LinkedIn touch', ground: 'G3', based_on: 'LinkedIn touch: opened twice, no click', source: 'rule' }, { text: 'Answer the cost question from the intro call', ground: 'G4', based_on: 'Call note Nov 9 (Intro call): they asked what it costs the employer', source: 'model' }, { text: 'Follow up before the January renewal', ground: 'G5', based_on: 'Call note Nov 18 (Follow-up): benefits renewal is in January', source: 'model' }],
  draft: { to: { name: 'Danilea Mayer', title: 'Principal People Team', company: 'Cloudflare' }, tone: null, lint: { ok: true, issues: 0 }, subject: 'A home-buying benefit for the Cloudflare team', body: 'Hi Danilea,\n\nYou asked on the intro call what this costs the employer, and I saw the team was back on the terms page this month.\n\nHomeLover helps employees buy, refinance or sell a home with a dedicated advisor. It is a benefit your team can offer without adding work for People Ops.\n\nWould 15 minutes next week work, Tuesday or Thursday morning?\n\nJack' } };
const WORKS = { draft: WORK,
  failed: { key: 'todo:t9', verb: 'draft_email', row: WORK_ROW, grounds: GROUNDS, steps: [WORK.steps[0]], prompt_pack: PACK, usage: { calls: 0, cost_usd: null, cap: null }, error: 'The draft failed: the model did not answer in time' },
  prep: { ...WORK, verb: 'prep_call', draft: undefined, brief: { text: 'Who: Danilea Mayer, Principal People Team at Cloudflare. Opened both emails, never replied.\n\nWhy now: the team was on the terms page this month and benefits renew in January.\n\nAsk:\n1. Who owns benefits decisions for next year?\n2. What did the last housing or relocation perk cost you?\n3. What would a pilot need to show by March?\n\nLikely objection: no budget before the renewal.' } },
  people: { ...WORK, verb: 'find_people', draft: undefined, steps: [], usage: { calls: 0, cost_usd: null, cap: null }, people: [{ key: 'person:x1', name: 'Frank Wagner', title: 'Benefits Manager', heat: 22, heat_band: 'warm', buyer: true }, { key: 'person:x2', name: 'Meagan Earley', title: 'People Operations Lead', heat: 9, heat_band: 'cold', buyer: false }] },
  next: { ...WORK, verb: 'next_steps', draft: undefined, steps: WORK.steps.slice(0, 2) },
  withheld: { ...WORK, steps: [], note: 'Nothing to suggest beyond the draft.', draft: { to: WORK.draft.to, tone: null, withheld: true, reason: 'Draft withheld: it held an address or phone shape. Try again.' } } };
window.__fixtures = { VIEW, WITH_STRIP: { ...VIEW, strip: STRIP, five: { used: 3, max: 5, can_add: false } }, WITH_FIVE: { ...VIEW, strip: STRIP, five: { used: 3, max: 5, can_add: true } }, EMPTY_RANKED: emptied(true), EMPTY_NONE: emptied(false), FIXES, FEED_DOWN, WORKS };
window.__replies = { today: VIEW, fixes: FIXES, attention: ATTENTION, work: WORK, plan: { command: false }, act: {}, undo: { line: 'undone', rows: [] }, status: {}, delay: {} };
window.__copied = [];
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__copied.push(t); } } });
window.__calls = [];
window.fetch = async (url, init = {}) => {
  const u = String(url), k = u.split('?')[0].split('/').pop();
  window.__calls.push({ url: u, method: init.method || 'GET', body: init.body || null });
  const status = window.__replies.status[k] || 200;
  if (window.__replies.delay[k]) await new Promise(r => setTimeout(r, window.__replies.delay[k]));
  return { ok: status < 400, status, json: async () => window.__replies[k] ?? {} };
};
const q = new URLSearchParams(window.location.search);
if (window.__fixtures[q.get('fixture')]) window.__replies.today = window.__fixtures[q.get('fixture')];
if (q.get('feed') === 'down') Object.assign(window.__replies, FEED_DOWN);
const phone = !!q.get('phone'), viewer = !!q.get('viewer');
document.body.style.cssText = 'margin:0;background:#0B0D10;min-height:100vh;';
createRoot(document.getElementById('root')).render(
  <div className="ui-theme-dark">
    <div id={SA_THEME_ROOT_ID} style={{ ...saSans, background: SA.ground, color: SA.text, minHeight: '100vh', padding: phone ? 16 : '24px 24px 32px', boxSizing: 'border-box' }}>
      <style>{SA_THEME_CSS}</style>
      <main aria-label="Today harness">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px', maxWidth: 1100 }} data-harness-frame>
          <h1 style={{ margin: '0 auto 0 0', fontSize: phone ? 22 : 28, fontWeight: 600, letterSpacing: '-.02em' }}>Today <span style={{ fontSize: 14, fontWeight: 400, color: SA.soft, marginLeft: 8 }}>Thu Nov 19</span></h1>
          <AttentionDrawer businessId="b1" canEdit={!viewer} compact={phone} pageLoadFailures={{}} onNav={() => {}} />
          {!viewer && <button type="button" className="ui-btn ui-btn--primary">+ To-do</button>}
        </div>
        <TodayList businessId="b1" canEdit={!viewer} lookup={memberLookup(MEMBERS)} compact={phone} />
      </main>
    </div>
  </div>,
);

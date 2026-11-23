import { render, screen, fireEvent, within } from '@testing-library/react';
import { AnswerPanel } from './ScoutAnswer';

// FIX scout-generative - the agenda answer on screen: the synthesis as prose (a plan by day, a judgement line), then
// the rows in their sections (Due · This week's five · Pinned and P1 · Goals · Calls to review · Replies owed), each
// with its count; a weak match offers the server's three nearest phrasings as Try chips. Invented rows; 0 server.
const task = (id, text, due) => ({ entity: 'todos', id, title: text, date: due, open: { page: 'sales' }, row: { kind: 'task', id, text, due, overdue: false, owner: 'mine', owner_user_id: 'u1', link: null } });
const company = (id, name) => ({ entity: 'employers', id, title: name, open: { page: 'sales' }, row: { kind: 'company', type: 'employer', id, name, score: 80, band: 'P1' } });
const plain = (entity, id, title) => ({ entity, id, title, open: null });
const sec = (title, rows, total = rows.length) => ({ title, count: rows.length, total, rule: 'Agenda: the open to-dos due in the window by day.', read: 'agenda 2026-11-30 to 2026-12-06 (mine)', rows, line: null, brief: null });
const SECTIONS = [
  sec('Due', [task('t1', 'Send Cloudflare the pilot terms', '2026-11-30'), task('t2', 'Call the Hilton benefits lead', '2026-12-01')], 9),
  sec("This week's five", [task('t5', 'Update the pricing deck', '2026-11-25')]),
  sec('Pinned and P1', [company('e1', 'Cloudflare'), company('e2', 'Hilton')]),
  sec('Goals', [plain('weekly', 'agenda:delivered', 'Delivered · goal')]),
  sec('Calls to review', [plain('call_notes', 'n1', 'Review the Seif call')]),
  sec('Replies owed', [plain('people', 'prospect:p9', 'Lee Stone')]),
];
const SUMMARY = "Monday: Send Cloudflare the pilot terms. Tuesday: Call the Hilton benefits lead.\n\nGoals: Delivered is at 40 against 400 this week.\n\nI'd push the pilot terms first: Cloudflare is pinned. Meetings are not included: there is no calendar read.\n\n1. Cloudflare: the terms.\n2. Hilton: the call.\n3. The pricing deck.";
const turn = (over = {}) => ({ at: 1, q: "what's on the agenda for next week", scope: 'b1', elapsed: 6, answer_md: SUMMARY, summary: SUMMARY, sections: SECTIONS, items: SECTIONS.flatMap(s => s.rows), usage: { input_tokens: 3000, output_tokens: 300, cost_usd: 0.014 }, ask: {}, context_stats: { reads: ['agenda'], rows_by_entity: {} }, ...over });
const show = (t, props = {}) => render(<AnswerPanel turn={t} phone={false} scopeAll={false} colorOf={() => null} viewer={false} canAct onOpen={() => {}} turns={[t]} onReopen={() => {}} onClear={() => {}} members={[]} menu={null} onMenu={() => {}} onPick={() => {}} onCopy={() => {}} {...props} />);

test('the agenda answer: the synthesis is the prose - the plan by day, the goals line, the judgement - and the rows ride in six sections with their counts', () => {
  show(turn());
  const prose = document.querySelector('[data-scout-prose]');
  expect(prose.querySelectorAll('p')).toHaveLength(3);
  expect([...prose.querySelectorAll('ol > li')].map(li => li.textContent)).toEqual(['Cloudflare: the terms.', 'Hilton: the call.', 'The pricing deck.']);
  expect(prose).toHaveTextContent('Monday: Send Cloudflare the pilot terms. Tuesday: Call the Hilton benefits lead.');
  expect(prose).toHaveTextContent("I'd push the pilot terms first");
  expect(prose).toHaveTextContent('Meetings are not included: there is no calendar read.');
  const sections = [...document.querySelectorAll('[data-scout-section]')];
  expect(sections.map(s => s.querySelector('.scout-section__title').textContent)).toEqual(['Due', "This week's five", 'Pinned and P1', 'Goals', 'Calls to review', 'Replies owed']);
  expect(sections.map(s => s.querySelector('[data-scout-count]').textContent)).toEqual(['2 of 9 open', '1 open', '2 companies', '1', '1', '1']);
  // the rows keep their verbs: a due to-do says Done, a pinned company Draft email (claude-pack P6)
  expect(within(sections[0]).getByRole('button', { name: 'Done: Send Cloudflare the pilot terms' })).toBeInTheDocument();
  expect(within(sections[2]).getByRole('button', { name: 'Draft email: Cloudflare' })).toBeInTheDocument();
  expect(document.querySelector('[data-scout-try]')).toBeNull();
});

test('G4: a weak match shows the three nearest phrasings as Try chips; a chip asks it', () => {
  const onTry = jest.fn();
  show(turn({ q: 'what do we know that is worth doing', summary: 'You have two to-dos due this week. Suggestion: clear the late one first.', answer_md: 'x', sections: [sec(null, [task('t4', 'Chase the signed order form', '2026-11-18')])], try: ['what do we know about Hilton', 'how are our emails doing this month', 'my top targets'] }), { onTry });
  const row = screen.getByRole('group', { name: 'Closer ways to ask' });
  expect([...row.querySelectorAll('button')].map(b => b.textContent)).toEqual(['what do we know about Hilton', 'how are our emails doing this month', 'my top targets']);
  fireEvent.click(within(row).getByRole('button', { name: 'my top targets' }));
  expect(onTry).toHaveBeenCalledWith('my top targets');
  expect(document.querySelector('[data-scout-prose]')).toHaveTextContent('Suggestion: clear the late one first.');
});

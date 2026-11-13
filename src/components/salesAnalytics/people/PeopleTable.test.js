import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import PeopleTable from './PeopleTable';
import { goalsApi } from '../goals/goalsApi';
import { updateProspect } from '../huddleApi';

jest.mock('../goals/goalsApi', () => ({ goalsApi: { todoEvents: jest.fn(() => Promise.resolve([])), undoTodoEvent: jest.fn(() => Promise.resolve({})), peopleActivity: jest.fn(), peopleActivityDetail: jest.fn(), members: jest.fn(), peopleViews: jest.fn(), savePeopleView: jest.fn(), deletePeopleView: jest.fn(), copyBundle: jest.fn(), createWeekGoal: jest.fn(), deleteWeekGoal: jest.fn(), markContacted: jest.fn(), addPersonRecord: jest.fn(), assignPerson: jest.fn(), undoPersonEvent: jest.fn() }, OPEN_PIPELINE_RECORD: 'prospector:open-pipeline-record' }));
jest.mock('../huddleApi', () => ({ updateProspect: jest.fn() }));
jest.mock('../pipelineApi', () => ({ updateOpportunity: jest.fn() }));
const mockPhone = { on: false };
jest.mock('../../../utils/useMediaQuery', () => () => mockPhone.on);

// people-v2 Stage 2 - Pipeline › People over invented rows in the route's shape: the 10 columns in the route's order, the
// chips with counts, select-vs-open (row = the pinned card with the timeline + quick menu; name = the company window on
// its People card), the quick menu's writes through the existing paths with Undo, CSV without an address, Share view,
// the Viewer's read-only table, the phone's cards. The heat band is the route's.
// heat-v2 Stage 2: the band groups (Hot / Warm / Cold, Cold collapsed), the one pill with the Δ7 glyph, the buyer tag on
// the name, the Identified date column, Source glyph + word, the Heat header's ⓘ popover (no footnote, no "Huddle"),
// the two-line header, widths ≤ 1,100 px, the pinned card's sparkline.
const row = (name, over = {}) => ({ key: `prospect:${name.replace(/\s/g, '')}`, sources: ['Apollo'], source: 'Apollo', name, title: 'VP People', company: { type: 'employer', id: 'o1', name: 'Acme Health', stage: 'contacted', owner_user_id: 'u1' }, status: 'new', owner_user_id: 'u1',
  emails: { sent: 1, opened: 0, clicked: 0, replied: 0, bot_opens: 0 }, last_email: { at: '2026-11-03T12:00:00Z', what: 'sent', reply_class: null }, heat: 5, heat_band: 'cold', heat_7d_ago: null, visits: null, identified_at: null, buyer: false, has_email: true, last_touch_at: '2026-11-03T12:00:00Z', ...over });
const ROWS = [
  row('Crystal Pringle', { emails: { sent: 2, opened: 4, clicked: 0, replied: 1, bot_opens: 0 }, last_email: { at: '2026-11-03T12:00:00Z', what: 'replied', reply_class: 'follow_up_question' }, heat: 108, heat_band: 'hot', heat_7d_ago: 90, buyer: true, visits: { visits_7d: 6, last_visit: '2026-11-05', top_page: '/pricing', seen_to: '2026-11-06' } }),
  row('Cristina Torres', { owner_user_id: 'u2', emails: { sent: 3, opened: 8, clicked: 4, replied: 0, bot_opens: 1 }, last_email: { at: '2026-10-19T12:00:00Z', what: 'clicked', reply_class: null }, heat: 28, heat_band: 'warm', heat_7d_ago: 31, company: { type: 'employer', id: 'o2', name: 'Equinox', stage: 'target', owner_user_id: 'u2' } }),
  row('Bo Ops', { key: 'person:sp1', sources: ['Website'], source: 'Website', identified_at: '2026-11-02', company: { type: 'target', id: 't1', name: 'Quarry Labs', stage: 'researching', owner_user_id: null }, owner_user_id: null, status: null, emails: { sent: 0, opened: 0, clicked: 0, replied: 0, bot_opens: 0 }, last_email: null, heat: null, heat_band: null, has_email: false, last_touch_at: null, visits: { visits_7d: 1, last_visit: '2026-10-22', top_page: '/', seen_to: '2026-10-23' } }),
];
const RULE = { hot: 40, warm: 10, fade: { fresh: 7, mid: 0.5, old: 30, floor: 0.25 } };
const DATA = { rows: ROWS, n: 3, total: 3, counts: {}, window: { id: 'all', label: 'all time', since: null, until: '2026-11-06' }, heat_rule: RULE, history_since: '2026-11-10', computed_at: '2026-11-06T13:00:00Z', heat_pending: 1 };
const DETAIL = { key: 'prospect:CrystalPringle', notes: 'Met at the expo', timeline: [{ kind: 'reply', at: '2026-11-03T12:00:00Z', step: 2, automated: false, reply_class: 'follow_up_question', seen_at_sync: true }, { kind: 'open', at: '2026-11-02T15:00:00Z', step: 1, automated: true }, { kind: 'sent', at: '2026-11-01T12:00:00Z', step: 1, automated: false, subject: 'Hello from HomeLover' }], heat: { score: 108, band: 'hot', why: ['Replied (follow up question) +100', 'Opened ×4 +15'] }, history: [{ day: '2026-11-05', heat: 90, band: 'hot' }, { day: '2026-11-06', heat: 108, band: 'hot' }] };
const ME = { profile: { id: 'u1', display_name: 'Jack Carlson' } };
const MEMBERS = [{ user_id: 'u1', name: 'Jack Carlson', role: 'owner', color: '#6F8CF0' }, { user_id: 'u2', name: 'Cyrus Test', role: 'member', color: '#C97626' }];
beforeEach(() => {
  mockPhone.on = false;
  localStorage.clear();
  goalsApi.peopleActivity.mockResolvedValue(DATA);
  goalsApi.members.mockResolvedValue(MEMBERS);
  goalsApi.peopleViews.mockResolvedValue([]);
  goalsApi.peopleActivityDetail.mockResolvedValue(DETAIL);
});
afterEach(() => jest.clearAllMocks());
const table = async () => { render(<PeopleTable businessId="b1" canEdit me={ME} />); return screen.findByRole('table', { name: 'People' }); };
const names = t => [...t.querySelectorAll('tr[data-row] [data-person-name]')].map(el => el.textContent);
const groupHeads = t => [...t.querySelectorAll('tr.ui-table__group')].map(tr => tr.textContent.replace(/\s+/g, ' ').trim());
const expandCold = t => fireEvent.click(within(t).getByRole('button', { name: /^Cold/ }));

// todo-events-v1: CRA resets mock implementations before each test - the to-do event reads resolve empty unless a test says otherwise
beforeEach(() => { goalsApi.todoEvents.mockResolvedValue([]); goalsApi.undoTodoEvent.mockResolvedValue({}); });

test('the table: 11 word headers (Owner after Source) with widths summing to 1,098 px (<= 1,100); Hot / Warm / Cold groups in heat order with Cold collapsed; the one pill (word + number, Δ7 when it moved 10+); the buyer tag on the name; Identified = a date; Source = glyph + word; no footnote and no "Huddle" anywhere', async () => {
  const t = await table();
  expect(within(t).getAllByRole('columnheader').map(h => h.textContent.replace(/ [↕▲▼]$/, ''))).toEqual(['Person', 'Company', 'Size (company)', 'Source', 'Owner', 'Emails (human opens)', 'Last email', 'Heat', 'Visits (company, 7 d)', 'Identified', 'Touch (last, any channel)']);
  const widths = [...t.querySelectorAll('colgroup col')].map(c => parseInt(c.style.width, 10));
  expect(widths).toEqual([190, 140, 74, 84, 64, 112, 96, 104, 104, 70, 60]);
  expect(widths.reduce((a, b) => a + b, 0)).toBe(1098);
  expect(widths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1100);
  expect(groupHeads(t)).toEqual(['Hot1 · score ≥ 40', 'Warm1 · score 10–39', 'Cold1 · score < 10 · collapsed']);
  expect(names(t)).toEqual(['Crystal Pringle', 'Cristina Torres'], 'Cold is collapsed by default');
  expect(within(t).getByRole('button', { name: /^Cold/ })).toHaveAttribute('aria-expanded', 'false');
  expandCold(t);
  expect(names(t)).toEqual(['Crystal Pringle', 'Cristina Torres', 'Bo Ops']);
  expect(groupHeads(t)[2]).toBe('Cold1 · score < 10');
  const pills = [...t.querySelectorAll('[data-heat-band]')].map(el => `${el.dataset.heatBand}:${el.textContent}`);
  expect(pills).toEqual(['hot:Hot 108▲', 'warm:Warm 28'], 'the word first, the number second; Δ7 only when |Δ| ≥ 10 (108 vs 90 = +18; 28 vs 31 = −3: none)');
  expect(t.querySelector('[data-heat-delta="up"]')).toHaveAttribute('aria-label', 'up 18 in 7 days');
  expect(t.querySelector('tr[data-row][data-key="person_sp1"] td:nth-child(7)').textContent).toBe('—', 'no heat yet');
  const crystal = t.querySelector('tr[data-row][data-key="prospect_CrystalPringle"]');
  expect(crystal.querySelector('[data-buyer]').textContent).toBe('buyer');
  expect(t.querySelectorAll('[data-buyer]')).toHaveLength(1);
  expect([...t.querySelectorAll('[data-source]')].map(el => el.textContent)).toEqual(['➤Apollo', '➤Apollo', '🌐Website']);
  expect(t.querySelector('tr[data-row][data-key="person_sp1"] [data-identified]').textContent).toBe('Nov 2');
  expect(crystal.querySelectorAll('td')[9].textContent).toBe('—', 'not a visitor-identified person');
  expect(crystal.querySelectorAll('td')[1].textContent).toBe('Acme Healthcontacted');
  expect(document.querySelector('[data-heat-footnote]')).toBeNull();
  expect(document.body.textContent).not.toMatch(/Huddle/);
  expect(screen.getByText('Showing 3 of 3')).toBeInTheDocument();
  expect(screen.getByText('1 person has no heat yet (the next Apollo sync computes it)')).toBeInTheDocument();
  expect(screen.getByText('headcount known for 0 of 3 companies · 0 people have no company record')).toBeInTheDocument();
  const chips = within(screen.getByRole('group', { name: 'Filter chips' }));
  expect(chips.getByRole('button', { name: /^Opened/ })).toHaveTextContent('(2)');
  expect(chips.getByRole('button', { name: /^Identified visitor/ })).toHaveTextContent('(1)');
  expect(chips.getByRole('button', { name: /^Hot/ })).toHaveTextContent('(1)');
  expect(chips.getByRole('button', { name: /^Hot/ }).style.color).toBe('rgb(255, 159, 87)');
  // D4: two header lines - the chips, then the Size row with the four selects and the tools to its right.
  const selects = screen.getByRole('group', { name: 'Filters' });
  expect(within(selects).getByRole('group', { name: 'Size' })).toBeInTheDocument();
  for (const l of ['Source', 'Company stage', 'Owner', 'Window']) expect(within(selects).getByLabelText(l)).toBeInTheDocument();
  expect(within(selects).getByRole('button', { name: 'CSV' })).toBeInTheDocument();
  fireEvent.click(chips.getByRole('button', { name: /^Opened/ }));
  fireEvent.click(chips.getByRole('button', { name: /^Buyer title/ }));
  expect(names(t)).toEqual(['Crystal Pringle']);
  expect(screen.getByText('Showing 1 of 3 ·')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Clear/ }));
  expect(names(t)).toHaveLength(3);
  fireEvent.change(screen.getByLabelText('Window'), { target: { value: '7' } });
  await waitFor(() => expect(goalsApi.peopleActivity).toHaveBeenLastCalledWith('b1', '7'));
});

test('the sort invariant: in heat order every Warm row sits under every Hot row (heat asc reverses the groups); another column folds the bands into one sorted group', async () => {
  const t = await table();
  expandCold(t);
  const heats = () => [...t.querySelectorAll('tr[data-row] [data-heat-band]')].map(el => el.dataset.heatBand);
  expect(heats()).toEqual(['hot', 'warm']);
  fireEvent.click(within(t).getByRole('button', { name: /^Heat/ }));
  expect(groupHeads(t).map(h => h.split(/\d/)[0])).toEqual(['Cold', 'Warm', 'Hot']);
  fireEvent.click(within(t).getByRole('button', { name: /^Heat/ }));
  expect(groupHeads(t).map(h => h.split(/\d/)[0])).toEqual(['Hot', 'Warm', 'Cold']);
  fireEvent.click(within(t).getByRole('button', { name: /^Company/ }));
  expect(groupHeads(t)).toEqual(['Sorted by company 3']);
  expect(names(t)).toEqual(['Crystal Pringle', 'Cristina Torres', 'Bo Ops']);
});

test('the Heat header ⓘ: a button with aria-expanded; a click opens the 360 px popover (brackets, the fade, History since); Esc closes it and returns focus; a click outside closes it; a Viewer sees it too', async () => {
  const t = await table();
  const info = within(t).getByRole('button', { name: 'How heat works' });
  expect(info).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('dialog', { name: 'How heat works' })).toBeNull();
  fireEvent.click(info); // a native <button>: Enter and Space fire this click
  const pop = await screen.findByRole('dialog', { name: 'How heat works' });
  expect(info).toHaveAttribute('aria-expanded', 'true');
  expect(info).toHaveAttribute('aria-controls', pop.id);
  expect(pop.style.width).toBe('360px');
  expect(pop.textContent).toMatch(/One number, 0–200, per person/);
  expect([...pop.querySelectorAll('[data-heat-band]')].map(el => el.textContent)).toEqual(['Hot 108', 'Warm 28', 'Cold 4']);
  expect(pop.textContent).toMatch(/score ≥ 40.*score 10–39.*score below 10/);
  expect(pop.textContent).toMatch(/Band is the number's bracket, nothing else — a Warm person is never above a Hot one\. Signals fade with age: whole for 7 days, ×0\.5 to 30 days, then ×0\.25\. Opens count humans only \(scanners and link checkers are excluded\)\. Times are Pacific\. History since Nov 10\./);
  expect(pop.textContent).toMatch(/Size glyphs◇from Apollo✎typed in◆from research/);
  expect(pop.textContent).toMatch(/Identified — the date Apollo named this person on the site\. buyer tag — the title matches your buyer-title list \(Settings\)\./);
  expect(pop.textContent).not.toMatch(/Huddle/);
  expect(document.activeElement).toBe(pop);
  fireEvent.keyDown(pop, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'How heat works' })).toBeNull());
  expect(info).toHaveAttribute('aria-expanded', 'false');
  expect(document.activeElement).toBe(info);
  fireEvent.click(info);
  await screen.findByRole('dialog', { name: 'How heat works' });
  fireEvent.mouseDown(document.body);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'How heat works' })).toBeNull());
  // Esc with the popover closed still closes an open row detail (the table's own handler), untouched.
  // Viewer.
  cleanup();
  goalsApi.peopleActivity.mockResolvedValue({ ...DATA, history_since: null });
  render(<PeopleTable businessId="b2" canEdit={false} me={{ profile: { id: 'u9', display_name: 'View Er' } }} />);
  const t2 = await screen.findByRole('table', { name: 'People' });
  fireEvent.click(within(t2).getByRole('button', { name: 'How heat works' }));
  const pop2 = await screen.findByRole('dialog', { name: 'How heat works' });
  expect(pop2.querySelector('[data-history-since]').textContent).toBe('History starts with the next sync.');
});

test('select vs open: a row click pins the detail (timeline + company visits + notes + the heat pill + the 30-day sparkline + quick menu); the name opens the company window on its People card; the company opens the window; Esc closes', async () => {
  const t = await table();
  const opened = [];
  window.addEventListener('prospector:open-pipeline-record', e => opened.push(e.detail));
  fireEvent.click(within(t).getByRole('button', { name: 'Crystal Pringle' }));
  expect(opened).toEqual([{ key: 'employer-o1', section: 'people' }]);
  fireEvent.click(within(t).getAllByRole('button', { name: 'Acme Health' })[0]);
  expect(opened[1]).toEqual({ key: 'employer-o1' });
  expect(t.querySelector('[data-person-detail]')).toBeNull();
  fireEvent.click(t.querySelector('tr[data-row] td'));
  const detail = await waitFor(() => { const el = t.querySelector('[data-person-detail="prospect:CrystalPringle"]'); if (!el) throw new Error('no detail'); return el; });
  await waitFor(() => expect(goalsApi.peopleActivityDetail).toHaveBeenCalledWith('b1', 'prospect:CrystalPringle'));
  const tl = await within(within(detail).getByRole('region', { name: 'Email timeline' })).findByRole('list');
  expect([...tl.querySelectorAll('[data-timeline-kind]')].map(li => li.dataset.timelineKind)).toEqual(['reply', 'open', 'sent']);
  expect(within(tl).getByText(/follow up question · time = when the sync saw it/)).toBeInTheDocument();
  expect(within(tl).getByText(/automated open \(scanner\)/)).toBeInTheDocument();
  const side = within(detail).getByRole('region', { name: 'Company and notes' });
  expect(side).toHaveTextContent(/6 visits \(Apollo, rolling 7 d\) · last Nov 5 · \/pricing/);
  expect(within(detail).getByText('Met at the expo')).toBeInTheDocument();
  expect(side.querySelector('[data-heat-live] [data-heat-band]').textContent).toBe('Hot 108');
  expect([...side.querySelectorAll('[data-heat-why] li')].map(li => li.textContent)).toEqual(['Replied (follow up question) +100', 'Opened ×4 +15']);
  const spark = side.querySelector('[data-heat-sparkline]');
  expect(spark.dataset.heatSparkline).toBe('2');
  expect(spark).toHaveAttribute('aria-label', 'Heat over the last 30 days: Nov 5 90 hot, Nov 6 108 hot');
  expect(spark.querySelectorAll('circle')).toHaveLength(2);
  expect(within(within(detail).getByRole('group', { name: 'Quick menu' })).getAllByRole('button').map(b => b.textContent)).toEqual(['Open company', 'Assign ▸', 'Draft email', 'Log call', 'Add to-do', 'Mark contacted', 'Not a fit']);
  fireEvent.keyDown(t, { key: 'Escape' });
  await waitFor(() => expect(t.querySelector('[data-person-detail]')).toBeNull());
});

test('quick menu: Draft email copies the REACH bundle (never sends); Add to-do links the company; Not a fit = the prospect\'s status with Undo; Mark contacted = the company touch through markContacted', async () => {
  goalsApi.copyBundle.mockResolvedValue('# Acme Health\n');
  goalsApi.createWeekGoal.mockResolvedValue({ id: 'g1', owner_user_id: 'u1' });
  goalsApi.markContacted.mockResolvedValue({ stage: { before: 'contacted', after: 'contacted' }, todo: { id: 'td1' } });
  updateProspect.mockResolvedValue({});
  Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue() } });
  const t = await table();
  fireEvent.click(t.querySelector('tr[data-row] td'));
  const detail = await waitFor(() => { const el = t.querySelector('[data-person-detail]'); if (!el) throw new Error('no detail'); return el; });
  const menu = within(within(detail).getByRole('group', { name: 'Quick menu' }));
  fireEvent.click(menu.getByRole('button', { name: 'Draft email' }));
  await waitFor(() => expect(goalsApi.copyBundle).toHaveBeenCalledWith('b1', 'employer', 'o1'));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
  expect(navigator.clipboard.writeText.mock.calls[0][0]).toMatch(/^# Acme Health\nDraft one first email to Acme Health/);
  expect(await screen.findByRole('status')).toHaveTextContent('Draft bundle for Crystal Pringle copied - paste it into Claude. Prospector never sends.');
  fireEvent.click(menu.getByRole('button', { name: 'Add to-do' }));
  fireEvent.change(within(detail).getByLabelText('To-do'), { target: { value: 'Send the deck' } });
  fireEvent.change(within(detail).getByLabelText('To-do due date'), { target: { value: '2026-11-10' } });
  fireEvent.click(within(detail).getByRole('button', { name: 'Save to-do' }));
  await waitFor(() => expect(goalsApi.createWeekGoal).toHaveBeenCalledWith('b1', { week_start: '2026-11-09', kind: 'todo', text: 'Send the deck', owner_user_id: 'u1', due_date: '2026-11-10', link_type: 'opportunity', link_id: 'o1', person_key: expect.any(String) }));
  await waitFor(() => expect(goalsApi.peopleActivity).toHaveBeenCalledTimes(2), { timeout: 2000 }); // onChanged re-reads
  fireEvent.click(menu.getByRole('button', { name: 'Not a fit' }));
  await waitFor(() => expect(updateProspect).toHaveBeenCalledWith('b1', 'CrystalPringle', { status: 'dead' }));
  const toast = await screen.findByText('Crystal Pringle marked not a fit');
  fireEvent.click(within(toast.closest('[role="status"]')).getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(updateProspect).toHaveBeenLastCalledWith('b1', 'CrystalPringle', { status: 'new', expect: { status: 'dead' } }));
  fireEvent.click(menu.getByRole('button', { name: 'Mark contacted' }));
  await waitFor(() => expect(goalsApi.markContacted).toHaveBeenCalledWith('b1', 'employer', 'o1', { contact_id: 'CrystalPringle', person: 'Crystal Pringle', touch_type: 'email' }));
});

test('a person with no pipeline record (in the collapsed Cold group): the quick menu says why; a non-prospect cannot be archived; the card shows "—" before any history', async () => {
  goalsApi.peopleActivityDetail.mockResolvedValue({ key: 'person:sp1', notes: 'Identified visitor 2026-11-02', timeline: [], heat: { score: 11, band: 'warm', why: ['Identified on the site 2 d ago +11'] }, history: [] });
  const t = await table();
  expandCold(t);
  fireEvent.click(t.querySelector('tr[data-row][data-key="person_sp1"] td'));
  const detail = await waitFor(() => { const el = t.querySelector('[data-person-detail="person:sp1"]'); if (!el) throw new Error('no detail'); return el; });
  await waitFor(() => expect(detail.querySelector('[data-heat-why]')).toBeTruthy());
  expect(detail.querySelector('[data-heat-live] [data-heat-band]').textContent).toBe('Warm 11');
  expect([...detail.querySelectorAll('[data-heat-why] li')].map(li => li.textContent)).toEqual(['Identified on the site 2 d ago +11']);
  expect(detail.querySelector('[data-heat-sparkline="empty"]').textContent).toBe('— no history yet');
  const menu = within(within(detail).getByRole('group', { name: 'Quick menu' }));
  expect(menu.getByRole('button', { name: 'Open company' })).toBeEnabled();
  expect(menu.getByRole('button', { name: 'Draft email' })).toBeEnabled(); // a target is a pipeline record: the REACH bundle works
  expect(menu.getByRole('button', { name: 'Not a fit' })).toBeDisabled();
  expect(await within(detail).findByText(/Not in an email sequence - identified on the site, no email activity\./)).toBeInTheDocument();
});

test('CSV: the filtered rows, structured fields only, never an address; Share view saves the filters for the team and applies a saved one', async () => {
  const texts = [];
  URL.createObjectURL = jest.fn(blob => { const fr = new FileReader(); fr.onload = () => texts.push(fr.result); fr.readAsText(blob); return 'blob:x'; }); URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  goalsApi.savePeopleView.mockResolvedValue({ view: { id: 'v1', name: 'Hot buyers' }, views: [{ id: 'v1', kind: 'people', name: 'Hot buyers', state: { chips: ['hot', 'buyer'], source: '', stage: '', owner: '', window: 'all', q: '', sizes: ['5k'] } }] });
  await table();
  fireEvent.click(within(screen.getByRole('group', { name: 'Filter chips' })).getByRole('button', { name: /^Replied/ }));
  fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
  await waitFor(() => expect(texts).toHaveLength(1));
  expect(texts[0].split('\r\n')[0]).toMatch(/^Person,Title,Company,Owner,Company stage,Company size,Size source,Source,Sent,Opened \(human\),Clicked,Replied,/);
  expect(texts[0].split('\r\n')).toHaveLength(2);
  expect(texts[0]).toMatch(/Crystal Pringle,VP People,Acme Health,Jack,contacted,unknown,,Apollo,2,4,0,1,/);
  expect(texts[0]).toMatch(/,108,hot,/);
  expect(texts[0]).not.toMatch(/@/);
  fireEvent.click(screen.getByRole('button', { name: 'Share view' }));
  fireEvent.change(screen.getByLabelText('View name'), { target: { value: 'Replied' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
  await waitFor(() => expect(goalsApi.savePeopleView).toHaveBeenCalledWith('b1', { name: 'Replied', state: { chips: ['replied'], source: '', stage: '', owner: '', window: 'all', q: '', sizes: [] } }));
  fireEvent.click(await screen.findByRole('button', { name: 'Hot buyers' }));
  expect(within(screen.getByRole('group', { name: 'Filter chips' })).getByRole('button', { name: /^Hot/ })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: /^5,000\+/ })).toHaveAttribute('aria-pressed', 'true');
  expect(within(screen.getByRole('group', { name: 'Filter chips' })).getByRole('button', { name: /^Replied/ })).toHaveAttribute('aria-pressed', 'false');
  click.mockRestore();
});

test('an old feed link lands on its chip; a Viewer reads: CSV yes, Share view no, the quick menu is Open company only', async () => {
  const { unmount } = render(<PeopleTable businessId="b1" canEdit me={ME} initialTarget={{ feed: 'click' }} />);
  await screen.findByRole('table', { name: 'People' });
  expect(within(screen.getByRole('group', { name: 'Filter chips' })).getByRole('button', { name: /^Clicked/ })).toHaveAttribute('aria-pressed', 'true');
  unmount();
  render(<PeopleTable businessId="b1" canEdit={false} me={{ profile: { id: 'u9', display_name: 'View Er' } }} />);
  const t = await screen.findByRole('table', { name: 'People' });
  expect(screen.getByRole('button', { name: 'CSV' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Share view/ })).toBeNull();
  fireEvent.click(t.querySelector('tr[data-row] td'));
  const detail = await waitFor(() => { const el = t.querySelector('[data-person-detail]'); if (!el) throw new Error('no detail'); return el; });
  expect(within(within(detail).getByRole('group', { name: 'Quick menu' })).getAllByRole('button').map(b => b.textContent)).toEqual(['Open company']);
});

test('phone: stacked cards under the same band groups (Cold collapsed) with the pill, the buyer tag and the source glyph; the chip row scrolls sideways; the selects live in the Filters sheet', async () => {
  mockPhone.on = true;
  render(<PeopleTable businessId="b1" canEdit me={ME} />);
  const list = await screen.findByRole('list', { name: 'People' });
  expect(list.querySelectorAll('[data-row]')).toHaveLength(2);
  fireEvent.click(within(list).getByRole('button', { name: /^Cold/ }));
  expect(list.querySelectorAll('[data-row]')).toHaveLength(3);
  expect(within(list).getAllByTitle('human opens')[0].textContent).toBe('👁 4');
  expect([...list.querySelectorAll('[data-heat-band]')].map(el => el.textContent)).toEqual(['Hot 108▲', 'Warm 28']);
  expect(list.querySelectorAll('[data-buyer]')).toHaveLength(1);
  expect([...list.querySelectorAll('[data-source]')].map(el => el.textContent)).toEqual(['➤Apollo', '➤Apollo', '🌐Website']);
  expect(screen.getByRole('group', { name: 'Filter chips' }).style.overflowX).toBe('auto');
  expect(screen.queryByLabelText('Window')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
  expect(within(screen.getByRole('dialog', { name: 'Filters' })).getByLabelText('Window')).toBeInTheDocument();
});

test('the word "Huddle" is gone from the People files (D3)', () => {
  const dir = __dirname;
  const offenders = fs.readdirSync(dir).filter(f => f.endsWith('.js') && !f.endsWith('.test.js')).filter(f => /Huddle/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  expect(offenders).toEqual([]);
});

test('scout-v3 R6: the "Snoozed (n)" chip shows only when someone is snoozed; pressing it lists them (snoozed=only), pressing again returns', async () => {
  await table();
  expect(document.querySelector('[data-snoozed-chip]')).toBeNull();
  cleanup();
  goalsApi.peopleActivity.mockImplementation((id, win, snoozed) => Promise.resolve(snoozed === 'only' ? { ...DATA, rows: [ROWS[2]], n: 1, snoozed: 2 } : { ...DATA, snoozed: 2 }));
  await table();
  const chip = document.querySelector('[data-snoozed-chip]');
  expect(chip.textContent).toBe('Snoozed(2)');
  expect(chip.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(chip);
  await waitFor(() => expect(goalsApi.peopleActivity).toHaveBeenLastCalledWith('b1', 'all', 'only'));
  await waitFor(() => expect(document.querySelector('[data-snoozed-chip]').getAttribute('aria-pressed')).toBe('true'));
  fireEvent.click(document.querySelector('[data-snoozed-chip]'));
  await waitFor(() => expect(goalsApi.peopleActivity).toHaveBeenLastCalledWith('b1', 'all'));
});

test('visitor-people-filing V3: a person without a company record shows "Add as target" in its row (the reason in the title); a click posts add-record and reloads; a person on a record has no such button; a Viewer never sees it', async () => {
  const noRecord = row('Seth Example', { key: 'person:sp9', sources: ['Website'], source: 'Website', identified_at: '2026-11-13', company: { type: 'parked', id: null, name: 'Zz Never Visited', stage: null, owner_user_id: null }, status: null, emails: { sent: 0, opened: 0, clicked: 0, replied: 0, bot_opens: 0 }, last_email: null, heat: 60, heat_band: 'hot', has_email: false, last_touch_at: null, add_record_id: 'sp9', record_reason: 'no_visit_row' });
  goalsApi.peopleActivity.mockResolvedValue({ ...DATA, rows: [...ROWS, noRecord], n: 4, total: 4 });
  goalsApi.addPersonRecord.mockResolvedValue({ record: { type: 'target', id: 't9', name: 'Zz Never Visited' }, people_moved: 1, already: false });
  const { unmount } = render(<PeopleTable businessId="b1" canEdit me={ME} />);
  const t = await screen.findByRole('table', { name: 'People' });
  const buttons = t.querySelectorAll('[data-add-target]');
  expect(buttons).toHaveLength(1);
  expect(buttons[0].closest('tr').getAttribute('data-key')).toBe('person_sp9');
  expect(buttons[0]).toHaveTextContent('Add as target');
  expect(buttons[0].title).toBe("No company record: Apollo's company search has not seen this company visit - add Zz Never Visited as an employer target");
  const loads = goalsApi.peopleActivity.mock.calls.length;
  fireEvent.click(buttons[0]);
  await waitFor(() => expect(goalsApi.addPersonRecord).toHaveBeenCalledWith('b1', 'sp9'));
  expect(await screen.findByText('Zz Never Visited added as a target')).toBeInTheDocument();
  await waitFor(() => expect(goalsApi.peopleActivity.mock.calls.length).toBeGreaterThan(loads));
  expect(t.querySelector('[data-person-detail]')).toBeNull();
  unmount();
  render(<PeopleTable businessId="b1" canEdit={false} me={{ profile: { id: 'u9', display_name: 'View Er' } }} />);
  const v = await screen.findByRole('table', { name: 'People' });
  expect(v.querySelector('[data-add-target]')).toBeNull();
});

// person-owner-v1 Stage 2 (O3)
const ownerCells = t => [...t.querySelectorAll('tr[data-row]')].map(tr => `${tr.querySelector('[data-person-name]').textContent}: ${tr.querySelector('[data-owner]').textContent}`);
const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };

test('Owner column: the dot + first name, "—" for Unassigned; the header sorts; the Mine and Unassigned chips count the person owner and the Unassigned count = the route; the Owner select offers Unassigned', async () => {
  goalsApi.peopleActivity.mockResolvedValue({ ...DATA, counts: { unassigned: 1 } });
  const t = await table();
  expandCold(t);
  expect(ownerCells(t)).toEqual(['Crystal Pringle: Jack', 'Cristina Torres: Cyrus', 'Bo Ops: —']);
  expect([...t.querySelectorAll('tr[data-row] [data-owner-dot]')].map(d => d.style.background)).toEqual(['rgb(111, 140, 240)', 'rgb(201, 118, 38)']);
  const chips = within(screen.getByRole('group', { name: 'Filter chips' }));
  expect(chips.getByRole('button', { name: /^Mine/ })).toHaveTextContent('Mine(1)');
  expect(chips.getByRole('button', { name: /^Unassigned/ })).toHaveTextContent(`Unassigned(${(await goalsApi.peopleActivity.mock.results[0].value).counts.unassigned})`);
  fireEvent.click(chips.getByRole('button', { name: /^Unassigned/ }));
  expect(names(t)).toEqual(['Bo Ops']);
  fireEvent.click(chips.getByRole('button', { name: /^Unassigned/ }));
  expect([...screen.getByLabelText('Owner').options].map(o => o.textContent)).toEqual(['All', 'Jack Carlson', 'Cyrus Test', 'Unassigned']);
  fireEvent.click(within(t).getByRole('columnheader', { name: /^Owner/ }).querySelector('button') || within(t).getByRole('columnheader', { name: /^Owner/ }));
  expect(ownerCells(t).slice(0, 2)).toEqual(['Cristina Torres: Cyrus', 'Crystal Pringle: Jack']);
});

test('Assign from the row: the menu lists the members with their colour dots, then Unassigned; a pick shows at once (optimistic), posts expect = the owner shown, and the 10-s Undo takes it back by the event', async () => {
  const t = await table();
  fireEvent.click(within(t).getByRole('button', { name: 'Assign Cristina Torres' }));
  const menu = screen.getByRole('menu', { name: 'Assign Cristina Torres' });
  expect(within(menu).getAllByRole('menuitemradio').map(b => `${b.textContent.replace('✓', '')}:${b.getAttribute('aria-checked')}`)).toEqual(['Jack:false', 'Cyrus:true', 'Unassigned:false']);
  expect([...menu.querySelectorAll('[data-owner-dot]')].map(d => d.style.background)).toEqual(['rgb(111, 140, 240)', 'rgb(201, 118, 38)']);
  expect(t.querySelector('[data-person-detail]')).toBeNull();
  const d = deferred();
  goalsApi.assignPerson.mockReturnValue(d.promise);
  fireEvent.click(within(menu).getByRole('menuitemradio', { name: /^Jack/ }));
  expect(screen.queryByRole('menu')).toBeNull();
  expect(goalsApi.assignPerson).toHaveBeenCalledWith('b1', 'prospect:CristinaTorres', { owner_user_id: 'u1', expect: { owner_user_id: 'u2' } });
  expect(ownerCells(t)[1]).toBe('Cristina Torres: Jack');
  const loads = goalsApi.peopleActivity.mock.calls.length;
  d.resolve({ person: { key: 'prospect:CristinaTorres', owner_user_id: 'u1' }, event: { id: 'e1' } });
  expect(await screen.findByText('Cristina Torres assigned to Jack')).toBeInTheDocument();
  await waitFor(() => expect(goalsApi.peopleActivity.mock.calls.length).toBeGreaterThan(loads));
  goalsApi.undoPersonEvent.mockResolvedValue({});
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(goalsApi.undoPersonEvent).toHaveBeenCalledWith('b1', 'e1'));
  fireEvent.click(within(t).getByRole('button', { name: 'Assign Crystal Pringle' }));
  goalsApi.assignPerson.mockResolvedValue({ person: {}, event: { id: 'e2' } });
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitemradio', { name: /^Unassigned/ }));
  expect(goalsApi.assignPerson).toHaveBeenLastCalledWith('b1', 'prospect:CrystalPringle', { owner_user_id: null, expect: { owner_user_id: 'u1' } });
  expect(await screen.findByText('Crystal Pringle is unassigned')).toBeInTheDocument();
});

test('Assign: a 409 reloads and says the owner changed; another failure puts the old owner back with the message', async () => {
  const t = await table();
  const loads = goalsApi.peopleActivity.mock.calls.length;
  goalsApi.assignPerson.mockRejectedValue(Object.assign(new Error('The owner changed since you opened this - reloaded'), { status: 409 }));
  fireEvent.click(within(t).getByRole('button', { name: 'Assign Cristina Torres' }));
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitemradio', { name: /^Jack/ }));
  expect(await screen.findByText('Cristina Torres: the owner changed since you opened this - reloaded')).toBeInTheDocument();
  await waitFor(() => expect(goalsApi.peopleActivity.mock.calls.length).toBeGreaterThan(loads));
  await waitFor(() => expect(ownerCells(t)[1]).toBe('Cristina Torres: Cyrus'));
  const after = goalsApi.peopleActivity.mock.calls.length;
  goalsApi.assignPerson.mockRejectedValue(Object.assign(new Error('Members only'), { status: 403 }));
  fireEvent.click(within(t).getByRole('button', { name: 'Assign Cristina Torres' }));
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitemradio', { name: /^Jack/ }));
  expect(await screen.findByText('Members only')).toBeInTheDocument();
  expect(ownerCells(t)[1]).toBe('Cristina Torres: Cyrus');
  expect(goalsApi.peopleActivity.mock.calls.length).toBe(after);
});

test('Assign from the pinned card posts the same write; a Viewer sees the owners and no Assign anywhere', async () => {
  const { unmount } = render(<PeopleTable businessId="b1" canEdit me={ME} />);
  const t = await screen.findByRole('table', { name: 'People' });
  fireEvent.click(t.querySelector('tr[data-row] td:nth-child(3)'));
  const detail = await waitFor(() => { const el = t.querySelector('[data-person-detail]'); if (!el) throw new Error('no detail'); return el; });
  goalsApi.assignPerson.mockResolvedValue({ person: {}, event: { id: 'e3' } });
  fireEvent.click(within(within(detail).getByRole('group', { name: 'Quick menu' })).getByRole('button', { name: 'Assign Crystal Pringle' }));
  fireEvent.click(within(screen.getByRole('menu', { name: 'Assign Crystal Pringle' })).getByRole('menuitemradio', { name: /^Cyrus/ }));
  expect(goalsApi.assignPerson).toHaveBeenCalledWith('b1', 'prospect:CrystalPringle', { owner_user_id: 'u2', expect: { owner_user_id: 'u1' } });
  expect(await screen.findByText('Crystal Pringle assigned to Cyrus')).toBeInTheDocument();
  unmount();
  render(<PeopleTable businessId="b1" canEdit={false} me={{ profile: { id: 'u9', display_name: 'View Er' } }} />);
  const v = await screen.findByRole('table', { name: 'People' });
  expect(ownerCells(v)).toEqual(['Crystal Pringle: Jack', 'Cristina Torres: Cyrus']);
  expect(v.querySelector('[data-assign]')).toBeNull();
});

test('390: each card shows its owner; the owner chip opens the Assign sheet (members with dots, Unassigned) and a pick posts the write; a Viewer card has no Assign', async () => {
  mockPhone.on = true;
  const { unmount } = render(<PeopleTable businessId="b1" canEdit me={ME} />);
  const list = await screen.findByRole('list', { name: 'People' });
  expect([...list.querySelectorAll('[data-row] [data-owner]')].map(el => el.textContent)).toEqual(['Jack', 'Cyrus']);
  fireEvent.click(within(list).getByRole('button', { name: 'Assign Cristina Torres' }));
  const sheet = screen.getByRole('menu', { name: 'Assign Cristina Torres' });
  expect(sheet.getAttribute('data-assign-menu')).toBe('sheet');
  expect(within(sheet).getAllByRole('menuitemradio').map(b => b.textContent.replace('✓', ''))).toEqual(['Jack', 'Cyrus', 'Unassigned']);
  goalsApi.assignPerson.mockResolvedValue({ person: {}, event: { id: 'e4' } });
  fireEvent.click(within(sheet).getByRole('menuitemradio', { name: /^Jack/ }));
  expect(goalsApi.assignPerson).toHaveBeenCalledWith('b1', 'prospect:CristinaTorres', { owner_user_id: 'u1', expect: { owner_user_id: 'u2' } });
  expect(await screen.findByText('Cristina Torres assigned to Jack')).toBeInTheDocument();
  unmount();
  render(<PeopleTable businessId="b1" canEdit={false} me={{ profile: { id: 'u9', display_name: 'View Er' } }} />);
  const v = await screen.findByRole('list', { name: 'People' });
  expect(v.querySelector('[data-assign]')).toBeNull();
  expect(v.querySelectorAll('[data-card-owner]')).toHaveLength(2);
});

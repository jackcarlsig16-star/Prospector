import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import PeopleTable from './PeopleTable';
import { goalsApi } from '../goals/goalsApi';
import { updateProspect } from '../huddleApi';

jest.mock('../goals/goalsApi', () => ({ goalsApi: { peopleActivity: jest.fn(), peopleActivityDetail: jest.fn(), members: jest.fn(), peopleViews: jest.fn(), savePeopleView: jest.fn(), deletePeopleView: jest.fn(), copyBundle: jest.fn(), createWeekGoal: jest.fn(), deleteWeekGoal: jest.fn(), markContacted: jest.fn() }, OPEN_PIPELINE_RECORD: 'prospector:open-pipeline-record' }));
jest.mock('../huddleApi', () => ({ updateProspect: jest.fn() }));
jest.mock('../pipelineApi', () => ({ updateOpportunity: jest.fn() }));
const mockPhone = { on: false };
jest.mock('../../../utils/useMediaQuery', () => () => mockPhone.on);

// people-v2 Stage 2 - Pipeline › People over invented rows in the route's shape: the 10 columns in the route's order, the
// chips with counts, select-vs-open (row = the pinned card with the timeline + quick menu; name = the company window on
// its People card), the quick menu's writes through the existing paths with Undo, CSV without an address, Share view,
// the Viewer's read-only table, the phone's cards. The heat band is the route's; the footnote states the Huddle's rule.
const row = (name, over = {}) => ({ key: `prospect:${name.replace(/\s/g, '')}`, sources: ['Apollo sequence'], source: 'Apollo sequence', name, title: 'VP People', company: { type: 'employer', id: 'o1', name: 'Acme Health', stage: 'contacted', owner_user_id: 'u1' }, status: 'new', owner: 'jack',
  emails: { sent: 1, opened: 0, clicked: 0, replied: 0, bot_opens: 0 }, last_email: { at: '2026-11-03T12:00:00Z', what: 'sent', reply_class: null }, heat: 5, heat_band: 'cold', visits: null, identified_at: null, buyer: false, has_email: true, last_touch_at: '2026-11-03T12:00:00Z', ...over });
const ROWS = [
  row('Crystal Pringle', { emails: { sent: 2, opened: 4, clicked: 0, replied: 1, bot_opens: 0 }, last_email: { at: '2026-11-03T12:00:00Z', what: 'replied', reply_class: 'follow_up_question' }, heat: 108, heat_band: 'warm', buyer: true, visits: { visits_7d: 6, last_visit: '2026-11-05', top_page: '/pricing', seen_to: '2026-11-06' } }),
  row('Cristina Torres', { owner: 'cyrus', emails: { sent: 3, opened: 8, clicked: 4, replied: 0, bot_opens: 1 }, last_email: { at: '2026-10-19T12:00:00Z', what: 'clicked', reply_class: null }, heat: 68, heat_band: 'hot', company: { type: 'employer', id: 'o2', name: 'Equinox', stage: 'target', owner_user_id: 'u2' } }),
  row('Bo Ops', { key: 'person:sp1', sources: ['Identified visitor'], source: 'Identified visitor', identified_at: '2026-11-02', company: { type: 'target', id: 't1', name: 'Quarry Labs', stage: 'researching', owner_user_id: null }, owner: null, status: null, emails: { sent: 0, opened: 0, clicked: 0, replied: 0, bot_opens: 0 }, last_email: null, heat: null, heat_band: null, has_email: false, last_touch_at: null, visits: { visits_7d: 1, last_visit: '2026-10-22', top_page: '/', seen_to: '2026-10-23' } }),
];
const DATA = { rows: ROWS, n: 3, total: 3, counts: {}, window: { id: 'all', label: 'all time', since: null, until: '2026-11-06' }, heat_threshold: 40, heat_rule: { hot: 40, warm: 10, days: 7 }, computed_at: '2026-11-06T13:00:00Z', heat_pending: 1 };
const ME = { profile: { id: 'u1', display_name: 'Jack Carlson' } };
const MEMBERS = [{ user_id: 'u1', name: 'Jack Carlson', role: 'owner', color: '#6F8CF0' }, { user_id: 'u2', name: 'Cyrus Test', role: 'member', color: '#C97626' }];
beforeEach(() => {
  mockPhone.on = false;
  localStorage.clear();
  goalsApi.peopleActivity.mockResolvedValue(DATA);
  goalsApi.members.mockResolvedValue(MEMBERS);
  goalsApi.peopleViews.mockResolvedValue([]);
  goalsApi.peopleActivityDetail.mockResolvedValue({ key: 'prospect:CrystalPringle', notes: 'Met at the expo', timeline: [{ kind: 'reply', at: '2026-11-03T12:00:00Z', step: 2, automated: false, reply_class: 'follow_up_question', seen_at_sync: true }, { kind: 'open', at: '2026-11-02T15:00:00Z', step: 1, automated: true }, { kind: 'sent', at: '2026-11-01T12:00:00Z', step: 1, automated: false, subject: 'Hello from HomeLover' }] });
});
afterEach(() => jest.clearAllMocks());
const table = async () => { render(<PeopleTable businessId="b1" canEdit me={ME} />); return screen.findByRole('table', { name: 'People' }); };

test('the table: 10 columns, rows in the route\'s order, the heat band from the route (108 · warm above 68 · hot stays warm), chips with counts narrow the set, "Showing n of N" with removable chips, the footnote states the Huddle\'s rule', async () => {
  const t = await table();
  expect(within(t).getAllByRole('columnheader').map(h => h.textContent.replace(/^[◉✓]/, '').replace(/ [↕▲▼]$/, ''))).toEqual(['Person', 'Company', 'Size (company)', 'Source', 'Emails (human opens)', 'Last email', 'Heat', 'Company visits', 'Identified', 'Buyer', 'Last touch']);
  // heat-size-v1 S1: every fixture company lacks a headcount -> "unknown" cells, the Unknown chip counts 3, the coverage line (R5).
  expect([...t.querySelectorAll('[data-size]')].map(el => el.textContent)).toEqual(['unknown', 'unknown', 'unknown']);
  expect(screen.getByText('headcount known for 0 of 3 companies · 0 people have no company record')).toBeInTheDocument();
  const sizeChips = within(screen.getByRole('group', { name: 'Size' })).getAllByRole('button');
  expect(sizeChips.map(b => b.textContent)).toEqual(['Unknown(3)', '< 200(0)', '200–999(0)', '1,000–4,999(0)', '5,000+(0)']);
  const names = () => [...t.querySelectorAll('tr[data-row] [data-person-name]')].map(el => el.textContent);
  expect(names()).toEqual(['Crystal Pringle', 'Cristina Torres', 'Bo Ops']);
  const bands = [...t.querySelectorAll('[data-heat-band]')].map(el => `${el.dataset.heatBand}:${el.textContent}`);
  expect(bands).toEqual(['warm:108 · warm', 'hot:68 · hot']);
  expect(screen.getByText(/Heat = the Huddle's score and band, from its own function\. Replied: hot for 7 days from the reply, then warm unless a human click in the last 7 days\. Otherwise hot = score ≥ 40, a human click in 7 days, or the company on the site in 7 days with an email sent \(an identified visitor counts\); warm = score ≥ 10 or a real open in 7 days; else cold\. Opens count humans only \(the Huddle's bot rule\); a company visit adds points, a visit alone is warm at most\. 1 person has no heat yet/)).toBeInTheDocument();
  expect(screen.getByText('Showing 3 of 3')).toBeInTheDocument();
  const chips = within(screen.getByRole('group', { name: 'Filter chips' }));
  expect(chips.getByRole('button', { name: /^Opened/ })).toHaveTextContent('(2)');
  expect(chips.getByRole('button', { name: /^Identified visitor/ })).toHaveTextContent('(1)');
  expect(chips.getByRole('button', { name: /^Hot/ })).toHaveTextContent('(1)');
  expect(chips.getByRole('button', { name: /^Mine/ })).toHaveTextContent('(1)');
  fireEvent.click(chips.getByRole('button', { name: /^Opened/ }));
  fireEvent.click(chips.getByRole('button', { name: /^Buyer title/ }));
  expect(names()).toEqual(['Crystal Pringle']);
  expect(screen.getByText('Showing 1 of 3 ·')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Remove.*Buyer title|Buyer title.*×|×.*Buyer/i }).closest('button') || screen.getAllByRole('button', { name: /Buyer title/ })[1]);
  expect(names()).toEqual(['Crystal Pringle', 'Cristina Torres']);
  fireEvent.change(screen.getByLabelText('Search people'), { target: { value: 'equinox' } });
  expect(names()).toEqual(['Cristina Torres']);
  fireEvent.click(screen.getByRole('button', { name: /Clear/ }));
  expect(names()).toHaveLength(3);
  fireEvent.change(screen.getByLabelText('Window'), { target: { value: '7' } });
  await waitFor(() => expect(goalsApi.peopleActivity).toHaveBeenLastCalledWith('b1', '7'));
});

test('select vs open: a row click pins the detail (timeline + company visits + notes + quick menu); the name opens the company window on its People card; the company opens the window; Esc closes', async () => {
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
  const tl = await within(detail).findByRole('list');
  expect([...tl.querySelectorAll('[data-timeline-kind]')].map(li => li.dataset.timelineKind)).toEqual(['reply', 'open', 'sent']);
  expect(within(tl).getByText(/follow up question · time = when the sync saw it/)).toBeInTheDocument();
  expect(within(tl).getByText(/automated open \(scanner\)/)).toBeInTheDocument();
  expect(within(detail).getByRole('region', { name: 'Company and notes' })).toHaveTextContent(/6 visits \(Apollo, rolling 7 d\) · last Nov 5 · \/pricing/);
  expect(within(detail).getByText('Met at the expo')).toBeInTheDocument();
  expect(within(within(detail).getByRole('group', { name: 'Quick menu' })).getAllByRole('button').map(b => b.textContent)).toEqual(['Open company', 'Draft email', 'Log call', 'Add to-do', 'Mark contacted', 'Not a fit']);
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
  await waitFor(() => expect(goalsApi.createWeekGoal).toHaveBeenCalledWith('b1', { week_start: '2026-11-09', kind: 'todo', text: 'Send the deck', owner_user_id: 'u1', due_date: '2026-11-10', link_type: 'opportunity', link_id: 'o1' }));
  await waitFor(() => expect(goalsApi.peopleActivity).toHaveBeenCalledTimes(2), { timeout: 2000 }); // onChanged re-reads
  fireEvent.click(menu.getByRole('button', { name: 'Not a fit' }));
  await waitFor(() => expect(updateProspect).toHaveBeenCalledWith('b1', 'CrystalPringle', { status: 'dead' }));
  const toast = await screen.findByText('Crystal Pringle marked not a fit');
  fireEvent.click(within(toast.closest('[role="status"]')).getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(updateProspect).toHaveBeenLastCalledWith('b1', 'CrystalPringle', { status: 'new', expect: { status: 'dead' } }));
  fireEvent.click(menu.getByRole('button', { name: 'Mark contacted' }));
  await waitFor(() => expect(goalsApi.markContacted).toHaveBeenCalledWith('b1', 'employer', 'o1', { contact_id: 'CrystalPringle', person: 'Crystal Pringle', touch_type: 'email' }));
});

test('a person with no pipeline record: the quick menu says why; a non-prospect cannot be archived', async () => {
  goalsApi.peopleActivityDetail.mockResolvedValue({ key: 'person:sp1', notes: 'Identified visitor 2026-11-02', timeline: [], heat: { score: 11, band: 'hot', why: ['Identified on the site 2 d ago +11'] } });
  const t = await table();
  fireEvent.click(t.querySelectorAll('tr[data-row] td')[t.querySelectorAll('tr[data-row]').length * 11 - 11]);
  const detail = await waitFor(() => { const el = t.querySelector('[data-person-detail="person:sp1"]'); if (!el) throw new Error('no detail'); return el; });
  // heat-size-v1 Stage 2: the card's heat is the route's live computation - score · band + the why lines.
  await waitFor(() => expect(detail.querySelector('[data-heat-why]')).toBeTruthy());
  expect(detail.querySelector('[data-heat-live]').textContent).toContain('11 · hot');
  expect([...detail.querySelectorAll('[data-heat-why] li')].map(li => li.textContent)).toEqual(['Identified on the site 2 d ago +11']);
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
  expect(texts[0].split('\r\n')[0]).toMatch(/^Person,Title,Company,Company stage,Company size,Size source,Source,Sent,Opened \(human\),Clicked,Replied,/);
  expect(texts[0].split('\r\n')).toHaveLength(2);
  expect(texts[0]).toMatch(/Crystal Pringle,VP People,Acme Health,contacted,unknown,,Apollo sequence,2,4,0,1,/);
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

test('an old Huddle link lands on its chip; a Viewer reads: CSV yes, Share view no, the quick menu is Open company only', async () => {
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

test('phone: stacked cards with the glyph counts, the chip row scrolls sideways, the selects live in the Filters sheet', async () => {
  mockPhone.on = true;
  render(<PeopleTable businessId="b1" canEdit me={ME} />);
  const list = await screen.findByRole('list', { name: 'People' });
  expect(list.querySelectorAll('[data-row]')).toHaveLength(3);
  expect(within(list).getAllByTitle('human opens')[0].textContent).toBe('👁 4');
  expect(screen.getByRole('group', { name: 'Filter chips' }).style.overflowX).toBe('auto');
  expect(screen.queryByLabelText('Window')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
  expect(within(screen.getByRole('dialog', { name: 'Filters' })).getByLabelText('Window')).toBeInTheDocument();
});

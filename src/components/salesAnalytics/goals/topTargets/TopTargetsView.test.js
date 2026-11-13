import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import TopTargetsView from './TopTargetsView';
import { segments, barLabel, breakdownTitle, breakdownLines, pinLine, starState, routeParams, ownerChips } from './topTargetsModel';
import { goalsApi, OPEN_PIPELINE_RECORD } from '../goalsApi';

const mockPhone = { on: false };
jest.mock('../../../../utils/useMediaQuery', () => () => mockPhone.on);
jest.mock('../goalsApi', () => ({
  OPEN_PIPELINE_RECORD: 'prospector:open-pipeline-record',
  goalsApi: { topTargets: jest.fn(), pinCompany: jest.fn(), undoFlow: jest.fn(), partnerUndo: jest.fn() },
}));

// top-targets-v1 Stage 2 - the Top targets page (invented companies; names and numbers only).
const ME = 'u-jack', CY = 'u-cyrus', SE = 'u-seif';
const MEMBERS = [{ user_id: ME, name: 'Jack Carlson', role: 'owner', color: '#6F8CF0' }, { user_id: CY, name: 'Cyrus Test', role: 'member', color: '#C97626' }, { user_id: SE, name: 'Seif Test', role: 'viewer', color: '#4FB0C6' }];
const groups = (heat, fit, impact, recency, pin) => ({ heat, fit, impact, recency, pin });
const row = (name, score, band, g, extra = {}) => ({
  type: 'employer', id: name, key: `employer-${name}`, name, stage: 'contacted', stage_label: 'Contacted', owner_user_id: ME, owner: 'Jack Carlson', employees: 6000,
  score, band, groups: g, parts: { visits: 4, pages: 2, apollo_intent: 3, people: 3, engagement: 0, fit: 12, research: 6, source: 2, stage: 4, recency: 4 },
  pin: null, pinned_until: null, pin_expired: null, next: null, why: { short: '5,000+ · no visits this week · Contacted', full: `5,000+ employees · contacted · pinned: ${name}` }, ...extra,
});
const PINNED = row('Zz Pinned Co', 60, 'P1', groups(12, 18, 6, 4, 20), { pinned_until: '2026-12-01T00:00:00+00:00', pin: { until: '2026-12-01T00:00:00+00:00', reason: 'priority set Oct 31', level: 1, days_left: 18, held: false }, next: { text: 'Find the benefits lead', due: '2026-11-17' } });
const PLAIN = row('Zz Plain Co', 68, 'P1', groups(24, 20, 16, 8, 0));
const EXPIRED = row('Zz Expired Co', 52, 'P2', groups(20, 14, 10, 8, 0), { pinned_until: '2026-11-09T00:00:00+00:00', pin_expired: { until: '2026-11-09T00:00:00+00:00', reason: 'was Top' } });
const PARTNER = row('Zz Partner Co', 45, 'P2', groups(15, 14, 12, 4, 0), { type: 'partner', key: 'partner-Zz Partner Co', owner_user_id: null, owner: null });
const BODY = { rows: [PINNED, PLAIN, EXPIRED, PARTNER], n: 4, total: 4, scope: 4, book: 490, pinned: 1, counts: { owners: { [ME]: 78, [CY]: 54, [SE]: 3, unassigned: 355 }, bands: { P1: 7, P2: 10, P3: 14, P4: 47 } } };

const setup = (props = {}) => render(<TopTargetsView businessId="b1" canEdit meId={ME} members={MEMBERS} {...props} />);
const tr = name => screen.getByRole('button', { name }).closest('[data-row]');

beforeEach(() => { mockPhone.on = false; goalsApi.topTargets.mockResolvedValue(BODY); });
afterEach(() => jest.clearAllMocks());

test('the bar: five segments whose drawn lengths add up to the score; a group that takes points away draws nothing; the label names all five', () => {
  const s = segments(groups(12, 18, 6, 4, 20), 60);
  expect(s.map(x => [x.key, x.points, x.pct])).toEqual([['heat', 12, 12], ['fit', 18, 18], ['impact', 6, 6], ['recency', 4, 4], ['pin', 20, 20]]);
  expect(s.reduce((n, x) => n + x.pct, 0)).toBe(60);
  const held = segments(groups(30, 20, 10, -10, -11), 39);
  expect(held.map(x => x.key)).toEqual(['heat', 'fit', 'impact']);
  expect(Math.round(held.reduce((n, x) => n + x.pct, 0))).toBe(39);
  expect(segments(groups(0, 0, 0, 0, 0), 0)).toEqual([]);
  expect(barLabel(groups(12, 18, 6, 4, 20))).toBe('Heat 12 · Fit 18 · Impact 6 · Recency 4 · Pin 20');
  expect(breakdownTitle(PINNED)).toBe('Zz Pinned Co · 60 = 40 scored + 20 pin');
  expect(breakdownTitle(PLAIN)).toBe('Zz Plain Co · 68');
  expect(breakdownLines(PINNED).map(l => [l.label, l.points, l.text])).toEqual([
    ['Heat', 12, 'visits 4 · pages 2 · Apollo intent 3 · people 3 · engagement 0'], ['Fit', 18, 'fit 12 · research 6'], ['Impact', 6, 'source 2 · stage 4'],
    ['Recency', 4, 'last signal 4'], ['Pin', 20, 'lifts 40 to the P1 floor of 60 until the pin ends']]);
});

test('model: the pin line, the star states, the route params and the owner chips (Mine replaces my own name)', () => {
  expect(pinLine(PINNED)).toEqual({ lead: 'Pinned', rest: '18 d left · priority set Oct 31', live: true });
  expect(pinLine({ pin: { held: true, level: 3, days_left: 5, reason: null } })).toEqual({ lead: 'Held at P3', rest: '5 d left', live: true });
  expect(pinLine(EXPIRED)).toEqual({ lead: 'Pin expired Nov 9', rest: '', live: false });
  expect(pinLine(PLAIN)).toBeNull();
  expect([PINNED, EXPIRED, PLAIN].map(starState)).toEqual(['pinned', 'expired', 'none']);
  expect(routeParams({ owner: 'me', band: '', pinned: false, size: '', q: '' })).toEqual({ limit: '1000', owner: 'me' });
  expect(routeParams({ owner: 'team', band: 'P2', pinned: true, size: '5000', q: 'zz' })).toEqual({ limit: '1000', band: 'P2', pinned: 'true', size: '5000', q: 'zz' });
  expect(ownerChips(MEMBERS, ME, BODY).map(c => [c.id, c.label, c.count])).toEqual([['me', 'Mine', 78], [CY, 'Cyrus', 54], [SE, 'Seif', 3], ['team', 'Team', 490]]);
});

test('1440: default Mine; rows in the route\'s order; the Why cell is why.short; chips and the count line are the route\'s numbers', async () => {
  setup();
  await screen.findByText('Zz Pinned Co');
  expect(goalsApi.topTargets).toHaveBeenCalledWith('b1', { limit: '1000', owner: 'me' });
  expect(screen.getByRole('region', { name: 'Top targets' })).toHaveAttribute('data-top-targets', 'table');
  expect([...document.querySelectorAll('[data-row]')].map(r => r.getAttribute('data-row'))).toEqual(BODY.rows.map(r => r.key));
  expect(screen.getAllByRole('columnheader').map(h => h.textContent.trim())).toEqual(['Company', 'Score ▼', 'Breakdown', 'Why', 'Next', 'Pin']);
  const first = within(tr('Zz Pinned Co'));
  expect(first.getByText('5,000+ · no visits this week · Contacted')).toBeTruthy();
  expect(screen.queryByText(/pinned: Zz Pinned Co/)).toBeNull();
  expect(tr('Zz Pinned Co').querySelector('[data-pin-line]').textContent).toBe('Pinned · 18 d left · priority set Oct 31');
  expect(first.getByText(/Find the benefits lead/).textContent).toBe('Find the benefits lead · Nov 17');
  expect([...tr('Zz Pinned Co').querySelectorAll('[data-seg]')].map(i => [i.getAttribute('data-seg'), i.style.width])).toEqual([['heat', '12%'], ['fit', '18%'], ['impact', '6%'], ['recency', '4%'], ['pin', '20%']]);
  expect(tr('Zz Partner Co').textContent).toContain('Unassigned');
  expect([...document.querySelectorAll('[data-owner-chip]')].map(c => [c.textContent, c.getAttribute('aria-pressed')])).toEqual([['Mine 78', 'true'], ['Cyrus 54', 'false'], ['Seif 3', 'false'], ['Team 490', 'false']]);
  expect(document.querySelector('[data-pinned-chip]').textContent).toBe('Pinned 1');
  expect([...document.querySelectorAll('[data-band-chip]')].map(c => c.textContent)).toEqual(['P1 7', 'P2 10', 'P3 14', 'P4 47']);
  expect(document.querySelector('[data-count-line]').textContent).toBe('Showing 4 of 4 · 1 pinned · pinned first, newest pin on top, then by score');
});

test('chips, Size and search send the route\'s params; a company name opens its window; no rows offers Clear filters', async () => {
  setup();
  await screen.findByText('Zz Pinned Co');
  fireEvent.click(screen.getByRole('button', { name: /^Cyrus/ }));
  await waitFor(() => expect(goalsApi.topTargets).toHaveBeenLastCalledWith('b1', { limit: '1000', owner: CY }));
  fireEvent.click(screen.getByRole('button', { name: /^Team/ }));
  fireEvent.click(screen.getByRole('button', { name: /^P2/ }));
  fireEvent.click(document.querySelector('[data-pinned-chip]'));
  fireEvent.change(screen.getByLabelText('Size'), { target: { value: '5000' } });
  await waitFor(() => expect(goalsApi.topTargets).toHaveBeenLastCalledWith('b1', { limit: '1000', band: 'P2', pinned: 'true', size: '5000' }));
  fireEvent.change(screen.getByLabelText('Search companies'), { target: { value: ' zz ' } });
  await waitFor(() => expect(goalsApi.topTargets).toHaveBeenLastCalledWith('b1', { limit: '1000', band: 'P2', pinned: 'true', size: '5000', q: 'zz' }));
  const heard = jest.fn();
  window.addEventListener(OPEN_PIPELINE_RECORD, heard);
  fireEvent.click(screen.getByRole('button', { name: 'Zz Plain Co' }));
  expect(heard.mock.calls[0][0].detail).toEqual({ key: 'employer-Zz Plain Co' });
  window.removeEventListener(OPEN_PIPELINE_RECORD, heard);
  goalsApi.topTargets.mockResolvedValue({ ...BODY, rows: [], n: 0, total: 0 });
  fireEvent.click(screen.getByRole('button', { name: /^P2/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Clear filters' }));
  await waitFor(() => expect(goalsApi.topTargets).toHaveBeenLastCalledWith('b1', { limit: '1000' }));
});

test('star states: empty -> the reason form (Pin off until a reason is typed, <= 140) -> pin with expect + a 10 s Undo line', async () => {
  goalsApi.pinCompany.mockResolvedValue({ pin: {}, undo: { kind: 'flow', id: 'ev1' } });
  goalsApi.undoFlow.mockResolvedValue({});
  setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Pin Zz Plain Co' }));
  const pop = within(document.querySelector('[data-pin-pop="form"]'));
  expect(pop.getByRole('button', { name: 'Pin' })).toBeDisabled();
  expect(pop.getByLabelText(/^Why/)).toHaveAttribute('maxlength', '140');
  fireEvent.change(pop.getByLabelText(/^Why/), { target: { value: 'Warm intro via Brad' } });
  expect(pop.getByText('19 / 140 · pins last 30 days')).toBeTruthy();
  fireEvent.click(pop.getByRole('button', { name: 'Pin' }));
  await waitFor(() => expect(goalsApi.pinCompany).toHaveBeenCalledWith('b1', 'employer', 'Zz Plain Co', { action: 'pin', reason: 'Warm intro via Brad', expect: { pinned_until: null } }));
  expect((await screen.findByRole('status')).textContent).toContain('Zz Plain Co: Pinned');
  await waitFor(() => expect(document.querySelector('[data-pin-pop]')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(goalsApi.undoFlow).toHaveBeenCalledWith('b1', 'ev1'));
});

test('star states: filled -> Edit reason · Renew · Unpin; hollow expired -> Renew · Unpin, and Renew under the score is one click; a partner undoes by its own route', async () => {
  goalsApi.pinCompany.mockResolvedValue({ pin: null, undo: { kind: 'partner', id: 'ev9' } });
  setup();
  const filled = await screen.findByRole('button', { name: 'Pinned: Zz Pinned Co. Edit, renew or unpin' });
  expect(filled).toHaveAttribute('data-star', 'pinned');
  fireEvent.click(filled);
  expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map(m => m.textContent)).toEqual(['Edit reason', 'Renew 30 more days', 'Unpin']);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit reason' }));
  const form = within(document.querySelector('[data-pin-pop="edit"]'));
  expect(form.getByLabelText(/^Why/).value).toBe('priority set Oct 31');
  fireEvent.change(form.getByLabelText(/^Why/), { target: { value: 'New line' } });
  fireEvent.click(form.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(goalsApi.pinCompany).toHaveBeenLastCalledWith('b1', 'employer', 'Zz Pinned Co', { action: 'reason', reason: 'New line', expect: { pinned_until: '2026-12-01T00:00:00+00:00' } }));
  const hollow = screen.getByRole('button', { name: 'Pin expired: Zz Expired Co. Renew or unpin' });
  expect(hollow).toHaveAttribute('data-star', 'expired');
  fireEvent.click(hollow);
  expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map(m => m.textContent)).toEqual(['Renew 30 more days', 'Unpin']);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Unpin' }));
  await waitFor(() => expect(goalsApi.pinCompany).toHaveBeenLastCalledWith('b1', 'employer', 'Zz Expired Co', { action: 'unpin', expect: { pinned_until: '2026-11-09T00:00:00+00:00' } }));
  expect(tr('Zz Expired Co').querySelector('[data-pin-line]').textContent).toBe('Pin expired Nov 9 · Renew');
  fireEvent.click(within(tr('Zz Expired Co')).getByRole('button', { name: 'Renew' }));
  await waitFor(() => expect(goalsApi.pinCompany).toHaveBeenLastCalledWith('b1', 'employer', 'Zz Expired Co', { action: 'renew', expect: { pinned_until: '2026-11-09T00:00:00+00:00' } }));
  fireEvent.click(screen.getByRole('button', { name: 'Pin Zz Partner Co' }));
  fireEvent.change(screen.getByLabelText(/^Why/), { target: { value: 'Channel' } });
  fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
  await waitFor(() => expect(goalsApi.pinCompany).toHaveBeenLastCalledWith('b1', 'partner', 'Zz Partner Co', { action: 'pin', reason: 'Channel', expect: { pinned_until: null } }));
  fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(goalsApi.partnerUndo).toHaveBeenCalledWith('b1', 'Zz Partner Co', 'ev9'));
});

test('a refused write (409) stays open with the reason and reloads the list', async () => {
  goalsApi.pinCompany.mockRejectedValue(new Error("Zz Plain Co's pin changed since you opened this - reloaded"));
  setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Pin Zz Plain Co' }));
  fireEvent.change(screen.getByLabelText(/^Why/), { target: { value: 'x' } });
  fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
  expect((await screen.findByRole('alert')).textContent).toContain('pin changed since you opened this');
  expect(goalsApi.topTargets).toHaveBeenCalledTimes(2);
});

test('Viewer (S6): stars are glyphs, not buttons; no Renew; no popover; the rest reads the same', async () => {
  setup({ canEdit: false, meId: SE });
  await screen.findByText('Zz Pinned Co');
  expect(screen.queryByRole('button', { name: /^(Pin |Pinned:|Pin expired:)/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Renew' })).toBeNull();
  expect([...document.querySelectorAll('[data-star]')].map(s => [s.tagName, s.getAttribute('data-star')])).toEqual([['SPAN', 'pinned'], ['SPAN', 'none'], ['SPAN', 'expired'], ['SPAN', 'none']]);
  expect(tr('Zz Expired Co').querySelector('[data-pin-line]').textContent).toBe('Pin expired Nov 9');
  expect(document.querySelector('[data-owner-chip="me"]').textContent).toBe('Mine 3');
});

test('390: stacked cards with the five numbers under a full-width bar; the pin form is a bottom sheet; search sits behind its button', async () => {
  mockPhone.on = true;
  goalsApi.pinCompany.mockResolvedValue({ pin: {}, undo: { kind: 'flow', id: 'ev2' } });
  setup();
  await screen.findByText('Zz Pinned Co');
  expect(screen.getByRole('region', { name: 'Top targets' })).toHaveAttribute('data-top-targets', 'cards');
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getAllByRole('article')).toHaveLength(4);
  expect(screen.getByRole('heading', { name: 'Top targets' })).toBeTruthy();
  const card = tr('Zz Pinned Co');
  expect(card.querySelector('.tt-nums').textContent).toBe('12 Heat18 Fit6 Impact4 Recency20 Pin');
  expect(card.querySelector('[data-score-bar]')).toHaveAttribute('aria-label', 'Heat 12 · Fit 18 · Impact 6 · Recency 4 · Pin 20');
  expect(document.querySelector('[data-count-line]').textContent).toBe('Showing 4 of 4 · 1 pinned');
  expect(screen.queryByLabelText('Search companies')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(screen.getByLabelText('Search companies')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Pin Zz Plain Co' }));
  const sheet = within(document.querySelector('[data-pin-sheet="form"]'));
  expect(sheet.getByText('Why — shown on the card')).toBeTruthy();
  expect(sheet.getByRole('button', { name: 'Pin' })).toBeDisabled();
  fireEvent.change(sheet.getByLabelText(/^Why/), { target: { value: 'Summit intro' } });
  fireEvent.click(sheet.getByRole('button', { name: 'Pin' }));
  await waitFor(() => expect(goalsApi.pinCompany).toHaveBeenCalledWith('b1', 'employer', 'Zz Plain Co', { action: 'pin', reason: 'Summit intro', expect: { pinned_until: null } }));
});

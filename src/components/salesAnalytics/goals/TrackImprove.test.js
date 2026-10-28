import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import TrackImprove, { plannerBlock } from './TrackImprove';
import ChannelLinks from './ChannelLinks';
import { SourceHistoryCard } from './LeadSource';
import { goalsApi } from './goalsApi';

jest.mock('./goalsApi', () => ({ goalsApi: { insights: jest.fn(), setInsightStatus: jest.fn(), channelLinks: jest.fn() } }));

// intake-insights-v1 Stage 3 - Dashboard Track & improve, the Sources channel links table, the company window lines.
const DATA = {
  track: [{ id: 'i1', kind: 'track', text: 'Which employers ask about pets in rentals', why: 'Two HR leads asked', status: 'open', already_field: null, seen_count: 2, note: { title: 'Upside check-in', call_date: '2026-10-28' } }],
  optimize: [{ id: 'i2', kind: 'optimize', text: 'Make the one-pager a shared asset', why: null, status: 'planned', already_field: null, seen_count: 1, note: null }],
};
const LINKS = [{ id: 'l1', from_kind: 'office', from_name: 'Upside Chicago office', from_record_type: null, to_kind: 'company', to_name: 'Zz Acme Foods', to_record_type: 'employer', relation: 'referred', link_date: '2026-10-12', seen_count: 2 }];
beforeEach(() => { goalsApi.insights.mockResolvedValue(DATA); goalsApi.channelLinks.mockResolvedValue(LINKS); Object.assign(navigator, { clipboard: { writeText: jest.fn(() => Promise.resolve()) } }); });

test('Track & improve: items by kind with seen count + note; a status change sends expect and reloads; Copy for planner copies the ticked items as a plain block', async () => {
  goalsApi.setInsightStatus.mockResolvedValue({});
  render(<TrackImprove businessId="b1" canEdit />);
  const card = await screen.findByRole('region', { name: 'Track & improve' });
  await within(card).findByText('Which employers ask about pets in rentals');
  expect(within(card).getByRole('group', { name: 'Track' })).toHaveTextContent('seen 2× · from Upside check-in · Oct 28');
  fireEvent.change(within(card).getByLabelText('Status of Which employers ask about pets in rentals'), { target: { value: 'planned' } });
  await waitFor(() => expect(goalsApi.setInsightStatus).toHaveBeenCalledWith('b1', 'i1', { status: 'planned', expect: 'open' }));
  await waitFor(() => expect(goalsApi.insights).toHaveBeenCalledTimes(2));
  fireEvent.click(within(card).getByLabelText('Pick for the planner: Make the one-pager a shared asset'));
  fireEvent.click(within(card).getByRole('button', { name: 'Copy for planner (1)' }));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
  expect(navigator.clipboard.writeText.mock.calls[0][0]).toMatch(/^Track & improve - .+\nOPTIMIZE\n- Make the one-pager a shared asset$/);
});

test('plannerBlock: TRACK then OPTIMIZE, why + seen count + already tracked; Viewers read the status, no picker', async () => {
  expect(plannerBlock([...DATA.track, { ...DATA.optimize[0], already_field: 'Research facts' }], new Date('2026-10-28T12:00:00Z')))
    .toBe('Track & improve - Oct 28\nTRACK\n- Which employers ask about pets in rentals - Two HR leads asked (seen 2x)\nOPTIMIZE\n- Make the one-pager a shared asset [already tracked: Research facts]');
  render(<TrackImprove businessId="b1" canEdit={false} />);
  const card = await screen.findByRole('region', { name: 'Track & improve' });
  await within(card).findByText('Planned');
  expect(within(card).queryByRole('combobox')).toBeNull();
});

test('Channel links: From -> relation -> To with ✓ on matched ends, date, seen; the partner filter is passed; the company window lists "Linked in notes"', async () => {
  render(<ChannelLinks businessId="b1" partner="p1" />);
  const sec = await screen.findByRole('region', { name: 'Channel links' });
  await waitFor(() => expect(sec.querySelectorAll('[data-link-row]')).toHaveLength(1));
  expect(goalsApi.channelLinks).toHaveBeenCalledWith('b1', { partner: 'p1' });
  expect(sec.querySelector('[data-link-row]')).toHaveTextContent('Upside Chicago officeoffice');
  expect(sec.querySelector('[data-link-row]')).toHaveTextContent('Zz Acme Foods ✓');
  expect(sec).toHaveTextContent('Oct 12');
  render(<SourceHistoryCard data={{ history: [] }} links={LINKS} />);
  expect(document.querySelector('[data-linked-in-notes]')).toHaveTextContent('Linked in notes: Upside Chicago office → referred → Zz Acme Foods (Oct 12) · seen 2×');
});

test('axe: Track & improve and the channel links table have 0 violations', async () => {
  const axe = require('axe-core');
  const { container } = render(<><TrackImprove businessId="b1" canEdit /><ChannelLinks businessId="b1" /></>);
  await screen.findByText('Which employers ask about pets in rentals');
  await waitFor(() => expect(container.querySelectorAll('[data-link-row]')).toHaveLength(1));
  const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'] });
  expect(r.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(' | ')}`)).toEqual([]);
});

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import CallNotesPanel from './CallNotesPanel';
import { goalsApi } from '../goals/goalsApi';
import { insightsBody } from './intakeBody';

jest.mock('../goals/goalsApi', () => ({ goalsApi: { extractCallNotes: jest.fn(), createFromCallNotes: jest.fn(), appendToSection: jest.fn() } }));

// intake-insights-v1 Stage 3 - the Intake review's "From these notes" section (made-up notes; names only).
const links = { options: {}, load: jest.fn(), labelFor: (t, id) => `${t}: ${id}` };
const INSIGHTS = {
  track: [
    { key: 'k0', what: 'Referring office on every Upside referral', why: 'Most come from Chicago', where: 'referral', example: 'most come from Chicago', evidence: 'most come from Chicago', already_field: 'Referring office', keep: false },
    { key: 'k1', what: 'Which employers ask about pets in rentals', why: 'Two HR leads asked', where: 'company', example: null, evidence: 'asked if pets are covered', already_field: null, keep: true },
  ],
  optimize: [{ key: 'o0', text: 'Make the one-pager a shared asset', why: 'two partners asked', evidence: 'both asked for the one-pager', keep: true }],
  channel_links: [{ key: 'l0', from: { kind: 'office', name: 'Upside Chicago office', match: null }, to: { kind: 'company', name: 'Zz Acme Foods', match: { record_type: 'employer', record_id: 'e1', name: 'Zz Acme Foods' } }, relation: 'referred', date: '2026-10-12', evidence: 'Chicago sent Acme', already_recorded: true, keep: true }],
};
afterEach(() => jest.clearAllMocks());

test('"From these notes": Track (already tracked starts unticked) · Optimize · Channel links with the matched end and "Already recorded"; Accept sends only the kept items', async () => {
  goalsApi.extractCallNotes.mockResolvedValue({ call_date: '2026-10-28', summary: ['A'], tasks: [], insights: INSIGHTS });
  goalsApi.createFromCallNotes.mockResolvedValue({ goals: [], note: { id: 'n1' } });
  render(<CallNotesPanel businessId="b1" members={[]} lookup={() => ({ first: 'x', color: '#888' })} links={links} onClose={jest.fn()} onCreated={jest.fn()} onShowCalls={jest.fn()} />);
  fireEvent.change(screen.getByLabelText('Call notes'), { target: { value: 'Brad: most come from Chicago.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Read notes' }));
  const sec = await screen.findByRole('region', { name: 'From these notes' });
  expect([...sec.querySelectorAll('[data-insight-group]')].map(g => g.textContent)).toEqual(['Track · 2', 'Optimize · 1', 'Channel links · 1']);
  expect(sec).toHaveTextContent('Already tracked: Referring office');
  expect(sec).toHaveTextContent('Not tracked yet');
  expect(sec.querySelector('[data-channel-link]')).toHaveTextContent('Upside Chicago office → referred → Zz Acme Foods ✓ (Oct 12)');
  expect(sec).toHaveTextContent('Already recorded on the company');
  expect(screen.getByRole('button', { name: 'Accept 3' })).toBeEnabled();
  fireEvent.click(within(sec).getByLabelText('Keep: Make the one-pager a shared asset'));
  fireEvent.click(screen.getByRole('button', { name: 'Accept 2' }));
  await waitFor(() => expect(goalsApi.createFromCallNotes).toHaveBeenCalled());
  const body = goalsApi.createFromCallNotes.mock.calls[0][1];
  expect(body.insights.track.map(t => t.what)).toEqual(['Which employers ask about pets in rentals']);
  expect(body.insights.optimize).toEqual([]);
  expect(body.insights.channel_links).toEqual([{ from: INSIGHTS.channel_links[0].from, to: INSIGHTS.channel_links[0].to, relation: 'referred', date: '2026-10-12', evidence: 'Chicago sent Acme' }]);
});

test('no insights in the reply -> no section, and Accept sends empty lists', () => {
  expect(insightsBody()).toEqual({ track: [], optimize: [], channel_links: [] });
  expect(insightsBody({ track: [{ what: 'x', keep: false }] }).track).toEqual([]);
});

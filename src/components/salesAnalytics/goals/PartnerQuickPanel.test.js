import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PartnerQuickPanel from './PartnerQuickPanel';
import { goalsApi } from './goalsApi';

// pipeline-quick-panel-v1 Stage 1 - the panel on its own: events read,
// Esc on the field reverts, errors show, Viewer gets text only.
jest.mock('./goalsApi', () => ({ goalsApi: { updatePartner: jest.fn(), partnerSignal: jest.fn(), partnerEvents: jest.fn() } }));

const ROW = { type: 'partner', id: 'g1', name: 'Gallagher', stage: 'replied', stage_label: 'Replied', color: 'yellow', owner_team: 'upside', co_owner_name: 'Brad', no_double_touch: true, owner: 'Jack', tier: '2', next_step: 'Send deck', next_step_due: null, last_touch_at: null, top: false, record_id: null, category: '4. Mid-Market Benefits Brokers' };
const EVENTS = [
  { id: 'e5', event: 'note', note: 'Newest note', at: '2026-10-15T10:00:00Z' },
  { id: 'e4', event: 'status', from_status: 'first_email_sent', to_status: 'replied', at: '2026-10-14T10:00:00Z' },
  { id: 'e3', event: 'touch', touch_type: 'call', contact_names: ['Pat'], note: 'Left a voicemail', at: '2026-10-13T10:00:00Z' },
  { id: 'e2', event: 'note', note: 'Older note', at: '2026-10-12T10:00:00Z' },
  { id: 'e1', event: 'note', note: 'Oldest note', at: '2026-10-11T10:00:00Z' },
];
const setup = (extra = {}) => {
  const props = { businessId: 'b1', row: ROW, canEdit: true, onChange: jest.fn(), onStar: jest.fn(), onClose: jest.fn(), onOpenFull: jest.fn(), ...extra };
  render(<PartnerQuickPanel {...props} />);
  return props;
};
beforeEach(() => {
  goalsApi.partnerEvents.mockResolvedValue(EVENTS);
  goalsApi.updatePartner.mockResolvedValue({});
  goalsApi.partnerSignal.mockResolvedValue({});
  document.body.style.overflow = '';
});

test('header: name, category, stage, tier, owner, ownership pill; last 3 note/touch events newest first; page scroll locked', async () => {
  const { unmount } = render(<PartnerQuickPanel businessId="b1" row={ROW} canEdit onChange={jest.fn()} onStar={jest.fn()} onClose={jest.fn()} onOpenFull={jest.fn()} />);
  expect(screen.getByRole('complementary', { name: 'Gallagher' })).toBeTruthy();
  expect(screen.getByText('Mid-Market Benefits Brokers')).toBeTruthy();
  expect(screen.getByText('Tier 2')).toBeTruthy();
  expect(screen.getByText('Jack')).toBeTruthy();
  expect(screen.getByLabelText("Owner: Upside, co-owner Brad - don't double-touch")).toBeTruthy();
  expect(goalsApi.partnerEvents).toHaveBeenCalledWith('b1', { goal_id: 'g1' });
  const items = await screen.findAllByRole('listitem');
  expect(items.map(li => li.textContent)).toEqual(['Oct 15Note: Newest note', 'Oct 13Called PatLeft a voicemail', 'Oct 12Note: Older note']);
  expect(document.body.style.overflow).toBe('hidden');
  unmount();
  expect(document.body.style.overflow).toBe('');
});

test('Next step: Esc reverts without a write; Enter with a change saves once and patches the row; a refused save shows', async () => {
  const props = setup();
  const field = screen.getByLabelText('Next step');
  fireEvent.change(field, { target: { value: 'Something else' } });
  fireEvent.keyDown(field, { key: 'Escape' });
  expect(field.value).toBe('Send deck');
  expect(goalsApi.updatePartner).not.toHaveBeenCalled();
  expect(props.onClose).not.toHaveBeenCalled();
  fireEvent.change(field, { target: { value: '  Book the call ' } });
  fireEvent.keyDown(field, { key: 'Enter' });
  await waitFor(() => expect(goalsApi.updatePartner).toHaveBeenCalledWith('b1', 'g1', { next_step: 'Book the call' }));
  expect(props.onChange).toHaveBeenCalledWith({ next_step: 'Book the call' });
  goalsApi.updatePartner.mockRejectedValueOnce(new Error('next_step must be at most 500 characters'));
  fireEvent.change(field, { target: { value: 'Too long' } });
  fireEvent.blur(field);
  expect(await screen.findByText(/next_step must be at most 500 characters/)).toBeTruthy();
  expect(props.onChange).toHaveBeenCalledTimes(1);
});

test('clearing Next step saves null; Shift+Enter in the note is a newline, Enter saves and refreshes the events', async () => {
  const props = setup();
  const field = screen.getByLabelText('Next step');
  fireEvent.change(field, { target: { value: '' } });
  fireEvent.blur(field);
  await waitFor(() => expect(goalsApi.updatePartner).toHaveBeenCalledWith('b1', 'g1', { next_step: null }));
  expect(props.onChange).toHaveBeenCalledWith({ next_step: null });
  const note = screen.getByLabelText('Add note');
  fireEvent.change(note, { target: { value: 'line one' } });
  fireEvent.keyDown(note, { key: 'Enter', shiftKey: true });
  expect(goalsApi.partnerSignal).not.toHaveBeenCalled();
  await screen.findAllByRole('listitem');
  fireEvent.keyDown(note, { key: 'Enter' });
  await waitFor(() => expect(goalsApi.partnerSignal).toHaveBeenCalledWith('b1', 'g1', { type: 'note', note: 'line one' }));
  await waitFor(() => expect(goalsApi.partnerEvents).toHaveBeenCalledTimes(2));
});

test('one forward step: status signal with expect, row patched with the new stage/color; paused and live have no step', async () => {
  const props = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Next: Meeting booked' }));
  await waitFor(() => expect(goalsApi.partnerSignal).toHaveBeenCalledWith('b1', 'g1', { type: 'status', to: 'meeting_set', expect: 'replied' }));
  expect(props.onChange).toHaveBeenCalledWith(expect.objectContaining({ stage: 'meeting_set', stage_label: 'Meeting set', color: 'yellow', last_touch_at: expect.any(String) }));
  goalsApi.partnerSignal.mockRejectedValueOnce(new Error('stage changed since this screen loaded'));
  fireEvent.click(screen.getByRole('button', { name: 'Next: Meeting booked' }));
  expect(await screen.findByText(/stage changed since this screen loaded/)).toBeTruthy();
});

test('paused shows where to resume; live shows ✓; ★ and Close / Open full card call back', () => {
  const { unmount } = render(<PartnerQuickPanel businessId="b1" row={{ ...ROW, stage: 'paused' }} canEdit onChange={jest.fn()} onStar={jest.fn()} onClose={jest.fn()} onOpenFull={jest.fn()} />);
  expect(screen.getByText('Paused - resume in Partner workflow')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Next:/ })).toBeNull();
  unmount();
  const props = setup({ row: { ...ROW, stage: 'live', top: true } });
  expect(screen.getByText('✓ Live')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Unstar Gallagher' }));
  expect(props.onStar).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(props.onClose).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Open full card →' }));
  expect(props.onOpenFull).toHaveBeenCalledTimes(1);
});

test('Viewer: fields as text, no ★ button, no note box, no Next, note says read-only; events still listed', async () => {
  setup({ canEdit: false });
  expect(screen.getByText('Send deck')).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('button', { name: /Star|Save note|^Next:/ })).toBeNull();
  expect(screen.getByText('You have view access, so this is read-only.')).toBeTruthy();
  expect((await screen.findAllByRole('listitem')).length).toBe(3);
});

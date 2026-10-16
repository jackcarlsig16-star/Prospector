import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import AddPartnerForm from './AddPartnerForm';

// partner-add-research-v1 Stage 1 - the Add partner form against a fake
// dupe-check: exact hit blocks once and flips the button to "Add anyway",
// a partial hit only warns, a failed check never blocks the save.
const gal = { type: 'partner', id: 'p-gal', name: 'Gallagher', archived: false, via: 'name', pipeline_status: 'replied' };
const setup = (answer, onCreate = jest.fn().mockResolvedValue({})) => {
  const onDupeCheck = jest.fn(answer);
  const onDone = jest.fn(), onOpenPartner = jest.fn();
  render(<AddPartnerForm onCreate={onCreate} onDupeCheck={onDupeCheck} onOpenPartner={onOpenPartner} onDone={onDone} onCancel={jest.fn()} />);
  const input = screen.getByLabelText('Partner name');
  return { input, onCreate, onDupeCheck, onDone, onOpenPartner };
};

test('exact hit: "Already in Prospector" with Open, button says Add anyway, first Add is held, Add anyway saves', async () => {
  const { input, onCreate, onDone, onOpenPartner } = setup(async () => ({ exact: [gal], partial: [] }));
  fireEvent.change(input, { target: { value: 'Gallagher Inc' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await screen.findByText('Already in Prospector:');
  expect(screen.getByText(/Gallagher \(partner\)/)).toBeInTheDocument();
  expect(onCreate).not.toHaveBeenCalled();
  const btn = screen.getByRole('button', { name: 'Add anyway' });
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  expect(onOpenPartner).toHaveBeenCalledWith('p-gal');
  await act(async () => { fireEvent.click(btn); });
  await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ name: 'Gallagher Inc', priority: 1 }));
  expect(onDone).toHaveBeenCalled();
});

test('partial hit: a Similar line, Add still saves on the first click; archived and not-a-fit are labelled', async () => {
  const bb = { type: 'partner', id: 'p-bb', name: 'Brown & Brown', archived: true, via: 'name' };
  const zero = { type: 'target', id: 't-z', name: 'ZeroBounce', archived: false, via: 'name', status: 'rejected' };
  const { input, onCreate } = setup(async () => ({ exact: [], partial: [bb, zero, { type: 'opportunity', id: 'o', name: 'Fit', archived: false, via: 'name' }, { type: 'account', id: 'a', name: 'Solid', archived: false, via: 'name' }] }));
  fireEvent.change(input, { target: { value: 'Brown Insurance' } });
  await screen.findByText(/Similar: Brown & Brown \(partner · archived\) · ZeroBounce \(target · not a fit\) · Fit \(pipeline\) · Solid \(Apollo\)/);
  expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })); });
  await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ name: 'Brown Insurance', priority: 1 }));
});

test('a failed dupe check never blocks the save', async () => {
  const { input, onCreate } = setup(async () => { throw new Error('offline'); });
  fireEvent.change(input, { target: { value: 'Fundrise' } });
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
  await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ name: 'Fundrise', priority: 1 }));
  expect(screen.queryByText('Already in Prospector:')).toBeNull();
});

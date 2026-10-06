import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InfraList } from './ReportView';

// Weekly report §2 Sales infrastructure: the new-item bubble must save from
// Enter in any field or the Add button, and never from an empty component.
function setup() {
  const onAdd = jest.fn().mockResolvedValue(true);
  render(<InfraList items={[]} editable onAdd={onAdd} onUpdate={jest.fn()} onDelete={jest.fn()} onCarry={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '+ Add item' }));
  return onAdd;
}

test('Enter in the Note field saves the item and closes the bubble', async () => {
  const onAdd = setup();
  fireEvent.change(screen.getByLabelText('Component'), { target: { value: ' Email domain ' } });
  fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'waiting on DNS' } });
  fireEvent.submit(screen.getByLabelText('Note').closest('form'));
  await waitFor(() => expect(onAdd).toHaveBeenCalledWith({ component: 'Email domain', status: 'in_progress', note: 'waiting on DNS' }));
  await waitFor(() => expect(screen.queryByLabelText('Component')).toBeNull());
  expect(screen.getByRole('button', { name: '+ Add item' })).toBeTruthy();
});

test('Add button saves; it is disabled and Enter does nothing while Component is empty', async () => {
  const onAdd = setup();
  const add = screen.getByRole('button', { name: 'Add' });
  expect(add.disabled).toBe(true);
  fireEvent.submit(add.closest('form'));
  expect(onAdd).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Component'), { target: { value: 'CRM' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  await waitFor(() => expect(onAdd).toHaveBeenCalledWith({ component: 'CRM', status: 'in_progress', note: null }));
});

test('a failed save keeps the bubble open with the error', async () => {
  const onAdd = jest.fn().mockRejectedValue(new Error('This week is finalized - reopen it to edit'));
  render(<InfraList items={[]} editable onAdd={onAdd} onUpdate={jest.fn()} onDelete={jest.fn()} onCarry={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '+ Add item' }));
  fireEvent.change(screen.getByLabelText('Component'), { target: { value: 'CRM' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  expect(await screen.findByText('This week is finalized - reopen it to edit')).toBeTruthy();
  expect(screen.getByLabelText('Component').value).toBe('CRM');
});

test('Cancel closes the bubble without saving', () => {
  const onAdd = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByLabelText('Component')).toBeNull();
  expect(onAdd).not.toHaveBeenCalled();
});

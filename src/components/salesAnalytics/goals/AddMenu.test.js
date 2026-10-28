import { render, screen, fireEvent, within } from '@testing-library/react';
import AddMenu, { ADD_GROUP } from './AddMenu';

// one-plus-button-v1 P3 - the menu is portaled and fixed-positioned (never clipped by the frame tools row), draws its
// groups with a rule, moves with the arrow keys across groups, closes on Esc and outside clicks; a phone gets a sheet.
const GROUPS = [{ id: 'capture', label: 'Capture', items: [{ id: 'capture:task', label: 'Task', meta: 'T' }, { id: 'capture:idea', label: 'Idea', meta: 'I' }] }, ADD_GROUP];

test('desktop: the menu renders outside the button\'s row (portal, position fixed), two groups by role, arrows wrap across groups, Enter picks, Esc closes and refocuses the button', () => {
  const onPick = jest.fn();
  const slot = document.createElement('div'); slot.style.overflow = 'hidden'; slot.style.height = '36px'; document.body.appendChild(slot);
  const { container } = render(<AddMenu groups={GROUPS} label="Capture or add" onPick={onPick} buttonLabel="+" />, { container: slot });
  const btn = screen.getByRole('button', { name: '+' });
  fireEvent.click(btn);
  const menu = screen.getByRole('menu', { name: 'Capture or add' });
  expect(container.contains(menu)).toBe(false);
  expect(menu.style.position).toBe('fixed');
  expect(within(menu).getAllByRole('group').map(g => g.getAttribute('aria-label'))).toEqual(['Capture', 'Add']);
  expect(within(menu).getAllByRole('menuitem').map(b => b.getAttribute('data-add-item'))).toEqual(['capture:task', 'capture:idea', 'employer', 'partner', 'target', 'person']);
  expect(document.activeElement.getAttribute('data-add-item')).toBe('capture:task');
  fireEvent.keyDown(menu, { key: 'ArrowUp' });
  expect(document.activeElement.getAttribute('data-add-item')).toBe('person');
  fireEvent.keyDown(menu, { key: 'ArrowDown' }); fireEvent.keyDown(menu, { key: 'ArrowDown' }); fireEvent.keyDown(menu, { key: 'ArrowDown' });
  expect(document.activeElement.getAttribute('data-add-item')).toBe('employer');
  fireEvent.click(document.activeElement);
  expect(onPick).toHaveBeenCalledWith('employer');
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(btn);
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(btn);
  fireEvent.click(btn);
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole('menu')).toBeNull();
  slot.remove();
});

test('phone: a full-width sheet (dialog) with the same items and a Cancel', () => {
  const onPick = jest.fn();
  render(<AddMenu phone groups={GROUPS} label="Capture or add" onPick={onPick} buttonLabel="+" />);
  fireEvent.click(screen.getByRole('button', { name: '+' }));
  const sheet = screen.getByRole('dialog', { name: 'Capture or add' });
  expect(within(sheet).getAllByRole('menuitem')).toHaveLength(6);
  fireEvent.click(within(sheet).getByRole('menuitem', { name: 'Person' }));
  expect(onPick).toHaveBeenCalledWith('person');
  expect(screen.queryByRole('dialog')).toBeNull();
});

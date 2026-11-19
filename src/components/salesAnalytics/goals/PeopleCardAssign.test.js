import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { PeopleCard } from './CompanyPanelSections';
import { goalsApi } from './goalsApi';

jest.mock('./goalsApi', () => ({ goalsApi: { assignPerson: jest.fn(), undoPersonEvent: jest.fn() } }));
jest.mock('../huddleApi', () => ({ unlinkProspect: jest.fn() }));

// person-owner-v1 O3 - the company window's People card: each person row with a key shows the PERSON's owner and (for a
// Member) the same Assign control as the People table; a name typed in notes has no key and no control.
const MEMBERS = [{ user_id: 'u1', name: 'Jack Carlson', role: 'owner', color: '#6F8CF0' }, { user_id: 'u2', name: 'Cyrus Test', role: 'member', color: '#C97626' }];
const detail = { people: [
  { id: 'p:c1', person_key: 'prospect:c1', owner_user_id: 'u1', contact_id: 'c1', name: 'Ana Buyer', title: 'VP People', linkedin_url: null, source: 'apollo', signal: null },
  { id: 'sp1', person_key: 'person:sp1', owner_user_id: null, contact_id: null, name: 'Bo Visitor', title: null, linkedin_url: null, source: 'upload', source_kind: 'web_visit', note: 'Identified visitor', signal: null },
  { id: 'champion', contact_id: null, name: 'Typed Name', title: 'Champion', linkedin_url: null, source: 'notes', signal: null },
] };
const row = { type: 'employer', id: 'o1', name: 'Acme Health' };

test('People card: owners shown; the row\'s Owner cell opens the same listbox; Assign posts expect = the owner shown, shows at once and says so on the done line (not the window\'s toast); the typed name has no control; a Viewer reads only', async () => {
  const onToast = jest.fn(), onChanged = jest.fn();
  goalsApi.assignPerson.mockResolvedValue({ person: {}, event: { id: 'e1' } });
  const { unmount } = render(<PeopleCard businessId="b1" row={row} detail={detail} canEdit members={MEMBERS} onForm={jest.fn()} onChanged={onChanged} onToast={onToast} />);
  expect([...document.querySelectorAll('[data-owner]')].map(el => el.textContent)).toEqual(['Jack', '—']);
  expect(screen.queryByRole('button', { name: 'Assign Typed Name' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Assign Bo Visitor' }));
  const box = screen.getByRole('listbox', { name: 'Assign Bo Visitor' });
  expect(within(box).getAllByRole('option').map(b => `${b.textContent}:${b.getAttribute('aria-selected')}`)).toEqual(['JackOwner:false', 'CyrusMember:false', 'Unassigned:true']);
  fireEvent.click(within(box).getByRole('option', { name: /^Cyrus/ }));
  expect(goalsApi.assignPerson).toHaveBeenCalledWith('b1', 'person:sp1', { owner_user_id: 'u2', expect: { owner_user_id: null } });
  expect([...document.querySelectorAll('[data-owner]')].map(el => el.textContent)).toEqual(['Jack', 'Cyrus']);
  expect(await screen.findByText('Bo Visitor assigned to Cyrus.')).toBeInTheDocument();
  expect(document.querySelector('[data-assign-done] [data-assign-undo]').textContent).toBe('Undo 10 s');
  expect(onToast).not.toHaveBeenCalled();
  expect(onChanged).toHaveBeenCalled();
  goalsApi.undoPersonEvent.mockResolvedValue({});
  fireEvent.click(screen.getByRole('button', { name: /^Undo/ }));
  expect(await screen.findByText('Undone. Bo Visitor is unassigned again.')).toBeInTheDocument();
  expect(goalsApi.undoPersonEvent).toHaveBeenCalledWith('b1', 'e1');
  unmount();
  render(<PeopleCard businessId="b1" row={row} detail={detail} canEdit={false} members={MEMBERS} onForm={jest.fn()} onChanged={jest.fn()} onToast={jest.fn()} />);
  expect([...document.querySelectorAll('[data-owner]')].map(el => el.textContent)).toEqual(['Jack', '—']);
  expect(document.querySelector('[data-assign]')).toBeNull();
});

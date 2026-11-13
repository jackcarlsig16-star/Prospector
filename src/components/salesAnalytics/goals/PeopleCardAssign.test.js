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

test('People card: owners shown; Assign posts expect = the owner shown and shows at once; the typed name has no control; a Viewer reads only', async () => {
  const onToast = jest.fn(), onChanged = jest.fn();
  goalsApi.assignPerson.mockResolvedValue({ person: {}, event: { id: 'e1' } });
  const { unmount } = render(<PeopleCard businessId="b1" row={row} detail={detail} canEdit members={MEMBERS} onForm={jest.fn()} onChanged={onChanged} onToast={onToast} />);
  expect([...document.querySelectorAll('[data-owner]')].map(el => el.textContent)).toEqual(['Jack', '—']);
  expect(screen.queryByRole('button', { name: 'Assign Typed Name' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Assign Bo Visitor' }));
  const menu = screen.getByRole('menu', { name: 'Assign Bo Visitor' });
  expect(within(menu).getAllByRole('menuitemradio').map(b => b.textContent.replace('✓', ''))).toEqual(['Jack', 'Cyrus', 'Unassigned']);
  fireEvent.click(within(menu).getByRole('menuitemradio', { name: /^Cyrus/ }));
  expect(goalsApi.assignPerson).toHaveBeenCalledWith('b1', 'person:sp1', { owner_user_id: 'u2', expect: { owner_user_id: null } });
  expect([...document.querySelectorAll('[data-owner]')].map(el => el.textContent)).toEqual(['Jack', 'Cyrus']);
  await waitFor(() => expect(onToast).toHaveBeenCalledWith(expect.objectContaining({ text: 'Bo Visitor assigned to Cyrus', undo: expect.any(Function) })));
  expect(onChanged).toHaveBeenCalled();
  unmount();
  render(<PeopleCard businessId="b1" row={row} detail={detail} canEdit={false} members={MEMBERS} onForm={jest.fn()} onChanged={jest.fn()} onToast={jest.fn()} />);
  expect([...document.querySelectorAll('[data-owner]')].map(el => el.textContent)).toEqual(['Jack', '—']);
  expect(document.querySelector('[data-assign]')).toBeNull();
});

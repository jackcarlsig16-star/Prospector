import { render, screen } from '@testing-library/react';
import OwnerPill from './OwnerPill';
import LogTouchForm from './goals/partners/LogTouchForm';

test('the pill shows team, co-owner and one-owner; nothing when ownership was never set', () => {
  const { container, rerender } = render(<OwnerPill row={{ owner_team: null }} />);
  expect(container).toBeEmptyDOMElement();
  rerender(<OwnerPill row={{ owner_team: 'upside', co_owner_name: 'Brad', no_double_touch: true }} />);
  expect(screen.getByText('Upside · Brad · one owner')).toHaveAttribute('title', "Owner: Upside, co-owner Brad - don't double-touch");
});

test('logging a touch on an account Upside owns with no double-touch warns but does not block', () => {
  const partner = { id: 'p1', name: 'Gallagher', pipeline_status: 'replied', owner_team: 'upside', co_owner_name: 'Brad', no_double_touch: true };
  const { rerender } = render(<LogTouchForm partner={partner} names={[]} onSubmit={jest.fn()} onClose={jest.fn()} />);
  expect(screen.getByRole('note')).toHaveTextContent("Upside owns this (Brad) - don't double-touch");
  expect(screen.getByRole('button', { name: 'Log touch' })).toBeEnabled();
  rerender(<LogTouchForm partner={{ ...partner, owner_team: 'homelover' }} names={[]} onSubmit={jest.fn()} onClose={jest.fn()} />);
  expect(screen.queryByRole('note')).not.toBeInTheDocument();
});

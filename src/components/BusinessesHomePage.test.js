import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import BusinessesHomePage from './BusinessesHomePage';
import { getAccountsForBusiness } from '../utils/db';
import { goalsApi } from './salesAnalytics/goals/goalsApi';

jest.mock('../utils/db', () => ({ getAccountsForBusiness: jest.fn() }));
jest.mock('./salesAnalytics/goals/goalsApi', () => ({ goalsApi: { partnerEvents: jest.fn(), weekGoals: jest.fn() }, OPEN_TASKS: 'x', TODOS_CHANGED: 'y', OPEN_GOALS_WEEK: 'z' }));

const B = [
  { id: 's', name: 'Sales Co', tagline: 'Outreach', color: '#6F8CF0', features: { goals_sales: true } },
  { id: 'p', name: 'Plain Co', color: '#C97626' },
  { id: 'e', name: 'Empty Co', research_status: 'researching' },
];
const page = (businesses = B, props = {}) => render(<BusinessesHomePage businesses={businesses} loading={false} onSelect={() => {}} onCreated={() => {}} {...props} />);

beforeEach(() => {
  goalsApi.partnerEvents.mockResolvedValue([
    { id: 1, goal_id: 'g1', event: 'status', to_status: 'first_email_sent' },
    { id: 2, goal_id: 'g1', event: 'status', to_status: 'replied' },
    { id: 3, goal_id: 'g2', event: 'note' },
  ]);
  goalsApi.weekGoals.mockResolvedValue([{ id: 't1', status: 'open', steps: [] }, { id: 't2', status: 'done', steps: [] }, { id: 't3', status: 'open', steps: [] }]);
  getAccountsForBusiness.mockImplementation(id => Promise.resolve(id === 'p'
    ? [{ id: 'a', lastTouchedAt: '2026-09-30T17:00:00Z' }, { id: 'b', lastTouchedAt: '2026-08-01T00:00:00Z' }]
    : []));
});

test('kit header, one live line per card, no stat tiles', async () => {
  page();
  expect(screen.getByRole('heading', { level: 1, name: 'Workspaces' })).toBeTruthy();
  expect(await screen.findByText('1 partner touched this week · 2 tasks due')).toBeTruthy();
  expect(screen.getByText(/^last activity Sep 30/)).toBeTruthy();
  expect(screen.getByText('no sales module')).toBeTruthy();
  expect(screen.getByText('Researching…')).toBeTruthy();
  for (const t of ['Total Accounts', 'Accounts At Risk', 'Still Researching']) expect(screen.queryByText(t)).toBeNull();
  expect(goalsApi.partnerEvents).toHaveBeenCalledTimes(1);
  expect(goalsApi.partnerEvents.mock.calls[0][0]).toBe('s');
});

test('a refused sales read falls back to the accounts line', async () => {
  goalsApi.partnerEvents.mockRejectedValue(new Error('Forbidden'));
  page([B[0]]);
  expect(await screen.findByText('no sales module')).toBeTruthy();
});

test('cards select; + New Business is a header button that opens and closes the modal', async () => {
  const onSelect = jest.fn();
  page(B, { onSelect });
  fireEvent.click(screen.getByRole('button', { name: /Plain Co/ }));
  expect(onSelect).toHaveBeenCalledWith(B[1]);
  const btn = screen.getByRole('button', { name: '+ New Business' });
  expect(document.querySelector('[data-workspace-grid]').contains(btn)).toBe(false);
  fireEvent.click(btn);
  expect(screen.getByText('New business')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByText('New business')).toBeNull();
  await screen.findByText('no sales module');
});

test('empty state', () => {
  page([]);
  expect(screen.getByText('No workspaces yet')).toBeTruthy();
  expect(screen.getByText('0 workspaces')).toBeTruthy();
});

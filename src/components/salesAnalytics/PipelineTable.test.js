import { render, screen, fireEvent } from '@testing-library/react';
import PipelineTable from './PipelineTable';
import { isEmployer } from './goals/EmployersView';

const opps = [
  { id: 'a', organization: 'Marriott International', org_type: 'employer', stage: 'nurture', tier: '1', owner_team: 'upside', co_owner_name: 'Brad', cohort: 'Hospitality', probability: null },
  { id: 'b', organization: '24 Hour Fitness', org_type: 'employer', stage: 'meeting', tier: null, owner_team: 'homelover', probability: null },
];

test('a Viewer sees stage, tier and the owner pill as text, with no add, import, star or row edits', () => {
  render(<PipelineTable businessId="b1" opportunities={opps} canEdit={false} />);
  expect(screen.queryByText('Add opportunity')).toBeNull();
  expect(screen.queryByText('Import CSV')).toBeNull();
  expect(screen.queryByText('Template')).toBeNull();
  expect(document.querySelectorAll('tbody select, tbody input')).toHaveLength(0);
  expect(document.querySelector('tbody').textContent).toContain('Nurture');
  expect(screen.getByText('T1')).toBeTruthy();
  expect(screen.getByText('Upside · Brad')).toBeTruthy();
  fireEvent.click(screen.getByText('Marriott International'));
  expect(screen.queryByText('Edit opportunity')).toBeNull();
});

test('a member keeps the editing controls and the stage list offers the side lanes', () => {
  render(<PipelineTable businessId="b1" opportunities={opps} />);
  expect(screen.getByText('Add opportunity')).toBeTruthy();
  const select = document.querySelector('tbody select');
  expect([...select.options].map(o => o.textContent)).toEqual(expect.arrayContaining(['Nurture', 'On hold']));
  fireEvent.click(screen.getByText('24 Hour Fitness'));
  expect(screen.getByText('Edit opportunity')).toBeTruthy();
});

test('Employers lists employer and membership rows only', () => {
  expect([{ org_type: 'employer' }, { org_type: 'membership' }, { org_type: 'channel_partner' }].filter(isEmployer)).toHaveLength(2);
});

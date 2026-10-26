import { workspaceNav, homePage } from './businessNav';

// actions-home-attention-v1 Stage 1 (D1) - a goals_sales workspace opens on Sales & Marketing and has no Command Center
// in its side panel; every other workspace is unchanged.
const sales = { id: 'b1', features: { goals_sales: true } };
const plain = { id: 'b2', features: {} };

test('home: goals_sales -> Sales & Marketing; otherwise (or no features) Command Center', () => {
  expect(homePage(sales)).toBe('sales-analytics');
  expect(homePage(plain)).toBe('command-center');
  expect(homePage({ id: 'b3' })).toBe('command-center');
  expect(homePage({ id: 'b4', features: { goals_sales: false } })).toBe('command-center');
});

// hkos-project-shell-v1 S1 - hk_sales opens the Sales OS shell; goals_sales still wins and is unchanged.
test('home: hk_sales -> the Sales OS shell; goals_sales result unchanged; neither -> Command Center', () => {
  expect(homePage({ id: 'h1', features: { hk_sales: true } })).toBe('hk-sales');
  expect(homePage({ id: 'h2', features: { goals_sales: true, hk_sales: true } })).toBe('sales-analytics');
  expect(homePage({ id: 'h3', features: { hk_sales: false } })).toBe('command-center');
  expect(workspaceNav({ id: 'h1', features: { hk_sales: true } }).map(n => n.id)).toEqual(['command-center', 'hk-sales', 'accounts', 'projects', 'overview', 'ideas', 'tools']);
});

test('side panel: Command Center off and Sales & Marketing first for goals_sales; unchanged without it; empty with no workspace', () => {
  expect(workspaceNav(sales).map(n => n.id)).toEqual(['sales-analytics', 'accounts', 'projects', 'overview', 'ideas', 'tools']);
  expect(workspaceNav(plain).map(n => n.id)).toEqual(['command-center', 'accounts', 'projects', 'overview', 'ideas', 'tools']);
  expect(workspaceNav(null)).toEqual([]);
});

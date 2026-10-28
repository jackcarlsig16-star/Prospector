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
});

// hk-legacy-cleanup-v1 Stage 2 (R2) - an hk_sales workspace shows the Sales OS only; the six legacy pages hide
// there (hiddenWith as a string or an array) and every other workspace is unchanged.
test('side panel: hk_sales -> exactly [hk-sales]; hk_sales off or absent -> the legacy pages are back', () => {
  expect(workspaceNav({ id: 'h1', features: { hk_sales: true } }).map(n => n.id)).toEqual(['hk-sales']);
  expect(workspaceNav({ id: 'h2', features: { goals_sales: true, hk_sales: true } }).map(n => n.id)).toEqual(['sales-analytics', 'hk-sales']);
  expect(workspaceNav({ id: 'h3', features: { hk_sales: false } }).map(n => n.id)).toEqual(['command-center', 'accounts', 'projects', 'overview', 'ideas', 'tools']);
  expect(workspaceNav(sales).map(n => n.id)).toEqual(['sales-analytics', 'projects', 'overview', 'ideas', 'tools']); // C5: no Accounts with goals_sales
  expect(workspaceNav(plain).map(n => n.id)).toEqual(['command-center', 'accounts', 'projects', 'overview', 'ideas', 'tools']);
});

test('side panel: Command Center off and Sales & Marketing first for goals_sales; unchanged without it; empty with no workspace', () => {
  expect(workspaceNav(sales).map(n => n.id)).toEqual(['sales-analytics', 'projects', 'overview', 'ideas', 'tools']); // C5: no Accounts with goals_sales
  expect(workspaceNav(plain).map(n => n.id)).toEqual(['command-center', 'accounts', 'projects', 'overview', 'ideas', 'tools']);
  expect(workspaceNav(null)).toEqual([]);
});

test('visual-nav-cleanup-v1 C5: Accounts (the legacy lists) shows only on the accounts model - hidden with goals_sales or hk_sales', () => {
  const ids = f => workspaceNav({ id: 'x', features: f }).map(n => n.id);
  expect(ids({})).toContain('accounts');
  expect(ids({ goals_sales: true })).not.toContain('accounts');
  expect(ids({ hk_sales: true })).not.toContain('accounts');
  expect(ids({ goals_sales: true })).toEqual(['sales-analytics', 'projects', 'overview', 'ideas', 'tools']);
});

import { render, screen } from '@testing-library/react';
import TypeChip, { typeChipOf, typeSortValue } from './TypeChip';
import { PARTNER_TYPE_COLORS } from '../palette';

// FIX pipeline-type-pills-v1 - one chip per row type: partners by family
// label + hue, uncategorized neutral "Partner", employer accent, target /
// Apollo grey. ui-clarity-v1 R5: every chip is the kit Tag (wash + dot +
// word, never a border). jsdom drops var() and color-mix() declarations, so
// the hue is read from --type-chip-hue.
const hue = el => el.style.getPropertyValue('--type-chip-hue');
const partner = category => ({ type: 'partner', category });
const CASES = [
  ['1. Current partners', 'current', '★ Current'], ['2. Marketplaces', 'platforms', 'Platforms'], ['4. Mid-Market Benefits Brokers', 'brokers', 'Brokers & PEOs'],
  ['5. Rental Rewards', 'renters', 'Renters & FW'], ['12. Public sector', 'influence', 'Influence'], ['14. Co-opetition', 'professional', 'Professional'],
];

test('each partner family renders its short label in its PARTNER_TYPE_COLORS hue with the full name on hover', () => {
  for (const [category, id, label] of CASES) {
    const { unmount } = render(<TypeChip row={partner(category)} />);
    const chip = screen.getByText(label);
    expect(chip).toHaveAttribute('data-type-chip', id);
    expect(hue(chip)).toBe(PARTNER_TYPE_COLORS[id]);
    expect(chip.title).toMatch(/ · partner$/);
    unmount();
  }
  expect(typeChipOf(partner('1. Current partners')).label.startsWith('★')).toBe(true);
});

test('uncategorized partner -> "Partner" in the neutral token; employer -> accent "Employer"; target / Apollo grey; every chip is a kit Tag with a dot and no border', () => {
  render(<div><TypeChip row={partner(null)} /><TypeChip row={{ type: 'employer' }} /><TypeChip row={{ type: 'target' }} /><TypeChip row={{ type: 'apollo' }} /></div>);
  const none = screen.getByText('Partner');
  expect(none).toHaveAttribute('data-type-chip', 'partner'); expect(hue(none)).toBe('var(--sa-neutral)'); expect(none.title).toBe('Uncategorized · partner');
  const emp = screen.getByText('Employer');
  expect(hue(emp)).toBe('var(--ui-accent, var(--sa-accent))');
  for (const [label, color] of [['Target', 'var(--sa-neutral)'], ['Apollo', 'var(--sa-faint)']]) {
    const chip = screen.getByText(label);
    expect(hue(chip)).toBe(color);
  }
  for (const chip of document.querySelectorAll('[data-type-chip]')) {
    expect(chip).toHaveClass('ui-tag');
    expect(chip.querySelector('.ui-tag__dot')).not.toBeNull();
    expect(chip.style.border).toBe('');
  }
});

test('the employer label differs from every partner label and no partner hue is a member color', () => {
  const partnerLabels = [...CASES.map(c => c[2]), 'Partner'];
  expect(partnerLabels).not.toContain('Employer');
  for (const [, id] of CASES) expect(['#6F8CF0', '#C97626']).not.toContain(PARTNER_TYPE_COLORS[id]);
});

test('sorting by Type groups partners by family (Current first, uncategorized last), then employers, targets, Apollo', () => {
  const rows = [{ type: 'apollo' }, { type: 'target' }, partner(null), { type: 'employer' }, partner('4. Brokers'), partner('2. Marketplaces'), partner('1. Current')];
  const sorted = [...rows].sort((a, b) => typeSortValue(a).localeCompare(typeSortValue(b)));
  expect(sorted.map(r => typeChipOf(r).label)).toEqual(['★ Current', 'Platforms', 'Brokers & PEOs', 'Partner', 'Employer', 'Target', 'Apollo']);
});

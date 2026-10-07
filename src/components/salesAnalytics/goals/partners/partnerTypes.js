import { PARTNER_TYPE_COLORS } from '../../palette';

// sales-partners-workflow-v1 (PROPOSED/REVISABLE): 14 categories -> 6 type
// families, keyed by the category's number prefix ("5. Rental Rewards…").
export const FAMILIES = [
  { id: 'current', label: 'Current partners', cats: [1], mark: '★' },
  { id: 'platforms', label: 'Platforms & marketplaces', cats: [2, 7, 8] },
  { id: 'brokers', label: 'Brokers, consultants & PEOs', cats: [3, 4, 6] },
  { id: 'renters', label: 'Renters & financial wellness', cats: [5, 9] },
  { id: 'influence', label: 'Influence & public sector', cats: [10, 12, 13] },
  { id: 'professional', label: 'Professional & co-opetition', cats: [11, 14] },
].map(f => ({ ...f, color: PARTNER_TYPE_COLORS[f.id] }));

export const categoryNumber = category => { const m = /^(\d+)\./.exec(category || ''); return m ? Number(m[1]) : null; };
export const categoryName = category => (category || 'Uncategorized').replace(/^\d+\.\s*/, '');
const UNKNOWN = { id: 'none', label: 'Uncategorized', color: 'var(--sa-neutral)' };
export const familyOf = category => FAMILIES.find(f => f.cats.includes(categoryNumber(category))) || UNKNOWN;

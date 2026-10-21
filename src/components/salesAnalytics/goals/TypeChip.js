import '../../../ui/kitTheme';
import { FAMILIES, familyOf } from './partners/partnerTypes';

// FIX pipeline-type-pills-v1 - the Type chip a board row wears (Pipeline
// table, phone list, partner quick panel). A partner shows its partner TYPE
// (partnerTypes.js family) in that family's PARTNER_TYPE_COLORS hue; an
// employer wears the kit accent; target, Apollo, visitor and signal the
// neutral / faint greys. ui-clarity-v1 R5: the kit Tag look - a wash of the
// hue, a dot, the word, no border and no pointer, so it never reads as a
// button. The word is always there and Current keeps its star, so color is
// never the only signal. The hue rides in --type-chip-hue (like the table's
// --ui-row-bar) so tests and devtools can read it; jsdom drops var() /
// color-mix() declarations.
const SHORT = { current: '★ Current', platforms: 'Platforms', brokers: 'Brokers & PEOs', renters: 'Renters & FW', influence: 'Influence', professional: 'Professional' };
const ACCENT = 'var(--ui-accent, var(--sa-accent))';

export function typeChipOf(row) {
  if (row.type === 'partner') {
    const fam = familyOf(row.category);
    if (fam.id === 'none') return { id: 'partner', label: 'Partner', title: 'Uncategorized · partner', color: 'var(--sa-neutral)' };
    return { id: fam.id, label: SHORT[fam.id], title: `${fam.label} · partner`, color: fam.color };
  }
  if (row.type === 'employer') return { id: 'employer', label: 'Employer', title: 'Employer', color: ACCENT };
  if (row.type === 'apollo') return { id: 'apollo', label: 'Apollo', title: 'Sequenced in Apollo, not on the board yet', color: 'var(--sa-faint)' };
  // sales-ia-v2: companies no record carries yet - the faint grey.
  if (row.type === 'visitor') return { id: 'visitor', label: 'Visitor', title: 'Visited the website, not in the pipeline yet', color: 'var(--sa-faint)' };
  if (row.type === 'signal') return { id: 'signal', label: 'Signal', title: 'Scout signal, not in the pipeline yet', color: 'var(--sa-faint)' };
  return { id: 'target', label: 'Target', title: 'Target', color: 'var(--sa-neutral)' };
}

// Sorting the Type column groups partners by type (family order, then
// uncategorized), then employers, targets, Apollo, visitors, signals.
const GROUP = { employer: 1, target: 2, apollo: 3, visitor: 4, signal: 5 };
export function typeSortValue(row) {
  const c = typeChipOf(row);
  if (row.type !== 'partner') return `${GROUP[row.type] ?? 6} ${c.label}`;
  const i = FAMILIES.findIndex(f => f.id === c.id);
  return `0.${i === -1 ? 9 : i} ${c.label}`;
}

export default function TypeChip({ row, style }) {
  const c = typeChipOf(row);
  return (
    <span data-type-chip={c.id} className="ui-tag" title={c.title} style={{ '--type-chip-hue': c.color, '--tag-color': 'var(--type-chip-hue)', fontSize: 11, letterSpacing: '0.02em', ...style }}>
      <span className="ui-tag__dot" aria-hidden="true" />{c.label}
    </span>
  );
}

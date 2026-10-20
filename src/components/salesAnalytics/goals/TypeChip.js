import { saSans } from '../theme';
import { FAMILIES, familyOf } from './partners/partnerTypes';

// FIX pipeline-type-pills-v1 - the Type pill a board row wears (Pipeline
// table, phone list, partner quick panel). A partner shows its partner TYPE
// (partnerTypes.js family) in that family's PARTNER_TYPE_COLORS hue; an
// employer wears the kit accent, muted; target and Apollo are outlined. The
// word is always on the pill and Current keeps its star, so color is never
// the only signal. Glow-not-fill: thin border in the hue, 10% wash. The hue
// rides in --type-chip-hue (like the table's --ui-row-bar) so tests and
// devtools can read it; jsdom drops var() / color-mix() declarations.
const SHORT = { current: '★ Current', platforms: 'Platforms', brokers: 'Brokers & PEOs', renters: 'Renters & FW', influence: 'Influence', professional: 'Professional' };
const ACCENT = 'var(--ui-accent, var(--sa-accent))';

export function typeChipOf(row) {
  if (row.type === 'partner') {
    const fam = familyOf(row.category);
    if (fam.id === 'none') return { id: 'partner', label: 'Partner', title: 'Uncategorized · partner', color: 'var(--sa-neutral)', wash: true, border: 45 };
    return { id: fam.id, label: SHORT[fam.id], title: `${fam.label} · partner`, color: fam.color, wash: true, border: 45 };
  }
  if (row.type === 'employer') return { id: 'employer', label: 'Employer', title: 'Employer', color: ACCENT, wash: true, border: 27 };
  if (row.type === 'apollo') return { id: 'apollo', label: 'Apollo', title: 'Sequenced in Apollo, not on the board yet', color: 'var(--sa-faint)', wash: false, border: 45 };
  // sales-ia-v2: companies no record carries yet - outlined, faint, never a fill.
  if (row.type === 'visitor') return { id: 'visitor', label: 'Visitor', title: 'Visited the website, not in the pipeline yet', color: 'var(--sa-faint)', wash: false, border: 45 };
  if (row.type === 'signal') return { id: 'signal', label: 'Signal', title: 'Scout signal, not in the pipeline yet', color: 'var(--sa-faint)', wash: false, border: 45 };
  return { id: 'target', label: 'Target', title: 'Target', color: 'var(--sa-neutral)', wash: false, border: 45 };
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
    <span data-type-chip={c.id} title={c.title} style={{ ...saSans, '--type-chip-hue': c.color, display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 8px', borderRadius: 999, fontSize: 11, fontWeight: 500, letterSpacing: '0.02em', lineHeight: 1, whiteSpace: 'nowrap', verticalAlign: 'middle',
      color: 'var(--type-chip-hue)', border: `1px solid color-mix(in srgb, var(--type-chip-hue) ${c.border}%, transparent)`, background: c.wash ? 'color-mix(in srgb, var(--type-chip-hue) 10%, transparent)' : 'transparent', ...style }}>
      {c.label}
    </span>
  );
}

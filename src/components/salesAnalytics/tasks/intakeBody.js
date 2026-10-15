// call-notes-targets-v1 - what Accept sends: the ticked rows of each Intake
// section, trimmed to the fields the server re-checks. A row that hangs off
// a new company only goes when that company is ticked as a target (that's
// where it would be written).

export const isSkipped = c => !c.on || c.action === 'skip' || c.action === 'none';

export function acceptBody({ companies, ownership, people, touches, facts }) {
  const ticked = companies.filter(c => !isSkipped(c));
  const targets = new Set(ticked.filter(c => c.action.startsWith('target_')).map(c => c.key));
  const reachable = x => !!x.match || targets.has(x.company_key);
  return {
    companies: ticked.map(({ key, name, kind, action, match, category, evidence }) => ({ key, name, kind, action, match, category, evidence })),
    ownership: ownership.filter(o => o.on && reachable(o))
      .map(({ company_key, match, owner_team, co_owner_name, no_double_touch, owner_name }) => ({ company_key, match, owner_team, co_owner_name, no_double_touch, owner_name })),
    people: people.filter(p => p.on && p.dest && reachable(p))
      .map(({ company_key, match, name, title, role, moved_from, moved_from_match }) => ({ company_key, match, name, title, role, moved_from, moved_from_match })),
    touches: touches.filter(t => t.on && !t.kept_with_note)
      .map(({ key, match, touch_type, people: who, date, evidence, stage, stage_on }) => ({ key, match, touch_type, people: who, date, evidence, stage, stage_on: !!stage && stage_on, expect: match.pipeline_status })),
    facts: facts.filter(f => f.on && f.column && reachable(f))
      .map(({ company_key, match, field, text, due_date }) => ({ company_key, match, field, text, due_date })),
  };
}

export const acceptCount = body => Object.values(body).reduce((n, l) => n + l.length, 0);

// Rows whose company is a new name the person has since skipped can't be
// written anywhere - the review greys them out.
export function orphaned(x, companies) {
  if (x.match || !x.company_key) return false;
  const c = companies.find(k => k.key === x.company_key);
  return !c || isSkipped(c) || !c.action.startsWith('target_');
}

// One line for the toast after Accept, e.g. "3 tasks · 2 targets · 1 touch".
const count = (k, one, many = `${one}s`) => (k ? `${k} ${k === 1 ? one : many}` : null);
export function acceptSummary(n, out) {
  const moves = out.stage_moves || [];
  const refused = moves.filter(m => !m.ok);
  return [
    count(n, 'task'), count((out.targets || []).length, 'target'),
    count((out.contacts?.added || 0) + (out.contacts?.updated || 0), 'person', 'people'),
    count((out.touches || []).length, 'touch', 'touches'), count(moves.length - refused.length, 'stage move'),
    count(out.ownership || 0, 'owner change'), count(out.intel || 0, 'intel line'), count((out.opportunities_created || []).length, 'pipeline add'),
    refused.length ? `${refused.map(m => m.partner).join(', ')}: stage not moved (${refused[0].error})` : null,
  ].filter(Boolean).join(' · ') || 'Saved';
}

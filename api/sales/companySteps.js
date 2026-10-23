// company-workflow-v1 W1 - the company window's guided steps, computed in one place (pure: the record and what the
// detail already read come in, nothing is read here). Order: Research -> Confirm site -> Size & type -> Owner ->
// Add to pipeline -> First touch. A step is done | next | todo | skip | running; exactly one is next (the first not
// done, not skipped, not running), and when none is left the window reads "Ready". Actions / Pipeline can show the
// same next step later from this function.
export const STEPS = [['research', 'Research'], ['site', 'Confirm site'], ['size', 'Size & type'], ['owner', 'Owner'], ['add', 'Add to pipeline'], ['touch', 'First touch']];
export const RESEARCH_FRESH_DAYS = 90; // REVISABLE
// Partner categories whose reach (employees covered across clients, client count) is asked for in Size & type:
// 2 perk / benefit platforms, 3 PEOs, 7 HR / payroll / HRIS, 8 benefits admin (Jack, 2026-10-23).
export const REACH_CATEGORIES = [2, 3, 7, 8];
const categoryNumber = c => { const m = /^(\d+)\./.exec(c || ''); return m ? Number(m[1]) : null; };
export const needsReach = record => record.type === 'partner' && REACH_CATEGORIES.includes(categoryNumber(record.category));
const fmt = n => Number(n).toLocaleString('en-US');
const SOURCE_WORD = { research: 'Research', manual: 'Typed' };

// record: the detail's record (type, employees, employees_source, reach_*, owner_user_id, owner, category, last_touch_at,
// last_touch); research: { runs } | null; site: { domain, confirmed } | null; owner: the owner person's name | null.
export function companySteps({ record, research = null, site = null, ownerName = null, now = Date.now() }) {
  const type = record.type;
  const inPipeline = type === 'partner' || type === 'employer';
  const runs = research?.runs || [];
  const running = runs.some(r => r.status === 'running');
  const done = runs.find(r => r.status === 'done');
  const fresh = done && now - Date.parse(done.created_at) <= RESEARCH_FRESH_DAYS * 864e5;
  const reach = needsReach(record);
  const hasSize = record.employees != null && (!reach || record.reach_employees != null || record.reach_clients != null);
  const touchedAt = record.last_touch?.at || record.last_touch_at || null;

  const state = {
    research: running ? 'running' : fresh ? 'done' : 'open',
    // Only a partner has a site to confirm (partner_domains); nothing found = nothing to confirm.
    site: type !== 'partner' || !site?.domain ? 'skip' : site.confirmed ? 'done' : 'open',
    size: hasSize ? 'done' : 'open',
    owner: (type === 'partner' || type === 'employer' || type === 'target') && record.owner_user_id ? 'done' : 'open',
    // A visitor / Apollo-only row is added; a target is promoted to partner or employer.
    add: inPipeline ? 'skip' : 'open',
    touch: !inPipeline ? 'skip' : touchedAt ? 'done' : 'open',
  };
  const value = {
    research: done ? `Researched ${String(done.created_at).slice(0, 10)}` : null,
    site: site?.domain || null,
    size: [record.employees != null && `${fmt(record.employees)} employees${SOURCE_WORD[record.employees_source] ? ` · ${SOURCE_WORD[record.employees_source]}` : ''}`,
      reach && record.reach_employees != null && `covers ${fmt(record.reach_employees)}`, reach && record.reach_clients != null && `${fmt(record.reach_clients)} clients`].filter(Boolean).join(' · ') || null,
    owner: ownerName,
    add: type === 'target' ? 'Promote to partner or employer' : null,
    touch: touchedAt ? `Last touch ${String(touchedAt).slice(0, 10)}` : null,
  };
  let next = null;
  const steps = STEPS.map(([id, label]) => {
    let status = state[id] === 'open' ? 'todo' : state[id];
    if (status === 'todo' && !next) { next = id; status = 'next'; }
    return { id, label, status, value: value[id], ...(id === 'size' ? { reach } : {}), ...(id === 'research' && !inPipeline && type !== 'target' ? { needs_record: true } : {}) };
  });
  return { steps, next, ready: !next && !running, last_touch_at: touchedAt };
}

// hkos-data-foundation-v1 D6 - the Verdict banner's one source of truth: what each verdict means, its tone, its copy
// and whether a save is blocked, allowed, or allowed only with "Save anyway". Pure, Jest-tested. No em or en dashes.
export const VERDICTS = ['clear', 'warm', 'sponsor', 'do_not_contact', 'owned_by', 'possible_duplicate', 'niche_warning'];
const fmtDate = iso => { if (!iso) return ''; const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };

// v: a brands/check result ({ verdict, match, matches, legacy, warnings, owner_user_id, founder_user_id, last_at }) or a
// brand-detail verdict ({ ok, reason, ... }) normalised through fromDetail(). members: the shell's member list.
export function verdictView(v, { members = [], brandName = '' } = {}) {
  if (!v) return null;
  const who = id => members.find(m => m.user_id === id)?.first_name || 'another founder';
  const matchName = v.match?.name || brandName;
  const overlap = (v.warnings || []).find(w => w.code === 'niche_overlap');
  const base = { verdict: v.verdict, blocks: false, needsForce: false, matchId: v.match?.id || v.matches?.[0]?.id || null, note: overlap ? `Niche overlaps with sponsor ${overlap.sponsor}.` : null };
  switch (v.verdict) {
    case 'clear': return { ...base, tone: 'green', title: 'Clear to contact', line: 'No sponsor, no owner, no open thread.' };
    case 'warm': return { ...base, tone: 'blue', title: `Warm with ${who(v.founder_user_id)}`, line: `They have a thread with this brand${v.last_at ? ` (last ${fmtDate(v.last_at)})` : ''}. Ask them before a cold email.` };
    case 'sponsor': return { ...base, blocks: true, tone: 'block', title: 'Already a sponsor or founding partner', line: `${matchName} is never cold-pitched. Open it from Sponsors.` };
    case 'do_not_contact': return { ...base, blocks: true, tone: 'block', title: 'Do not contact', line: `${matchName} is on the do-not-contact list.` };
    case 'owned_by': return { ...base, needsForce: true, tone: 'orange', title: `Owned by ${who(v.owner_user_id)}`, line: `${matchName} is already in Brands and claimed. Ask them before touching it.` };
    case 'possible_duplicate': {
      const names = [...(v.match ? [v.match.name] : []), ...(v.matches || []).map(m => m.name), ...(v.legacy || []).map(l => `${l.name} (legacy ${l.kind})`)];
      return { ...base, needsForce: true, tone: 'mustard', title: v.exact ? v.headline || 'Already in Grow' : 'Possible duplicate', line: names.length ? `Looks like ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}.` : 'A similar brand exists.' };
    }
    case 'niche_warning': return { ...base, tone: 'mustard', title: `Niche overlap with ${overlap?.sponsor || 'a sponsor'}`, line: 'Not blocked. Mention the overlap before pitching.', note: null };
    case 'max_touches': return { ...base, blocks: true, tone: 'block', title: `Email touches used up (${v.sent} of ${v.max})`, line: 'No more cold, bump or final emails to this brand.' };
    case 'passed': return { ...base, blocks: true, tone: 'grey', title: 'Passed', line: 'This brand said no. Nothing more goes out.' };
    case 'owner_unclear': return { ...base, blocks: true, tone: 'orange', title: 'Owner unclear', line: 'Two founders may both have touched this brand. Settle the owner first.' };
    default: return { ...base, tone: 'grey', title: 'Unknown verdict', line: String(v.verdict || '') };
  }
}

// A brand-detail verdict ({ ok, reason, owner_user_id, founder_user_id, last_at, sent, max, warnings }) in check shape.
export function fromDetail(d) {
  if (!d) return null;
  if (d.ok) return { verdict: d.warnings?.some(w => w.code === 'niche_overlap') ? 'niche_warning' : 'clear', warnings: d.warnings || [] };
  return { verdict: d.reason, owner_user_id: d.owner_user_id, founder_user_id: d.founder_user_id, last_at: d.last_at, sent: d.sent, max: d.max, warnings: d.warnings || [] };
}

// Add brand: Save is blocked on sponsor / do-not-contact, needs "Save anyway" on owned_by / possible_duplicate, and is
// open otherwise (a save before the check finished still goes through the server's own check).
export function saveRule(view, { force = false } = {}) {
  if (!view) return { canSave: true, label: 'Save' };
  if (view.blocks) return { canSave: false, label: 'Save', why: view.title };
  if (view.needsForce) return force ? { canSave: true, label: 'Save anyway' } : { canSave: false, label: 'Save', why: 'Open the match or choose Save anyway.' };
  return { canSave: true, label: 'Save' };
}

export const STATUS_LABELS = { candidate: 'Candidate', claimed: 'Claimed', drafted: 'Drafted', sent: 'Sent', bumped: 'Bumped', final_sent: 'Final sent', replied: 'Replied', meeting: 'Meeting', signed: 'Signed', passed: 'Passed', skipped: 'Skipped', sponsor: 'Sponsor' };
export const RELATIONSHIP_LABELS = { prospect: 'Prospect', sponsor: 'Sponsor', founding_partner: 'Founding partner', do_not_contact: 'Do not contact' };
export const STATUS_TONE = { candidate: 'grey', claimed: 'blue', drafted: 'lilac', sent: 'mustard', bumped: 'mustard', final_sent: 'mustard', replied: 'green', meeting: 'green', signed: 'green', passed: 'block', skipped: 'grey', sponsor: 'green' };
export const RELATIONSHIP_TONE = { prospect: 'grey', sponsor: 'green', founding_partner: 'green', do_not_contact: 'block' };
export const SOURCE_LABELS = { sourced: 'Sourced', user_supplied: 'Added by hand', apollo_list: 'Apollo list', places: 'Places', import: 'Import' };

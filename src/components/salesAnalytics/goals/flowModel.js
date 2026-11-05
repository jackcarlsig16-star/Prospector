import { BAND_WORD } from '../../../constants/fitLevels';
import { MEMBER_COLORS, UNASSIGNED_COLOR } from '../../../constants/memberColors';
import { STAGE_LABELS } from '../pipelineStages';
import { PIPELINE_STATUSES } from '../../../constants/partnerPipeline';
import { md } from './companyPanelFacts';

// homelover-flow-v1 F1 / F5 / F9 - what the account card and the Map show for a record's state (pure, unit-tested):
// the owner chip's color + word, the Intent word, the live partner's Next step text and ONE primary (the first item of
// the flow menu for this state), the flow menu. Nothing here reads a table; every input is the board row + GET
// goals/company / goals/fit.

// F1: a member's fixed color (business_members.member_color via goals/members), else MEMBER_COLORS by join order;
// "Other" = owned by Upside (or a co-owner) with no member; "Unassigned" = a dashed grey outline.
// Upside-owned / co-owned: a neutral that every color-vision type tells apart from the member colors (validated
// against #3DBA8C / #D9A441 / #9D7BE0 on the chart surface; the mockup's blue sat 2 dE from Seif's purple for deutans).
export const OTHER_COLOR = '#B4BCC8';
export function ownerChip({ ownerUserId, ownerTeam, coOwnerName, members = [], meId = null }) {
  if (ownerUserId) {
    const i = members.findIndex(m => m.user_id === ownerUserId);
    const m = members[i];
    const name = m ? (m.name || '').split(' ')[0] : 'Member';
    return { kind: 'member', word: ownerUserId === meId ? 'Me' : name, title: m ? m.name : 'A member', color: m?.color || MEMBER_COLORS[(i >= 0 ? i : 0) % MEMBER_COLORS.length], dashed: false };
  }
  if (ownerTeam === 'upside' || ownerTeam === 'both' || coOwnerName) return { kind: 'other', word: 'Other', title: coOwnerName ? `Co-owner ${coOwnerName}` : 'Owned by Upside', color: OTHER_COLOR, dashed: false };
  return { kind: 'unassigned', word: 'Unassigned', title: 'Nobody owns this yet', color: UNASSIGNED_COLOR, dashed: true };
}

export const intentWord = r => (r ? `Intent ${r.score} · ${(BAND_WORD[r.band] || r.band).toLowerCase()}` : null);

// F9: "Live since Nov 3" from the partner's stage history (the first time it reached live), else the stage word.
export function liveSince(history = []) {
  const at = history.find(h => h.stage === 'live')?.at;
  return at ? md(at) : null;
}
export const isLivePartner = row => row?.type === 'partner' && row.stage === 'live';

// F9: the live partner's one primary - Bring back while deprioritized, else Add a client they referred. -> { id, label } | null
export function primaryAction({ row, fit = null }) {
  if (!row) return null;
  if (fit?.level === 'deprioritized') return { id: 'bring_back', label: 'Bring back' };
  if (isLivePartner(row)) return { id: 'add_client', label: '+ Add a client they referred' };
  return null;
}

// F9 Next step card (live partner): the record's next step / first open to-do; sub-line = last touch + recent visits.
// -> { text, sub, empty }
export function nextStepText({ row, detail }) {
  const rec = detail?.record || {};
  const todo = detail?.todos?.[0] || null;
  const text = rec.next_step || row?.next_step || todo?.text || null;
  const parts = [];
  const lt = rec.last_touch;
  if (lt?.at) parts.push(`Last touch ${md(lt.at)}${lt.by ? ` · ${String(lt.by).split(' ')[0]}` : ''}${lt.what ? ` · ${lt.what}` : lt.touch_type && lt.touch_type !== 'done' ? ` · ${lt.touch_type}` : ''}`);
  else if (row?.last_touch_at) parts.push(`Last touch ${md(row.last_touch_at)}`);
  const web = detail?.visits?.[0];
  if (web) parts.push(`${web.visits_7d ?? 0} visit${web.visits_7d === 1 ? '' : 's'} / 7 d${(web.top_paths || []).length ? ` · ${web.top_paths.slice(0, 2).map(x => x.path || x).join(', ')}` : ''}`);
  const due = todo?.due_date || rec.next_step_due || row?.next_step_due;
  if (due) parts.push(`due ${md(due)}`);
  return { text: text || (row?.type === 'target' ? 'Research, then draft the first email' : 'No next step yet'), sub: parts.join(' · '), empty: !text };
}

export const partnerKindWord = row => `Partner · ${String(row.category || 'uncategorized').replace(/^\d+\.\s*/, '')}`;
export const kindStageWord = row => {
  if (row.type === 'partner') return isLivePartner(row) ? partnerKindWord(row) : `${partnerKindWord(row)} · ${PIPELINE_STATUSES.find(s => s.id === row.stage)?.label || row.stage}`;
  if (row.type === 'employer') return `Employer · ${STAGE_LABELS[row.stage] || row.stage}`;
  if (row.type === 'target') return `Target · ${row.stage === 'proposed' ? 'Proposed' : 'Researching'}`;
  if (row.type === 'visitor') return 'Visitor';
  return 'Apollo';
};

// F5 - the Map's flow menu for a score row ({ type, stage, owner_user_id, fit_level, deprioritized_reason }): the first
// item is the next step for the record's state (same order as the card's primary). claim = the Claim it chips show
// (an unowned target / employer at Target). -> { claim, items: [{ id, label }], deprioritize, bring_back, reason }
export function flowMenu(row) {
  const r = row || {};
  const open = { id: 'open', label: 'Open account' };
  if (r.fit_level === 'deprioritized') return { claim: false, items: [open], deprioritize: false, bring_back: true, reason: r.deprioritized_reason || 'other' };
  const unowned = !r.owner_user_id;
  if (r.type === 'target' || (r.type === 'employer' && (r.stage === 'target' || !r.stage))) {
    const items = unowned
      ? [{ id: 'research', label: 'Research (who visited, fit)' }, ...(r.type === 'target' ? [{ id: 'promote', label: 'Promote to employer target' }] : []), { id: 'draft', label: 'Draft first email' }, { id: 'todo', label: 'To-do' }, open]
      : [{ id: 'draft', label: 'Draft first email' }, { id: 'contacted', label: 'Mark contacted' }, { id: 'research', label: 'Research' }, { id: 'todo', label: 'To-do' }, open];
    return { claim: unowned, items, deprioritize: true, bring_back: false, reason: null };
  }
  if (r.type === 'employer') {
    if (r.stage === 'contacted') return { claim: false, items: [{ id: 'they_replied', label: 'They replied…' }, { id: 'book', label: 'Book meeting' }, { id: 'call', label: 'Log call' }, { id: 'draft', label: 'Draft follow-up' }, open], deprioritize: true, bring_back: false, reason: null };
    if (r.stage === 'responded') return { claim: false, items: [{ id: 'book', label: 'Book meeting' }, { id: 'next', label: `Next: ${STAGE_LABELS.meeting}` }, open], deprioritize: true, bring_back: false, reason: null };
    if (['meeting', 'proposal_pilot'].includes(r.stage)) return { claim: false, items: [{ id: 'next', label: `Next: ${STAGE_LABELS[r.stage === 'meeting' ? 'proposal_pilot' : 'verbal']}` }, open], deprioritize: true, bring_back: false, reason: null };
    if (['verbal', 'contract', 'launched'].includes(r.stage)) return { claim: false, items: [{ id: 'make_client', label: 'Make client' }, open], deprioritize: false, bring_back: false, reason: null };
    return { claim: false, items: [open], deprioritize: true, bring_back: false, reason: null };
  }
  if (isLivePartner(r)) return { claim: false, items: [{ id: 'add_client', label: 'Add referred client' }, { id: 'log_referral', label: 'Log referral' }, { id: 'book', label: 'Book check-in' }, open], deprioritize: false, bring_back: false, reason: null };
  if (r.type === 'partner') {
    const behind = ['not_started', 'researching', 'first_email_drafted'].includes(r.stage || 'not_started');
    return { claim: unowned, items: [{ id: 'draft', label: 'Draft first email' }, ...(behind ? [{ id: 'contacted', label: 'Mark contacted' }] : []), { id: 'research', label: 'Research' }, { id: 'todo', label: 'To-do' }, open], deprioritize: true, bring_back: false, reason: null };
  }
  return { claim: false, items: [open], deprioritize: false, bring_back: false, reason: null };
}

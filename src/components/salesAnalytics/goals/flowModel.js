import { FIT_WORD, DEPRIORITIZE_REASON_WORD, DUE_WORD, BAND_WORD, US_FOOTPRINT_WORD } from '../../../constants/fitLevels';
import { MEMBER_COLORS, UNASSIGNED_COLOR } from '../../../constants/memberColors';
import { STAGE_LABELS } from '../pipelineStages';
import { PIPELINE_STATUSES } from '../../../constants/partnerPipeline';
import { md } from './companyPanelFacts';

// homelover-flow-v1 F1 / F2 / F5 / F8 / F9 - what the account card shows for a record's state (pure, unit-tested):
// the owner chip's color + word, the Fit / Due / Intent chip words, the Next step card's text and ONE primary (the
// first item of the flow menu for this state), the Overview facts. Nothing here reads a table; every input is the
// board row + GET goals/company / goals/fit / goals/reach.

// F1: a member's fixed color (business_members.member_color via goals/members), else MEMBER_COLORS by join order;
// "Other" = owned by Upside (or a co-owner) with no member; "Unassigned" = a dashed grey outline.
export const OTHER_COLOR = '#5B9BE6';
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

// F2: "Strong fit · 78" / "Deprioritized · Mostly outside US" / "Fit —" (no score yet).
export function fitChip(fit) {
  if (!fit) return { word: 'Fit —', tone: 'muted', title: 'No score yet - recompute' };
  if (fit.level === 'deprioritized') return { word: `Deprioritized · ${DEPRIORITIZE_REASON_WORD[fit.reason] || 'reason not set'}`, tone: 'bad', title: fit.note ? `Reason: ${fit.note}` : 'Deprioritized' };
  if (!fit.level) return { word: 'Fit —', tone: 'muted', title: `No axis has data yet (${fit.used ?? 0} of ${fit.of ?? 6})` };
  const score = fit.score != null ? ` · ${fit.score}` : '';
  return { word: `${FIT_WORD[fit.level]} fit${score}`, tone: fit.level === 'strong' ? 'good' : fit.level === 'good' ? 'accent' : 'muted', title: `${fit.source === 'hand' ? 'Set by hand' : `Score ${fit.score ?? '—'} · ${fit.used ?? 0} of ${fit.of ?? 6} axes`}` };
}
export const dueChip = row => (row?.due ? { word: `Due ${DUE_WORD[row.due].toLowerCase()}`, date: row.due_date || null } : null);
export const intentWord = r => (r ? `Intent ${r.score} · ${(BAND_WORD[r.band] || r.band).toLowerCase()}` : null);

// F9: "Live since Nov 3" from the partner's stage history (the first time it reached live), else the stage word.
export function liveSince(history = []) {
  const at = history.find(h => h.stage === 'live')?.at;
  return at ? md(at) : null;
}
export const isLivePartner = row => row?.type === 'partner' && row.stage === 'live';

// F5 / F8: the one primary for this state, in the flow menu's order. -> { id, label } | null
export function primaryAction({ row, fit = null, suggestion = null }) {
  if (!row) return null;
  if (fit?.level === 'deprioritized') return { id: 'bring_back', label: 'Bring back' };
  if (row.type === 'visitor' || row.type === 'apollo') return row.owner_user_id ? { id: 'research', label: 'Research' } : { id: 'claim', label: 'Claim' };
  if (isLivePartner(row)) return { id: 'add_client', label: '+ Add a client they referred' };
  if (row.type === 'partner') return null; // the Progress bar's primary (applyPartnerSignal) stays the partner's next step
  if (row.type === 'target' || row.stage === 'target') return { id: 'draft', label: 'Draft first email' };
  if (row.stage === 'contacted') return suggestion?.action === 'they_replied' ? { id: 'they_replied', label: 'They replied…' } : suggestion?.action === 'book_meeting' ? { id: 'book', label: 'Book meeting' } : { id: 'follow_up', label: 'Draft follow-up' };
  if (row.stage === 'responded') return suggestion?.action === 'mark_lost' ? { id: 'mark_lost', label: 'Mark lost?' } : { id: 'book', label: 'Book meeting' };
  if (['meeting', 'proposal_pilot'].includes(row.stage)) return { id: 'next', label: `Next: ${STAGE_LABELS[row.stage === 'meeting' ? 'proposal_pilot' : 'verbal']}` };
  if (['verbal', 'contract', 'launched'].includes(row.stage)) return { id: 'make_client', label: 'Make client' };
  return null;
}

// F8 Next step card: the record's next step / first open to-do; a reply suggestion wins while there is one.
// sub-line = last touch + recent visits. -> { text, sub, empty }
export function nextStepText({ row, detail, suggestion = null, reach = null }) {
  const rec = detail?.record || {};
  const todo = detail?.todos?.[0] || null;
  const text = suggestion?.text || rec.next_step || row?.next_step || todo?.text || null;
  const parts = [];
  const lt = rec.last_touch;
  if (lt?.at) parts.push(`Last touch ${md(lt.at)}${lt.by ? ` · ${String(lt.by).split(' ')[0]}` : ''}${lt.what ? ` · ${lt.what}` : lt.touch_type && lt.touch_type !== 'done' ? ` · ${lt.touch_type}` : ''}`);
  else if (row?.last_touch_at) parts.push(`Last touch ${md(row.last_touch_at)}`);
  const web = detail?.visits?.[0];
  if (web) parts.push(`${web.visits_7d ?? 0} visit${web.visits_7d === 1 ? '' : 's'} / 7 d${(web.top_paths || []).length ? ` · ${web.top_paths.slice(0, 2).map(x => x.path || x).join(', ')}` : ''}`);
  if (reach && reach.known > 0 && reach.replies > 0) parts.push(`${reach.replies} ${reach.replies === 1 ? 'reply' : 'replies'}`);
  const due = todo?.due_date || rec.next_step_due || row?.next_step_due;
  if (due && !suggestion) parts.push(`due ${md(due)}`);
  return { text: text || (row?.type === 'target' ? 'Research, then draft the first email' : 'No next step yet'), sub: parts.join(' · '), empty: !text };
}

// F8 Overview facts, [label, value, sub?, muted?]. research = the latest done result; fit = GET goals/fit; source = GET goals/source.
export function overviewFacts({ row, record, research, fit, source, visits = [], client = null }) {
  const emp = record?.employees;
  const srcTag = { research: 'Research', manual: 'Typed', apollo: 'Apollo' }[record?.employees_source];
  const us = fit?.us_footprint;
  const cf = source?.source_kind ? [source.partner_name, source.campaign_name, source.source_person].filter(Boolean) : [];
  const web = visits[0] || null;
  const lookalike = source?.source_kind === 'lookalike' ? source.source_note || source.partner_name || 'tagged lookalike' : null;
  return [
    ['Employees', emp != null ? Number(emp).toLocaleString('en-US') : '—', srcTag ? `${srcTag}${record?.employees_source === 'apollo' && record?.employees_at ? ` · ${md(record.employees_at)}` : ''}` : null, emp == null],
    ['US footprint', us ? US_FOOTPRINT_WORD[us] : '—', us ? (fit?.us_footprint_source === 'manual' ? 'typed' : 'from research') : 'not in research yet', !us],
    ['Industry', research?.sells_to || '—', research ? (research.housing_perk && !/no housing perk found/i.test(research.housing_perk) ? 'housing perk found' : 'no housing perk found') : 'not researched', !research?.sells_to],
    ['HQ', research?.hq_city || '—', null, !research?.hq_city],
    ['Came from', source?.source_kind ? `${SOURCE_WORD[source.source_kind] || source.source_kind}${cf.length ? ` · ${cf.join(' · ')}` : ''}` : 'Not set', row?.owner_team === 'upside' || row?.owner_team === 'both' ? 'via Upside' : null, !source?.source_kind],
    ...(lookalike ? [['Looks like', lookalike, 'lookalike', false]] : []),
    ['Website', web ? `${web.visits_7d ?? 0} visit${web.visits_7d === 1 ? '' : 's'}${record?.people_count != null ? ` · ${record.people_count} people` : ''}` : 'No visits yet', web ? `${(web.top_paths || []).slice(0, 2).map(x => x.path || x).join(', ') || 'last 7 d'}` : null, !web],
    ['Deal', client?.client_status ? `${client.eligible_now != null ? Number(client.eligible_now).toLocaleString('en-US') : '—'} lives · ${client.launch_date ? md(client.launch_date) : '—'} launch` : '— lives · — launch', client?.client_status ? 'client' : 'filled at Verbal', !client?.client_status],
  ];
}
const SOURCE_WORD = { partner_referral: 'Partner referral', person_referral: 'Person referral', inbound: 'Inbound', website: 'Website', campaign: 'Campaign', homelover_outreach: 'Outreach', scout: 'Scout', event: 'Event', lookalike: 'Lookalike', unknown: 'Unknown' };

export const partnerKindWord = row => `Partner · ${String(row.category || 'uncategorized').replace(/^\d+\.\s*/, '')}`;
export const kindStageWord = row => {
  if (row.type === 'partner') return isLivePartner(row) ? partnerKindWord(row) : `${partnerKindWord(row)} · ${PIPELINE_STATUSES.find(s => s.id === row.stage)?.label || row.stage}`;
  if (row.type === 'employer') return `Employer · ${STAGE_LABELS[row.stage] || row.stage}`;
  if (row.type === 'target') return `Target · ${row.stage === 'proposed' ? 'Proposed' : 'Researching'}`;
  if (row.type === 'visitor') return 'Visitor';
  return 'Apollo';
};

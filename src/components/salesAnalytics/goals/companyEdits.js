import { useState } from 'react';
import { goalsApi } from './goalsApi';
import { updateOpportunity } from '../pipelineApi';
import { priorityText, writePriority, undoValue } from './priorityActions';
import { isBackward, stageLabel } from './companyPanelModel';
import { boardStage } from '../../../constants/pipelineBoard';
import { TOUCH_STATUSES } from '../../../constants/partnerPipeline';

// company-panel-v2 L5 / company-panel-v3 F - the window's edits, each saved at once with a 10 s Undo: Stage (partner
// stages only through applyPartnerSignal with expect; a backward move asks to confirm and sends allow_backward), Owner,
// Team, Priority, the website (Set domain) and - v3 D1 - Next step: partners write sales_goals.next_step (PATCH /land),
// employers sales_opportunities.next_action; targets have no column (read-only).
export const nextStepWritable = row => row.type === 'partner' || row.type === 'employer';

export default function useCompanyEdits({ businessId, row, members, onPatch, onChanged, onToast }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const act = async (what, fn) => {
    setBusy(what); setError('');
    try { return (await fn()) !== false; } catch (e) { setError(e.message); return false; } finally { setBusy(''); }
  };
  const changeStage = to => act('stage', async () => {
    if (to === row.stage) return false;
    const back = isBackward(row, to);
    if (back && !window.confirm(`Move ${row.name} back from ${stageLabel(row)} to ${stageLabel(row, to)}?`)) return false;
    const before = row.stage;
    let undo;
    if (row.type === 'partner') {
      const { event } = await goalsApi.partnerSignal(businessId, row.id, { type: 'status', to, expect: before, ...(back ? { allow_backward: true } : {}) });
      undo = () => goalsApi.partnerUndo(businessId, row.id, event.id);
    } else if (row.type === 'employer') {
      await updateOpportunity(businessId, row.id, { stage: to, ...(back ? { allow_backward: true } : {}) });
      undo = () => updateOpportunity(businessId, row.id, { stage: before, allow_backward: true });
    } else {
      await goalsApi.updateTarget(businessId, row.id, { status: to, ...(back ? { allow_backward: true } : {}) });
      undo = () => goalsApi.updateTarget(businessId, row.id, { status: before, allow_backward: true });
    }
    const patch = row.type === 'partner' ? boardStage('partner', { pipeline_status: to, category: row.category }) : row.type === 'employer' ? boardStage('employer', { stage: to }) : boardStage('target', { status: to });
    if (row.type === 'partner' && TOUCH_STATUSES.includes(to)) patch.last_touch_at = new Date().toISOString();
    onPatch(patch); onChanged();
    onToast({ text: `${row.name}: ${stageLabel(row, to)}`, undo: async () => { await undo(); onChanged(); } });
  });
  // company-workflow-v1 W3: the owner is a person on every type (an employer's owner text follows it server-side).
  const changeOwner = userId => act('owner', async () => {
    const before = row.owner_user_id || null;
    const write = u => (row.type === 'partner' ? goalsApi.partnerSignal(businessId, row.id, { type: 'assign', owner_user_id: u || null }) : goalsApi.editCompanyFields(businessId, row.type, row.id, { owner_user_id: u || null }));
    await write(userId);
    onChanged();
    onToast({ text: `${row.name}: owner ${members.find(m => m.user_id === userId)?.name.split(' ')[0] || 'nobody'}`, undo: async () => { await write(before); onChanged(); } });
  });
  const changeTeam = team => act('team', async () => {
    const before = row.owner_team || null;
    const write = t => (row.type === 'partner' ? goalsApi.partnerSignal(businessId, row.id, { type: 'assign', owner_team: t || null })
      : row.type === 'employer' ? updateOpportunity(businessId, row.id, { owner_team: t || null }) : goalsApi.updateTarget(businessId, row.id, { owner_team: t || null }));
    await write(team);
    onChanged();
    onToast({ text: `${row.name}: team ${team || 'none'}`, undo: async () => { await write(before); onChanged(); } });
  });
  const changePriority = value => act('priority', async () => {
    const before = undoValue(row);
    await writePriority(businessId, row, value);
    onChanged();
    onToast({ text: `${row.name}: ${priorityText(value)}`, undo: async () => { await writePriority(businessId, row, before); onChanged(); } });
  });
  // FIX headcount-auto-v1 REV2 H7: Set domain (source 'manual') - the headcount lookup needs it; empty clears it.
  const saveDomain = domain => act('domain', async () => {
    const r = await goalsApi.editCompanyFields(businessId, row.type, row.id, { domain: domain.trim() || null });
    onPatch({ domain: r.fields?.domain ?? null, domain_source: r.fields?.domain_source ?? null });
    onChanged();
    onToast({ text: `${row.name}: website ${r.fields?.domain || 'cleared'}` });
  });
  const saveNextStep = (text, before) => act('next', async () => {
    const value = text.trim() || null;
    const write = v => (row.type === 'partner' ? goalsApi.updatePartner(businessId, row.id, { next_step: v }) : updateOpportunity(businessId, row.id, { next_action: v }));
    await write(value);
    onPatch({ next_step: value });
    onChanged();
    onToast({ text: `${row.name}: next step ${value ? 'saved' : 'cleared'}`, undo: async () => { await write(before ?? null); onPatch({ next_step: before ?? null }); onChanged(); } });
  });
  return { busy, error, setError, changeStage, changeOwner, changeTeam, changePriority, saveDomain, saveNextStep };
}

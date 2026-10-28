import { useState } from 'react';
import { SA } from '../theme';
import { goalsApi } from './goalsApi';
import { updateOpportunity } from '../pipelineApi';
import { ErrorNote } from './goalsUi';
import { OWNER_TEAMS, TEAM_LABEL } from '../../../constants/ownership';
import { PRIORITIES, PRIORITY_WORD } from '../../../constants/salesChannels';
import { NOT_A_FIT, priorityValue, priorityText, writePriority, undoValue } from './priorityActions';
import { stageOptions, isBackward, stageLabel } from './companyPanelModel';
import { forwardStages, editControls } from './companyPanelFacts';
import { boardStage } from '../../../constants/pipelineBoard';
import { TOUCH_STATUSES } from '../../../constants/partnerPipeline';
import FilterSelect from '../../../ui/FilterSelect';
import { priorityColor } from '../palette';
import { SourceForm } from './LeadSource';

// company-panel-v2 L5 - the labelled Edit row: Stage (forward moves only, plus
// Jump to stage with confirm for the way back), Owner, Team, Priority. Every
// change saves at once with a 10 s Undo (D2). Which controls show follows the
// per-type matrix (companyPanelFacts editControls). Members only.
// lead-source-v1 B2: Source opens its own form under the row (partner / employer / target).
export default function CompanyEditRow({ businessId, row, members, source, onPatch, onChanged, onToast }) {
  const [jump, setJump] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [domainOpen, setDomainOpen] = useState(false);
  const [domainDraft, setDomainDraft] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const act = async (what, fn) => {
    setBusy(what); setError('');
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  const changeStage = to => act('stage', async () => {
    if (to === row.stage) return;
    const back = isBackward(row, to);
    if (back && !window.confirm(`Move ${row.name} back from ${stageLabel(row)} to ${stageLabel(row, to)}?`)) return;
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
    setJump(false); onPatch(patch); onChanged();
    onToast({ text: `${row.name}: ${stageLabel(row, to)}`, undo: async () => { await undo(); onChanged(); } });
  });
  // company-workflow-v1 W3: the owner is a person on every type (an employer's owner text follows it server-side).
  const changeOwner = userId => act('owner', async () => {
    const before = ownerId || null;
    const write = u => (row.type === 'partner' ? goalsApi.partnerSignal(businessId, row.id, { type: 'assign', owner_user_id: u || null }) : goalsApi.editCompanyFields(businessId, row.type, row.id, { owner_user_id: u || null }));
    await write(userId);
    onChanged();
    onToast({ text: `${row.name}: owner ${members.find(m => m.user_id === userId)?.name.split(' ')[0] || 'nobody'}`, undo: async () => { await write(before); onChanged(); } });
  });
  const changeTeam = team => act('team', async () => {
    if (row.type === 'partner') await goalsApi.partnerSignal(businessId, row.id, { type: 'assign', owner_team: team || null });
    else if (row.type === 'employer') await updateOpportunity(businessId, row.id, { owner_team: team || null });
    else await goalsApi.updateTarget(businessId, row.id, { owner_team: team || null });
    onChanged();
  });
  // FIX headcount-auto-v1 REV2 H7: Set domain (source 'manual') - the headcount lookup needs it; empty clears it.
  const saveDomain = () => act('domain', async () => {
    const r = await goalsApi.editCompanyFields(businessId, row.type, row.id, { domain: domainDraft.trim() || null });
    onPatch({ domain: r.fields?.domain ?? null, domain_source: r.fields?.domain_source ?? null });
    setDomainOpen(false); onChanged();
    onToast({ text: `${row.name}: website ${r.fields?.domain || 'cleared'}` });
  });
  const changePriority = value => act('priority', async () => {
    const before = undoValue(row);
    await writePriority(businessId, row, value);
    onChanged();
    onToast({ text: `${row.name}: ${priorityText(value)}`, undo: async () => { await writePriority(businessId, row, before); onChanged(); } });
  });

  const controls = editControls(row);
  if (!controls.length) return null;
  const ownerId = row.owner_user_id || null;
  const b = what => busy === what;
  const stages = forwardStages(row);
  return (
    <div role="group" aria-label="Edit" data-edit-row style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="ui-group-label" style={{ width: 72, flex: 'none' }}>Edit</span>
        {controls.includes('stage') && <>
          <FilterSelect label="Stage" value={row.stage} disabled={b('stage')} options={stages.map(s => ({ value: s.id, label: s.label }))} onChange={changeStage} />
          {stageOptions(row).length > stages.length && <button type="button" className="ui-btn ui-btn--tertiary" aria-expanded={jump} onClick={() => setJump(j => !j)}>Jump to stage ▾</button>}
        </>}
        {controls.includes('owner') && (
          <FilterSelect label="Owner" value={ownerId || ''} disabled={b('owner')} options={[{ value: '', label: 'Unassigned' }, ...members.filter(m => m.role !== 'viewer').map(m => ({ value: m.user_id, label: m.name }))]} onChange={changeOwner} />
        )}
        {controls.includes('team') && (
          <FilterSelect label="Team" value={row.owner_team || ''} disabled={b('team')} options={[{ value: '', label: 'None' }, ...OWNER_TEAMS.map(t => ({ value: t, label: TEAM_LABEL[t] }))]} onChange={changeTeam} />
        )}
        {controls.includes('priority') && (
          <span data-priority={row.type} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {priorityValue(row) && priorityValue(row) !== NOT_A_FIT && <span className="ui-tag__dot" data-priority-dot aria-hidden="true" style={{ '--tag-color': priorityColor(priorityValue(row)) }} />}
            <FilterSelect label="Priority" value={priorityValue(row)} disabled={b('priority')} options={[{ value: '', label: '—' }, ...PRIORITIES.map(p => ({ value: String(p), label: `P${p} · ${PRIORITY_WORD[p]}` })), { value: NOT_A_FIT, label: 'Not a fit' }]} onChange={changePriority} />
          </span>
        )}
        {controls.includes('source') && <button type="button" className="ui-btn ui-btn--secondary" aria-expanded={sourceOpen} onClick={() => setSourceOpen(o => !o)}>Source ▾</button>}
        {controls.includes('domain') && <button type="button" className="ui-btn ui-btn--secondary" aria-expanded={domainOpen} title={row.domain ? `Website: ${row.domain} (${row.domain_source || 'set'})` : 'No website on file - the headcount lookup needs one'} onClick={() => { setDomainDraft(row.domain || ''); setDomainOpen(o => !o); }}>{row.domain ? `Website · ${row.domain}` : 'Set domain'}</button>}
        {controls.includes('stage') && <span style={{ fontSize: 12, color: SA.muted }}>Stage only moves forward · saves at once, Undo for 10 s</span>}
      </div>
      {domainOpen && (
        <form data-domain-form onSubmit={e => { e.preventDefault(); saveDomain(); }} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input aria-label="Website" placeholder="company.com" value={domainDraft} maxLength={120} onChange={e => setDomainDraft(e.target.value)} className="ui-input ui-input--sm" style={{ width: 220 }} />
          <button type="submit" className="ui-btn ui-btn--primary ui-btn--sm" disabled={b('domain')}>{b('domain') ? 'Saving…' : 'Save website'}</button>
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => setDomainOpen(false)}>Cancel</button>
          <span style={{ fontSize: 12, color: SA.muted }}>Fill-only elsewhere; a typed website is never overwritten</span>
        </form>
      )}
      {jump && (
        <div role="group" aria-label="Jump to stage" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {stageOptions(row).map(s => (
            <button key={s.id} type="button" className="ui-btn ui-btn--secondary" disabled={s.dir === 'now' || b('stage')} aria-current={s.dir === 'now' ? 'true' : undefined} onClick={() => changeStage(s.id)}
              title={s.dir === 'back' ? 'Backwards - asks you to confirm' : undefined} style={{ color: s.dir === 'back' ? SA.warn : undefined }}>
              {s.dir === 'back' ? '↩ ' : ''}{s.label}{s.dir === 'now' ? ' · now' : ''}
            </button>
          ))}
        </div>
      )}
      {sourceOpen && <SourceForm key={source?.set_at || 'none'} businessId={businessId} row={row} source={source} onSaved={() => { setSourceOpen(false); onChanged(); }} onToast={onToast} onCancel={() => setSourceOpen(false)} />}
      {error && <ErrorNote message={error} />}
    </div>
  );
}

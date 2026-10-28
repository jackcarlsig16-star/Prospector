import { useState, useEffect } from 'react';
import { SA } from '../../theme';
import { goalsApi } from '../goalsApi';
import { updateOpportunity } from '../../pipelineApi';
import { Chip } from '../goalsUi';
import { mondayOf } from '../companyPanelModel';
import { hollowness } from './prioritiesModel';

// intent-score-v1 S3 - the quick-action bar under the chart for the selected company, in the spec's order:
// Brief · Write email · Research · Assign to ▾ · Add task · Not a fit · Open. On an Upside-owned / no-double-touch row
// the touching actions (Assign, Write email, Add task) are disabled with the reason (priority-v2's rule as a display
// rule). Assign = the existing Assign signal for partners (never a stage move), owner_user_id for employers / targets.
const LINK_TYPE = { partner: 'partner', employer: 'opportunity', target: 'target' };
const LOCK_REASON = 'Upside-owned with no double touch - coordinate with Brad before touching this company';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const btn = 'ui-btn ui-btn--secondary ui-btn--sm';

export default function QuickMenu({ businessId, row, members, meId, canEdit, compose, onBrief, onCompose, onChanged, onToast, onOpen, nextStep, onSubClose }) {
  const [busy, setBusy] = useState(null);
  const [assignOpen, setAssignOpen] = useState(false);
  useEffect(() => {
    if (!onSubClose) return undefined;
    onSubClose(assignOpen ? () => setAssignOpen(false) : null);
    return () => onSubClose(null);
  }, [assignOpen, onSubClose]);
  const locked = !!row.touch_locked;
  const run = async (key, fn, text) => {
    setBusy(key);
    try { await fn(); if (text) onToast({ text }); onChanged && onChanged(); }
    catch (e) { onToast({ text: e.message }); }
    finally { setBusy(null); }
  };
  const assign = userId => run('assign', async () => {
    if (row.type === 'partner') await goalsApi.partnerSignal(businessId, row.id, { type: 'assign', owner_user_id: userId || null });
    else await goalsApi.editCompanyFields(businessId, row.type, row.id, { owner_user_id: userId || null });
    setAssignOpen(false);
  }, `${row.name}: ${userId ? `assigned to ${(members.find(m => m.user_id === userId)?.name || '').split(' ')[0]}` : 'unassigned'}`);
  const addTask = () => run('task', async () => {
    const t = today();
    const goal = await goalsApi.createWeekGoal(businessId, { week_start: mondayOf(t), kind: 'todo', text: `${nextStep || 'Follow up'}: ${row.name}`, owner_user_id: meId || null, due_date: t, link_type: LINK_TYPE[row.type], link_id: row.id });
    onToast({ text: `To-do added for ${row.name}`, undo: async () => { await goalsApi.deleteWeekGoal(businessId, goal.id); onChanged && onChanged(); } });
  });
  const notAFit = () => run('fit', async () => {
    await goalsApi.setVisitPriority(businessId, { record: { type: row.type, id: row.id }, not_a_fit: true });
    await goalsApi.recomputeScores(businessId, { type: row.type, id: row.id });
    onToast({ text: `${row.name}: Not a fit`, undo: async () => { await goalsApi.setVisitPriority(businessId, { record: { type: row.type, id: row.id }, priority: null }); await goalsApi.recomputeScores(businessId, { type: row.type, id: row.id }); onChanged && onChanged(); } });
  });
  const research = () => run('research', async () => { await goalsApi.runCompanyResearch(businessId, row.type, row.id); }, `Researching ${row.name} - one Claude call, about a minute`);
  const hollow = hollowness(row) === 'hollow';
  // Observed means only (planner, Oct 27): "—" until the first Write email cost exists; "cost: n/a yet" under 3 research runs.
  const composeLabel = compose ? `Write email · ${compose.cost_estimate_usd != null ? `~$${Number(compose.cost_estimate_usd).toFixed(2)}` : '—'} · ${compose.used}/${compose.max} today` : 'Write email';
  const researchLabel = `Research · ${compose?.research_cost_usd != null ? `~$${Number(compose.research_cost_usd).toFixed(2)} per run` : 'cost: n/a yet'}`;
  const composeCapped = !!compose && compose.used >= compose.max;
  const lockTitle = locked ? LOCK_REASON : undefined;
  return (
    <div role="toolbar" aria-label={`Actions for ${row.name}`} data-quick-menu style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '8px 10px', borderRadius: 10, background: SA.surface2, border: `1px solid ${SA.border}` }}>
      <span style={{ fontWeight: 600, fontSize: 13, color: SA.text, marginRight: 4 }}>{row.name}</span>
      {row.upside_owned && <Chip title={row.touch_locked ? LOCK_REASON : 'Upside-owned'} data-upside-chip style={{ height: 22 }}>Upside{row.touch_locked ? ' · no double touch' : ''}</Chip>}
      <button type="button" className={btn} onClick={onBrief}>Brief</button>
      {canEdit && <button type="button" className={btn} disabled={locked || composeCapped} aria-disabled={locked || composeCapped} title={lockTitle || (composeCapped ? 'Daily Write email cap reached' : 'One Claude call, never sends')} onClick={onCompose}>{composeLabel}</button>}
      {canEdit && <button type="button" className={`ui-btn ui-btn--sm ${hollow ? 'ui-btn--primary' : 'ui-btn--secondary'}`} disabled={busy === 'research'} title="Research this company - one Claude call" onClick={research}>{busy === 'research' ? 'Starting…' : researchLabel}</button>}
      {canEdit && (
        <span style={{ position: 'relative' }}>
          <button type="button" className={btn} disabled={locked || busy === 'assign'} aria-disabled={locked} aria-expanded={assignOpen} title={lockTitle || 'Change the owner (partners through Assign, never a stage move)'} onClick={() => setAssignOpen(o => !o)}>Assign to{row.owner ? ` · ${row.owner.split(' ')[0]}` : ''} ▾</button>
          {assignOpen && !locked && (
            <div role="menu" aria-label="Assign to" style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 6, background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: 10, padding: 6, display: 'flex', flexDirection: 'column', minWidth: 180 }}>
              {members.filter(m => m.role !== 'viewer').map(m => <button key={m.user_id} type="button" role="menuitem" className="ui-btn ui-btn--tertiary ui-btn--sm" style={{ justifyContent: 'flex-start' }} onClick={() => assign(m.user_id)}>{m.name}</button>)}
              <button type="button" role="menuitem" className="ui-btn ui-btn--tertiary ui-btn--sm" style={{ justifyContent: 'flex-start', color: SA.muted }} onClick={() => assign(null)}>Unassigned</button>
            </div>
          )}
        </span>
      )}
      {canEdit && <button type="button" className={btn} disabled={locked || busy === 'task'} aria-disabled={locked} title={lockTitle || 'A to-do on this company, due today, prefilled with the next step'} onClick={addTask}>Add task</button>}
      {canEdit && <button type="button" className={btn} disabled={busy === 'fit'} title="Closes the score (10 or less) and puts the company on the skip list; Undo puts it back" onClick={notAFit}>Not a fit</button>}
      <button type="button" className={btn} onClick={onOpen}>Open</button>
    </div>
  );
}

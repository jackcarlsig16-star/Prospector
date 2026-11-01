import { goalsApi } from './goalsApi';
import { updateOpportunity } from '../pipelineApi';
import { updateProspect } from '../huddleApi';
import { STAGE_LABELS } from '../pipelineStages';
import { WORKFLOW_STEPS } from '../../../constants/partnerPipeline';

const stageLabel = (type, stage) => (type === 'partner' ? WORKFLOW_STEPS.find(s => s.id === stage)?.label : STAGE_LABELS[stage]) || stage;

// company-panel-v3 D4 - the two Reach writes the Interest band and the Actions row's REACH group share (band = shortcut,
// group = home). person = the band's strongest signal's person, or null from the Actions row. Each hands back a 10 s Undo.
// Book meeting: the next step + a to-do due today (no calendar write). Mark contacted: an email touch / done to-do, and the
// stage moves forward when it is behind contacted (company-progress-bar-v1 D3); Undo puts the stage back too.
export async function bookMeeting({ businessId, row, person = null, onChanged, onToast }) {
  const r = await goalsApi.bookMeeting(businessId, row.type, row.id, person ? { person: person.name } : {});
  onChanged();
  onToast({ text: `Next step: ${r.next_step} · to-do due today`, undo: async () => {
    if (row.type === 'partner') await goalsApi.updatePartner(businessId, row.id, { next_step: r.before?.next_step ?? null });
    else if (row.type === 'employer') await updateOpportunity(businessId, row.id, { next_action: r.before?.next_action ?? null, next_action_date: r.before?.next_action_date ?? null });
    await goalsApi.updateWeekGoal(businessId, r.todo.id, { status: 'dropped' });
    onChanged();
  } });
}

export async function markContacted({ businessId, row, person = null, onChanged, onToast }) {
  const r = await goalsApi.markContacted(businessId, row.type, row.id, { ...(person ? { contact_id: person.contact_id, person: person.name } : {}), touch_type: 'email' });
  onChanged();
  const moved = r.stage && r.stage.after !== r.stage.before;
  onToast({ text: `${person ? person.name : row.name} marked contacted${moved ? ` · moved to ${stageLabel(row.type, r.stage.after)}` : ''}`, undo: async () => {
    if (r.event) await goalsApi.partnerUndo(businessId, row.id, r.event.id);
    if (moved && row.type === 'employer') await updateOpportunity(businessId, row.id, { stage: r.stage.before, allow_backward: true });
    if (r.todo) await goalsApi.updateWeekGoal(businessId, r.todo.id, { status: 'dropped' });
    if (r.person) await updateProspect(businessId, r.person.contact_id, { status: r.person.before.status });
    onChanged();
  } });
}

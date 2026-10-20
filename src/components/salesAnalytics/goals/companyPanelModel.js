import { PIPELINE_STATUSES, nextStepFor, stepOf } from '../../../constants/partnerPipeline';
import { STAGE_ORDER, STAGE_ENUM, STAGE_LABELS, compareStages } from '../pipelineStages';

// sales-ia-v2 P4 - what the company panel's Stage and Add-to-pipeline
// controls offer for each row type (pure, unit-tested). A visitor or
// Apollo-only row has no record: record-needing actions first make it a
// target (needsRecord + addAsk).
export const needsRecord = type => type === 'visitor' || type === 'apollo';
export const addAsk = name => `Add ${name} to Pipeline as a target?`;
export const PRIORITY_TYPES = ['partner', 'employer', 'visitor'];
const TARGET_STAGES = [['proposed', 'Proposed'], ['researching', 'Researching']];

// The one forward step, or null (live, launched, paused, a lost or parked
// employer, a target already researching).
export function nextStage(row) {
  if (row.type === 'partner') {
    if (row.stage === 'paused') return null;
    const n = nextStepFor(row.stage);
    return n ? { to: n.to, label: n.label } : null;
  }
  if (row.type === 'employer') {
    const i = STAGE_ORDER.indexOf(row.stage);
    return i >= 0 && i < STAGE_ORDER.length - 1 ? { to: STAGE_ORDER[i + 1], label: STAGE_LABELS[STAGE_ORDER[i + 1]] } : null;
  }
  if (row.type === 'target') return row.stage === 'proposed' ? { to: 'researching', label: 'Start research' } : null;
  return null;
}

// Every stage the Jump menu lists, flagged back / forward / now. Backward
// picks confirm and send allow_backward (the server refuses them otherwise).
export function stageOptions(row) {
  if (row.type === 'partner') return PIPELINE_STATUSES.map(s => ({ id: s.id, label: s.label, dir: dirOf(row, s.id) }));
  if (row.type === 'employer') return STAGE_ENUM.map(id => ({ id, label: STAGE_LABELS[id], dir: dirOf(row, id) }));
  if (row.type === 'target') return TARGET_STAGES.map(([id, label]) => ({ id, label, dir: dirOf(row, id) }));
  return [];
}

export function dirOf(row, to) {
  if (to === row.stage) return 'now';
  if (row.type === 'partner') {
    const a = stepOf(row.stage || 'not_started'), b = stepOf(to);
    return a === null || b === null ? 'side' : b < a ? 'back' : 'forward';
  }
  if (row.type === 'employer') { const c = compareStages(row.stage, to); return c === 'back' ? 'back' : c === 'forward' ? 'forward' : 'side'; }
  if (row.type === 'target') return to === 'proposed' ? 'back' : 'forward';
  return 'side';
}
export const isBackward = (row, to) => dirOf(row, to) === 'back';

export function stageLabel(row, id = row.stage) {
  if (row.type === 'partner') return PIPELINE_STATUSES.find(s => s.id === id)?.label || id;
  if (row.type === 'employer') return STAGE_LABELS[id] || id;
  if (row.type === 'target') return TARGET_STAGES.find(([s]) => s === id)?.[1] || id;
  return row.stage_label || id;
}

// Appended under the copy-bundle's "## What I need:" for Draft email in
// Claude. Prospector never sends; Jack pastes and sends himself.
export function playbookPrompt(row) {
  const what = row.type === 'employer' ? 'an employer that could offer us as an employee benefit' : row.type === 'partner' ? 'a channel partner that could offer us to the employers, members or clients it already reaches' : 'a company we want to open a conversation with';
  return [
    `Draft one first email to ${row.name}, ${what}.`,
    'Rules: under 120 words; one clear ask (a 20-minute call); open with something specific to them from the record above; plain English, no buzzwords, no attachments mentioned; sign off as me.',
    'Use only facts in the record. Do not invent names, numbers or news. If the record is thin, ask me two questions instead of guessing.',
    'Then give one subject line and a two-line follow-up for a week later. I send everything myself.',
  ].join('\n');
}

// The Monday (LA calendar) a due date's week starts on.
export const mondayOf = d => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };

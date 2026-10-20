import { needsRecord, addAsk, nextStage, stageOptions, dirOf, isBackward, stageLabel, playbookPrompt, mondayOf } from './companyPanelModel';

// sales-ia-v2 P4 - the stage menu and Add-to-pipeline rules per row type.
const partner = stage => ({ type: 'partner', stage, name: 'Gallagher' });
const employer = stage => ({ type: 'employer', stage, name: 'Solidcore' });
const target = stage => ({ type: 'target', stage, name: 'Zeta' });

test('visitor and Apollo-only rows need a record first; the ask names the company', () => {
  expect(needsRecord('visitor')).toBe(true);
  expect(needsRecord('apollo')).toBe(true);
  expect(['partner', 'employer', 'target'].map(needsRecord)).toEqual([false, false, false]);
  expect(addAsk('Acme Widgets')).toBe('Add Acme Widgets to Pipeline as a target?');
});

test('nextStage: the one forward step per type; none at the end, when paused / parked, or for a visitor', () => {
  expect(nextStage(partner('not_started'))).toEqual({ to: 'researching', label: 'Start research' });
  expect(nextStage(partner('live'))).toBeNull();
  expect(nextStage(partner('paused'))).toBeNull();
  expect(nextStage(employer('target'))).toEqual({ to: 'contacted', label: 'Contacted' });
  expect(nextStage(employer('launched'))).toBeNull();
  expect(nextStage(employer('nurture'))).toBeNull();
  expect(nextStage(target('proposed'))).toEqual({ to: 'researching', label: 'Start research' });
  expect(nextStage(target('researching'))).toBeNull();
  expect(nextStage({ type: 'visitor', stage: 'visited' })).toBeNull();
});

test('stageOptions + dirOf: every stage with now / back / forward / side; backward = isBackward', () => {
  const p = stageOptions(partner('replied'));
  expect(p.map(s => s.id)).toContain('live');
  expect(p.find(s => s.id === 'replied').dir).toBe('now');
  expect(p.find(s => s.id === 'first_email_sent').dir).toBe('back');
  expect(p.find(s => s.id === 'in_sequence').dir).toBe('back');
  expect(p.find(s => s.id === 'meeting_set').dir).toBe('forward');
  expect(p.find(s => s.id === 'paused').dir).toBe('side');
  const e = stageOptions(employer('meeting'));
  expect(e.find(s => s.id === 'target').dir).toBe('back');
  expect(e.find(s => s.id === 'verbal').dir).toBe('forward');
  expect(e.find(s => s.id === 'lost').dir).toBe('side');
  expect(e.find(s => s.id === 'on_hold').dir).toBe('side');
  expect(stageOptions(target('researching')).map(s => [s.id, s.dir])).toEqual([['proposed', 'back'], ['researching', 'now']]);
  expect(isBackward(partner('replied'), 'researching')).toBe(true);
  expect(isBackward(partner('paused'), 'researching')).toBe(false);
  expect(isBackward(employer('contacted'), 'target')).toBe(true);
  expect(dirOf({ type: 'visitor', stage: 'visited' }, 'x')).toBe('side');
  expect(stageOptions({ type: 'visitor', stage: 'visited' })).toEqual([]);
});

test('stageLabel per type; the playbook prompt names the company and never asks to send; mondayOf finds the LA week start', () => {
  expect(stageLabel(partner('first_email_drafted'))).toBe('1st email drafted');
  expect(stageLabel(employer('proposal_pilot'))).toBe('Proposal/Pilot');
  expect(stageLabel(target('proposed'))).toBe('Proposed');
  expect(stageLabel({ type: 'visitor', stage: 'visited', stage_label: 'Website visit' })).toBe('Website visit');
  const prompt = playbookPrompt(employer('target'));
  expect(prompt).toMatch(/^Draft one first email to Solidcore, an employer/);
  expect(prompt).toMatch(/I send everything myself/);
  expect(prompt).not.toMatch(/@/);
  expect(mondayOf('2026-10-23')).toBe('2026-10-19');
  expect(mondayOf('2026-10-19')).toBe('2026-10-19');
  expect(mondayOf('2026-10-25')).toBe('2026-10-19');
});

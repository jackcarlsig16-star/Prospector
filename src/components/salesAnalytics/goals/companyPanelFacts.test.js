import { factsFor, lastTouchText, forwardStages, editControls, showsNotNow, filterPeople, bandText, sourceLabel, sourceText } from './companyPanelFacts';
import { historyText, sourceBody } from './LeadSource';

// company-panel-v2 L2 / L5 - the facts row and the Edit row per row type (the matrix), pure.
const base = { name: 'X', stage: 'replied', owner: 'Jack', owner_team: 'homelover', channel: 'import', priority: 1, next_step: 'Send deck', next_step_due: '2026-10-22', last_touch_at: '2026-10-17T10:00:00Z' };

test('partner / employer: the seven facts in order; Last touch says the kind when the touch has one; Next step carries its due date', () => {
  const facts = factsFor({ ...base, type: 'partner' }, { last_touch: { at: '2026-10-17T10:00:00Z', touch_type: 'email' }, next_step: 'Send deck', next_step_due: '2026-10-22' });
  // company-workflow-v1: + Employees (number + source tag).
  expect(facts.map(f => f[0])).toEqual(['Stage', 'Priority', 'Owner', 'Team', 'Source', 'Last touch', 'Next step', 'Employees']);
  expect(facts.map(f => f[1])).toEqual(['Replied', 'P1 · Act today', 'Jack', 'HomeLover', 'Import', 'Oct 17 · Email sent', 'Send deck · due Oct 22', '—']);
  expect(facts.slice(0, 7).every(f => f[2] === false)).toBe(true);
  const employer = factsFor({ ...base, type: 'employer', stage: 'contacted', owner: null, owner_team: null, priority: null, next_step: null, next_step_due: null, last_touch_at: null }, { last_touch: { at: '2026-10-19T10:00:00Z', touch_type: 'done' } });
  expect(employer.map(f => f[1])).toEqual(['Contacted', '—', 'Unassigned', '—', 'Import', 'Oct 19 · To-do done', '—', '—']);
  expect(employer.map(f => f[2])).toEqual([false, true, true, true, false, false, true, true]);
});

test('target: Stage = status, Owner (a person, company-workflow-v1), Team, Source, Last touch; Apollo-only: In sequence · Apollo; visitor: Priority · Source Website · Last visit', () => {
  expect(factsFor({ type: 'target', stage: 'researching', owner_team: 'upside', channel: 'scout' }, null).map(f => [f[0], f[1]])).toEqual([['Stage', 'Researching'], ['Owner', 'Unassigned'], ['Team', 'Upside'], ['Source', 'Scout signal'], ['Last touch', 'No touch yet']]);
  expect(factsFor({ type: 'apollo', stage: 'sequenced' }, null).map(f => [f[0], f[1]])).toEqual([['Stage', 'In sequence'], ['Source', 'Apollo'], ['Last touch', 'No touch yet']]);
  const v = factsFor({ type: 'visitor', priority: 2, visited: { last_visit: '2026-10-20' } }, null);
  expect(v.map(f => [f[0], f[1]])).toEqual([['Priority', 'P2 · This week'], ['Source', 'Website'], ['Last visit', 'Oct 20']]);
  expect(factsFor({ type: 'visitor', priority: null, not_a_fit: true, visited: null }, null)[0][1]).toBe('Not a fit');
  expect(sourceLabel({ type: 'partner', channel: 'unknown' })).toBe('—');
});

test('lastTouchText: kind + date, else "Touched <date>" from the stamp, else "No touch yet" (muted)', () => {
  expect(lastTouchText({ at: '2026-10-17T10:00:00Z', touch_type: 'call' }, null)).toEqual({ text: 'Oct 17 · Call', empty: false });
  expect(lastTouchText({ at: '2026-10-17T10:00:00Z', touch_type: null }, null)).toEqual({ text: 'Touched Oct 17', empty: false });
  expect(lastTouchText(null, '2026-10-16T10:00:00Z')).toEqual({ text: 'Touched Oct 16', empty: false });
  expect(lastTouchText(null, null)).toEqual({ text: 'No touch yet', empty: true });
});

test('Edit row: the Stage select lists now + forward only; the matrix picks the controls; Not now hides on visitor / Apollo-only rows', () => {
  const partner = { type: 'partner', stage: 'replied' };
  const ids = forwardStages(partner).map(s => s.id);
  expect(ids[0]).toBe('replied');
  expect(ids).not.toContain('first_email_sent');
  expect(ids).toContain('meeting_set');
  expect(forwardStages({ type: 'employer', stage: 'contacted' }).map(s => s.id)).not.toContain('target');
  expect(forwardStages({ type: 'target', stage: 'researching' }).map(s => s.id)).toEqual(['researching']);
  expect(editControls({ type: 'partner' })).toEqual(['stage', 'owner', 'team', 'priority', 'source']);
  // FIX headcount-auto-v1 REV2 H7: employers and targets gain "Set domain"; a partner's domains live in Partner domains.
  expect(editControls({ type: 'employer' })).toEqual(['stage', 'owner', 'team', 'priority', 'source', 'domain']);
  expect(editControls({ type: 'target' })).toEqual(['stage', 'owner', 'team', 'source', 'domain']);
  expect(editControls({ type: 'visitor' })).toEqual(['priority']);
  expect(editControls({ type: 'apollo' })).toEqual([]);
  expect([showsNotNow({ type: 'partner' }), showsNotNow({ type: 'employer' }), showsNotNow({ type: 'target' }), showsNotNow({ type: 'visitor' }), showsNotNow({ type: 'apollo' })]).toEqual([true, true, true, false, false]);
});

test('People filter matches name or title; the band text is strongest first then the rest', () => {
  const people = [{ name: 'Pat Lee', title: 'VP' }, { name: 'Dana Q', title: 'CHRO' }];
  expect(filterPeople(people, ' chro ').map(p => p.name)).toEqual(['Dana Q']);
  expect(filterPeople(people, '').length).toBe(2);
  const click = { text: 'Pat clicked Step 1' }, visit = { text: '3 site visits this week' };
  expect(bandText({ strongest: click, items: [click, visit] })).toBe('Pat clicked Step 1 · 3 site visits this week');
  expect(bandText({ strongest: null, items: [] })).toBe('');
});

test('lead-source-v1: the Source fact is the lead source (kind · partner · rep · office) with the channel small beside it', () => {
  const row = { type: 'employer', stage: 'contacted', channel: 'import' };
  const src = { source_kind: 'partner_referral', partner_name: 'Upside', source_person: 'Brad Cillian', source_office: 'Chicago', route_in: 'Brad admin' };
  expect(factsFor(row, null, src).find(f => f[0] === 'Source')).toEqual(['Source', 'Partner referral · Upside · Brad Cillian · Chicago', false, 'via Import']);
  expect(sourceText({ source_kind: 'homelover_outreach', route_in: 'HomeLover existing outreach' }).text).toBe('HomeLover outreach · route in: HomeLover existing outreach');
  expect(factsFor(row, null, { source_kind: null }).find(f => f[0] === 'Source')).toEqual(['Source', 'Not set', true, 'via Import']);
  expect(factsFor({ type: 'target', stage: 'researching', channel: 'unknown' }, null, { source_kind: 'campaign', campaign_name: 'Seif Q4', source_person: 'Seif' }).find(f => f[0] === 'Source')).toEqual(['Source', 'Campaign · Seif Q4 · Seif', false, null]);
  expect(historyText({ from_source: null, to_source: { source_kind: 'partner_referral', partner_name: 'Upside', source_person: 'Brad Cillian' } })).toBe('Not set → Partner referral · Upside · Brad Cillian');
  expect(sourceBody({ source_kind: 'event', label: 'Event', set_at: 'x' })).toEqual({ source_kind: 'event', source_partner_id: null, source_person: null, source_office: null, source_campaign_id: null, route_in: null, source_note: null });
});

test('company-workflow-v1: Employees with its source tag; Reach (covers · clients) only for PEO / HR / platform partners', () => {
  const { sizeFacts, showsReach } = require('./companyPanelFacts');
  expect(sizeFacts({ type: 'employer' }, { employees: 1200, employees_source: 'research' })).toEqual([['Employees', '1,200', false, 'Research']]);
  expect(sizeFacts({ type: 'partner', category: '3. PEOs' }, { category: '3. PEOs', employees: 300, employees_source: 'manual', reach_employees: 45000, reach_clients: 410, reach_employees_source: 'research' }))
    .toEqual([['Employees', '300', false, 'Typed'], ['Reach', 'covers 45,000 · 410 clients', false, 'Research']]);
  expect(showsReach({ type: 'partner' }, { category: '4. Mid-Market Benefits Brokers' })).toBe(false);
  expect(sizeFacts({ type: 'visitor' }, {})).toEqual([]);
});

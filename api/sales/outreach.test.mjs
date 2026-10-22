// node --test api/sales/outreach.test.mjs  (react-scripts' Jest only runs src/)
// seif-campaign-v1 Stage 2 - campaigns, import, schedule, contact actions,
// Promote, Actions rows and the Outlook matcher against the in-memory
// Supabase. Invented people and companies; every address is a reserved
// .example one, and every response is checked for "@". 0 network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { addSendDays, bookDay, onOrNextSendDay, DAILY_CAP } from './outreachSchedule.js';
import { readContacts, parseSegment, parseWarmth } from './outreachImport.js';
import { createCampaign, getCampaign, listCampaigns, updateStep, importRoute, campaignAction, contactAction, contactDraft, campaignSummary, updateCampaign } from './outreachRoutes.js';
import { listActions } from './actionsRoutes.js';
import { runCampaignOutlookMatch, campaignAddresses } from './outreachOutlook.js';

const NOW = new Date('2026-10-22T18:00:00Z'); // Thu Oct 22, 11:00 LA
const TODAY = '2026-10-22';
const B = randomUUID(), JACK = randomUUID(), SEIF = randomUUID(), CYRUS = randomUUID(), OUTSIDER = randomUUID();
const P = { upside: randomUUID(), kestrel: randomUUID() };
const O = { brightmill: randomUUID() };

const noAt = (label, v) => assert.ok(!JSON.stringify(v).includes('@'), `${label}: a response carried an "@"`);
const later = (ms) => new Date(NOW.getTime() + ms);

const seed = () => ({
  business_members: [
    { business_id: B, user_id: JACK, name: 'Jack Example', role: 'owner' },
    { business_id: B, user_id: SEIF, name: 'Seif Example', role: 'member' },
    { business_id: B, user_id: CYRUS, name: 'Cyrus Example', role: 'member' },
  ],
  sales_goals: [
    { id: P.upside, business_id: B, goal_type: 'partnership', name: 'Harbor Benefits', archived_at: null, pipeline_status: 'replied', owner_team: 'upside', co_owner_name: null },
    { id: P.kestrel, business_id: B, goal_type: 'partnership', name: 'Kestrel Advisors', archived_at: null, pipeline_status: 'not_started', owner_team: 'homelover', co_owner_name: null },
  ],
  sales_opportunities: [{ id: O.brightmill, business_id: B, organization: 'Brightmill Foods', archived_at: null, owner_team: null, co_owner_name: 'Brad' }],
  sales_sequenced_accounts: [], sales_targets: [], partner_domains: [], partner_contacts: [], sales_partner_events: [],
  sales_prospect_state: [{ business_id: B, contact_id: 'ap-1', email: 'quinn@quill.example' }],
  sales_email_messages: [{ business_id: B, contact_id: 'ap-1', sequence_id: 'seq-1', apollo_message_id: 'm-1' }],
  sales_outreach_campaigns: [], sales_outreach_tracks: [], sales_outreach_steps: [], sales_outreach_contacts: [], sales_outreach_events: [],
  sales_week_goals: [], sales_signals: [], sales_suggestions: [], sales_week_goal_steps: [], sales_call_notes: [],
  microsoft_messages: [],
});
const unique = {
  sales_outreach_contacts: r => `${r.campaign_id}|${String(r.email).toLowerCase()}`,
  sales_goals: r => `${r.business_id}|${r.name.toLowerCase()}`,
};
const db = () => fakeSupabase(seed(), { unique, now: () => NOW.getTime() });

const HEADER = ['Full Name', 'Title', 'Company', 'Email', 'Segment', 'Knows Seif'];
const ROWS = [
  ['Ana Alder', 'Principal', 'Alder Consulting', 'ana@alder.example', 'Consultant', 'Yes'],          // 2 ok
  ['Ben Birch', 'VP HR', 'Kestrel Advisors', 'ben@kestrel.example', 'Broker', 'no'],                // 3 in pipeline (partner)
  ['Cleo Cedar', 'CHRO', 'Harbor Benefits', 'cleo@harbor.example', 'Broker', 'yes'],              // 4 Upside -> skip
  ['Dev Dune', 'CFO', 'Brightmill Foods', 'dev@brightmill.example', 'Corporate', 'no'],           // 5 Brad co-owner -> skip
  ['Ana Again', 'Principal', 'Alder Consulting', 'ANA@alder.example', 'Consultant', 'yes'],       // 6 dup in sheet
  ['Eli Elm', 'Benefits Lead', 'Elm Works', '', 'Corporate', 'yes'],                               // 7 missing email
  ['Fay Fir', 'Owner', 'Fir Group', 'not-an-address', 'Corporate', 'yes'],                         // 8 bad email
  ['Quinn Quill', 'COO', 'Quill Labs', 'quinn@quill.example', 'Corporate', 'yes'],                // 9 in Apollo sequence
  ['Gus Gale', 'Director', 'Gale Co', 'gus@gale.example', '', ''],                                 // 10 no track
];
async function sheet(rows = ROWS, header = HEADER) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Contacts');
  ws.getRow(1).values = header;
  rows.forEach((r, i) => { ws.getRow(2 + i).values = r; });
  return { name: 'contacts.xlsx', data: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64') };
}
const csv = text => ({ name: 'c.csv', data: Buffer.from(text).toString('base64') });

async function newCampaign(s, over = {}) {
  const r = await createCampaign(s, { businessId: B, userId: JACK, body: { name: 'Seif fall campaign', sender_user_id: SEIF, owner_user_ids: [SEIF], ...over } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
async function writeAllSteps(s, campaignId) {
  const { body } = await getCampaign(s, { businessId: B, id: campaignId });
  for (const t of body.tracks) for (const st of t.steps) {
    const r = await updateStep(s, { businessId: B, id: campaignId, stepId: st.id, userId: JACK, body: { subject: `Step ${st.step_no} for {company}`, body: `Hi {first_name}, as {title} at {company} - step ${st.step_no}.` } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
}
// A campaign with every step written and the fixture sheet imported (rows 2, 3, 8->skip ... see ROWS).
async function imported(s) {
  const { campaign } = await newCampaign(s);
  await writeAllSteps(s, campaign.id);
  const r = await importRoute(s, { businessId: B, id: campaign.id, userId: JACK, body: { file: await sheet(), dryRun: false } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { campaign, imp: r.body };
}
const contactByName = (s, name) => s.db.sales_outreach_contacts.find(c => c.name === name);

test('send days: Mon-Thu only; offsets count send days; the cap moves the 41st to the next send day', () => {
  assert.equal(onOrNextSendDay('2026-10-23'), '2026-10-26'); // Fri -> Mon
  assert.equal(onOrNextSendDay('2026-10-25'), '2026-10-26'); // Sun -> Mon
  assert.equal(addSendDays('2026-10-22', 4), '2026-10-29');  // Thu +4 = Mon Tue Wed Thu
  assert.equal(addSendDays('2026-10-22', 10), '2026-11-10'); // Mon26 .. Thu5, Mon9, Tue10
  assert.equal(addSendDays('2026-10-24', 0), '2026-10-26');
  const load = new Map();
  const days = Array.from({ length: DAILY_CAP + 1 }, () => bookDay('2026-10-22', load));
  assert.equal(days.filter(d => d === '2026-10-22').length, DAILY_CAP);
  assert.equal(days[DAILY_CAP], '2026-10-26');
});

test('sheet reading: header found below title rows, segment / warmth words, CSV too', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('S');
  ws.getRow(1).values = ['Seif contacts - cleaned by Marina'];
  ws.getRow(3).values = ['First Name', 'Last Name', 'Job Title', 'Organization', 'E-mail', 'List', 'Relationship'];
  ws.getRow(4).values = ['Ana', 'Alder', 'Principal', 'Alder Consulting', 'Ana@Alder.example', 'Direct corporate client', "doesn't know"];
  const r = await readContacts({ name: 'x.xlsx', data: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64') });
  assert.equal(r.header_row, 3);
  assert.deepEqual(r.rows[0], { n: 4, name: 'Ana Alder', title: 'Principal', company: 'Alder Consulting', email: 'ana@alder.example', segment: 'corporate', warmth: 'cold' });
  noAt('columns', { headers: r.headers, columns: r.columns });
  const c = await readContacts(csv('Name,Company,Email,Type,Warmth\n"Bo, Jr",Birch LLC,bo@birch.example,Broker,warm\n'));
  assert.equal(c.rows[0].name, 'Bo, Jr');
  assert.equal(c.rows[0].segment, 'consultant_broker');
  assert.equal(c.rows[0].warmth, 'warm');
  for (const [v, want] of [['Consultant', 'consultant_broker'], ['Channel partner', 'consultant_broker'], ['Corporate', 'corporate'], ['', null], ['???', null]]) assert.equal(parseSegment(v), want, v);
  for (const [v, want] of [['Yes', 'warm'], ['knows Seif', 'warm'], ['No', 'cold'], ['unknown', 'cold'], ['', null]]) assert.equal(parseWarmth(v), want, v);
  await assert.rejects(readContacts(csv('Company,Phone\nAcme,1\n')), /no header row with a name and an email column/);
});

test('create: 4 tracks x 3 steps at day 0 / +4 / +10; ids outside the workspace refused', async () => {
  const s = db();
  const { campaign, tracks } = await newCampaign(s);
  assert.equal(campaign.status, 'draft');
  assert.equal(tracks.length, 4);
  assert.deepEqual(tracks.map(t => t.name), ['Consultants / brokers · knows Seif', "Consultants / brokers · doesn't know Seif", 'Corporate · knows Seif', "Corporate · doesn't know Seif"]);
  for (const t of tracks) assert.deepEqual(t.steps.map(st => [st.step_no, st.day_offset]), [[1, 0], [2, 4], [3, 10]]);
  const bad = await createCampaign(s, { businessId: B, userId: JACK, body: { name: 'X', sender_user_id: OUTSIDER } });
  assert.equal(bad.status, 400);
  assert.equal((await updateCampaign(s, { businessId: B, id: campaign.id, body: { owner_user_ids: [OUTSIDER] } })).status, 400);
  assert.equal((await updateCampaign(s, { businessId: B, id: campaign.id, body: { status: 'active' } })).status, 400);
});

test('import preview: every flag per row, Brad / Upside skipped by default, no address anywhere; commit adds the rest', async () => {
  const s = db();
  const { campaign } = await newCampaign(s);
  const pre = await importRoute(s, { businessId: B, id: campaign.id, userId: JACK, body: { file: await sheet() } });
  assert.equal(pre.status, 200, JSON.stringify(pre.body));
  noAt('preview', pre.body);
  const by = Object.fromEntries(pre.body.rows.map(r => [r.row, r]));
  assert.deepEqual([by[2].would, by[2].reasons], ['add', []]);
  assert.equal(by[2].track, 'Consultants / brokers · knows Seif');
  assert.deepEqual([by[3].would, by[3].reasons, by[3].match.type], ['add', ['in_pipeline'], 'partner']);
  assert.deepEqual([by[4].would, by[4].reasons], ['skip', ['brad', 'in_pipeline']]);
  assert.deepEqual([by[5].would, by[5].reasons], ['skip', ['brad', 'in_pipeline']]);
  assert.deepEqual([by[6].would, by[6].reasons], ['skip', ['dup_sheet']]);
  assert.deepEqual([by[7].would, by[7].reasons, by[7].has_email], ['skip', ['missing_email'], false]);
  assert.deepEqual([by[8].would, by[8].reasons], ['skip', ['bad_email']]);
  assert.deepEqual([by[9].would, by[9].reasons], ['add', ['in_apollo']]);
  assert.deepEqual([by[10].would, by[10].reasons, by[10].track], ['add', ['no_track'], null]);
  assert.equal(pre.body.added, 0);
  assert.equal(s.db.sales_outreach_contacts.length, 0, 'a preview writes nothing');
  assert.deepEqual([pre.body.counts.add, pre.body.counts.skip], [4, 5]);

  const commit = await importRoute(s, { businessId: B, id: campaign.id, userId: JACK, body: { file: await sheet(), dryRun: false, include: [4] } });
  noAt('commit', commit.body);
  assert.equal(commit.body.added, 5);
  const rows = s.db.sales_outreach_contacts;
  assert.deepEqual(rows.map(r => r.import_row).sort((a, b) => a - b), [2, 3, 4, 9, 10]);
  assert.ok(rows.every(r => r.status === 'queued' && r.owner_user_id === SEIF && r.email === r.email.toLowerCase()));
  assert.equal(contactByName(s, 'Ben Birch').goal_id, P.kestrel);
  assert.match(contactByName(s, 'Cleo Cedar').conflict, /Brad's \/ Upside's company/);
  assert.match(contactByName(s, 'Quinn Quill').conflict, /Apollo sequence/);
  assert.equal(contactByName(s, 'Gus Gale').track_id, null);

  const again = await importRoute(s, { businessId: B, id: campaign.id, userId: JACK, body: { file: await sheet(), dryRun: false, defaults: { segment: 'corporate', warmth: 'warm' } } });
  assert.equal(again.body.added, 0);
  assert.deepEqual(again.body.rows.filter(r => r.reasons.includes('in_campaign')).map(r => r.row), [2, 3, 4, 9, 10]);

  const got = await getCampaign(s, { businessId: B, id: campaign.id });
  noAt('campaign', got.body);
  assert.equal(got.body.contacts.length, 5);
  assert.ok(got.body.contacts.every(c => !('email' in c) && c.has_email));
});

test('activate: refused until step 1 is written; then starts spread under the cap, no-track contacts stay queued', async () => {
  const s = db();
  const { campaign } = await newCampaign(s);
  await importRoute(s, { businessId: B, id: campaign.id, userId: JACK, body: { file: await sheet(), dryRun: false } });
  const refused = await campaignAction(s, { businessId: B, id: campaign.id, action: 'activate', now: NOW });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /Write step 1 first/);
  await writeAllSteps(s, campaign.id);
  // 45 more contacts on one track: 40 fit today with the others, the rest go to Monday.
  const many = Array.from({ length: 45 }, (_, i) => [`Pat ${i}`, 'Partner', `Co ${i}`, `pat${i}@co${i}.example`, 'Consultant', 'yes']);
  await importRoute(s, { businessId: B, id: campaign.id, userId: JACK, body: { file: await sheet(many), dryRun: false } });
  const r = await campaignAction(s, { businessId: B, id: campaign.id, action: 'activate', now: NOW });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  noAt('activate', r.body);
  assert.equal(r.body.campaign.status, 'active');
  assert.equal(r.body.scheduled, 48);
  assert.equal(r.body.no_track, 1);
  const due = s.db.sales_outreach_contacts.filter(c => c.status === 'active').map(c => c.next_due_date);
  assert.equal(due.filter(d => d === TODAY).length, DAILY_CAP);
  assert.equal(due.filter(d => d === '2026-10-26').length, 8);
  assert.equal(contactByName(s, 'Gus Gale').status, 'queued');
});

test('Sent advances by the track offsets, a stale step is refused, the last step finishes; Skip / Stop / Undo', async () => {
  const s = db();
  const { campaign } = await imported(s);
  await campaignAction(s, { businessId: B, id: campaign.id, action: 'activate', now: NOW });
  const ana = contactByName(s, 'Ana Alder');
  const sent = await contactAction(s, { businessId: B, id: ana.id, action: 'sent', userId: SEIF, body: { step_no: 1 }, now: NOW });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  noAt('sent', sent.body);
  assert.deepEqual([sent.body.contact.current_step, sent.body.contact.next_due_date, sent.body.contact.status], [2, '2026-10-29', 'active']);
  assert.equal((await contactAction(s, { businessId: B, id: ana.id, action: 'sent', userId: SEIF, body: { step_no: 1 }, now: NOW })).status, 409);

  // Undo: only the person who clicked, only the latest change, puts it back exactly.
  assert.equal((await contactAction(s, { businessId: B, id: ana.id, action: 'undo', userId: JACK, body: { event_id: sent.body.event.id }, now: NOW })).status, 409);
  const undo = await contactAction(s, { businessId: B, id: ana.id, action: 'undo', userId: SEIF, body: { event_id: sent.body.event.id }, now: later(60e3) });
  assert.equal(undo.status, 200, JSON.stringify(undo.body));
  assert.deepEqual([undo.body.contact.current_step, undo.body.contact.next_due_date, undo.body.contact.last_sent_at], [1, TODAY, null]);
  assert.equal(s.db.sales_outreach_events.filter(e => e.contact_id === ana.id).length, 0);

  const s1 = await contactAction(s, { businessId: B, id: ana.id, action: 'sent', userId: SEIF, body: { step_no: 1 }, now: NOW });
  const day2 = s1.body.contact.next_due_date;
  const s2 = await contactAction(s, { businessId: B, id: ana.id, action: 'skip', userId: SEIF, body: { step_no: 2 }, now: new Date(`${day2}T18:00:00Z`) });
  assert.deepEqual([s2.body.contact.current_step, s2.body.contact.next_due_date], [3, addSendDays(day2, 6)]);
  const s3 = await contactAction(s, { businessId: B, id: ana.id, action: 'sent', userId: SEIF, body: { step_no: 3 }, now: new Date(`${s2.body.contact.next_due_date}T18:00:00Z`) });
  assert.deepEqual([s3.body.contact.status, s3.body.contact.next_due_date], ['done', null]);

  const ben = contactByName(s, 'Ben Birch');
  const stop = await contactAction(s, { businessId: B, id: ben.id, action: 'stop', userId: SEIF, now: NOW });
  assert.deepEqual([stop.body.contact.status, stop.body.contact.next_due_date], ['done', null]);
  assert.equal((await contactAction(s, { businessId: B, id: ben.id, action: 'stop', userId: SEIF, now: NOW })).status, 409);
  assert.equal((await contactAction(s, { businessId: B, id: ben.id, action: 'fly', userId: SEIF, now: NOW })).status, 400);
});

test('pause / resume: a contact comes off the schedule and back from today; a paused campaign drops out of Actions', async () => {
  const s = db();
  const { campaign } = await imported(s);
  await campaignAction(s, { businessId: B, id: campaign.id, action: 'activate', now: NOW });
  const ana = contactByName(s, 'Ana Alder');
  const p = await contactAction(s, { businessId: B, id: ana.id, action: 'pause', userId: SEIF, now: NOW });
  assert.deepEqual([p.body.contact.status, p.body.contact.next_due_date], ['queued', null]);
  const r = await contactAction(s, { businessId: B, id: ana.id, action: 'resume', userId: SEIF, now: later(864e5) });
  assert.deepEqual([r.body.contact.status, r.body.contact.next_due_date], ['active', '2026-10-26']);
  let acts = await listActions(s, B, NOW);
  assert.ok(acts.items.some(i => i.kind === 'campaign'));
  await campaignAction(s, { businessId: B, id: campaign.id, action: 'pause', now: NOW });
  acts = await listActions(s, B, NOW);
  assert.ok(!acts.items.some(i => i.kind === 'campaign'));
  const back = await campaignAction(s, { businessId: B, id: campaign.id, action: 'resume', now: new Date('2026-10-27T18:00:00Z') });
  assert.equal(back.body.campaign.status, 'active');
  assert.ok(s.db.sales_outreach_contacts.filter(c => c.status === 'active').every(c => c.next_due_date >= '2026-10-27'), 'overdue sends re-spread from the resume day');
});

test('Actions: sends due today for the owner, never future ones; a reply is P1 until marked or promoted', async () => {
  const s = db();
  const { campaign } = await imported(s);
  await campaignAction(s, { businessId: B, id: campaign.id, action: 'activate', now: NOW });
  const acts = await listActions(s, B, NOW);
  noAt('actions', acts);
  const rows = acts.items.filter(i => i.kind === 'campaign');
  assert.equal(rows.length, 3); // Ana, Ben, Quinn (Gus has no track; Cleo / Dev were skipped)
  const ana = rows.find(i => i.text === 'Send step 1 to Ana Alder (Alder Consulting)');
  assert.ok(ana, rows.map(i => i.text).join(' | '));
  assert.deepEqual([ana.owner_user_id, ana.due_date, ana.priority, ana.meta.action, ana.meta.track], [SEIF, TODAY, 2, 'send', 'Consultants / brokers · knows Seif']);
  const ben = rows.find(i => i.text.startsWith('Send step 1 to Ben Birch'));
  assert.deepEqual([ben.company.type, ben.company.id], ['partner', P.kestrel]);
  const tomorrow = await listActions(s, B, new Date('2026-10-21T18:00:00Z'));
  assert.equal(tomorrow.items.filter(i => i.kind === 'campaign').length, 0, 'not due yet = not on the list');

  const anaRow = contactByName(s, 'Ana Alder');
  await contactAction(s, { businessId: B, id: anaRow.id, action: 'sent', userId: SEIF, body: { step_no: 1 }, now: NOW });
  const rep = await contactAction(s, { businessId: B, id: anaRow.id, action: 'replied', userId: SEIF, now: later(3600e3) });
  assert.deepEqual([rep.body.contact.status, rep.body.contact.next_due_date], ['replied', null]);
  const reply = (await listActions(s, B, later(3600e3))).items.find(i => i.kind === 'campaign' && i.meta.action === 'reply');
  assert.deepEqual([reply.text, reply.priority], ['Reply from Ana Alder (Alder Consulting) — respond', 1]);

  const ben2 = contactByName(s, 'Ben Birch');
  await contactAction(s, { businessId: B, id: ben2.id, action: 'replied', userId: SEIF, now: later(3600e3) });
  const benReply = (await listActions(s, B, later(3600e3))).items.find(i => i.kind === 'campaign' && i.text.startsWith('Reply from Ben'));
  assert.equal(benReply.priority, 1, "a reply stays P1 even when the linked partner's own priority is lower");
  const meet = await contactAction(s, { businessId: B, id: ben2.id, action: 'status', userId: SEIF, body: { status: 'meeting' }, now: later(7200e3) });
  assert.equal(meet.body.contact.status, 'meeting');
  assert.equal((await contactAction(s, { businessId: B, id: ben2.id, action: 'status', userId: SEIF, body: { status: 'vip' }, now: later(7200e3) })).status, 400);
  assert.ok(!(await listActions(s, B, later(7200e3))).items.some(i => i.text.startsWith('Reply from Ben')));
});

test('Promote: a new partner with the campaign source, owner via Assign, the person without an address; once only', async () => {
  const s = db();
  const { campaign } = await imported(s);
  const ana = contactByName(s, 'Ana Alder');
  await contactAction(s, { businessId: B, id: ana.id, action: 'replied', userId: SEIF, now: NOW });
  const r = await contactAction(s, { businessId: B, id: ana.id, action: 'promote', userId: SEIF, body: { owner_user_id: CYRUS }, now: later(60e3) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  noAt('promote', r.body);
  const goal = s.db.sales_goals.find(g => g.name === 'Alder Consulting');
  assert.deepEqual([r.body.record.type, r.body.record.id, goal.channel, goal.pipeline_status, goal.owner_user_id], ['partner', goal.id, 'partner_referral', 'not_started', CYRUS]);
  const note = s.db.sales_partner_events.find(e => e.goal_id === goal.id && e.event === 'note');
  assert.match(note.note, /^From campaign "Seif fall campaign" \(referred by Seif\): Ana Alder, Principal$/);
  assert.ok(s.db.sales_partner_events.some(e => e.goal_id === goal.id && e.event === 'assign'));
  const person = s.db.partner_contacts.find(p => p.goal_id === goal.id);
  assert.deepEqual([person.name, person.title, person.email], ['Ana Alder', 'Principal', undefined]);
  assert.equal(contactByName(s, 'Ana Alder').goal_id, goal.id);
  assert.ok(!(await listActions(s, B, later(60e3))).items.some(i => i.text.startsWith('Reply from Ana')));
  assert.equal((await contactAction(s, { businessId: B, id: ana.id, action: 'promote', userId: SEIF, body: {}, now: later(120e3) })).status, 409);
  assert.equal((await contactAction(s, { businessId: B, id: ana.id, action: 'undo', userId: SEIF, body: { event_id: r.body.event.id }, now: later(130e3) })).status, 409);

  // A company already in Pipeline is linked, not duplicated, and keeps its owner.
  const ben = contactByName(s, 'Ben Birch');
  const b = await contactAction(s, { businessId: B, id: ben.id, action: 'promote', userId: SEIF, body: { owner_user_id: CYRUS }, now: later(60e3) });
  assert.equal(b.status, 200);
  assert.deepEqual([b.body.record.id, b.body.created], [P.kestrel, false]);
  assert.equal(s.db.sales_goals.filter(g => g.name === 'Kestrel Advisors').length, 1);
  assert.equal(s.db.sales_goals.find(g => g.id === P.kestrel).owner_user_id, undefined);

  // Corporate -> a new employer with the source line in its notes.
  const quinn = contactByName(s, 'Quinn Quill');
  const q = await contactAction(s, { businessId: B, id: quinn.id, action: 'promote', userId: SEIF, body: {}, now: later(60e3) });
  assert.equal(q.body.record.type, 'employer');
  const opp = s.db.sales_opportunities.find(o => o.organization === 'Quill Labs');
  assert.deepEqual([opp.channel, opp.stage], ['partner_referral', 'target']);
  assert.match(opp.notes, /From campaign "Seif fall campaign" \(referred by Seif\): Quinn Quill, COO/);
  noAt('campaign after promotes', (await getCampaign(s, { businessId: B, id: campaign.id })).body);
});

test('draft: the current step with merge fields filled; summary counts for the Dashboard / Needs attention', async () => {
  const s = db();
  const { campaign } = await imported(s);
  await campaignAction(s, { businessId: B, id: campaign.id, action: 'activate', now: NOW });
  const ana = contactByName(s, 'Ana Alder');
  const d = await contactDraft(s, { businessId: B, id: ana.id });
  assert.deepEqual(d.body, { step_no: 1, subject: 'Step 1 for Alder Consulting', body: 'Hi Ana, as Principal at Alder Consulting - step 1.' });
  await contactAction(s, { businessId: B, id: ana.id, action: 'sent', userId: SEIF, body: { step_no: 1 }, now: NOW });
  await contactAction(s, { businessId: B, id: ana.id, action: 'replied', userId: SEIF, now: later(60e3) });
  const sum = await campaignSummary(s, { businessId: B, now: later(60e3) });
  noAt('summary', sum.body);
  assert.deepEqual([sum.body.due_today, sum.body.overdue, sum.body.replies_waiting], [2, 0, 1]);
  assert.deepEqual(sum.body.campaigns.map(c => [c.contacts, c.sent, c.replies, c.meetings]), [[4, 1, 1, 0]]);
  const list = await listCampaigns(s, { businessId: B });
  noAt('list', list.body);
  const k = list.body.campaigns[0].counts;
  assert.deepEqual([k.sent_by_step[1], k.replies, k.reply_rate], [1, 1, 100]);
  assert.equal(k.by_track.find(t => t.name === 'Consultants / brokers · knows Seif').replies, 1);
});

test('Outlook: a send to the address advances the step; a same-day manual Sent is folded; a reply after the first send stops it', async () => {
  const s = db();
  const { campaign } = await imported(s);
  await campaignAction(s, { businessId: B, id: campaign.id, action: 'activate', now: NOW });
  s.db.sales_outreach_campaigns[0].created_at = '2026-10-20T00:00:00Z';
  const ana = contactByName(s, 'Ana Alder'), ben = contactByName(s, 'Ben Birch'), quinn = contactByName(s, 'Quinn Quill');
  const msg = (direction, email, at) => ({ id: randomUUID(), business_id: B, user_id: SEIF, direction, external_emails: [email], external_domains: [email.split('@')[1]], occurred_at: at, synced_at: NOW.toISOString() });
  // Ben: Seif clicked Sent at 9:00 LA, the message itself left at 8:55.
  await contactAction(s, { businessId: B, id: ben.id, action: 'sent', userId: SEIF, body: { step_no: 1 }, now: new Date('2026-10-22T16:00:00Z') });
  s.db.microsoft_messages.push(
    msg('received', 'ana@alder.example', '2026-10-22T15:00:00Z'), // before any send: not a reply
    msg('sent', 'ana@alder.example', '2026-10-22T16:30:00Z'),
    msg('sent', 'ana@alder.example', '2026-10-22T17:00:00Z'),     // same day again: one step per day
    msg('received', 'ana@alder.example', '2026-10-22T17:30:00Z'),
    msg('sent', 'ben@kestrel.example', '2026-10-22T15:55:00Z'),
    msg('sent', 'quinn@quill.example', '2026-10-22T17:10:00Z'),
    { ...msg('sent', 'quinn@quill.example', '2026-10-22T17:20:00Z'), user_id: JACK },  // someone else's mailbox
  );
  const counts = await runCampaignOutlookMatch(s, { businessId: B, userId: SEIF, now: NOW });
  noAt('match counts', counts);
  assert.deepEqual([counts.sent, counts.replied, counts.folded], [2, 1, 1]);
  const a = contactByName(s, 'Ana Alder');
  assert.deepEqual([a.status, a.replied_at, a.next_due_date], ['replied', '2026-10-22T17:30:00Z', null]);
  const b = contactByName(s, 'Ben Birch');
  assert.equal(b.current_step, 2, 'the manual Sent and the Outlook send are one step');
  assert.equal(s.db.sales_outreach_events.filter(e => e.contact_id === ben.id && e.kind === 'sent').length, 1);
  const q = contactByName(s, 'Quinn Quill');
  assert.deepEqual([q.current_step, q.last_sent_at, q.next_due_date], [2, '2026-10-22T17:10:00Z', '2026-10-29']);
  assert.ok(s.db.sales_outreach_events.filter(e => e.source === 'outlook').every(e => e.by_user === null && e.meta.message_id && !JSON.stringify(e).includes('@')));
  const again = await runCampaignOutlookMatch(s, { businessId: B, userId: SEIF, now: NOW });
  assert.deepEqual([again.sent, again.replied, again.folded], [0, 0, 0], 'a re-run recognises its own work');
  assert.equal(quinn.id, q.id);
  assert.deepEqual(await runCampaignOutlookMatch(s, { businessId: B, userId: JACK, now: NOW }), { campaigns: 0, contacts: 0, sent: 0, replied: 0, folded: 0, skipped: 0 });
});

test('B6a keep set: live campaigns only, opted-out / bounced / not-interested contacts dropped', async () => {
  const s = db();
  const { campaign } = await imported(s);
  assert.equal((await campaignAddresses(s, B)).size, 0, 'a draft campaign keeps nothing');
  await campaignAction(s, { businessId: B, id: campaign.id, action: 'activate', now: NOW });
  const ana = contactByName(s, 'Ana Alder');
  await contactAction(s, { businessId: B, id: ana.id, action: 'status', userId: SEIF, body: { status: 'opted_out' }, now: NOW });
  const keep = await campaignAddresses(s, B);
  assert.equal(keep.size, 3); // Ben, Quinn, Gus
  assert.ok(!keep.has('ana@alder.example') && keep.has('ben@kestrel.example'));
});

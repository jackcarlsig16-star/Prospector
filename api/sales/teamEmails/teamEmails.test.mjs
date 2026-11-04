import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fakeSupabase } from '../testing/fakeSupabase.mjs';
import { MICROSOFT_SCOPES, missingScopes, grantedScopes, refreshBody, canSendTeamEmail, NeedsMicrosoft } from '../../lib/microsoftGrants.js';
import { sendTeamEmail, teamRecipients, assertMembers, loadMembers, RECONNECT_NOTE } from './send.js';
import { laClock, dueSlots, tick, WEEKDAYS } from './scheduler.js';
import { periodFor, laInstant, buildVisitorEmail, loadVisitorData, TOP_N } from './visitorEmail.js';
import { dueAlerts, sendClientAlert, buildClientAlert, lookalikeTag, WAIT_MIN } from './clientAlert.js';
import { cronPull, visitorEmailJob, hlJobs } from './jobs.js';
import { teamEmailState, updateTeamEmails, setMine, EXPIRED_NOTE } from './settings.js';
import { TRIGGERS } from '../visitPull.js';

const B = '00000000-0000-4000-8000-0000000000b1';
const OTHER = '00000000-0000-4000-8000-0000000000b2';
const U = { owner: '00000000-0000-4000-8000-0000000000a1', owner2: '00000000-0000-4000-8000-0000000000a2', m1: '00000000-0000-4000-8000-0000000000a3', m2: '00000000-0000-4000-8000-0000000000a4', out: '00000000-0000-4000-8000-0000000000a9' };
const MAIL = { owner: 'owner@example.test', m1: 'casey@example.test', m2: 'robin@example.test', out: 'outsider@example.test' };
const READS = ['Calendars.Read', 'Mail.Read', 'openid', 'User.Read'];
const NOW = Date.parse('2026-11-04T15:00:00Z'); // Wed Nov 4, 07:00 PST

function seed(extra = {}) {
  return {
    business_members: [
      { business_id: B, user_id: U.owner, role: 'owner', email: MAIL.owner, created_at: '2026-01-01' },
      // The owner's second sign-in on the same address: one email, not two.
      { business_id: B, user_id: U.owner2, role: 'member', email: MAIL.owner, created_at: '2026-01-02' },
      { business_id: B, user_id: U.m1, role: 'member', email: MAIL.m1, created_at: '2026-01-03' },
      { business_id: B, user_id: U.m2, role: 'member', email: MAIL.m2, created_at: '2026-01-04' },
      { business_id: OTHER, user_id: U.out, role: 'owner', email: MAIL.out, created_at: '2026-01-01' },
    ],
    profiles: [
      { id: U.owner, email: MAIL.owner, display_name: 'Alex Owner' }, { id: U.owner2, email: MAIL.owner.toUpperCase(), display_name: 'Alex Owner' },
      { id: U.m1, email: MAIL.m1, display_name: 'Casey Member' }, { id: U.m2, email: MAIL.m2, display_name: 'Robin Member' }, { id: U.out, email: MAIL.out, display_name: 'Out Sider' },
    ],
    sales_team_email_settings: [{ business_id: B, sender_user_id: null, visitor_on: true, client_on: true, client_alert_since: '2026-11-01T00:00:00Z' }],
    sales_team_email_optouts: [], sales_team_email_sends: [], sales_job_slots: [], sales_client_events: [], sales_targets: [], sales_opportunities: [],
    web_visits: [], sales_people: [], sales_company_scores: [], sales_goals: [], visit_pull_runs: [],
    ...extra,
  };
}
const sb = (extra, opts = {}) => fakeSupabase(seed(extra), { unique: { sales_job_slots: r => `${r.job}|${r.scope}|${r.slot}` }, ...opts });

// Graph stub: records every call; never touches the network.
function graph({ grant = { scopes: [...READS, 'Mail.Send'], error: null }, token = () => 'tok', status = 202 } = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      getGrant: async () => grant,
      accessTokenFor: async id => token(id),
      fetch: async (url, init) => { calls.push({ url, init, mime: Buffer.from(init.body, 'base64').toString('utf8') }); return { status, ok: status < 300, json: async () => ({ error: { code: 'ErrorX' } }) }; },
    },
  };
}
const toOf = mime => mime.split('\r\n').find(l => l.startsWith('To: ')).slice(4).split(', ');
const msg = { kind: 'visitor', subject: 'Website visitors — test', html: '<p>hi</p>', text: 'hi' };

test('scopes: reads + Mail.Send asked for; a grant without Mail.Send still connects (only reads are required)', () => {
  assert.deepEqual(MICROSOFT_SCOPES, ['openid', 'offline_access', 'User.Read', 'Mail.Read', 'Calendars.Read', 'Mail.Send']);
  assert.ok(!MICROSOFT_SCOPES.some(s => /write|readwrite/i.test(s)));
  assert.deepEqual(missingScopes(grantedScopes('User.Read Mail.Read Calendars.Read openid')), []);
  assert.deepEqual(grantedScopes('https://graph.microsoft.com/Mail.Send Mail.Read'), ['Mail.Send', 'Mail.Read']);
});

test('T-b: a grant without Mail.Send refreshes with exactly its stored scopes (+ offline_access), never Mail.Send', () => {
  const body = refreshBody({ scopes: READS }, 'rt');
  assert.deepEqual(body.get('scope').split(' ').sort(), ['offline_access', ...READS].sort());
  assert.ok(!/mail\.send/i.test(body.get('scope')));
  assert.equal(body.get('grant_type'), 'refresh_token');
  assert.ok(/Mail\.Send/.test(refreshBody({ scopes: [...READS, 'Mail.Send'] }, 'rt').get('scope')));
  assert.equal(canSendTeamEmail({ scopes: READS }), false);
  assert.equal(canSendTeamEmail({ scopes: [...READS, 'Mail.Send'], error: 'expired' }), false);
});

test('T-b: team emails show "Reconnect to allow team emails" for a grant without Mail.Send', async () => {
  const s = sb();
  const r = await teamEmailState(s, B, U.m1, { grantOf: async id => (id === U.owner ? { scopes: READS, error: null } : null) });
  assert.equal(r.status, 200);
  assert.equal(r.body.ready, false);
  assert.equal(r.body.banner, RECONNECT_NOTE);
  assert.equal(RECONNECT_NOTE, 'Reconnect to allow team emails');
  assert.deepEqual(r.body.recipients.visitor.sort(), ['Alex', 'Casey', 'Robin']);
  assert.ok(!JSON.stringify(r.body).includes('@'));
});

const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));
const API = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const SOURCES = walk(API).filter(f => /\.(m?js)$/.test(f) && !/\.test\.m?js$/.test(f) && !f.includes(`${path.sep}testing${path.sep}`));

test('the only Graph write in api/ is sendMail, only sendTeamEmail calls it, and nothing can hand it an address', async () => {
  const graphWriters = SOURCES.filter(f => { const t = fs.readFileSync(f, 'utf8'); return /(graph\.microsoft\.com|GRAPH_URL\(\))/.test(t) && /method:\s*'(POST|PATCH|PUT|DELETE)'/.test(t) && !/oauth2\/v2\.0|authority\(\)/.test(t.replace(/[\s\S]*?(?=method)/, '')); });
  const sendMail = SOURCES.filter(f => /sendMail/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(sendMail.map(f => path.relative(API, f)), ['sales/teamEmails/send.js']);
  assert.ok(graphWriters.every(f => f.endsWith(`sales${path.sep}teamEmails${path.sep}send.js`) || /callback\.js$/.test(f)), graphWriters.join(', '));
  const callers = SOURCES.filter(f => /sendTeamEmail\(/.test(fs.readFileSync(f, 'utf8')) && !f.endsWith(`teamEmails${path.sep}send.js`));
  assert.deepEqual(callers.map(f => path.relative(API, f)).sort(), ['sales/teamEmails/clientAlert.js', 'sales/teamEmails/jobs.js', 'sales/teamEmails/settings.js']);
  for (const f of callers) assert.ok(!/sendTeamEmail\([^)]*\b(to|cc|bcc|recipients?|address(es)?|email)\s*:/.test(fs.readFileSync(f, 'utf8')), f);
  const g = graph();
  for (const k of ['to', 'cc', 'bcc', 'recipients', 'email']) await assert.rejects(sendTeamEmail(sb(), B, { ...msg, [k]: [MAIL.out] }, g.deps), /takes no/);
  assert.equal(g.calls.length, 0);
});

test('recipients: distinct addresses (two sign-ins -> one), opt-out respected, a non-member throws', async () => {
  const s = sb({ sales_team_email_optouts: [{ business_id: B, user_id: U.m2, kind: 'visitor' }] });
  const visitor = await teamRecipients(s, B, 'visitor');
  assert.deepEqual(visitor.map(p => p.email).sort(), [MAIL.m1, MAIL.owner]);
  assert.equal((await teamRecipients(s, B, 'client')).length, 3);
  const members = await loadMembers(s, B);
  assert.throws(() => assertMembers([MAIL.m1, MAIL.out], members), /not a member/);
  assert.doesNotThrow(() => assertMembers([MAIL.m1.toUpperCase()], members));
  await assert.rejects(teamRecipients(s, B, 'visitor', { onlyUserId: U.out }), /only a member/);
  assert.deepEqual((await teamRecipients(s, B, 'visitor', { onlyUserId: U.m2 })).map(p => p.email), [MAIL.m2]);
});

test('send: one multipart (text + HTML) message from the owner\'s grant to the distinct members; the log keeps a count', async () => {
  const s = sb(), g = graph();
  const r = await sendTeamEmail(s, B, msg, g.deps);
  assert.equal(r.status, 'sent');
  assert.equal(r.recipients, 3);
  assert.equal(g.calls.length, 1);
  assert.match(g.calls[0].url, /\/me\/sendMail$/);
  assert.deepEqual(toOf(g.calls[0].mime).sort(), [MAIL.m1, MAIL.owner, MAIL.m2].sort());
  assert.match(g.calls[0].mime, /multipart\/alternative[\s\S]*text\/plain[\s\S]*text\/html/);
  const row = s.db.sales_team_email_sends[0];
  assert.equal(row.recipients, 3);
  assert.ok(!JSON.stringify(row).includes('@'));
  const t = await sendTeamEmail(s, B, { ...msg, test: true, onlyUserId: U.m1 }, g.deps);
  assert.equal(t.recipients, 1);
  assert.deepEqual(toOf(g.calls[1].mime), [MAIL.m1]);
});

test('expired grant / no Mail.Send: no send, a needs_reconnect row, the banner; never retried', async () => {
  const expired = graph({ token: () => { throw new NeedsMicrosoft('Microsoft access expired or was revoked - reconnect'); } });
  const s = sb();
  const r = await sendTeamEmail(s, B, msg, expired.deps);
  assert.equal(r.status, 'needs_reconnect');
  assert.equal(expired.calls.length, 0);
  const noSend = graph({ grant: { scopes: READS, error: null } });
  assert.equal((await sendTeamEmail(s, B, msg, noSend.deps)).status, 'needs_reconnect');
  assert.equal(noSend.calls.length, 0);
  assert.deepEqual(s.db.sales_team_email_sends.map(x => [x.status, x.recipients]), [['needs_reconnect', 0], ['needs_reconnect', 0]]);
  const st = await teamEmailState(s, B, U.owner, { grantOf: async () => ({ scopes: [...READS, 'Mail.Send'], error: null }) });
  assert.equal(st.body.banner, EXPIRED_NOTE);
  assert.equal(st.body.sends.length, 2);
});

test('DST: 07:00 LA is due at 07:00 LA on both sides of Nov 1 2026 and Mar 14 2027, never an hour off', () => {
  const job = [{ name: 'team-visitor-email', at: '07:00', days: WEEKDAYS }];
  for (const [iso, due] of [
    ['2026-10-30T14:00:00Z', true], ['2026-10-30T13:59:00Z', false], // Fri, PDT
    ['2026-11-02T15:00:00Z', true], ['2026-11-02T14:00:00Z', false], // Mon, PST: 14:00Z is 06:00
    ['2027-03-12T15:00:00Z', true], ['2027-03-12T14:00:00Z', false], // Fri, PST
    ['2027-03-15T14:00:00Z', true], ['2027-03-15T13:00:00Z', false], // Mon, PDT: 13:00Z is 06:00
    ['2026-11-07T15:00:00Z', false], // Saturday
  ]) assert.equal(dueSlots(job, Date.parse(iso)).length === 1, due, iso);
  assert.equal(laClock(Date.parse('2026-11-02T15:00:00Z')).hm, '07:00');
  assert.equal(laInstant('2026-11-02', '07:00'), Date.parse('2026-11-02T15:00:00Z'));
  assert.equal(laInstant('2027-03-15', '07:00'), Date.parse('2027-03-15T14:00:00Z'));
});

test('one run per slot across two instances and a restart; catch-up inside 2 h only', async () => {
  const s = sb();
  let runs = 0;
  const jobs = [{ name: 'team-visitor-email', at: '07:00', days: WEEKDAYS, run: async () => { runs++; return { ok: true }; } }];
  const scopes = async () => [B];
  const quiet = () => {};
  await Promise.all([tick(s, { jobs, scopes, now: NOW, log: quiet }), tick(s, { jobs, scopes, now: NOW, log: quiet })]);
  await tick(s, { jobs, scopes, now: NOW + 60e3, log: quiet }); // the next minute
  await tick(s, { jobs, scopes, now: NOW + 30 * 60e3, log: quiet }); // a restart half an hour later
  assert.equal(runs, 1);
  assert.equal(s.db.sales_job_slots[0].status, 'ok');
  const late = sb();
  await tick(late, { jobs, scopes, now: NOW + 90 * 60e3, log: quiet }); // was asleep at 07:00: caught up at 08:30
  assert.equal(runs, 2);
  const tooLate = sb();
  await tick(tooLate, { jobs, scopes, now: NOW + 121 * 60e3, log: quiet });
  assert.equal(runs, 2);
});

test('the Apollo sync rides the scheduler daily at 06:00 LA (weekends too); the others are weekday-only', () => {
  const list = hlJobs({ runApolloSync: async () => ({}), pull: async () => ({}), deps: {} });
  const by = Object.fromEntries(list.map(j => [j.name, j]));
  assert.equal(by['apollo-sync'].at, '06:00');
  assert.equal(by['apollo-sync'].days.length, 7);
  assert.deepEqual([by['visitor-pull'].at, by['team-visitor-email'].at], ['06:30', '07:00']);
  assert.ok(dueSlots(list, Date.parse('2026-11-07T14:00:00Z')).some(d => d.job.name === 'apollo-sync')); // Sat 06:00 PST
  assert.ok(TRIGGERS.includes('cron'));
});

test('Monday covers Fri 07:00 -> Mon 07:00; Tuesday covers Mon 07:00 -> Tue 07:00', () => {
  const mon = periodFor('2026-11-09');
  assert.equal(new Date(mon.since).toISOString(), '2026-11-06T15:00:00.000Z');
  assert.equal(new Date(mon.until).toISOString(), '2026-11-09T15:00:00.000Z');
  assert.equal(new Date(periodFor('2026-11-10').since).toISOString(), '2026-11-09T15:00:00.000Z');
});

const co = (i, extra = {}) => ({ company: `Company ${String(i).padStart(2, '0')}`, type: null, id: null, score: 100 - i, band: i < 3 ? 'P1' : 'P3', visits: 2, visitors: 1, people: 0, titles: [], top_page: '/', stage: null, owner: 'Unassigned', is_new: i % 2 === 0, ...extra });

test('top 10 + "and n more"; 10 or fewer shows all; zero says so', () => {
  const big = buildVisitorEmail(Array.from({ length: 14 }, (_, i) => co(i)), { date: '2026-11-04', since: NOW - 864e5 });
  assert.equal(big.rows, TOP_N);
  assert.match(big.text, /and 4 more → open the Map/);
  assert.equal(big.subject, 'Website visitors — Wed Nov 4: 14 companies, 3 high intent');
  assert.equal((big.text.match(/^\d+\. /gm) || []).length, 10);
  const small = buildVisitorEmail(Array.from({ length: 10 }, (_, i) => co(i)), { date: '2026-11-04', since: NOW - 864e5 });
  assert.equal(small.rows, 10);
  assert.ok(!/more →/.test(small.text));
  const none = buildVisitorEmail([], { date: '2026-11-04', since: NOW - 864e5 });
  assert.match(none.text, /No identified visitors since/);
  assert.match(none.text, /Sent by Prospector to the HomeLover team · turn off in Settings › Team emails/);
  assert.ok(!/<img|pixel/i.test(big.html));
});

test('the visitor email body carries titles only - no person names, emails or phones', async () => {
  const visit = { id: '00000000-0000-4000-8000-00000000c001', business_id: B, company_key: 'acme', company_name: 'Acme Health', visits_7d: 5, unique_visitors_7d: 2, top_paths: [{ path: '/pricing', visits: 3 }], intent_score: 71, priority: 'P1', matched_type: 'opportunity', matched_id: '00000000-0000-4000-8000-00000000d001', pulled_on: '2026-11-04', created_at: '2026-11-04T14:00:00Z', updated_at: '2026-11-04T14:00:00Z' };
  const s = sb({
    web_visits: [visit],
    sales_people: [{ id: 'p1', business_id: B, visit_id: visit.id, name: 'Jordan Visitorperson', title: 'VP People', archived_at: null }, { id: 'p2', business_id: B, visit_id: visit.id, name: 'Sam Otherperson', title: 'Benefits Lead 312-555-0199', archived_at: null }],
    sales_opportunities: [{ id: visit.matched_id, business_id: B, organization: 'Acme Health', stage: 'contacted', owner_user_id: U.m1, client_status: null }],
    sales_company_scores: [{ business_id: B, company_type: 'employer', company_id: visit.matched_id, score: 74, band: 'P1' }],
  });
  const members = await loadMembers(s, B);
  const { since, until } = periodFor('2026-11-04');
  const rows = await loadVisitorData(s, B, { since, until, members });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].owner, 'Casey');
  assert.equal(rows[0].score, 74);
  const mail = buildVisitorEmail(rows, { date: '2026-11-04', since });
  const body = mail.html + mail.text;
  assert.match(body, /Acme Health/);
  assert.match(body, /VP People/);
  assert.match(body, /\/pricing/);
  assert.ok(!/Jordan|Visitorperson|Otherperson|Sam /.test(body));
  assert.ok(!/@/.test(body));
  assert.ok(rows[0].is_new);
});

test('a stuck or failed pull never blocks the email: it sends with the stored data and says so', async () => {
  const s = sb({ visit_pull_runs: [{ business_id: B, status: 'ok', updated_at: '2026-11-03T14:31:00Z' }] });
  const g = graph();
  const r = await visitorEmailJob(s, B, { now: NOW, pull: async () => ({ status: 502, body: { error: 'Visitor pull failed: x' } }), deps: g.deps });
  assert.equal(r.status, 'sent');
  assert.match(Buffer.from(g.calls[0].mime.split('\r\n\r\n')[2].split('\r\n--')[0].replace(/\r\n/g, ''), 'base64').toString('utf8'), /Visitor pull failed at .* — numbers are from Tue, Nov 3/);
  const stuck = await cronPull(s, B, { pull: () => new Promise(() => {}), now: NOW, timeoutMs: 20 });
  assert.equal(stuck.ok, false);
  assert.match(stuck.error, /timed out/);
  let seen;
  await cronPull(s, B, { pull: async (_s, a) => { seen = a; return { status: 200, body: { ran: false, reason: 'Visitors already pulled today' } }; }, now: NOW });
  assert.equal(seen.trigger, 'cron');
  assert.equal(seen.userId, U.owner);
  assert.equal(seen.deadline, NOW + 5 * 60e3);
});

const OPP = '00000000-0000-4000-8000-00000000e001';
const clientSeed = (minsAgo, lookalikes = 0) => ({
  sales_opportunities: [{ id: OPP, business_id: B, organization: 'Northwind Care', client_status: 'verbal_yes', eligible_now: 1200, eligible_added: 300, eligible_added_note: 'acquisition', expected_signing_date: '2026-12-01', expected_launch: '2027-01-15', source_kind: 'inbound', source_partner_id: null, owner_user_id: U.m1, champion: 'Dana Champion, VP HR', notes: 'HQ: Austin, TX', next_action: 'Send agreement', next_action_date: '2026-11-06', archived_at: null }],
  sales_client_events: [{ id: 'ev1', business_id: B, opportunity_id: OPP, kind: 'made_client', to_status: 'verbal_yes', at: new Date(NOW - minsAgo * 60e3).toISOString() }],
  sales_targets: Array.from({ length: lookalikes }, (_, i) => ({ id: `00000000-0000-4000-8000-0000000f00${String(i).padStart(2, '0')}`, business_id: B, name: `Lookalike ${i}`, employees: 900 + i, apollo_firmographics: { industry: 'Hospital & Health Care' }, evidence: `${lookalikeTag('Northwind Care')} (via connector) · similar size`, owner_team: i === 0 ? 'upside' : null, source_kind: 'lookalike', source_note: lookalikeTag('Northwind Care'), created_at: new Date(NOW - 60e3).toISOString() })),
});

test('the alert waits out the Undo window, waits for lookalikes up to 30 min, then sends without', async () => {
  const settings = seed().sales_team_email_settings[0];
  assert.equal((await dueAlerts(sb(clientSeed(1, 12)), B, settings, NOW)).length, 0); // inside the 2-min Undo
  assert.equal((await dueAlerts(sb(clientSeed(5)), B, settings, NOW)).length, 0); // waiting for lookalikes
  const withL = await dueAlerts(sb(clientSeed(5, 12)), B, settings, NOW);
  assert.equal(withL.length, 1);
  assert.equal(withL[0].lookalikes.length, 12);
  assert.equal((await dueAlerts(sb(clientSeed(WAIT_MIN + 1)), B, settings, NOW)).length, 1);
  assert.equal((await dueAlerts(sb(clientSeed(5, 12)), B, { ...settings, client_alert_since: new Date(NOW).toISOString() }, NOW)).length, 0); // made before setup
});

test('alert once per company: a second tick, an edit or a second instance never resends; Activity marks it sent', async () => {
  const s = sb(clientSeed(5, 12)), g = graph();
  const settings = s.db.sales_team_email_settings[0];
  const [due] = await dueAlerts(s, B, settings, NOW);
  const [a, b] = await Promise.all([sendClientAlert(s, B, due, g.deps), sendClientAlert(s, B, due, g.deps)]);
  assert.deepEqual([a?.status, b], ['sent', null]);
  s.db.sales_client_events.push({ id: 'ev2', business_id: B, opportunity_id: OPP, kind: 'status', from_status: 'verbal_yes', to_status: 'signed', at: new Date(NOW - 3 * 60e3).toISOString() });
  assert.equal((await dueAlerts(s, B, settings, NOW + 60e3)).length, 0);
  assert.equal(g.calls.length, 1);
  const mark = s.db.sales_client_events.find(e => e.kind === 'alert_sent');
  assert.equal(mark.meta.recipients, 3);
  assert.equal(mark.via, 'scheduler');
});

test('the alert body: the client\'s facts, the contact\'s title only, 10 lookalikes at the bottom with the Upside flag', () => {
  const row = clientSeed(5).sales_opportunities[0];
  const lk = clientSeed(5, 12).sales_targets;
  const m = buildClientAlert(row, { lookalikes: lk, partnerName: 'Harbor Benefits', network: { clients: 3, lives: 4500 }, ownerName: 'Casey' });
  assert.equal(m.subject, 'New client: Northwind Care — Verbal yes');
  assert.equal(m.lookalikes, 10);
  assert.match(m.text, /Primary contact: VP HR/);
  assert.ok(!/Dana|Champion/.test(m.text + m.html));
  assert.match(m.text, /Eligible lives: 1,200 eligible now · \+300 being added \(acquisition\)/);
  assert.match(m.text, /HQ: Austin, TX/);
  assert.match(m.text, /Referred by Harbor Benefits — Harbor Benefits's network: 3 clients · 4,500 lives/);
  assert.ok(m.text.indexOf('10 lookalikes') > m.text.indexOf('Next step'));
  assert.match(m.text, /1\. Lookalike 0 · 900 employees · Hospital & Health Care · similar size · Upside-owned/);
  assert.ok(!/Lookalike 10|Lookalike 11/.test(m.text));
  assert.ok(!/@/.test(m.text + m.html));
  assert.match(buildClientAlert(row, {}).text, /No lookalikes yet — run \/apollo-deals/);
});

test('settings: only the owner picks the sender (a member whose grant can send); admins+ switch emails; members set their own', async () => {
  const s = sb();
  const can = async id => (id === U.m1 ? { scopes: [...READS, 'Mail.Send'], error: null } : { scopes: READS, error: null });
  assert.equal((await updateTeamEmails(s, { businessId: B, userId: U.m1, body: { sender_user_id: U.m1 }, isOwner: false, isAdmin: true, grantOf: can })).status, 403);
  assert.equal((await updateTeamEmails(s, { businessId: B, userId: U.owner, body: { sender_user_id: U.out }, isOwner: true, isAdmin: true, grantOf: can })).status, 400);
  assert.equal((await updateTeamEmails(s, { businessId: B, userId: U.owner, body: { sender_user_id: U.m2 }, isOwner: true, isAdmin: true, grantOf: can })).status, 409);
  const ok = await updateTeamEmails(s, { businessId: B, userId: U.owner, body: { sender_user_id: U.m1 }, isOwner: true, isAdmin: true, grantOf: can });
  assert.equal(ok.body.sender.first_name, 'Casey');
  assert.equal(ok.body.ready, true);
  assert.equal((await updateTeamEmails(s, { businessId: B, userId: U.m2, body: { visitor_on: false }, isOwner: false, isAdmin: false, grantOf: can })).status, 403);
  assert.equal((await updateTeamEmails(s, { businessId: B, userId: U.m2, body: { to: 'x' }, isOwner: true, isAdmin: true, grantOf: can })).status, 400);
  await setMine(s, { businessId: B, userId: U.m2, body: { kind: 'visitor', on: false } });
  await setMine(s, { businessId: B, userId: U.m2, body: { kind: 'visitor', on: false } });
  assert.equal(s.db.sales_team_email_optouts.length, 1);
  assert.deepEqual((await teamRecipients(s, B, 'visitor')).map(p => p.firstName).sort(), ['Alex', 'Casey']);
  await setMine(s, { businessId: B, userId: U.m2, body: { kind: 'visitor', on: true } });
  assert.equal(s.db.sales_team_email_optouts.length, 0);
});

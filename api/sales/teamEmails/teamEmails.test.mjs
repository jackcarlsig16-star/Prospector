import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fakeSupabase } from '../testing/fakeSupabase.mjs';
import { MICROSOFT_SCOPES, missingScopes, grantedScopes, refreshBody, canSendTeamEmail, NeedsMicrosoft } from '../../lib/microsoftGrants.js';
import * as sendModule from './send.js';
import { sendTeamEmail, loadMembers, RECONNECT_NOTE, MAX_RECIPIENTS } from './send.js';
import { laClock, dueSlots, tick, WEEKDAYS } from './scheduler.js';
import { dayWindowFor, windowDays, laInstant, buildVisitorEmail, loadVisitorData, loadRankedBook, loadCumulative, TOP_N, BAND_WORD, QUALIFIED_WORDS, FOOTER_WORDS, SETTINGS_URL, thresholdWords } from './visitorEmail.js';
import { DEFAULT_WEIGHTS } from '../intentScore.js';
import { missedSlots, MISSED_REASON, schedulerState } from './scheduler.js';
import { EMAIL_CATCHUP_MIN, VISITOR_EMAIL_JOB } from './jobs.js';
import { sendNow } from './settings.js';
import { visitorEmailLine } from '../attentionRoutes.js';
import { esc } from './format.js';
import { dueAlerts, sendClientAlert, buildClientAlert, lookalikeTag, WAIT_MIN } from './clientAlert.js';
import { cronPull, visitorEmailJob, clientAlertsJob, hlJobs, schedulerLine } from './jobs.js';
import { teamEmailState, updateTeamEmails, addRecipient, editRecipient, removeRecipient, undoChange, sendTest, EXPIRED_NOTE, UNDO_MS } from './settings.js';
import { TRIGGERS } from '../visitPull.js';

const B = '00000000-0000-4000-8000-0000000000b1';
const OTHER = '00000000-0000-4000-8000-0000000000b2';
const U = { owner: '00000000-0000-4000-8000-0000000000a1', owner2: '00000000-0000-4000-8000-0000000000a2', m1: '00000000-0000-4000-8000-0000000000a3', m2: '00000000-0000-4000-8000-0000000000a4', out: '00000000-0000-4000-8000-0000000000a9' };
// Reserved test domains only. example.test = the company (the sender's mailbox domain); other.test = outside it.
const MAIL = { owner: 'owner@example.test', m1: 'casey@example.test', m2: 'robin@example.test', out: 'outsider@other.test', team1: 'team-one@example.test', team2: 'team-two@example.test' };
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
    // The list (REV2 T2): two team addresses, one member, one outside the domain (never sent to).
    sales_team_email_recipients: [
      { id: 'r1', business_id: B, address: MAIL.team1, visitor_email: true, client_alert: true, added_at: '2026-11-04T01:00:00Z', archived_at: null },
      { id: 'r2', business_id: B, address: MAIL.team2, visitor_email: true, client_alert: false, added_at: '2026-11-04T01:01:00Z', archived_at: null },
      { id: 'r3', business_id: B, address: MAIL.m1, visitor_email: false, client_alert: true, added_at: '2026-11-04T01:02:00Z', archived_at: null },
      { id: 'r4', business_id: B, address: MAIL.out, visitor_email: true, client_alert: true, added_at: '2026-11-04T01:03:00Z', archived_at: null },
      { id: 'r5', business_id: B, address: 'gone@example.test', visitor_email: true, client_alert: true, added_at: '2026-11-04T01:04:00Z', archived_at: '2026-11-04T02:00:00Z' },
      { id: 'r6', business_id: OTHER, address: 'theirs@example.test', visitor_email: true, client_alert: true, added_at: '2026-11-04T01:05:00Z', archived_at: null },
    ],
    sales_team_email_changes: [], sales_team_email_sends: [], sales_job_slots: [], sales_client_events: [], sales_targets: [], sales_opportunities: [],
    web_visits: [], sales_people: [], sales_company_scores: [], sales_goals: [], visit_pull_runs: [],
    ...extra,
  };
}
const sb = (extra, opts = {}) => fakeSupabase(seed(extra), { unique: { sales_job_slots: r => `${r.job}|${r.scope}|${r.slot}` }, ...opts });

// Graph stub: records every call; never touches the network.
const SENDS = { scopes: [...READS, 'Mail.Send'], error: null, account_email: MAIL.owner, connected_at: '2026-11-03T00:00:00Z' };
function graph({ grant = SENDS, token = () => 'tok', status = 202 } = {}) {
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

test('T-b: team emails show "Reconnect to allow team emails" for a grant without Mail.Send; non-owners see counts, no address', async () => {
  const s = sb();
  const r = await teamEmailState(s, B, U.m1, { grantOf: async id => (id === U.owner ? { ...SENDS, scopes: READS } : null) });
  assert.equal(r.status, 200);
  assert.equal(r.body.ready, false);
  assert.equal(r.body.banner, RECONNECT_NOTE);
  assert.equal(RECONNECT_NOTE, 'Reconnect to allow team emails');
  assert.deepEqual(r.body.counts, { visitor: { count: 2, dropped: 1, capped: 0 }, client: { count: 2, dropped: 1, capped: 0 } });
  assert.equal(r.body.recipients, undefined);
  assert.ok(!JSON.stringify(r.body).includes('@'));
});

const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));
const API = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const SOURCES = walk(API).filter(f => /\.(m?js)$/.test(f) && !/\.test\.m?js$/.test(f) && !f.includes(`${path.sep}testing${path.sep}`));

// Rulings Nov 4 (1): this workspace's own copy of the no-send rule, so it survives a repo split. Every source file in
// api/, src/ and server.js, tests included; the needles are split so this file doesn't match itself.
const ROOT = path.resolve(API, '..');
const SEND_NEEDLES = ['send' + 'Mail', '/messages' + '/send', '/drafts' + '/send', 'messages' + '.send(', 'drafts' + '.send(', 'node' + 'mailer', 'create' + 'Transport', 'smtp' + '://', 'smtps' + '://', 'SMTP' + 'Client'];
const ONLY_SENDER = path.join('api', 'sales', 'teamEmails', 'send.js');
test('no Graph / Gmail / SMTP send call anywhere in api/, src/ or server.js outside send.js', () => {
  const all = [...walk(API), ...walk(path.join(ROOT, 'src')), path.join(ROOT, 'server.js')].filter(f => /\.(m?js|cjs|jsx|ts|tsx)$/.test(f));
  assert.ok(all.length > 200, `files walked: ${all.length}`);
  const hits = [];
  for (const f of all.filter(x => path.relative(ROOT, x) !== ONLY_SENDER)) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => { for (const n of SEND_NEEDLES) if (line.includes(n)) hits.push(`${path.relative(ROOT, f)}:${i + 1} ${n}`); });
  }
  assert.deepEqual(hits, []);
  assert.match(fs.readFileSync(path.join(ROOT, ONLY_SENDER), 'utf8'), /\/me\/send/);
});

test('send.js exports no function that takes a recipient', () => {
  const RECIPIENT = /\b(to|cc|bcc|recipients?|address(es)?|emails?|addr)\b/i;
  const fns = Object.entries(sendModule).filter(([, v]) => typeof v === 'function');
  assert.ok(fns.some(([k]) => k === 'sendTeamEmail'));
  for (const [name, fn] of fns) {
    const params = fn.toString().match(/^[^(]*\(([^)]*(?:\{[^}]*\}[^)]*)*)\)/)?.[1] ?? '';
    assert.ok(!RECIPIENT.test(params), `${name}(${params})`);
  }
  assert.equal(sendModule.mime, undefined);
  assert.equal(sendModule.assertMembers, undefined);
});

test('the only Graph write in api/ is the send endpoint, only sendTeamEmail calls it, and nothing can hand it an address', async () => {
  const graphWriters = SOURCES.filter(f => { const t = fs.readFileSync(f, 'utf8'); return /(graph\.microsoft\.com|GRAPH_URL\(\))/.test(t) && /method:\s*'(POST|PATCH|PUT|DELETE)'/.test(t) && !/oauth2\/v2\.0|authority\(\)/.test(t.replace(/[\s\S]*?(?=method)/, '')); });
  const graphSenders = SOURCES.filter(f => fs.readFileSync(f, 'utf8').includes('send' + 'Mail'));
  assert.deepEqual(graphSenders.map(f => path.relative(API, f)), ['sales/teamEmails/send.js']);
  assert.ok(graphWriters.every(f => f.endsWith(`sales${path.sep}teamEmails${path.sep}send.js`) || /callback\.js$/.test(f)), graphWriters.join(', '));
  const callers = SOURCES.filter(f => /sendTeamEmail\(/.test(fs.readFileSync(f, 'utf8')) && !f.endsWith(`teamEmails${path.sep}send.js`));
  assert.deepEqual(callers.map(f => path.relative(API, f)).sort(), ['sales/teamEmails/clientAlert.js', 'sales/teamEmails/jobs.js', 'sales/teamEmails/settings.js']);
  for (const f of callers) assert.ok(!/sendTeamEmail\([^)]*\b(to|cc|bcc|recipients?|address(es)?|email)\s*:/.test(fs.readFileSync(f, 'utf8')), f);
  const g = graph();
  for (const k of ['to', 'cc', 'bcc', 'recipients', 'email']) await assert.rejects(sendTeamEmail(sb(), B, { ...msg, [k]: [MAIL.out] }, g.deps), /takes no/);
  assert.equal(g.calls.length, 0);
});

test('REV2 T1: recipients come from the list - per-email checkboxes, archived and other-workspace rows ignored, outside-domain dropped and counted', async () => {
  const s = sb(), g = graph();
  const v = await sendTeamEmail(s, B, msg, g.deps);
  assert.deepEqual([v.status, v.recipients], ['sent', 2]);
  assert.deepEqual(toOf(g.calls[0].mime).sort(), [MAIL.team1, MAIL.team2].sort());
  const c = await sendTeamEmail(s, B, { ...msg, kind: 'client' }, g.deps);
  assert.equal(c.recipients, 2);
  assert.deepEqual(toOf(g.calls[1].mime).sort(), [MAIL.m1, MAIL.team1].sort());
  for (const call of g.calls) assert.ok(!call.mime.includes('other.test') && !call.mime.includes('gone@') && !call.mime.includes('theirs@'));
  assert.match(s.db.sales_team_email_sends[0].error, /dropped: outside domain \(1\)/);
  assert.match(g.calls[0].mime, /multipart\/alternative[\s\S]*text\/plain[\s\S]*text\/html/);
  assert.ok(g.calls[0].url.endsWith('/me/send' + 'Mail'));
});

test('REV2 T1: an empty list -> no send + a "no recipients" row; > 25 capped at 25; duplicates by case send once', async () => {
  const empty = sb({ sales_team_email_recipients: [] }), g = graph();
  const r = await sendTeamEmail(empty, B, msg, g.deps);
  assert.deepEqual([r.status, r.recipients, g.calls.length], ['skipped', 0, 0]);
  assert.match(empty.db.sales_team_email_sends[0].error, /no recipients/);
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, business_id: B, address: `t${i}@example.test`, visitor_email: true, client_alert: true, added_at: `2026-11-04T01:${String(i).padStart(2, '0')}:00Z`, archived_at: null }));
  many.push({ id: 'dup', business_id: B, address: 'T0@Example.test', visitor_email: true, client_alert: true, added_at: '2026-11-04T02:00:00Z', archived_at: null });
  const big = sb({ sales_team_email_recipients: many });
  const b = await sendTeamEmail(big, B, msg, g.deps);
  assert.equal(b.recipients, MAX_RECIPIENTS);
  assert.equal(new Set(toOf(g.calls[0].mime)).size, 25);
  assert.match(big.db.sales_team_email_sends[0].error, /capped: 5 over 25/);
});

test('REV2 T1: "Send a test to me only" goes to the sending mailbox, never the list; addresses never reach a row or a log', async () => {
  const s = sb(), g = graph();
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    const t1 = await sendTeamEmail(s, B, { ...msg, test: true }, g.deps);
    assert.equal(t1.recipients, 1);
    assert.deepEqual(toOf(g.calls[0].mime), [MAIL.owner]);
    await sendTeamEmail(s, B, msg, g.deps);
  } finally { console.log = orig; }
  assert.ok(!JSON.stringify(s.db.sales_team_email_sends).includes('@'));
  assert.ok(!lines.join('\n').includes('@'), lines.join('\n'));
});

test('rulings (3): a blocked sender -> no send, at most 1 needs_reconnect row per LA day per sender, the banner until a reconnect', async () => {
  const expired = graph({ token: () => { throw new NeedsMicrosoft('Microsoft access expired or was revoked - reconnect'); } });
  const s = sb();
  const at = t => ({ ...expired.deps, now: () => t });
  assert.equal((await sendTeamEmail(s, B, msg, at(NOW))).status, 'needs_reconnect');
  const noSend = graph({ grant: { scopes: READS, error: null } });
  const again = await sendTeamEmail(s, B, { ...msg, kind: 'client' }, { ...noSend.deps, now: () => NOW + 3600e3 });
  assert.equal(again.status, 'needs_reconnect');
  assert.equal(expired.calls.length + noSend.calls.length, 0);
  assert.equal(s.db.sales_team_email_sends.length, 1); // same LA day, same sender: the first row stands
  assert.equal(again.send_id, s.db.sales_team_email_sends[0].id);
  await sendTeamEmail(s, B, msg, at(NOW + 17 * 3600e3)); // Thu 00:00 LA: a new day, a new row
  assert.equal(s.db.sales_team_email_sends.length, 2);
  s.db.sales_team_email_settings[0].sender_user_id = U.m1; // another sender has their own daily row
  await sendTeamEmail(s, B, msg, at(NOW + 17 * 3600e3));
  assert.deepEqual(s.db.sales_team_email_sends.map(x => [x.status, x.recipients, x.sender_user_id]), [['needs_reconnect', 0, U.owner], ['needs_reconnect', 0, U.owner], ['needs_reconnect', 0, U.m1]]);
  s.db.sales_team_email_settings[0].sender_user_id = null;
  const before = new Date(NOW - 864e5).toISOString(), after = new Date(NOW + 20 * 3600e3).toISOString();
  const st = await teamEmailState(s, B, U.owner, { grantOf: async () => ({ scopes: [...READS, 'Mail.Send'], error: null, connected_at: before }) });
  assert.equal(st.body.banner, EXPIRED_NOTE);
  assert.equal((await teamEmailState(s, B, U.owner, { grantOf: async () => ({ scopes: READS, error: null, connected_at: before }) })).body.banner, RECONNECT_NOTE);
  assert.equal((await teamEmailState(s, B, U.owner, { grantOf: async () => ({ scopes: [...READS, 'Mail.Send'], error: null, connected_at: after }) })).body.banner, null);
});

test('rulings (3): a client alert that hit a blocked sender is held - no retry each minute - and goes out once the grant changes', async () => {
  const s = sb(clientSeed(5, 12));
  let grant = { ...SENDS, scopes: READS, connected_at: '2026-10-01T00:00:00Z' };
  const calls = [];
  const deps = { getGrant: async () => grant, accessTokenFor: async () => 'tok', fetch: async (url, init) => { calls.push(url); return { status: 202, ok: true, json: async () => ({}) }; } };
  for (let m = 0; m < 5; m++) await clientAlertsJob(s, B, { now: NOW + m * 60e3, deps: { ...deps, now: () => NOW + m * 60e3 } });
  assert.equal(calls.length, 0);
  assert.equal(s.db.sales_team_email_sends.length, 1);
  assert.equal(s.db.sales_job_slots[0].detail.status, 'needs_reconnect');
  grant = { ...SENDS, connected_at: '2026-11-04T15:02:00Z' }; // Jack reconnects
  const out = await clientAlertsJob(s, B, { now: NOW + 6 * 60e3, deps: { ...deps, now: () => NOW + 6 * 60e3 } });
  assert.deepEqual(out.map(o => o.status), ['sent']);
  await clientAlertsJob(s, B, { now: NOW + 7 * 60e3, deps: { ...deps, now: () => NOW + 7 * 60e3 } });
  assert.equal(calls.length, 1);
  assert.equal(s.db.sales_client_events.filter(e => e.kind === 'alert_sent').length, 1);
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

// FIX visitor-email-period-v1 P1: the window is the previous LA CALENDAR day, stated verbatim; Monday covers Fri + Sat +
// Sun as labelled days. A row belongs to the window when its pull window began inside the days and ended by the send day.
test('P1: Tuesday covers Monday 12:00 AM – 11:59 PM PT; Monday after the fall-back weekend covers Fri Oct 30 – Sun Nov 1 (pure dates: neither DST change moves it); the loader keeps the rows whose pull window began inside the days, tags each with its day(s), and NEW = never listed by an earlier pull', async () => {
  assert.deepEqual(dayWindowFor('2026-11-10'), { date: '2026-11-10', days: ['2026-11-09'], first: '2026-11-09', last: '2026-11-09' });
  assert.equal(windowDays(dayWindowFor('2026-11-06')), 'Thu Nov 5');
  const mon = dayWindowFor('2026-11-02'); // Mon Nov 2 2026, the day after the clocks went back
  assert.deepEqual(mon.days, ['2026-10-30', '2026-10-31', '2026-11-01']);
  assert.equal(windowDays(mon), 'Fri Oct 30 – Sun Nov 1');
  assert.equal(windowDays(dayWindowFor('2027-03-15')), 'Fri Mar 12 – Sun Mar 14'); // the spring-forward weekend
  const mk = (id, n, seen_from, seen_to, pulled_on = seen_to) => ({ id: `00000000-0000-4000-8000-00000000d0${id}`, business_id: B, company_key: `k${n}`, company_name: `Co ${n}`, visits_7d: 1, unique_visitors_7d: 2, top_paths: [], intent_score: 50, priority: 'P3', matched_type: null, matched_id: null, pulled_on, seen_from, seen_to, created_at: `${pulled_on}T14:30:00Z`, updated_at: `${pulled_on}T14:30:00Z` });
  const s = sb({ web_visits: [
    mk('01', 1, '2026-10-30', '2026-11-02'), // Monday's 06:30 pull (Fri -> Mon): in, tagged Fri–Sun
    mk('02', 2, '2026-10-29', '2026-10-30'), // Friday's own pull (Thu -> Fri): out - Friday's email carried it
    mk('03', 3, '2026-10-31', '2026-10-31'), // a Saturday page-load pull: in, tagged Sat
    mk('04', 4, '2026-11-02', '2026-11-03'), // Tuesday's pull: out (after the send day)
    mk('05', 1, '2026-10-20', '2026-10-21'), // Co 1 was listed by an earlier pull: RETURNING
  ] });
  const members = await loadMembers(s, B);
  const rows = await loadVisitorData(s, B, { window: mon, members });
  assert.deepEqual(rows.map(r => [r.company, r.days, r.is_new]).sort(), [['Co 1', 'Fri–Sun', false], ['Co 3', 'Sat', true]]);
  const tue = await loadVisitorData(s, B, { window: dayWindowFor('2026-11-03'), members });
  assert.deepEqual(tue.map(r => [r.company, r.days, r.is_new]), [['Co 4', null, true]], 'a weekday row carries no day tag');
  const mail = buildVisitorEmail(rows, { date: '2026-11-02', window: mon, cumulative: await loadCumulative(s, B) });
  assert.match(mail.text, /^HOMELOVER · WEBSITE VISITORS · FRI–SUN\nFri Oct 30 – Sun Nov 1 — 2 companies visited, 1 for the first time\nCompanies Apollo matched to visits on homelover\.com, Friday through Sunday, midnight to midnight PT\. Sent Mon 7:00 AM\./, 'v2 E1 / E2: the Monday eyebrow and the dated headline');
  assert.match(mail.html, /HomeLover · Website visitors · Fri–Sun<\/div>/);
  assert.match(mail.html, /NEW<\/span> <span style="font-size:11px;color:#6B7480">· Sat<\/span>/, 'the day tag beside the tag pill');
  assert.match(mail.text, /NEW FRI–SUN\n1 company we had never seen on the site before\.[^\n]*\n1\. Co 3 \[NEW · Sat\]/);
  assert.match(mail.text, /1\. Co 1 \[RETURNING · Fri–Sun\]/);
  assert.match(mail.text, /2\. Co 3 \[NEW · Sat\]/);
  assert.match(mail.text, /4 companies identified since Oct 21\./, 'distinct companies over every pull, the start = the earliest pull day in the data');
  assert.deepEqual(await loadCumulative(sb({ web_visits: [] }), B), { companies: 0, since: null });
});

const co = (i, extra = {}) => ({ company: `Company ${String(i).padStart(2, '0')}`, type: null, id: null, score: 100 - i, band: i < 3 ? 'P1' : 'P3', visits: 2, visitors: 2, people: 0, buyers: 0, pages: 1, paths: ['/'], titles: [], top_page: '/', stage: null, owner: 'Unassigned', is_new: i % 2 === 0, ...extra });

test('v2 E1-E4: eyebrow · dated headline · subhead with the send day; four stat tiles as two rows of 50 % cells; the intent line with outlined band pills and the in-Prospector split; nothing padded', () => {
  const cumulative = { companies: 283, since: '2026-10-20' };
  const big = buildVisitorEmail(Array.from({ length: 14 }, (_, i) => co(i)), { date: '2026-11-04', cumulative });
  assert.equal(big.subject, 'Website visitors · Tue Nov 3 — 7 new, 14 worth a look');
  assert.deepEqual([big.rows, big.new_rows, big.qualified, big.visited, big.new, big.returning, big.cumulative], [TOP_N, 7, 14, 14, 7, 7, 283]);
  assert.match(big.text, /^HOMELOVER · WEBSITE VISITORS · YESTERDAY\nTue Nov 3 — 14 companies visited, 7 for the first time\nCompanies Apollo matched to visits on homelover\.com, midnight to midnight PT\. Sent Wed 7:00 AM\. Open the Map → https:\/\/[^\n]+\n\n14 visited · 7 new · 7 returning · 14 worth a look\nIntent of yesterday's 14: Hot 3 · Warm 0 · Cool 11 · Cold 0 · already in Prospector: 0 employers · 0 targets · 0 partners · 14 not yet\n/);
  const h = big.html;
  assert.match(h, /HomeLover · Website visitors · yesterday<\/div>\n<div[^>]*>Tue Nov 3 — 14 companies visited, 7 for the first time<\/div>/);
  assert.equal((h.match(/<td width="50%"/g) || []).length, 4, 'four tiles as 50 % cells');
  assert.equal((h.match(/<tr><td width="50%"/g) || []).length, 2, 'in two rows');
  assert.match(h, />14<\/div><div[^>]*>visited<\/div><div[^>]*>companies on the site yesterday</);
  assert.match(h, /color:#FF9F57">7<\/div><div[^>]*>new<\/div><div[^>]*>never seen before</);
  assert.match(h, /color:#4FD1C5">7<\/div><div[^>]*>returning<\/div><div[^>]*>seen before, came back</);
  assert.match(h, />14<\/div><div[^>]*>worth a look<\/div><div[^>]*>Warm or hotter, a named person, or 2\+ visitors or pages</);
  for (const [b, w] of Object.entries(BAND_WORD)) assert.match(h, new RegExp(`border:1px solid #[0-9A-F]{6};color:#[0-9A-F]{6};[^"]*">${w} \\d+</span>`), `${b} outlined pill`);
  assert.ok(h.indexOf('>Hot 3<') < h.indexOf('>Warm 0<') && h.indexOf('>Warm 0<') < h.indexOf('>Cool 11<') && h.indexOf('>Cool 11<') < h.indexOf('>Cold 0<'));
  assert.match(h, /already in Prospector: 0 employers · 0 targets · 0 partners &nbsp;·&nbsp; 14 not yet/);
  assert.ok(!/<img|pixel|<style|<script/i.test(h));
  assert.ok(!/act today|this week|today|tonight|tomorrow|watch|noise/i.test(big.text.replace(/Website visitors/g, '')), 'no time words');
  const small = buildVisitorEmail(Array.from({ length: 10 }, (_, i) => co(i)), { date: '2026-11-04' });
  assert.deepEqual([small.rows, small.new_rows], [10, 5]);
  assert.match(small.text, /WORTH A LOOK YESTERDAY\nAll 10 qualified, ranked by intent\./);
  assert.ok(!/more qualified|Showing \d+ of/.test(small.text));
  const none = buildVisitorEmail([], { date: '2026-11-04' });
  assert.equal(none.subject, 'Website visitors · Tue Nov 3 — 0 new, 0 worth a look');
  assert.match(none.text, /Tue Nov 3 — 0 companies visited, 0 for the first time\n[^\n]+\n\n0 visited · 0 new · 0 returning · 0 worth a look\nNo identified visitors yesterday — most traffic stays anonymous\.\n\nNEW YESTERDAY\nNo new companies yesterday\.\n\nWORTH A LOOK YESTERDAY\nNo company qualified yesterday \(Warm or hotter, a named person, or 2\+ visitors or pages\)\.\n/, 'the three sections always render');
  assert.match(none.html, /No identified visitors yesterday — most traffic stays anonymous\./);
  assert.ok(!/table-layout:fixed/.test(none.html), 'no data table on an empty day');
  assert.match(none.text, /\n—\nSent by Prospector to the HomeLover team · manage recipients · Sales › Settings › Team emails$/);
});

test('v2 E9 row format: line 1 = company link + NEW / RETURNING tag + the outlined intent pill; line 2 = visits · people · last 7 days · pages (/ reads "/ (home)") · n named: titles; In Prospector "Kind · Stage · ● owner" or "Not in Prospector · Add →"; no "0 people"', () => {
  const one = buildVisitorEmail([co(0, { visits: 1, visitors: 3, people: 1, titles: ['VP People'], paths: ['/pricing', '/'], pages: 3, type: 'employer', id: 'e1', stage: 'proposal_pilot', owner: 'Casey', owner_color: '#C97626', last_touch: { at: '2026-11-03T18:00:00Z', by: 'Casey', what: 'email' } })], { date: '2026-11-04' });
  assert.equal(one.subject, 'Website visitors · Tue Nov 3 — 1 new, 1 worth a look');
  assert.match(one.text, /1 visited · 1 new · 0 returning · 1 worth a look\nIntent of yesterday's 1: Hot 1 · Warm 0 · Cool 0 · Cold 0 · already in Prospector: 1 employer · 0 targets · 0 partners · 0 not yet/);
  assert.match(one.text, /1\. Company 00 \[NEW\] — Hot 100 · Employer · Proposal pilot · Casey · Nov 3 · email\n   1 visit · 3 people · last 7 days · pages: \/pricing, \/ \(home\) \+1 · 1 named: VP People\n   https:\/\/[^\n]+open=employer-e1/);
  assert.match(one.html, /open=employer-e1"[^>]*>Company 00<\/a><span style="[^"]*background:#FF9F57;color:#0B0D10;[^"]*">NEW<\/span><\/div><div[^>]*>1 visit · 3 people · last 7 days · pages: \/pricing, \/ \(home\) \+1 · 1 named: VP People<\/div>/);
  assert.match(one.html, /border:1px solid #FF9F57;color:#FF9F57;[^"]*">Hot 100<\/span>/);
  assert.match(one.html, /Employer · Proposal pilot · <span style="white-space:nowrap"><span style="[^"]*background:#C97626;[^"]*"><\/span>Casey<\/span>/);
  assert.match(one.html, />Nov 3 · email<\/td>/);
  const two = buildVisitorEmail([co(1, { is_new: false, type: 'target', id: 't1', stage: 'researching', owner: 'Unassigned', owner_color: null }), co(2, { visitors: 0, people: 0 })], { date: '2026-11-04' });
  assert.match(two.html, /background:#4FD1C5;color:#0B0D10;[^"]*">RETURNING<\/span>/);
  assert.match(two.html, /Target · Researching · <span style="white-space:nowrap"><span style="[^"]*background:#94A3B8;[^"]*"><\/span>Unassigned<\/span>/, 'a record without an owner: the grey dot');
  assert.match(two.html, /<span style="color:#A8B2C0">Not in Prospector<\/span> · <a href="[^"]*channel=website_visit"[^>]*>Add →<\/a>/);
  assert.match(two.html, /<span style="color:#6B7480">No touch yet<\/span>/);
  assert.match(two.text, /2\. Company 02 \[NEW\] — Hot 98 · Not in Prospector · Add → https:[^\n]+channel=website_visit · No touch yet\n   2 visits · last 7 days · pages: \/ \(home\)\n/);
  assert.ok(!/0 people|0 person|0 named/.test(two.text + two.html));
});

test('v2 E8 / V3: "How to read this" - four lines, the band thresholds read from the ranked book (the scores route\'s weights, never constants here), the anonymous line with the cumulative count, the footer with the recipients link; html and text', () => {
  const overall = { rows: [], total: 0, prev_day: null, thresholds: { P1: 70, P2: 45, P3: 20 } };
  const m = buildVisitorEmail([co(0)], { date: '2026-11-04', overall, cumulative: { companies: 283, since: '2026-10-20' } });
  assert.match(m.text, /\nHOW TO READ THIS\nNEW \/ RETURNING — whether we had seen the company on the site before yesterday\.\nVisits · people — Apollo's rolling 7-day counts, not just yesterday\. Pages — the paths Apollo reported on this pull\.\nIntent — the Map's score, 0–100: Hot ≥ 70 · Warm 45–69 · Cool 20–44 · Cold < 20\.\nIn Prospector — the record type and stage, or "Not in Prospector" with an Add link\.\nMost visitors stay anonymous; Apollo names a company only when it can match the traffic\. 283 companies identified since Oct 20\.\n\n—\nSent by Prospector to the HomeLover team · manage recipients · Sales › Settings › Team emails$/);
  assert.match(m.html, /How to read this<\/div>\n<div[^>]*><b style="color:#C9D0D9">NEW \/ RETURNING<\/b> — whether we had seen the company on the site before yesterday\.<br><b[^>]*>Visits · people<\/b> — Apollo&#39;s rolling 7-day counts, not just yesterday\. Pages — the paths Apollo reported on this pull\.<br><b[^>]*>Intent<\/b> — the Map&#39;s score, 0–100: Hot ≥ 70 · Warm 45–69 · Cool 20–44 · Cold &lt; 20\.<br><b[^>]*>In Prospector<\/b> — the record type and stage, or &quot;Not in Prospector&quot; with an Add link\.<br>Most visitors stay anonymous; Apollo names a company only when it can match the traffic\. 283 companies identified since Oct 20\.<\/div>/);
  assert.ok(m.html.includes(`Sent by Prospector to the HomeLover team · <a href="${esc(SETTINGS_URL)}" style="color:#AFC0FF;text-decoration:none">manage recipients</a> · Sales › Settings › Team emails`), 'the recipients link');
  assert.equal(thresholdWords(DEFAULT_WEIGHTS.thresholds), 'Hot ≥ 60 · Warm 40–59 · Cool 15–39 · Cold < 15');
  const plain = buildVisitorEmail([co(0)], { date: '2026-11-04' });
  assert.match(plain.text, /Intent — the Map's score, 0–100: Hot ≥ 60 · Warm 40–59 · Cool 15–39 · Cold < 15\./, 'no book = the scores route\'s defaults');
  assert.match(plain.text, /match the traffic\.\n\n—\n/, 'no cumulative = no count sentence');
  assert.equal(QUALIFIED_WORDS, 'Warm or hotter, a named person, or 2+ visitors or pages');
  assert.equal(FOOTER_WORDS, 'Sent by Prospector to the HomeLover team · manage recipients · Sales › Settings › Team emails');
});

test('v2 E9: Last touch = "<Mon d> · <what>", "No touch yet" faint for a record without one and for a company not in Prospector; every A row has the four cells', () => {
  const at = '2026-11-03T18:00:00Z';
  const rows = [
    co(0, { type: 'partner', id: 'g1', last_touch: { at, by: 'Casey', what: 'email' } }),
    co(1, { type: 'partner', id: 'g2', last_touch: { at, by: 'Casey', what: 'call' } }),
    co(2, { type: 'partner', id: 'g3', last_touch: { at, by: null, what: 'meeting' } }),
    co(3, { type: 'partner', id: 'g4', last_touch: { at, by: 'Casey', what: 'note' } }),
    co(4, { type: 'employer', id: 'e1', last_touch: null }),
    co(5),
  ];
  const m = buildVisitorEmail(rows, { date: '2026-11-04' });
  for (const t of ['Nov 3 · email', 'Nov 3 · call', 'Nov 3 · meeting', 'Nov 3 · note']) {
    assert.ok(m.text.includes(` · ${t}\n`), t);
    assert.ok(m.html.includes(`>${t}</td>`), `html ${t}`);
  }
  assert.equal((m.text.match(/ · No touch yet\n/g) || []).length, 3, 'the new employer without a touch in A0 and A, the returning unmatched company in A');
  assert.equal((m.html.match(/<span style="color:#6B7480">No touch yet<\/span>/g) || []).length, 3);
  assert.ok(!m.text.includes('Casey'), 'the first name stays out of the touch cell');
  const body = m.html.split('<tr>').filter(r => r.includes('<td width="42%"'));
  assert.equal(body.length, 3 + 6, '3 new rows in A0 + 6 qualified rows in A');
  for (const r of body) assert.equal((r.match(/<td width="\d+%"/g) || []).length, 4, 'four cells a row');
});

test('visitor-email-clarity V3 loader: last touch comes from the company panel source (partner touch event, employer to-do kind only, never its text)', async () => {
  const mk = (n, type, id) => ({ id: `00000000-0000-4000-8000-00000000c00${n}`, business_id: B, company_key: `k${n}`, company_name: `Co ${n}`, visits_7d: 4, unique_visitors_7d: 1, top_paths: [], intent_score: 60 - n, priority: 'P2', matched_type: type, matched_id: id, pulled_on: '2026-11-04', seen_from: '2026-11-03', seen_to: '2026-11-04', created_at: '2026-11-04T14:00:00Z', updated_at: '2026-11-04T14:00:00Z' });
  const G = '00000000-0000-4000-8000-00000000e001', O = '00000000-0000-4000-8000-00000000e002', O2 = '00000000-0000-4000-8000-00000000e003';
  const s = sb({
    web_visits: [mk(1, 'partner', G), mk(2, 'opportunity', O), mk(3, 'opportunity', O2), mk(4, null, null)],
    sales_goals: [{ id: G, business_id: B, name: 'Co 1', pipeline_status: 'contacted', owner_user_id: U.m1, last_touch_at: '2026-11-03T17:00:00Z' }],
    sales_partner_events: [{ id: 'ev1', business_id: B, goal_id: G, event: 'touch', touch_type: 'call', at: '2026-11-03T17:00:00Z', by_user: U.m1 }],
    sales_opportunities: [{ id: O, business_id: B, organization: 'Co 2', stage: 'contacted', owner_user_id: U.m1, client_status: null }, { id: O2, business_id: B, organization: 'Co 3', stage: 'contacted', owner_user_id: null, client_status: null }],
    sales_week_goals: [{ id: 'w1', business_id: B, kind: 'todo', link_type: 'opportunity', link_id: O, status: 'done', completed_at: '2026-11-02T20:00:00Z', text: 'Call Jordan Visitorperson back', owner_user_id: U.m1 }],
  });
  const members = await loadMembers(s, B);
  const rows = await loadVisitorData(s, B, { window: dayWindowFor('2026-11-04'), members });
  const by = Object.fromEntries(rows.map(r => [r.company, r.last_touch]));
  assert.deepEqual(by['Co 1'], { at: '2026-11-03T17:00:00Z', by: 'Casey', what: 'call' });
  assert.deepEqual(by['Co 2'], { at: '2026-11-02T20:00:00Z', by: 'Casey', what: 'to-do' });
  assert.equal(by['Co 3'], null);
  assert.equal(by['Co 4'], undefined);
  const mail = buildVisitorEmail(rows, { date: '2026-11-04' });
  assert.ok(mail.text.includes(' · Nov 3 · call\n') && mail.text.includes(' · Nov 2 · to-do\n') && mail.text.includes(' · No touch yet\n'));
  assert.ok(!/Jordan|Visitorperson|@|\d{3}-\d{3}-\d{4}/.test(mail.html + mail.text), 'no names, emails or phones');
});

test('the visitor email body carries titles only - no person names, emails or phones', async () => {
  const visit = { id: '00000000-0000-4000-8000-00000000c001', business_id: B, company_key: 'acme', company_name: 'Acme Health', visits_7d: 5, unique_visitors_7d: 2, top_paths: [{ path: '/pricing', visits: 3 }], intent_score: 71, priority: 'P1', matched_type: 'opportunity', matched_id: '00000000-0000-4000-8000-00000000d001', pulled_on: '2026-11-04', seen_from: '2026-11-03', seen_to: '2026-11-04', created_at: '2026-11-04T14:00:00Z', updated_at: '2026-11-04T14:00:00Z' };
  const s = sb({
    web_visits: [visit],
    sales_people: [{ id: 'p1', business_id: B, visit_id: visit.id, name: 'Jordan Visitorperson', title: 'VP People', archived_at: null }, { id: 'p2', business_id: B, visit_id: visit.id, name: 'Sam Otherperson', title: 'Benefits Lead 312-555-0199', archived_at: null }],
    sales_opportunities: [{ id: visit.matched_id, business_id: B, organization: 'Acme Health', stage: 'contacted', owner_user_id: U.m1, client_status: null }],
    sales_company_scores: [{ business_id: B, company_type: 'employer', company_id: visit.matched_id, score: 74, band: 'P1' }],
  });
  const members = await loadMembers(s, B);
  const rows = await loadVisitorData(s, B, { window: dayWindowFor('2026-11-04'), members });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].owner, 'Casey');
  assert.equal(rows[0].score, 74);
  const mail = buildVisitorEmail(rows, { date: '2026-11-04' });
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
  assert.equal(mark.meta.recipients, 2);
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

test('REV2 T2: only the owner edits (sender, on / off, the list); members read counts only', async () => {
  const s = sb();
  const can = async id => (id === U.m1 ? { ...SENDS, account_email: MAIL.m1 } : id === U.owner ? SENDS : { ...SENDS, scopes: READS });
  const asMember = { businessId: B, userId: U.m1, isOwner: false, grantOf: can };
  assert.equal((await updateTeamEmails(s, { ...asMember, body: { visitor_on: false } })).status, 403);
  assert.equal((await addRecipient(s, { ...asMember, body: { address: 'new@example.test' } })).status, 403);
  assert.equal((await removeRecipient(s, { ...asMember, id: '00000000-0000-4000-8000-000000000001' })).status, 403);
  assert.equal((await sendTest(s, { ...asMember, body: { kind: 'visitor' } })).status, 403);
  const own = { businessId: B, userId: U.owner, isOwner: true, grantOf: can };
  assert.equal((await updateTeamEmails(s, { ...own, body: { sender_user_id: U.out } })).status, 400);
  assert.equal((await updateTeamEmails(s, { ...own, body: { sender_user_id: U.m2 } })).status, 409);
  assert.equal((await updateTeamEmails(s, { ...own, body: { sender_user_id: U.m1 } })).body.sender.first_name, 'Casey');
  assert.equal((await updateTeamEmails(s, { ...own, body: { to: 'x' } })).status, 400);
  const st = await teamEmailState(s, B, U.owner, { isOwner: true, grantOf: can });
  assert.equal(st.body.recipients.length, 4);
  assert.equal(st.body.recipients.find(r => r.id === 'r4').allowed, false);
  // Members at the domain who aren't on the list yet: one-click suggestions (the owner's two sign-ins -> one).
  assert.deepEqual(st.body.suggestions.map(x => x.first_name).sort(), ['Alex', 'Robin']);
});

test('REV2 T2: add / edit / remove validate the domain, the 25 cap and duplicates; every change is a counts-only Activity row with a 10 s Undo', async () => {
  const s = sb();
  const own = { businessId: B, userId: U.owner, isOwner: true, grantOf: async () => SENDS };
  assert.match((await addRecipient(s, { ...own, body: { address: 'someone@other.test' } })).body.error, /Only addresses at @example\.test/);
  assert.match((await addRecipient(s, { ...own, body: { address: 'not-an-email' } })).body.error, /Enter an email address/);
  assert.match((await addRecipient(s, { ...own, body: { address: MAIL.team1.toUpperCase() } })).body.error, /Already on the list/);
  const added = await addRecipient(s, { ...own, body: { member_user_id: U.m2, client_alert: false } });
  assert.equal(added.status, 200);
  assert.equal(added.body.count, 5);
  const row = s.db.sales_team_email_recipients.find(r => r.id === added.body.id);
  assert.deepEqual([row.address, row.visitor_email, row.client_alert], [MAIL.m2, true, false]);
  const flags = await editRecipient(s, { ...own, id: added.body.id, body: { client_alert: true } });
  assert.equal(row.client_alert, true);
  assert.equal((await undoChange(s, { ...own, id: flags.body.change_id })).status, 200);
  assert.equal(row.client_alert, false);
  const moved = await editRecipient(s, { ...own, id: added.body.id, body: { address: 'robin.m@example.test' } });
  assert.notEqual(moved.body.id, added.body.id);
  assert.ok(row.archived_at);
  await undoChange(s, { ...own, id: moved.body.change_id });
  assert.equal(row.archived_at, null);
  const gone = await removeRecipient(s, { ...own, id: added.body.id });
  assert.equal(gone.body.count, 4);
  assert.ok(s.db.sales_team_email_recipients.find(r => r.id === added.body.id).archived_at, 'archived, never deleted');
  assert.equal((await undoChange(s, { ...own, id: gone.body.change_id, now: Date.now() + UNDO_MS })).status, 409);
  assert.equal((await undoChange(s, { ...own, id: gone.body.change_id })).body.count, 5);
  assert.equal((await undoChange(s, { ...own, id: gone.body.change_id })).status, 409);
  assert.ok(!JSON.stringify(s.db.sales_team_email_changes).includes('@'));
  assert.deepEqual(s.db.sales_team_email_changes.map(c => c.action), ['add', 'edit', 'undo', 'edit', 'undo', 'remove', 'undo']);
  const full = sb({ sales_team_email_recipients: Array.from({ length: 25 }, (_, i) => ({ id: `f${i}`, business_id: B, address: `f${i}@example.test`, visitor_email: true, client_alert: true, added_at: '2026-11-04T01:00:00Z', archived_at: null })) });
  assert.match((await addRecipient(full, { ...own, body: { address: 'one-more@example.test' } })).body.error, /at most 25/);
});

test('rulings (2): one startup line, and the only node-cron schedule left in server.js is the SFDC compliance sync', () => {
  const list = hlJobs({ runApolloSync: async () => ({}), pull: async () => ({}), deps: {} });
  assert.equal(schedulerLine(list), 'apollo-sync 06:00 daily, visitor-pull 06:30 Mon-Fri, team-visitor-email 07:00 Mon-Fri, client-alerts each minute (America/Los_Angeles)');
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.deepEqual(server.match(/cron\.schedule\(\s*'[^']*'/g), ["cron.schedule('0 */6 * * *'"]);
  assert.equal((server.match(/HomeLover scheduler on: /g) || []).length, 1);
  assert.equal((server.match(/startScheduler\(/g) || []).length, 1);
  assert.match(server, /if \(!hlSchedulerStarted && process\.env\.RENDER === 'true'\)/);
});

test('rulings (4): on a cron day (no page load) the 06:30 job pulls visitors AND visitor people; 07:00 carries them', async () => {
  const s = sb();
  const visit = { id: '00000000-0000-4000-8000-00000000c101', business_id: B, company_key: 'globex', company_name: 'Globex Benefits', visits_7d: 3, unique_visitors_7d: 2, top_paths: [{ path: '/employers', visits: 2 }], intent_score: 60, priority: 'P2', matched_type: null, matched_id: null, pulled_on: '2026-11-04', seen_from: '2026-11-03', seen_to: '2026-11-04', created_at: '2026-11-04T14:30:00Z', updated_at: '2026-11-04T14:30:00Z' };
  const seen = { pull: [], people: [] };
  const pull = async (sb_, a) => { seen.pull.push(a.trigger); sb_.db.web_visits.push(visit); sb_.db.visit_pull_runs.push({ business_id: B, status: 'ok', kind: 'daily', updated_at: visit.updated_at }); return { status: 200, body: { ran: true, run: { calls: 3 }, credits: 1 } }; };
  const people = async (sb_, a) => {
    if (seen.people.length) return { status: 200, body: { ran: false, reason: 'Visitor people already pulled today' } };
    seen.people.push(a.userId);
    sb_.db.sales_people.push({ id: 'pp1', business_id: B, visit_id: visit.id, name: 'Lee Personname', title: 'Head of Total Rewards', archived_at: null });
    return { status: 200, body: { ran: true, calls: 3, credits: 0, counts: { people_added: 1 } } };
  };
  const g = graph();
  const jobs = hlJobs({ runApolloSync: async () => ({}), pull, people, deps: g.deps }).filter(j => j.at && j.name !== 'apollo-sync');
  const scopes = async () => [B], log = () => {};
  const at630 = Date.parse('2026-11-04T14:30:00Z'), at700 = NOW;
  await tick(s, { jobs, scopes, now: at630, log });
  const pullSlot = s.db.sales_job_slots.find(x => x.job === 'visitor-pull');
  assert.equal(pullSlot.status, 'ok');
  assert.deepEqual(pullSlot.detail.people, { ran: true, calls: 3, credits: 0, added: 1 });
  assert.deepEqual(seen.people, [U.owner]);
  assert.equal(s.db.sales_people.length, 1);
  await tick(s, { jobs, scopes, now: at700, log });
  const emailSlot = s.db.sales_job_slots.find(x => x.job === 'team-visitor-email');
  assert.equal(emailSlot.detail.status, 'sent');
  assert.equal(emailSlot.detail.people_credits, 0);
  assert.equal(seen.people.length, 1); // 07:00 asked again; the once-a-day guard answered "already pulled"
  assert.deepEqual(seen.pull, ['cron', 'cron']);
  const body = Buffer.from(g.calls[0].mime.split('\r\n\r\n')[2].split('\r\n--')[0].replace(/\r\n/g, ''), 'base64').toString('utf8');
  assert.match(body, /Globex Benefits/);
  assert.match(body, /3 visits · 2 people · last 7 days · pages: \/employers · 1 named: Head of Total Rewards/);
  assert.ok(!/Lee|Personname/.test(body));
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(server, /people: people\.runVisitorPeoplePull/);
});

// ---- FIX visitor-email-top10-v1 ---------------------------------------------------------------------------------------
const bookRow = (i, extra = {}) => ({ rank: i + 1, company: `Ranked ${String(i).padStart(2, '0')}`, type: 'employer', id: `00000000-0000-4000-8000-0000000ab0${String(i).padStart(2, '0')}`, score: 90 - i, band: i < 2 ? 'P1' : 'P2', stage: 'contacted', owner: 'Casey', owner_color: '#C97626', trend: ['up', 'down', 'flat', 'new'][i % 4], prev_score: i % 4 === 3 ? null : 90 - i + (i % 4 === 0 ? -5 : i % 4 === 1 ? 5 : 0), last_touch: i % 2 ? null : { at: '2026-11-03T17:00:00Z', by: 'Casey', what: 'call' }, ...extra });

test('v2 E5-E7: three lists in order - New yesterday (A0) · Worth a look yesterday (A) · Top 10 right now, whole book (B) - in html and text; a company in all three appears in all three; trend ▲ ▼ — with the hues; the subject per E10', () => {
  const overall = { rows: Array.from({ length: 10 }, (_, i) => bookRow(i)), total: 435, prev_day: '2026-11-03', thresholds: DEFAULT_WEIGHTS.thresholds };
  const both = co(0, { company: 'Ranked 03', type: 'employer', id: overall.rows[3].id, stage: 'contacted', owner: 'Casey', owner_color: '#C97626', is_new: true });
  const m = buildVisitorEmail([both, co(1), co(2)], { date: '2026-11-04', overall });
  assert.equal(m.subject, 'Website visitors · Tue Nov 3 — 2 new, 3 worth a look, top: Ranked 00');
  assert.deepEqual([m.new_rows, m.rows, m.overall], [2, 3, 10]);
  const heads = [...m.html.matchAll(/<th [^>]*>([^<]+)<\/th>/g)].map(x => x[1]);
  assert.deepEqual(heads, ['Company · why', 'Intent', 'In Prospector · owner', 'Last touch', 'Company · why', 'Intent', 'In Prospector · owner', 'Last touch', 'Company', 'Intent', 'Trend', 'In Prospector · owner', 'Last touch']);
  const h = m.html;
  assert.ok(h.indexOf('>New yesterday<span') < h.indexOf('>Worth a look yesterday<span') && h.indexOf('>Worth a look yesterday<span') < h.indexOf('>Top 10 right now — whole book</div>'), 'A0, A, B in order');
  assert.match(h, /New yesterday<span style="[^"]*background:#FF9F57;[^"]*">NEW<\/span>/);
  assert.match(h, /Worth a look yesterday<span style="[^"]*background:#4FD1C5;[^"]*">RETURNING<\/span>/);
  assert.match(h, /2 companies we had never seen on the site before\. 1 already in Prospector — Add puts the rest on the Map as targets\./);
  assert.match(h, /All 3 qualified, ranked by intent\. Qualified = Warm or hotter, a named person, or 2\+ visitors or pages\./);
  assert.match(h, /All 435 ranked companies in the Map&#39;s order, not just yesterday&#39;s visitors\. ▲ ▼ = score change since the last email\./);
  assert.equal((h.match(/Ranked 03/g) || []).length, 3, 'in all three lists');
  assert.match(h, /color:#3DD68C">▲ 85→90</); assert.match(h, /color:#FF7878">▼ 94→89</); assert.match(h, /color:#6B7480">—</); assert.match(h, /color:#6B7480">new</);
  assert.match(h, /all 3 on the Map →<\/a>/);
  const t = m.text;
  assert.ok(t.indexOf('NEW YESTERDAY') < t.indexOf('WORTH A LOOK YESTERDAY') && t.indexOf('WORTH A LOOK YESTERDAY') < t.indexOf('TOP 10 RIGHT NOW — WHOLE BOOK'));
  assert.match(t, /1\. Ranked 00 — Hot 90 · ▲ 85→90 · Employer · Contacted · Casey · /);
  assert.match(t, /2\. Ranked 01 — Hot 89 · ▼ 94→89 · /);
  assert.match(t, /3\. Ranked 02 — Warm 88 · — · /);
  assert.match(t, /4\. Ranked 03 — Warm 87 · new · /);
  assert.match(t, / · Nov 3 · call\n/);
  assert.equal((t.match(/^\d+\. /gm) || []).length, 2 + 3 + 10, '2 in A0 + 3 in A + 10 in B');
  assert.ok(!/@|\d{3}-\d{3}-\d{4}/.test(m.html + m.text), 'no address, no phone');
  // A quiet day keeps all three sections: the two one-liners, then B.
  const quiet = buildVisitorEmail([], { date: '2026-11-04', overall });
  assert.match(quiet.text, /No identified visitors yesterday[\s\S]*NEW YESTERDAY\nNo new companies yesterday\.\n\nWORTH A LOOK YESTERDAY\nNo company qualified yesterday[\s\S]*TOP 10 RIGHT NOW — WHOLE BOOK[\s\S]*1\. Ranked 00 — Hot 90/);
  assert.equal(quiet.subject, 'Website visitors · Tue Nov 3 — 0 new, 0 worth a look, top: Ranked 00');
  assert.equal((quiet.html.match(/table-layout:fixed/g) || []).length, 1, 'only B has a table');
});

test('V1 loader: the ranked book = the Map order with live / duplicates / closed / Deprioritized out, top 10, trend vs the last snapshot, last touch from the panel source', async () => {
  const id = n => `00000000-0000-4000-8000-0000000ac0${String(n).padStart(2, '0')}`;
  const G = id(99);
  const sc = (n, score, extra = {}, meta = {}) => ({ business_id: B, company_type: 'employer', company_id: id(n), score, band: score >= 60 ? 'P1' : 'P2', closed: false, flagged_out: false, duplicate_of: null, components: { meta: { name: `Co ${n}`, owner_user_id: U.m1, stage: 'contacted', ...meta } }, ...extra });
  const s = sb({
    sales_company_scores: [
      ...Array.from({ length: 12 }, (_, n) => sc(n, 80 - n)),
      sc(20, 99, { flagged_out: true }), sc(21, 98, { duplicate_of: id(0) }), sc(22, 97, { closed: true }), sc(23, 96, {}, { fit: { level: 'deprioritized' } }),
      { business_id: B, company_type: 'partner', company_id: G, score: 85, band: 'P1', closed: false, flagged_out: false, duplicate_of: null, components: { meta: { name: 'Partner Co', owner_user_id: U.m2, last_touch_at: '2026-11-03T17:00:00Z' } } },
      { business_id: OTHER, company_type: 'employer', company_id: id(50), score: 100, band: 'P1', closed: false, flagged_out: false, duplicate_of: null, components: { meta: { name: 'Theirs' } } },
    ],
    sales_company_score_days: [
      { business_id: B, company_type: 'partner', company_id: G, day: '2026-11-03', score: 80, band: 'P1' },
      { business_id: B, company_type: 'employer', company_id: id(0), day: '2026-11-03', score: 82, band: 'P1' },
      { business_id: B, company_type: 'employer', company_id: id(1), day: '2026-11-03', score: 79, band: 'P1' },
      { business_id: B, company_type: 'employer', company_id: id(0), day: '2026-11-01', score: 10, band: 'P4' },
    ],
    sales_goals: [{ id: G, business_id: B, name: 'Partner Co', pipeline_status: 'contacted', owner_user_id: U.m2, last_touch_at: '2026-11-03T17:00:00Z' }],
    sales_partner_events: [{ id: 'ev1', business_id: B, goal_id: G, event: 'touch', touch_type: 'email', at: '2026-11-03T17:00:00Z', by_user: U.m2 }],
  });
  const book = await loadRankedBook(s, B, { now: NOW, members: await loadMembers(s, B) });
  assert.equal(book.total, 13, '12 employers + the partner; live, duplicate, closed, deprioritized and the other workspace out');
  assert.equal(book.prev_day, '2026-11-03');
  assert.deepEqual(book.rows.map(r => r.company).slice(0, 3), ['Partner Co', 'Co 0', 'Co 1']);
  assert.equal(book.rows.length, 10);
  assert.deepEqual(book.rows.map(r => [r.rank, r.trend, r.prev_score]).slice(0, 4), [[1, 'up', 80], [2, 'down', 82], [3, 'flat', 79], [4, 'new', null]]);
  assert.deepEqual(book.rows[0].last_touch, { at: '2026-11-03T17:00:00Z', by: 'Robin', what: 'email' });
  assert.deepEqual([book.rows[0].owner, book.rows[1].owner], ['Robin', 'Casey']);
  assert.ok(!book.rows.some(r => ['Theirs', 'Co 20', 'Co 21', 'Co 22', 'Co 23'].includes(r.company)));
});

test('V3a: the email catches up until 12:00 LA, not after; past the window one tick writes one missed row, the next tick none', async () => {
  const quiet = () => {};
  let runs = 0;
  const jobs = [{ name: VISITOR_EMAIL_JOB, at: '07:00', days: WEEKDAYS, catchup_min: EMAIL_CATCHUP_MIN, run: async () => { runs += 1; return { status: 'sent' }; } }];
  const scopes = async () => [B];
  const at = hm => laInstant('2026-11-04', hm);
  const late = sb();
  await tick(late, { jobs, scopes, now: at('11:59'), log: quiet });
  assert.equal(runs, 1, 'a tick at 11:59 still sends');
  assert.equal(missedSlots(jobs, at('11:59')).length, 0);
  const tooLate = sb();
  await tick(tooLate, { jobs, scopes, now: at('12:00'), log: quiet });
  assert.equal(runs, 1, 'a tick at 12:00 does not send');
  assert.deepEqual(tooLate.db.sales_job_slots.map(r => [r.job, r.scope, r.slot, r.status, r.detail]), [[VISITOR_EMAIL_JOB, B, '2026-11-04 07:00', 'error', { missed: true, reason: MISSED_REASON }]]);
  await tick(tooLate, { jobs, scopes, now: at('12:01'), log: quiet });
  await tick(tooLate, { jobs, scopes, now: at('18:00'), log: quiet });
  assert.equal(tooLate.db.sales_job_slots.length, 1, 'one missed row per slot');
  assert.equal(runs, 1);
  assert.equal(missedSlots(jobs, laInstant('2026-11-07', '13:00')).length, 0, 'Saturday has no slot to miss');
  assert.equal(schedulerState.last_tick_at, new Date(at('18:00')).toISOString(), 'V3c: the state records the last tick');
});

test('V3b: Needs attention line - sent today = ok with the count; a missed or failed row = failed with the reason + Send now; no row after noon = missed; due words before', () => {
  const settings = { visitor_on: true };
  const at = hm => laInstant('2026-11-04', hm);
  const sentRow = { slot: '2026-11-04 07:00', status: 'ok', detail: { status: 'sent', recipients: 4 }, claimed_at: '2026-11-04T15:00:01Z', finished_at: '2026-11-04T15:00:06Z' };
  assert.deepEqual([visitorEmailLine(null, [], at('08:00')).status, visitorEmailLine(null, [], at('08:00')).line], ['ok', 'Not set up']);
  assert.deepEqual([visitorEmailLine({ visitor_on: false }, [], at('08:00')).status, visitorEmailLine({ visitor_on: false }, [], at('08:00')).line], ['ok', 'Off in Settings › Team emails']);
  const ok = visitorEmailLine(settings, [sentRow], at('08:00'));
  assert.deepEqual([ok.status, ok.line, ok.last_at], ['ok', 'Sent Wed to 4 recipients', '2026-11-04T15:00:06Z']);
  const missed = visitorEmailLine(settings, [{ slot: '2026-11-04 07:00', status: 'error', detail: { missed: true, reason: MISSED_REASON }, claimed_at: '2026-11-04T20:00:00Z', finished_at: '2026-11-04T20:00:00Z' }], at('13:00'));
  assert.deepEqual([missed.status, missed.error, missed.send_now], ['failed', `Visitor email: missed Wed — ${MISSED_REASON}`, true]);
  const blocked = visitorEmailLine(settings, [{ slot: '2026-11-04 07:00', status: 'ok', detail: { status: 'needs_reconnect', recipients: 0 }, claimed_at: '2026-11-04T15:00:01Z', finished_at: '2026-11-04T15:00:08Z' }], at('08:00'));
  assert.deepEqual([blocked.status, blocked.error, blocked.send_now], ['failed', 'Visitor email: needs_reconnect Wed', true]);
  const gone = visitorEmailLine(settings, [{ ...sentRow, slot: '2026-11-03 07:00' }], at('13:00'));
  assert.deepEqual([gone.status, gone.error, gone.last_at], ['failed', 'Visitor email: missed Wed — no scheduler slot by 12:00', '2026-11-04T15:00:06Z']);
  assert.deepEqual([visitorEmailLine(settings, [], at('06:00')).line, visitorEmailLine(settings, [], at('09:00')).line, visitorEmailLine(settings, [], laInstant('2026-11-07', '13:00')).line], ['Due at 7:00 AM', 'Due — the scheduler catches up until noon', 'Next on a weekday at 7:00 AM']);
  assert.ok(!JSON.stringify([ok, missed, blocked, gone]).includes('@'));
});

test('V3b: Send now - owner / admin only; runs the job from stored data and writes the day\'s slot; refused once today\'s email went out', async () => {
  const s = sb();
  const calls = [];
  const job = async (_s, bid, o) => { calls.push([bid, o.pull]); return { status: 'sent', recipients: 2, rows: 3, overall: 10 }; };
  assert.equal((await sendNow(s, { businessId: B, isAdmin: false, now: NOW, job })).status, 403);
  const r = await sendNow(s, { businessId: B, isAdmin: true, now: NOW, job });
  assert.deepEqual([r.status, r.body], [200, { status: 'sent', recipients: 2, rows: 3, overall: 10, again: false }]);
  assert.deepEqual(calls, [[B, null]], 'the same job, no pull');
  const row = s.db.sales_job_slots[0];
  assert.deepEqual([row.job, row.scope, row.slot, row.status, row.detail], [VISITOR_EMAIL_JOB, B, '2026-11-04 07:00', 'ok', { status: 'sent', recipients: 2, rows: 3, overall: 10, via: 'send_now', manual: { by: null, name: null, at: '2026-11-04T15:00:00.000Z', status: 'sent', recipients: 2, again: false } }]);
  const again = await sendNow(s, { businessId: B, isAdmin: true, now: NOW, job });
  assert.deepEqual([again.status, again.body.error, calls.length], [409, "Today's visitor email already went out to 2 recipients", 1]);
  // A blocked sender: the slot says so and Send now stays offered (the line reads failed), no second copy of anything.
  const s2 = sb();
  const b = await sendNow(s2, { businessId: B, isAdmin: true, now: NOW, job: async () => ({ status: 'needs_reconnect', recipients: 0, error: RECONNECT_NOTE }) });
  assert.deepEqual([b.status, b.body.status, s2.db.sales_job_slots[0].status, s2.db.sales_job_slots[0].detail.error], [200, 'needs_reconnect', 'error', RECONNECT_NOTE]);
  assert.equal(visitorEmailLine({ visitor_on: true }, s2.db.sales_job_slots, NOW + 3600e3).status, 'failed');
});

test('V2 / V1 job: "Send a test to me only" and the 07:00 job both carry list B; the test send goes to the mailbox alone', async () => {
  const id = n => `00000000-0000-4000-8000-0000000ad0${String(n).padStart(2, '0')}`;
  const s = sb({ sales_company_scores: Array.from({ length: 3 }, (_, n) => ({ business_id: B, company_type: 'employer', company_id: id(n), score: 70 - n, band: 'P1', closed: false, flagged_out: false, duplicate_of: null, components: { meta: { name: `Book ${n}` } } })) });
  const g = graph();
  const r = await visitorEmailJob(s, B, { now: NOW, pull: null, deps: g.deps, test: true });
  assert.deepEqual([r.status, r.recipients, r.rows, r.overall], ['sent', 1, 0, 3]);
  const mime = g.calls[0].mime;
  assert.deepEqual(toOf(mime), [MAIL.owner]);
  const text = Buffer.from(mime.split('\r\n\r\n')[2].split('\r\n--')[0].replace(/\r\n/g, ''), 'base64').toString('utf8');
  assert.match(text, /TOP 10 RIGHT NOW — WHOLE BOOK[\s\S]*1\. Book 0 — Hot 70 · new/);
  const subject = Buffer.from(mime.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/)[1], 'base64').toString('utf8');
  assert.equal(subject, 'Website visitors · Tue Nov 3 — 0 new, 0 worth a look, top: Book 0');
});

// ---- follow-up addition: list A gates, rank, why, never padded; Send to team now (check / again / manual) -----------
import { qualifies, detailOf, rankVisitors } from './visitorEmail.js';

test('gates: a named person, 2+ pages, 2+ visitors, or Warm+ each qualify alone; a bare visit does not', () => {
  const bare = { people: 0, pages: 1, visitors: 1, band: 'P3' };
  assert.equal(qualifies(bare), false);
  assert.equal(qualifies({ ...bare, people: 1 }), true, 'named person');
  assert.equal(qualifies({ ...bare, pages: 2 }), true, '2 pages');
  assert.equal(qualifies({ ...bare, visitors: 2 }), true, '2 visitors');
  assert.equal(qualifies({ ...bare, band: 'P2' }), true, 'Warm');
  assert.equal(qualifies({ ...bare, band: 'P1' }), true, 'Hot');
  assert.equal(qualifies({ ...bare, band: 'P4', pages: 0, visitors: 0 }), false, 'Cold, nothing else');
});

test('v2 V1 rank: score desc, then unique visitors, then pages, then the name; line 2 reads "2 visits · 3 people · last 7 days · pages: /pricing, / (home) +2 · 2 named: VP HR, Analyst"', () => {
  const rows = [
    co(0, { company: 'Score only', score: 99, visitors: 1, pages: 1 }),
    co(1, { company: 'Pages', score: 10, visitors: 1, pages: 5 }),
    co(2, { company: 'Visitors', score: 10, visitors: 3, pages: 1 }),
    co(3, { company: 'Buyer', score: 5, buyers: 1, people: 2, visitors: 3, pages: 4, paths: ['/pricing', '/'], titles: ['VP HR', 'Analyst'] }),
    co(4, { company: 'Also 10', score: 10, visitors: 3, pages: 1 }),
  ];
  assert.deepEqual(rankVisitors(rows).map(r => r.company), ['Score only', 'Also 10', 'Visitors', 'Pages', 'Buyer']);
  assert.equal(detailOf(rows[3]), '2 visits · 3 people · last 7 days · pages: /pricing, / (home) +2 · 2 named: VP HR, Analyst');
  assert.equal(detailOf(co(9, { visitors: 0, people: 0, pages: 0, paths: [] })), '2 visits · last 7 days');
});

test('v2 never padded: 4 qualify of 14 visited -> 4 rows in A under "All 4 qualified", "10 not qualified · all 14 on the Map →"; A0 caps at 10 with "Showing 10 of 14"; 0 qualify says why; the subject counts', () => {
  const rows = Array.from({ length: 14 }, (_, i) => co(i, { visitors: 1, pages: 1, band: i < 4 ? 'P2' : 'P3', people: 0 }));
  const m = buildVisitorEmail(rows, { date: '2026-11-04' });
  assert.deepEqual([m.rows, m.new_rows, m.qualified, m.visited, m.more, m.new, m.returning], [4, 7, 4, 14, 0, 7, 7]);
  assert.equal(m.subject, 'Website visitors · Tue Nov 3 — 7 new, 4 worth a look');
  assert.match(m.text, /WORTH A LOOK YESTERDAY\nAll 4 qualified, ranked by intent\. Qualified = Warm or hotter, a named person, or 2\+ visitors or pages\.\n1\. /);
  assert.match(m.text, /\n10 not qualified · all 14 on the Map → https:/);
  assert.match(m.html, /<div[^>]*>10 not qualified · <a href="[^"]*view=priorities"[^>]*>all 14 on the Map →<\/a><\/div>/);
  assert.equal((m.text.match(/^\d+\. /gm) || []).length, 7 + 4);
  const none = buildVisitorEmail(rows.map(r => ({ ...r, band: 'P4' })), { date: '2026-11-04' });
  assert.deepEqual([none.rows, none.qualified, none.visited], [0, 0, 14]);
  assert.match(none.text, /WORTH A LOOK YESTERDAY\nNo company qualified yesterday \(Warm or hotter, a named person, or 2\+ visitors or pages\)\.\n14 not qualified · all 14 on the Map →/);
  assert.match(none.html, /No company qualified yesterday/);
  assert.equal((none.text.match(/^\d+\. /gm) || []).length, 7, 'A0 still lists the new');
  const many = buildVisitorEmail(Array.from({ length: 14 }, (_, i) => co(i, { is_new: true })), { date: '2026-11-04' });
  assert.deepEqual([many.new_rows, many.new], [10, 14]);
  assert.match(many.text, /14 companies we had never seen on the site before\. None are in Prospector yet — Add puts them on the Map as a target\.\n1\. [\s\S]*10\. [^\n]+\n[^\n]+\n[^\n]+\nShowing 10 of 14 · all 14 on the Map → https:/);
  assert.match(many.html, /Showing 10 of 14 · <a href="[^"]*view=priorities"[^>]*>all 14 on the Map →<\/a>/);
});

test('loader: pages = top_paths length, buyers from sales_settings.buyer_titles (buyer titles listed first), last touch read for qualified rows only', async () => {
  const visit = (n, extra) => ({ id: `00000000-0000-4000-8000-00000000f00${n}`, business_id: B, company_key: `k${n}`, company_name: `Co ${n}`, visits_7d: 2, unique_visitors_7d: 1, top_paths: [{ path: '/pricing' }, { path: '/about' }, { path: '/jobs' }], intent_score: 40, priority: 'P3', matched_type: null, matched_id: null, pulled_on: '2026-11-04', seen_from: '2026-11-03', seen_to: '2026-11-04', created_at: '2026-11-04T10:00:00Z', updated_at: '2026-11-04T10:00:00Z', ...extra });
  const s = sb({
    sales_settings: [{ business_id: B, buyer_titles: ['hr', 'benefits'] }],
    web_visits: [visit(1), visit(2, { top_paths: [], unique_visitors_7d: 1 })],
    sales_people: [{ id: 'p1', business_id: B, visit_id: '00000000-0000-4000-8000-00000000f001', name: 'Jordan Visitorperson', title: 'Analyst', archived_at: null }, { id: 'p2', business_id: B, visit_id: '00000000-0000-4000-8000-00000000f001', name: 'Sam Otherperson', title: 'VP HR', archived_at: null }],
  });
  const rows = await loadVisitorData(s, B, { window: dayWindowFor('2026-11-04'), members: await loadMembers(s, B) });
  const by = Object.fromEntries(rows.map(r => [r.company, r]));
  assert.deepEqual([by['Co 1'].pages, by['Co 1'].people, by['Co 1'].buyers, by['Co 1'].titles], [3, 2, 1, ['VP HR', 'Analyst']]);
  assert.deepEqual(by['Co 1'].paths, ['/pricing', '/about']);
  assert.equal(detailOf(by['Co 1']), '2 visits · 1 person · last 7 days · pages: /pricing, /about +1 · 2 named: VP HR, Analyst');
  assert.deepEqual([by['Co 2'].pages, by['Co 2'].people, qualifies(by['Co 2'])], [0, 0, false]);
  const mail = buildVisitorEmail(rows, { date: '2026-11-04' });
  assert.deepEqual([mail.rows, mail.qualified, mail.visited], [1, 1, 2]);
  assert.ok(!/Jordan|Visitorperson|Otherperson|Sam |@/.test(mail.html + mail.text));
});

test('Send to team now: check answers sent_today without sending; again = owner only, sends a second copy and keeps the scheduled fields; the attention line says "(manual, Alex)"', async () => {
  const s = sb({ sales_job_slots: [{ job: VISITOR_EMAIL_JOB, scope: B, slot: '2026-11-04 07:00', status: 'ok', detail: { status: 'sent', recipients: 4, rows: 10 }, claimed_at: '2026-11-04T15:00:01Z', finished_at: '2026-11-04T15:00:06Z' }] });
  const calls = [];
  const job = async () => { calls.push(1); return { status: 'sent', recipients: 4, rows: 10, overall: 10 }; };
  const chk = await sendNow(s, { businessId: B, userId: U.owner, isAdmin: true, isOwner: true, check: true, now: NOW + 3.5 * 3600e3, job });
  assert.deepEqual([chk.status, chk.body, calls.length], [200, { sent_today: true, sent_at: '2026-11-04T15:00:06Z', recipients: 4, manual: null }, 0]);
  const plain = await sendNow(s, { businessId: B, userId: U.owner, isAdmin: true, isOwner: true, now: NOW + 3.5 * 3600e3, job });
  assert.deepEqual([plain.status, plain.body.sent_at, calls.length], [409, '2026-11-04T15:00:06Z', 0]);
  assert.equal((await sendNow(s, { businessId: B, userId: U.m1, isAdmin: true, isOwner: false, again: true, now: NOW, job })).status, 403, 'an admin who is not the owner cannot send a second copy');
  const again = await sendNow(s, { businessId: B, userId: U.owner, isAdmin: true, isOwner: true, again: true, now: NOW + 3.5 * 3600e3, job });
  assert.deepEqual([again.status, again.body.status, again.body.again, calls.length], [200, 'sent', true, 1]);
  const row = s.db.sales_job_slots[0];
  assert.deepEqual([row.status, row.detail.status, row.detail.recipients, row.detail.rows], ['ok', 'sent', 4, 10], 'the scheduled fields stay');
  assert.deepEqual(row.detail.manual, { by: U.owner, name: 'Alex', at: '2026-11-04T18:30:00.000Z', status: 'sent', recipients: 4, again: true });
  const line = visitorEmailLine({ visitor_on: true }, s.db.sales_job_slots, NOW + 4 * 3600e3);
  assert.deepEqual([line.status, line.line, line.last_at], ['ok', 'Sent Wed 10:30 AM (manual, Alex) to 4 recipients', '2026-11-04T18:30:00.000Z']);
  const chk2 = await sendNow(s, { businessId: B, userId: U.owner, isAdmin: true, isOwner: true, check: true, now: NOW + 4 * 3600e3, job });
  assert.deepEqual([chk2.body.sent_at, chk2.body.manual.name], ['2026-11-04T18:30:00.000Z', 'Alex'], 'check reports the latest copy');
  // A missed day: the first manual send fills the slot (no second confirm needed) and the line reads manual too.
  const s2 = sb();
  const first = await sendNow(s2, { businessId: B, userId: U.owner, isAdmin: true, isOwner: true, now: NOW + 6 * 3600e3, job });
  assert.deepEqual([first.status, first.body.again, s2.db.sales_job_slots[0].status, s2.db.sales_job_slots[0].detail.manual.again], [200, false, 'ok', false]);
  assert.match(visitorEmailLine({ visitor_on: true }, s2.db.sales_job_slots, NOW + 7 * 3600e3).line, /^Sent Wed 1:00 PM \(manual, Alex\) to 4 recipients$/);
  assert.ok(!JSON.stringify([chk.body, again.body, line]).includes('@'));
});

// ---- FIX visitor-email-v2 ----------------------------------------------------------------------------------------------
test('v2: the Nov 5 fixture (25 visited, 9 new, 16 qualified, Hilton on top) reads the E10 subject word for word; the data tables carry % widths only, no <style> / <script> / <img>, no "@"', () => {
  const rows = Array.from({ length: 25 }, (_, i) => co(i, { is_new: i < 9, visitors: i < 16 ? 2 : 1, pages: 1, band: i < 2 ? 'P1' : i < 23 ? 'P3' : 'P4', score: i < 2 ? 70 - i : 30 - i, ...(i === 9 ? { company: 'Hilton', type: 'employer', id: 'e1', stage: 'contacted', owner: 'Cyrus', owner_color: '#C97626' } : {}) }));
  const overall = { rows: [{ ...bookRow(0), company: 'Hilton', score: 78, band: 'P1', trend: 'up', prev_score: 76 }, bookRow(1)], total: 401, prev_day: '2026-11-05', thresholds: DEFAULT_WEIGHTS.thresholds };
  const m = buildVisitorEmail(rows, { date: '2026-11-06', overall, cumulative: { companies: 283, since: '2026-10-20' } });
  assert.equal(m.subject, 'Website visitors · Thu Nov 5 — 9 new, 16 worth a look, top: Hilton');
  assert.match(m.text, /^HOMELOVER · WEBSITE VISITORS · YESTERDAY\nThu Nov 5 — 25 companies visited, 9 for the first time\n[^\n]*Sent Fri 7:00 AM\./);
  assert.match(m.text, /25 visited · 9 new · 16 returning · 16 worth a look\nIntent of yesterday's 25: Hot 2 · Warm 0 · Cool 21 · Cold 2 · already in Prospector: 1 employer · 0 targets · 0 partners · 24 not yet/);
  assert.match(m.text, /The 10 strongest of the 16 qualified, ranked by intent\./);
  assert.match(m.text, /\nand 6 more qualified · 9 not qualified · all 25 on the Map → https:/);
  const tables = m.html.split('<table').slice(1).filter(t => t.includes('table-layout:fixed'));
  assert.equal(tables.length, 3, 'A0, A, B');
  for (const t of tables) {
    const widths = [...t.matchAll(/<t[dh] width="([^"]+)"/g)].map(x => x[1]);
    assert.ok(widths.length > 0 && widths.every(w => /^\d+%$/.test(w)), `every cell a % width: ${widths.slice(0, 5)}`);
    assert.ok([...t.split('</table>')[0].matchAll(/<t[dh] [^>]*>/g)].every(x => !/width:\s*\d+px|width="\d+"/.test(x[0])), 'no px width on a cell');
  }
  for (const t of tables.slice(0, 2)) { const pct = [...t.split('</tr>')[0].matchAll(/<th width="(\d+)%"/g)].map(x => Number(x[1])); assert.equal(pct.reduce((a, b) => a + b, 0), 100); assert.equal(pct.length, 4); }
  assert.ok(!/<img|<style|<script/i.test(m.html));
  assert.ok(!/@/.test(m.html + m.text));
  assert.ok(!m.html.includes('visits (Apollo, rolling 7 d)') && !m.html.includes('CUMULATIVE') && !m.html.includes('Windows: the list'), 'the old copy is gone');
});

test('v2 V3 loader: loadRankedBook carries the band thresholds from sales_settings.score_weights (the scores route\'s merge), the defaults without a row', async () => {
  const id = n => `00000000-0000-4000-8000-0000000ae0${String(n).padStart(2, '0')}`;
  const scores = [{ business_id: B, company_type: 'employer', company_id: id(1), score: 66, band: 'P1', closed: false, flagged_out: false, duplicate_of: null, components: { meta: { name: 'Co 1' } } }];
  const members = await loadMembers(sb(), B);
  const custom = await loadRankedBook(sb({ sales_company_scores: scores, sales_settings: [{ business_id: B, score_weights: { thresholds: { P1: 70, P2: 45, P3: 20 } } }] }), B, { now: NOW, members });
  assert.deepEqual(custom.thresholds, { P1: 70, P2: 45, P3: 20 });
  const plain = await loadRankedBook(sb({ sales_company_scores: scores }), B, { now: NOW, members });
  assert.deepEqual(plain.thresholds, DEFAULT_WEIGHTS.thresholds);
  const mail = buildVisitorEmail([], { date: '2026-11-04', overall: custom });
  assert.match(mail.text, /Hot ≥ 70 · Warm 45–69 · Cool 20–44 · Cold < 20/);
});

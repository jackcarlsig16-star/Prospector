import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fakeSupabase } from '../testing/fakeSupabase.mjs';
import { MICROSOFT_SCOPES, missingScopes, grantedScopes, refreshBody, canSendTeamEmail, NeedsMicrosoft } from '../../lib/microsoftGrants.js';
import * as sendModule from './send.js';
import { sendTeamEmail, loadMembers, RECONNECT_NOTE, MAX_RECIPIENTS } from './send.js';
import { laClock, dueSlots, tick, WEEKDAYS } from './scheduler.js';
import { last24, laInstant, buildVisitorEmail, loadVisitorData, loadRankedBook, TOP_N, BAND_WORD, LEGEND } from './visitorEmail.js';
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

// FIX visitor-email-top10-v1 V1: list A = the 24 hours before the send, whatever the weekday (Monday no longer reaches
// back to Friday); the loader keeps a row updated inside the window and drops one updated before it or at the send.
test('last 24 h: since = now - 24 h on both sides of the fall-back weekend; the loader keeps 23 h ago, drops 25 h ago and the send instant', async () => {
  const mon = last24(Date.parse('2026-11-02T15:00:00Z')); // Mon Nov 2 07:00 PST, the day after the clocks went back
  assert.equal(new Date(mon.since).toISOString(), '2026-11-01T15:00:00.000Z');
  assert.equal(mon.until - mon.since, 864e5);
  const mk = (n, at) => ({ id: `00000000-0000-4000-8000-00000000d00${n}`, business_id: B, company_key: `k${n}`, company_name: `Co ${n}`, visits_7d: 1, unique_visitors_7d: 1, top_paths: [], intent_score: 50, priority: 'P3', matched_type: null, matched_id: null, pulled_on: '2026-11-02', created_at: at, updated_at: at });
  const s = sb({ web_visits: [mk(1, '2026-11-01T16:00:00Z'), mk(2, '2026-11-01T14:00:00Z'), mk(3, '2026-11-02T15:00:00Z')] });
  const rows = await loadVisitorData(s, B, { ...mon, members: await loadMembers(s, B) });
  assert.deepEqual(rows.map(r => r.company), ['Co 1']);
});

const co = (i, extra = {}) => ({ company: `Company ${String(i).padStart(2, '0')}`, type: null, id: null, score: 100 - i, band: i < 3 ? 'P1' : 'P3', visits: 2, visitors: 1, people: 0, titles: [], top_page: '/', stage: null, owner: 'Unassigned', is_new: i % 2 === 0, ...extra });

test('REV2 T4: the redesign - header, 4 tiles, Hot / Warm / Cool / Cold pills, 5 columns, NEW, Add for unmatched; top 10 + "and n more"', () => {
  const big = buildVisitorEmail(Array.from({ length: 14 }, (_, i) => co(i)), { date: '2026-11-04', since: NOW - 864e5 });
  assert.equal(big.subject, 'Website visitors — Wed Nov 4: 14 in 24 h');
  assert.equal(big.rows, TOP_N);
  assert.match(big.text, /^HomeLover · Website visitors\nWed Nov 4 — 14 companies in the last 24 h, 3 hot\nCompanies Apollo identified on our site since Tue 7:00 AM - the 24 hours before this email/);
  assert.match(big.text, /14 companies · 7 new \(first time seen\) · 28 visits, last 7 days · 14 not in Prospector/);
  assert.match(big.text, /Hot 3 · Warm 0 · Cool 11 · Cold 0/);
  assert.match(big.text, /and 4 more · open the Map →/);
  assert.equal((big.text.match(/^\d+\. /gm) || []).length, 10);
  const h = big.html;
  assert.equal((h.match(/<td style="border:1px solid/g) || []).length, 4, 'four stat tiles');
  for (const w of Object.values(BAND_WORD)) assert.match(h, new RegExp(`>${w} \\d+</span>`));
  assert.deepEqual([...h.matchAll(/<th [^>]*>([^<]+)<\/th>/g)].map(m => m[1]), ['Company', 'Intent', 'Who visited', 'In Prospector', 'Owner', 'Last touch']);
  assert.match(h, />NEW</);
  assert.match(h, /Not yet · <a href="[^"]*channel=website_visit"[^>]*>Add<\/a>/);
  assert.match(h, /border:1px dashed[^>]*><\/span><span[^>]*>Unassigned/);
  assert.ok(!/<img|pixel|<style|<script/i.test(h));
  assert.ok(!/act today|this week|today|tonight|tomorrow|watch|noise/i.test(big.text.replace(/Website visitors|Since Tue/g, '')), 'no time words');
  const small = buildVisitorEmail(Array.from({ length: 10 }, (_, i) => co(i)), { date: '2026-11-04', since: NOW - 864e5 });
  assert.equal(small.rows, 10);
  assert.ok(!/more ·/.test(small.text));
  const none = buildVisitorEmail([], { date: '2026-11-04', since: NOW - 864e5 });
  assert.match(none.text, /No identified visitors in the last 24 hours \(since Tue 7:00 AM\)/);
  assert.match(none.text, /Sent by Prospector to the HomeLover team · manage recipients in Sales › Settings › Team emails/);
});

test('REV2 T4: singular / plural right, no "0 people", a matched row shows kind · stage title-cased and the owner dot', () => {
  const one = buildVisitorEmail([co(0, { visits: 1, people: 1, titles: ['VP People'], type: 'employer', id: 'e1', stage: 'proposal_pilot', owner: 'Casey', owner_color: '#C97626' })], { date: '2026-11-04', since: NOW - 864e5 });
  assert.equal(one.subject, 'Website visitors — Wed Nov 4: 1 in 24 h');
  assert.match(one.text, /1 company · 1 new \(first time seen\) · 1 visit, last 7 days · 0 not in Prospector/);
  assert.match(one.text, /matched 1 employer · 0 targets · 0 partners/);
  assert.match(one.text, /1 visit \(7 d\) · 1 visitor · 1 named · VP People/);
  assert.match(one.text, /In Prospector: Employer · Proposal Pilot · Owner: Casey/);
  assert.match(one.html, /background:#C97626[^>]*><\/span>Casey/);
  const zero = buildVisitorEmail([co(1, { people: 0 })], { date: '2026-11-04', since: NOW - 864e5 });
  assert.ok(!/0 people|0 person/.test(zero.text + zero.html));
});

test('visitor-email-clarity V1 / V2 / V4: honest labels + the legend in html and text; zero parts omitted except visits', () => {
  const m = buildVisitorEmail([co(0, { visits: 0, visitors: 0, people: 0 }), co(1, { visits: 3, visitors: 2, people: 1 })], { date: '2026-11-04', since: NOW - 864e5 });
  for (const body of [m.html, m.text]) {
    assert.ok(body.includes('Companies Apollo identified on our site since Tue 7:00 AM - the 24 hours before this email'));
    assert.ok(body.includes(esc(LEGEND)) || body.includes(LEGEND));
    for (const l of ['new (first time seen)', 'visits, last 7 days', 'not in Prospector']) assert.ok(body.includes(l), l);
  }
  assert.match(m.text, /3 visits \(7 d\) · 2 visitors · 1 named/);
  assert.match(m.text, /0 visits \(7 d\) · \/\n/, 'visits always shown; 0 visitors / 0 named omitted');
  assert.ok(!/0 visitors|0 named/.test(m.text + m.html));
});

test('visitor-email-clarity V3: Last touch = "<Mon d> · <first name> · <what>", "No touch yet", "—" for companies not in Prospector', () => {
  const at = '2026-11-03T18:00:00Z';
  const rows = [
    co(0, { type: 'partner', id: 'g1', last_touch: { at, by: 'Casey', what: 'email' } }),
    co(1, { type: 'partner', id: 'g2', last_touch: { at, by: 'Casey', what: 'call' } }),
    co(2, { type: 'partner', id: 'g3', last_touch: { at, by: null, what: 'meeting' } }),
    co(3, { type: 'partner', id: 'g4', last_touch: { at, by: 'Casey', what: 'note' } }),
    co(4, { type: 'employer', id: 'e1', last_touch: null }),
    co(5),
  ];
  const m = buildVisitorEmail(rows, { date: '2026-11-04', since: NOW - 864e5 });
  for (const t of ['Nov 3 · Casey · email', 'Nov 3 · Casey · call', 'Nov 3 · meeting', 'Nov 3 · Casey · note', 'No touch yet']) {
    assert.ok(m.text.includes(`Last touch: ${t}`), t);
    assert.ok(m.html.includes(`>${t}<`), `html ${t}`);
  }
  assert.ok(m.text.includes('Company 05 — ') && /Owner: Unassigned · Last touch: —\n/.test(m.text));
  const body = m.html.split('<tr>').filter(r => r.includes('<td valign'));
  assert.equal(body.length, 6);
  for (const r of body) assert.equal((r.match(/<td valign/g) || []).length, 6, 'six cells a row');
});

test('visitor-email-clarity V3 loader: last touch comes from the company panel source (partner touch event, employer to-do kind only, never its text)', async () => {
  const mk = (n, type, id) => ({ id: `00000000-0000-4000-8000-00000000c00${n}`, business_id: B, company_key: `k${n}`, company_name: `Co ${n}`, visits_7d: 4, unique_visitors_7d: 1, top_paths: [], intent_score: 60 - n, priority: 'P2', matched_type: type, matched_id: id, pulled_on: '2026-11-04', created_at: '2026-11-04T14:00:00Z', updated_at: '2026-11-04T14:00:00Z' });
  const G = '00000000-0000-4000-8000-00000000e001', O = '00000000-0000-4000-8000-00000000e002', O2 = '00000000-0000-4000-8000-00000000e003';
  const s = sb({
    web_visits: [mk(1, 'partner', G), mk(2, 'opportunity', O), mk(3, 'opportunity', O2), mk(4, null, null)],
    sales_goals: [{ id: G, business_id: B, name: 'Co 1', pipeline_status: 'contacted', owner_user_id: U.m1, last_touch_at: '2026-11-03T17:00:00Z' }],
    sales_partner_events: [{ id: 'ev1', business_id: B, goal_id: G, event: 'touch', touch_type: 'call', at: '2026-11-03T17:00:00Z', by_user: U.m1 }],
    sales_opportunities: [{ id: O, business_id: B, organization: 'Co 2', stage: 'contacted', owner_user_id: U.m1, client_status: null }, { id: O2, business_id: B, organization: 'Co 3', stage: 'contacted', owner_user_id: null, client_status: null }],
    sales_week_goals: [{ id: 'w1', business_id: B, kind: 'todo', link_type: 'opportunity', link_id: O, status: 'done', completed_at: '2026-11-02T20:00:00Z', text: 'Call Jordan Visitorperson back', owner_user_id: U.m1 }],
  });
  const members = await loadMembers(s, B);
  const { since, until } = last24(NOW);
  const rows = await loadVisitorData(s, B, { since, until, members });
  const by = Object.fromEntries(rows.map(r => [r.company, r.last_touch]));
  assert.deepEqual(by['Co 1'], { at: '2026-11-03T17:00:00Z', by: 'Casey', what: 'call' });
  assert.deepEqual(by['Co 2'], { at: '2026-11-02T20:00:00Z', by: 'Casey', what: 'to-do' });
  assert.equal(by['Co 3'], null);
  assert.equal(by['Co 4'], undefined);
  const mail = buildVisitorEmail(rows, { date: '2026-11-04', since });
  assert.ok(mail.text.includes('Last touch: Nov 3 · Casey · call') && mail.text.includes('Last touch: Nov 2 · Casey · to-do') && mail.text.includes('Last touch: No touch yet') && mail.text.includes('Last touch: —'));
  assert.ok(!/Jordan|Visitorperson|@|\d{3}-\d{3}-\d{4}/.test(mail.html + mail.text), 'no names, emails or phones');
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
  const { since, until } = last24(NOW);
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
  const visit = { id: '00000000-0000-4000-8000-00000000c101', business_id: B, company_key: 'globex', company_name: 'Globex Benefits', visits_7d: 3, unique_visitors_7d: 2, top_paths: [{ path: '/employers', visits: 2 }], intent_score: 60, priority: 'P2', matched_type: null, matched_id: null, pulled_on: '2026-11-04', created_at: '2026-11-04T14:30:00Z', updated_at: '2026-11-04T14:30:00Z' };
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
  assert.match(body, /3 visits \(7 d\) · 2 visitors · 1 named · Head of Total Rewards · \/employers/);
  assert.ok(!/Lee|Personname/.test(body));
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(server, /people: people\.runVisitorPeoplePull/);
});

// ---- FIX visitor-email-top10-v1 ---------------------------------------------------------------------------------------
const bookRow = (i, extra = {}) => ({ rank: i + 1, company: `Ranked ${String(i).padStart(2, '0')}`, type: 'employer', id: `00000000-0000-4000-8000-0000000ab0${String(i).padStart(2, '0')}`, score: 90 - i, band: i < 2 ? 'P1' : 'P2', stage: 'contacted', owner: 'Casey', owner_color: '#C97626', trend: ['up', 'down', 'flat', 'new'][i % 4], prev_score: i % 4 === 3 ? null : 90 - i + (i % 4 === 0 ? -5 : i % 4 === 1 ? 5 : 0), last_touch: i % 2 ? null : { at: '2026-11-03T17:00:00Z', by: 'Casey', what: 'call' }, ...extra });

test('V1: two lists - A (24 h) then B (overall) with trend, both in html and text; a company in both appears in both; the subject names #1 overall', () => {
  const overall = { rows: Array.from({ length: 10 }, (_, i) => bookRow(i)), total: 435, prev_day: '2026-11-03' };
  const both = co(0, { company: 'Ranked 03', type: 'employer', id: overall.rows[3].id, stage: 'contacted', owner: 'Casey', owner_color: '#C97626' });
  const m = buildVisitorEmail([both, co(1), co(2)], { date: '2026-11-04', since: NOW - 864e5, overall });
  assert.equal(m.subject, 'Website visitors — Wed Nov 4: 3 in 24 h · top overall: Ranked 00');
  assert.equal(m.overall, 10);
  const heads = [...m.html.matchAll(/<th [^>]*>([^<]+)<\/th>/g)].map(x => x[1]);
  assert.deepEqual(heads, ['Company', 'Intent', 'Who visited', 'In Prospector', 'Owner', 'Last touch', 'Company', 'Intent', 'Trend', 'In Prospector', 'Owner', 'Last touch']);
  assert.match(m.html, /Top 10 — last 24 hours/); assert.match(m.html, /Top 10 — overall right now/);
  assert.match(m.html, /The whole ranked book \(435 companies\), the Map&#39;s order · ▲ ▼ since Tue Nov 3/);
  assert.equal((m.html.match(/Ranked 03/g) || []).length, 2, 'in both lists');
  const t = m.text;
  assert.ok(t.indexOf('Top 10 — last 24 hours') < t.indexOf('Top 10 — overall right now'));
  assert.match(t, /1\. Ranked 00 — Hot 90 · ▲ 85→90/);
  assert.match(t, /2\. Ranked 01 — Hot 89 · ▼ 94→89/);
  assert.match(t, /3\. Ranked 02 — Warm 88 · –\n/);
  assert.match(t, /4\. Ranked 03 — Warm 87 · new/);
  assert.match(t, /Last touch: Nov 3 · Casey · call/);
  assert.equal((t.match(/^\d+\. /gm) || []).length, 13, '3 in A + 10 in B');
  assert.ok(!/@|\d{3}-\d{3}-\d{4}/.test(m.html + m.text), 'no address, no phone');
  // B alone when nothing visited in 24 h; the legend still closes the mail.
  const quiet = buildVisitorEmail([], { date: '2026-11-04', since: NOW - 864e5, overall });
  assert.match(quiet.text, /No identified visitors in the last 24 hours[\s\S]*Top 10 — overall right now[\s\S]*Companies = organisations/);
  assert.equal(quiet.subject, 'Website visitors — Wed Nov 4: 0 in 24 h · top overall: Ranked 00');
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
  assert.deepEqual([r.status, r.body], [200, { status: 'sent', recipients: 2, rows: 3, overall: 10 }]);
  assert.deepEqual(calls, [[B, null]], 'the same job, no pull');
  const row = s.db.sales_job_slots[0];
  assert.deepEqual([row.job, row.scope, row.slot, row.status, row.detail], [VISITOR_EMAIL_JOB, B, '2026-11-04 07:00', 'ok', { status: 'sent', recipients: 2, rows: 3, overall: 10, via: 'send_now' }]);
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
  assert.match(text, /Top 10 — overall right now[\s\S]*1\. Book 0 — Hot 70 · new/);
  const subject = Buffer.from(mime.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/)[1], 'base64').toString('utf8');
  assert.equal(subject, 'Website visitors — Wed Nov 4: 0 in 24 h · top overall: Book 0');
});

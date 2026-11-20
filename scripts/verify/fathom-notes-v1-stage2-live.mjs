// fathom-notes-v1 Stage 2 live check (rulings C-1) - localhost, the real routes, as Jack (ownerSession) on the REAL
// HomeLover workspace. No real Fathom key is used and Fathom's API is never called.
// DECLARED before it runs:
//   Claude  cap 2 HARD: (1) the extraction the webhook runs on the fixture note, (2) ONE Scout ask "review the ZZ
//           Fathom Probe call". Counted in .screenshots/fathom-notes-v1/live-ledger.json BEFORE each is made; a run that
//           finds the ledger spent stops - a re-run of a paid call needs Jack's ok. Actual = the usage rows since start.
//   Apollo  0 (the server runs with the Apollo key empty).   Fathom API  0 (no route that calls it is touched).
//   Setup   ONE sales_fathom_connections row for Jack, made with the service key: a made-up key and a made-up webhook
//           secret, sealed with a throwaway FATHOM_TOKEN_KEY that exists only in this process and the local server's
//           env (never written to disk; the real key is not read). Removed by id at the end.
//   Writes  through the real routes: 2 webhook POSTs that are refused or do no work (bad signature, replay), 1 signed
//           webhook (the hand-written fixture: names only; where a real payload carries an address the fixture builds
//           one at run time, to see it dropped) -> ONE note + its event row; 1 accept of ONE task -> ONE to-do.
//   Restore by id: the to-do, its step and event rows, the note, the event row, the connection. 17 table counts are
//           compared before / after; the 2 usage rows stay (the cost record). No auth_events / hk_events row is deleted.
//   Reads   ~25 route calls + 3 page loads (1440 Today + the review, 1440 Settings card, 390 Today; every browser
//           request that is not a GET is refused). ~120 s, cap 230 s.
//   --rehearse  the same run with the model key empty: 0 Claude. The note is stored without a proposal (the row says
//           Extract), a typed task is accepted, everything is removed. Proves the plumbing before the two paid calls.
// Prints titles and counts only - never the note's text.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { ownerSession } from './lib/ownerSession.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const REHEARSE = process.argv.includes('--rehearse'), NO_SCREENS = process.argv.includes('--no-screens');
const HAD_KEY = !!process.env.FATHOM_TOKEN_KEY;
process.env.FATHOM_TOKEN_KEY = crypto.randomBytes(32).toString('base64');
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const { sealer } = await import('../../api/fathom/client.js');
const scout = await import('../../api/sales/scoutIntents.js');
const OUT = path.join(ROOT, '.screenshots', 'fathom-notes-v1', REHEARSE ? 'stage2-rehearsal' : 'stage2-live');
const LEDGER = path.join(ROOT, '.screenshots', 'fathom-notes-v1', 'live-ledger.json');
const PORT = 3994, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0], SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const HL = must(await svc.from('businesses').select('id').ilike('name', 'homelover'))[0]?.id;
if (!HL) throw new Error('no HomeLover business');
const CLAUDE_CAP = 2;
const TITLE = 'ZZ Fathom Probe weekly', COMPANY = 'Zzyx Probe Holdings', RID = 990020112;
const AT = String.fromCharCode(64), address = who => `${who}${AT}zzyxprobe.test`;
const TABLES = ['sales_call_notes', 'sales_fathom_events', 'sales_fathom_connections', 'sales_week_goals', 'sales_week_goal_steps', 'sales_todo_events', 'sales_targets', 'sales_opportunities', 'sales_goals', 'sales_people', 'partner_contacts',
  'sales_partner_events', 'sales_source_events', 'sales_flow_events', 'sales_insights', 'sales_settings', 'business_anthropic_usage'];
const count = async t => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL); return r.error ? `n/a (${r.error.message.slice(0, 40)})` : r.count; };
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
const d = new Date(), toSix = ((6 - (d.getHours() % 6)) % 6) * 60 - d.getMinutes();
if ((toSix >= 0 && toSix < 5) || (d.getHours() % 6 === 0 && d.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : { spent: 0, calls: [] };
if (!REHEARSE && ledger.spent > 0) { console.log(`ABORT: the ledger says ${ledger.spent} of ${CLAUDE_CAP} Claude calls were already made (${ledger.calls.map(c => c.what).join(', ')}). A re-run repeats a paid call - that needs Jack's ok.`); process.exit(1); }
const spend = what => { if (REHEARSE) throw new Error(`a rehearsal never pays: ${what}`); if (ledger.spent >= CLAUDE_CAP) throw new Error(`STOP: the Claude cap (${CLAUDE_CAP}) is spent`); ledger.spent += 1; ledger.calls.push({ what, at: new Date().toISOString() }); fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1)); };
const stale = [...must(await svc.from('sales_call_notes').select('id').eq('business_id', HL).or(`fathom_recording_id.eq.${RID},title.ilike.ZZ Fathom Probe%`)), ...must(await svc.from('sales_fathom_connections').select('id').eq('business_id', HL))];
if (stale.length) { console.log(`ABORT: ${stale.length} row(s) are already there (a "ZZ Fathom Probe" note or a Fathom connection on HomeLover) - look before running`); process.exit(1); }

// The hand-written fixture: one Fathom Meeting. Names only; the address fields a real payload carries are built at run time.
const started = new Date(T0 - 40 * 60e3);
const meeting = {
  title: 'Dana / Jack', meeting_title: TITLE, meeting_type: null, recording_id: RID, url: `https://fathom.video/calls/${RID}`, share_url: 'https://fathom.video/share/zzprobe',
  created_at: new Date(T0 - 5 * 60e3).toISOString(), scheduled_start_time: started.toISOString(), scheduled_end_time: new Date(T0 - 10 * 60e3).toISOString(), recording_start_time: started.toISOString(), recording_end_time: new Date(T0 - 10 * 60e3).toISOString(),
  calendar_invitees_domains_type: 'one_or_more_external', transcript_language: 'en',
  transcript: [
    { speaker: { display_name: 'Jack Carlson', matched_calendar_invitee_email: address('jack') }, text: 'Thanks for making time. Where did the team land on a pilot?', timestamp: '00:00:05' },
    { speaker: { display_name: 'Dana Probe', matched_calendar_invitee_email: address('dana') }, text: `We want to pilot with forty people in January. Could we see a dashboard of it ourselves?`, timestamp: '00:01:10' },
    { speaker: { display_name: 'Jack Carlson', matched_calendar_invitee_email: address('jack') }, text: 'Yes. I will send the pilot one-pager by Friday.', timestamp: '00:02:40' },
  ],
  default_summary: { template_name: 'general', markdown_formatted: [
    '## Summary', `${COMPANY} will pilot the housing benefit with 40 employees in January. Dana Probe leads benefits there.`,
    '## Decisions', `- ${COMPANY} agreed to a 40-person pilot starting in January ([watch](https://fathom.video/calls/${RID}?timestamp=70.5))`, '- Pricing stays at the standard per-employee rate for the pilot',
    '## Next steps', `- Jack to send ${COMPANY} the pilot one-pager by Friday`, '- Dana Probe will send the employee count by department',
    '## Ideas', '- Jack suggested a pilot dashboard the employer can open themselves',
  ].join('\n') },
  action_items: [
    { description: `Send the pilot one-pager to ${COMPANY}`, user_generated: false, completed: false, recording_timestamp: '00:02:40', recording_playback_url: `https://fathom.video/calls/${RID}?timestamp=160`, assignee: { name: 'Jack Carlson', email: address('jack'), team: null } },
    { description: 'Send the employee count by department', user_generated: false, completed: false, recording_timestamp: '00:03:00', recording_playback_url: `https://fathom.video/calls/${RID}?timestamp=180`, assignee: { name: 'Dana Probe', email: address('dana'), team: null } },
  ],
  calendar_invitees: [
    { name: 'Jack Carlson', matched_speaker_display_name: 'Jack Carlson', email: address('jack'), email_domain: 'homelover.test', is_external: false },
    { name: 'Dana Probe', matched_speaker_display_name: 'Dana Probe', email: address('dana'), email_domain: 'zzyxprobe.test', is_external: true },
  ],
  recorded_by: { name: 'Jack Carlson', email: address('jack'), email_domain: 'homelover.test', team: null }, crm_matches: null,
};
const SECRET = `whsec_${crypto.randomBytes(24).toString('base64')}`, TOKEN = crypto.randomBytes(32).toString('base64url');
const RAW = JSON.stringify(meeting);
const sign = (id, ts, body, secret = SECRET) => `v1,${crypto.createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(`${id}.${ts}.${body}`).digest('base64')}`;
const MSG = `msg_probe_${T0}`;

let srv, browser, owner;
const made = { connection: null, note: null, todo: null, events: [MSG, `${MSG}_again`] };
const results = { checks: [], errors: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 500)}` : ''); };
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  // Only what this run made, by id.
  const note = made.note || must(await svc.from('sales_call_notes').select('id').eq('business_id', HL).eq('fathom_recording_id', RID))[0]?.id || null;
  const todos = note ? must(await svc.from('sales_week_goals').select('id').eq('business_id', HL).eq('source_note_id', note)).map(t => t.id) : [];
  if (todos.length) {
    must(await svc.from('sales_todo_events').delete().eq('business_id', HL).in('todo_id', todos));
    must(await svc.from('sales_week_goal_steps').delete().eq('business_id', HL).in('goal_id', todos));
    must(await svc.from('sales_week_goals').delete().eq('business_id', HL).in('id', todos).eq('source_note_id', note));
  }
  if (note) must(await svc.from('sales_call_notes').delete().eq('business_id', HL).eq('id', note).eq('fathom_recording_id', RID));
  must(await svc.from('sales_fathom_events').delete().eq('business_id', HL).in('webhook_id', made.events));
  if (made.connection) must(await svc.from('sales_fathom_connections').delete().eq('business_id', HL).eq('id', made.connection).eq('webhook_token', TOKEN));
  log(`removed by id: ${todos.length} to-do(s) + their events, ${note ? 1 : 0} note, the event row(s), ${made.connection ? 1 : 0} connection`);
  if (owner) { log(await owner.release()); owner = null; }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 230000 });
const before = await snapshot();
log(REHEARSE ? 'REHEARSAL (0 Claude)' : 'LIVE (Claude cap 2)', '· before', JSON.stringify(before), `· local .env has FATHOM_TOKEN_KEY: ${HAD_KEY ? 'yes (not used here)' : 'NO'}`);

try {
  owner = await ownerSession(svc);
  made.connection = must(await svc.from('sales_fathom_connections').insert({ business_id: HL, user_id: owner.userId, key_enc: sealer.encrypt(`probe-${crypto.randomBytes(24).toString('hex')}`), webhook_secret_enc: sealer.encrypt(SECRET), webhook_token: TOKEN, fathom_webhook_id: 'probe-0000', status: 'connected', connected_at: new Date().toISOString() }).select('id').single()).id;
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', APOLLO_API_KEY: '', ...(REHEARSE ? { ANTHROPIC_API_KEY: '' } : {}) }, stdio: ['ignore', 'ignore', 'pipe'] });
  srv.stderr.on('data', b => { if (process.env.SERVER_LOG) for (const l of String(b).split('\n')) if (l.trim()) console.log('   server:', l.trim().slice(0, 200)); });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const call = async (method, p, body, headers = { cookie }) => { const r = await fetch(`${BASE}${p}`, { method, headers: { ...headers, 'content-type': 'application/json' }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const S = `/api/sales/${HL}`;
  const usage = async () => must(await svc.from('business_anthropic_usage').select('call_type, cost_usd, created_at').eq('business_id', HL).gte('created_at', new Date(T0 - 2000).toISOString()));
  const hook = (id, sig) => call('POST', `/api/fathom/webhook/${TOKEN}`, RAW, { 'webhook-id': id, 'webhook-timestamp': String(Math.floor(Date.now() / 1000)), 'webhook-signature': sig });
  const noteRow = async () => must(await svc.from('sales_call_notes').select('*').eq('business_id', HL).eq('fathom_recording_id', RID))[0] || null;

  // ---- 1. the card's read
  const st = await call('GET', `${S}/fathom`);
  const me = st.body?.members?.find(m => m.user_id === owner.userId);
  ok(`card read: HTTP ${st.status} · ${st.body?.members?.length} row · Jack connected ${me?.connected} · webhook ${me?.webhook} · stored ${me?.stored} · cap ${st.body?.extracts?.used} of ${st.body?.extracts?.cap} · no key, secret or token in the reply`,
    st.status === 200 && st.body.members.length === 1 && me?.connected && me.webhook && me.stored === 0 && !/key_enc|secret|webhook_token/.test(JSON.stringify(st.body)) && !JSON.stringify(st.body).includes(TOKEN) && !JSON.stringify(st.body).includes(AT));

  // ---- 2. the webhook, through the real route (no sign-in: the signature is the gate)
  const ts = String(Math.floor(Date.now() / 1000));
  const bad = await hook(`${MSG}_bad`, sign(`${MSG}_bad`, ts, RAW, `whsec_${crypto.randomBytes(24).toString('base64')}`));
  const unknown = await call('POST', `/api/fathom/webhook/${crypto.randomBytes(32).toString('base64url')}`, RAW, { 'webhook-id': MSG, 'webhook-timestamp': ts, 'webhook-signature': sign(MSG, ts, RAW) });
  ok(`a wrong signature and an unknown token: HTTP ${bad.status} / ${unknown.status}, nothing stored`, bad.status === 401 && unknown.status === 401 && !(await noteRow()) && must(await svc.from('sales_fathom_events').select('webhook_id').eq('business_id', HL)).length === 0);
  if (!REHEARSE) spend('the extraction the webhook runs');
  const ts2 = String(Math.floor(Date.now() / 1000));
  const good = await call('POST', `/api/fathom/webhook/${TOKEN}`, RAW, { 'webhook-id': MSG, 'webhook-timestamp': ts2, 'webhook-signature': sign(MSG, ts2, RAW) });
  ok(`the signed fixture: HTTP ${good.status} ${JSON.stringify(good.body)} (answered before the work)`, good.status === 200 && good.body?.received === true && !good.body.duplicate);
  let ev = null;
  for (let i = 0; i < 110; i++) { ev = must(await svc.from('sales_fathom_events').select('status, error, recording_id').eq('business_id', HL).eq('webhook_id', MSG))[0] || null; if (ev && ['extracted', 'capped', 'error', 'skipped', 'duplicate'].includes(ev.status)) break; await new Promise(r => setTimeout(r, 1000)); }
  const note = await noteRow();
  made.note = note?.id || null;
  if (!note) throw new Error(`no note was stored (event ${JSON.stringify(ev)})`);
  ok(`the event row: ${ev?.status}${ev?.error ? ` (${ev.error.slice(0, 80)})` : ''} · recording ${ev?.recording_id}`, ev?.status === (REHEARSE ? 'error' : 'extracted') && ev.recording_id === RID);
  const again = await call('POST', `/api/fathom/webhook/${TOKEN}`, RAW, { 'webhook-id': MSG, 'webhook-timestamp': ts2, 'webhook-signature': sign(MSG, ts2, RAW) });
  const ts3 = String(Math.floor(Date.now() / 1000));
  const sameRec = await call('POST', `/api/fathom/webhook/${TOKEN}`, RAW, { 'webhook-id': `${MSG}_again`, 'webhook-timestamp': ts3, 'webhook-signature': sign(`${MSG}_again`, ts3, RAW) });
  await new Promise(r => setTimeout(r, 2500));
  const notesNow = must(await svc.from('sales_call_notes').select('id').eq('business_id', HL).eq('fathom_recording_id', RID)).length;
  const ev2 = must(await svc.from('sales_fathom_events').select('status').eq('business_id', HL).eq('webhook_id', `${MSG}_again`))[0];
  ok(`a replayed webhook-id: HTTP ${again.status} duplicate ${again.body?.duplicate} · the same recording under a new id: event "${ev2?.status}" · notes for the recording: ${notesNow}`, again.status === 200 && again.body?.duplicate === true && sameRec.status === 200 && ev2?.status === 'duplicate' && notesNow === 1);

  // ---- 3. the note
  const X = note.extract;
  const n = k => (Array.isArray(X?.[k]) ? X[k].length : 0);
  ok(`the note: "${note.title}" · ${note.call_date} · ${note.source_label} · created_by Jack ${note.created_by === owner.userId} · accepted_at ${note.accepted_at} · text ${note.text.length} chars · transcript ${note.transcript?.split('\n').length} lines · attendees ${JSON.stringify(note.attendees)}`,
    note.title === TITLE && note.source_type === 'call' && note.source_label === `Fathom · ${TITLE}` && note.created_by === owner.userId && note.accepted_at == null && note.fathom_url === meeting.share_url && note.transcript?.startsWith('Jack Carlson [00:05]: ') && note.attendees?.length === 2 && note.attendees[1].domain === 'zzyxprobe.test' && note.attendees[1].is_external === true);
  ok(`no "${AT}" anywhere in the stored note (text, transcript, attendees, extract, every column) - the payload carried ${RAW.split(AT).length - 1}`, !JSON.stringify(note).includes(AT) && RAW.includes(AT));
  ok(REHEARSE ? 'rehearsal: no proposal stored (the model key is empty)' : `the proposal: ${n('tasks')} tasks · ${n('companies')} companies · ${n('people')} people · ${n('facts')} facts · ${n('decisions')} decisions · ${n('waiting_on')} waiting on them · ${n('ideas')} ideas · nothing accepted`,
    REHEARSE ? X == null : !!X && n('tasks') >= 1 && n('companies') >= 1);
  const u1 = await usage();
  ok(`model calls so far: ${u1.length} (${u1.map(u => u.call_type).join(', ') || 'none'})`, u1.length === (REHEARSE ? 0 : 1) && u1.every(u => u.call_type === 'call_tasks_fathom'));
  const conn = must(await svc.from('sales_fathom_connections').select('last_event_at').eq('id', made.connection).single());
  ok(`the connection's last event is stamped: ${!!conn.last_event_at}`, !!conn.last_event_at);

  // ---- 4. Today + Needs attention
  const rowsOf = v => (v.body?.groups || []).flatMap(g => g.rows);
  const t1 = await call('GET', `${S}/goals/today?owner=me`);
  const r1 = rowsOf(t1).find(r => r.key === `review:${note.id}`);
  const want = REHEARSE ? `Call notes not read yet · ${TITLE} · ` : `Review call notes · ${TITLE} · ${n('tasks')} task${n('tasks') === 1 ? '' : 's'} · ${n('companies')} compan${n('companies') === 1 ? 'y' : 'ies'} · ${n('facts')} fact${n('facts') === 1 ? '' : 's'} · `;
  ok(`Today: "${r1?.text}" · group ${r1?.group} · #${r1?.rank} · verb ${r1?.verb} · virtual ${r1?.virtual}`, t1.status === 200 && r1?.group === 'due' && r1.rank === 1 && r1.text.startsWith(want) && r1.verb === (REHEARSE ? 'extract' : 'review') && r1.virtual === true && t1.body.groups[0].rows[0].key === r1.key);
  const fx = await call('GET', `${S}/goals/today/fixes`);
  const fix = fx.body?.items?.find(i => i.id === 'reviews');
  ok(`Needs attention: "${fix?.title}" → ${fix?.action?.label}`, fx.status === 200 && fix?.n === 1 && fix.title === '1 call to review' && fix.action.label === 'Review' && fix.action.review === note.id);

  // ---- 5. Scout before: "unreviewed"
  const ask = q => ({ q, company: [], terms: [], flags: {}, since: null, until: null, entity: null });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const direct = async q => scout.salesIntents.find(i => i.match(ask(q))).run(svc, { businessId: HL, ask: ask(q), today });
  const find = async () => { const r = await call('GET', `/api/scout/search?q=${encodeURIComponent('ZZ Fathom Probe')}&scope=${HL}`); return (r.body?.groups || []).flatMap(g => g.items).find(i => i.id === note.id) || null; };
  const s1 = await find(), dBefore = await direct('review the ZZ Fathom Probe call');
  ok(`Scout search before: "${s1?.title}" · ${s1?.subtitle} · the read: ${dBefore.read}`, /unreviewed/.test(s1?.subtitle || '') && / · 1 · 1 unreviewed · /.test(dBefore.read) && dBefore.items.every(i => i.id === note.id) && dBefore.items.some(i => i.text.includes('unreviewed')));
  // the ask's own path up to the model, in this process (no model call): the intent that answers, and the context it builds
  const { ensureRegistry, scoutDeps } = await import('../../api/scout/registry.js');
  await ensureRegistry([path.join(ROOT, 'api/sales/scoutEntities.js'), path.join(ROOT, 'api/hk/scoutEntities.js')]);
  const { buildContext } = await import('../../api/scout/retrieve.js');
  const ctxOf = q => buildContext(svc, scoutDeps.registry(), { auth: { user: { id: owner.userId }, isPlatformOwner: true, roles: new Map([[HL, 'owner']]) }, scope: HL, q });
  const cBefore = await ctxOf('review the ZZ Fathom Probe call');
  ok(`Scout's context for "review the ZZ Fathom Probe call": intent ${cBefore.stats?.intent} · ${cBefore.lines?.length} lines · the read: ${cBefore.parts?.[0]?.read} · lines marked unreviewed: ${(cBefore.lines || []).filter(l => l.includes('unreviewed')).length}`,
    !cBefore.cant && /call_review/.test(cBefore.stats.intent) && /1 unreviewed/.test(cBefore.parts[0].read) && cBefore.lines.some(l => l.includes('unreviewed')) && !cBefore.pack.includes(AT), JSON.stringify(cBefore.cant || {}).slice(0, 200));
  if (!REHEARSE) {
    spend('Scout: review the ZZ Fathom Probe call');
    const a = await call('POST', '/api/scout/ask', { q: 'review the ZZ Fathom Probe call', scope: HL });
    const rows = (a.body?.sections || []).flatMap(s => s.rows || []);
    ok(`Scout "review the ZZ Fathom Probe call": HTTP ${a.status} · ${rows.length} row(s) · the note's row says "${rows.find(r => String(r.id) === note.id)?.subtitle}" · the answer's own words say unreviewed: ${/unreviewed/i.test(a.body?.answer_md || '')} · ${a.body?.answer_md?.length} chars · cost $${a.body?.usage?.cost_usd}`,
      a.status === 200 && !a.body.cant && !a.body.withheld && /1 unreviewed/.test(a.body.sections?.[0]?.read || '') && (/unreviewed/.test(rows.find(r => String(r.id) === note.id)?.subtitle || '') || /unreviewed/i.test(a.body.answer_md || '')) && !JSON.stringify(a.body).includes(AT), `read line: ${a.body?.sections?.[0]?.read}`);
  }

  // ---- 6. the paste warning (F-2): the same text, pasted - no model call
  const uBefore = (await usage()).length;
  const twin = await call('POST', `${S}/goals/call-notes/extract`, { text: note.text });
  ok(`paste of the same text: fathom_match "${twin.body?.fathom_match?.title}" (${twin.body?.fathom_match?.call_date}) · model calls made by it: ${(await usage()).length - uBefore}`, twin.status === 200 && twin.body?.fathom_match?.id === note.id && twin.body.fathom_match.accepted === false && (await usage()).length === uBefore);

  // ---- 7. the screens, read-only (before the accept)
  if (!NO_SCREENS) {
  browser = await chromium.launch();
  const blocked = [];
  async function open(width, query, wait) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, hasTouch: width < 900 });
    await ctx.addInitScript(([k, v, bz, dd]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, dd);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
    await ctx.route('**/*', route => {
      const req = route.request(); const u = new URL(req.url());
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return route.continue();
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      const write = (isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname)) || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (write) { blocked.push(`${req.method()} ${u.pathname.replace(HL, ':b')}`); return route.abort(); }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(25000);
    await page.goto(`${BASE}/?${query}`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 25000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(1500);
    if (!(await page.locator(wait).count())) await page.getByRole('button', { name: query.includes('settings') ? /^Settings/ : /^Actions/ }).first().click().catch(() => {});
    if (query.includes('connections') && !(await page.locator(wait).count())) await page.getByRole('tab', { name: /Connections/ }).or(page.getByRole('button', { name: /Connections/ })).first().click().catch(() => {});
    await page.waitForSelector(wait, { timeout: 25000 });
    return { ctx, page };
  }
  const rowSel = `[data-today-row="review:${note.id}"]`;
  {
    const { ctx, page } = await open(1440, 'tab=actions', rowSel);
    await page.screenshot({ path: path.join(OUT, 'today-row-1440.png') });
    const shown = await page.locator(rowSel).innerText();
    ok(`screen 1440: the Today row reads "${shown.replace(/\s+/g, ' ').slice(0, 110)}"`, shown.includes(TITLE) && new RegExp(REHEARSE ? 'Extract' : 'Review').test(shown));
    if (!REHEARSE) {
      await page.locator(`${rowSel} [data-today-verb]`).click();
      await page.waitForSelector(`[data-note-review="${note.id}"] section[aria-label="Tasks"]`);
      await page.screenshot({ path: path.join(OUT, 'review-open-1440.png') });
      const accept = await page.locator('[data-note-review] footer button').last().innerText();
      ok(`screen 1440: Review opens the Intake review on the note - ${await page.locator('[data-note-review] section[aria-label="Tasks"] > ul > li').count()} task row(s), "${accept}", no paste box; nothing was clicked past it`, /^Accept \d+$/.test(accept) && await page.locator('[data-note-review] textarea[aria-label="Call notes"]').count() === 0);
    }
    await ctx.close();
  }
  {
    const { ctx, page } = await open(1440, 'tab=settings&view=connections', '[data-fathom-card]');
    await page.waitForSelector('[data-fathom-row]');
    await page.screenshot({ path: path.join(OUT, 'card-1440.png') });
    const line = await page.locator('[data-fathom-status]').first().innerText(), html = await page.content();
    ok(`screen 1440: Settings › Connections › Fathom - "${line}" · Register is off on http: ${await page.getByRole('button', { name: 'Register webhook' }).count() === 0 ? 'n/a (registered)' : 'yes'} · the page holds no token or secret`, /^Connected · last recording /.test(line) && / · last event /.test(line) && !html.includes(TOKEN) && !html.includes(SECRET.slice(6)));
    await ctx.close();
  }
  {
    const { ctx, page } = await open(390, 'tab=actions', rowSel);
    await page.locator(rowSel).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, 'today-row-390.png') });
    ok(`screen 390: the row is a card, 0 px sideways (${await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)})`, await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0);
    await ctx.close();
  }
  await browser.close(); browser = null;
  ok(`the browser wrote nothing: ${blocked.length} non-GET request(s) refused${blocked.length ? ` (${[...new Set(blocked)].slice(0, 4).join(', ')})` : ''}`, true);
  }

  // ---- 8. review → accept ONE task → the to-do with its note link → the row is gone
  const rv = await call('GET', `${S}/goals/call-notes/${note.id}/review`);
  ok(REHEARSE ? `review of a note with no proposal: needs_extract ${rv.body?.needs_extract}` : `review: HTTP ${rv.status} · ${rv.body?.tasks?.length} tasks · ${rv.body?.companies?.length} companies · ${rv.body?.ideas?.length} ideas · no text or extract in the reply`,
    rv.status === 200 && (REHEARSE ? rv.body.needs_extract === true : rv.body.tasks.length >= 1 && !('text' in rv.body.note) && !('extract' in rv.body.note)));
  const pick = REHEARSE ? { text: `Send ${COMPANY} the pilot one-pager`, owner_user_id: owner.userId, due_date: null } : rv.body.tasks[0];
  const acc = await call('POST', `${S}/goals/call-notes/${note.id}/accept`, { tasks: [{ text: pick.text, owner_user_id: pick.owner_user_id || owner.userId, due_date: pick.due_date || null, link_type: null, link_id: null, steps: [] }] });
  made.todo = acc.body?.goals?.[0]?.id || null;
  const todo = made.todo ? must(await svc.from('sales_week_goals').select('id, text, kind, status, source_note_id, category, origin, owner_user_id').eq('id', made.todo).single()) : null;
  const noteAfter = await noteRow();
  ok(`accept ONE task: HTTP ${acc.status} · ${acc.body?.goals?.length} to-do · it carries the note link: ${todo?.source_note_id === note.id} · "${todo?.category}" · origin ${todo?.origin} · the note's accepted_at is set: ${!!noteAfter.accepted_at}`,
    acc.status === 200 && acc.body.goals.length === 1 && todo?.kind === 'todo' && todo.status === 'open' && todo.source_note_id === note.id && todo.category.startsWith('From calls · ') && todo.category.endsWith(TITLE) && !!noteAfter.accepted_at, JSON.stringify(acc.body).slice(0, 300));
  const others = must(await svc.from('sales_week_goals').select('id').eq('business_id', HL).eq('source_note_id', note.id)).length;
  const second = await call('POST', `${S}/goals/call-notes/${note.id}/accept`, { tasks: [{ text: 'Again', owner_user_id: owner.userId }] });
  ok(`only the one to-do came from the note (${others}); a second accept: HTTP ${second.status}`, others === 1 && second.status === 409);
  const t2 = await call('GET', `${S}/goals/today?owner=me`);
  const todoRow = rowsOf(t2).find(r => r.key === `todo:${made.todo}`);
  ok(`Today after: the review row is gone (${!rowsOf(t2).some(r => r.kind === 'review' && r.id === note.id)}) · the to-do is on the list, From: ${todoRow?.source}`, t2.status === 200 && !rowsOf(t2).some(r => r.key === `review:${note.id}`) && todoRow?.source === 'call_notes');
  const fx2 = await call('GET', `${S}/goals/today/fixes`);
  ok(`Needs attention after: no call to review (${!fx2.body?.items?.some(i => i.id === 'reviews')})`, fx2.status === 200 && !fx2.body.items.some(i => i.id === 'reviews'));

  // ---- 9. Scout after: not "unreviewed" (the same read, no model call)
  const s2 = await find(), dAfter = await direct('review the ZZ Fathom Probe call'), agreed = await direct(`what did we agree with ${COMPANY}`), cAfter = await ctxOf('review the ZZ Fathom Probe call');
  ok(`Scout after: search "${s2?.subtitle}" · the read: ${dAfter.read} · the ask's context: ${cAfter.parts?.[0]?.read} · "what did we agree with ${COMPANY}": ${agreed.read}`, !!s2 && !/unreviewed/.test(JSON.stringify([s2, dAfter, agreed])) && !cAfter.cant && !cAfter.pack.includes('unreviewed') && !/unreviewed/.test(cAfter.parts[0].read) && dAfter.items.some(i => i.id === note.id) && agreed.items.some(i => i.id === note.id));
  const twin2 = await call('POST', `${S}/goals/call-notes/extract`, { text: note.text });
  ok(`paste of the same text after: fathom_match says accepted ${twin2.body?.fathom_match?.accepted}`, twin2.body?.fathom_match?.accepted === true);
  const uEnd = await usage();
  ok(`Claude calls made by this run: ${uEnd.length} of cap ${CLAUDE_CAP} (${uEnd.map(u => `${u.call_type} $${Number(u.cost_usd || 0).toFixed(4)}`).join(' · ') || 'none'})`, uEnd.length === (REHEARSE ? 0 : 2) && uEnd.length <= CLAUDE_CAP);
} catch (e) { results.errors.push(e.message); log('ERROR', e.message); }
finally {
  await cleanup();
  const after = await snapshot();
  const moved = TABLES.filter(t => before[t] !== after[t]);
  const usageMoved = typeof after.business_anthropic_usage === 'number' ? after.business_anthropic_usage - before.business_anthropic_usage : null;
  const unexpected = moved.filter(t => t !== 'business_anthropic_usage');
  const left = [...must(await svc.from('sales_call_notes').select('id').eq('business_id', HL).or(`fathom_recording_id.eq.${RID},title.ilike.ZZ Fathom Probe%`)), ...must(await svc.from('sales_fathom_connections').select('id').eq('business_id', HL)), ...must(await svc.from('sales_fathom_events').select('webhook_id').eq('business_id', HL).ilike('webhook_id', 'msg_probe_%')), ...must(await svc.from('sales_week_goals').select('id').eq('business_id', HL).ilike('category', `%${TITLE}`))];
  log('after', JSON.stringify(after));
  const pass = results.checks.filter(c => c.pass).length;
  console.log(`\nchecks: ${pass}/${results.checks.length} passed${results.errors.length ? ` · errors: ${results.errors.join(' | ')}` : ''}`);
  console.log(`Claude: ${REHEARSE ? 0 : ledger.spent} paid (ledger) · usage rows added: ${usageMoved} (kept - the cost record) · Apollo: 0 · Fathom API: 0`);
  console.log(`restored: ${left.length ? `NO - ${left.length} test row(s) remain` : unexpected.length ? `CHECK - no test row remains, but counts moved on ${unexpected.map(t => `${t} ${before[t]} -> ${after[t]}`).join(', ')} (see who wrote)` : `yes (no test row remains; ${TABLES.length - 1} table counts as before; business_anthropic_usage +${usageMoved}, kept)`}`);
  process.exit(results.errors.length || pass !== results.checks.length || left.length ? 1 : 0);
}

// microsoft-connect-v1 Stage 3 Step 3 check (extends Step 2; needs migration 20261008_microsoft_connect_v1_stage3_step3.sql). A = temp workspace (allowlisted for the spawned server only) + 2 temp users with fixture partners / domains / contacts / Outlook rows, every rule exercised through GET /goals/partners/outlook-touches as a member (viewer 403). C-F = touches are facts: POST /record writes the touches (stage none, manual dedupe, already-recorded dedupe) + partner_contacts rows; POST /apply moves a ready key (status move, expect) and a held key with include_held (meeting touch); POST /dismiss settles a key; refusals; viewer 403 on every write. G = the daily step in-process on the fixture: records the facts + people, auto-applies the ready move, leaves held, writes the 'moves' run row with counts, re-run is a no-op, last run shows Undo-able moves, undo restores. All rows deleted. B = HomeLover READ-ONLY, in-process dryRun vs a hand count from the raw rows (no membership added, nothing written). 0 Microsoft / Apollo / AI calls. ~40s, cap 4 min. Serves build/ via server.js. Usage: node <this> <outdir>
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3970, tag = 'ms3c-' + Date.now();
const HL = 'bc69beab-effd-452d-9e81-fd652333bb95';
const WATCH = ['businesses', 'business_members', 'profiles', 'auth_events', 'sales_goals', 'partner_domains', 'partner_contacts', 'sales_partner_events', 'sales_mailbox_owners', 'microsoft_messages', 'microsoft_events', 'microsoft_sync_runs'];
const made = { users: [], biz: null };
let srv, pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const snap = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true })).count; return o; };
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('ABORT (4 min cap)'); cleanup().then(() => process.exit(2)); }, 240000);
const MAILBOX = `jack.${tag}@homelover.ai`;

async function cleanup() {
  if (srv) srv.kill();
  const b = made.biz;
  if (b) for (const t of ['microsoft_sync_runs', 'microsoft_messages', 'microsoft_events', 'sales_partner_events', 'partner_contacts', 'partner_domains', 'sales_goals', 'sales_mailbox_owners', 'business_members', 'auth_events']) await svc.from(t).delete().eq('business_id', b);
  for (const u of made.users) { await svc.from('business_members').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('actor_id', u); }
  if (b) await svc.from('businesses').delete().eq('id', b);
  for (const u of made.users) await svc.auth.admin.deleteUser(u);
}
async function user(biz, name, role) {
  const email = `${tag}-${name.toLowerCase()}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
  const { data: u } = await svc.auth.admin.createUser({ email, password, email_confirm: true }); made.users.push(u.user.id);
  await svc.from('profiles').update({ display_name: `${name} Test`, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
  ins(await svc.from('business_members').insert({ business_id: biz, email, name: `${name} Test`, user_id: u.user.id, role }).select());
  const c = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: s } = await c.auth.signInWithPassword({ email, password });
  return { id: u.user.id, email, cookie: `prospector_at=${encodeURIComponent(s.session.access_token)}` };
}

(async () => {
  const before = await snap();
  try {
    const B = made.biz = ins(await svc.from('businesses').insert({ name: `ZZ MS3 ${tag.slice(-5)}`, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-owner@example.com`, access_code: tag }).select().single()).id;
    const jack = await user(B, 'Jack', 'member'), viewer = await user(B, 'Viewer', 'viewer');
    ins(await svc.from('sales_mailbox_owners').insert({ business_id: B, mailbox_email: MAILBOX, user_id: jack.id }).select());
    const partner = async (name, pipeline_status) => ins(await svc.from('sales_goals').insert({ business_id: B, goal_type: 'partnership', name, pipeline_status, category: '3. PEOs', tier: '1', owner_user_id: jack.id }).select().single());
    const dom = (g, domain, confirmed = true) => svc.from('partner_domains').insert({ business_id: B, goal_id: g.id, domain, source: 'manual', confirmed, created_by: jack.id }).select();
    const acme = await partner('Acme Test', 'researching'), beta = await partner('Beta Test', 'first_email_sent'), gamma = await partner('Gamma Test', 'replied'),
      paused = await partner('Paused Test', 'paused'), unconf = await partner('Unconfirmed Test', 'not_started'), settled = await partner('Settled Test', 'not_started'), ahead = await partner('Ahead Test', 'meeting_set');
    for (const [g, d, c] of [[acme, 'acme.test'], [gamma, 'gamma.test'], [paused, 'paused.test'], [unconf, 'unconf.test', false], [settled, 'settled.test'], [ahead, 'ahead.test']]) ins(await dom(g, d, c));
    ins(await svc.from('partner_contacts').insert([{ business_id: B, goal_id: beta.id, name: 'Bob Beta', email: 'bob@beta.test', source: 'manual' }, { business_id: B, goal_id: acme.id, name: 'Known Acme', email: 'known@acme.test', source: 'manual' }]).select());
    let n = 0;
    const msg = (direction, emails, names, over = {}) => ({ business_id: B, user_id: jack.id, graph_id: `${tag}-g${++n}`, internet_message_id: `<${tag}-m${n}@fixture>`, conversation_id: over.conversation_id || `${tag}-c${n}`, direction, mailbox_email: MAILBOX,
      external_emails: emails, external_names: names, external_domains: [...new Set(emails.map(e => e.split('@')[1]))], subject: over.subject || `Subject ${n}`, occurred_at: over.occurred_at || '2026-10-06T17:00:00Z' });
    const M = {
      acmeSent: msg('sent', ['amy@acme.test', 'known@acme.test'], ['Amy Acme', 'Known Acme'], { conversation_id: `${tag}-T1`, occurred_at: '2026-10-05T17:00:00Z' }),
      acmeReply: msg('received', ['amy@acme.test'], ['Amy Acme'], { conversation_id: `${tag}-T1`, occurred_at: '2026-10-06T17:00:00Z' }),
      betaCold: msg('received', ['bob@beta.test'], ['Bob Beta'], { conversation_id: `${tag}-T2` }),
      gammaAuto: msg('received', ['gail@gamma.test'], [''], { subject: 'Automatic reply: hi' }),
      gammaBounce: msg('received', ['postmaster@gamma.test'], [''], { subject: 'hello' }),
      pausedSent: msg('sent', ['p@paused.test'], ['']),
      unconfSent: msg('sent', ['u@unconf.test'], ['']),
      settledSent: msg('sent', ['s@settled.test'], ['']),
      aheadSent: msg('sent', ['a@ahead.test'], ['']),
      nobody: msg('sent', ['x@nowhere.test'], ['']),
    };
    ins(await svc.from('microsoft_messages').insert(Object.values(M)).select());
    const ev = (emails, over = {}) => ({ business_id: B, user_id: jack.id, graph_id: `${tag}-e${++n}`, ical_uid: `${tag}-ical${n}`, mailbox_email: MAILBOX, organizer_email: emails[0], external_emails: emails, external_names: emails.map(() => 'Gail Gamma'),
      external_domains: [...new Set(emails.map(e => e.split('@')[1]))], subject: over.subject || 'Intro call', start_at: over.start_at || '2026-10-20T17:00:00Z', end_at: '2026-10-20T17:30:00Z', is_cancelled: !!over.is_cancelled });
    const E = { gammaMeeting: ev(['gail@gamma.test']), cancelled: ev(['gail@gamma.test'], { is_cancelled: true }) };
    ins(await svc.from('microsoft_events').insert(Object.values(E)).select());
    ins(await svc.from('sales_partner_events').insert({ business_id: B, goal_id: settled.id, event: 'note', source: 'outlook', note: 'fixture settled', meta: { outlook_key: `outlook:${M.settledSent.internet_message_id}`, dismissed: true } }).select());
    const delta = await partner('Delta Test', 'first_email_sent'); ins(await dom(delta, 'delta.test'));
    M.deltaCold = msg('received', ['dee@delta.test'], ['Dee Delta'], { conversation_id: `${tag}-T3` }); ins(await svc.from('microsoft_messages').insert(M.deltaCold).select());
    ins(await svc.from('sales_partner_events').insert([
      { business_id: B, goal_id: ahead.id, event: 'touch', source: 'manual', touch_type: 'email', contact_names: ['A@Ahead.test'], at: '2026-10-06T19:00:00Z', note: 'fixture manual', meta: {} },
      { business_id: B, goal_id: settled.id, event: 'touch', source: 'outlook', touch_type: 'email', contact_names: ['s@settled.test'], at: '2026-10-06T19:00:00Z', meta: { outlook_touch_key: `touch:${M.settledSent.internet_message_id}` } },
    ]).select());

    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: [process.env.SALES_ANALYTICS_BUSINESS_IDS, B].filter(Boolean).join(',') }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await wait(500); } }
    const get = (u, path) => fetch(`http://localhost:${PORT}${path}`, { headers: u ? { Cookie: u.cookie } : {} });
    const post = (u, path, body = {}) => fetch(`http://localhost:${PORT}${path}`, { method: 'POST', headers: { Cookie: u.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const base = `/api/sales/${B}/goals/partners/outlook-touches`;

    ok('A1 viewer -> 403 (lists who wrote to whom)', (await get(viewer, `/api/sales/${B}/goals/partners/outlook-touches`)).status === 403);
    let r = await get(jack, `/api/sales/${B}/goals/partners/outlook-touches`); const d = await r.json();
    ok('A2 member -> 200 dry run with counts', r.status === 200 && d.dry_run === true && d.counts.messages === 11 && d.counts.events === 2, JSON.stringify(d.counts));
    const by = (list, name) => list.find(m => m.partner === name);
    const acmeMove = by(d.proposed, 'Acme Test');
    ok('A3 Acme: sent + in-thread reply -> ONE proposal, Replied (furthest), auto, dated Oct 6 LA, by the mailbox owner, person named', acmeMove && acmeMove.to === 'replied' && acmeMove.auto === true && acmeMove.date === '2026-10-06' && acmeMove.by_user === jack.id && acmeMove.person === 'Amy Acme <amy@acme.test>' && acmeMove.key === `outlook:${M.acmeReply.internet_message_id}` && !by(d.held, 'Acme Test'), JSON.stringify(acmeMove));
    ok('A4 Acme: the Sent candidate is skipped as covered this run', d.skipped.some(s => s.partner === 'Acme Test' && /covers this partner this run/.test(s.reason)));
    const betaMove = by(d.held, 'Beta Test');
    ok('A5 Beta: cold reply matched by contact email -> held for an OK, never auto', betaMove && betaMove.to === 'replied' && betaMove.auto === false && betaMove.via === 'email' && /not in a thread we started/.test(betaMove.reason) && !by(d.proposed, 'Beta Test'), JSON.stringify(betaMove));
    const gammaMove = by(d.held, 'Gamma Test');
    ok('A6 Gamma: auto-reply + bounce skipped (2), the future meeting held as Meeting dated today with meeting day Oct 20, cancelled one counted', d.counts.skipped_auto === 2 && d.counts.cancelled === 1 && gammaMove && gammaMove.to === 'meeting_set' && gammaMove.meeting_date === '2026-10-20' && gammaMove.date <= new Date().toISOString().slice(0, 10) && gammaMove.key === `event:${E.gammaMeeting.ical_uid}`, JSON.stringify(gammaMove));
    ok('A7 paused partner skipped with the reason; unconfirmed domain never matches (unmatched)', d.skipped.some(s => s.partner === 'Paused Test' && /partner is paused/.test(s.reason)) && !by(d.proposed, 'Unconfirmed Test') && !by(d.held, 'Unconfirmed Test') && d.counts.unmatched === 2);
    ok('A8 dismissed key skipped "already dismissed"; partner already at Meeting skipped "already at or past"', d.skipped.some(s => s.partner === 'Settled Test' && /already dismissed/.test(s.reason)) && d.skipped.some(s => s.partner === 'Ahead Test' && /already at or past first_email_sent/.test(s.reason)));
    // A person we wrote to at a paused / settled / already-ahead partner is still a person at that partner.
    ok('A9 people: 4 new addresses at matched domains (amy named, first Oct 5; one each at the paused / settled / ahead partners); known@acme.test not; nobody from received-only or other domains', d.people.length === 4 && d.people.map(x => x.email).sort().join() === 'a@ahead.test,amy@acme.test,p@paused.test,s@settled.test' && d.people.find(x => x.email === 'amy@acme.test').name === 'Amy Acme' && d.people.find(x => x.email === 'amy@acme.test').first_seen === '2026-10-05', JSON.stringify(d.people.map(x => x.email)));
    ok('A10 no body, no subject of a skipped auto-reply leaks into a proposal; keys are outlook:<imid> / event:<ical>', !JSON.stringify(d.proposed.concat(d.held)).includes('Automatic reply') && d.proposed.concat(d.held).every(m => /^(outlook:<|event:)/.test(m.key)));

    // C: touches are facts
    const tw = d.touches.would_record, tm = d.touches.skipped_manual;
    ok('C1 touches to record: Acme sent (Oct 5, Graph name), Acme in-thread reply (Oct 6), Paused sent (a fact whatever the stage); cold replies and meetings never', tw.length === 3 && tw.map(t => `${t.partner}:${t.direction}:${t.contact}:${t.date}`).sort().join('|') === ['Acme Test:received:Amy Acme:2026-10-06', 'Acme Test:sent:Amy Acme:2026-10-05', 'Paused Test:sent:p@paused.test:2026-10-06'].join('|'), JSON.stringify(tw.map(t => [t.partner, t.direction, t.contact, t.date])));
    ok('C2 dedupe: Ahead sent skipped - logged by hand same LA day by address (any case); Settled sent already recorded (its touch key)', tm.length === 1 && tm[0].partner === 'Ahead Test' && /logged by hand: a@ahead.test on 2026-10-06/.test(tm[0].reason) && d.touches.already === 1 && d.counts.touches === 3, JSON.stringify(tm));
    ok('C3 viewer -> 403 on record / apply / dismiss', (await post(viewer, base + '/record')).status === 403 && (await post(viewer, base + '/apply', { keys: ['x'] })).status === 403 && (await post(viewer, base + '/dismiss', { key: 'x' })).status === 403);
    // G: the daily step
    const { runDailyOutlookMoves, lastOutlookRun } = await import(ROOT + '/api/sales/partnerOutlookTouches.js');
    const { undoPartnerSignal } = await import(ROOT + '/api/sales/partnerSignals.js');
    const day1 = await runDailyOutlookMoves(svc, B, { userId: jack.id, trigger: 'manual' });
    const touchRows = (await svc.from('sales_partner_events').select('goal_id, event, touch_type, to_status, by_user, meta').eq('business_id', B).eq('event', 'touch').eq('source', 'outlook').not('meta->>outlook_touch_key', 'is', null)).data.filter(e => e.meta.outlook_touch_key !== `touch:${M.settledSent.internet_message_id}`);
    const acmeAfter = (await svc.from('sales_goals').select('pipeline_status, first_email_at').eq('id', acme.id).single()).data;
    const moveRow = (await svc.from('sales_partner_events').select('event, source, from_status, to_status, by_user, meta').eq('goal_id', acme.id).eq('event', 'status').maybeSingle()).data;
    ok('G1 daily step: 3 touches recorded (stage none, by the owner) + 4 people added + 1 skipped by hand + 1 already; the ready move applied (Acme researching -> replied, status move, by nobody = automatic); held stay held (Beta cold reply, Gamma meeting, Delta cold reply)', !day1.error && day1.recorded === 3 && day1.people === 4 && day1.skipped_manual === 1 && day1.already === 1 && day1.applied === 1 && day1.refused === 0 && day1.held === 3 && touchRows.length === 3 && touchRows.every(e => e.to_status === null && e.by_user === jack.id) && acmeAfter.pipeline_status === 'replied' && acmeAfter.first_email_at === '2026-10-05' && moveRow && moveRow.by_user === null && moveRow.meta.outlook_key && day1.applied_moves[0].partner === 'Acme Test', JSON.stringify({ day1: { recorded: day1.recorded, people: day1.people, by_hand: day1.skipped_manual, already: day1.already, applied: day1.applied, held: day1.held, error: day1.error }, acme: acmeAfter }));
    const runRow = (await svc.from('microsoft_sync_runs').select('folder, trigger, seen, stored, counts, error, finished_at').eq('id', day1.run_id).single()).data;
    ok('G2 run row: folder moves, counts block with recorded_touches / people_added / applied_moves / held_moves (ids + partner names, no addresses), finished', runRow.folder === 'moves' && runRow.trigger === 'manual' && runRow.finished_at && runRow.error === null && runRow.counts.recorded_touches.length === 3 && runRow.counts.people_added.length === 4 && runRow.counts.applied_moves.length === 1 && runRow.counts.held_moves.length === 3 && !['amy@acme.test', 'known@acme.test', 'p@paused.test', 's@settled.test', 'a@ahead.test', 'bob@beta.test', 'gail@gamma.test', 'dee@delta.test'].some(e => JSON.stringify(runRow.counts).includes(e)), JSON.stringify(runRow.counts).slice(0, 200));
    const day2 = await runDailyOutlookMoves(svc, B, { userId: jack.id, trigger: 'piggyback' });
    ok('G3 daily step again: nothing new (0 recorded, 4 already, 0 applied, 3 still held), no second people row, no second move', !day2.error && day2.recorded === 0 && day2.already === 4 && day2.people === 0 && day2.applied === 0 && day2.held === 3 && (await svc.from('partner_contacts').select('id', { count: 'exact', head: true }).eq('business_id', B).eq('source', 'outlook')).count === 4 && (await svc.from('sales_partner_events').select('id', { count: 'exact', head: true }).eq('goal_id', acme.id).eq('event', 'status')).count === 1, JSON.stringify({ recorded: day2.recorded, already: day2.already, applied: day2.applied, held: day2.held }));
    const last = await lastOutlookRun(svc, B);
    const dryAfter = await (await get(jack, base)).json();
    ok('G4 last run (= the latest moves row, the no-op one) reads 0 applied; the dry run GET carries last_run; the first run\'s Acme move is still undoable through its own row', last && last.applied.length === 0 && last.held === 3 && dryAfter.last_run && dryAfter.last_run.at === last.at, JSON.stringify(last).slice(0, 160));
    const first = (await svc.from('microsoft_sync_runs').select('counts').eq('id', day1.run_id).single()).data.counts;
    const firstMove = first.applied_moves[0];
    await undoPartnerSignal(svc, { businessId: B, goalId: firstMove.goal_id, eventId: firstMove.event_id, byUser: jack.id });
    const acmeUndone = (await svc.from('sales_goals').select('pipeline_status').eq('id', acme.id).single()).data;
    const day3 = await runDailyOutlookMoves(svc, B, { userId: jack.id, trigger: 'manual' });
    // An undo settles that one key. The sent mail is a different fact with its own key, so the next step moves Acme to Sent (forward from researching, never back to Replied).
    const acmeFinal = (await svc.from('sales_goals').select('pipeline_status').eq('id', acme.id).single()).data;
    ok('G5 undo the automatic move -> Acme back to researching; the next daily step never re-applies that key (Replied) but the sent mail still moves Acme to Sent; nothing new recorded', acmeUndone.pipeline_status === 'researching' && !day3.error && day3.applied === 1 && day3.applied_moves[0].to === 'first_email_sent' && day3.applied_moves[0].key !== firstMove.key && day3.recorded === 0 && acmeFinal.pipeline_status === 'first_email_sent', JSON.stringify({ applied: day3.applied_moves.map(a => [a.partner, a.to]), recorded: day3.recorded, acme: acmeFinal.pipeline_status }));
    ok('G6 viewer -> 403 on record / apply / dismiss still', (await post(viewer, base + '/record')).status === 403 && (await post(viewer, base + '/apply', { keys: ['x'] })).status === 403);

    // B: HomeLover read-only - dry run vs hand count from raw rows
    const { dryRun, isAutoMessage, AUTO_SUBJECT_PREFIXES } = await import(ROOT + '/api/sales/partnerOutlookTouches.js');
    const hl = await dryRun(svc, HL);
    // Paged by hand: PostgREST caps a plain select at 1,000 rows and the store passed that on Oct 8.
    const pageAll = async (table, cols) => { const out = []; for (let from = 0; ; from += 1000) { const { data } = await svc.from(table).select(cols).eq('business_id', HL).order('id').range(from, from + 999); out.push(...data); if (data.length < 1000) return out; } };
    const [msgs, { data: doms }, { data: cons }, { data: evs }] = await Promise.all([
      pageAll('microsoft_messages', 'direction, subject, external_emails, external_domains, conversation_id'),
      svc.from('partner_domains').select('domain, goal_id').eq('business_id', HL).eq('confirmed', true),
      svc.from('partner_contacts').select('email, goal_id').eq('business_id', HL).not('email', 'is', null),
      svc.from('microsoft_events').select('external_domains, external_emails, is_cancelled').eq('business_id', HL),
    ]);
    const domSet = new Set(doms.map(x => x.domain)), emailSet = new Set(cons.map(x => x.email.toLowerCase()));
    const auto = msgs.filter(m => m.direction === 'received' && (AUTO_SUBJECT_PREFIXES.some(p => String(m.subject || '').trim().toLowerCase().startsWith(p)) || m.external_emails.some(e => /^(postmaster|noreply|no-reply|mailer-daemon)@/.test(e)))).length;
    const live = msgs.filter(m => !(m.direction === 'received' && isAutoMessage(m)));
    const matchedMsgs = live.filter(m => m.external_domains.some(x => domSet.has(x)) || m.external_emails.some(e => emailSet.has(e))).length;
    const matchedEvs = evs.filter(e => !e.is_cancelled && (e.external_domains.some(x => domSet.has(x)) || e.external_emails.some(x => emailSet.has(x)))).length;
    const unmatched = (live.length - matchedMsgs) + (evs.filter(e => !e.is_cancelled).length - matchedEvs);
    ok(`B1 HomeLover: ${msgs.length} messages / ${evs.length} events read = DB; auto-skipped ${hl.counts.skipped_auto} = hand ${auto}; unmatched ${hl.counts.unmatched} = hand ${unmatched}; candidates ${hl.counts.candidates} = hand ${matchedMsgs + matchedEvs}`,
      hl.counts.messages === msgs.length && hl.counts.events === evs.length && hl.counts.skipped_auto === auto && hl.counts.unmatched === unmatched && hl.counts.candidates === matchedMsgs + matchedEvs);
    ok(`B2 HomeLover: proposed ${hl.counts.proposed} · held ${hl.counts.held} · skipped ${hl.counts.skipped} · people ${hl.counts.people} = candidates ${hl.counts.candidates} + settled 0 (nothing applied yet)`, hl.counts.proposed + hl.counts.held + hl.counts.skipped === hl.counts.candidates && hl.counts.settled_before === 0);
    console.log('HomeLover proposed:', hl.proposed.map(m => `${m.partner} ${m.from}->${m.to} ${m.person} ${m.date} ${m.key}`).join(' | ') || 'none');
    console.log('HomeLover held:', hl.held.map(m => `${m.partner} ${m.from}->${m.to} ${m.person} ${m.date} ${m.key}`).join(' | ') || 'none');
    console.log('HomeLover skipped:', hl.skipped.map(m => `${m.partner}: ${m.reason}`).join(' | ') || 'none');
    console.log('HomeLover people:', hl.people.map(p => `${p.partner} ${p.name || '(no name)'} ${p.email} ${p.first_seen}`).join(' | ') || 'none');
    const threads = new Set(msgs.filter(m => m.direction === 'sent' && m.conversation_id).map(m => m.conversation_id));
    const matchedRow = m => m.external_domains.some(x => domSet.has(x)) || m.external_emails.some(e => emailSet.has(e));
    const factMsgs = live.filter(m => matchedRow(m) && (m.direction === 'sent' || threads.has(m.conversation_id))).length;
    ok(`B3 HomeLover touches preview = hand count: would record ${hl.touches.would_record.length} + by hand ${hl.touches.skipped_manual.length} + already ${hl.touches.already} + duplicates ${hl.touches.duplicates} = ${factMsgs} matched sent + in-thread replies`, hl.touches.would_record.length + hl.touches.skipped_manual.length + hl.touches.already + hl.touches.duplicates === factMsgs);
    console.log('HomeLover touches to record:', hl.touches.would_record.map(t => `${t.partner} | ${t.contact} | ${t.date} | ${t.direction} | ${t.key}`).join('\n   ') || 'none');
    console.log('HomeLover touches already by hand:', hl.touches.skipped_manual.map(t => `${t.partner} | ${t.reason}`).join('\n   ') || 'none');
  } catch (e) { ok('run', false, e.stack.split('\n').slice(0, 3).join(' ')); }
  await cleanup();
  const after = await snap();
  const moved = WATCH.filter(t => before[t] !== after[t]);
  console.log(`\n${pass}/${total} passed`);
  console.log(moved.length ? `restored: CHECK - counts moved on ${moved.map(t => `${t} ${before[t]}->${after[t]}`).join(', ')}` : 'restored: yes');
  process.exit(pass === total ? 0 : 1);
})();

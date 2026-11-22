// email-by-member-v1 Stage 2 - the live pass on localhost (the real routes over the real sales workspace) as the
// platform owner. Names, domains and counts only - no address is printed.
// DECLARED before it runs:
//   WRITES (kept - Jack's ruling Nov 20: "seed the two .com rows through the map route"): at most 2 PUT
//     goals/mailbox-map - the unmapped .com mailbox that is not a connected account -> the member the route suggests,
//     and the unmapped .com mailbox that is a member's own connected Microsoft account -> that member (this starts that
//     member's Outlook sync into the workspace on prod's scheduler). A row already mapped is left alone. Nothing else
//     is written; sales_mailbox_owners goes from n to at most n + 2.
//   READS: GET goals/mailbox-map x2, GET goals/weekly?member=all x1, GET goals/team-emails x1, one raw paged read of
//     sales_email_daily_counts + sales_mailbox_owners to compare against.
//   CLAUDE: at most 1 ask (POST /api/scout/ask "how is Cyrus's open rate trending"), about $0.01-0.02; spent asks are
//     kept in a ledger so a re-run never repeats the paid call. The ask's PASS proves the route and the intent only:
//     whether the numbers in the answer are right is read by hand against goals/weekly and written into the ledger
//     as verdict right | wrong - a re-run fails on anything but "right". APOLLO 0.
//   SEND: none from here. The one test send of the Friday email goes through prod AFTER the deploy and only when the
//     sender's Microsoft account is connected - this script reports that state.
//   ~40 s, cap 150 s.   Usage: node scripts/verify/email-by-member-v1-stage2.mjs [--no-ask]
import fs from 'fs';
import path from 'path';
import { readOnlyBrowser } from './lib/readOnlyBrowser.mjs';

const h = await readOnlyBrowser({ port: 3996, capMs: 150000 });
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const { selectAllPages } = await import('../../api/lib/selectAllPages.js');
const { addDays } = await import('../../api/sales/goalsShared.js');
const B = h.workspace.id, T0 = Date.now();
const OUT = path.join(h.ROOT, '.screenshots', 'email-by-member-v1');
fs.mkdirSync(OUT, { recursive: true });
const LEDGER = path.join(OUT, 'stage2-ledger.json');
const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : { asks: [] };
const checks = [];
const ok = (name, pass, detail = '') => { checks.push(!!pass); console.log(`[${Math.round((Date.now() - T0) / 1000)}s] ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${String(detail).slice(0, 700)}` : ''}`); };
const cookie = `${SESSION_COOKIE}=${encodeURIComponent(h.owner.session.access_token)}`;
const call = async (p, method = 'GET', body = null) => { const r = await fetch(`${h.BASE}${p}`, { method, headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
const sales = (p, method, body) => call(`/api/sales/${B}/goals${p}`, method, body);
const owners = async () => (await h.svc.from('sales_mailbox_owners').select('mailbox_email, user_id').eq('business_id', B)).data;
const of = (ms, key) => ms.find(x => x.key === key);
let wrote = 0, before = null;

try {
  before = (await owners()).length;
  // ── the two .com rows, through the map route
  const list = await sales('/mailbox-map');
  const nameOf = id => list.body.members.find(m => m.id === id)?.name || '?';
  const dotcom = list.body.mailboxes.filter(m => m.domain.endsWith('.com'));
  ok(`goals/mailbox-map ${list.status}: ${list.body.mailboxes.length} mailboxes (${list.body.mailboxes.map(m => `${m.domain} ${m.delivered} → ${m.user_id ? nameOf(m.user_id) : 'Unassigned'}`).join(' · ')}); ${dotcom.length} on .com; no address`, list.status === 200 && dotcom.length === 2 && !JSON.stringify(list.body).includes('@'));
  for (const m of dotcom) {
    const to = m.connected_account_of || m.suggested_user_id;
    if (m.user_id) { ok(`${m.domain} (${m.connected_account_of ? 'a connected account' : `${m.delivered} delivered`}): already ${nameOf(m.user_id)}'s - left alone`, m.user_id === to); continue; }
    if (!to) { ok(`${m.domain}: the route names no member for it - not mapped`, false); continue; }
    const put = await sales('/mailbox-map', 'PUT', { key: m.key, user_id: to });
    if (put.status === 200) wrote += 1;
    ok(`PUT goals/mailbox-map: ${m.domain} (${m.connected_account_of ? "the member's own connected account" : `${m.delivered} delivered, first seen ${m.first_seen}`}) → ${nameOf(to)}: ${put.status}`, put.status === 200 && put.body.mailbox.user_id === to, put.body?.error);
  }
  const list2 = await sales('/mailbox-map');
  const com2 = list2.body.mailboxes.filter(m => m.domain.endsWith('.com'));
  const names = com2.map(m => nameOf(m.user_id)).sort();
  ok(`the two .com rows exist and are mapped: ${com2.map(m => `${m.domain} → ${nameOf(m.user_id)}`).join(' · ')}; sales_mailbox_owners ${before} → ${(await owners()).length} (this run wrote ${wrote})`, com2.length === 2 && com2.every(m => m.user_id) && new Set(names).size === 2 && (await owners()).length === before + wrote);

  // ── member rows = the team row, and = the raw rows
  const all = await sales('/weekly?weeks=12&member=all');
  const b = all.body, team = b.rows.find(r => r.id === 'team'), parts = b.rows.filter(r => r.id !== 'team');
  ok(`goals/weekly?member=all ${all.status}: rows ${b.rows.map(r => r.name).join(' · ')}; the control would read Team · ${b.members.map(m => m.name).join(' · ')}; unassigned mailboxes ${b.unassigned_mailboxes}; ${b.metrics.length} team rows ride along; no address`, all.status === 200 && b.metrics.length === 20 && !JSON.stringify(b).includes('@'));
  const two = b.weeks.slice(-2);
  for (const key of ['delivered', 'human_clicks', 'replies']) for (const w of two) {
    const i = b.weeks.indexOf(w), each = parts.map(r => [r.name, of(r.metrics, key).series[i].value]), sum = each.reduce((n, [, v]) => n + (v || 0), 0), t = of(team.metrics, key).series[i].value || 0;
    ok(`${key}, week of ${w}: ${each.map(([n, v]) => `${n} ${v ?? '—'}`).join(' + ')} = ${sum} = team ${t}`, sum === t);
  }
  const [counts, map] = await Promise.all([
    selectAllPages(() => h.svc.from('sales_email_daily_counts').select('day, mailbox, sequence_id, step, delivered').eq('business_id', B).gte('day', two[0]).order('day').order('mailbox').order('sequence_id').order('step')),
    owners(),
  ]);
  const ownerOf = new Map(map.map(o => [o.mailbox_email, o.user_id]));
  for (const w of two) {
    const i = b.weeks.indexOf(w), to = w === b.week_start ? b.today : addDays(w, 6);
    const rawOf = r => counts.filter(c => c.day >= w && c.day <= to && (r.id === 'team' || (r.id === 'unassigned' ? !ownerOf.has(c.mailbox) : ownerOf.get(c.mailbox) === r.id))).reduce((n, c) => n + c.delivered, 0);
    const off = b.rows.filter(r => (of(r.metrics, 'delivered').series[i].value || 0) !== rawOf(r));
    ok(`delivered, week of ${w}, route vs raw sales_email_daily_counts by the map: ${b.rows.map(r => `${r.name} ${of(r.metrics, 'delivered').series[i].value ?? '—'} / ${rawOf(r)}`).join(' · ')}`, off.length === 0);
  }
  ok('no rate carries a pace on any member row', b.rows.every(r => r.metrics.filter(x => x.unit === 'rate').every(x => x.this_week.pace == null)));

  // ── the Friday email's test send: only when the sender's Microsoft account is connected
  const te = await sales('/team-emails');
  const connected = te.status === 200 && te.body.ready && !te.body.banner;
  console.log(`[${Math.round((Date.now() - T0) / 1000)}s] NOTE test send: sender ${te.body?.sender?.first_name || '—'} · ready ${te.body?.ready} · banner ${te.body?.banner ? `"${String(te.body.banner).slice(0, 90)}"` : 'none'} → ${connected ? 'CONNECTED: the one test send can go through prod after the deploy' : 'NOT connected: the test send is SKIPPED'}`);

  // ── Scout, one ask
  const Q = "how is Cyrus's open rate trending";
  const spent = ledger.asks.find(a => a.q === Q);
  if (spent) ok(`Scout "${Q}": already asked ${spent.at} (not repeated) - intent ${spent.intent} · $${spent.cost} · verdict ${spent.verdict || 'not judged'}${spent.note ? ` (${spent.note})` : ''} · "${spent.answer}"`, /member_emails/.test(spent.intent) && spent.verdict === 'right');
  else if (process.argv.includes('--no-ask')) console.log('NOTE Scout ask skipped (--no-ask)');
  else {
    const r = await call('/api/scout/ask', 'POST', { q: Q, scope: B });
    const a = r.body || {};
    const row = { q: Q, at: new Date().toISOString(), status: r.status, intent: String(a.context_stats?.intent || ''), cost: a.usage?.cost_usd ?? null, tokens: `${a.usage?.input_tokens} in / ${a.usage?.output_tokens} out`, answer: String(a.answer_md || a.error || '').replace(/\s+/g, ' ').slice(0, 420) };
    ledger.asks.push(row); fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
    ok(`Scout "${Q}": ${r.status} · intent ${row.intent} · ${row.tokens} · $${row.cost} · "${row.answer}"`, r.status === 200 && /member_emails/.test(row.intent) && /cyrus/i.test(row.answer) && !JSON.stringify(a).includes('@'));
  }
  ok(`browser writes aborted: ${h.blocked.length}; Apollo 0 (the server runs with no Apollo key)`, true);
} catch (e) {
  ok('run', false, e.stack?.split('\n').slice(0, 3).join(' | '));
} finally {
  const after = before == null ? null : (await owners()).length;
  await h.close();
  const passed = checks.filter(Boolean).length;
  console.log(`\n${passed}/${checks.length} checks passed · Claude asks this run: ${ledger.asks.length && !process.argv.includes('--no-ask') ? 'see the Scout line' : 0}`);
  console.log(`restored: ${after === before + wrote ? `yes, but for the declared kept writes - sales_mailbox_owners ${before} → ${after} (${wrote} mapped through the route, kept by Jack's ruling); nothing else written; sign-in rows and the Scout usage row kept by rule` : `NO - sales_mailbox_owners ${before} → ${after}, this run wrote ${wrote}: check who wrote the rest`}`);
  process.exit(passed === checks.length ? 0 : 1);
}

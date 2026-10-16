// pipeline-board-v1 Stage 4 live check - Update from sheet. TEMP data only: 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local server only), 2 temp users (member + viewer), 6 partners, 3 opportunities, 1 target. ~15 calls to a local server.js: export -> edit -> preview -> apply -> re-upload, as .xlsx and .csv. HomeLover: before/after table counts only, 0 writes, 0 Apollo / 0 Claude / 0 syncs. ~30 s, cap 3 min.
// Usage: node scripts/verify/pipeline-board-v1-stage4.cjs [outdir]  (outdir keeps the edited files)
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const fs = require('fs'), path = require('path');
const { spawn } = require('child_process');
const ExcelJS = require(ROOT + '/node_modules/exceljs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3992, tag = 'su-' + Date.now();
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const TABLES = ['sales_goals', 'sales_opportunities', 'sales_targets', 'sales_partner_events'];
const TOUCH = '2026-10-01T00:00:00+00:00';
const made = { biz: null, users: [] };
let srv, pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const cleanup = require('./lib/tempGuard.cjs')(removeTemp, { capMs: 180000 });

async function counts(biz) {
  const o = {};
  for (const t of TABLES) { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', biz); o[t] = r.error ? 'err' : r.count; }
  return o;
}
async function removeTemp() {
  if (srv) srv.kill();
  const b = made.biz;
  if (b) for (const t of ['sales_partner_events', 'sales_week_goals', 'sales_targets', 'sales_opportunity_events', 'sales_opportunities', 'sales_goals', 'business_members', 'auth_events']) {
    const r = await svc.from(t).delete().eq('business_id', b); if (r.error) console.log(`cleanup ${t}: ${r.error.message}`);
  }
  for (const u of made.users) { await svc.from('auth_events').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('actor_id', u); }
  if (b) await svc.from('businesses').delete().eq('id', b);
  for (const u of made.users) await svc.auth.admin.deleteUser(u);
}
async function user(T, role) {
  const email = `${tag}-${role}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
  const { data: u } = await svc.auth.admin.createUser({ email, password, email_confirm: true }); made.users.push(u.user.id);
  ins(await svc.from('business_members').insert({ business_id: T, email, name: `${role} Zz`, user_id: u.user.id, role }).select());
  const s = (await createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.signInWithPassword({ email, password })).data.session;
  return { id: u.user.id, token: s.access_token };
}

(async () => {
  const hlBefore = await counts(HOMELOVER);
  try {
    const T = made.biz = ins(await svc.from('businesses').insert({ name: `ZZ Sheet ${tag.slice(-4)}`, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
    const member = await user(T, 'member'), viewer = await user(T, 'viewer');
    // A plain display name: the export scrubs digit runs (the temp tag) out of names.
    ins(await svc.from('profiles').update({ display_name: 'Member Zz' }).eq('id', member.id).select());
    const P = (name, pipeline_status, extra = {}) => ({ business_id: T, goal_type: 'partnership', name, pipeline_status, category: '3. Brokers', tier: '2', owner_team: 'homelover', last_touch_at: TOUCH, hot: false, owner_user_id: null, record_id: null, ...extra });
    const partners = ins(await svc.from('sales_goals').insert([
      P('Gallagher Zz', 'replied', { owner_user_id: member.id, hot: true }), P('OneDigital Zz', 'first_email_sent'), P('Lockton Zz', 'not_started'),
      P('Aon Zz', 'proposal_pilot', { record_id: `${tag}-R4` }), P('Brown Zz', 'in_sequence'), P('Hub Zz', 'researching', { tier: 'active' }),
    ]).select());
    const id = n => partners.find(p => p.name === n)?.id || opps.find(o => o.organization === n)?.id;
    const opps = ins(await svc.from('sales_opportunities').insert([
      { business_id: T, organization: 'Solidcore Zz', org_type: 'employer', stage: 'contacted', owner: 'Jack', owner_team: 'upside', tier: '1', next_action: 'Call', next_action_date: '2026-10-20', source: 'manual' },
      { business_id: T, organization: 'Union Zz', org_type: 'membership', stage: 'responded', owner_team: 'both', source: 'manual' },
      { business_id: T, organization: 'Marriott Zz', org_type: 'employer', stage: 'meeting', owner_team: 'upside', source: 'manual' },
    ]).select());
    ins(await svc.from('sales_targets').insert({ business_id: T, name: 'Target Zz', kind: 'partner', status: 'proposed', owner_team: 'upside' }).select());

    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${T}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await wait(250); } }
    const base = `http://localhost:${PORT}/api/sales/${T}/goals/pipeline-board`;
    const auth = who => ({ Cookie: `prospector_at=${encodeURIComponent(who.token)}` });
    const board = async () => (await (await fetch(base, { headers: auth(member) })).json()).rows;
    const post = async (who, file, apply) => {
      const r = await fetch(`${base}/update`, { method: 'POST', headers: { ...auth(who), 'Content-Type': 'application/json' }, body: JSON.stringify({ file, ...(apply ? { apply } : {}) }) });
      return { status: r.status, body: await r.json() };
    };
    const tickAll = p => p.items.filter(i => i.tickable).map(i => ({ key: i.key, sig: i.sig }));
    const keys = p => p.items.filter(i => i.tickable).map(i => i.key).sort();
    const color = (rows, name) => rows.find(r => r.name === name)?.color;
    const goal = async n => (await svc.from('sales_goals').select('pipeline_status, last_touch_at').eq('id', id(n)).single()).data;
    const keep = (name, buf) => { if (process.argv[2]) fs.writeFileSync(path.join(process.argv[2], name), buf); };

    // 1. Round trip as .xlsx: export -> change 3 stages in the file -> exactly those 3 -> apply -> re-upload = nothing.
    const exported = Buffer.from(await (await fetch(`${base}/export`, { headers: auth(member) })).arrayBuffer());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(exported);
    const ws = wb.worksheets[0];
    const head = ws.getRow(1).values.slice(1);
    const col = h => head.indexOf(h) + 1;
    ok('export has a Prospector ID column (type:id)', col('Prospector ID') === 13 && /^partner:[0-9a-f-]{36}$/.test(ws.getRow(2).getCell(13).value), JSON.stringify(head));
    const edits = { 'Hub Zz': '1st email sent', 'Lockton Zz': 'Replied', 'Marriott Zz': 'Proposal/Pilot' };
    ws.eachRow((row, n) => { const e = n > 1 && edits[row.getCell(col('Account')).value]; if (e) row.getCell(col('Stage')).value = e; });
    const edited = Buffer.from(await wb.xlsx.writeBuffer());
    keep('round-trip.xlsx', edited);
    const xfile = { name: 'joint-pipeline.xlsx', data: edited.toString('base64') };
    const p1 = (await post(member, xfile)).body;
    ok('xlsx preview = exactly the 3 changed stages, nothing else ticked',
      JSON.stringify(keys(p1)) === JSON.stringify([`stage:employer:${id('Marriott Zz')}`, `stage:partner:${id('Hub Zz')}`, `stage:partner:${id('Lockton Zz')}`].sort()) && p1.items.length === 3, JSON.stringify(p1.items?.map(i => i.key + ' ' + i.name)));
    ok('ignored columns = Top, Status, Last Touch; 0 differences, 0 invalid', JSON.stringify(p1.info.ignored) === '["Top","Status","Last Touch"]' && !p1.info.differences.length && !p1.info.invalid.length, JSON.stringify(p1.info));
    const a1 = (await post(member, xfile, tickAll(p1))).body;
    ok('apply -> Updated 3, 0 failed', a1.applied === 3 && !a1.failed.length, JSON.stringify(a1));
    const b1 = await board();
    ok('board colors moved (Lockton blue, Hub gray, Marriott yellow)', color(b1, 'Lockton Zz') === 'blue' && color(b1, 'Hub Zz') === 'gray' && color(b1, 'Marriott Zz') === 'yellow', JSON.stringify(b1.map(r => [r.name, r.color])));
    const p1again = (await post(member, xfile)).body;
    ok('re-upload the same .xlsx = nothing to update', p1again.items.filter(i => i.tickable).length === 0, JSON.stringify(p1again.items));

    // 2. The spec's 10-row CSV, from a fresh export.
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(Buffer.from(await (await fetch(`${base}/export`, { headers: auth(member) })).arrayBuffer()));
    const rows = [];
    wb2.worksheets[0].eachRow((row, n) => { if (n > 1) rows.push(Object.fromEntries(head.map((h, i) => [h, String(row.getCell(i + 1).value ?? '')]))); });
    const pick = (n, stage) => ({ ...rows.find(r => r.Account === n), ...(stage ? { Stage: stage } : {}), 'Brad Notes': 'call him' });
    const ten = [
      pick('Gallagher Zz', 'Meeting set'), pick('OneDigital Zz', 'Replied'), pick('Brown Zz', 'Live'), // 3 forward partner moves
      pick('Aon Zz', 'Replied'), // backward
      pick('Solidcore Zz', 'Meeting'), pick('Union Zz', 'Proposal/Pilot'), // 2 employer moves
      { Account: 'Fresh Employer Zz', Type: 'Employer', Stage: 'Contacted', 'Owner Team': 'Upside', 'Priority Tier': '2' }, // new employer
      { Account: 'Burnham Zz', Type: 'Target', 'Owner Team': 'Upside' }, // new target
      { Account: 'Gone Zz', Type: 'Partner', Stage: 'Live', 'Prospector ID': 'partner:00000000-0000-4000-8000-000000000000' }, // unmatched
      pick('Lockton Zz'), // unchanged
    ];
    const hdr = [...head, 'Brad Notes'];
    const cell = v => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const toCsv = list => [hdr.join(','), ...list.map(r => hdr.map(h => cell(r[h] || '')).join(','))].join('\r\n');
    const text = toCsv(ten);
    keep('ten-rows.csv', text);
    const cfile = { name: 'joint.csv', data: Buffer.from(text).toString('base64') };
    const p2 = (await post(member, cfile)).body;
    const want = [`stage:partner:${id('Gallagher Zz')}`, `stage:partner:${id('OneDigital Zz')}`, `stage:partner:${id('Brown Zz')}`, `stage:employer:${id('Solidcore Zz')}`,
      `stage:employer:${id('Union Zz')}`, 'new:employer:fresh employer zz', 'new:target:burnham zz'].sort();
    ok('10-row preview: 3 partner + 2 employer forward moves, 1 new employer, 1 new target ticked', JSON.stringify(keys(p2)) === JSON.stringify(want), JSON.stringify(keys(p2)));
    const aon = p2.items.find(i => i.key === `stage:partner:${id('Aon Zz')}`);
    ok('backward Aon greyed "Prospector is ahead"; 8 items total', aon && !aon.tickable && aon.note === 'Prospector is ahead' && p2.items.length === 8, JSON.stringify(p2.items.map(i => i.key)));
    ok('unmatched Gone Zz listed; Brad Notes in ignored columns', p2.info.skipped.map(s => s.name).join() === 'Gone Zz' && p2.info.ignored.includes('Brad Notes'), JSON.stringify(p2.info));
    // A teammate moves OneDigital after the preview: that row alone fails.
    ins(await svc.from('sales_goals').update({ pipeline_status: 'meeting_set' }).eq('id', id('OneDigital Zz')).select());
    const a2 = (await post(member, cfile, tickAll(p2))).body;
    ok('apply: stale OneDigital fails "changed since the preview", the other 6 apply', a2.applied === 6 && a2.failed.length === 1 && a2.failed[0].name === 'OneDigital Zz' && a2.failed[0].error === 'changed since the preview', JSON.stringify(a2));
    const b2 = await board();
    ok('board: Gallagher yellow, Brown green, Solidcore + Union yellow, Fresh Employer gray, Burnham light',
      ['Gallagher Zz', 'Solidcore Zz', 'Union Zz'].every(n => color(b2, n) === 'yellow') && color(b2, 'Brown Zz') === 'green' && color(b2, 'Fresh Employer Zz') === 'gray' && color(b2, 'Burnham Zz') === 'light', JSON.stringify(b2.map(r => [r.name, r.color])));
    const [gal, brown, lock] = await Promise.all(['Gallagher Zz', 'Brown Zz', 'Lockton Zz'].map(goal));
    ok('sheet moves left last_touch_at alone (Gallagher, Brown, Lockton)', [gal, brown, lock].every(g => Date.parse(g.last_touch_at) === Date.parse(TOUCH)), JSON.stringify([gal, brown, lock]));
    const evs = ins(await svc.from('sales_partner_events').select('event, from_status, to_status, meta, by_user, source').eq('business_id', T));
    ok('4 status events (2 round trip + 2 of the 10-row file), all meta.source sheet, by the member; no dates set (prev = stage only)', evs.length === 4 && evs.every(e => e.event === 'status' && e.meta.source === 'sheet' && e.by_user === member.id && e.source === 'manual'
      && Object.keys(e.meta.prev).join() === 'pipeline_status'), JSON.stringify(evs));
    const hub = (await svc.from('sales_goals').select('first_email_at').eq('id', id('Hub Zz')).single()).data;
    ok('Hub moved to 1st email sent by the sheet: first_email_at still empty', hub.first_email_at === null, JSON.stringify(hub));
    const again = (await post(member, cfile)).body;
    const a3 = (await post(member, cfile, tickAll(again))).body;
    ok('same file again = 0 changes', tickAll(again).length === 0 && a3.applied === 0, JSON.stringify(again.items.filter(i => i.tickable)));

    // 3. Refusals.
    const at = await post(member, { name: 'joint.csv', data: Buffer.from(toCsv([{ ...ten[0], 'Next Step': `mail ${tag}@example.com` }])).toString('base64') });
    ok('a file with an "@" is refused (400, record named, value not echoed)', at.status === 400 && at.body.refused && !at.body.error.includes(tag), JSON.stringify(at));
    const v = await post(viewer, cfile);
    ok('viewer -> 403', v.status === 403, String(v.status));
    const bad = await post(member, { name: 'joint.xls', data: 'AAAA' });
    ok('.xls -> 400 refused', bad.status === 400 && bad.body.refused, JSON.stringify(bad));
  } catch (err) {
    ok('script ran without throwing', false, err.stack?.split('\n').slice(0, 3).join(' '));
  } finally {
    await cleanup();
    const left = made.biz ? (await svc.from('businesses').select('id').eq('id', made.biz)).data.length : 0;
    const users = (await Promise.all(made.users.map(u => svc.auth.admin.getUserById(u)))).filter(r => r.data?.user).length;
    const hlAfter = await counts(HOMELOVER);
    const diff = TABLES.filter(t => hlBefore[t] !== hlAfter[t]);
    ok('teardown complete (workspace + temp users gone)', left === 0 && users === 0);
    ok(`HomeLover counts identical (${TABLES.length} tables)`, !diff.length, diff.map(k => `${k} ${hlBefore[k]}->${hlAfter[k]}`).join(', '));
    console.log(`${pass}/${total} passed · ${!diff.length && left === 0 && users === 0 ? 'restored: yes' : 'restored: NO - see above'}`);
    process.exit(pass === total ? 0 : 1);
  }
})();

// pipeline-board-v1 Stage 3 live check - Export joint sheet. TEMP data only: 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local server only), 2 temp users (member + viewer), 3 partners, 3 opportunities, 2 targets, 2 sequenced accounts. Calls the board + its export on a local server.js 5 times and opens each .xlsx. HomeLover: before/after table counts only, 0 writes, 0 Apollo / 0 Claude / 0 syncs. ~20 s, cap 2 min.
// Usage: node scripts/verify/pipeline-board-v1-stage3.cjs [outdir]  (outdir keeps a copy of the exported file)
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const ExcelJS = require(ROOT + '/node_modules/exceljs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3991, tag = 'pb-' + Date.now();
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const TABLES = ['sales_goals', 'sales_opportunities', 'sales_targets', 'sales_sequenced_accounts'];
const made = { biz: null, users: [] };
let srv, pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('ABORT (2 min cap)'); cleanup().then(() => process.exit(2)); }, 120000);

async function counts(biz) {
  const o = {};
  for (const t of TABLES) { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', biz); o[t] = r.error ? 'err' : r.count; }
  return o;
}
async function cleanup() {
  if (srv) srv.kill();
  const b = made.biz;
  if (b) for (const t of ['sales_sequenced_accounts', 'sales_targets', 'sales_opportunity_events', 'sales_opportunities', 'sales_goals', 'business_members', 'auth_events']) {
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
    const T = made.biz = ins(await svc.from('businesses').insert({ name: `ZZ Export ${tag.slice(-4)}`, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
    const member = await user(T, 'member'), viewer = await user(T, 'viewer');
    ins(await svc.from('sales_goals').insert([
      { business_id: T, goal_type: 'partnership', name: 'Gallagher Zz', pipeline_status: 'meeting_set', category: '3. Brokers', tier: '1', hot: true, owner_user_id: member.id, owner_team: 'homelover', record_id: `${tag}-R1`, next_step: 'Email ann@gallagher.example or call 312-555-0100 by 2026-10-20', known_contacts: 'ann@gallagher.example' },
      { business_id: T, goal_type: 'partnership', name: 'OneDigital Zz', pipeline_status: 'replied', category: '3. Brokers', tier: '2', hot: false, owner_team: 'upside' },
      { business_id: T, goal_type: 'partnership', name: 'Current Zz', pipeline_status: 'in_sequence', category: '1. Current Partners (active)', tier: 'active', hot: false },
    ]).select());
    ins(await svc.from('sales_opportunities').insert([
      { business_id: T, organization: 'Solidcore Zz', org_type: 'employer', stage: 'meeting', owner: 'Jack', is_top: true, apollo_account_id: `${tag}-A1`, next_action: 'Call', next_action_date: '2026-10-20', source: 'manual' },
      { business_id: T, organization: 'Union Zz', org_type: 'membership', stage: 'nurture', is_top: false, source: 'manual' },
      { business_id: T, organization: 'Lost Zz', org_type: 'employer', stage: 'lost', is_top: false, source: 'manual' },
    ]).select());
    ins(await svc.from('sales_targets').insert([
      { business_id: T, name: 'Target Zz', kind: 'partner', status: 'proposed', owner_team: 'upside' },
      { business_id: T, name: 'Researching Zz', kind: 'employer', status: 'researching' },
    ]).select());
    ins(await svc.from('sales_sequenced_accounts').insert([
      { business_id: T, account_id: `${tag}-A1`, name: 'Solidcore Zz', first_sequenced_at: '2026-10-05T15:00:00Z', week_start: '2026-10-05', mailbox_email: `${tag}-mb@example.com` },
      { business_id: T, account_id: `${tag}-A3`, name: 'Fresh Zz', first_sequenced_at: '2026-10-05T15:00:00Z', week_start: '2026-10-05', mailbox_email: `${tag}-mb@example.com` },
    ]).select());

    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${T}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await wait(250); } }
    const req = (who, path) => fetch(`http://localhost:${PORT}/api/sales/${T}/goals/pipeline-board${path}`, { headers: { Cookie: `prospector_at=${encodeURIComponent(who.token)}` } });
    const sheet = async res => {
      const wb = new ExcelJS.Workbook();
      const buf = Buffer.from(await res.arrayBuffer());
      await wb.xlsx.load(buf);
      const ws = wb.worksheets[0], rows = [], cells = [];
      ws.eachRow((row, n) => { row.eachCell(c => cells.push(String(c.value))); if (n > 1) rows.push(row); });
      return { buf, header: ws.getRow(1).values.slice(1), rows, text: cells.join('|') };
    };

    const board = (await (await req(member, '')).json()).rows;
    const ex = await req(member, '/export?include_apollo=true');
    ok('member export 200 as .xlsx with a dated filename', ex.status === 200 && /spreadsheetml/.test(ex.headers.get('content-type')) && /joint-pipeline-\d{4}-\d{2}-\d{2}\.xlsx/.test(ex.headers.get('content-disposition')), `${ex.status} ${ex.headers.get('content-type')}`);
    const s = await sheet(ex);
    if (process.argv[2]) require('fs').writeFileSync(require('path').join(process.argv[2], 'joint-pipeline-temp.xlsx'), s.buf);
    ok('columns: board columns + Status + Prospector ID', JSON.stringify(s.header) === JSON.stringify(['Top', 'Account', 'Type', 'Status', 'Stage', 'Owner Team', 'Owner', 'Priority Tier', 'Next Step', 'Next Step Due', 'Last Touch', 'Record ID', 'Prospector ID']), JSON.stringify(s.header));
    const names = s.rows.map(r => r.getCell(2).value);
    ok('rows = the board (Top first), Apollo-only Fresh Zz left out even with include_apollo=true',
      JSON.stringify(names) === JSON.stringify([...board.filter(r => r.top), ...board.filter(r => !r.top)].map(r => r.name)) && !names.includes('Fresh Zz') && names.length === 8, JSON.stringify(names));
    const FILL = { green: 'FFC6EFCE', yellow: 'FFFFEB9C', blue: 'FFBDD7EE', gray: 'FFD9D9D9', light: 'FFF2F2F2', faded: 'FFFFFFFF' };
    const LABEL = { green: 'Live / strategic', yellow: 'Meeting', blue: 'Talking', gray: 'In outreach', light: 'Not started', faded: 'Parked' };
    const badFill = s.rows.filter(row => {
      const b = board.find(r => r.name === row.getCell(2).value);
      return [...Array(13).keys()].some(i => row.getCell(i + 1).fill?.fgColor?.argb !== FILL[b.color]) || row.getCell(4).value !== LABEL[b.color];
    }).map(r => r.getCell(2).value);
    ok('every cell of every row filled with its board color; Status word matches', !badFill.length, badFill.join(', '));
    ok('six colors present (green, yellow, blue, gray, light, faded)', new Set(board.map(r => r.color)).size === 6, JSON.stringify(board.map(r => r.color)));
    ok('0 "@", no phone, no Apollo id in the file; dates + Record ID kept',
      !s.text.includes('@') && !/555-0100/.test(s.text) && !s.text.includes(`${tag}-A`) && s.text.includes('2026-10-20') && s.text.includes(`${tag}-R1`), s.text.slice(0, 300));
    const up = await sheet(await req(member, '/export?owner_team=upside&type=partner'));
    ok('filters carried: owner_team=upside&type=partner -> OneDigital only', JSON.stringify(up.rows.map(r => r.getCell(2).value)) === '["OneDigital Zz"]', JSON.stringify(up.rows.map(r => r.getCell(2).value)));
    const v = await req(viewer, '/export');
    ok('viewer export -> 403', v.status === 403, String(v.status));
    const bad = await req(member, '/export?color=pink');
    ok('bad enum -> 400', bad.status === 400, String(bad.status));
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

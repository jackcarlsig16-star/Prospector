// master-pipeline-import-v1 REV4 Stage 2 (+2b single-file reader) live check. TEMP data only: 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local server only), 3 temp users (owner "Jack Zz", member "Cyrus Zz", viewer). Seed: 4 partners (Aon, ADP TotalSource + confirmed adp.com, Roots, OneDigital), 1 contact, 3 opportunities (Marriott International, Meeting Co, Contacted Co), 1 rejected target, 1 sequenced account + 1 accounts snapshot (needs 1 sync-run row). The fixture CSV (the sheet's own 32-column shape) lives in <outdir>, never inbox/. Runs the real importer CLI 6 times (refused, dry, apply, re-apply, edited-notes apply, accept-possible), then Part B in the browser (1440 + 390 member, 1440 viewer). 0 Apollo / 0 Claude / 0 syncs; HomeLover is only COUNTED. Serves build/ via server.js - run npm run build first. ~1-2 min, cap 4 min.
// Usage: node scripts/verify/master-pipeline-import-v1-stage2.cjs <outdir>
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3988, tag = 'mpi2-' + Date.now();
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const HL_TABLES = ['sales_goals', 'sales_partner_events', 'sales_opportunities', 'sales_opportunity_events', 'sales_targets', 'partner_contacts', 'partner_domains', 'sales_week_goals'];
const T_TABLES = ['sales_goals', 'sales_partner_events', 'sales_opportunities', 'sales_opportunity_events', 'sales_targets', 'partner_contacts', 'partner_domains', 'sales_week_goals'];
const OUT = process.argv[2] || '/tmp';
const made = { biz: null, users: [] };
let srv, browser, pass = 0, total = 0, blocked = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('ABORT (4 min cap)'); cleanup().then(() => process.exit(2)); }, 240000);

// Fixture rows are written in field terms and exported in the sheet's own
// vocabulary and 32-column shape (REV4), contacts in Primary Contact / Title.
const SHEET = ['Record ID', 'Account', 'Account Type', 'Segment', 'Priority Tier', 'Funnel Stage', 'Partner Path', 'Owner Team', 'Owner',
  'Co-owner Team', 'Next Step', 'Next Step Due', 'Last Touch Date', 'Last Touch By', 'Primary Contact', 'Primary Title', 'Primary Email Domain',
  'Email Status', 'Has Phone', 'Contacts Emailed (#)', 'Contacts Emailed Domains', 'Route In', 'Broker on Account', 'Brad Reached Out',
  'HomeLover Outreach', 'Both Teams Touched', 'On Brad Target List', 'Original Priority', 'Flags', 'Notes', 'Source', 'Confirmed with Brad'];
const STAGE_NO = { 'Not contacted': 1, Contacted: 2, Engaged: 3, 'Meeting scheduled': 4, 'Meeting held': 5, 'Pilot/proposal': 6, Live: 7, Nurture: 8, Hold: 9 };
const TIER_LABEL = { 1: '1 - Priority', 2: '2 - Secondary', 3: '3 - Later', 4: '4 - Hold' };
const KIND_LABEL = { partner: 'Partner', employer: 'Employer', association: 'Association', health_plan: 'Health plan', other: 'Other' };
const TEAM_LABEL = { homelover: 'HomeLover', upside: 'Upside', both: 'Both' };
const csvCell = v => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const sheetRow = (r, c) => ({
  'Record ID': r.record_id, Account: r.name, 'Account Type': KIND_LABEL[r.kind], Segment: r.segment, 'Priority Tier': TIER_LABEL[r.tier],
  'Funnel Stage': r.funnel_stage && `${STAGE_NO[r.funnel_stage]} - ${r.funnel_stage === 'Hold' ? 'Hold / disqualified' : r.funnel_stage}`,
  'Partner Path': r.partner_path, 'Owner Team': TEAM_LABEL[r.owner_team], Owner: r.owner_name, 'Next Step': r.next_step, 'Next Step Due': r.next_step_due,
  'Primary Contact': c?.name, 'Primary Title': c?.title, 'Primary Email Domain': r.company_domain, Flags: r.flags, Notes: r.notes,
  'Last Touch Date': '2026-10-01', 'Has Phone': 'Yes', 'Original Priority': 'P2',
});
const sheetCsv = (rows, contacts) => [SHEET.join(','), ...rows.map(r => { const x = sheetRow(r, contacts.find(c => c.record_id === r.record_id)); return SHEET.map(h => csvCell(x[h] ?? '')).join(','); })].join('\r\n') + '\r\n';
const ACCOUNTS = [
  { record_id: 'HLU-0001', name: 'Aon', kind: 'partner', tier: '1', funnel_stage: 'Contacted', owner_team: 'upside', owner_name: 'Cyrus', next_step: 'Send the joint deck', next_step_due: '2026-10-20', notes: 'Joint account\nsecond line' },
  { record_id: 'HLU-0002', name: 'ADP', kind: 'employer', company_domain: 'www.adp.com', funnel_stage: 'Engaged', owner_team: 'both' },
  { record_id: 'HLU-0003', name: 'Burnham Benefits', kind: 'partner', owner_team: 'upside', funnel_stage: 'Meeting held' },
  { record_id: 'HLU-0004', name: 'Invest with Roots', kind: 'partner', funnel_stage: 'Contacted' },
  { record_id: 'HLU-0005', name: 'Marriott International', kind: 'employer', company_domain: 'marriott.com', segment: 'Hospitality', tier: '1', funnel_stage: 'Nurture', owner_team: 'upside', owner_name: 'Brad Cillian' },
  { record_id: 'HLU-0006', name: '24 Hour Fitness', kind: 'employer', segment: 'Fitness', tier: '2', funnel_stage: 'Meeting scheduled', owner_team: 'homelover', owner_name: 'Jack', partner_path: 'Direct', next_step: 'Joint note', next_step_due: '2026-10-22' },
  { record_id: 'HLU-0007', name: 'Teachers Guild', kind: 'association', tier: '3', funnel_stage: 'Hold', owner_team: 'both' },
  { record_id: 'HLU-0008', name: 'Nope Inc', kind: 'partner', funnel_stage: 'Contacted' },
  { record_id: 'HLU-0009', name: 'Meeting Co', kind: 'employer', funnel_stage: 'Contacted', tier: '4' },
  { record_id: 'HLU-0010', name: 'Contacted Co', kind: 'employer', funnel_stage: 'Hold' },
  { record_id: 'HLU-0011', name: 'OneDigital', kind: 'partner', funnel_stage: 'Live', owner_team: 'upside' },
  { record_id: 'HLU-0012', name: 'Health Plan X', kind: 'health_plan', funnel_stage: 'Not contacted' },
];
const CONTACTS = [
  { record_id: 'HLU-0001', name: 'Pat Lee', title: 'SVP Benefits' },
  { record_id: 'HLU-0006', name: 'Jill Vaslow', title: 'Managing VP Benefits' },
  { record_id: 'HLU-0003', name: 'Dana Fox', title: 'Partner' },
  { record_id: 'HLU-0009', name: 'Amy Ng and Bo Li', title: 'HR' },
];

async function counts(biz, tables) {
  const o = {};
  for (const t of tables) { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', biz); o[t] = r.error ? `n/a (${r.error.message.slice(0, 40)})` : r.count; }
  return o;
}
async function cleanup() {
  if (browser) await browser.close().catch(() => {});
  if (srv) srv.kill();
  const b = made.biz;
  if (b) {
    for (const t of ['sales_partner_events', 'partner_contacts', 'partner_domains', 'sales_week_goals', 'sales_targets', 'sales_opportunity_events', 'sales_opportunities', 'sales_raw_snapshots', 'sales_sync_runs', 'sales_sequenced_accounts', 'sales_goals', 'business_members', 'auth_events']) {
      const r = await svc.from(t).delete().eq('business_id', b);
      if (r.error) console.log(`cleanup ${t}: ${r.error.message}`);
    }
  }
  for (const u of made.users) { await svc.from('auth_events').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('actor_id', u); }
  if (b) await svc.from('businesses').delete().eq('id', b);
  for (const u of made.users) await svc.auth.admin.deleteUser(u);
}
async function user(name, role) {
  const email = `${tag}-${name.split(' ')[0].toLowerCase()}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
  const { data: u } = await svc.auth.admin.createUser({ email, password, email_confirm: true }); made.users.push(u.user.id);
  await svc.from('profiles').update({ display_name: name, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
  ins(await svc.from('business_members').insert({ business_id: made.biz, email, name, user_id: u.user.id, role }).select());
  const c = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  return { id: u.user.id, session: (await c.auth.signInWithPassword({ email, password })).data.session };
}
function importer(args) {
  const r = spawnSync('node', [ROOT + '/scripts/import-master-pipeline.cjs', made.biz, `${OUT}/mpi2-master-pipeline.csv`, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const writeFiles = (accounts, contacts) => fs.writeFileSync(`${OUT}/mpi2-master-pipeline.csv`, sheetCsv(accounts, contacts));
const written = out => JSON.parse((out.match(/Written: (\{.*\})/) || [])[1] || 'null');

async function newPage(u, width, height) {
  const errs = [];
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage(); page.setDefaultTimeout(10000);
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); }); page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
  await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)/, r => { blocked++; r.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"blocked by verify script"}' }); });
  await page.addInitScript(([k, v]) => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(u.session)]);
  await page.goto(`http://localhost:${PORT}/`); await page.waitForTimeout(3000);
  return { page, errs };
}
let WS_NAME;
async function openEmployers(page, compact) {
  const menu = async () => { if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); } };
  await menu(); await page.getByLabel('Workspace').selectOption({ label: WS_NAME }); await page.waitForTimeout(2500);
  await menu(); await page.locator('#root').getByRole('button', { name: 'Goals & Sales', exact: true }).dispatchEvent('click'); await page.waitForTimeout(4000);
  await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: /^Employers/ }).first().click();
  await page.locator('section[aria-labelledby="h-employers"] tbody tr').first().waitFor(); await page.waitForTimeout(500);
}

(async () => {
  const hlBefore = await counts(HOMELOVER, HL_TABLES);
  const { savePayload } = await import(ROOT + '/src/components/salesAnalytics/opportunityPayload.js');
  try {
    WS_NAME = `ZZ Import ${tag.slice(-4)}`;
    const T = made.biz = ins(await svc.from('businesses').insert({ name: WS_NAME, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-jack@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
    const J = await user('Jack Zz', 'owner'), C = await user('Cyrus Zz', 'member'), V = await user('Viewer Zz', 'viewer');
    const touched = '2026-10-01T15:00:00.000Z';
    const P = (name, status, extra = {}) => ({ business_id: T, goal_type: 'partnership', name, pipeline_status: status, ...extra });
    const partners = ins(await svc.from('sales_goals').insert([
      P('Aon', 'meeting_set', { owner_user_id: J.id, tier: '2', category: 'Brokers', notes: 'Our own note', last_touch_at: touched }),
      P('ADP TotalSource', 'not_started', { category: 'Platforms' }),
      P('Roots', 'not_started', { category: 'Platforms' }),
      P('OneDigital', 'meeting_set', { owner_user_id: C.id, category: 'Brokers', last_touch_at: touched }),
    ]).select());
    const pid = n => partners.find(p => p.name === n).id;
    ins(await svc.from('partner_domains').insert({ business_id: T, goal_id: pid('ADP TotalSource'), domain: 'adp.com', source: 'manual', confirmed: true }).select());
    ins(await svc.from('partner_contacts').insert({ business_id: T, goal_id: pid('Aon'), name: 'Pat Lee', title: 'VP', source: 'manual' }).select());
    ins(await svc.from('sales_opportunities').insert([
      { business_id: T, organization: 'Marriott International', org_type: 'employer', stage: 'responded', source: 'manual' },
      { business_id: T, organization: 'Meeting Co', org_type: 'employer', stage: 'meeting', source: 'manual' },
      { business_id: T, organization: 'Contacted Co', org_type: 'employer', stage: 'contacted', source: 'manual' },
    ]).select());
    ins(await svc.from('sales_targets').insert({ business_id: T, name: 'Nope Inc', kind: 'partner', status: 'rejected' }).select());
    ins(await svc.from('sales_sequenced_accounts').insert({ business_id: T, account_id: 'ap-mar-zz', name: 'Marriott International', first_sequenced_at: '2026-10-06T16:00:00Z', week_start: '2026-10-05' }).select());
    const run = ins(await svc.from('sales_sync_runs').insert({ business_id: T, trigger: 'manual', status: 'success', finished_at: new Date().toISOString() }).select().single());
    ins(await svc.from('sales_raw_snapshots').insert({ business_id: T, run_id: run.id, entity: 'accounts', payload: [{ id: 'ap-mar-zz', name: 'Marriott International', domain: 'marriott.com' }] }).select());
    const partnersBefore = ins(await svc.from('sales_goals').select('id, name, pipeline_status, last_touch_at').eq('business_id', T));
    const domainsBefore = (await counts(T, ['partner_domains'])).partner_domains;

    // A1 refusal: an "@" anywhere, then a phone number - nothing written.
    let c0 = await counts(T, T_TABLES);
    writeFiles(ACCOUNTS.map(r => (r.record_id === 'HLU-0005' ? { ...r, notes: 'ask jill at jv@marriott.com' } : r)), CONTACTS);
    const refAt = importer(['--apply']);
    writeFiles(ACCOUNTS, CONTACTS.map(c => (c.record_id === 'HLU-0006' ? { ...c, title: 'call 312 555 0199' } : c)));
    const refPhone = importer(['--apply']);
    ok('A1 a file with an "@" or a phone number is refused, names the record not the value, writes nothing',
      refAt.code === 1 && /REFUSED.*HLU-0005.*"@"/.test(refAt.out) && !refAt.out.includes('jv@') && refPhone.code === 1 && /phone number/.test(refPhone.out) && !refPhone.out.includes('555')
      && JSON.stringify(await counts(T, T_TABLES)) === JSON.stringify(c0), `${refAt.out.slice(0, 160)} | ${refPhone.out.slice(0, 160)}`);

    // A2 dry run.
    writeFiles(ACCOUNTS, CONTACTS);
    const dry = importer(['--json', `${OUT}/mpi2-dry.json`]);
    const plan1 = JSON.parse(fs.readFileSync(`${OUT}/mpi2-dry.json`, 'utf8')).report;
    ok('A2 dry run writes nothing and routes every row', dry.code === 0 && /Nothing written/.test(dry.out) && JSON.stringify(await counts(T, T_TABLES)) === JSON.stringify(c0)
      && JSON.stringify(plan1.counts) === JSON.stringify({ partner_update: 3, partner_to_target: 1, target_update: 0, opp_insert: 3, opp_update: 3, skipped: 2, invalid: 0 }), JSON.stringify(plan1.counts));
    ok('A2 dry run lists sheet-ahead / behind partners, the refused employer stages, the possible and the kind mismatch',
      plan1.partner_stages.some(s => s.name === 'OneDigital' && s.dir === 'ahead') && plan1.partner_stages.some(s => s.name === 'Aon' && s.dir === 'behind')
      && plan1.opp_stage_refused.map(s => s.name).sort().join() === 'Marriott International,Meeting Co' && plan1.possibles[0]?.record_id === 'HLU-0004'
      && plan1.kind_mismatches[0]?.record_id === 'HLU-0002' && /sheet ahead: Live/.test(dry.out)
      && /Ignored columns \(13\): Co-owner Team, Last Touch Date/.test(dry.out) && /2\+ people - not imported, not split \(1\)\n  HLU-0009  Meeting Co/.test(dry.out), JSON.stringify({ s: plan1.partner_stages, r: plan1.opp_stage_refused, p: plan1.possibles }));

    // A3 apply.
    const app = importer(['--apply']);
    const w1 = written(app.out);
    ok('A3 --apply exits 0 with no errors', app.code === 0 && w1 && w1.errors === 0, app.out.slice(-300));
    const goals = ins(await svc.from('sales_goals').select('*').eq('business_id', T));
    const g = n => goals.find(x => x.name === n);
    ok('A3 NO partner is stage-moved and every last_touch_at is unchanged', partnersBefore.every(b => { const a = goals.find(x => x.id === b.id); return a.pipeline_status === b.pipeline_status && a.last_touch_at === b.last_touch_at; }),
      JSON.stringify(goals.map(x => [x.name, x.pipeline_status, x.last_touch_at])));
    const events = ins(await svc.from('sales_partner_events').select('goal_id, event, meta, source').eq('business_id', T));
    ok('A3 partner events are Assign only, each carrying meta.from_import (no status / touch events)', events.length === 3 && events.every(e => e.event === 'assign' && /^HLU-/.test(e.meta?.from_import || '')),
      JSON.stringify(events.map(e => [e.event, e.meta?.from_import])));
    const aon = g('Aon');
    ok('A3 Aon: owner_team upside, no co-owner, owner stays Jack (Cyrus reported), tier 2 kept, record_id, notes block appended under the user note',
      aon.owner_team === 'upside' && aon.co_owner_name === null && aon.owner_user_id === J.id && aon.tier === '2' && aon.record_id === 'HLU-0001'
      && aon.notes === 'Our own note\n\n— master sheet HLU-0001 —\nNotes: Joint account second line', JSON.stringify({ t: aon.owner_team, o: aon.owner_user_id === J.id, tier: aon.tier, n: aon.notes }));
    ok('A3 ADP (sheet "employer") stays the partner ADP TotalSource: record_id + owner_team both, no employer row', g('ADP TotalSource').record_id === 'HLU-0002' && g('ADP TotalSource').owner_team === 'both'
      && !(await svc.from('sales_opportunities').select('id').eq('business_id', T).ilike('organization', 'adp%')).data.length);
    ok('A3 OneDigital: still meeting_set (sheet says Live = reported, not applied)', g('OneDigital').pipeline_status === 'meeting_set' && g('OneDigital').owner_team === 'upside');
    const pc = ins(await svc.from('partner_contacts').select('name, title, role_in_notes, email, source').eq('goal_id', aon.id).order('name'));
    ok('A3 Aon people: Pat Lee (Primary Contact) updated to SVP Benefits, nobody added, no email', JSON.stringify(pc) === JSON.stringify([
      { name: 'Pat Lee', title: 'SVP Benefits', role_in_notes: null, email: null, source: 'manual' }]), JSON.stringify(pc));
    const todos = ins(await svc.from('sales_week_goals').select('text, due_date, owner_user_id, link_type, link_id, kind, status').eq('business_id', T));
    ok('A3 one to-do linked to Aon, due 10/20, owner Jack', todos.length === 1 && todos[0].text === 'Send the joint deck' && todos[0].due_date === '2026-10-20' && todos[0].owner_user_id === J.id && todos[0].link_type === 'partner' && todos[0].link_id === aon.id, JSON.stringify(todos));
    const targets = ins(await svc.from('sales_targets').select('*').eq('business_id', T));
    const burn = targets.find(t => t.name === 'Burnham Benefits');
    ok('A3 Burnham Benefits -> target (proposed, evidence, no category - the sheet has none, Upside, people as names/titles); Invest with Roots NOT imported; Nope Inc stays rejected',
      burn && burn.status === 'proposed' && burn.evidence === 'master sheet HLU-0003' && burn.suggested_category === null && burn.owner_team === 'upside' && burn.record_id === 'HLU-0003' && burn.research_notes === 'Dana Fox — Partner'
      && !targets.some(t => /roots/i.test(t.name)) && targets.find(t => t.name === 'Nope Inc').status === 'rejected' && !targets.find(t => t.name === 'Nope Inc').record_id, JSON.stringify(targets.map(t => [t.name, t.status])));
    const opps = ins(await svc.from('sales_opportunities').select('*').eq('business_id', T));
    const o = n => opps.find(x => x.organization === n);
    ok('A3 Marriott: stays responded (no parking a live deal), Upside + co-owner Brad Cillian, tier 1, cohort, apollo_account_id from the sequenced match',
      o('Marriott International').stage === 'responded' && o('Marriott International').owner_team === 'upside' && o('Marriott International').co_owner_name === 'Brad Cillian' && o('Marriott International').tier === '1' && o('Marriott International').cohort === 'Hospitality' && o('Marriott International').apollo_account_id === 'ap-mar-zz');
    const fit = o('24 Hour Fitness');
    ok('A3 24 Hour Fitness inserted: meeting, owner Jack, HomeLover, no co-owner, tier 2, decision maker line, next action, notes block, source csv',
      fit && fit.stage === 'meeting' && fit.owner === 'Jack' && fit.owner_team === 'homelover' && fit.co_owner_name === null && fit.tier === '2' && fit.decision_makers === 'Jill Vaslow — Managing VP Benefits'
      && fit.next_action === 'Joint note' && fit.next_action_date === '2026-10-22' && fit.notes === '— master sheet HLU-0006 —\nPartner path: Direct' && fit.source === 'csv' && fit.record_id === 'HLU-0006', JSON.stringify(fit));
    ok('A3 Teachers Guild = membership, on_hold; Meeting Co\'s 2-person cell not imported; Health Plan X = employer with "Account type: Health plan"; Meeting Co stays meeting (backwards refused); Contacted Co parked on_hold',
      o('Teachers Guild')?.org_type === 'membership' && o('Teachers Guild')?.stage === 'on_hold' && /Account type: Health plan/.test(o('Health Plan X')?.notes || '') && o('Health Plan X')?.stage === 'target'
      && o('Meeting Co').stage === 'meeting' && o('Meeting Co').tier === '4' && !o('Meeting Co').decision_makers && o('Contacted Co').stage === 'on_hold');
    const oev = ins(await svc.from('sales_opportunity_events').select('opportunity_id, event_type, from_stage, to_stage').eq('business_id', T).eq('event_type', 'stage_change'));
    ok('A3 the trigger logged exactly one employer stage change (Contacted Co contacted -> on_hold)', oev.length === 1 && oev[0].from_stage === 'contacted' && oev[0].to_stage === 'on_hold', JSON.stringify(oev));
    ok('A3 no partner_domains rows written', (await counts(T, ['partner_domains'])).partner_domains === domainsBefore);

    // A4 re-run = idempotent.
    const c1 = await counts(T, T_TABLES);
    const again = importer(['--apply']);
    const w2 = written(again.out);
    ok('A4 second --apply: 0 inserts, 0 stage moves, 0 writes, table counts identical', again.code === 0 && w2 && Object.entries(w2).every(([, v]) => v === 0) && /Employer stage moves \(0\)/.test(again.out)
      && JSON.stringify(await counts(T, T_TABLES)) === JSON.stringify(c1), JSON.stringify(w2));

    // A5 the sheet's note changes: the block is replaced, never duplicated.
    await svc.from('sales_goals').update({ notes: `${aon.notes}\n\nAdded by hand later` }).eq('id', aon.id);
    writeFiles(ACCOUNTS.map(r => (r.record_id === 'HLU-0001' ? { ...r, notes: 'Joint account v2', flags: 'No cold email' } : r)), CONTACTS);
    importer(['--apply']);
    const aon2 = ins(await svc.from('sales_goals').select('notes').eq('id', aon.id).single());
    ok('A5 edited sheet notes replace only the marker block; the user\'s notes before and after it stay', aon2.notes === 'Our own note\n\n— master sheet HLU-0001 —\nFlags: No cold email\nNotes: Joint account v2\n\nAdded by hand later'
      && aon2.notes.split('master sheet HLU-0001').length === 2, JSON.stringify(aon2.notes));

    // A6 --accept-possible.
    importer(['--apply', '--accept-possible', 'HLU-0004']);
    ok('A6 --accept-possible HLU-0004 imports Invest with Roots as a target', !!(await svc.from('sales_targets').select('id').eq('business_id', T).eq('record_id', 'HLU-0004').maybeSingle()).data);

    // A7 the opportunity panel's save (597c547 bug class) through the real route.
    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${T}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await wait(250); } }
    const call = (u, method, path, body) => fetch(`http://localhost:${PORT}/api/sales/${T}${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: `prospector_at=${encodeURIComponent(u.session.access_token)}` }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
    const list = (await call(J, 'GET', '/opportunities')).body.opportunities || [];
    const row = list.find(x => x.organization === 'Marriott International');
    const whole = Object.fromEntries(Object.entries(row).filter(([k]) => !['id', 'business_id', 'source', 'archived_at', 'created_at', 'updated_at'].includes(k)));
    const oldWay = await call(J, 'PATCH', `/opportunities/${row.id}`, whole);
    const fixed = savePayload ? savePayload(row, { ...row, next_action: 'Intro call' }) : null;
    const newWay = fixed ? await call(J, 'PATCH', `/opportunities/${row.id}`, fixed) : { status: 0 };
    ok('A7 panel save: echoing the whole row (old behaviour) is refused with "unknown field: record_id"; the panel now sends only the change and saves',
      oldWay.status === 400 && /unknown field: (record_id|apollo_account_id)/.test(oldWay.body.error) && JSON.stringify(fixed) === '{"next_action":"Intro call"}' && newWay.status === 200 && newWay.body.opportunity?.next_action === 'Intro call' && newWay.body.opportunity?.record_id === 'HLU-0005',
      `${oldWay.status} ${oldWay.body.error} | ${JSON.stringify(fixed)} ${newWay.status}`);
    const tierBad = await call(J, 'PATCH', `/opportunities/${row.id}`, { tier: '9' });
    const viewerWrite = await call(V, 'PATCH', `/opportunities/${row.id}`, { next_action: 'x' });
    ok('A7 tier is validated (9 -> 400) and a Viewer write is refused (403)', tierBad.status === 400 && viewerWrite.status === 403, `${tierBad.status} ${viewerWrite.status}`);

    // Part B - Goals > Employers.
    browser = await chromium.launch();
    for (const [width, height, compact] of [[1440, 900, false], [390, 844, true]]) {
      const { page, errs } = await newPage(J, width, height);
      await openEmployers(page, compact);
      const body = await page.locator('section[aria-labelledby="h-employers"]').innerText();
      ok(`B ${width}: Employers lists the 6 employer/membership rows with stage, owner pill and tier`, /6 employers/.test(body) && ['24 Hour Fitness', 'Marriott International', 'Teachers Guild', 'Health Plan X', 'Meeting Co', 'Contacted Co'].every(n => body.includes(n))
        && /Upside · Brad Cillian/.test(body) && /HomeLover/.test(body) && /T1/.test(body) && /Add opportunity/.test(body), body.slice(0, 300));
      ok(`B ${width}: stage cells read Meeting / On hold / Responded`, await page.locator('tbody select').evaluateAll(s => s.map(x => x.selectedOptions[0]?.textContent)).then(v => ['Meeting', 'On hold', 'Responded'].every(x => v.includes(x))));
      await page.screenshot({ path: `${OUT}/mpi2-${width}-employers.png`, fullPage: width === 390 });
      ok(`B ${width}: no sideways page scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      ok(`B ${width}: 0 console errors`, !errs.length, errs.join(' | '));
      if (width === 1440) {
        await page.getByText('Marriott International', { exact: true }).click();
        await page.getByText('Edit opportunity').waitFor();
        await page.screenshot({ path: `${OUT}/mpi2-1440-panel.png` });
        ok('B 1440: a member opens the edit panel', await page.getByText('Edit opportunity').count() === 1);
      }
    }
    const { page: vp, errs: verrs } = await newPage(V, 1440, 900);
    await openEmployers(vp, false);
    const vbody = await vp.locator('section[aria-labelledby="h-employers"]').innerText();
    await vp.getByText('Marriott International', { exact: true }).click(); await vp.waitForTimeout(500);
    const vControls = await vp.locator('tbody select, tbody input').count(), vPanel = await vp.getByText('Edit opportunity').count();
    ok('B viewer: read-only - no Add / Import / Template, no row controls, no edit panel', !/Add opportunity|Import CSV|Template/.test(vbody) && vControls === 0 && vPanel === 0 && /On hold/.test(vbody),
      JSON.stringify({ words: (vbody.match(/Add opportunity|Import CSV|Template/g) || []), vControls, vPanel, onHold: /On hold/.test(vbody) }));
    await vp.screenshot({ path: `${OUT}/mpi2-1440-viewer.png` });
    ok('B viewer: 0 console errors', !verrs.length, verrs.join(' | '));
    ok('B 0 sync / Apollo requests left the browser', blocked === 0, `blocked ${blocked}`);
  } catch (e) {
    ok('script ran without throwing', false, e.stack?.split('\n').slice(0, 3).join(' '));
  } finally {
    await cleanup();
    const left = made.biz ? (await svc.from('businesses').select('id').eq('id', made.biz)).data.length : 0;
    const hlAfter = await counts(HOMELOVER, HL_TABLES);
    const diff = HL_TABLES.filter(t => hlBefore[t] !== hlAfter[t]);
    ok('teardown complete (workspace gone)', left === 0);
    ok(`HomeLover counts identical (${HL_TABLES.length} tables)`, !diff.length, diff.map(k => `${k} ${hlBefore[k]}->${hlAfter[k]}`).join(', '));
    console.log(`${pass}/${total} passed · ${!diff.length && left === 0 ? 'restored: yes' : 'restored: NO - see above'}`);
    process.exit(pass === total ? 0 : 1);
  }
})();

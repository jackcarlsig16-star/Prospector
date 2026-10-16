// temp-guard-v1 check - a verify script killed mid-run still removes its temp data (scripts/verify/lib/tempGuard.cjs). Runs 3 real temp-workspace checks and kills each once it has created its workspace: perl alarm (SIGALRM, as the 4-min cap does), SIGINT (Ctrl-C), SIGTERM. Each creates and tears down 1 temp workspace + its temp users; HomeLover: before/after table counts only, 0 writes. 0 Apollo / 0 Claude / 0 syncs. ~1 min, cap 4 min.
// Usage: node scripts/verify/temp-guard-v1.cjs
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const TABLES = ['sales_goals', 'sales_opportunities', 'sales_targets', 'sales_partner_events', 'sales_week_goals', 'business_members'];
const TEMP_EMAIL = /^[a-z0-9]+-\d{13}(-[a-z0-9]+)*@example\.com$/i;
let pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && d ? ` - ${d}` : ''}`); };
setTimeout(() => { console.log('ABORT (4 min cap)'); process.exit(2); }, 240000).unref();

async function counts(biz) {
  const o = {};
  for (const t of TABLES) { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', biz); o[t] = r.error ? 'err' : r.count; }
  return o;
}
// Every temp marker the verify scripts use: "ZZ " workspaces, <tag>-<ms>@example.com users and memberships.
async function leftovers() {
  const { data: biz } = await svc.from('businesses').select('id').or('name.ilike.ZZ*,owner_email.ilike.*@example.com');
  const users = [];
  for (let page = 1; ; page++) { const { data } = await svc.auth.admin.listUsers({ page, perPage: 200 }); users.push(...data.users); if (data.users.length < 200) break; }
  const { data: mem } = await svc.from('business_members').select('email').ilike('email', '%@example.com');
  return { workspaces: biz.length, users: users.filter(u => TEMP_EMAIL.test(u.email || '')).length, members: mem.filter(m => TEMP_EMAIL.test(m.email)).length };
}
const portFree = port => fetch(`http://localhost:${port}/`).then(() => false, () => true);

// Starts the check, waits until it has created its workspace and printed a
// result line, then kills it the given way.
function killMidRun({ script, port, how }) {
  return new Promise(resolve => {
    const cmd = how === 'SIGALRM' ? ['perl', ['-e', 'alarm 60; exec @ARGV', 'node', script]] : ['node', [script]];
    const child = spawn(cmd[0], cmd[1], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', sent = false;
    child.stdout.on('data', d => {
      out += d;
      if (!sent && /^(PASS|FAIL) /m.test(out)) {
        sent = true;
        // perl exec'd into node, so the pid is node's; SIGALRM is what the alarm delivers.
        child.kill(how);
      }
    });
    child.stderr.on('data', d => { out += d; });
    child.on('exit', code => resolve({ code, out, sent, port }));
  });
}

(async () => {
  const hlBefore = await counts(HOMELOVER);
  const start = await leftovers();
  ok('no temp data before the run', !start.workspaces && !start.users && !start.members, JSON.stringify(start));
  for (const run of [
    { script: 'scripts/verify/pipeline-board-v1-stage4.cjs', port: 3992, how: 'SIGALRM' },
    { script: 'scripts/verify/task-drawer-v1-stage1.cjs', port: 3981, how: 'SIGINT' },
    { script: 'scripts/verify/pipeline-board-v1-stage3.cjs', port: 3991, how: 'SIGTERM' },
  ]) {
    const r = await killMidRun(run);
    const name = run.script.split('/').pop();
    ok(`${name} killed mid-run with ${run.how}, tore down, exit 2`, r.sent && r.code === 2 && r.out.includes(`ABORT (${run.how})`) && r.out.includes('teardown after abort: done'), r.out.split('\n').slice(-6).join(' | '));
    const left = await leftovers();
    ok(`${name}: 0 temp workspaces, users, memberships left`, !left.workspaces && !left.users && !left.members, JSON.stringify(left));
    ok(`${name}: its local server is gone (port ${run.port} free)`, await portFree(run.port));
  }
  const hlAfter = await counts(HOMELOVER);
  const diff = TABLES.filter(t => hlBefore[t] !== hlAfter[t]);
  ok(`HomeLover counts identical (${TABLES.length} tables)`, !diff.length, diff.map(k => `${k} ${hlBefore[k]}->${hlAfter[k]}`).join(', '));
  console.log(`${pass}/${total} passed · ${!diff.length && pass === total ? 'restored: yes' : 'restored: NO - see above'}`);
  process.exit(pass === total ? 0 : 1);
})().catch(e => { console.log('ERROR', e.message); process.exit(1); });

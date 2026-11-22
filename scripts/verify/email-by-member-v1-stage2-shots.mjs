// email-by-member-v1 Stage 2 - the before / after PNGs, on localhost against the build as the platform owner on the
// real sales workspace. READ-ONLY (readOnlyBrowser: every non-GET aborted); 0 Claude, 0 Apollo, 0 sends.
// DECLARED: 4 page loads (Email + Scorecard at 1440 and 390) + 1 route GET (goals/weekly, member=all after, for the email
// render at 640) + each page's own reads. After: + axe and the 0 px rule on each page, + Settings › Team emails at
// 1440. ~100 s, cap 230 s. PNGs: .screenshots/email-by-member-v1/<name>-<width>-<before|after>.png. Anything on a
// page that holds an address is masked in the PNG and counted.
//   node scripts/verify/email-by-member-v1-stage2-shots.mjs --before | --after
import fs from 'fs';
import path from 'path';
import { readOnlyBrowser } from './lib/readOnlyBrowser.mjs';

const WHEN = process.argv.includes('--before') ? 'before' : 'after';
const h = await readOnlyBrowser({ port: 3996, capMs: 230000 });
const OUT = path.join(h.ROOT, '.screenshots', 'email-by-member-v1');
fs.mkdirSync(OUT, { recursive: true });
const AXE = fs.readFileSync(path.join(h.ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const { buildWeeklyEmail } = await import('../../api/sales/teamEmails/weeklyEmail.js');
const B = h.workspace.id, T0 = Date.now();
const checks = [];
const ok = (name, pass, detail = '') => { checks.push(!!pass); console.log(`[${Math.round((Date.now() - T0) / 1000)}s] ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${String(detail).slice(0, 500)}` : ''}`); };
const ADDRESS = /[^\s"<>]+@[^\s"<>]+\.[a-z]{2,}/i;
const PAGES = [
  ['email', 'tab=dashboard&view=analytics', '[data-email-view] [data-pulse-tile], [data-email-view] [data-by-member]', '[data-email-view]'],
  ['scorecard', 'tab=dashboard&view=scorecard', '[data-scorecard] [data-value]', '[data-scorecard]'],
  ...(WHEN === 'after' ? [['settings-team-emails', 'tab=settings&view=team-emails', '[data-mailbox-map]', '[data-mailbox-map]']] : []),
];

try {
  for (const width of [1440, 390]) {
    for (const [name, q, ready, root] of PAGES) {
      if (name.startsWith('settings') && width === 390) continue;
      const ctx = await h.context(width, { height: width < 900 ? 844 : 1000 });
      const page = await ctx.newPage(); page.setDefaultTimeout(40000);
      const errs = []; page.on('pageerror', e => errs.push(e.message.split('\n')[0]));
      await page.goto(`${h.BASE}/?business=${B}&${q}`);
      await page.waitForSelector(ready); await page.waitForTimeout(6000);
      if (WHEN === 'after') {
        // the weekly read takes seconds on real rows: wait for the member rows, then show them
        if (name === 'email') await page.waitForSelector('[data-by-member] [data-member-row]', { timeout: 60000 });
        if (name === 'scorecard' && width === 1440) { await page.locator('[data-row="delivered"] [data-expand]').click(); await page.waitForSelector('[data-member-of="delivered"]'); }
        if (name === 'scorecard' && width === 390) await page.waitForSelector('[data-member-line]', { timeout: 60000 });
        if (name.startsWith('settings')) await page.locator('[data-mailbox-map]').scrollIntoViewIfNeeded();
        await page.waitForTimeout(800);
      }
      // Leaves that hold an address are masked in the PNG (and counted): no address reaches a picture.
      const marked = await page.evaluate(() => { let n = 0; for (const el of document.querySelectorAll('body *')) { if (el.children.length === 0 && /\S+@\S+\.[a-z]{2,}/i.test(`${el.textContent || ''} ${el.getAttribute('placeholder') || ''}`)) { el.setAttribute('data-shot-mask', ''); n += 1; } } return n; });
      await page.screenshot({ path: path.join(OUT, `${name}-${width}-${WHEN}.png`), fullPage: true, animations: 'disabled', mask: [page.locator('[data-shot-mask]')] });
      if (WHEN === 'after') {
        await page.addScriptTag({ content: AXE });
        const r = await page.evaluate(async sel => ({ v: (await window.axe.run(document.querySelector(sel), { resultTypes: ['violations'] })).violations.map(x => `${x.id} (${x.nodes.length}) ${x.nodes[0]?.target?.join(' ')}`), n2: Math.max(0, document.documentElement.scrollWidth - window.innerWidth) }), root);
        ok(`${name} @ ${width}: axe ${r.v.length} · N2 ${r.n2} px · page errors ${errs.length} · address leaves masked ${marked}`, r.v.length === 0 && r.n2 === 0 && errs.length === 0, [...r.v, ...errs].join(' | '));
        if (name === 'email') {
          const who = await page.locator('[data-member-control] button').allTextContents();
          if (who.length > 1) { await page.locator('[data-member-control] button').nth(1).click(); await page.waitForSelector('[data-member-strip]'); await page.screenshot({ path: path.join(OUT, `email-member-${width}-after.png`), animations: 'disabled' }); }
          ok(`email @ ${width}: the control reads ${who.join(' · ') || '(none)'}; a member's strip drawn`, who.length > 1 && who[0] === 'Team');
        }
      } else ok(`${name} @ ${width}: ${name}-${width}-before.png · address leaves masked ${marked}`, true);
      await ctx.close();
    }
  }
  // The Friday email at 640, built from the local route's own body (nothing is sent).
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(h.owner.session.access_token)}`;
  const get = async p => (await fetch(`${h.BASE}/api/sales/${B}${p}`, { headers: { cookie } })).json();
  const mail = buildWeeklyEmail(await get(`/goals/weekly?weeks=12${WHEN === 'after' ? '&member=all' : ''}`));
  const ctx = await h.context(640, { height: 900 });
  const page = await ctx.newPage();
  await page.setContent(mail.html); await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `weekly-email-640-${WHEN}.png`), fullPage: true });
  ok(`weekly email @ 640: ${mail.rows} rows${mail.member_rows != null ? ` · By member ${mail.member_rows} rows` : ''} · no address in html or text`, !ADDRESS.test(mail.html.replace(/https?:\/\/\S+/g, '')) && !ADDRESS.test(mail.text), mail.subject);
  await ctx.close();
  ok(`non-GET aborted: ${h.blocked.length}`, true, [...new Set(h.blocked)].slice(0, 5).join(', '));
} catch (e) {
  ok('run', false, e.stack?.split('\n').slice(0, 3).join(' | '));
} finally {
  await h.close();
  const passed = checks.filter(Boolean).length;
  console.log(`\n${passed}/${checks.length} checks passed`);
  console.log('restored: yes (nothing written - every non-GET aborted in the browser; the sign-in row is kept by rule)');
  process.exit(passed === checks.length ? 0 : 1);
}

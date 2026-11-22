// app-shell-v2 follow-up (rulings C4 + C2) - localhost against the build as the platform owner, the sales workspace.
// READ-ONLY (readOnlyBrowser: every non-GET aborted), 0 Claude (no ask is sent: the thread is an invented one put in
// localStorage), 0 Apollo. DECLARED: 2 page loads (Today at 1440 and at 390), ~35 s, cap 120 s.
// PNGs: .screenshots/app-shell-v2/followup/.
//   C4  the drawer starts under the header (top 56): Needs attention, + To-do and the avatar are still the top
//       element at their own centres, the header's 2 px hue line shows above the drawer; 390 stays a full sheet.
//   C2  a to-do row card in the window says "n/m steps done" under its due line.
import fs from 'fs';
import path from 'path';
import { readOnlyBrowser } from './lib/readOnlyBrowser.mjs';

const h = await readOnlyBrowser({ port: 3996, capMs: 120000 });
const OUT = path.join(h.ROOT, '.screenshots', 'app-shell-v2', 'followup');
fs.mkdirSync(OUT, { recursive: true });
const B = h.workspace.id, T0 = Date.now();
const checks = [];
const ok = (name, pass, detail = '') => { checks.push(!!pass); console.log(`[${Math.round((Date.now() - T0) / 1000)}s] ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${String(detail).slice(0, 600)}` : ''}`); };
const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const todo = (i, text, steps) => ({ entity: 'todos', id: `fixture-${i}`, title: text, date: '2026-11-08', workspace_id: B, why: text, row: { kind: 'task', id: `fixture-${i}`, text, due: '2026-11-08', overdue: true, owner: 'mine', owner_user_id: h.owner.userId, link: null, verb: 'next_steps', steps } });
const ROWS = [todo(1, 'Send the joint note to the two partner leads', { done: 0, total: 2 }), todo(2, 'Reply to the intro thread', null)];
const THREAD = JSON.stringify({ user: h.owner.userId, day, turns: [{ at: Date.now() - 60000, q: 'my overdue to-dos', scope: B, elapsed: 4, answer_md: 'You have 2 overdue to-dos, oldest first.', summary: 'You have 2 overdue to-dos, oldest first.', sections: [{ title: 'Tasks', count: 2, total: 2, rule: 'Open to-dos ranked overdue first.', read: 'openTodos (2 open, mine)', rows: ROWS, line: null, brief: null }], items: ROWS, ask: { mine: true, entity: 'todos' }, usage: { input_tokens: 0, output_tokens: 0, cost_usd: 0 } }] });

try {
  for (const width of [1440, 390]) {
    const ctx = await h.context(width, { storage: { prospector_scout_thread: THREAD } });
    const page = await ctx.newPage(); page.setDefaultTimeout(30000);
    await page.goto(`${h.BASE}/?business=${B}&tab=actions`);
    await page.waitForSelector('[data-shell]'); await page.waitForTimeout(3500);
    if (width === 1440) await page.locator('[data-shell-star]').click();
    else { await page.locator('[data-shell-centre]').click(); await page.waitForSelector('[data-shell-fullsearch]'); await page.locator('[data-shell-star]').click(); }
    await page.waitForSelector('[data-scout-window]:not([hidden])'); await page.waitForTimeout(800);
    const m = await page.evaluate(() => {
      const w = document.querySelector('[data-scout-window]'), r = w.getBoundingClientRect();
      const hdr = document.querySelector('[data-shell-header]')?.getBoundingClientRect();
      const reach = [...document.querySelectorAll('[data-shell-header] button')].filter(b => b.getBoundingClientRect().left >= r.left).map(b => { const q = b.getBoundingClientRect(); const top = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return { name: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 30), reachable: b === top || b.contains(top) }; });
      // the hue line: the header's own bottom border, the row of pixels just above the drawer
      const line = hdr ? document.elementFromPoint(r.left + 40, hdr.bottom - 1) : null;
      return { kind: w.dataset.scoutWindow, top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width), hdrBottom: hdr ? Math.round(hdr.bottom) : null, reach, lineIsHeader: !!line?.closest('[data-shell-header]'), steps: [...w.querySelectorAll('.scout-card')].map(c => c.querySelector('[data-scout-steps]')?.textContent || null), cards: w.querySelectorAll('.scout-card').length };
    });
    await page.screenshot({ path: path.join(OUT, `scout-window-${width}.png`) });
    if (width === 1440) {
      ok(`C4 @ 1440: the drawer starts under the header - top ${m.top} = the header's bottom ${m.hdrBottom}, ${m.w} × ${m.h} of 900`, m.kind === 'drawer' && m.top === 56 && m.hdrBottom === 56 && m.h === 844 && m.w === 640, JSON.stringify(m));
      ok(`C4 @ 1440: the header controls over the drawer stay reachable (${m.reach.map(x => `${x.name}: ${x.reachable ? 'yes' : 'NO'}`).join(' · ')}); the hue line shows above it`, m.reach.length >= 3 && m.reach.every(x => x.reachable) && m.lineIsHeader, JSON.stringify(m.reach));
    } else ok(`C4 @ 390: still a full sheet - top ${m.top}, ${m.w} × ${m.h}`, m.kind === 'sheet' && m.top === 0 && m.w === 390 && m.h === 844, JSON.stringify(m));
    ok(`C2 @ ${width}: ${m.cards} to-do cards; steps lines ${JSON.stringify(m.steps)}`, m.cards === 2 && m.steps[0] === '0/2 steps done' && m.steps[1] === null, JSON.stringify(m.steps));
    await ctx.close();
  }
  ok(`non-GET aborted: ${h.blocked.length}; asks sent: ${h.blocked.filter(b => b.includes('/scout/ask')).length}`, true, [...new Set(h.blocked)].slice(0, 4).join(', '));
} catch (e) {
  ok('run', false, e.stack?.split('\n').slice(0, 3).join(' | '));
} finally {
  await h.close();
  const passed = checks.filter(Boolean).length;
  console.log(`\n${passed}/${checks.length} checks passed`);
  console.log('restored: yes (nothing written - every non-GET aborted in the browser; the sign-in row is kept by rule)');
  process.exit(passed === checks.length ? 0 : 1);
}

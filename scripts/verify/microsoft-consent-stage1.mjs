// FIX microsoft-consent Stage 1 - the Microsoft card's four states on localhost as the platform owner, the sales
// workspace: connected · needs admin · other org · expired. The /api/microsoft/status answer is a browser-side STAND-IN
// (the shapes api/microsoft/status.js statusBody() builds, made-up values, no real grant read): this proves what the
// card DRAWS for each state, not that Microsoft answers that way. Local has no MICROSOFT_* env, so no connect runs.
// READ-ONLY: 0 Graph, 0 Apollo, 0 Claude, 0 writes (every non-GET is aborted in the browser; the sign-in row is kept
// by rule, last_seen_at restored). Per state: the words, the facts line, no "@" on the card, axe 0 on the card, a PNG.
// DECLARED: 1 page load + 4 status re-reads; est. 60 s; cap 230 s. PNGs: .screenshots/microsoft-consent/stage1/.
// Usage: node scripts/verify/microsoft-consent-stage1.mjs   (after npm run build - the local server serves build/)
import fs from 'fs';
import path from 'path';
import { readOnlyBrowser } from './lib/readOnlyBrowser.mjs';

const h = await readOnlyBrowser({ port: 3996, capMs: 230000 });
const OUT = path.join(h.ROOT, '.screenshots', 'microsoft-consent', 'stage1');
fs.mkdirSync(OUT, { recursive: true });
const AXE = fs.readFileSync(path.join(h.ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const T0 = Date.now();
const checks = [];
const ok = (name, pass, detail = '') => { checks.push(!!pass); console.log(`[${Math.round((Date.now() - T0) / 1000)}s] ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${String(detail).slice(0, 400)}` : ''}`); };

const READS = ['Calendars.Read', 'Mail.Read', 'openid', 'User.Read'];
const base = {
  configured: true, connected: true, email: 'stand.in@example.com', domain: 'example.com', organization: '…d36f', scopes: READS,
  connected_at: '2026-11-24T17:57:00Z', last_used_at: '2026-11-24T17:58:00Z', error: null, problem: null, last_refresh: { ok: true, at: '2026-11-24T17:58:00Z' },
  is_owner: true, can_send: false, team_email: 'Sending needs the owner\'s Mail.Send grant',
  admin_consent: { url: 'https://login.microsoftonline.com/stand-in/v2.0/adminconsent?client_id=stand-in', note: 'Please open this link signed in as a Microsoft 365 admin and click Accept.' },
};
const failed = { last_refresh: { ok: false, at: '2026-11-20T19:27:00Z' }, team_email: 'Sending needs the owner\'s Mail.Send grant' };
const STATES = [
  ['connected', base, { pill: 'Connected', words: null, enable: true }],
  ['needs-admin', { ...base, ...failed, error: 'Microsoft access needs admin approval for: Mail.Read, Calendars.Read - reconnect', problem: { family: 'needs_admin', text: 'needs admin approval for: Mail.Read, Calendars.Read' } }, { pill: 'Needs attention', words: /What is wrong: needs admin approval for: Mail\.Read, Calendars\.Read\. A Microsoft admin has to approve it once/, enable: false }],
  ['other-org', { ...base, organization: '…9a1c', problem: { family: 'other_org', text: 'this mailbox is in a different Microsoft organization than Prospector is registered to' } }, { pill: 'Connected', words: /different Microsoft organization than Prospector is registered to\. Reconnect with a mailbox in the organization/, enable: true }],
  ['expired', { ...base, ...failed, error: 'Microsoft access expired (90 days unused / revoked) - reconnect', problem: { family: 'expired', text: 'expired (90 days unused / revoked)' } }, { pill: 'Needs attention', words: /What is wrong: expired \(90 days unused \/ revoked\)\. Click Reconnect\./, enable: false }],
];

try {
  const ctx = await h.context(1440);
  let current = base;
  await ctx.route('**/api/microsoft/status', r => r.fulfill({ json: current }));
  await ctx.route('**/api/microsoft/sync-summary', r => r.fulfill({ json: { can_sync: false, sent: 0, received: 0, events: 0, since: null, last_synced_at: null, pending: [] } }));
  const page = await ctx.newPage(); page.setDefaultTimeout(30000);
  const errs = [];
  page.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  await page.goto(`${h.BASE}/?business=${h.workspace.id}`);
  await page.waitForSelector('[data-shell]');
  for (const [name, status, want] of STATES) {
    current = status;
    await page.locator('[data-nav-item=home]').click();
    await page.locator('[data-nav-item=settings]').click();
    await page.locator('[data-settings-item=connections]').click();
    const card = page.locator('[data-connections=feeds] [data-provider=microsoft]');
    await card.locator('[data-microsoft-facts]').waitFor();
    await page.waitForTimeout(400);
    if (!await page.evaluate(() => !!window.axe)) await page.addScriptTag({ content: AXE });
    const r = await page.evaluate(async () => {
      const el = document.querySelector('[data-connections=feeds] [data-provider=microsoft]');
      const v = (await window.axe.run({ include: [['[data-connections=feeds] [data-provider=microsoft]']] }, { resultTypes: ['violations'] })).violations.map(x => `${x.id} (${x.nodes.length}) ${x.nodes[0]?.target?.join(' ')}`);
      return {
        v, text: el.innerText, pill: el.querySelector('[data-status]')?.innerText.trim().split('\n').pop(), problem: el.querySelector('[data-microsoft-problem]')?.innerText || null,
        facts: el.querySelector('[data-microsoft-facts]').innerText.replace(/\s+/g, ' '), buttons: [...el.querySelectorAll('button')].map(b => b.innerText.trim()),
        over: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    ok(`${name}: pill "${want.pill}"`, r.pill === want.pill, r.pill);
    ok(`${name}: ${want.words ? 'says what is wrong in words' : 'no problem line'}`, want.words ? want.words.test(r.problem || '') : r.problem === null, r.problem);
    ok(`${name}: facts = domain · organization · scopes · connected · last refresh`, /Mailbox at example\.com/.test(r.facts) && new RegExp(`Organization ${status.organization}`).test(r.facts) && /Access: Calendars\.Read, Mail\.Read, User\.Read/.test(r.facts) && new RegExp(`Last refresh: ${status.last_refresh.ok ? 'ok' : 'failed'} Nov`).test(r.facts), r.facts);
    ok(`${name}: no address on the card`, !/@|stand\.in/.test(r.text));
    ok(`${name}: buttons - Reconnect, Check connection, Copy admin consent link${want.enable ? ', Enable team email sending' : ''}`, r.buttons.includes('Reconnect / switch account →') && r.buttons.includes('Check connection') && r.buttons.includes('Copy admin consent link') && r.buttons.includes('Enable team email sending →') === want.enable, r.buttons.join(' | '));
    ok(`${name}: axe 0 on the card · 0 px overflow`, r.v.length === 0 && r.over <= 0, JSON.stringify({ v: r.v, over: r.over }));
    await card.screenshot({ path: path.join(OUT, `${name}-1440.png`) });
  }
  ok('no page error', errs.length === 0, errs.join(' | '));
  ok('writes aborted in the browser: none attempted', h.blocked.length === 0, h.blocked.join(' | '));
} catch (e) {
  ok('run completed', false, e.message.split('\n')[0]);
} finally {
  await h.close();
}
console.log(`\n${checks.filter(Boolean).length}/${checks.length} checks · PNGs in ${OUT}`);
process.exit(checks.every(Boolean) ? 0 : 1);

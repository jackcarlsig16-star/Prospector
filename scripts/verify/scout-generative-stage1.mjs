// FIX scout-generative Stage 1 (+ E-5) - the live pass on localhost (the real routes over the real sales workspace) as
// the platform owner. Names, to-do texts, company names and counts only - no address is printed.
// DECLARED before it runs:
//   CLAUDE: at most 3 asks (POST /api/scout/ask), about $0.01-0.03 each: "what's on the agenda for next week",
//     "catch me up", "how is Cyrus's open rate trending" (E-5's proof). Every spent ask is kept in a ledger
//     (.screenshots/scout-generative/stage1-ledger.json) so a re-run NEVER repeats a paid call. Each ask writes its
//     own business_anthropic_usage row (the cap's counter - kept).
//   READS: GET goals/today?owner=me x1, GET goals/weekly x1, GET goals/weekly?member=all x1 to compare against.
//   APOLLO 0. No other write: the browser is readOnlyBrowser (every non-GET aborted) and shows the agenda answer
//     REPLAYED from the ledger. 2 page loads (1440, 390). ~70 s, cap 220 s.
//   The numbers in the Cyrus answer are also read by hand against goals/weekly and written into the ledger as
//     verdict right | wrong - a re-run fails on anything but "right".
//   Usage: node scripts/verify/scout-generative-stage1.mjs [--no-ask]
import fs from 'fs';
import path from 'path';
import { readOnlyBrowser } from './lib/readOnlyBrowser.mjs';

const NO_ASK = process.argv.includes('--no-ask');
const h = await readOnlyBrowser({ port: 3996, capMs: 220000 });
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const { addDays, laMonday } = await import('../../api/sales/goalsShared.js');
const B = h.workspace.id, T0 = Date.now();
const OUT = path.join(h.ROOT, '.screenshots', 'scout-generative');
fs.mkdirSync(OUT, { recursive: true });
const LEDGER = path.join(OUT, 'stage1-ledger.json');
const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : { asks: [] };
const AXE = fs.readFileSync(path.join(h.ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const checks = [];
const ok = (name, pass, detail = '') => { checks.push(!!pass); console.log(`[${Math.round((Date.now() - T0) / 1000)}s] ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${String(detail).slice(0, 900)}` : ''}`); };
const cookie = `${SESSION_COOKIE}=${encodeURIComponent(h.owner.session.access_token)}`;
const call = async (p, method = 'GET', body = null) => { const r = await fetch(`${h.BASE}${p}`, { method, headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
const sales = p => call(`/api/sales/${B}/goals${p}`);
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const CAP = 3;
let sent = 0;
// One ask, once: the ledger answers a re-run.
async function askOnce(q) {
  const kept = ledger.asks.find(a => a.q === q);
  if (kept) return kept;
  if (NO_ASK || ledger.asks.length + 0 >= CAP) return null;
  const at = Date.now();
  const r = await call('/api/scout/ask', 'POST', { q, scope: B });
  sent += 1;
  const row = { q, at: new Date(at).toISOString(), day: today, status: r.status, elapsed: Math.round((Date.now() - at) / 1000), intent: r.body?.context_stats?.intent || null, reads: r.body?.context_stats?.reads || [], cost: r.body?.usage?.cost_usd ?? null, tokens: r.body?.usage ? `${r.body.usage.input_tokens} in / ${r.body.usage.output_tokens} out` : null,
    summary: r.body?.summary || r.body?.answer_md || r.body?.error || null, answer_md: r.body?.answer_md || null, sections: r.body?.sections || [], items: r.body?.items || [], unverified: r.body?.unverified || [], try: r.body?.try || [], withheld: !!r.body?.withheld, usage: r.body?.usage || null, cap: r.body?.cap || null, verdict: null };
  ledger.asks.push(row); fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
  return row;
}
const words = t => String(t || '').split(/\s+/).filter(Boolean).length;
const SHRUG = /nothing in (?:it|the context|those|that) answers|no specific read matched|I (?:can't|cannot) answer/i;
const JUDGEMENT = /(?:^|\n|\. )\s*(?:[-*•]\s*)?(?:\*\*)?(?:I'd|Suggestion:)/;
const pct = v => `${(100 * v).toFixed(1)}`;

try {
  // ── 1. the agenda for next week
  const a1 = await askOnce("what's on the agenda for next week");
  if (!a1) ok('ask 1 (agenda): not in the ledger and --no-ask', false);
  else {
    const mon = addDays(laMonday(a1.day), 7), sun = addDays(mon, 6);
    const t = await sales('/today?owner=me');
    const rows = (t.body?.groups || []).flatMap(g => g.rows);
    const dueNext = rows.filter(r => r.kind === 'todo' && r.due && String(r.due).slice(0, 10) >= mon && String(r.due).slice(0, 10) <= sun);
    const sec = title => a1.sections.find(s => s.title === title) || null;
    const titles = a1.sections.map(s => s.title);
    ok(`ask 1 "${a1.q}": ${a1.status} · intent ${a1.intent} · ${a1.tokens} · $${a1.cost} · ${a1.elapsed} s · reads: ${a1.reads.join(' | ')}`, a1.status === 200 && a1.intent === 'agenda' && !a1.withheld && a1.reads.some(r => /no calendar read/.test(r)));
    ok(`ask 1 sections, in order: ${a1.sections.map(s => `${s.title} ${s.count}${s.total > s.count ? ` of ${s.total}` : ''}`).join(' · ')}`, JSON.stringify(titles) === JSON.stringify(['Due', "This week's five", 'Pinned and P1', 'Goals', 'Calls to review', 'Replies owed'].filter(x => titles.includes(x))) && titles.includes('Goals') && titles.includes('Pinned and P1'));
    ok(`ask 1 Due = goals/today's own count for ${mon} to ${sun}: ${sec('Due')?.total ?? 0} in the answer, ${dueNext.length} on Today${a1.day !== today ? ` (the ask ran ${a1.day}; Today is read now)` : ''}`, a1.day !== today || (sec('Due')?.total ?? 0) === dueNext.length);
    const w = await sales('/weekly?weeks=12');
    const withGoal = (w.body?.metrics || []).filter(x => !x.context && (x.this_week.goal != null || x.next_week?.goal != null));
    ok(`ask 1 Goals = goals/weekly's rows with a typed goal this week or next: ${sec('Goals')?.rows.filter(r => r.id !== 'agenda:none').length} in the answer, ${withGoal.length} on the route (${withGoal.map(x => `${x.name}: this week ${x.this_week.goal ?? 'none'}, next ${x.next_week?.goal ?? 'none'}`).join(' · ') || 'none typed'})`, (sec('Goals')?.rows.filter(r => r.id !== 'agenda:none').length ?? 0) === withGoal.length);
    const days = (a1.summary.match(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/g) || []);
    ok(`ask 1 is a synthesis: ${words(a1.summary)} words, a plan by day (${[...new Set(days)].join(', ') || 'by theme'}), a goals line, a marked judgement, meetings said to be missing; not a shrug`, words(a1.summary) >= 40 && !SHRUG.test(a1.summary) && /goal/i.test(a1.summary) && JUDGEMENT.test(a1.summary) && /meeting|calendar/i.test(a1.summary));
    ok(`ask 1 never-invent guard: ${a1.unverified.length ? `flagged ${a1.unverified.join(', ')}` : 'every number in the answer is in what was read'}`, a1.unverified.length === 0);
    console.log(`\n--- ask 1 answer (names and to-do texts)\n${a1.summary}\n---\n`);
  }

  // ── 2. catch me up
  const a2 = await askOnce('catch me up');
  if (!a2) ok('ask 2 (catch me up): not in the ledger and --no-ask', false);
  else {
    ok(`ask 2 "${a2.q}": ${a2.status} · intent ${a2.intent} · ${a2.tokens} · $${a2.cost} · ${a2.elapsed} s`, a2.status === 200 && !a2.withheld && ['agenda', 'none'].includes(a2.intent));
    ok(`ask 2 is an answer, not a shrug: ${words(a2.summary)} words, ${a2.sections.reduce((n, s) => n + s.rows.length, 0)} rows in ${a2.sections.length} section${a2.sections.length === 1 ? '' : 's'}; a marked judgement; guard ${a2.unverified.length ? `flagged ${a2.unverified.join(', ')}` : 'clean'}`, words(a2.summary) >= 25 && !SHRUG.test(a2.summary) && JUDGEMENT.test(a2.summary) && a2.unverified.length === 0);
    console.log(`\n--- ask 2 answer\n${a2.summary}\n---\n`);
  }

  // ── 3. E-5: Cyrus's open rate
  const a3 = await askOnce("how is Cyrus's open rate trending");
  if (!a3) ok('ask 3 (E-5): not in the ledger and --no-ask', false);
  else {
    const all = await sales('/weekly?weeks=12&member=all');
    const cy = (all.body?.rows || []).find(r => /^cyrus/i.test(r.name));
    const m = cy?.metrics.find(x => x.key === 'human_open_rate');
    const series = m ? [...m.series].sort((p, q) => String(q.week_start).localeCompare(String(p.week_start))) : [];
    const facts = series.map(s => `${s.week_start}${s.current ? ' (this week)' : ''}: ${s.value == null ? 'no emails delivered' : `${pct(s.value)} %`}`);
    console.log(`      goals/weekly?member=all · Cyrus · Human open rate, newest first: ${facts.join(' · ')}`);
    ok(`ask 3 "${a3.q}": ${a3.status} · intent ${a3.intent} · ${a3.tokens} · $${a3.cost}`, a3.status === 200 && a3.intent === 'member_emails' && !a3.withheld);
    // every percentage in the answer is one of the route's weekly values (or a delta the line carries); the sentence
    // that says "this week" holds this week's value - or says there is none
    const cur = series.find(s => s.current);
    const said = a3.day === today ? (a3.summary.match(/[^.\n]*\bthis week\b[^.\n]*/gi) || []) : [];
    const curWord = cur?.value == null ? /no emails? (?:delivered|sent)|none|nothing|no data|no number|not? .*delivered/i : new RegExp(pct(cur.value).replace('.', '\\.'));
    const wrongNow = said.filter(s => /\d+(?:\.\d+)?\s?%/.test(s) && !(cur?.value != null && s.includes(pct(cur.value))) && !/last week|earlier|prior|previous|before|ago|week of|[A-Z][a-z]{2} \d/.test(s));
    ok(`ask 3 "this week" is this week's own value (${cur ? (cur.value == null ? 'no emails delivered' : `${pct(cur.value)} %`) : 'unknown'}): ${said.length} sentence${said.length === 1 ? '' : 's'} say "this week", ${wrongNow.length} put another week's rate there; guard ${a3.unverified.length ? `flagged ${a3.unverified.join(', ')}` : 'clean'}`, !!m && wrongNow.length === 0 && (said.length === 0 || said.some(s => curWord.test(s))) && a3.unverified.length === 0, wrongNow.join(' | '));
    ok(`ask 3 verdict (read by hand against the line above): ${a3.verdict || 'NOT READ YET - read the answer below, then set "verdict" in the ledger'}`, a3.verdict === 'right');
    console.log(`\n--- ask 3 answer\n${a3.summary}\n---\n`);
  }
  ok(`Claude: ${sent} ask${sent === 1 ? '' : 's'} sent by this run, ${ledger.asks.length} in the ledger (cap ${CAP}); total $${ledger.asks.reduce((n, a) => n + (a.cost || 0), 0).toFixed(4)}`, ledger.asks.length <= CAP);

  // ── the agenda answer on screen, replayed from the ledger (no ask)
  const a = ledger.asks.find(x => x.intent === 'agenda' && x.sections.length > 1);
  if (a) {
    const THREAD = JSON.stringify({ user: h.owner.userId, day: today, turns: [{ at: Date.now() - 60000, q: a.q, scope: B, elapsed: a.elapsed, answer_md: a.answer_md, summary: a.summary, sections: a.sections, items: a.items, ask: {}, usage: a.usage, cap: a.cap, context_stats: { reads: a.reads, rows_by_entity: {} } }] });
    for (const width of [1440, 390]) {
      const ctx = await h.context(width, { storage: { prospector_scout_thread: THREAD } });
      const page = await ctx.newPage(); page.setDefaultTimeout(30000);
      await page.goto(`${h.BASE}/?business=${B}&tab=actions`);
      await page.waitForSelector('[data-shell]'); await page.waitForTimeout(3500);
      if (width === 1440) await page.locator('[data-shell-star]').click();
      else { await page.locator('[data-shell-centre]').click(); await page.waitForSelector('[data-shell-fullsearch]'); await page.locator('[data-shell-star]').click(); }
      await page.waitForSelector('[data-scout-window]:not([hidden])'); await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(OUT, `agenda-${width}.png`) });
      await page.addScriptTag({ content: AXE });
      const m = await page.evaluate(async () => {
        const w = document.querySelector('[data-scout-window]');
        const v = (await window.axe.run({ include: [['[data-scout-window]']] }, { resultTypes: ['violations'] })).violations.map(x => `${x.id} (${x.nodes.length}) ${x.nodes[0]?.target?.join(' ')}`);
        return { titles: [...w.querySelectorAll('.scout-section__title')].map(x => x.textContent), prose: (w.querySelector('[data-scout-prose]')?.textContent || '').length, verbs: w.querySelectorAll('[data-scout-verb]').length, v, n2: document.documentElement.scrollWidth - window.innerWidth, inner: w.scrollWidth - w.clientWidth };
      });
      ok(`the agenda answer @ ${width}: the synthesis (${m.prose} chars) above ${m.titles.length} sections (${m.titles.join(' · ')}), ${m.verbs} verb buttons; axe 0 · 0 px`, m.prose > 100 && m.titles.length === a.sections.length && m.v.length === 0 && m.n2 <= 0 && m.inner <= 0, JSON.stringify({ v: m.v, n2: m.n2, inner: m.inner }));
      await ctx.close();
    }
  } else ok('the agenda answer on screen: no agenda answer in the ledger', false);
  ok(`the browser sent no ask and wrote nothing (non-GET aborted: ${h.blocked.length})`, !h.blocked.some(b => b.includes('/scout/ask')));
} catch (e) {
  ok('run', false, e.stack?.split('\n').slice(0, 3).join(' | '));
} finally {
  await h.close();
  const passed = checks.filter(Boolean).length;
  console.log(`\n${passed}/${checks.length} checks passed`);
  console.log("restored: yes (no row written but each ask's own business_anthropic_usage cost row, declared and kept; the sign-in row is kept by rule)");
  process.exit(passed === checks.length ? 0 : 1);
}

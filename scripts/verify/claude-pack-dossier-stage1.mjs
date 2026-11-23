// FIX claude-pack-dossier Stage 1 - the live pass on localhost (the real routes over the real sales workspace) as the
// platform owner. Names, titles, counts and section heads only - no address is printed, no draft body is printed.
// DECLARED before it runs:
//   READS: 3 name lookups for Flowserve (one per record table), GET goals/company x1, GET goals/copy-bundle x3
//     (default, full, a person first), GET goals/brief x1, GET goals/people/activity x1, one web_visits row.
//   CLAUDE: at most 1 - POST goals/compose/:type/:id (one first-email draft to Flowserve), about $0.01-0.02. The draft
//     is kept in a ledger (.screenshots/claude-pack-dossier/stage1-ledger.json) so a re-run never repeats the paid
//     call. It writes its one business_anthropic_usage row (the cost row - kept, that is the cap's own counter).
//   APOLLO 0. No other write: the browser is readOnlyBrowser (every non-GET aborted); the Scout answer on screen is a
//     REPLAYED thread built from the real People read (an ask would be a second Claude call - over this FIX's cap).
//   2 page loads (1440, 390). ~60 s, cap 200 s.
//   Usage: node scripts/verify/claude-pack-dossier-stage1.mjs [--no-draft] [--before]   (--before: PNGs only)
import fs from 'fs';
import path from 'path';
import { readOnlyBrowser } from './lib/readOnlyBrowser.mjs';

const BEFORE = process.argv.includes('--before'), NO_DRAFT = process.argv.includes('--no-draft') || BEFORE;
const TAG = BEFORE ? 'before' : 'after';
const h = await readOnlyBrowser({ port: 3996, capMs: 200000 });
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const B = h.workspace.id, T0 = Date.now();
const OUT = path.join(process.env.DOSSIER_OUT || path.join(h.ROOT, '.screenshots', 'claude-pack-dossier'));
fs.mkdirSync(OUT, { recursive: true });
const LEDGER = path.join(OUT, 'stage1-ledger.json');
const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : { drafts: [] };
const AXE = fs.readFileSync(path.join(h.ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const checks = [];
const ok = (name, pass, detail = '') => { checks.push(!!pass); console.log(`[${Math.round((Date.now() - T0) / 1000)}s] ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${String(detail).slice(0, 700)}` : ''}`); };
const cookie = `${SESSION_COOKIE}=${encodeURIComponent(h.owner.session.access_token)}`;
const call = async (p, method = 'GET', body = null) => { const r = await fetch(`${h.BASE}${p}`, { method, headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
const sales = (p, method, body) => call(`/api/sales/${B}/goals${p}`, method, body);
const HEADS = ['## Company', '## Why now', '## People', '## Calls', '## Intel', '## History', '## Open to-dos', '## Research', '## About us', '## Ask'];
const headsOf = md => (md.match(/^## .*$/gm) || []).map(x => x.replace(/ \(\d+\)$/, ''));
const countOf = (md, head) => Number(new RegExp(`^${head} \\((\\d+)\\)$`, 'm').exec(md)?.[1] ?? -1);
const LINKEDIN = /https:\/\/www\.linkedin\.com\/in\/[A-Za-z0-9_%.~-]+/g;
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

try {
  // ── the record
  const finds = await Promise.all([['employer', 'sales_opportunities', 'organization'], ['target', 'sales_targets', 'name'], ['partner', 'sales_goals', 'name']].map(async ([type, table, col]) => {
    const { data } = await h.svc.from(table).select(`id, ${col}`).eq('business_id', B).ilike(col, '%flowserve%').limit(3);
    return (data || []).map(r => ({ type, id: r.id, name: r[col] }));
  }));
  const rec = finds.flat()[0];
  ok(`Flowserve is a record: ${finds.flat().map(r => `${r.name} (${r.type})`).join(' · ') || 'none'}`, !!rec);
  if (!rec) throw new Error('no Flowserve record - nothing to verify against');
  const q = `type=${rec.type}&id=${rec.id}`;

  const pack = await sales(`/copy-bundle?${q}`);
  const md = pack.body?.markdown || '';
  // the pack's first screen, as text (names, titles and LinkedIn links only - checked below before it is drawn)
  const shot = async (name, text) => { const ctx = await h.context(1440); const page = await ctx.newPage(); await page.setContent(`<body style="margin:0;background:#12161B"><pre style="margin:0;padding:24px;color:#D7DCE3;font:13px/1.55 ui-monospace,Menlo,monospace;white-space:pre-wrap;width:1100px">${esc(text.split('\n').slice(0, 46).join('\n'))}</pre></body>`); await page.screenshot({ path: path.join(OUT, name) }); await ctx.close(); };
  if (pack.status === 200 && !md.includes('@')) await shot(`pack-first-screen-${TAG}.png`, md);

  if (!BEFORE) {
    const detail = await sales(`/company?${q}`);
    const people = detail.body?.people || [];
    const { data: visit } = await h.svc.from('web_visits').select('visits_7d, unique_visitors_7d, pulled_on').eq('business_id', B).eq('matched_type', rec.type).eq('matched_id', rec.id).order('pulled_on', { ascending: false }).limit(1);
    ok(`P1 goals/copy-bundle ${pack.status}: the sections in order (${headsOf(md).map(x => x.slice(3)).join(' · ')})`, pack.status === 200 && JSON.stringify(headsOf(md)) === JSON.stringify(HEADS), pack.body?.error);
    ok(`P1 People (${countOf(md, '## People')}) = goals/company's people (${people.length}); Calls (${countOf(md, '## Calls')}); History (${countOf(md, '## History')})`, countOf(md, '## People') === people.length);
    const links = md.match(LINKEDIN) || [], stored = people.filter(p => /linkedin\.com\/in\//i.test(p.linkedin_url || '')).length;
    const sentLines = (md.match(/^ {2}- sent /gm) || []).length;
    ok(`P1 LinkedIn links in the pack ${links.length} of ${stored} stored /in/ links on those people (cut lines ${pack.body.cut}); "what we sent → what they did" lines ${sentLines}`, links.length <= stored && (pack.body.cut > 0 || links.length === stored));
    const v = visit?.[0] || null;
    const line = /^- Visits \(page loads\), 7 d to [^:]*: (\d+)(?: · distinct visitors: (\d+))?/m.exec(md);
    ok(`P1 Why now: visits ${line?.[1] ?? '—'} / distinct visitors ${line?.[2] ?? '—'} = web_visits' latest row (${v ? `${v.visits_7d} / ${v.unique_visitors_7d}` : 'no row'})`, v ? Number(line?.[1]) === v.visits_7d && (v.unique_visitors_7d == null || Number(line?.[2]) === v.unique_visitors_7d) : /No site visits on record/.test(md));
    ok('P1 About us says "(no company context yet)" - company-context-v1 has not shipped; the pack ends with ## Ask', /## About us\n\(no company context yet\)\n\n## Ask\n$/.test(md));
    ok(`P1 no "@" and no phone shape outside a LinkedIn link; the route's count is the real one (${pack.body.chars.toLocaleString('en-US')} chars)`, !md.includes('@') && pack.body.chars === md.length);
    const full = await sales(`/copy-bundle?${q}&full=1`);
    ok(`P2 default ${pack.body.chars.toLocaleString('en-US')} chars (cap 12,000, ${pack.body.cut} cut) · Full ${full.body?.chars?.toLocaleString('en-US')} chars (cap 40,000, ${full.body?.cut} cut)`, pack.body.chars <= 12000 && full.status === 200 && full.body.chars >= pack.body.chars && full.body.chars <= 40000 && (pack.body.cut === 0 || full.body.cut < pack.body.cut));
    const lead = people.find(p => p.person_key && people.indexOf(p) > 0) || people.find(p => p.person_key);
    if (lead) {
      const first = await sales(`/copy-bundle?${q}&person=${encodeURIComponent(lead.person_key)}`);
      const top = (first.body?.markdown || '').split(/^## People \(\d+\)\n/m)[1]?.split('\n')[0] || '';
      ok(`P4 a person's copy = the company dossier with that person first (${lead.name}${lead.title ? `, ${lead.title}` : ''})`, first.status === 200 && top.startsWith(`- ${lead.name}`) && top.includes('(the person this copy is about)'), top.slice(0, 160));
    } else ok('P4 person first: Flowserve has no stored person with a key - not exercised here (node test covers it)', true);

    // ── P3: the Brief's units, then ONE draft
    const brief = await sales(`/brief/${rec.type}/${rec.id}`);
    const lines = brief.body?.lines || [];
    const visits = /^visits \(page loads\) in 7 d: ([\d,]+)/.exec(lines.find(l => /^visits \(page loads\)/.test(l.text))?.text || '')?.[1] || null;
    const visitors = /^distinct visitors in 7 d: ([\d,]+)/.exec(lines.find(l => /^distinct visitors/.test(l.text))?.text || '')?.[1] || null;
    const research = lines.filter(l => l.kind === 'research' && /: /.test(l.text) && !/^Researched |^Not researched/.test(l.text));
    ok(`P3 the Brief: "visits (page loads) in 7 d: ${visits ?? '—'}" and "distinct visitors in 7 d: ${visitors ?? '—'}" are separate lines; ${research.filter(l => l.text.includes('(research — context, not a claim)')).length} of ${research.length} research lines carry the mark`, (visits == null || !lines.some(l => /visits \(page loads\)/.test(l.text) && /visitors/.test(l.text))) && research.every(l => l.text.includes('(research — context, not a claim)')));

    let d = ledger.drafts.find(x => x.id === rec.id) || null;
    if (!d && !NO_DRAFT) {
      const r = await sales(`/compose/${rec.type}/${rec.id}`, 'POST', {});
      if (r.status === 200) { d = { id: rec.id, at: new Date().toISOString(), subject: r.body.draft.subject, body: r.body.draft.body, lint: r.body.lint, cost_usd: r.body.cost_usd, cap: r.body.cap, visits, visitors }; ledger.drafts.push(d); fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2)); }
      else ok(`P3 the draft: goals/compose ${r.status}`, false, r.body?.error);
    }
    if (d) {
      const n = d.visits, text = `${d.subject}\n${d.body}`;
      const asPeople = n ? new RegExp(`(?<![\\d,.])${n}\\s+(?!(?:visits?|page|times|sessions?)\\b)(?:[\\w'-]+\\s+){0,2}(?:employees|people|staff|team members|colleagues)\\b`, 'i').test(text) : false;
      const saysVisits = n ? new RegExp(`(?<![\\d,.])${n}\\s+(?:\\w+\\s+)?(?:visits?|page loads|times)\\b`, 'i').test(text) : null;
      const rules = (d.lint?.issues || []).map(i => i.rule);
      ok(`P3 ONE draft to Flowserve (Claude 1 · $${d.cost_usd} · Write email ${d.cap?.used} of ${d.cap?.max} today · ${ledger.drafts.length} in the ledger): lint ${d.lint?.ok ? 'passes' : `issues [${rules.join(', ')}]`}; the visits number ${n ?? '(none in the Brief)'} ${saysVisits ? 'is written as visits' : saysVisits === false ? 'is not in the draft' : 'n/a'}; never paired with a people word`, !asPeople && !rules.includes('visits_as_people') && !rules.includes('research_number') && !d.body.includes('@'), rules.join(', '));
      if (saysVisits === false) console.log(`      note: the draft does not cite the visits number at all - the "must say visits" case is proven by lint on the fixture, not by this draft`);
    } else if (NO_DRAFT) console.log('      --no-draft: no draft in the ledger, the paid call was not made');
  }

  // ── a record whose people came from Apollo (LinkedIn links, emails sent) - read-only, the same route
  if (!BEFORE) {
    const { data: linked } = await h.svc.from('sales_prospect_state').select('opportunity_id, goal_id').eq('business_id', B).or('opportunity_id.not.is.null,goal_id.not.is.null').limit(1000);
    const tally = new Map(); for (const p of linked || []) { const k = p.opportunity_id ? `employer:${p.opportunity_id}` : `partner:${p.goal_id}`; tally.set(k, (tally.get(k) || 0) + 1); }
    const [busiest, n] = [...tally].sort((a, b) => b[1] - a[1])[0] || [];
    if (busiest) {
      const [type, id] = busiest.split(':');
      const r = await sales(`/copy-bundle?type=${type}&id=${id}`), md2 = r.body?.markdown || '';
      const links2 = (md2.match(LINKEDIN) || []).length, sent2 = (md2.match(/^ {2}- sent /gm) || []).length;
      ok(`P1 a record with ${n} sequenced people (${type}; name not printed): People (${countOf(md2, '## People')}), ${links2} LinkedIn links, ${sent2} "sent → what they did" lines, ${r.body?.chars?.toLocaleString('en-US')} chars, ${r.body?.cut} cut; no "@"`, r.status === 200 && links2 > 0 && sent2 > 0 && !md2.includes('@') && r.body.chars <= 12000, r.body?.error);
    } else ok('P1 no record has sequenced people linked - LinkedIn / sent lines are proven by the node test only', true);
  }

  // ── Scout rows: a replayed thread of the real hottest people (no ask sent)
  const act = await sales('/people/activity?window=7');
  const hot = (act.body?.rows || []).filter(r => r.heat != null && r.company?.id).slice(0, 4);
  const ROWS = hot.map(p => ({ entity: 'people', id: p.key, title: p.name, score: p.heat, workspace_id: B, why: p.name, open: { page: 'sales', params: { tab: 'pipeline', view: 'people', open: `person:${p.key}` } },
    row: { kind: 'person', key: p.key, name: p.name, title: p.title, company: { entity: `${p.company.type}s`, type: p.company.type, id: p.company.id, name: p.company.name, stage: p.company.stage }, heat: p.heat, heat_band: p.heat_band, last_visit: p.visits?.last_visit || null, last_path: p.visits?.top_page || null, last_email: p.last_email || null, status: p.status } }));
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const THREAD = JSON.stringify({ user: h.owner.userId, day, turns: [{ at: Date.now() - 60000, q: 'hot people visiting', scope: B, elapsed: 5, answer_md: `The ${ROWS.length} hottest people in the last 7 days (replayed from the People read).`, summary: `The ${ROWS.length} hottest people in the last 7 days (replayed from the People read).`, sections: [{ title: 'People', count: ROWS.length, total: ROWS.length, rule: 'People ranked by heat, hottest first.', read: 'goals/people/activity (7 d)', rows: ROWS, line: null, brief: null }], items: ROWS, ask: { entity: 'people', sort: 'heat' }, usage: { input_tokens: 0, output_tokens: 0, cost_usd: 0 } }] });
  for (const width of [1440, 390]) {
    const ctx = await h.context(width, { storage: { prospector_scout_thread: THREAD } });
    const page = await ctx.newPage(); page.setDefaultTimeout(30000);
    await page.goto(`${h.BASE}/?business=${B}&tab=actions`);
    await page.waitForSelector('[data-shell]'); await page.waitForTimeout(3500);
    if (width === 1440) await page.locator('[data-shell-star]').click();
    else { await page.locator('[data-shell-centre]').click(); await page.waitForSelector('[data-shell-fullsearch]'); await page.locator('[data-shell-star]').click(); }
    await page.waitForSelector('[data-scout-window]:not([hidden])'); await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, `scout-answer-${width}-${TAG}.png`) });
    if (BEFORE) { await ctx.close(); continue; }
    await page.addScriptTag({ content: AXE });
    const m = await page.evaluate(async () => {
      const w = document.querySelector('[data-scout-window]');
      const cards = [...w.querySelectorAll('.scout-card')];
      const verbs = cards.map(c => { const b = c.querySelector('[data-scout-verb]'); if (!b) return null; const cr = c.getBoundingClientRect(), br = b.getBoundingClientRect(), cs = getComputedStyle(b); return { label: b.textContent.trim(), verb: b.dataset.scoutVerb, left: Math.round(br.left - cr.left), below: br.top > cr.top + 20, h: Math.round(br.height), color: cs.color, border: cs.borderTopColor }; });
      const v = (await window.axe.run({ include: [['[data-scout-window]']] }, { resultTypes: ['violations'] })).violations.map(x => `${x.id} (${x.nodes.length}) ${x.nodes[0]?.target?.join(' ')}`);
      return { cards: cards.length, verbs, copy: w.querySelector('[data-scout-copy-section]')?.textContent || null, full: !!w.querySelector('[data-scout-copy-full]'), menus: w.querySelectorAll('.scout-more-btn').length, v, n2: document.documentElement.scrollWidth - window.innerWidth, inner: w.scrollWidth - w.clientWidth };
    });
    const shown = width < 900 ? Math.min(ROWS.length, 3) : ROWS.length; // the phone shows three people, then "n more"
    const cream = /^rgb\(255, 159, 87\)$/.test(m.verbs[0]?.color || '');
    ok(`P6 @ ${width}: ${m.cards} of ${ROWS.length} real people rows shown, each with a visible "${m.verbs[0]?.label}" button at the card's bottom-left (left ${m.verbs[0]?.left} px, ${m.verbs[0]?.h} px tall, Creamsicle ${m.verbs[0]?.color}) and its ⋯ (${m.menus}); the footer has "${m.copy}" + Full`, cream && m.cards === shown && m.cards > 0 && m.verbs.every(x => x && x.verb === 'draft' && x.label === 'Draft email' && x.left <= 2 && x.below) && m.menus === m.cards && !!m.copy && m.full, JSON.stringify(m.verbs[0]));
    ok(`P6 @ ${width}: axe 0 on the Scout window · 0 px sideways`, m.v.length === 0 && m.n2 <= 0 && m.inner <= 0, JSON.stringify({ v: m.v, n2: m.n2, inner: m.inner }));
    await ctx.close();
  }
  if (!BEFORE) ok(`the browser sent no ask and wrote nothing (non-GET aborted: ${h.blocked.length}; scout/ask: ${h.blocked.filter(b => b.includes('/scout/ask')).length})`, !h.blocked.some(b => b.includes('/scout/ask')), [...new Set(h.blocked)].slice(0, 4).join(', '));
} catch (e) {
  ok('run', false, e.stack?.split('\n').slice(0, 3).join(' | '));
} finally {
  await h.close();
  const passed = checks.filter(Boolean).length;
  console.log(`\n${passed}/${checks.length} checks passed`);
  console.log(`restored: yes (no row written but the draft's own business_anthropic_usage cost row, declared and kept; the sign-in row is kept by rule)${BEFORE ? ' · --before: PNGs only' : ''}`);
  process.exit(passed === checks.length ? 0 : 1);
}

import { selectAllPages } from '../../lib/selectAllPages.js';
import { memberColor } from '../../../src/constants/memberColors.js';
import { laClock } from './scheduler.js';
import { lastTouchFor } from '../companyPanel.js';
import { mergeWeights } from '../intentScoreRun.js';
import { seenBeforeKeys, isNewCompany } from '../visitRules.js';
import { DEFAULT_WEIGHTS } from '../intentScore.js';
import { esc, recordUrl, MAP_URL, VISITORS_URL, ORIGIN, DARK, BAND_HUE, SANS, MONO, dlink, tagPill, outlinePill, memberDot, tileGrid, dataTable, darkShell } from './format.js';

// homelover-team-emails-v1 T4 (REV2) - the weekday visitor email. Pure builder over rows the loader reads; no person
// names, emails or phones ever reach it (people = a count + job titles).
// FIX visitor-email-top10-v1 V1 - list A gated to real intent (qualifies: a named person, 2+ pages, 2+ unique visitors,
// or Warm or hotter), never padded; list B = the top TOP_N of the whole ranked book (loadRankedBook: the Map's order with
// live / closed / duplicates / Deprioritized out) with ▲ ▼ against the last sales_company_score_days snapshot.
// FIX visitor-email-period-v1 - P1 the window is the previous CALENDAR day in LA; Monday's covers Fri + Sat + Sun, each
// row tagged with the day(s) its pull window covered - never a silent merge. A row belongs to the window when the pull
// that produced it asked Apollo for a window starting inside it (seen_from) and ending by the send day (seen_to), so a
// visit is never reported twice. is_new = no earlier pull window ever listed the company.
// FIX visitor-email-v2 - three lists: A0 "New yesterday" (is_new, ranked by intent: score desc, then visitors), A "Worth
// a look yesterday" (qualifies, the same rank) and B "Top 10 right now - whole book"; NEW / RETURNING as filled tags on
// every A0 / A row; the stat tiles 2 x 2; the intent line with outlined band pills; "How to read this" with the band
// thresholds read from the scores route's weights (never constants here - they ride on the ranked book); the dark
// table-based HTML with % column widths so a 390 phone keeps all four columns.
export const TOP_N = 10;
const DAY_MS = 864e5;
export const qualifies = c => c.people >= 1 || c.pages >= 2 || c.visitors >= 2 || c.band === 'P1' || c.band === 'P2';
export const QUALIFIED_WORDS = 'Warm or hotter, a named person, or 2+ visitors or pages';
export const BANDS = ['P1', 'P2', 'P3', 'P4'];
export const BAND_WORD = { P1: 'Hot', P2: 'Warm', P3: 'Cool', P4: 'Cold' };
export const SETTINGS_URL = `${ORIGIN}/?tab=settings&view=team-emails`;
export const FOOTER_WORDS = 'Sent by Prospector to the HomeLover team · manage recipients · Sales › Settings › Team emails';
const TYPE = { opportunity: 'employer', target: 'target', partner: 'partner' };
const KIND_LABEL = { employer: 'Employer', target: 'Target', partner: 'Partner' };
const sentence = s => { const t = String(s || '').replace(/_/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const dayLabel = date => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).replace(',', '');
const wdOf = date => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
const mdOf = date => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const shortDay = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
const addDay = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const dowOf = d => new Date(`${d}T12:00:00Z`).getUTCDay();
// The touch kind only - an employer to-do's own text can name a person, so it never reaches the email.
const TOUCH_WORD = { email: 'email', call: 'call', meeting: 'meeting', linkedin: 'LinkedIn', event: 'event', other: 'note', done: 'to-do', stage: 'stage moved' };

// The UTC instant of <LA date> <HH:MM> (PDT or PST, whichever that day is on).
export function laInstant(date, hm) {
  const [y, m, d] = date.split('-').map(Number), [h, min] = hm.split(':').map(Number);
  for (const off of [7, 8]) {
    const t = Date.UTC(y, m - 1, d, h + off, min);
    const c = laClock(t);
    if (c.date === date && c.hm === hm) return t;
  }
  throw new Error(`no LA instant for ${date} ${hm}`);
}

// P1: the calendar day(s) an email sent on <LA date> covers - yesterday; after a weekend, Friday through Sunday. Pure
// calendar dates, so a DST change never moves the window.
export function dayWindowFor(date, { weekendOn = false } = {}) {
  const days = [addDay(date, -1)];
  while (!weekendOn && [0, 6].includes(dowOf(days[0]))) days.unshift(addDay(days[0], -1));
  return { date, days, first: days[0], last: days[days.length - 1] };
}
export const windowDays = w => (w.days.length > 1 ? `${dayLabel(w.first)} – ${dayLabel(w.last)}` : dayLabel(w.first));
// A row's day tag inside a multi-day window: the days of its pull window that fall in the email's days ("Fri–Sun", "Sat").
export function dayTag(row, w) {
  if (w.days.length < 2) return null;
  const from = row.seen_from > w.first ? row.seen_from : w.first, to = row.seen_to < w.last ? row.seen_to : w.last;
  return from === to ? wdOf(from) : `${wdOf(from)}–${wdOf(to)}`;
}

// List B: the whole ranked book, the Map's order, top `top` rows with their trend since the last daily snapshot, and
// the band thresholds the Map scores with (V3: the email reads them from here, never from constants of its own).
export async function loadRankedBook(supabase, businessId, { now = Date.now(), members, top = TOP_N }) {
  const today = laClock(now).date;
  const [stored, settings] = await Promise.all([
    selectAllPages(() => supabase.from('sales_company_scores').select('company_type, company_id, score, band, closed, flagged_out, duplicate_of, components').eq('business_id', businessId).order('score', { ascending: false }).order('company_id')),
    supabase.from('sales_settings').select('score_weights').eq('business_id', businessId).maybeSingle().then(r => r.data),
  ]);
  const ranked = stored.filter(s => !s.flagged_out && !s.duplicate_of && !s.closed && s.components?.meta?.fit?.level !== 'deprioritized');
  const picked = ranked.slice(0, top);
  const prevDay = must(await supabase.from('sales_company_score_days').select('day').eq('business_id', businessId).lt('day', today).order('day', { ascending: false }).limit(1))[0]?.day || null;
  const prev = new Map();
  if (prevDay && picked.length) for (const r of must(await supabase.from('sales_company_score_days').select('company_type, company_id, score').eq('business_id', businessId).eq('day', prevDay).in('company_id', picked.map(p => p.company_id)))) prev.set(`${r.company_type}:${r.company_id}`, r.score);
  const nameOf = new Map(members.map(m => [m.userId, m.firstName]));
  const colorOf = new Map(members.map((m, i) => [m.userId, memberColor(i)]));
  const rows = await Promise.all(picked.map(async (s, i) => {
    const meta = s.components?.meta || {};
    const lt = await lastTouchFor(supabase, businessId, { type: s.company_type, id: s.company_id, last_touch_at: meta.last_touch_at || null });
    const p = prev.get(`${s.company_type}:${s.company_id}`);
    return {
      rank: i + 1, company: meta.name || 'Unnamed company', type: s.company_type, id: s.company_id, score: s.score, band: s.band, stage: meta.stage || null,
      owner: meta.owner_user_id ? nameOf.get(meta.owner_user_id) || meta.owner || 'Unassigned' : meta.owner || 'Unassigned', owner_color: meta.owner_user_id ? colorOf.get(meta.owner_user_id) || null : null,
      trend: p == null ? 'new' : s.score > p ? 'up' : s.score < p ? 'down' : 'flat', prev_score: p ?? null,
      last_touch: lt ? { at: lt.at, by: lt.by ? nameOf.get(lt.by) || null : null, what: TOUCH_WORD[lt.touch_type] || null } : null,
    };
  }));
  return { rows, total: ranked.length, prev_day: prevDay, thresholds: mergeWeights(settings?.score_weights).thresholds };
}

// P2: every company Prospector has identified, from the first pull on (the start date read from the data).
export async function loadCumulative(supabase, businessId) {
  const rows = await selectAllPages(() => supabase.from('web_visits').select('id, company_key, pulled_on').eq('business_id', businessId).order('id'));
  return { companies: new Set(rows.map(r => r.company_key)).size, since: rows.map(r => r.pulled_on).filter(Boolean).sort()[0] || null };
}

// The companies seen in the window w (dayWindowFor): the pull rows whose Apollo window started inside the days and ended
// by the send day, the latest row per company. is_new = the one rule in visitRules.js (seenBeforeKeys / isNewCompany,
// visitor-trend-v1 R5): no pull window before the first day ever listed the company - the query below is the DB prefilter.
export async function loadVisitorData(supabase, businessId, { window: w, members }) {
  const rows = await selectAllPages(() => supabase.from('web_visits').select('id, company_key, company_name, domain, visits_7d, unique_visitors_7d, top_paths, intent_score, priority, matched_type, matched_id, pulled_on, seen_from, seen_to').eq('business_id', businessId).gte('seen_from', w.first).lte('seen_to', w.date).order('id'));
  const latest = new Map();
  for (const r of rows) { const cur = latest.get(r.company_key); if (!cur || r.pulled_on > cur.pulled_on || (r.pulled_on === cur.pulled_on && r.seen_to > cur.seen_to)) latest.set(r.company_key, r); }
  const visits = [...latest.values()];
  const keys = visits.map(v => v.company_key);
  const seenBefore = seenBeforeKeys(keys.length ? await selectAllPages(() => supabase.from('web_visits').select('id, company_key, seen_from').eq('business_id', businessId).in('company_key', keys).lt('seen_from', w.first).order('id')) : [], w.first);
  const ids = t => [...new Set(visits.filter(v => v.matched_type === t && v.matched_id).map(v => v.matched_id))];
  const buyerTitles = ((await supabase.from('sales_settings').select('buyer_titles').eq('business_id', businessId).maybeSingle()).data?.buyer_titles || []).map(b => String(b).toLowerCase());
  const isBuyer = t => { const x = String(t || '').toLowerCase(); return !!x && buyerTitles.some(b => x.includes(b) || b.includes(x)); };
  const [opps, targets, partners, scores, people] = await Promise.all([
    ids('opportunity').length ? must(await supabase.from('sales_opportunities').select('id, organization, stage, owner_user_id, client_status').eq('business_id', businessId).in('id', ids('opportunity'))) : [],
    ids('target').length ? must(await supabase.from('sales_targets').select('id, name, status, owner_user_id').eq('business_id', businessId).in('id', ids('target'))) : [],
    ids('partner').length ? must(await supabase.from('sales_goals').select('id, name, pipeline_status, owner_user_id, last_touch_at').eq('business_id', businessId).in('id', ids('partner'))) : [],
    must(await supabase.from('sales_company_scores').select('company_type, company_id, score, band').eq('business_id', businessId).in('company_id', [...ids('opportunity'), ...ids('target'), ...ids('partner')])),
    visits.length ? selectAllPages(() => supabase.from('sales_people').select('id, visit_id, title').eq('business_id', businessId).in('visit_id', visits.map(v => v.id)).is('archived_at', null).order('id')) : [],
  ]);
  const rec = new Map([
    ...opps.map(o => [o.id, { stage: o.client_status ? 'client' : o.stage, owner: o.owner_user_id }]),
    ...targets.map(t => [t.id, { stage: t.status, owner: t.owner_user_id }]),
    ...partners.map(p => [p.id, { stage: p.pipeline_status, owner: p.owner_user_id, last_touch_at: p.last_touch_at }]),
  ]);
  const score = new Map(scores.map(s => [`${s.company_type}:${s.company_id}`, s]));
  const nameOf = new Map(members.map(m => [m.userId, m.firstName]));
  const colorOf = new Map(members.map((m, i) => [m.userId, memberColor(i)]));
  const out = visits.map(v => {
    const type = TYPE[v.matched_type] || null;
    const s = type ? score.get(`${type}:${v.matched_id}`) : null;
    const r = type ? rec.get(v.matched_id) : null;
    const ppl = people.filter(p => p.visit_id === v.id);
    const titles = [...new Set([...ppl.filter(p => isBuyer(p.title)), ...ppl].map(p => p.title).filter(Boolean))].slice(0, 3);
    const paths = Array.isArray(v.top_paths) ? v.top_paths.map(p => String(p?.path || p)).filter(Boolean) : [];
    return {
      company: v.company_name, type, id: v.matched_id || null, visit_id: v.id,
      score: s ? s.score : v.intent_score != null ? Math.round(Number(v.intent_score)) : null, band: s ? s.band : v.priority,
      visits: v.visits_7d || 0, visitors: v.unique_visitors_7d || 0, people: ppl.length, buyers: ppl.filter(p => isBuyer(p.title)).length, titles,
      pages: paths.length, paths: paths.slice(0, 2), top_page: paths[0] || null,
      stage: r?.stage || null, owner: r?.owner ? nameOf.get(r.owner) || 'Unassigned' : 'Unassigned', owner_color: r?.owner ? colorOf.get(r.owner) || null : null,
      is_new: isNewCompany(v.company_key, seenBefore), days: dayTag(v, w), last_touch_at: r?.last_touch_at || null,
    };
  });
  // Last touch for the rows the two lists can show (A0 = the new, A = the qualified), read for records only.
  const shown = new Set([...rankVisitors(out.filter(c => c.is_new)).slice(0, TOP_N), ...rankVisitors(out.filter(qualifies)).slice(0, TOP_N)]);
  await Promise.all([...shown].filter(c => c.type).map(async c => {
    const lt = await lastTouchFor(supabase, businessId, { type: c.type, id: c.id, last_touch_at: c.last_touch_at });
    c.last_touch = lt ? { at: lt.at, by: lt.by ? nameOf.get(lt.by) || null : null, what: TOUCH_WORD[lt.touch_type] || null } : null;
  }));
  return out.map(({ last_touch_at, ...c }) => c);
}

// V1: both visitor lists rank by intent - score desc, then unique visitors, then pages, then the name.
export const rankVisitors = companies => [...companies].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (b.visitors || 0) - (a.visitors || 0) || (b.pages || 0) - (a.pages || 0) || a.company.localeCompare(b.company));
const home = p => (p === '/' ? '/ (home)' : p);
// E9 line 2: "17 visits · 58 people · last 7 days · pages: /partners/realtors · 1 named: VP People".
export const detailOf = c => [
  plural(c.visits || 0, 'visit', 'visits'), c.visitors ? plural(c.visitors, 'person', 'people') : null, 'last 7 days',
  (c.paths || []).length ? `pages: ${c.paths.map(home).join(', ')}${c.pages > c.paths.length ? ` +${c.pages - c.paths.length}` : ''}` : null,
  c.people ? `${c.people} named: ${(c.titles || []).slice(0, 2).join(', ') || 'title unknown'}` : null,
].filter(Boolean).join(' · ');
export const thresholdWords = t => `Hot ≥ ${t.P1} · Warm ${t.P2}–${t.P1 - 1} · Cool ${t.P3}–${t.P2 - 1} · Cold < ${t.P3}`;

// -> { subject, html, text, rows, new_rows, qualified, visited, more, overall, new, returning, cumulative }. date = the LA
// date it is sent on; window = dayWindowFor(date); overall = loadRankedBook's result (list B + the thresholds);
// cumulative = loadCumulative's; pullNote = the "Visitor pull failed …" line.
export function buildVisitorEmail(companies, { date, window: w = dayWindowFor(date), pullNote = null, overall = null, cumulative = null, thresholds = overall?.thresholds || DEFAULT_WEIGHTS.thresholds }) {
  const sorted = rankVisitors(companies);
  const n = sorted.length, multi = w.days.length > 1, days = windowDays(w);
  const when = multi ? 'Fri–Sun' : 'yesterday', whose = multi ? "Fri–Sun's" : "yesterday's";
  const fresh = sorted.filter(c => c.is_new), returning = n - fresh.length;
  const qualified = sorted.filter(qualifies), q = qualified.length;
  const listNew = fresh.slice(0, TOP_N), listQ = qualified.slice(0, TOP_N);
  const book = overall?.rows || [];
  const bands = Object.fromEntries(BANDS.map(b => [b, sorted.filter(c => c.band === b).length]));
  const matched = t => sorted.filter(c => c.type === t).length;
  const notIn = sorted.filter(c => !c.type).length, newIn = fresh.filter(c => c.type).length;
  const sentDay = wdOf(date);

  const eyebrow = `HomeLover · Website visitors · ${when}`;
  const head = `${days} — ${plural(n, 'company', 'companies')} visited, ${fresh.length} for the first time`;
  const subWords = `Companies Apollo matched to visits on homelover.com, ${multi ? 'Friday through Sunday, ' : ''}midnight to midnight PT. Sent ${sentDay} 7:00 AM.`;
  const subject = `Website visitors · ${days} — ${fresh.length} new, ${q} worth a look${book[0] ? `, top: ${book[0].company}` : ''}`;
  const tiles = [[n, 'visited', `companies on the site ${when}`], [fresh.length, 'new', 'never seen before', BAND_HUE.P1], [returning, 'returning', 'seen before, came back', BAND_HUE.P3], [q, 'worth a look', QUALIFIED_WORDS]];
  const inProspectorWords = `already in Prospector: ${plural(matched('employer'), 'employer', 'employers')} · ${plural(matched('target'), 'target', 'targets')} · ${plural(matched('partner'), 'partner', 'partners')}`;
  const intentWords = n ? `Intent of ${whose} ${n}: ${BANDS.map(b => `${BAND_WORD[b]} ${bands[b]}`).join(' · ')} · ${inProspectorWords} · ${notIn} not yet` : `No identified visitors ${when} — most traffic stays anonymous.`;
  const newSub = fresh.length ? `${plural(fresh.length, 'company', 'companies')} we had never seen on the site before. ${newIn ? `${newIn} already in Prospector — Add puts the rest on the Map as targets.` : 'None are in Prospector yet — Add puts them on the Map as a target.'}` : `No new companies ${when}.`;
  const newFoot = fresh.length > TOP_N ? `Showing ${TOP_N} of ${fresh.length} · all ${fresh.length} on the Map →` : null;
  const qSub = q ? `${q > TOP_N ? `The ${TOP_N} strongest of the ${q} qualified` : `All ${q} qualified`}, ranked by intent. Qualified = ${QUALIFIED_WORDS}.` : `No company qualified ${when} (${QUALIFIED_WORDS}).`;
  const qFoot = n ? [q > TOP_N ? `and ${q - TOP_N} more qualified` : null, n - q > 0 ? `${n - q} not qualified` : null, `all ${n} on the Map →`].filter(Boolean).join(' · ') : null;
  const bookSub = overall ? `All ${overall.total.toLocaleString('en-US')} ranked companies in the Map's order, not just ${whose} visitors. ▲ ▼ = score change since the last email.` : null;
  const cumulativeWords = cumulative ? `${cumulative.companies.toLocaleString('en-US')} companies identified since ${cumulative.since ? mdOf(cumulative.since) : 'the first pull'}.` : null;
  const glossary = [
    ['NEW / RETURNING', `whether we had seen the company on the site before ${when}.`],
    ['Visits · people', `Apollo's rolling 7-day counts, not just ${when}. Pages — the paths Apollo reported on this pull.`],
    ['Intent', `the Map's score, 0–100: ${thresholdWords(thresholds)}.`],
    ['In Prospector', 'the record type and stage, or "Not in Prospector" with an Add link.'],
  ];
  const anonymous = `Most visitors stay anonymous; Apollo names a company only when it can match the traffic.${cumulativeWords ? ` ${cumulativeWords}` : ''}`;

  const intent = c => (c.band in BAND_WORD ? `${BAND_WORD[c.band]}${c.score != null ? ` ${c.score}` : ''}` : c.score != null ? String(c.score) : '—');
  const tagOf = c => (c.is_new ? 'NEW' : 'RETURNING');
  const inProspector = c => (c.type ? `${KIND_LABEL[c.type]} · ${c.stage ? sentence(c.stage) : 'No stage'} · ${c.owner || 'Unassigned'}` : 'Not in Prospector');
  const touch = c => (c.last_touch?.at ? [shortDay(c.last_touch.at), c.last_touch.what].filter(Boolean).join(' · ') : 'No touch yet');
  const trendText = c => (c.trend === 'up' ? `▲ ${c.prev_score}→${c.score}` : c.trend === 'down' ? `▼ ${c.prev_score}→${c.score}` : c.trend === 'new' ? 'new' : '—');
  const url = c => (c.type ? recordUrl(c.type, c.id) : VISITORS_URL);

  const textRow = (c, i) => [`${i + 1}. ${c.company} [${tagOf(c)}${c.days ? ` · ${c.days}` : ''}] — ${intent(c)} · ${inProspector(c)}${c.type ? '' : ` · Add → ${VISITORS_URL}`} · ${touch(c)}`, `   ${detailOf(c)}`, `   ${url(c)}`].join('\n');
  const textBook = c => [`${c.rank}. ${c.company} — ${intent(c)} · ${trendText(c)} · ${inProspector(c)} · ${touch(c)}`, `   ${url(c)}`].join('\n');
  const text = [
    eyebrow.toUpperCase(), head, `${subWords} Open the Map → ${MAP_URL}`, '',
    `${n} visited · ${fresh.length} new · ${returning} returning · ${q} worth a look`, intentWords, '',
    `NEW ${when.toUpperCase()}`, newSub, ...listNew.map(textRow), ...(newFoot ? [`${newFoot} ${MAP_URL}`] : []), '',
    `WORTH A LOOK ${when.toUpperCase()}`, qSub, ...listQ.map(textRow), ...(qFoot ? [`${qFoot} ${MAP_URL}`] : []),
    ...(overall ? ['', `TOP ${TOP_N} RIGHT NOW — WHOLE BOOK`, bookSub, ...(book.length ? book.map(textBook) : ['No ranked companies yet'])] : []),
    '', 'HOW TO READ THIS', ...glossary.map(([k, v]) => `${k} — ${v}`), anonymous,
    ...(pullNote ? ['', pullNote] : []),
    '', '—', FOOTER_WORDS,
  ].join('\n');

  const h2 = (t, tag = null) => `<div style="font:600 17px ${SANS};color:${DARK.text}">${esc(t)}${tag ? tagPill(tag, tag === 'NEW' ? BAND_HUE.P1 : BAND_HUE.P3) : ''}</div>`;
  const sub = t => `<div style="font:13px ${SANS};color:${DARK.muted};margin-top:3px">${esc(t)}</div>`;
  const foot = t => `<div style="font:12.5px ${SANS};color:${DARK.muted};margin-top:10px">${esc(t.replace(/ · all .*$/, ''))}${/ · all /.test(t) ? ` · ${dlink(MAP_URL, t.slice(t.indexOf('all ')))}` : dlink(MAP_URL, t)}</div>`;
  const section = inner => `<tr><td style="padding:26px 0 0">${inner}</td></tr>`;
  const pillOf = c => (c.band in BAND_HUE ? outlinePill(intent(c), BAND_HUE[c.band]) : `<span style="color:${DARK.faint}">${esc(intent(c))}</span>`);
  const whoCell = c => (c.type ? `${esc(`${KIND_LABEL[c.type]} · ${c.stage ? sentence(c.stage) : 'No stage'}`)} · ${memberDot(c.owner_color)}${esc(c.owner || 'Unassigned')}</span>` : `<span style="color:${DARK.muted}">Not in Prospector</span> · ${dlink(VISITORS_URL, 'Add →', true)}`);
  const touchCell = c => (c.last_touch?.at ? esc(touch(c)) : `<span style="color:${DARK.faint}">No touch yet</span>`);
  const row = c => [
    `<div style="font-size:14px;line-height:1.3">${dlink(url(c), c.company, true)}${tagPill(tagOf(c), c.is_new ? BAND_HUE.P1 : BAND_HUE.P3)}${c.days ? ` <span style="font-size:11px;color:${DARK.faint}">· ${esc(c.days)}</span>` : ''}</div><div style="font-size:12px;color:${DARK.muted};line-height:1.45;margin-top:3px">${esc(detailOf(c))}</div>`,
    pillOf(c), whoCell(c), touchCell(c),
  ];
  const bookRow = c => [
    `<div style="font-size:14px;line-height:1.3">${dlink(url(c), `${c.rank}. ${c.company}`, true)}</div>`, pillOf(c),
    `<span style="white-space:nowrap;color:${c.trend === 'up' ? DARK.good : c.trend === 'down' ? DARK.bad : DARK.faint}">${esc(trendText(c))}</span>`,
    whoCell(c), touchCell(c),
  ];
  const HEADS = ['Company · why', 'Intent', 'In Prospector · owner', 'Last touch'], WIDTHS = [42, 19, 22, 17];
  const body = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
<tr><td style="padding:18px 0 0">${tileGrid(tiles)}</td></tr>
<tr><td style="padding:12px 0 0;font:12.5px ${SANS};color:${DARK.muted}">${n ? `Intent of ${esc(whose)} ${n}: ${BANDS.map(b => outlinePill(`${BAND_WORD[b]} ${bands[b]}`, BAND_HUE[b])).join(' ')} &nbsp;·&nbsp; ${esc(inProspectorWords)} &nbsp;·&nbsp; ${notIn} not yet` : esc(intentWords)}</td></tr>
${section(`${h2(`New ${when}`, 'NEW')}${sub(newSub)}${listNew.length ? dataTable(HEADS, WIDTHS, listNew.map(row)) : ''}${newFoot ? foot(newFoot) : ''}`)}
${section(`${h2(`Worth a look ${when}`, 'RETURNING')}${sub(qSub)}${listQ.length ? dataTable(HEADS, WIDTHS, listQ.map(row)) : ''}${qFoot ? foot(qFoot) : ''}`)}
${overall ? section(`${h2(`Top ${TOP_N} right now — whole book`)}${sub(bookSub)}${book.length ? dataTable(['Company', 'Intent', 'Trend', 'In Prospector · owner', 'Last touch'], [27, 18, 17, 22, 16], book.map(bookRow)) : sub('No ranked companies yet')}`) : ''}
${pullNote ? `<tr><td style="padding:16px 0 0;font:12.5px ${SANS};color:${DARK.muted}"><i>${esc(pullNote)}</i></td></tr>` : ''}
<tr><td style="padding:26px 0 0"><div style="border-top:1px solid ${DARK.rule};padding-top:20px"><div style="font:600 11px ${MONO};letter-spacing:.08em;text-transform:uppercase;color:${DARK.faint};margin-bottom:8px">How to read this</div>
<div style="font:12.5px ${SANS};color:${DARK.muted};line-height:1.55">${glossary.map(([k, v]) => `<b style="color:${DARK.soft}">${esc(k)}</b> — ${esc(v)}`).join('<br>')}<br>${esc(anonymous)}</div>
<div style="font:12px ${SANS};color:${DARK.faint};margin-top:14px">Sent by Prospector to the HomeLover team · ${dlink(SETTINGS_URL, 'manage recipients')} · Sales › Settings › Team emails</div></div></td></tr>
</table>`;
  const html = darkShell({ eyebrow, title: head, sub: `${esc(subWords)} ${dlink(MAP_URL, 'Open the Map →')}`, body });
  return { subject, html, text, rows: listQ.length, new_rows: listNew.length, qualified: q, visited: n, more: Math.max(0, q - listQ.length), overall: book.length, new: fresh.length, returning, cumulative: cumulative?.companies ?? null };
}

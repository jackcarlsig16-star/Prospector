import { selectAllPages } from '../../lib/selectAllPages.js';
import { memberColor } from '../../../src/constants/memberColors.js';
import { laClock } from './scheduler.js';
import { lastTouchFor } from '../companyPanel.js';
import { esc, shell, tiles, table, pill, dot, link, recordUrl, MAP_URL, VISITORS_URL, ACCENT, MUTED, withFooter } from './format.js';

// homelover-team-emails-v1 T4 (REV2) - the weekday visitor email, redesigned: header, 4 stat tiles, Hot / Warm / Cool /
// Cold counts, a 5-column table. Pure builder over rows the loader reads; no person names, emails or phones ever reach
// it (people = a count + job titles). Band words carry no time words (P1..P4 keep their thresholds).
// visitor-email-clarity: visits / visitors are Apollo's rolling 7-day counts and every label says so; Last touch is the
// company panel's own (companyPanel.js lastTouchFor), read for the top 10 rows only.
// FIX visitor-email-top10-v1 V1 - two ranked lists: A = the companies whose web_visits row changed since the previous
// weekday send (periodFor: Monday reaches back to Friday 07:00, so weekend visitors appear - Jack's ruling on the
// follow-up), B = the top TOP_N of the whole ranked book (loadRankedBook: the Map's order with live / closed /
// duplicates / Deprioritized out) with ▲ ▼ against the last sales_company_score_days snapshot. A company in both lists
// appears in both - that is the signal. The subject names the #1 overall.
export const TOP_N = 10;
const DAY_MS = 864e5;
const weekdayOf = ms => new Date(ms).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' });
const TREND = { up: '▲', down: '▼', flat: '–', new: 'new' };
export const BANDS = ['P1', 'P2', 'P3', 'P4'];
export const LEGEND = "Companies = organisations Apollo matched to site traffic. Visits / visitors = Apollo's rolling 7-day counts. Named = people Apollo identified by name — most visitors stay anonymous. New = first time this company appears.";
export const BAND_WORD = { P1: 'Hot', P2: 'Warm', P3: 'Cool', P4: 'Cold' };
const BAND_COLORS = { P1: ['#9F1D1D', '#FDE2E1'], P2: ['#8A4B08', '#FDEBD3'], P3: ['#1E4E8C', '#DCE8F8'], P4: ['#4B5563', '#ECEEF1'] };
const TYPE = { opportunity: 'employer', target: 'target', partner: 'partner' };
const KIND_LABEL = { employer: 'Employer', target: 'Target', partner: 'Partner' };
const titleCase = s => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const dayLabel = date => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).replace(',', '');
const shortDay = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
// The touch kind only - an employer to-do's own text can name a person, so it never reaches the email.
const TOUCH_WORD = { email: 'email', call: 'call', meeting: 'meeting', linkedin: 'LinkedIn', event: 'event', other: 'note', done: 'to-do', stage: 'stage moved' };
const timeLabel = ms => new Date(ms).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: '2-digit' });

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

// The period an email at <LA date> 07:00 covers: since the previous weekday's 07:00 (Monday -> Friday's).
export function periodFor(date, at = '07:00') {
  let t = laInstant(date, at) - DAY_MS;
  while (![1, 2, 3, 4, 5].includes(laClock(t).dow)) t -= DAY_MS;
  return { since: laInstant(laClock(t).date, at), until: laInstant(date, at) };
}

// List B: the whole ranked book, the Map's order, top `top` rows with their trend since the last daily snapshot.
export async function loadRankedBook(supabase, businessId, { now = Date.now(), members, top = TOP_N }) {
  const today = laClock(now).date;
  const stored = await selectAllPages(() => supabase.from('sales_company_scores').select('company_type, company_id, score, band, closed, flagged_out, duplicate_of, components').eq('business_id', businessId).order('score', { ascending: false }).order('company_id'));
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
  return { rows, total: ranked.length, prev_day: prevDay };
}

export async function loadVisitorData(supabase, businessId, { since, until, members }) {
  const sinceIso = new Date(since).toISOString();
  const rows = (await selectAllPages(() => supabase.from('web_visits').select('id, company_key, company_name, domain, visits_7d, unique_visitors_7d, top_paths, intent_score, priority, matched_type, matched_id, pulled_on, created_at, updated_at').eq('business_id', businessId).gte('updated_at', sinceIso).order('id')))
    .filter(r => Date.parse(r.updated_at) < until);
  const latest = new Map();
  for (const r of rows) { const cur = latest.get(r.company_key); if (!cur || r.pulled_on > cur.pulled_on) latest.set(r.company_key, r); }
  const visits = [...latest.values()];
  const keys = visits.map(v => v.company_key);
  const seenBefore = keys.length ? new Set((await selectAllPages(() => supabase.from('web_visits').select('id, company_key').eq('business_id', businessId).in('company_key', keys).lt('created_at', sinceIso).order('id'))).map(r => r.company_key)) : new Set();
  const ids = t => [...new Set(visits.filter(v => v.matched_type === t && v.matched_id).map(v => v.matched_id))];
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
    return {
      company: v.company_name, type, id: v.matched_id || null, visit_id: v.id,
      score: s ? s.score : v.intent_score != null ? Math.round(Number(v.intent_score)) : null, band: s ? s.band : v.priority,
      visits: v.visits_7d || 0, visitors: v.unique_visitors_7d || 0, people: ppl.length, titles: [...new Set(ppl.map(p => p.title).filter(Boolean))].slice(0, 3),
      top_page: Array.isArray(v.top_paths) && v.top_paths[0] ? String(v.top_paths[0].path || v.top_paths[0]) : null,
      stage: r?.stage || null, owner: r?.owner ? nameOf.get(r.owner) || 'Unassigned' : 'Unassigned', owner_color: r?.owner ? colorOf.get(r.owner) || null : null,
      is_new: !seenBefore.has(v.company_key), last_touch_at: r?.last_touch_at || null,
    };
  });
  await Promise.all(rankVisitors(out).slice(0, TOP_N).filter(c => c.type).map(async c => {
    const lt = await lastTouchFor(supabase, businessId, { type: c.type, id: c.id, last_touch_at: c.last_touch_at });
    c.last_touch = lt ? { at: lt.at, by: lt.by ? nameOf.get(lt.by) || null : null, what: TOUCH_WORD[lt.touch_type] || null } : null;
  }));
  return out.map(({ last_touch_at, ...c }) => c);
}

export const rankVisitors = companies => [...companies].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.visits - a.visits || a.company.localeCompare(b.company));

// -> { subject, html, text, rows, more, overall }. date = the LA date it is sent on; since = the previous weekday send (periodFor);
// overall = loadRankedBook's result (list B); pullNote = the "Visitor pull failed …" line.
export function buildVisitorEmail(companies, { date, since, pullNote = null, overall = null }) {
  const sorted = rankVisitors(companies);
  const bands = Object.fromEntries(BANDS.map(b => [b, sorted.filter(c => c.band === b).length]));
  const n = sorted.length, hot = bands.P1;
  const book = overall?.rows || [];
  const head = `${dayLabel(date)} — ${plural(n, 'company', 'companies')} since ${weekdayOf(since)}, ${hot} hot`;
  const subject = `Website visitors — ${dayLabel(date)}: ${n} since ${weekdayOf(since)}${book[0] ? ` · top overall: ${book[0].company}` : ''}`;
  const sinceLine = `Companies Apollo identified on our site since ${timeLabel(since)} (the previous weekday send)`;
  const top = sorted.slice(0, TOP_N), more = n - top.length;
  const listA = `Top ${TOP_N} — since ${timeLabel(since)}`, listB = `Top ${TOP_N} — overall right now`;
  const bookLine = overall ? `The whole ranked book (${plural(overall.total, 'company', 'companies')}), the Map's order · ▲ ▼ since ${overall.prev_day ? dayLabel(overall.prev_day) : 'the last snapshot'}` : null;
  const trendText = c => (c.trend === 'new' ? 'new' : `${TREND[c.trend]}${c.prev_score != null && c.trend !== 'flat' ? ` ${c.prev_score}→${c.score}` : ''}`);
  const matched = t => sorted.filter(c => c.type === t).length;
  const notIn = sorted.filter(c => !c.type).length;
  const visits = sorted.reduce((s, c) => s + c.visits, 0);
  const stat = [[n, n === 1 ? 'company' : 'companies'], [sorted.filter(c => c.is_new).length, 'new (first time seen)', ACCENT], [visits, `${visits === 1 ? 'visit' : 'visits'}, last 7 days`], [notIn, 'not in Prospector']];
  const matchLine = `matched ${plural(matched('employer'), 'employer', 'employers')} · ${plural(matched('target'), 'target', 'targets')} · ${plural(matched('partner'), 'partner', 'partners')}`;
  const bandText = BANDS.map(b => `${BAND_WORD[b]} ${bands[b]}`).join(' · ');
  const intent = c => (c.band in BAND_WORD ? `${BAND_WORD[c.band]}${c.score != null ? ` ${c.score}` : ''}` : c.score != null ? String(c.score) : '—');
  const who = c => [`${plural(c.visits, 'visit', 'visits')} (7 d)`, c.visitors ? plural(c.visitors, 'visitor', 'visitors') : null, c.people ? `${c.people.toLocaleString('en-US')} named` : null].filter(Boolean).join(' · ');
  const touch = c => (!c.type ? '—' : c.last_touch?.at ? [shortDay(c.last_touch.at), c.last_touch.by, c.last_touch.what].filter(Boolean).join(' · ') : 'No touch yet');
  const detail = c => [c.titles.join(', ') || null, c.top_page].filter(Boolean).join(' · ');
  const inProspector = c => (c.type ? `${KIND_LABEL[c.type]}${c.stage ? ` · ${titleCase(c.stage)}` : ''}` : 'Not yet');
  const url = c => (c.type ? recordUrl(c.type, c.id) : VISITORS_URL);
  const empty = `No identified visitors since ${timeLabel(since)}`;

  const text = withFooter([
    'HomeLover · Website visitors', head, sinceLine, '',
    ...(n ? [
      stat.map(([v, l]) => `${v} ${l}`).join(' · '), bandText, matchLine, '', listA,
      ...top.map((c, i) => [`${i + 1}. ${c.company}${c.is_new ? ' [NEW]' : ''} — ${intent(c)}`, `   ${who(c)}${detail(c) ? ` · ${detail(c)}` : ''}`,
        `   In Prospector: ${inProspector(c)}${c.type ? '' : ' · Add'} · Owner: ${c.owner} · Last touch: ${touch(c)}`, `   ${url(c)}`].join('\n')),
      ...(more > 0 ? [`and ${more} more · open the Map → ${MAP_URL}`] : []),
    ] : [empty]),
    ...(overall ? ['', listB, bookLine, ...(book.length ? book.map(c => [`${c.rank}. ${c.company} — ${intent(c)} · ${trendText(c)}`,
      `   In Prospector: ${inProspector(c)} · Owner: ${c.owner} · Last touch: ${touch(c)}`, `   ${url(c)}`].join('\n')) : ['No ranked companies yet'])] : []),
    ...(n || overall ? ['', LEGEND] : []),
    ...(pullNote ? ['', pullNote] : []),
  ].join('\n'));

  const cell = c => [
    `${link(url(c), c.company, 'font-weight:600')}${c.is_new ? ` <span style="font-size:11px;font-weight:700;color:${ACCENT}">NEW</span>` : ''}`,
    c.band in BAND_COLORS ? pill(intent(c), ...BAND_COLORS[c.band]) : esc(intent(c)),
    `${esc(who(c))}${detail(c) ? `<div style="font-size:12px;color:${MUTED}">${esc(detail(c))}</div>` : ''}`,
    c.type ? esc(inProspector(c)) : `Not yet · ${link(VISITORS_URL, 'Add')}`,
    c.owner_color ? `${dot(c.owner_color)}${esc(c.owner)}` : `${dot(null, true)}<span style="color:${MUTED}">Unassigned</span>`,
    c.type && c.last_touch?.at ? esc(touch(c)) : `<span style="color:${MUTED}">${esc(touch(c))}</span>`,
  ];
  const bookCell = c => [
    `${link(url(c), `${c.rank}. ${c.company}`, 'font-weight:600')}`,
    c.band in BAND_COLORS ? pill(intent(c), ...BAND_COLORS[c.band]) : esc(intent(c)),
    `<span style="white-space:nowrap;color:${c.trend === 'up' ? '#1E7F4E' : c.trend === 'down' ? '#9F1D1D' : MUTED}">${esc(trendText(c))}</span>`,
    esc(inProspector(c)),
    c.owner_color ? `${dot(c.owner_color)}${esc(c.owner)}` : `${dot(null, true)}<span style="color:${MUTED}">${esc(c.owner)}</span>`,
    c.last_touch?.at ? esc(touch(c)) : `<span style="color:${MUTED}">${esc(touch(c))}</span>`,
  ];
  const h3 = (t, sub = null) => `<div style="font-size:15px;font-weight:700;margin:18px 0 ${sub ? 2 : 8}px">${esc(t)}</div>${sub ? `<div style="font-size:12px;color:${MUTED};margin:0 0 8px">${esc(sub)}</div>` : ''}`;
  const body = [
    ...(n ? [
      tiles(stat),
      `<div style="margin:0 0 6px">${BANDS.map(b => pill(`${BAND_WORD[b]} ${bands[b]}`, ...BAND_COLORS[b])).join(' ')}</div>`,
      `<div style="font-size:12px;color:${MUTED};margin:0 0 14px">${esc(matchLine)}</div>`,
      h3(listA),
      table(['Company', 'Intent', 'Who visited', 'In Prospector', 'Owner', 'Last touch'], top.map(cell)),
      ...(more > 0 ? [`<p style="margin:12px 0 0">and ${more} more · ${link(MAP_URL, 'open the Map →')}</p>`] : []),
    ] : [`<p>${esc(empty)}</p>`]),
    ...(overall ? [h3(listB, bookLine), book.length ? table(['Company', 'Intent', 'Trend', 'In Prospector', 'Owner', 'Last touch'], book.map(bookCell)) : `<p style="color:${MUTED}">No ranked companies yet</p>`] : []),
    ...(n || overall ? [`<p style="font-size:12px;color:${MUTED};margin:12px 0 0">${esc(LEGEND)}</p>`] : []),
  ].join('\n');
  const html = shell({ eyebrow: 'HomeLover · Website visitors', title: head, sub: sinceLine, body: body + (pullNote ? `\n<p style="color:${MUTED}"><i>${esc(pullNote)}</i></p>` : '') });
  return { subject, html, text, rows: top.length, more: Math.max(0, more), overall: book.length };
}

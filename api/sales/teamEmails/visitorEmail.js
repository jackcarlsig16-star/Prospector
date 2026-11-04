import { selectAllPages } from '../../lib/selectAllPages.js';
import { PRIORITY_WORD } from '../../../src/constants/salesChannels.js';
import { laClock } from './scheduler.js';
import { esc, page, link, recordUrl, MAP_URL, withFooter } from './format.js';

// homelover-team-emails-v1 T4 - the weekday visitor email. Pure builder over rows the loader reads; no person names,
// emails or phones ever reach it (people = a count + job titles).
export const TOP_N = 10;
export const BANDS = ['P1', 'P2', 'P3', 'P4'];
const bandWord = b => `${b} · ${PRIORITY_WORD[Number(String(b).slice(1))] || ''}`.trim();
const TYPE = { opportunity: 'employer', target: 'target', partner: 'partner' };
const KIND_LABEL = { employer: 'Employer', target: 'Target', partner: 'Partner' };
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const dayLabel = date => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).replace(',', '');
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
  let t = laInstant(date, at) - 864e5;
  while (![1, 2, 3, 4, 5].includes(laClock(t).dow)) t -= 864e5;
  const prev = laClock(t).date;
  return { since: laInstant(prev, at), until: laInstant(date, at) };
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
    ids('partner').length ? must(await supabase.from('sales_goals').select('id, name, pipeline_status, owner_user_id').eq('business_id', businessId).in('id', ids('partner'))) : [],
    must(await supabase.from('sales_company_scores').select('company_type, company_id, score, band').eq('business_id', businessId).in('company_id', [...ids('opportunity'), ...ids('target'), ...ids('partner')])),
    visits.length ? selectAllPages(() => supabase.from('sales_people').select('id, visit_id, title').eq('business_id', businessId).in('visit_id', visits.map(v => v.id)).is('archived_at', null).order('id')) : [],
  ]);
  const rec = new Map([
    ...opps.map(o => [o.id, { stage: o.client_status ? 'client' : o.stage, owner: o.owner_user_id }]),
    ...targets.map(t => [t.id, { stage: t.status, owner: t.owner_user_id }]),
    ...partners.map(p => [p.id, { stage: p.pipeline_status, owner: p.owner_user_id }]),
  ]);
  const score = new Map(scores.map(s => [`${s.company_type}:${s.company_id}`, s]));
  const nameOf = new Map(members.map(m => [m.userId, m.firstName]));
  return visits.map(v => {
    const type = TYPE[v.matched_type] || null;
    const s = type ? score.get(`${type}:${v.matched_id}`) : null;
    const r = type ? rec.get(v.matched_id) : null;
    const ppl = people.filter(p => p.visit_id === v.id);
    return {
      company: v.company_name, type, id: v.matched_id || null,
      score: s ? s.score : v.intent_score != null ? Math.round(Number(v.intent_score)) : null, band: s ? s.band : v.priority,
      visits: v.visits_7d || 0, visitors: v.unique_visitors_7d || 0, people: ppl.length, titles: [...new Set(ppl.map(p => p.title).filter(Boolean))].slice(0, 3),
      top_page: Array.isArray(v.top_paths) && v.top_paths[0] ? String(v.top_paths[0].path || v.top_paths[0]) : null,
      stage: r?.stage || null, owner: r?.owner ? nameOf.get(r.owner) || 'Unassigned' : 'Unassigned', is_new: !seenBefore.has(v.company_key),
    };
  });
}

// -> { subject, html, text, rows }. date = the LA date it is sent on; pullNote = the "Visitor pull failed …" line or null.
export function buildVisitorEmail(companies, { date, since, pullNote = null }) {
  const sorted = [...companies].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.visits - a.visits || a.company.localeCompare(b.company));
  const bands = Object.fromEntries(BANDS.map(b => [b, sorted.filter(c => c.band === b).length]));
  const subject = `Website visitors — ${dayLabel(date)}: ${sorted.length} ${sorted.length === 1 ? 'company' : 'companies'}, ${bands.P1} high intent`;
  const top = sorted.slice(0, TOP_N), more = sorted.length - top.length;
  const matched = t => sorted.filter(c => c.type === t).length;
  const stats = `${sorted.length} companies · ${sorted.filter(c => c.is_new).length} new · ${sorted.reduce((n, c) => n + c.visits, 0)} visits (7 d) · ${sorted.reduce((n, c) => n + c.visitors, 0)} distinct people where known`;
  const matchLine = `Matched: ${matched('employer')} employers · ${matched('target')} targets · ${matched('partner')} partners · ${sorted.filter(c => !c.type).length} unmatched`;
  const bandLine = BANDS.map(b => `${bandWord(b)}: ${bands[b]}`).join(' · ');
  const rowText = c => [
    `${c.company}${c.is_new ? ' [NEW]' : ''}`, `intent ${c.score ?? '—'} (${bandWord(c.band)})`, `${c.visits} visits`,
    `${c.people} ${c.people === 1 ? 'person' : 'people'}${c.titles.length ? ` (${c.titles.join(', ')})` : ''}`,
    c.top_page ? `top page ${c.top_page}` : null, c.type ? `${KIND_LABEL[c.type]}${c.stage ? ` · ${c.stage}` : ''}` : 'Not in Prospector', c.owner,
  ].filter(Boolean).join(' · ');
  const url = c => (c.type ? recordUrl(c.type, c.id) : MAP_URL);
  const empty = `No identified visitors since ${timeLabel(since)}`;
  const text = withFooter([
    subject, '',
    ...(sorted.length ? [stats, matchLine, `Intent: ${bandLine}`, '', ...top.map((c, i) => `${i + 1}. ${rowText(c)}\n   ${url(c)}`), ...(more > 0 ? [`and ${more} more → open the Map: ${MAP_URL}`] : [])] : [empty]),
    ...(pullNote ? ['', pullNote] : []),
  ].join('\n'));
  const html = page(subject, [
    ...(sorted.length ? [
      `<p>${esc(stats)}<br>${esc(matchLine)}</p>`, `<p><b>Intent</b> · ${esc(bandLine)}</p>`,
      `<ol>${top.map(c => `<li>${link(url(c), c.company)}${c.is_new ? ' <b style="color:#C97626">NEW</b>' : ''} · ${esc(rowText(c).split(' · ').slice(1).join(' · '))}</li>`).join('')}</ol>`,
      ...(more > 0 ? [`<p>and ${more} more → ${link(MAP_URL, 'open the Map')}</p>`] : []),
    ] : [`<p>${esc(empty)}</p>`]),
    ...(pullNote ? [`<p><i>${esc(pullNote)}</i></p>`] : []),
  ]);
  return { subject, html, text, rows: top.length, more: Math.max(0, more) };
}

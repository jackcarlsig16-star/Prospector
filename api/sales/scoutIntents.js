import { cleanText } from './scrubText.js';
import { normName } from './intakeMatch.js';
import { addDays } from './goalsShared.js';
import { readType } from './readType.js';
import { splitSnoozed } from './snoozed.js';

// scout-v2 REV2 Stage 1 (D1 (2)) - the sales module's intents: a parsed ask -> the EXISTING server read that answers it
// (never a second query layer) -> items for the context pack. Reads are reached through salesReads so tests swap them
// and so the heavy modules load only when an ask needs them. Every item: { entity, id, title, text, date? }.
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const lazy = (file, name) => async (...a) => (await import(file))[name](...a);
export const salesReads = {
  companyBrief: lazy('./companyBrief.js', 'companyBrief'),
  openTodosFor: lazy('./openTodos.js', 'openTodosFor'),
  loadVisitorData: lazy('./teamEmails/visitorEmail.js', 'loadVisitorData'),
  listScores: lazy('./scoresRoutes.js', 'listScores'),
  peopleActivity: lazy('./peopleActivityRoutes.js', 'peopleActivity'),
  loadPulse: lazy('./pulseRoutes.js', 'loadPulse'),
  sourcesFunnel: lazy('./sourceRoutes.js', 'sourcesFunnel'),
  attention: lazy('./attentionRoutes.js', 'attention'),
  listClients: lazy('./clients.js', 'listClients'),
  loadFunnel: lazy('./funnelRoutes.js', 'loadFunnel'),
  personDetail: lazy('./peopleActivityRoutes.js', 'personDetail'),
  topTargets: lazy('./topTargets.js', 'topTargets'),
};
const COMPANY_ENTITIES = new Set([null, 'partners', 'employers', 'targets', 'accounts']);
const day = v => (v ? String(v).slice(0, 10) : null);
// A call note's text in the context: 600 chars while 10 or fewer notes ride along, 300 beyond (Jack, Stage 3).
export const noteChars = n => (n <= 10 ? 600 : 300);
const daysAgo = (iso, now) => (iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / 864e5)) : null);
const pat = q => `%${String(q || '').replace(/[%_,()"'\\]/g, ' ').replace(/\s+/g, ' ').trim()}%`;
const ENTITY_OF = { partner: 'partners', employer: 'employers', target: 'targets' };

async function membersOf(sb, businessId) {
  const rows = must(await sb.from('business_members').select('user_id, name, profile:profiles!business_members_user_id_fkey(display_name)').eq('business_id', businessId).not('user_id', 'is', null));
  return rows.map(m => ({ userId: m.user_id, firstName: ((m.profile?.display_name || m.name || '').trim().split(/\s+/)[0]) || 'Member' }));
}

// A company named in the question -> the record (exact normalised name first, else the first ILIKE hit) across the
// three company tables.
export async function findCompany(sb, businessId, name) {
  const [partners, employers, targets] = await Promise.all([
    sb.from('sales_goals').select('id, name, company_domain').eq('business_id', businessId).eq('goal_type', 'partnership').is('archived_at', null).ilike('name', pat(name)).limit(5).then(must),
    sb.from('sales_opportunities').select('id, organization, domain').eq('business_id', businessId).is('archived_at', null).ilike('organization', pat(name)).limit(5).then(must),
    sb.from('sales_targets').select('id, name').eq('business_id', businessId).ilike('name', pat(name)).limit(5).then(must),
  ]);
  const cands = [...partners.map(p => ({ type: 'partner', id: p.id, name: p.name, domain: p.company_domain || null })), ...employers.map(o => ({ type: 'employer', id: o.id, name: o.organization, domain: o.domain || null })), ...targets.map(t => ({ type: 'target', id: t.id, name: t.name, domain: null }))];
  return cands.find(c => normName(c.name) === normName(name)) || cands[0] || null;
}

// A to-do's company link -> { entity, type, id, name } (the three record tables, one read each), keyed "type:id".
const LINK_TABLE = { partner: ['sales_goals', 'name'], employer: ['sales_opportunities', 'organization'], target: ['sales_targets', 'name'] };
async function linkNames(sb, businessId, rows) {
  const out = new Map();
  for (const [type, [table, col]] of Object.entries(LINK_TABLE)) {
    const ids = [...new Set(rows.filter(r => readType(r.link_type) === type && r.link_id).map(r => r.link_id))];
    if (!ids.length) continue;
    for (const x of must(await sb.from(table).select(`id, ${col}`).eq('business_id', businessId).in('id', ids))) out.set(`${type}:${x.id}`, { entity: ENTITY_OF[type], type, id: x.id, name: cleanText(x[col], 160) });
  }
  return out;
}

// D9: a person named in the question -> their People row (exact normalised name), when no company carries the name.
export async function findPerson(sb, businessId, name, today) {
  const r = await salesReads.peopleActivity(sb, businessId, { window: 'all', snoozed: 'all' });
  if (r.status !== 200) return null;
  const key = normName(name);
  return (key && r.body.rows.find(p => normName(p.name) === key)) || null;
}

// A people ask about the site: the entity word plus a visit verb, or site / website with a band word or a heat ranking
// and no company named ("hottest people on the site this week"); a company named goes to the brief instead.
export const isPeopleVisiting = ask => ask.entity === 'people' && (ask.flags.visitors || (ask.flags.site && (!!ask.band || ask.sort === 'heat' || ask.flags.ranked) && !ask.company.length));
// The people activity window the time phrase maps to (the route's 7 | 30 | 90 | all).
export const peopleWindow = (ask, dflt) => (!ask.since ? dflt : ask.since_kind?.startsWith('last ') && /\d+/.test(ask.since_kind) ? (Number(/\d+/.exec(ask.since_kind)[0]) <= 7 ? '7' : Number(/\d+/.exec(ask.since_kind)[0]) <= 30 ? '30' : '90') : ['today', 'yesterday', 'this week', 'last week'].includes(ask.since_kind) ? '7' : '30');
// A3: a band word on a people ask is a heat band - parseAsk says so (bandKind), the intent never guesses.
const HEAT_OF = { P1: 'hot', P2: 'warm', P3: 'cold', P4: 'cold' };
const PEOPLE_RULE = 'People ranked by heat, hottest first (email engagement plus the company on the site); snoozed people are hidden.';
// R6: the people reads hide a snoozed person until the day; the read line counts them.
const awake = (rows, today) => { const { shown, snoozed } = splitSnoozed(rows, today); return { rows: shown, hidden: snoozed.length ? ` · ${snoozed.length} snoozed hidden` : '' }; };
// R11: open to-dos by the rule - overdue first (longest overdue first), then due soonest, then undated; yours first on a tie.
export const TODO_RULE = 'Open to-dos ranked overdue first, then due soonest, then undated; yours first on a tie.';
export function rankTodos(rows, today, userId) {
  const group = r => (!r.due_date ? 2 : day(r.due_date) < today ? 0 : 1);
  return [...rows].sort((a, b) => group(a) - group(b) || String(a.due_date || '').localeCompare(String(b.due_date || '')) || (b.owner_user_id === userId) - (a.owner_user_id === userId) || String(b.created_at || '').localeCompare(String(a.created_at || '')) || String(a.id).localeCompare(String(b.id)));
}
const heatFilter = (rows, ask) => (ask.band && ask.bandKind === 'heat' ? rows.filter(p => p.heat_band === HEAT_OF[ask.band]) : rows);
// scout-v3 D1: a person is a ROW - name over title, the company link over its stage, heat on the one scale, last
// visit, last email. company.id is null when the person has no company record (ruling K4).
export const personRow = p => ({ kind: 'person', key: p.key, name: p.name, title: p.title || null, company: p.company ? { entity: ENTITY_OF[readType(p.company.type)] || null, type: readType(p.company.type), id: p.company.id || null, name: p.company.name, stage: p.company.stage || null } : null, heat: p.heat ?? null, heat_band: p.heat_band || null, last_visit: p.visits?.last_visit ? day(p.visits.last_visit) : null, last_path: p.visits?.top_page || null, last_email: p.last_email ? { at: day(p.last_email.at), what: p.last_email.what } : null, status: p.status || null, sequenced: String(p.key).startsWith('prospect:') });
const personItem = p => ({ company: p.company?.name || null, row: personRow(p), entity: 'people', id: p.key, title: p.name, score: p.heat ?? null, subtitle: [p.title, p.company?.name].filter(Boolean).join(' · ') || null, text: [p.name, p.title, p.company?.name ? `${p.company.name}${p.company.stage ? ` (${String(p.company.stage).replace(/_/g, ' ')})` : ''}` : null, p.source, `${p.emails.sent} sent · ${p.emails.opened} opened · ${p.emails.clicked} clicked · ${p.emails.replied} replied`, p.heat != null ? `heat ${p.heat} ${p.heat_band}` : null, p.last_email ? `last email ${day(p.last_email.at)} ${p.last_email.what}` : null, p.visits ? `company ${p.visits.visits_7d} visits 7 d${p.visits.last_visit ? ` · last ${day(p.visits.last_visit)}` : ''}` : null, p.identified_at ? `identified on the site ${p.identified_at}` : null, p.buyer ? 'buyer title' : null].filter(Boolean).join(' · ') });

// Each intent declares one example phrasing (A5): the fallback answer offers three, the `suggest` ones first.
// top-targets-v1 T5: "my top targets" / "Cyrus's top 5" / "why is Hilton a top target" read the ONE ranking
// (goals/top-targets: pins first, then score) - never the ranked intent's band words.
export const TOP_TARGETS_RULE = 'Top targets = the open companies in one order: pinned ones first (newest pin first), then intent score. Each row says why (size · visits this week · source · stage · pin reason) and its five bars: heat, fit, impact (source + stage), recency, pin.';
export const isTopTargets = ask => /\btop\s+(?:\d+\s+)?targets?\b/.test(String(ask.q || '').toLowerCase()) || /\b[a-z]+['’]s\s+top\s+\d+\b/.test(String(ask.q || '').toLowerCase());
const topItem = x => ({
  company: x.name, row: { kind: 'company', type: x.type, id: x.id, name: x.name, score: x.score ?? null, band: x.band || null, owner: x.owner || null, stage: x.stage || null },
  entity: ENTITY_OF[x.type], id: x.id, title: x.name, score: x.score ?? null, date: null,
  text: [x.name, x.type, `top target #${x.rank}`, `score ${x.score} ${x.band}`, `why: ${x.why}`, `bars: heat ${x.groups.heat} · fit ${x.groups.fit} · impact ${x.groups.impact} · recency ${x.groups.recency} · pin ${x.groups.pin}`, x.pin ? `${x.pin.held ? `held at P${x.pin.level}` : 'pinned'} · ${x.pin.days_left} d left` : null, x.owner ? `owner ${x.owner}` : 'unassigned'].filter(Boolean).join(' · '),
});

export const salesIntents = [
  { id: 'top_targets', example: "Cyrus's top 5 targets", title: 'Top targets', rule: TOP_TARGETS_RULE, match: isTopTargets,
    async run(sb, { businessId, auth, ask, now }) {
      const q = String(ask.q || '').toLowerCase();
      const members = await sb.from('business_members').select('user_id, name, profile:profiles!business_members_user_id_fkey(display_name)').eq('business_id', businessId).not('user_id', 'is', null).then(r => r.data || []);
      const named = members.find(m => { const first = String(m.profile?.display_name || m.name || '').trim().split(/\s+/)[0].toLowerCase(); return first && new RegExp(`\\b${first.replace(/[^a-z]/g, '')}(?:['’]s)?\\b`).test(q); });
      const owner = named ? named.user_id : ask.mine ? auth.user.id : '';
      // "why is Hilton a top target": the one company's row, wherever it ranks in the whole book
      if (ask.company.length && !named) {
        const r = await salesReads.topTargets(sb, businessId, { limit: 200 }, { now });
        const want = ask.company.map(c => normName(c));
        const hits = r.body.rows.filter(x => want.some(w => normName(x.name) === w || normName(x.name).includes(w)));
        return { read: `goals/top-targets {} · ${r.body.total} ranked · ${hits.length} named`, items: hits.slice(0, 3).map(topItem) };
      }
      const limit = ask.limit || Number(/\btop\s+(\d{1,2})\b/.exec(q)?.[1]) || 10;
      const query = { ...(owner ? { owner } : {}), limit };
      const r = await salesReads.topTargets(sb, businessId, query, { now, meId: auth.user.id });
      return { read: `goals/top-targets ${JSON.stringify(query)} · ${r.body.n} of ${r.body.total} · ${r.body.pinned} pinned`, items: r.body.rows.map(topItem) };
    } },
  // scout-v3 D9: a named company - or a named PERSON when no company carries the name - is a brief. A pronoun's
  // carried companies ("... my tasks for them") never re-open the brief. brief = the one record, for the brief header.
  { id: 'brief', example: 'what do we know about Hilton', title: 'Brief', context: true, rule: 'Everything on file for the record named: score, visits, people, notes and recent email.', match: ask => ask.company.length > 0 && !ask.carried,
    async run(sb, { businessId, ask, today }) {
      const items = [], reads = [], records = [];
      for (const name of ask.company.slice(0, 2)) {
        const c = await findCompany(sb, businessId, name);
        if (!c) {
          const person = await findPerson(sb, businessId, name, today);
          if (!person) { reads.push(`no company or person named "${cleanText(name, 60)}"`); continue; }
          reads.push(`goals/people/activity/${person.key}`);
          records.push({ entity: 'people', id: person.key });
          items.push(personItem(person));
          const d = await salesReads.personDetail(sb, businessId, { key: person.key });
          if (d.status === 200) {
            for (const t of d.body.timeline.filter(x => !x.automated).slice(0, 8)) items.push({ entity: 'people', id: person.key, title: person.name, text: `${person.name} · ${t.kind}${t.step != null ? ` step ${t.step}` : ''}${t.reply_class ? ` (${t.reply_class})` : ''} · ${day(t.at)}${t.subject ? ` · ${t.subject}` : ''}` });
            if (d.body.notes) items.push({ entity: 'people', id: person.key, title: person.name, text: `${person.name} · note: ${d.body.notes}` });
          }
          continue;
        }
        const r = await salesReads.companyBrief(sb, { businessId, type: c.type, id: c.id });
        reads.push(`goals/brief/${c.type}/${c.id}`);
        if (r.status !== 200) continue;
        const entity = ENTITY_OF[c.type];
        records.push({ entity, id: c.id });
        const row = { kind: 'company', type: c.type, id: c.id, name: r.body.company.name, score: r.body.score?.score ?? null, band: r.body.score?.band || null };
        items.push({ company: r.body.company.name, row, entity, id: c.id, title: r.body.company.name, text: `${r.body.company.name} · ${c.type}${r.body.score ? ` · intent ${r.body.score.score} ${r.body.score.band}` : ''}${r.body.next_step ? ` · next: ${r.body.next_step}` : ''}` });
        for (const l of r.body.lines) items.push({ entity, id: c.id, title: r.body.company.name, text: `${r.body.company.name} · ${l.kind}: ${l.text}` });
        if (c.domain) {
          const msgs = must(await sb.from('microsoft_messages').select('graph_id, subject, direction, occurred_at, external_domains').eq('business_id', businessId).contains('external_domains', [c.domain]).order('occurred_at', { ascending: false }).limit(8));
          for (const m of msgs) items.push({ entity: 'outlook', id: m.graph_id, title: cleanText(m.subject || '(no subject)', 120), date: day(m.occurred_at), text: `${cleanText(m.subject || '(no subject)', 120)} · ${m.direction === 'sent' ? 'email sent' : 'email received'} · ${day(m.occurred_at)} · ${c.domain}` });
        }
      }
      return { read: reads.join(' + '), items, total: records.length, brief: records.length === 1 ? records[0] : null };
    } },
  // scout-v3 R11: the open list by the rule, never filtered by the question's leftover words; a company named (or
  // carried by a pronoun from the part before) narrows it to that company's to-dos - by link, else by its name in the text.
  { id: 'todos', example: 'show me my open tasks', title: 'Tasks', rule: TODO_RULE, match: ask => ask.entity === 'todos',
    async run(sb, { businessId, auth, ask, today }) {
      const { rows, total } = await salesReads.openTodosFor(sb, businessId, ask.mine ? auth.user.id : null);
      let kept = rows.filter(r => !ask.since || (r.due_date && day(r.due_date) >= ask.since && (!ask.until || day(r.due_date) <= ask.until)) || (!r.due_date && day(r.created_at) >= ask.since));
      let of = '';
      if (ask.company.length) {
        const found = (await Promise.all(ask.company.map(n => findCompany(sb, businessId, n)))).filter(Boolean);
        const names = ask.company.map(n => n.toLowerCase());
        kept = kept.filter(r => found.some(c => readType(r.link_type) === c.type && String(r.link_id) === String(c.id)) || names.some(n => String(r.text || '').toLowerCase().includes(n)));
        of = ` · for ${ask.company.map(n => cleanText(n, 60)).join(', ')}`;
      }
      const matched = kept.length;
      kept = rankTodos(kept, today, auth.user.id).slice(0, 40);
      const linkName = await linkNames(sb, businessId, kept);
      const owner = r => (r.owner_user_id ? (r.owner_user_id === auth.user.id ? 'mine' : 'another owner') : 'unassigned');
      return { read: `openTodos (${total} open${ask.mine ? ', mine' : ''})${of}`, total: matched, items: kept.map(r => ({ entity: 'todos', id: r.id, title: cleanText(r.text, 140), date: day(r.due_date),
        row: { kind: 'task', id: r.id, text: cleanText(r.text, 200), due: day(r.due_date), overdue: !!r.due_date && day(r.due_date) < today, owner: owner(r), owner_user_id: r.owner_user_id || null, link: linkName.get(`${readType(r.link_type)}:${r.link_id}`) || null },
        text: [cleanText(r.text, 200), 'open to-do', r.due_date ? `due ${day(r.due_date)}${day(r.due_date) < today ? ' (overdue)' : ''}` : 'no date', owner(r), r.steps?.length ? `${r.steps.filter(x => x.done).length}/${r.steps.length} steps` : null].filter(Boolean).join(' · ') })) };
    } },
  { id: 'visitors', example: 'who visited yesterday', suggest: true, match: ask => ask.flags.visitors && ask.entity !== 'people' && !ask.flags.email_site,
    async run(sb, { businessId, ask, today }) {
      const last = ask.until || addDays(today, -1);
      const first = ask.since || last;
      const days = []; for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);
      const w = { date: today, days, first, last };
      const rows = await salesReads.loadVisitorData(sb, businessId, { window: w, members: await membersOf(sb, businessId) });
      const ranked = [...rows].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (b.visitors || 0) - (a.visitors || 0)).slice(0, 40);
      return { read: `visitors ${first}${last !== first ? ` to ${last}` : ''} · ${rows.length} companies`, items: ranked.map(c => ({ company: c.company, row: c.type ? { kind: 'company', type: c.type, id: c.id, name: c.company, score: c.score ?? null, band: c.band || null } : null, entity: c.type ? ENTITY_OF[c.type] : 'visitor', id: c.type ? c.id : c.visit_id, title: c.company, score: c.score ?? null, text: [c.company, c.band ? `${c.band}${c.score != null ? ` score ${c.score}` : ''}` : null, `${c.visits} visits · ${c.visitors} visitors · ${c.pages} pages${c.paths?.length ? ` (${c.paths.join(', ')})` : ''}`, c.people ? `${c.people} named people${c.titles?.length ? ` (${c.titles.join('; ')})` : ''}` : null, c.is_new ? 'new to the site' : 'returning', c.type ? `in Prospector as ${c.type} · ${c.stage || 'no stage'} · owner ${c.owner}` : 'not in Prospector yet', c.last_touch ? `last touch ${day(c.last_touch.at)}${c.last_touch.what ? ` ${c.last_touch.what}` : ''}` : null].filter(Boolean).join(' · ') })) };
    } },
  { id: 'ranked', example: 'hot targets Brad referred', match: ask => COMPANY_ENTITIES.has(ask.entity) && !ask.flags.visitors && !ask.flags.emails && !ask.flags.attention && (ask.flags.ranked || !!ask.band || !!ask.source || (!!ask.entity && (ask.mine || !!ask.since)) || (ask.flags.funnel && !!ask.band)),
    async run(sb, { businessId, auth, ask, now }) {
      const segment = { partners: 'partners', employers: 'employers', targets: 'targets' }[ask.entity] || 'all';
      const query = { segment, band: ask.band || '', source: ask.source || '', owner: ask.mine ? auth.user.id : '', sort: ask.sort === 'date' ? 'newest' : 'rank' };
      const r = await salesReads.listScores(sb, businessId, query, { now });
      let rows = r.body.rows;
      if (ask.since) rows = rows.filter(x => x.last_touch_at && day(x.last_touch_at) >= ask.since && (!ask.until || day(x.last_touch_at) <= ask.until));
      rows = rows.slice(0, 40);
      return { read: `goals/scores ${JSON.stringify(query)}${ask.since ? ` touched since ${ask.since}` : ''} · ${r.body.counts.shown} shown`, items: rows.map(x => ({ company: x.name, row: { kind: 'company', type: x.type, id: x.id, name: x.name, score: x.score ?? null, band: x.band || null, owner: x.owner || null, stage: x.stage || null }, entity: ENTITY_OF[x.type], id: x.id, title: x.name, score: x.score ?? null, date: day(x.last_touch_at), text: [x.name, x.type, `score ${x.score} ${x.band}`, `rank ${x.rank}`, x.source_label ? `source ${x.source_label}${x.co_owner_name ? ` (${x.co_owner_name})` : ''}` : null, x.stage ? `stage ${String(x.stage).replace(/_/g, ' ')}` : null, x.owner ? `owner ${x.owner}` : 'unassigned', x.last_touch_at ? `last touch ${day(x.last_touch_at)} · ${daysAgo(x.last_touch_at, now)} d ago` : 'never touched', x.visits_7d ? `${x.visits_7d} visits 7 d` : null, x.due ? `due ${x.due}` : null].filter(Boolean).join(' · ') })) };
    } },
  // FIX scout-ask-routing-v1 A2: people whose company is on the site (or who were identified there) in the window,
  // hottest first - "who's our hottest person visiting the website". Sits between 'visitors' (companies) and 'people'.
  { id: 'people_visiting', example: 'hottest people on the site this week', suggest: true, title: 'People on the site', rule: `${PEOPLE_RULE} Only people whose company visited, or who were identified on the site, in the window.`, match: isPeopleVisiting,
    async run(sb, { businessId, ask, today }) {
      const win = peopleWindow(ask, '7');
      const r = await salesReads.peopleActivity(sb, businessId, { window: win });
      if (r.status !== 200) return { read: `goals/people/activity (${r.status})`, items: [] };
      const since = ask.since || addDays(today, -6);
      const up = awake(r.body.rows, today);
      let rows = up.rows.filter(p => (p.visits && p.visits.visits_7d > 0 && (!p.visits.seen_to || p.visits.seen_to >= since)) || (p.identified_at && p.identified_at >= since));
      rows = heatFilter(rows, ask);
      rows.sort((a, b) => (b.heat ?? -1) - (a.heat ?? -1) || String(b.visits?.last_visit || b.identified_at || '').localeCompare(String(a.visits?.last_visit || a.identified_at || '')));
      return { read: `people whose company visited (${ask.since_kind || '7 d'}) · ${rows.length} · by heat${up.hidden}`, total: rows.length, items: rows.slice(0, 25).map(personItem) };
    } },
  { id: 'people', example: 'who opened our emails', title: 'People', rule: PEOPLE_RULE, match: ask => !isPeopleVisiting(ask) && (ask.entity === 'people' || ((ask.flags.opened || ask.flags.replied || ask.flags.clicked) && !ask.flags.emails)),
    async run(sb, { businessId, ask, today }) {
      const win = peopleWindow(ask, 'all');
      const r = await salesReads.peopleActivity(sb, businessId, { window: win });
      if (r.status !== 200) return { read: `goals/people/activity (${r.status})`, items: [] };
      const up = awake(r.body.rows, today);
      let rows = heatFilter(up.rows, ask);
      if (ask.flags.replied) rows = rows.filter(p => p.emails.replied > 0); else if (ask.flags.clicked) rows = rows.filter(p => p.emails.clicked > 0); else if (ask.flags.opened) rows = rows.filter(p => p.emails.opened > 0);
      if (ask.terms.length) rows = rows.filter(p => ask.terms.some(t => `${p.name} ${p.title || ''} ${p.company?.name || ''}`.toLowerCase().includes(t)));
      return { read: `goals/people/activity?window=${win} (${r.body.rows.length} people)${up.hidden}`, total: rows.length, items: rows.slice(0, 40).map(personItem) };
    } },
  // email-funnel-v1 F7: the two rates and the funnel steps straight from the funnel route (funnelMath, the one function),
  // so Scout's answer carries the same numbers as the daily email and the Web visitors page.
  { id: 'email_site', example: "what's our email to site rate", match: ask => ask.flags.email_site,
    async run(sb, { businessId, now }) {
      const r = await salesReads.loadFunnel(sb, businessId, { windows: ['yesterday', '7d', '30d'], now });
      if (r.status !== 200) return { read: `goals/funnel (${r.status})`, items: [] };
      const pct = x => (x == null ? '—' : `${(100 * x).toFixed(1)} %`);
      const items = [];
      for (const w of Object.values(r.body.windows)) {
        const label = w.key === 'yesterday' ? 'yesterday' : w.key === '7d' ? 'last 7 days' : 'last 30 days';
        items.push({ entity: 'funnel', id: `email_site:${w.key}`, title: `Email → site, ${label}`, text: `email to site ${label} (${w.from} → ${w.to}) · company rate ${pct(w.company_rate.rate)} = ${w.company_rate.n} of ${w.company_rate.d} companies emailed visited the site in the window (${w.companies_no_record} without a record) · person rate ${pct(w.person_rate.rate)} = ${w.person_rate.n} of ${w.person_rate.d} people emailed were identified on the site · of ${w.delivered} emails delivered, so far: ${w.human_opens} human opens · ${w.human_clicks} clicks · ${w.replies} replies · ${w.meetings} meetings booked${w.companies_visited_names.length ? ` · visited: ${w.companies_visited_names.join(', ')}` : ''}` });
      }
      items.push({ entity: 'funnel', id: 'email_site:how', title: 'How the email → site rates are computed', text: `${r.body.wording.company} ${r.body.wording.person} ${r.body.wording.since}${r.body.ready ? '' : ' Delivered rows do not reach that day yet, so no rate is shown in the email.'}` });
      return { read: 'goals/funnel?windows=yesterday,7d,30d', items };
    } },
  { id: 'emails', example: 'how are our emails doing this month', match: ask => !ask.flags.email_site && (ask.flags.emails || ask.entity === 'emails'),
    async run(sb, { businessId, ask, now }) {
      const period = ask.since_kind === 'this week' || ask.since_kind === 'last week' ? 'week' : 'month';
      const p = await salesReads.loadPulse(sb, businessId, { period }, new Date(now));
      const items = [];
      const walk = (obj, path) => { for (const [k, v] of Object.entries(obj || {})) { if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, [...path, k]); else if (typeof v === 'number' || typeof v === 'string') items.push({ entity: 'pulse', id: [...path, k].join('.'), title: `Pulse ${period}: ${[...path, k].join(' ')}`, text: `pulse ${period} · ${[...path, k].join(' ')} = ${v}` }); } };
      walk(p, []);
      return { read: `goals/pulse?period=${period}`, items: items.slice(0, 80) };
    } },
  { id: 'funnel', example: 'show me the referral funnel', match: ask => ask.flags.funnel && !ask.flags.email_site && !ask.band && !ask.company.length && ask.entity !== 'people',
    async run(sb, { businessId, now }) {
      const r = await salesReads.sourcesFunnel(sb, { businessId, query: {}, now });
      if (r.status !== 200) return { read: `goals/sources/funnel (${r.status})`, items: [] };
      const t = r.body.totals, items = [{ entity: 'funnel', id: 'totals', title: 'Funnel totals', text: `funnel totals · ${Object.entries(t).filter(([k, v]) => typeof v === 'number').map(([k, v]) => `${k} ${v}`).join(' · ')}` }];
      for (const g of [...(r.body.by_rep || []), ...(r.body.by_partner || [])].slice(0, 30)) items.push({ entity: 'funnel', id: g.key || g.label, title: g.label || g.key, text: `funnel ${g.label || g.key} · ${Object.entries(g).filter(([k, v]) => typeof v === 'number').map(([k, v]) => `${k} ${v}`).join(' · ')}` });
      return { read: 'goals/sources/funnel', items };
    } },
  { id: 'attention', example: 'what needs attention', match: ask => ask.flags.attention,
    async run(sb, { businessId, auth, now }) {
      const a = await salesReads.attention(sb, { businessId, userId: auth.user.id, now });
      const items = (a.sources || []).map(s => ({ entity: 'attention', id: s.id, title: s.label || s.id, text: `attention ${s.id} · ${s.status}${s.text ? ` · ${cleanText(s.text, 200)}` : ''}` }));
      items.push({ entity: 'attention', id: 'counts', title: 'Needs attention counts', text: `attention counts · ${Object.entries(a.counts || {}).map(([k, v]) => `${k} ${v}`).join(' · ')}` });
      return { read: 'goals/attention', items };
    } },
  { id: 'clients', example: 'list our clients', match: ask => ask.entity === 'clients' && !ask.company.length,
    async run(sb, { businessId }) {
      const r = await salesReads.listClients(sb, { businessId });
      return { read: `clients (${r.body?.totals?.clients ?? 0})`, items: (r.body?.clients || []).slice(0, 40).map(c => ({ entity: 'clients', id: c.id, title: c.name, text: [c.name, `client ${c.client_status}`, c.covered_lives != null ? `${c.covered_lives} covered lives` : null, c.launch_date ? `launch ${day(c.launch_date)}` : null, c.referred_by?.name ? `referred by ${c.referred_by.name}` : c.source_kind ? `source ${c.source_kind}` : null, c.owner ? `owner ${c.owner}` : null].filter(Boolean).join(' · ') })) };
    } },
  { id: 'notes', example: 'notes about Hilton', suggest: true, match: ask => ask.entity === 'call_notes',
    async run(sb, { businessId, ask }) {
      let q = sb.from('sales_call_notes').select('id, title, call_date, text').eq('business_id', businessId);
      if (ask.since) q = q.gte('call_date', ask.since);
      if (ask.until) q = q.lte('call_date', ask.until);
      const term = ask.company[0] || ask.terms[0];
      if (term) q = q.or(`title.ilike.${pat(term)},text.ilike.${pat(term)}`);
      const rows = must(await q.order('call_date', { ascending: false }).limit(25));
      return { read: `call notes${ask.since ? ` since ${ask.since}` : ''}${term ? ` matching "${cleanText(term, 40)}"` : ''} · ${rows.length}`, items: rows.map(r => ({ entity: 'call_notes', id: r.id, title: cleanText(r.title || 'Call note', 120), date: day(r.call_date), text: `${cleanText(r.title || 'Call note', 120)} · ${day(r.call_date)} · ${cleanText(r.text, noteChars(rows.length))}` })) };
    } },
];

// The fallback ask's standing context: the caller's open to-dos (≤ 30), notes from 14 d (≤ 10), companies touched in
// 14 d (≤ 20, the Map's rows).
export async function salesStanding(sb, { businessId, auth, today, now }) {
  const since = addDays(today, -14);
  const [todos, notes, scores] = await Promise.all([
    salesReads.openTodosFor(sb, businessId, auth.user.id, { cap: 30 }),
    sb.from('sales_call_notes').select('id, title, call_date, text').eq('business_id', businessId).gte('call_date', since).order('call_date', { ascending: false }).limit(10).then(must),
    salesReads.listScores(sb, businessId, {}, { now }).catch(() => ({ body: { rows: [] } })),
  ]);
  const touched = scores.body.rows.filter(r => r.last_touch_at && day(r.last_touch_at) >= since).sort((a, b) => String(b.last_touch_at).localeCompare(String(a.last_touch_at))).slice(0, 20);
  return {
    reads: [`my open to-dos (${todos.total})`, `notes since ${since} (${notes.length})`, `companies touched since ${since} (${touched.length})`],
    items: [
      ...todos.rows.map(r => ({ entity: 'todos', id: r.id, title: cleanText(r.text, 140), date: day(r.due_date), text: [cleanText(r.text, 160), 'my open to-do', r.due_date ? `due ${day(r.due_date)}` : 'no date'].join(' · ') })),
      ...notes.map(r => ({ entity: 'call_notes', id: r.id, title: cleanText(r.title || 'Call note', 120), date: day(r.call_date), text: `${cleanText(r.title || 'Call note', 120)} · ${day(r.call_date)} · ${cleanText(r.text, noteChars(notes.length))}` })),
      ...touched.map(x => ({ entity: ENTITY_OF[x.type], id: x.id, title: x.name, text: [x.name, x.type, `score ${x.score} ${x.band}`, `last touch ${day(x.last_touch_at)}${x.last_touch_channel ? ` ${x.last_touch_channel}` : ''}`, x.owner ? `owner ${x.owner}` : null].filter(Boolean).join(' · ') })),
    ],
  };
}

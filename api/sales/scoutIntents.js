import { cleanText, hasPii } from './scrubText.js';
import { normName } from './normName.js';
import { addDays, laMonday } from './goalsShared.js';
import { splitSnoozed } from './snoozed.js';
import { laDateString } from './laDate.js';

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
  loadWeekly: lazy('./weeklyRoutes.js', 'loadWeekly'),
  loadToday: lazy('./todayRoutes.js', 'loadToday'),
  listCalls: lazy('./callLinks.js', 'listCalls'),
  recordCallIds: lazy('./callLinks.js', 'recordCallIds'),
};
const COMPANY_ENTITIES = new Set([null, 'partners', 'employers', 'targets', 'accounts']);
const day = v => (v ? String(v).slice(0, 10) : null);
// A call note's text in the context: 600 chars while 10 or fewer notes ride along, 300 beyond (Jack, Stage 3).
export const noteChars = n => (n <= 10 ? 600 : 300);
const daysAgo = (iso, now) => (iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / 864e5)) : null);
const pat = q => `%${String(q || '').replace(/[%_,()"'\\]/g, ' ').replace(/\s+/g, ' ').trim()}%`;
const ENTITY_OF = { partner: 'partners', employer: 'employers', target: 'targets' };

// fathom-notes-v1 F-10: Scout reads a stored call note before any member has accepted it (a Fathom recording waiting
// for its review) - and every line and count that includes one says so. Nothing from it is on a record yet.
export const UNREVIEWED = 'unreviewed';
export const UNREVIEWED_RULE = 'A line marked unreviewed comes from call notes no member has accepted yet: nothing in it is on a record, and anything quoted from it carries "(unreviewed)".';
const unreviewedOf = rows => { const n = rows.filter(r => !r.accepted_at).length; return n ? ` · ${n} ${UNREVIEWED}` : ''; };
const NOTE_COLS = 'id, title, call_date, text, accepted_at';
const noteTitle = r => cleanText(r.title || 'Call note', 120);
const noteItem = (r, chars) => ({ entity: 'call_notes', id: r.id, title: noteTitle(r), subtitle: [day(r.call_date), r.accepted_at ? null : UNREVIEWED].filter(Boolean).join(' · '), date: day(r.call_date),
  text: [noteTitle(r), day(r.call_date), r.accepted_at ? null : UNREVIEWED, cleanText(r.text, chars)].filter(Boolean).join(' · ') });

// fathom-notes-v1 F7: "review the Seif call" · "what did we agree with MetLife yesterday" · "ideas from calls this
// month" read the stored notes and the extract kept on each (decisions, what they owe us, ideas) - no second model
// call, and nothing here writes.
const IDEAS_ASK = /\bideas?\b[^.?!]{0,40}\b(?:calls?|notes|meetings?)\b/;
const REVIEW_ASK = /\breview\b[^.?!]{0,80}\bcalls?\b/;
const AGREED_ASK = /\bwhat (?:did|have) we (?:agree|agreed|decide|decided|discuss|discussed|talk about|talked about)\b|\bwhat was (?:agreed|decided|discussed)\b|\bagreed? (?:to |on )?with\b/;
const plainQ = ask => String(ask.q || '').toLowerCase().replace(/['’]/g, '');
export const callAsk = ask => { const t = plainQ(ask); return IDEAS_ASK.test(t) ? 'ideas' : REVIEW_ASK.test(t) ? 'review' : AGREED_ASK.test(t) ? 'agreed' : null; };
const TIME_TAIL = /\s+(?:yesterday|today|this (?:week|month)|last (?:week|month)|on (?:the|that|our) call|in (?:the|that|our) call)\b.*$/;
const NO_NAME = new Set(['', 'last', 'latest', 'recent', 'most recent', 'newest', 'todays', 'yesterdays', 'this weeks', 'last weeks']);
export function callTerm(ask) {
  const t = plainQ(ask).replace(/[?.!]+\s*$/, '');
  const named = (/\breview (?:the |my |our |that )?(.+?) calls?\b/.exec(t)?.[1] || /\bwith (.+)$/.exec(t)?.[1] || '').replace(TIME_TAIL, '').replace(/^(?:the|our) /, '').trim();
  if (callAsk(ask) === 'agreed' && ask.company[0]) return ask.company[0];
  return NO_NAME.has(named) ? ask.company[0] || null : named.replace(/ (?:team|folks|people)$/, '').slice(0, 60);
}
// fathom-notes-v1 REV 2 F13: "calls this week" · "unreviewed calls" · "what calls did we have with Aon" · "last call
// with Hilton" list the Calls log (the view sales_calls_v through listCalls): names, dates, status, company. No model.
const CALL_WORD = /\b(?:calls?|recordings?)\b/;
const UNREVIEWED_ASK = /\bunreviewed\b|\bnot (?:yet )?reviewed\b/;
const LAST_CALL_ASK = /\b(?:last|latest|most recent|newest) (?:call|recording)\b/;
const CALL_LIST_ASK = /\b(?:this|last) (?:week|month)\b|\btoday\b|\byesterday\b|\b(?:calls?|recordings?) (?:did we have |have we had |we had )?with\b|\bwhat calls\b|\b(?:list|show)(?: me)?(?: (?:our|my|the|all))? (?:calls|recordings)\b/;
export const callsAsk = ask => { const t = plainQ(ask); return !callAsk(ask) && CALL_WORD.test(t) && (UNREVIEWED_ASK.test(t) || LAST_CALL_ASK.test(t) || CALL_LIST_ASK.test(t)); };
const callLogItem = c => ({ entity: 'call_notes', id: c.id, title: c.title, subtitle: [day(c.call_date), c.record?.name, c.status === 'reviewed' ? null : UNREVIEWED].filter(Boolean).join(' · '), date: day(c.call_date),
  text: [c.title, day(c.call_date), c.record ? `about ${c.record.name} (${c.record.type})` : 'no company linked', c.status === 'reviewed' ? `reviewed ${day(c.reviewed_at)}` : c.status === 'no_proposal' ? `${UNREVIEWED}, not read yet` : UNREVIEWED,
    c.member?.name ? `recorded by ${c.member.name}` : null, c.attendees.total ? `${c.attendees.total} invited (${c.attendees.external} external)` : null, c.duration_seconds ? `${Math.round(c.duration_seconds / 60)} min` : null, c.source].filter(Boolean).join(' · ') });
const CALL_LINES = 12;
function callItems(r) {
  const mark = r.accepted_at ? '' : ` (${UNREVIEWED})`;
  const line = words => ({ entity: 'call_notes', id: r.id, title: noteTitle(r), subtitle: [day(r.call_date), r.accepted_at ? null : UNREVIEWED].filter(Boolean).join(' · '), date: day(r.call_date), text: `${noteTitle(r)} · ${day(r.call_date)} · ${words}` });
  const of = k => (Array.isArray(r.extract?.[k]) ? r.extract[k] : []).filter(x => x && typeof x.text === 'string' && x.text.trim());
  const decisions = of('decisions').map(d => line(`decision${mark}: ${d.company ? `${cleanText(d.company, 80)}: ` : ''}${cleanText(d.text, 300)}`));
  const waiting = of('waiting_on').map(w => line(`waiting on ${cleanText(w.who || w.company || 'them', 80)}${mark}: ${cleanText(w.text, 300)}${w.due_date ? ` · due ${day(w.due_date)}` : ''}`));
  const none = r.extract ? [] : [line(`not read yet${mark}: these notes hold no extract - Extract on Today reads them`)];
  return { decisions: decisions.length, waiting: waiting.length, items: [noteItem(r, 600), ...[...decisions, ...waiting].slice(0, CALL_LINES), ...none] };
}

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
    const ids = [...new Set(rows.filter(r => r.link_type === type && r.link_id).map(r => r.link_id))];
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
// scout-v3.1 C3 - count-fill: the ask names a count and a band, and the band alone yields fewer -> the next bands of the
// SAME read fill the list up to the count (hot -> warm -> cold for people, P1 -> P2 -> P3 for companies), each row
// keeping its real band, never past the rows the read holds. The pill and the read line say so, in words:
// "5 people · 1 hot · 4 warm to make 5". -> { rows, fill | null }.
const HEAT_ORDER = ['hot', 'warm', 'cold'];
export const INTENT_ORDER = ['P1', 'P2', 'P3'];
const INTENT_WORD = { P1: 'hot', P2: 'warm', P3: 'cool' };
export function fillWords(noun, asked, counts) {
  const got = counts.reduce((n, c) => n + c.n, 0);
  return `${got} ${noun} · ${counts.map((c, i) => `${c.n} ${c.band}${i > 0 && i === counts.length - 1 ? ` to make ${got}` : ''}`).join(' · ')}${got < asked ? ` (${asked} asked - that is every one on file)` : ''}`;
}
export function fillPeople(all, ask) {
  const strict = heatFilter(all, ask);
  const band = ask.band && ask.bandKind === 'heat' ? HEAT_OF[ask.band] : null;
  if (!band || !ask.limit || strict.length >= ask.limit) return { rows: strict, fill: null };
  const rows = [...strict], counts = [{ band, n: strict.length }];
  for (const next of HEAT_ORDER.slice(HEAT_ORDER.indexOf(band) + 1)) {
    if (rows.length >= ask.limit) break;
    const more = all.filter(p => p.heat_band === next).slice(0, ask.limit - rows.length);
    if (more.length) { rows.push(...more); counts.push({ band: next, n: more.length }); }
  }
  return counts.length > 1 ? { rows, fill: { asked: ask.limit, strict: strict.length, counts, text: fillWords('people', ask.limit, counts) } } : { rows: strict, fill: null };
}
// scout-v3 D1: a person is a ROW - name over title, the company link over its stage, heat on the one scale, last
// visit, last email. company.id is null when the person has no company record (ruling K4).
export const personRow = p => ({ kind: 'person', key: p.key, name: p.name, title: p.title || null, company: p.company ? { entity: ENTITY_OF[p.company.type] || null, type: p.company.type, id: p.company.id || null, name: p.company.name, stage: p.company.stage || null } : null, heat: p.heat ?? null, heat_band: p.heat_band || null, last_visit: p.visits?.last_visit ? day(p.visits.last_visit) : null, last_path: p.visits?.top_page || null, last_email: p.last_email ? { at: day(p.last_email.at), what: p.last_email.what } : null, status: p.status || null, sequenced: String(p.key).startsWith('prospect:') });
const personItem = p => ({ company: p.company?.name || null, row: personRow(p), entity: 'people', id: p.key, title: p.name, score: p.heat ?? null, subtitle: [p.title, p.company?.name].filter(Boolean).join(' · ') || null, text: [p.name, p.title, p.company?.name ? `${p.company.name}${p.company.stage ? ` (${String(p.company.stage).replace(/_/g, ' ')})` : ''}` : null, p.source, `${p.emails.sent} sent · ${p.emails.opened} opened · ${p.emails.clicked} clicked · ${p.emails.replied} replied`, p.heat != null ? `heat ${p.heat} ${p.heat_band}` : null, p.last_email ? `last email ${day(p.last_email.at)} ${p.last_email.what}` : null, p.visits ? `company ${p.visits.visits_7d} visits 7 d${p.visits.last_visit ? ` · last ${day(p.visits.last_visit)}` : ''}` : null, p.identified_at ? `identified on the site ${p.identified_at}` : null, p.buyer ? 'buyer title' : null].filter(Boolean).join(' · ') });

// Each intent declares one example phrasing (A5): the fallback answer offers three, the `suggest` ones first.
// top-targets-v1 T5: "my top targets" / "Cyrus's top 5" / "why is Hilton a top target" read the ONE ranking
// (goals/top-targets: pins first, then score) - never the ranked intent's band words.
export const TOP_TARGETS_RULE = 'Top targets = the open companies in one order: pinned ones first (newest pin first), then intent score. Each row says why (size · visits this week · source · stage · pin reason) and its five bars: heat, fit, impact (source + stage), recency, pin.';
export const isTopTargets = ask => /\btop\s+(?:\d+\s+)?targets?\b/.test(String(ask.q || '').toLowerCase()) || /\b[a-z]+['’]s\s+top\s+\d+\b/.test(String(ask.q || '').toLowerCase());
const topItem = x => ({
  company: x.name, row: { kind: 'company', type: x.type, id: x.id, name: x.name, score: x.score ?? null, band: x.band || null, owner: x.owner || null, stage: x.stage || null },
  entity: ENTITY_OF[x.type], id: x.id, title: x.name, score: x.score ?? null, date: null,
  text: [x.name, x.type, `top target #${x.rank}`, `score ${x.score} ${x.band}`, `why: ${x.why.full}`, `bars: heat ${x.groups.heat} · fit ${x.groups.fit} · impact ${x.groups.impact} · recency ${x.groups.recency} · pin ${x.groups.pin}`, x.pin ? `${x.pin.held ? `held at P${x.pin.level}` : 'pinned'} · ${x.pin.days_left} d left` : null, x.owner ? `owner ${x.owner}` : 'unassigned'].filter(Boolean).join(' · '),
});

export const WEEKLY_RULE = 'Weekly funnel: every number is this week to date against the same point last week; pace is a projection for counts only; a goal is the one typed for that week.';
// email-by-member-v1 M6: "how is Cyrus's open rate trending", "my emails this week", "who sent the most this week" -
// the same registry route read for one member (goals/weekly?member=), or for every sending member side by side.
export const MEMBER_EMAIL_RULE = "By member: a member's email numbers are the emails sent from the mailboxes mapped to that member, this week to date against the same point last week; goals are team numbers and are not shown per member.";
const WHO_SENT = /\bwho\b[^.?!]{0,40}\b(sent|emailed|delivered)\b|\b(sent|emailed)\b[^.?!]{0,24}\bmost\b/;
export const isMemberEmail = ask => !ask.flags.email_site && !ask.company.length && (WHO_SENT.test(String(ask.q || '').toLowerCase()) || ((!!ask.member || !!ask.mine) && (!!ask.flags.weekly || !!ask.flags.emails || ask.entity === 'emails')));
export const isWeekly = ask => !!ask.flags.weekly && !ask.flags.email_site && !ask.company.length && !isMemberEmail(ask);
const wkNum = (x, v) => (v == null ? '—' : x.unit === 'rate' ? `${(100 * v).toFixed(1)} %` : String(Math.round(v * 10) / 10));
// E-5 (email-by-member rulings): every week in the line carries its dates, newest first, and a week with nothing in it
// says so in words - an undated oldest-first list was read backwards, an 11-week-old rate called "this week".
const shortDay = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const weekRange = mon => { const sun = addDays(mon, 6); return `${shortDay(mon)}–${mon.slice(5, 7) === sun.slice(5, 7) ? Number(sun.slice(8, 10)) : shortDay(sun)}`; };
const wkVal = (x, v) => (v == null ? (x.source === 'Apollo' ? 'no emails delivered' : 'no number') : wkNum(x, v));
// One registry row as a line: the numbers, then the direction in words (▲ / ▼ by what is good for the row).
export function weeklyLine(x, b, { goals = true } = {}) {
  const t = x.this_week, l = x.last_week;
  const dir = t.delta == null ? null : t.delta === 0 ? 'flat against the same point last week' : `${(t.delta > 0) === (x.direction === 'up') ? '▲ better' : '▼ worse'} than the same point last week by ${x.unit === 'rate' ? `${Math.abs(100 * t.delta).toFixed(1)} pts` : Math.abs(Math.round(t.delta * 10) / 10)}`;
  const lastMon = addDays(b.week_start, -7);
  const earlier = x.series.filter(s => !s.current && s.week_start < lastMon).sort((p, q) => String(q.week_start).localeCompare(String(p.week_start)));
  return [
    `${x.name} (${x.group})`, `this week to date (${weekRange(b.week_start)}): ${wkVal(x, t.to_date)}`, x.kind === 'manual' ? null : `same point last week: ${wkVal(x, t.same_point_last_week)}`, dir,
    t.pace != null ? `on pace for about ${t.pace} by Sunday` : null, !goals ? null : t.goal != null ? `goal ${wkNum(x, t.goal)}${t.progress != null ? `, ${Math.round(100 * t.progress)} % of it` : ''}` : 'no goal set this week',
    l ? `last week (${weekRange(lastMon)}): ${wkVal(x, l.value)}${!goals ? '' : l.goal != null ? ` against a goal of ${wkNum(x, l.goal)}: ${l.hit == null ? 'no number' : l.hit ? 'hit' : 'missed'}` : ', no goal was set'}` : null,
    earlier.length ? `earlier weeks, newest first: ${earlier.map(s => `${weekRange(s.week_start)}: ${wkVal(x, s.value)}`).join(', ')}` : 'no earlier weeks on file',
    x.kind === 'manual' ? (x.entered.last_week ? `last week entered by ${x.entered.last_week.by}` : 'last week not entered') : null,
  ].filter(Boolean).join(' · ');
}

// scout-v3.1 C7 - the brief's label / value grid: the same facts the Brief holds, one line each; a field with nothing
// on file is "—"; a value holding an address or phone shape is left out.
// FIX scout-company-lookup S3: the day the current owner was set - the latest assign event that names them (employers
// and targets: flow events; partners: partner events). null when no event says so (an import, a first owner).
async function assignedOn(sb, businessId, type, id, ownerId) {
  const rows = type === 'partner'
    ? must(await sb.from('sales_partner_events').select('event, meta, at').eq('business_id', businessId).eq('goal_id', id).eq('event', 'assign').order('at', { ascending: false }).limit(5))
    : must(await sb.from('sales_flow_events').select('kind, meta, at, undone_at').eq('business_id', businessId).eq('record_type', type).eq('record_id', String(id)).eq('kind', 'assign').order('at', { ascending: false }).limit(5));
  const at = rows.find(r => !r.undone_at && r.meta?.to_owner === ownerId)?.at;
  return at ? laDateString(new Date(at)) : null;
}
export const briefGrid = pairs => pairs.map(([label, value]) => { const v = value ? cleanText(String(value), 240) : ''; return { label, value: v && !hasPii(v) ? v : '—' }; });

// FIX scout-generative G1 - the AGENDA read set, one request over the reads the screens already use: Today's read
// (to-dos by due day, this week's five, replies owed, calls waiting for review), Top targets (pinned + P1 with their
// next step) and goals/weekly (this week's and next week's typed goals). No calendar read exists yet - the head line
// says so. Every item carries its `group` (the answer's sections); nothing here writes.
const DOW_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const dowOf = d => { const n = DOW_NAMES[new Date(`${d}T12:00:00Z`).getUTCDay()]; return n[0].toUpperCase() + n.slice(1, 3); };
// The window an agenda ask names: next week (Mon-Sun) · this week (today to Sunday) · today · tomorrow · a weekday
// (the next one, never today) · else the 7 days ahead.
export function agendaWindow(q, today) {
  const t = String(q || '').toLowerCase(), mon = laMonday(today);
  if (/\bnext week\b/.test(t)) return { from: addDays(mon, 7), to: addDays(mon, 13), label: 'next week' };
  if (/\bthis week\b/.test(t)) return { from: today, to: addDays(mon, 6), label: 'the rest of this week' };
  if (/\btoday\b/.test(t)) return { from: today, to: today, label: 'today' };
  if (/\btomorrow\b/.test(t)) return { from: addDays(today, 1), to: addDays(today, 1), label: 'tomorrow' };
  const named = new RegExp(`\\b(${DOW_NAMES.join('|')})\\b`).exec(t);
  if (named) { const d = addDays(today, ((DOW_NAMES.indexOf(named[1]) - new Date(`${today}T12:00:00Z`).getUTCDay() + 7) % 7) || 7); return { from: d, to: d, label: `${dowOf(d)} ${d}` }; }
  return { from: today, to: addDays(today, 6), label: 'the 7 days ahead' };
}
export const AGENDA_CAPS = { due: 40, pins: 10, calls: 10, replies: 10 };
export const STANDING_CAPS = { due: 20, pins: 5, calls: 5, replies: 5 };
export const AGENDA_RULE = 'Agenda: the open to-dos due in the window by day, this week\'s five, the pinned and P1 companies with their next step, the typed goals for this week and next, the calls waiting for review and the replies nobody has answered. Meetings are not read: there is no calendar read yet.';
// overdue: true = every to-do due up to `to` (the fallback's "due in 7 days" carries what is already late).
export async function agendaRead(sb, { businessId, auth, today, now }, { from, to, label, whose = null, caps = AGENDA_CAPS, overdue = false }) {
  const [t, top, wk] = await Promise.all([
    salesReads.loadToday(sb, businessId, { now, filter: whose ? { owner: whose } : {}, reviews: true }),
    salesReads.topTargets(sb, businessId, whose ? { owner: whose, limit: 50 } : { limit: 50 }, { now, meId: auth.user.id }),
    salesReads.loadWeekly(sb, businessId, { weeks: 12, now }),
  ]);
  const rows = t.view.groups.flatMap(g => g.rows);
  const owner = r => (r.owner_user_id ? (r.owner_user_id === auth.user.id ? 'mine' : 'another owner') : 'unassigned');
  const dueWord = r => (r.due ? `due ${dowOf(day(r.due))} ${day(r.due)}${r.overdue ? ' (overdue)' : ''}` : 'no date');
  const todoItem = (r, group, extra = null) => ({ group, entity: 'todos', id: r.id, title: cleanText(r.text, 140), date: day(r.due),
    row: { kind: 'task', id: r.id, text: cleanText(r.text, 200), due: day(r.due), overdue: !!r.overdue, owner: owner(r), owner_user_id: r.owner_user_id || null, link: r.company?.id && ENTITY_OF[r.company.type] ? { entity: ENTITY_OF[r.company.type], type: r.company.type, id: r.company.id, name: r.company.name } : null, verb: r.verb || 'next_steps', steps: null },
    text: [cleanText(r.text, 200), 'open to-do', dueWord(r), owner(r), r.company?.name ? `company ${r.company.name}` : null, extra].filter(Boolean).join(' · ') });
  const todos = rows.filter(r => r.kind === 'todo');
  const inWindow = todos.filter(r => r.due && day(r.due) <= to && (overdue || day(r.due) >= from)).sort((a, b) => String(a.due).localeCompare(String(b.due)));
  const due = inWindow.slice(0, caps.due).map(r => todoItem(r, 'Due'));
  const five = (t.view.strip || []).map(c => ({ group: "This week's five", entity: c.todo_id ? 'todos' : 'agenda', id: c.todo_id || `five:${c.id}`, title: cleanText(c.text, 140), date: day(c.due),
    text: [cleanText(c.text, 200), "one of this week's five", `status ${c.status}`, c.due ? `due ${dowOf(day(c.due))} ${day(c.due)}` : 'no date', c.company ? `company ${c.company}` : null].filter(Boolean).join(' · ') }));
  const pinRows = top.status === 200 ? top.body.rows.filter(x => x.pin || x.band === 'P1') : [];
  const pins = pinRows.slice(0, caps.pins).map(x => { const it = topItem(x); return { ...it, group: 'Pinned and P1', text: `${it.text} · ${x.next ? `next step: ${x.next.text}${x.next.due ? ` (due ${dowOf(day(x.next.due))} ${day(x.next.due)})` : ''}` : 'no next step set'}` }; });
  const b = wk.status === 200 ? wk.body : null;
  const goalRows = b ? b.metrics.filter(x => !x.context && (x.this_week.goal != null || x.next_week?.goal != null)) : [];
  const goals = goalRows.map(x => ({ group: 'Goals', quiet: true, entity: 'weekly', id: `agenda:${x.key}`, title: `${x.name} · goal`,
    text: [`${x.name} (${x.group})`, `this week (${weekRange(b.week_start)}) to date: ${wkVal(x, x.this_week.to_date)}`, x.this_week.goal != null ? `this week's goal ${wkNum(x, x.this_week.goal)}${x.this_week.progress != null ? `, ${Math.round(100 * x.this_week.progress)} % of it` : ''}` : 'no goal typed for this week',
      x.this_week.pace != null ? `on pace for about ${x.this_week.pace} by Sunday` : null, x.next_week?.goal != null ? `next week's (${weekRange(x.next_week.week_start)}) goal ${wkNum(x, x.next_week.goal)}` : `no goal typed for next week (${weekRange(addDays(b.week_start, 7))})`].filter(Boolean).join(' · ') }));
  if (!goals.length) goals.push({ group: 'Goals', quiet: true, entity: 'weekly', id: 'agenda:none', title: 'Goals', text: b ? `No goal is typed for this week (${weekRange(b.week_start)}) or next week (${weekRange(addDays(b.week_start, 7))}).` : 'The weekly goals could not be read.' });
  const reviews = rows.filter(r => r.kind === 'review');
  const calls = reviews.slice(0, caps.calls).map(r => ({ group: 'Calls to review', entity: 'call_notes', id: r.note_id, title: cleanText(r.text, 140), date: day(r.call_date), subtitle: [day(r.call_date), UNREVIEWED].filter(Boolean).join(' · '),
    text: [cleanText(r.text, 200), `call ${day(r.call_date)}`, UNREVIEWED].join(' · ') }));
  const owed = (t.view.groups.find(g => g.id === 'reply')?.rows || []).filter(r => r.kind === 'reply' || r.kind === 'todo');
  const replies = owed.slice(0, caps.replies).map(r => (r.kind === 'todo' ? todoItem(r, 'Replies owed', 'a reply is owed') : { group: 'Replies owed', entity: 'people', id: r.person.key, title: r.person.name, date: day(r.replied_at),
    text: [cleanText(r.text, 200), r.company?.name ? `company ${r.company.name}` : 'no company record', r.replied_at ? `they replied ${day(r.replied_at)}` : null, r.reply_class ? `reply read as ${String(r.reply_class).replace(/_/g, ' ')}` : null, 'no to-do answers it yet'].filter(Boolean).join(' · ') }));
  const days = []; for (let d = from; d <= to && days.length < 14; d = addDays(d, 1)) days.push(`${dowOf(d)} ${d}`);
  const scope = whose ? (whose === auth.user.id ? 'mine' : "one member's") : 'the whole team';
  const head = { quiet: true, entity: 'agenda', id: 'window', title: 'Agenda window',
    text: [`window ${label}: ${days.join(', ')}`, `today is ${dowOf(today)} ${today}`, `scope ${scope}`, `${inWindow.length} to-dos due in the window${inWindow.length > due.length ? ` (the first ${due.length} listed)` : ''}`, `${t.view.counts.overdue} overdue to-dos in all`,
      `${pinRows.length} pinned or P1 companies`, `${reviews.length} calls waiting for review`, `${owed.length} replies owed`, 'no calendar read: meetings are not in this context'].join(' · ') };
  return { head, items: [...due, ...five, ...pins, ...goals, ...calls, ...replies], counts: { due: inWindow.length, five: five.length, pins: pinRows.length, goals: goalRows.length, calls: reviews.length, replies: owed.length }, scope };
}

export const salesIntents = [
  { id: 'top_targets', example: 'my top targets', suggest: true, title: 'Top targets', rule: TOP_TARGETS_RULE, match: isTopTargets,
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
      const items = [], reads = [], records = [], missing = [];
      let grid = null, owner = null;
      const first = async id => (id ? (await membersOf(sb, businessId)).find(m => m.userId === id)?.firstName || 'a former member' : null);
      for (const name of ask.company.slice(0, 2)) {
        // S1: a name the index knows only from the site's visits has no record to read
        const visitorOnly = ask.known?.[name]?.type === 'visitor';
        const c = visitorOnly ? null : await findCompany(sb, businessId, name);
        if (!c) {
          const person = visitorOnly ? null : await findPerson(sb, businessId, name, today);
          if (!person) { reads.push(`no company or person named "${cleanText(name, 60)}"`); missing.push(name); continue; }
          owner = { title: person.name, user_id: person.owner_user_id || null, name: await first(person.owner_user_id), assigned: null };
          reads.push(`goals/people/activity/${person.key}`);
          records.push({ entity: 'people', id: person.key });
          items.push(personItem(person));
          const d = await salesReads.personDetail(sb, businessId, { key: person.key });
          grid = briefGrid([['Record', ['Person', person.title].filter(Boolean).join(' · ')], ['Owner', owner.name || 'Unassigned'], ['Company', person.company?.name ? `${person.company.name}${person.company.stage ? ` · ${String(person.company.stage).replace(/_/g, ' ')}` : ''}` : null], ['Visits', person.visits?.last_visit ? `last visit ${day(person.visits.last_visit)}${person.visits.top_page ? ` · ${person.visits.top_page}` : ''}` : null], ['Last email', person.last_email ? `${day(person.last_email.at)} · ${person.last_email.what}` : null], ['Notes', d.status === 200 ? d.body.notes : null]]);
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
        const of = kind => r.body.lines.filter(l => l.kind === kind).map(l => l.text);
        const touches = of('touch'), people = of('person');
        // S2: the owner the stored score row carries (the reader Top targets ranks from), by first name
        const ownerId = r.body.company.owner_user_id || null;
        owner = { title: r.body.company.name, user_id: ownerId, name: ownerId ? String(r.body.company.owner || '').trim().split(/\s+/)[0] || await first(ownerId) : null, assigned: ownerId && ask.flags.owner ? await assignedOn(sb, businessId, c.type, c.id, ownerId) : null };
        grid = briefGrid([['Record', (of('company')[0] || c.type).replace(new RegExp(`^${r.body.company.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} · `), '')], ['Owner', owner.name || 'Unassigned'], ['Visits', of('visit')[0]], ['Last touch', touches[0]?.replace(/^Last touch: /, '')], ['Notes', touches.length > 1 ? `${touches[1]}${touches.length > 2 ? ` · ${touches.length - 2} more` : ''}` : null], ['People', people.length ? people.join(' · ') : null]]);
        items.push({ company: r.body.company.name, row, entity, id: c.id, title: r.body.company.name, text: `${r.body.company.name} · ${c.type}${r.body.score ? ` · intent ${r.body.score.score} ${r.body.score.band}` : ''}${r.body.next_step ? ` · next: ${r.body.next_step}` : ''}` });
        for (const l of r.body.lines) items.push({ entity, id: c.id, title: r.body.company.name, text: `${r.body.company.name} · ${l.kind}: ${l.text}` });
        if (c.domain) {
          const msgs = must(await sb.from('microsoft_messages').select('graph_id, subject, direction, occurred_at, external_domains').eq('business_id', businessId).contains('external_domains', [c.domain]).order('occurred_at', { ascending: false }).limit(8));
          for (const m of msgs) items.push({ entity: 'outlook', id: m.graph_id, title: cleanText(m.subject || '(no subject)', 120), date: day(m.occurred_at), text: `${cleanText(m.subject || '(no subject)', 120)} · ${m.direction === 'sent' ? 'email sent' : 'email received'} · ${day(m.occurred_at)} · ${c.domain}` });
        }
      }
      return { read: reads.join(' + '), items, total: records.length, missing, brief: records.length === 1 ? { ...records[0], ...(grid ? { grid } : {}), ...(owner ? { owner } : {}) } : null };
    } },
  // scout-v3 R11: the open list by the rule, never filtered by the question's leftover words; a company named (or
  // carried by a pronoun from the part before) narrows it to that company's to-dos - by link, else by its name in the text.
  { id: 'todos', example: 'show me my open tasks', title: 'Tasks', rule: TODO_RULE, match: ask => ask.entity === 'todos',
    async run(sb, { businessId, auth, ask, today }) {
      // C5: "Cyrus's tasks" reads that member's open to-dos
      const whose = ask.member ? ask.member.id : ask.mine ? auth.user.id : null;
      const { rows, total } = await salesReads.openTodosFor(sb, businessId, whose);
      let kept = rows.filter(r => !ask.since || (r.due_date && day(r.due_date) >= ask.since && (!ask.until || day(r.due_date) <= ask.until)) || (!r.due_date && day(r.created_at) >= ask.since));
      let of = '';
      if (ask.company.length) {
        const found = (await Promise.all(ask.company.map(n => findCompany(sb, businessId, n)))).filter(Boolean);
        const names = ask.company.map(n => n.toLowerCase());
        kept = kept.filter(r => found.some(c => r.link_type === c.type && String(r.link_id) === String(c.id)) || names.some(n => String(r.text || '').toLowerCase().includes(n)));
        of = ` · for ${ask.company.map(n => cleanText(n, 60)).join(', ')}`;
      }
      const matched = kept.length;
      kept = rankTodos(kept, today, auth.user.id).slice(0, 40);
      const linkName = await linkNames(sb, businessId, kept);
      // actions-v2 A6: each to-do says what Scout can do on it - the verb Today's own ranking read picked for that row.
      const verbOf = new Map((await salesReads.loadToday(sb, businessId)).view.groups.flatMap(g => g.rows).filter(r => r.kind === 'todo').map(r => [r.id, r.verb]));
      const owner = r => (r.owner_user_id ? (r.owner_user_id === auth.user.id ? 'mine' : 'another owner') : 'unassigned');
      return { read: `openTodos (${total} open${ask.member ? `, ${ask.member.name}'s` : ask.mine ? ', mine' : ''})${of}`, total: matched, items: kept.map(r => ({ entity: 'todos', id: r.id, title: cleanText(r.text, 140), date: day(r.due_date),
        row: { kind: 'task', id: r.id, text: cleanText(r.text, 200), due: day(r.due_date), overdue: !!r.due_date && day(r.due_date) < today, owner: owner(r), owner_user_id: r.owner_user_id || null, link: linkName.get(`${r.link_type}:${r.link_id}`) || null, verb: verbOf.get(r.id) || 'next_steps', steps: r.steps?.length ? { done: r.steps.filter(x => x.done).length, total: r.steps.length } : null },
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
      return { read: `visitors ${first}${last !== first ? ` to ${last}` : ''} · ${rows.length} companies`, items: ranked.map(c => ({ company: c.company, row: c.type ? { kind: 'company', type: c.type, id: c.id, name: c.company, score: c.score ?? null, band: c.band || null } : c.company_key ? { kind: 'visitor', company_key: c.company_key } : null, entity: c.type ? ENTITY_OF[c.type] : 'visitor', id: c.type ? c.id : c.visit_id, title: c.company, score: c.score ?? null, text: [c.company, c.band ? `${c.band}${c.score != null ? ` score ${c.score}` : ''}` : null, `${c.visits} visits · ${c.visitors} visitors · ${c.pages} pages${c.paths?.length ? ` (${c.paths.join(', ')})` : ''}`, c.people ? `${c.people} named people${c.titles?.length ? ` (${c.titles.join('; ')})` : ''}` : null, c.is_new ? 'new to the site' : 'returning', c.type ? `in Prospector as ${c.type} · ${c.stage || 'no stage'} · owner ${c.owner}` : 'not in Prospector yet', c.last_touch ? `last touch ${day(c.last_touch.at)}${c.last_touch.what ? ` ${c.last_touch.what}` : ''}` : null].filter(Boolean).join(' · ') })) };
    } },
  { id: 'ranked', example: 'hot targets Brad referred', match: ask => !isTopTargets(ask) && COMPANY_ENTITIES.has(ask.entity) && !ask.flags.visitors && !ask.flags.emails && !ask.flags.attention && (ask.flags.ranked || !!ask.band || !!ask.source || (!!ask.entity && (ask.mine || !!ask.member || !!ask.since)) || (ask.flags.funnel && !!ask.band)),
    async run(sb, { businessId, auth, ask, now }) {
      const segment = { partners: 'partners', employers: 'employers', targets: 'targets' }[ask.entity] || 'all';
      const query = { segment, band: ask.band || '', source: ask.source || '', owner: ask.member ? ask.member.id : ask.mine ? auth.user.id : '', sort: ask.sort === 'date' ? 'newest' : 'rank' };
      const r = await salesReads.listScores(sb, businessId, query, { now });
      const touched = list => (ask.since ? list.filter(x => x.last_touch_at && day(x.last_touch_at) >= ask.since && (!ask.until || day(x.last_touch_at) <= ask.until)) : list);
      let rows = touched(r.body.rows);
      // C3: fewer than the count asked in that band -> the next bands of the same read fill it
      let fill = null;
      if (ask.limit && INTENT_ORDER.includes(ask.band) && rows.length < ask.limit) {
        const counts = [{ band: INTENT_WORD[ask.band], n: rows.length }];
        for (const next of INTENT_ORDER.slice(INTENT_ORDER.indexOf(ask.band) + 1)) {
          if (rows.length >= ask.limit) break;
          const more = touched((await salesReads.listScores(sb, businessId, { ...query, band: next }, { now })).body.rows).slice(0, ask.limit - rows.length);
          if (more.length) { rows = [...rows, ...more]; counts.push({ band: INTENT_WORD[next], n: more.length }); }
        }
        if (counts.length > 1) fill = { asked: ask.limit, strict: counts[0].n, counts, text: fillWords('companies', ask.limit, counts) };
      }
      rows = rows.slice(0, 40);
      return { fill, total: fill ? rows.length : undefined, read: `goals/scores ${JSON.stringify(query)}${ask.since ? ` touched since ${ask.since}` : ''} · ${r.body.counts.shown} shown${fill ? ` · filled: ${fill.text}` : ''}`, items: rows.map(x => ({ company: x.name, row: { kind: 'company', type: x.type, id: x.id, name: x.name, score: x.score ?? null, band: x.band || null, owner: x.owner || null, stage: x.stage || null }, entity: ENTITY_OF[x.type], id: x.id, title: x.name, score: x.score ?? null, date: day(x.last_touch_at), text: [x.name, x.type, `score ${x.score} ${x.band}`, `rank ${x.rank}`, x.source_label ? `source ${x.source_label}${x.co_owner_name ? ` (${x.co_owner_name})` : ''}` : null, x.stage ? `stage ${String(x.stage).replace(/_/g, ' ')}` : null, x.owner ? `owner ${x.owner}` : 'unassigned', x.last_touch_at ? `last touch ${day(x.last_touch_at)} · ${daysAgo(x.last_touch_at, now)} d ago` : 'never touched', x.visits_7d ? `${x.visits_7d} visits 7 d` : null, x.due ? `due ${x.due}` : null].filter(Boolean).join(' · ') })) };
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
      if (ask.follow?.people) rows = rows.filter(p => ask.follow.people.includes(p.key));
      rows.sort((a, b) => (b.heat ?? -1) - (a.heat ?? -1) || String(b.visits?.last_visit || b.identified_at || '').localeCompare(String(a.visits?.last_visit || a.identified_at || '')));
      const f = fillPeople(rows, ask);
      rows = f.rows;
      return { read: `people whose company visited (${ask.since_kind || '7 d'}) · ${rows.length} · by heat${up.hidden}${f.fill ? ` · filled: ${f.fill.text}` : ''}`, total: rows.length, fill: f.fill, items: rows.slice(0, 25).map(personItem) };
    } },
  { id: 'people', example: 'who opened our emails', title: 'People', rule: PEOPLE_RULE, match: ask => !isPeopleVisiting(ask) && (ask.entity === 'people' || ((ask.flags.opened || ask.flags.replied || ask.flags.clicked) && !ask.flags.emails)),
    async run(sb, { businessId, ask, today }) {
      const win = peopleWindow(ask, 'all');
      const r = await salesReads.peopleActivity(sb, businessId, { window: win });
      if (r.status !== 200) return { read: `goals/people/activity (${r.status})`, items: [] };
      const up = awake(r.body.rows, today);
      let rows = up.rows;
      if (ask.flags.replied) rows = rows.filter(p => p.emails.replied > 0); else if (ask.flags.clicked) rows = rows.filter(p => p.emails.clicked > 0); else if (ask.flags.opened) rows = rows.filter(p => p.emails.opened > 0);
      // C1: a follow-up about the people of the last answer reads those people, not the question's leftover words
      if (ask.follow?.people) rows = rows.filter(p => ask.follow.people.includes(p.key));
      else if (ask.terms.length) rows = rows.filter(p => ask.terms.some(t => `${p.name} ${p.title || ''} ${p.company?.name || ''}`.toLowerCase().includes(t)));
      const f = fillPeople(rows, ask);
      rows = f.rows;
      return { read: `goals/people/activity?window=${win} (${r.body.rows.length} people)${up.hidden}${f.fill ? ` · filled: ${f.fill.text}` : ''}`, total: rows.length, fill: f.fill, items: rows.slice(0, 40).map(personItem) };
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
  // weekly-funnel-v1 W8: "how are we pacing this week", "what's our open rate trend", "did we hit last week's goals" -
  // the registry route's own numbers (this week to date against the same point last week, pace, goal, the weeks behind).
  { id: 'weekly', example: 'how are we pacing this week', title: 'Weekly funnel', rule: WEEKLY_RULE, match: isWeekly,
    async run(sb, { businessId, ask, now }) {
      const r = await salesReads.loadWeekly(sb, businessId, { weeks: 12, now });
      if (r.status !== 200) return { read: `goals/weekly (${r.status})`, items: [] };
      const b = r.body, q = String(ask.q || '').toLowerCase();
      const named = b.metrics.filter(x => q.includes(x.name.toLowerCase()) || (x.key === 'human_open_rate' && /\bopen rate\b|\bopens\b/.test(q)));
      const rows = named.length ? named : b.metrics.filter(x => !x.context && (x.this_week.to_date != null || x.last_week?.value != null || x.this_week.goal != null));
      const items = rows.map(x => ({ entity: 'weekly', id: x.key, title: `${x.name} · weekly`, text: weeklyLine(x, b) }));
      items.push({ entity: 'weekly', id: 'how', title: 'How the weekly funnel is read', text: `${b.wording.week} ${b.wording.pace} ${b.wording.goals} ${b.wording.manual}` });
      return { read: `goals/weekly?weeks=12 · week of ${b.week_start} · day ${b.elapsed.days} of 7`, items };
    } },
  { id: 'member_emails', example: 'who sent the most this week', title: 'Email by member', rule: MEMBER_EMAIL_RULE, match: isMemberEmail,
    async run(sb, { businessId, auth, ask, now }) {
      const q = String(ask.q || '').toLowerCase();
      const whose = ask.member ? ask.member.id : ask.mine && !WHO_SENT.test(q) ? auth.user.id : 'all';
      const r = await salesReads.loadWeekly(sb, businessId, { weeks: 12, member: whose, now });
      if (r.status !== 200) return { read: `goals/weekly?member (${r.status})`, items: [] };
      const b = r.body, how = { entity: 'weekly', id: 'member:how', title: 'How email by member is read', text: `${b.wording.member} ${b.wording.week} ${b.wording.pace}` };
      const wanted = ms => { const named = ms.filter(x => q.includes(x.name.toLowerCase()) || (x.key === 'human_open_rate' && /\bopen rate\b|\bopens\b/.test(q))); return named.length ? named : ms; };
      if (whose === 'all') {
        const sent = row => row.metrics.find(x => x.key === 'delivered').this_week.to_date ?? -1;
        const rows = [...b.rows.filter(x => x.id !== 'team').sort((x, y) => sent(y) - sent(x)), ...b.rows.filter(x => x.id === 'team')];
        const items = rows.flatMap(row => wanted(row.metrics).map(x => ({ entity: 'weekly', id: `${row.id}:${x.key}`, title: `${row.name} · ${x.name}`, text: `${row.name} · ${weeklyLine(x, b, { goals: false })}` })));
        return { read: `goals/weekly?member=all · week of ${b.week_start} · day ${b.elapsed.days} of 7 · ${b.rows.length - 1} member row${b.rows.length === 2 ? '' : 's'} + the team`, items: [...items, how] };
      }
      const read = `goals/weekly?member=${b.member.name} · week of ${b.week_start} · day ${b.elapsed.days} of 7`;
      if (!b.members.some(x => x.id === b.member.id)) return { read, items: [{ entity: 'weekly', id: `${b.member.id}:none`, title: `${b.member.name} · no mailbox`, text: `${b.member.name} has no sending mailbox mapped, so there is no email number to read for ${b.member.name}.` }, how] };
      const items = wanted(b.metrics).map(x => ({ entity: 'weekly', id: `${b.member.id}:${x.key}`, title: `${b.member.name} · ${x.name}`, text: `${b.member.name} · ${weeklyLine(x, b, { goals: false })}` }));
      return { read, items: [...items, how] };
    } },
  { id: 'emails', example: 'how are our emails doing this month', match: ask => !ask.flags.email_site && !isWeekly(ask) && !isMemberEmail(ask) && (ask.flags.emails || ask.entity === 'emails'),
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
  { id: 'calls', example: 'calls this week', title: 'Calls', rule: UNREVIEWED_RULE, match: callsAsk,
    async run(sb, { businessId, auth, ask, today }) {
      const t = plainQ(ask);
      const term = callTerm(ask);
      const company = term ? await findCompany(sb, businessId, term) : null;
      const r = await salesReads.listCalls(sb, { businessId, userId: auth.user.id, today, query: { who: ask.mine ? 'mine' : 'team', unreviewed: UNREVIEWED_ASK.test(t), since: ask.since, until: ask.until, record: company ? `${company.type}:${company.id}` : null, q: company ? '' : term || '' } });
      const rows = LAST_CALL_ASK.test(t) ? r.calls.slice(0, 1) : r.calls.slice(0, 25);
      const c = r.counts;
      return { read: `goals/calls${ask.since ? ` since ${ask.since}` : ''}${company ? ` about ${cleanText(company.name, 60)}` : term ? ` matching "${cleanText(term, 40)}"` : ''}${ask.mine ? ' (mine)' : ''} · ${c.calls} call${c.calls === 1 ? '' : 's'} · ${c.unreviewed} ${UNREVIEWED} · ${c.no_company} without a company`, total: c.calls, items: rows.map(callLogItem) };
    } },
  { id: 'call_review', example: 'review the Hilton call', title: 'Call notes', rule: UNREVIEWED_RULE, match: ask => ['review', 'agreed'].includes(callAsk(ask)),
    async run(sb, { businessId, ask }) {
      const term = callTerm(ask);
      const windowed = () => { let q = sb.from('sales_call_notes').select(`${NOTE_COLS}, extract`).eq('business_id', businessId); if (ask.since) q = q.gte('call_date', ask.since); if (ask.until) q = q.lte('call_date', ask.until); return q; };
      // F12: the notes linked to the company named come first, then the text match.
      const company = term ? await findCompany(sb, businessId, term) : null;
      const linkedIds = company ? await salesReads.recordCallIds(sb, businessId, company.type, company.id) : [];
      const linked = linkedIds.length ? must(await windowed().in('id', linkedIds).order('call_date', { ascending: false }).limit(3)) : [];
      const byText = linked.length >= 3 ? [] : must(await (term ? windowed().or(`title.ilike.${pat(term)},text.ilike.${pat(term)}`) : windowed()).order('call_date', { ascending: false }).limit(3));
      const rows = [...linked, ...byText.filter(n => !linked.some(l => l.id === n.id))].slice(0, 3);
      const per = rows.map(callItems);
      const sum = k => per.reduce((n, x) => n + x[k], 0);
      return { read: `call notes${ask.since ? ` since ${ask.since}` : ''}${term ? ` matching "${cleanText(term, 40)}"` : ''} · ${rows.length}${unreviewedOf(rows)} · ${sum('decisions')} decisions · ${sum('waiting')} waiting on them`, total: rows.length, items: per.flatMap(x => x.items) };
    } },
  { id: 'call_ideas', example: 'ideas from calls this month', title: 'Ideas from calls', rule: UNREVIEWED_RULE, match: ask => callAsk(ask) === 'ideas',
    async run(sb, { businessId, ask, today }) {
      const since = ask.since || addDays(today, -30);
      let q = sb.from('sales_call_notes').select('id, title, call_date, accepted_at, extract').eq('business_id', businessId).not('extract', 'is', null).gte('call_date', since);
      if (ask.until) q = q.lte('call_date', ask.until);
      const rows = must(await q.order('call_date', { ascending: false }).limit(50));
      const withIdeas = rows.map(r => ({ r, ideas: (Array.isArray(r.extract?.ideas) ? r.extract.ideas : []).filter(i => i && typeof i.text === 'string' && i.text.trim()) })).filter(x => x.ideas.length);
      const items = withIdeas.flatMap(({ r, ideas }) => ideas.map(i => ({ entity: 'call_notes', id: r.id, title: noteTitle(r), subtitle: [day(r.call_date), r.accepted_at ? null : UNREVIEWED].filter(Boolean).join(' · '), date: day(r.call_date),
        text: `idea (${['product', 'process', 'marketing'].includes(i.kind) ? i.kind : 'other'})${r.accepted_at ? '' : ` (${UNREVIEWED})`}: ${cleanText(i.text, 300)}${i.company ? ` · about ${cleanText(i.company, 80)}` : ''} · from ${noteTitle(r)} ${day(r.call_date)}` })));
      return { read: `ideas in call notes since ${since} · ${items.length} in ${withIdeas.length} of ${rows.length} notes${unreviewedOf(withIdeas.map(x => x.r))}`, total: items.length, items };
    } },
  { id: 'notes', example: 'notes about Hilton', suggest: true, rule: UNREVIEWED_RULE, match: ask => ask.entity === 'call_notes' && !callAsk(ask),
    async run(sb, { businessId, ask }) {
      let q = sb.from('sales_call_notes').select(NOTE_COLS).eq('business_id', businessId);
      if (ask.since) q = q.gte('call_date', ask.since);
      if (ask.until) q = q.lte('call_date', ask.until);
      const term = ask.company[0] || ask.terms[0];
      if (term) q = q.or(`title.ilike.${pat(term)},text.ilike.${pat(term)}`);
      const rows = must(await q.order('call_date', { ascending: false }).limit(25));
      return { read: `call notes${ask.since ? ` since ${ask.since}` : ''}${term ? ` matching "${cleanText(term, 40)}"` : ''} · ${rows.length}${unreviewedOf(rows)}`, items: rows.map(r => noteItem(r, noteChars(rows.length))) };
    } },
  // FIX scout-generative G1: agenda / plan / goals / priorities / "catch me up" - only when no other intent reads the
  // ask (it never takes a question an existing intent answers). G5: "our" / "the team's" = everyone; else the caller.
  { id: 'agenda', example: "what's on the agenda for next week", suggest: true, title: 'Agenda', rule: AGENDA_RULE,
    match: ask => !!ask.flags.agenda && !salesIntents.some(i => i.id !== 'agenda' && i.match(ask)),
    async run(sb, { businessId, auth, ask, today, now }) {
      const w = agendaWindow(ask.q, today);
      const whose = ask.member ? ask.member.id : ask.flags.team && !ask.mine ? null : auth.user.id;
      const r = await agendaRead(sb, { businessId, auth, today, now }, { ...w, whose });
      return { read: `agenda ${w.from} to ${w.to} (${r.scope}) · goals/today · goals/top-targets · goals/weekly · no calendar read`, total: r.items.length,
        items: [{ ...r.head, text: `AGENDA · ${r.head.text}` }, ...r.items] };
    } },
];

// FIX scout-generative G2 - the fallback ask's standing context is the agenda's read set with tighter caps (the
// caller's to-dos due in 7 days or already late ≤ 20 · this week's five · pinned + P1 ≤ 5 · goals this and next week ·
// calls to review ≤ 5 · replies owed ≤ 5) plus notes from 14 d (≤ 5) and companies touched in 14 d (≤ 10).
export async function salesStanding(sb, { businessId, auth, today, now }) {
  const since = addDays(today, -14), to = addDays(today, 6);
  const [agenda, notes, scores] = await Promise.all([
    agendaRead(sb, { businessId, auth, today, now }, { from: today, to, label: 'the 7 days ahead', whose: auth.user.id, caps: STANDING_CAPS, overdue: true }),
    sb.from('sales_call_notes').select(NOTE_COLS).eq('business_id', businessId).gte('call_date', since).order('call_date', { ascending: false }).limit(5).then(must),
    salesReads.listScores(sb, businessId, {}, { now }).catch(() => ({ body: { rows: [] } })),
  ]);
  const touched = scores.body.rows.filter(r => r.last_touch_at && day(r.last_touch_at) >= since).sort((a, b) => String(b.last_touch_at).localeCompare(String(a.last_touch_at))).slice(0, 10);
  const c = agenda.counts;
  return {
    reads: [`my to-dos due by ${to} (${c.due})`, `this week's five (${c.five})`, `pinned and P1 companies (${c.pins})`, `goals this and next week (${c.goals})`, `calls to review (${c.calls})`, `replies owed (${c.replies})`, `notes since ${since} (${notes.length}${unreviewedOf(notes)})`, `companies touched since ${since} (${touched.length})`, 'no calendar read'],
    items: [
      { ...agenda.head, id: 'standing', title: 'What was read', text: `STANDING SUMMARY · ${agenda.head.text}` },
      ...agenda.items.map(({ group, ...it }) => it),
      ...notes.map(r => noteItem(r, noteChars(notes.length))),
      ...touched.map(x => ({ entity: ENTITY_OF[x.type], id: x.id, title: x.name, text: [x.name, x.type, `score ${x.score} ${x.band}`, `${x.touches ? `${x.touches} touches · ` : ''}last touch ${day(x.last_touch_at)}${x.last_touch_channel ? ` ${x.last_touch_channel}` : ''}`, x.owner ? `owner ${x.owner}` : null].filter(Boolean).join(' · ') })),
    ],
  };
}

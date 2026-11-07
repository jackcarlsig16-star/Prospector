import { cleanText } from './scrubText.js';
import { normName } from './intakeMatch.js';
import { addDays } from './goalsShared.js';

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
};
const COMPANY_ENTITIES = new Set([null, 'partners', 'employers', 'targets']);
const day = v => (v ? String(v).slice(0, 10) : null);
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

export const salesIntents = [
  { id: 'brief', match: ask => ask.company.length > 0,
    async run(sb, { businessId, ask }) {
      const items = [], reads = [];
      for (const name of ask.company.slice(0, 2)) {
        const c = await findCompany(sb, businessId, name);
        if (!c) { reads.push(`no company named "${cleanText(name, 60)}"`); continue; }
        const r = await salesReads.companyBrief(sb, { businessId, type: c.type, id: c.id });
        reads.push(`goals/brief/${c.type}/${c.id}`);
        if (r.status !== 200) continue;
        const entity = ENTITY_OF[c.type];
        items.push({ entity, id: c.id, title: r.body.company.name, text: `${r.body.company.name} · ${c.type}${r.body.score ? ` · intent ${r.body.score.score} ${r.body.score.band}` : ''}${r.body.next_step ? ` · next: ${r.body.next_step}` : ''}` });
        for (const l of r.body.lines) items.push({ entity, id: c.id, title: r.body.company.name, text: `${r.body.company.name} · ${l.kind}: ${l.text}` });
        if (c.domain) {
          const msgs = must(await sb.from('microsoft_messages').select('graph_id, subject, direction, occurred_at, external_domains').eq('business_id', businessId).contains('external_domains', [c.domain]).order('occurred_at', { ascending: false }).limit(8));
          for (const m of msgs) items.push({ entity: 'outlook', id: m.graph_id, title: cleanText(m.subject || '(no subject)', 120), date: day(m.occurred_at), text: `${cleanText(m.subject || '(no subject)', 120)} · ${m.direction === 'sent' ? 'email sent' : 'email received'} · ${day(m.occurred_at)} · ${c.domain}` });
        }
      }
      return { read: reads.join(' + '), items };
    } },
  { id: 'todos', match: ask => ask.entity === 'todos',
    async run(sb, { businessId, auth, ask }) {
      const { rows, total } = await salesReads.openTodosFor(sb, businessId, ask.mine ? auth.user.id : null, { cap: 60 });
      const kept = rows.filter(r => !ask.since || (r.due_date && day(r.due_date) >= ask.since) || day(r.created_at) >= ask.since).filter(r => !ask.terms.length || ask.terms.some(t => String(r.text || '').toLowerCase().includes(t)));
      return { read: `openTodos (${total} open${ask.mine ? ', mine' : ''})`, items: kept.map(r => ({ entity: 'todos', id: r.id, title: cleanText(r.text, 140), date: day(r.due_date), text: [cleanText(r.text, 200), 'open to-do', r.due_date ? `due ${day(r.due_date)}` : 'no date', r.owner_user_id ? (r.owner_user_id === auth.user.id ? 'mine' : 'another owner') : 'unassigned', r.steps?.length ? `${r.steps.filter(s => s.done).length}/${r.steps.length} steps` : null].filter(Boolean).join(' · ') })) };
    } },
  { id: 'visitors', match: ask => ask.flags.visitors && ask.entity !== 'people',
    async run(sb, { businessId, ask, today }) {
      const last = ask.until || addDays(today, -1);
      const first = ask.since || last;
      const days = []; for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);
      const w = { date: today, days, first, last };
      const rows = await salesReads.loadVisitorData(sb, businessId, { window: w, members: await membersOf(sb, businessId) });
      const ranked = [...rows].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (b.visitors || 0) - (a.visitors || 0)).slice(0, 40);
      return { read: `visitors ${first}${last !== first ? ` to ${last}` : ''} (${rows.length} companies)`, items: ranked.map(c => ({ entity: c.type ? ENTITY_OF[c.type] : 'visitor', id: c.type ? c.id : c.visit_id, title: c.company, text: [c.company, c.band ? `${c.band}${c.score != null ? ` score ${c.score}` : ''}` : null, `${c.visits} visits · ${c.visitors} visitors · ${c.pages} pages${c.paths?.length ? ` (${c.paths.join(', ')})` : ''}`, c.people ? `${c.people} named people${c.titles?.length ? ` (${c.titles.join('; ')})` : ''}` : null, c.is_new ? 'new to the site' : 'returning', c.type ? `in Prospector as ${c.type} · ${c.stage || 'no stage'} · owner ${c.owner}` : 'not in Prospector yet', c.last_touch ? `last touch ${day(c.last_touch.at)}${c.last_touch.what ? ` ${c.last_touch.what}` : ''}` : null].filter(Boolean).join(' · ') })) };
    } },
  { id: 'ranked', match: ask => COMPANY_ENTITIES.has(ask.entity) && !ask.flags.visitors && !ask.flags.emails && !ask.flags.attention && (ask.flags.ranked || !!ask.band || !!ask.source || (!!ask.entity && (ask.mine || !!ask.since)) || (ask.flags.funnel && !!ask.band)),
    async run(sb, { businessId, auth, ask, now }) {
      const segment = { partners: 'partners', employers: 'employers', targets: 'targets' }[ask.entity] || 'all';
      const query = { segment, band: ask.band || '', source: ask.source || '', owner: ask.mine ? auth.user.id : '', sort: ask.sort === 'date' ? 'newest' : 'rank' };
      const r = await salesReads.listScores(sb, businessId, query, { now });
      let rows = r.body.rows;
      if (ask.since) rows = rows.filter(x => x.last_touch_at && day(x.last_touch_at) >= ask.since && (!ask.until || day(x.last_touch_at) <= ask.until));
      rows = rows.slice(0, 40);
      return { read: `goals/scores ${JSON.stringify(query)}${ask.since ? ` touched since ${ask.since}` : ''} (${r.body.counts.shown} shown)`, items: rows.map(x => ({ entity: ENTITY_OF[x.type], id: x.id, title: x.name, text: [x.name, x.type, `score ${x.score} ${x.band}`, `rank ${x.rank}`, x.source_label ? `source ${x.source_label}${x.co_owner_name ? ` (${x.co_owner_name})` : ''}` : null, x.stage ? `stage ${String(x.stage).replace(/_/g, ' ')}` : null, x.owner ? `owner ${x.owner}` : 'unassigned', x.last_touch_at ? `last touch ${day(x.last_touch_at)} (${daysAgo(x.last_touch_at, now)} d)` : 'never touched', x.visits_7d ? `${x.visits_7d} visits 7 d` : null, x.due ? `due ${x.due}` : null].filter(Boolean).join(' · ') })) };
    } },
  { id: 'people', match: ask => ask.entity === 'people' || ((ask.flags.opened || ask.flags.replied || ask.flags.clicked) && !ask.flags.emails),
    async run(sb, { businessId, ask }) {
      const win = !ask.since ? 'all' : ask.since_kind?.startsWith('last ') && /\d+/.test(ask.since_kind) ? (Number(/\d+/.exec(ask.since_kind)[0]) <= 7 ? '7' : Number(/\d+/.exec(ask.since_kind)[0]) <= 30 ? '30' : '90') : ['today', 'yesterday', 'this week', 'last week'].includes(ask.since_kind) ? '7' : '30';
      const r = await salesReads.peopleActivity(sb, businessId, { window: win });
      if (r.status !== 200) return { read: `goals/people/activity (${r.status})`, items: [] };
      let rows = r.body.rows;
      if (ask.band) rows = rows.filter(p => p.heat_band === { P1: 'hot', P2: 'warm', P3: 'cold', P4: 'cold' }[ask.band]);
      if (ask.flags.replied) rows = rows.filter(p => p.emails.replied > 0); else if (ask.flags.clicked) rows = rows.filter(p => p.emails.clicked > 0); else if (ask.flags.opened) rows = rows.filter(p => p.emails.opened > 0);
      if (ask.terms.length) rows = rows.filter(p => ask.terms.some(t => `${p.name} ${p.title || ''} ${p.company?.name || ''}`.toLowerCase().includes(t)));
      return { read: `goals/people/activity?window=${win} (${r.body.rows.length} people)`, items: rows.slice(0, 40).map(p => ({ entity: 'people', id: p.key, title: p.name, text: [p.name, p.title, p.company?.name ? `${p.company.name}${p.company.stage ? ` (${String(p.company.stage).replace(/_/g, ' ')})` : ''}` : null, p.source, `${p.emails.sent} sent · ${p.emails.opened} opened · ${p.emails.clicked} clicked · ${p.emails.replied} replied`, p.heat != null ? `heat ${p.heat} ${p.heat_band}` : null, p.last_email ? `last email ${day(p.last_email.at)} ${p.last_email.what}` : null, p.visits ? `company ${p.visits.visits_7d} visits 7 d` : null, p.buyer ? 'buyer title' : null].filter(Boolean).join(' · ') })) };
    } },
  { id: 'emails', match: ask => ask.flags.emails || ask.entity === 'emails',
    async run(sb, { businessId, ask, now }) {
      const period = ask.since_kind === 'this week' || ask.since_kind === 'last week' ? 'week' : 'month';
      const p = await salesReads.loadPulse(sb, businessId, { period }, new Date(now));
      const items = [];
      const walk = (obj, path) => { for (const [k, v] of Object.entries(obj || {})) { if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, [...path, k]); else if (typeof v === 'number' || typeof v === 'string') items.push({ entity: 'pulse', id: [...path, k].join('.'), title: `Pulse ${period}: ${[...path, k].join(' ')}`, text: `pulse ${period} · ${[...path, k].join(' ')} = ${v}` }); } };
      walk(p, []);
      return { read: `goals/pulse?period=${period}`, items: items.slice(0, 80) };
    } },
  { id: 'funnel', match: ask => ask.flags.funnel && !ask.band && !ask.company.length && ask.entity !== 'people',
    async run(sb, { businessId, now }) {
      const r = await salesReads.sourcesFunnel(sb, { businessId, query: {}, now });
      if (r.status !== 200) return { read: `goals/sources/funnel (${r.status})`, items: [] };
      const t = r.body.totals, items = [{ entity: 'funnel', id: 'totals', title: 'Funnel totals', text: `funnel totals · ${Object.entries(t).filter(([k, v]) => typeof v === 'number').map(([k, v]) => `${k} ${v}`).join(' · ')}` }];
      for (const g of [...(r.body.by_rep || []), ...(r.body.by_partner || [])].slice(0, 30)) items.push({ entity: 'funnel', id: g.key || g.label, title: g.label || g.key, text: `funnel ${g.label || g.key} · ${Object.entries(g).filter(([k, v]) => typeof v === 'number').map(([k, v]) => `${k} ${v}`).join(' · ')}` });
      return { read: 'goals/sources/funnel', items };
    } },
  { id: 'attention', match: ask => ask.flags.attention,
    async run(sb, { businessId, auth, now }) {
      const a = await salesReads.attention(sb, { businessId, userId: auth.user.id, now });
      const items = (a.sources || []).map(s => ({ entity: 'attention', id: s.id, title: s.label || s.id, text: `attention ${s.id} · ${s.status}${s.text ? ` · ${cleanText(s.text, 200)}` : ''}` }));
      items.push({ entity: 'attention', id: 'counts', title: 'Needs attention counts', text: `attention counts · ${Object.entries(a.counts || {}).map(([k, v]) => `${k} ${v}`).join(' · ')}` });
      return { read: 'goals/attention', items };
    } },
  { id: 'clients', match: ask => ask.entity === 'clients' && !ask.company.length,
    async run(sb, { businessId }) {
      const r = await salesReads.listClients(sb, { businessId });
      return { read: `clients (${r.body?.totals?.clients ?? 0})`, items: (r.body?.clients || []).slice(0, 40).map(c => ({ entity: 'clients', id: c.id, title: c.name, text: [c.name, `client ${c.client_status}`, c.covered_lives != null ? `${c.covered_lives} covered lives` : null, c.launch_date ? `launch ${day(c.launch_date)}` : null, c.referred_by?.name ? `referred by ${c.referred_by.name}` : c.source_kind ? `source ${c.source_kind}` : null, c.owner ? `owner ${c.owner}` : null].filter(Boolean).join(' · ') })) };
    } },
  { id: 'notes', match: ask => ask.entity === 'call_notes',
    async run(sb, { businessId, ask }) {
      let q = sb.from('sales_call_notes').select('id, title, call_date, text').eq('business_id', businessId);
      if (ask.since) q = q.gte('call_date', ask.since);
      if (ask.until) q = q.lte('call_date', ask.until);
      const term = ask.company[0] || ask.terms[0];
      if (term) q = q.or(`title.ilike.${pat(term)},text.ilike.${pat(term)}`);
      const rows = must(await q.order('call_date', { ascending: false }).limit(25));
      return { read: `call notes${ask.since ? ` since ${ask.since}` : ''}${term ? ` matching "${cleanText(term, 40)}"` : ''} (${rows.length})`, items: rows.map(r => ({ entity: 'call_notes', id: r.id, title: cleanText(r.title || 'Call note', 120), date: day(r.call_date), text: `${cleanText(r.title || 'Call note', 120)} · ${day(r.call_date)} · ${cleanText(r.text, 300)}` })) };
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
      ...notes.map(r => ({ entity: 'call_notes', id: r.id, title: cleanText(r.title || 'Call note', 120), date: day(r.call_date), text: `${cleanText(r.title || 'Call note', 120)} · ${day(r.call_date)} · ${cleanText(r.text, 200)}` })),
      ...touched.map(x => ({ entity: ENTITY_OF[x.type], id: x.id, title: x.name, text: [x.name, x.type, `score ${x.score} ${x.band}`, `last touch ${day(x.last_touch_at)}${x.last_touch_channel ? ` ${x.last_touch_channel}` : ''}`, x.owner ? `owner ${x.owner}` : null].filter(Boolean).join(' · ') })),
    ],
  };
}

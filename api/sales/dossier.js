import { cleanText, packHasPii, LINKEDIN_IN } from './scrubText.js';
import { laDateString } from './laDate.js';
import { addDays } from './goalsShared.js';
import { briefParts } from './companyBrief.js';
import { normName } from './normName.js';
import { recordCallIds } from './callLinks.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { normalizeLinkedinUrl } from '../lib/linkedinUrl.js';
import { TEAM_LABEL } from '../../src/constants/ownership.js';
import { PIPELINE_STATUSES } from '../../src/constants/partnerPipeline.js';

// FIX claude-pack-dossier P1 - the ONE Copy-for-Claude builder: a company's dossier, sections in a fixed order, every
// line a stored fact with its date. No AI call. Every free string passes cleanText; the pack is refused whole if an
// "@" or a phone shape is left (scrubText's packHasPii). The one exception is a stored linkedin.com/in/ profile link: it is
// validated by shape, never passed through the scrubber (a slug's digits read as a phone), and ignored by the check.
const TABLE = { partner: 'sales_goals', employer: 'sales_opportunities', target: 'sales_targets' };
const STATUS_LABEL = Object.fromEntries(PIPELINE_STATUSES.map(s => [s.id, s.label]));
const TERMS_LINE = /^\(\d{1,2}\/\d{1,2}\) Terms: /;
const EVENTS_MAX = 20, CALLS_MAX = 3, EMAILS_PER_PERSON = 6, SUMMARY_MAX = 400;
const LINKEDIN_ONLY = new RegExp(`^${LINKEDIN_IN.source}$`);
export const linkedinOf = raw => { const u = normalizeLinkedinUrl(raw); return u && LINKEDIN_ONLY.test(u) ? u : null; };

const err = (status, error) => Object.assign(new Error(error), { status });
const must = r => { if (r.error) throw err(500, r.error.message); return r.data; };
const when = iso => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' }) : '');
const onDay = d => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
const shortDay = d => new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const t = (v, max = 400) => (typeof v === 'string' ? v.split('\n').map(l => cleanText(l, max)).filter(Boolean).join('\n') : '');
const firstOf = name => (name ? cleanText(String(name).split(' ')[0], 40) : null);
const said = v => String(v || '').replace(/_/g, ' ');
const fields = pairs => pairs.filter(([, v]) => v).map(([k, v]) => `- ${k}: ${t(v)}`);

function companySection({ type, row, rec, lines, names }) {
  const owner = firstOf(names[row.owner_user_id]);
  const out = [[
    `Owner team: ${row.owner_team ? TEAM_LABEL[row.owner_team] : 'unset'}`,
    row.co_owner_name ? `Co-owner: ${t(row.co_owner_name, 120)}` : null,
    row.no_double_touch ? "Don't double-touch: yes" : null,
  ].filter(Boolean).join(' · ')];
  if (type === 'partner') out.push([`Stage: ${STATUS_LABEL[rec.stage] || rec.stage}`, row.category ? `Category: ${t(row.category, 120)}` : null, row.tier ? `Tier: ${row.tier}` : null, row.hot ? 'Hot' : null, owner ? `Owner: ${owner}` : 'Owner: unassigned'].filter(Boolean).join(' · '));
  if (type === 'employer') out.push([`Stage: ${row.stage}`, row.org_type ? `Type: ${row.org_type}` : null, row.covered_lives != null ? `Covered lives: ${row.covered_lives}` : null, row.tier ? `Tier: ${row.tier}` : null, row.is_top ? 'Top' : null, owner ? `Owner: ${owner}` : 'Owner: unassigned'].filter(Boolean).join(' · '));
  if (type === 'target') out.push([`Status: ${row.status}`, row.kind ? `Kind: ${row.kind}` : null, row.suggested_category ? `Suggested category: ${t(row.suggested_category, 120)}` : null, owner ? `Owner: ${owner}` : 'Owner: unassigned'].filter(Boolean).join(' · '));
  const score = lines.find(l => l.kind === 'score');
  if (score) out.push(`Score: ${score.text}`);
  if (rec.top) out.push(`Pinned until ${when(rec.pinned_until)}${rec.pin_reason ? ` · reason: ${t(rec.pin_reason, 200)}` : ''}`);
  if (row.employees != null) out.push(`Size: ${Number(row.employees).toLocaleString('en-US')} employees${row.employees_source ? ` (${said(row.employees_source)}${row.employees_at ? `, ${when(row.employees_at)}` : ''})` : ''}`);
  if (row.apollo_firmographics?.industry) out.push(`Industry: ${t(row.apollo_firmographics.industry, 120)}`);
  if (rec.site?.domain) out.push(`Domain: ${t(rec.site.domain, 120)}${rec.site.confirmed ? '' : ' (not confirmed)'}`);
  for (const l of lines.filter(x => x.kind === 'source')) out.push(l.text);
  if (rec.next_step) out.push(`Next step: ${t(rec.next_step)}${type === 'employer' && rec.next_step_due ? ` (${onDay(rec.next_step_due)})` : ''}`);
  if (type === 'partner' && row.next_meeting_at) out.push(`Next meeting: ${onDay(row.next_meeting_at)}`);
  return out.map(l => [`- ${l}`]);
}

function whyNowSection({ visit, messages, people, lines, today }) {
  const out = [];
  if (visit) {
    out.push(`Visits (page loads), 7 d to ${onDay(visit.pulled_on)}: ${visit.visits_7d ?? 'unknown'}${visit.unique_visitors_7d != null ? ` · distinct visitors: ${visit.unique_visitors_7d}` : ''}${visit.last_visit ? ` · last visit ${onDay(visit.last_visit)}` : ''}`);
    const weeks = (Array.isArray(visit.weekly) ? visit.weekly : []).filter(w => w?.week_start && w.week_start >= addDays(today, -30)).sort((a, b) => String(b.week_start).localeCompare(String(a.week_start)));
    if (weeks.length) out.push(`Visits by week, last 30 d: ${weeks.map(w => `week of ${shortDay(w.week_start)}: ${w.count}`).join(' · ')} (total ${weeks.reduce((n, w) => n + (Number(w.count) || 0), 0)})`);
    const pages = (Array.isArray(visit.top_paths) ? visit.top_paths : []).slice(0, 5).map(p => cleanText(typeof p === 'string' ? p : p?.path || '', 120)).filter(Boolean);
    if (pages.length) out.push(`Top pages (${onDay(visit.pulled_on)}): ${pages.join(', ')}`);
  } else out.push('No site visits on record');
  if (messages.length) {
    const since = `${addDays(today, -30)}T00:00:00`;
    const n = f => messages.filter(m => m[f] && m[f] >= since).length;
    out.push(`Email, last 30 d: ${n('delivered_at')} delivered · ${n('last_opened_at')} opened · ${n('last_clicked_at')} clicked · ${n('replied_at')} replied`);
  } else out.push('No emails of ours on record');
  const hottest = people.filter(p => p.heat != null).sort((a, b) => b.heat - a.heat)[0];
  if (hottest) out.push(`Hottest person: ${hottest.name} · heat ${hottest.heat_band} (${hottest.heat})`);
  const touch = lines.find(l => l.kind === 'touch');
  if (touch) out.push(touch.text);
  return out.map(l => [`- ${l}`]);
}

function personItem(p, { messages, names, isFirst }) {
  const head = [p.name, p.title, p.role, p.linkedin ? `LinkedIn ${p.linkedin}` : null, firstOf(names[p.owner_user_id]) ? `owner ${firstOf(names[p.owner_user_id])}` : null,
    p.heat != null ? `heat ${p.heat_band} (${p.heat})` : null, p.status ? `status ${said(p.status)}` : null, p.identified_at ? `identified on site ${when(p.identified_at)}` : null,
    isFirst ? '(the person this copy is about)' : null].filter(Boolean).join(' · ');
  const mine = p.contact_id ? messages.filter(m => m.contact_id === p.contact_id).sort((a, b) => String(b.delivered_at || '').localeCompare(String(a.delivered_at || ''))) : [];
  const sent = mine.slice(0, EMAILS_PER_PERSON).map(m => {
    const did = [m.num_opens ? `opened ${m.num_opens}` : null, m.num_clicks ? `clicked ${m.num_clicks}` : null, m.replied ? `replied${m.reply_class ? ` (${said(m.reply_class)})` : ''}${m.replied_at ? ` ${when(m.replied_at)}` : ''}` : null, m.bounced ? 'bounced' : null].filter(Boolean).join(' · ') || 'no open yet';
    return `  - sent ${[m.step != null ? `step ${m.step}` : null, m.delivered_at ? when(m.delivered_at) : 'not delivered', m.subject ? `"${cleanText(m.subject, 160)}"` : null].filter(Boolean).join(' · ')} → ${did}`;
  });
  return [`- ${head}`, ...sent, ...(mine.length > EMAILS_PER_PERSON ? [`  - + ${mine.length - EMAILS_PER_PERSON} earlier emails`] : []), ...(p.contact_id && !mine.length ? ['  - nothing sent on record'] : [])];
}

function callItem(n, companyName) {
  const about = x => !x?.company || normName(x.company) === normName(companyName);
  const who = (Array.isArray(n.attendees) ? n.attendees : []).map(a => cleanText(a?.name || '', 80)).filter(Boolean);
  const ex = n.extract && typeof n.extract === 'object' ? n.extract : {};
  return [
    `- ${[onDay(n.call_date), t(n.title || 'Call', 160), n.source_label && n.source_label !== n.title ? t(n.source_label, 120) : null, who.length ? `with ${who.join(', ')}` : null].filter(Boolean).join(' · ')}`,
    ...(cleanText(n.text || '', SUMMARY_MAX) ? [`  - ${cleanText(n.text, SUMMARY_MAX)}`] : []),
    ...(Array.isArray(ex.decisions) ? ex.decisions : []).filter(about).slice(0, 5).map(d => `  - decided: ${cleanText(String(d.text || ''), 300)}`),
    ...(Array.isArray(ex.waiting_on) ? ex.waiting_on : []).filter(about).slice(0, 5).map(w => `  - waiting on ${cleanText(String(w.who || 'them'), 80)}: ${cleanText(String(w.text || ''), 300)}`),
  ];
}

async function historyFor(supabase, businessId, type, id, { detail, names }) {
  if (type === 'partner') {
    const ev = must(await supabase.from('sales_partner_events').select('at, event, note, touch_type, contact_names, from_status, to_status, source, by_user, meta').eq('business_id', businessId).eq('goal_id', id).in('event', ['touch', 'note', 'status']).order('at', { ascending: false }).limit(EVENTS_MAX));
    return ev.map(e => (e.event === 'touch'
      ? [when(e.at), e.touch_type, e.meta?.direction === 'received' ? 'in' : 'out', e.contact_names?.length ? t(e.contact_names.join(', '), 200) : null, firstOf(names[e.by_user]) ? `by ${firstOf(names[e.by_user])}` : e.source !== 'manual' ? `via ${e.source}` : null]
      : e.event === 'note' ? [when(e.at), e.meta?.kind === 'decision' ? 'decision' : 'note', t(e.note, 300)]
        : [when(e.at), `stage ${STATUS_LABEL[e.from_status] || e.from_status || '?'} → ${STATUS_LABEL[e.to_status] || e.to_status || '?'}`]).filter(Boolean).join(' · '));
  }
  if (type === 'employer') {
    const ev = must(await supabase.from('sales_opportunity_events').select('event_type, from_stage, to_stage, changed_at').eq('business_id', businessId).eq('opportunity_id', id).order('changed_at', { ascending: false }).limit(EVENTS_MAX));
    return [
      ...ev.map(e => ({ at: e.changed_at, text: e.event_type === 'stage_change' ? `${e.from_stage} → ${e.to_stage}` : e.event_type })),
      ...(detail.recent || []).filter(r => r.event === 'client' || r.event === 'todo_done').map(r => ({ at: r.at, text: r.text })),
    ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, EVENTS_MAX).map(e => `${when(e.at)} · ${e.text}`);
  }
  return detail.record.created_at ? [`${when(detail.record.created_at)} · added as a target`] : [];
}

// The call notes that reach a record: the to-dos a note made on it, a partner event a note wrote, a target's source note.
async function callsFor(supabase, businessId, type, id, row) {
  const [todos, events] = await Promise.all([
    supabase.from('sales_week_goals').select('source_note_id').eq('business_id', businessId).eq('link_type', type).eq('link_id', id).not('source_note_id', 'is', null).limit(200).then(must),
    type === 'partner' ? supabase.from('sales_partner_events').select('meta').eq('business_id', businessId).eq('goal_id', id).not('meta->>from_note_id', 'is', null).limit(200).then(must) : [],
  ]);
  // fathom-notes-v1 F12: the notes linked to this record come first, then what the older rules reach.
  const ids = await recordCallIds(supabase, businessId, type, id, [...todos.map(x => x.source_note_id), ...events.map(e => e.meta?.from_note_id), row.source_note_id]);
  if (!ids.length) return [];
  const rows = must(await supabase.from('sales_call_notes').select('id, title, call_date, text, source_label, attendees, extract, record_type, record_id').eq('business_id', businessId).in('id', ids).order('call_date', { ascending: false }));
  const linked = n => n.record_type === type && n.record_id === id;
  return [...rows.filter(linked), ...rows.filter(n => !linked(n))].slice(0, CALLS_MAX);
}

// -> { title, sections: [{ head, count?, items: [[line, ...sub-lines]], noun?, keep? }] }. first = { key, name } of the
// person the copy was asked from: that person leads People and is never cut.
export async function dossier(supabase, { businessId, type, id, names, first = null, now = Date.now() }) {
  const parts = await briefParts(supabase, { businessId, type, id, now });
  if (parts.error) throw err(parts.error.status, parts.error.body.error);
  const { detail, lines } = parts;
  const rec = detail.record;
  const today = laDateString(new Date(now));
  const row = must(await supabase.from(TABLE[type]).select('*').eq('business_id', businessId).eq('id', id).maybeSingle()) || {};
  const contactIds = [...new Set(detail.people.map(p => p.contact_id).filter(Boolean))];
  const [messages, activity, identified, roles, visits, history, calls] = await Promise.all([
    contactIds.length ? selectAllPages(() => supabase.from('sales_email_messages').select('apollo_message_id, contact_id, step, delivered_at, subject, num_opens, num_clicks, last_opened_at, last_clicked_at, replied, reply_class, replied_at, bounced').eq('business_id', businessId).in('contact_id', contactIds).order('apollo_message_id')) : [],
    selectAllPages(() => supabase.from('sales_person_activity').select('person_key, contact_id, heat, heat_band').eq('business_id', businessId).order('person_key')),
    type === 'partner' ? [] : supabase.from('sales_people').select('id, created_at').eq('business_id', businessId).eq(type === 'employer' ? 'opportunity_id' : 'target_id', id).eq('source_kind', 'web_visit').limit(200).then(must),
    type === 'partner' ? supabase.from('partner_contacts').select('id, role_in_notes').eq('business_id', businessId).eq('goal_id', id).limit(200).then(must) : [],
    supabase.from('web_visits').select('pulled_on, last_visit, visits_7d, unique_visitors_7d, weekly, top_paths').eq('business_id', businessId).eq('matched_type', type).eq('matched_id', id).order('pulled_on', { ascending: false }).limit(1).then(must),
    historyFor(supabase, businessId, type, id, { detail, names }),
    callsFor(supabase, businessId, type, id, row),
  ]);
  const heatOf = new Map(activity.flatMap(a => [[a.person_key, a], ...(a.contact_id ? [[`c:${a.contact_id}`, a]] : [])]));
  const identifiedAt = new Map(identified.map(p => [`person:${p.id}`, p.created_at]));
  const roleOf = new Map(roles.map(c => [`contact:${c.id}`, c.role_in_notes]));
  const isFirst = p => !!first && (p.person_key === first.key || (p.contact_id && first.key === `prospect:${p.contact_id}`) || (!!first.name && normName(p.name) === normName(first.name)));
  const people = detail.people.map(p => {
    const a = heatOf.get(p.person_key) || (p.contact_id ? heatOf.get(`c:${p.contact_id}`) : null);
    return { ...p, name: cleanText(p.name, 120), title: p.title ? cleanText(p.title, 160) : null, role: roleOf.get(p.person_key) ? cleanText(roleOf.get(p.person_key), 120) : null, linkedin: linkedinOf(p.linkedin_url), heat: a?.heat ?? null, heat_band: a?.heat_band ?? null, identified_at: identifiedAt.get(p.person_key) || null };
  }).sort((a, b) => isFirst(b) - isFirst(a));
  const kept = people.filter(isFirst).length;

  const intel = [
    ...(type === 'partner' ? fields([['Champion', row.champion], ['Angle', row.angle], ['Watch-outs', row.watch_outs], ["Don't say", row.do_not_say], ['Target titles', row.target_titles], ['Known contacts', row.known_contacts], ['Sequence to use', row.sequence_to_use]]) : []),
    ...(type === 'employer' ? fields([['Champion', row.champion], ['Decision makers', row.decision_makers], ['Objections', row.objections], ['Needed to advance', row.needed_to_advance], ['Competitors', row.competitors], ['Notes', row.notes]]) : []),
    ...(detail.decisions || []).map(d => `- ${['Decision', when(d.at), d.text].filter(Boolean).join(' · ')}`),
    ...(detail.waiting || []).map(w => `- Waiting on them · ${[w.waiting_on, w.text, w.due_date ? `due ${onDay(w.due_date)}` : null].filter(Boolean).join(' · ')}`),
    ...(row.notes || '').split('\n').filter(l => TERMS_LINE.test(l)).map(l => `- ${t(l, 400)}`),
  ];
  const research = [
    ...lines.filter(l => l.kind === 'research').map(l => `- ${l.text}`),
    ...(type === 'target' ? [...t(row.evidence).split('\n').filter(Boolean).map(l => `- Evidence: ${l}`), ...t(row.research_notes, 4000).split('\n').filter(Boolean).map(l => `- Note: ${l}`)] : []),
  ];
  const list = (rows, none) => (rows.length ? rows.map(l => [l]) : [[none]]);
  return {
    title: `# ${t(rec.name, 160)} — ${type}`,
    sections: [
      { head: '## Company', items: companySection({ type, row, rec, lines, names }) },
      { head: '## Why now', items: whyNowSection({ visit: visits[0] || null, messages, people, lines, today }) },
      { head: '## People', count: people.length, noun: 'people', keep: Math.max(1, kept), items: people.length ? people.map(p => personItem(p, { messages, names, isFirst: isFirst(p) })) : [['- none on file']] },
      { head: '## Calls', count: calls.length, noun: 'calls', items: calls.length ? calls.map(n => callItem(n, rec.name)) : [['- none linked to this record']] },
      { head: '## Intel', noun: 'lines', items: list(intel, '- none recorded') },
      { head: '## History', count: history.length, noun: 'events', items: list(history.map(l => `- ${l}`), '- none recorded') },
      { head: '## Open to-dos', noun: 'to-dos', items: list((detail.todos || []).map(x => `- ${[x.text, firstOf(x.owner), x.due_date ? `due ${onDay(x.due_date)}` : null].filter(Boolean).join(' · ')}`), '- none') },
      { head: '## Research', noun: 'lines', items: list(research, '- none yet') },
    ],
  };
}

const renderBlock = b => (b.flat ? b.flat : [b.title, ...b.sections.flatMap(s => ['', s.count != null ? `${s.head} (${s.count})` : s.head, ...s.items.flat(), ...(s.cut ? [`+ ${s.cut} more ${s.noun}`] : [])])]);

// company-context-v1 fills this; until its table exists the section says so (never a hardcoded fact about us).
async function aboutUs(supabase, businessId, segments) {
  const r = await supabase.from('sales_company_context').select('kind, text, segment').eq('business_id', businessId).eq('status', 'active').in('kind', ['about', 'proof_point', 'angle', 'objection']);
  const rows = (r.error ? [] : r.data || []).filter(x => !x.segment || x.segment === 'all' || segments.includes(x.segment));
  return rows.length ? rows.map(x => `- ${said(x.kind)}: ${cleanText(x.text, 400)}`) : ['(no company context yet)'];
}

// P2: at most `max` characters - the LAST item of the longest cuttable section goes first (lists are most-relevant
// first), each cut counted on its section as "+ n more people / events / …"; Company and Why now are never cut.
// blocks: [{ title, sections } | { flat: [lines] }] -> { text, chars, cut } | { blocked: true }.
export async function buildPack(supabase, { businessId, blocks, head = [], ask = '', max }) {
  const about = await aboutUs(supabase, businessId, blocks.flatMap(b => (b.type ? [b.type] : [])));
  const text = () => `${[...head, ...blocks.flatMap((b, i) => [...(i || head.length ? [''] : []), ...renderBlock(b)]), '', '## About us', ...about, '', '## Ask', ...(ask ? [ask] : [])].join('\n')}\n`;
  let cut = 0;
  while (text().length > max) {
    const open = blocks.flatMap(b => b.sections || []).filter(s => s.noun && s.items.length > (s.keep || 1));
    if (!open.length) break;
    const longest = open.reduce((a, b) => (b.items.flat().join('\n').length > a.items.flat().join('\n').length ? b : a));
    longest.items.pop(); longest.cut = (longest.cut || 0) + 1; cut += 1;
  }
  let out = text();
  if (out.length > max) out = `${out.slice(0, max - 1)}…`;
  if (packHasPii(out)) return { blocked: true };
  return { text: out, chars: out.length, cut };
}

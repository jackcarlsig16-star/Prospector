import { cleanText } from './scrubText.js';
import { STAGE_ORDER, SIDE_LANES } from './pipelineStages.js';
import { PIPELINE_STATUSES } from '../../src/constants/partnerPipeline.js';
import { HEAT, HEAT_BANDS } from './heatScore.js';
import { sourceDirectory } from './leadSource.js';
import { memberColors } from './memberColors.js';
import { salesIntents, salesStanding } from './scoutIntents.js';

// scout-v2 REV2 Stage 1 - what the sales module registers with Scout (api/scout/registry.js): its searchable entities
// (D1 search: names, titles and text only - never an address or a phone; Outlook subjects only on a query of 3+ words),
// its openers (D2: everything company-shaped opens the company window by panelKey; people / to-dos / notes open their
// list with the record key; where no reader exists the opener says inline), its vocabulary and glossary (D7: the band
// words, stages, source labels, members and buyer titles come from the settings and constants the screens use), and
// its intents + standing context (scoutIntents.js). appliesTo: the workspace's goals_sales feature.
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
export const pat = q => `%${String(q || '').replace(/[%_,()"'\\]/g, ' ').replace(/\s+/g, ' ').trim()}%`;
const day = v => (v ? String(v).slice(0, 10) : null);
const window_ = ({ page = 'sales', ...params }, inline = false) => ({ page, params, ...(inline ? { inline: true } : {}) });
export const company = (type, id) => window_({ tab: 'pipeline', view: 'companies', open: `${type}-${id}` });
const words = s => String(s || '').toLowerCase().split(/[\s/]+/).filter(w => w.length > 2);

export const ENTITIES = [
  { entity: 'partners', label: 'Partners', open: id => company('partner', id),
    async search(sb, { businessId, q, limit }) {
      const rows = must(await sb.from('sales_goals').select('id, name, company_domain, notes, category, pipeline_status, owner_user_id, updated_at').eq('business_id', businessId).eq('goal_type', 'partnership').is('archived_at', null).or(`name.ilike.${pat(q)},company_domain.ilike.${pat(q)},notes.ilike.${pat(q)}`).order('updated_at', { ascending: false }).limit(limit));
      return rows.map(r => ({ id: r.id, title: r.name, subtitle: [r.pipeline_status?.replace(/_/g, ' '), r.category].filter(Boolean).join(' · '), date: day(r.updated_at), text: [r.name, 'partner', r.pipeline_status?.replace(/_/g, ' '), r.category, r.company_domain, r.notes ? cleanText(r.notes, 160) : null].filter(Boolean).join(' · ') }));
    } },
  { entity: 'employers', label: 'Employers', open: id => company('employer', id),
    async search(sb, { businessId, q, limit }) {
      const rows = must(await sb.from('sales_opportunities').select('id, organization, stage, cohort, notes, owner, client_status, updated_at').eq('business_id', businessId).is('archived_at', null).or(`organization.ilike.${pat(q)},cohort.ilike.${pat(q)},notes.ilike.${pat(q)}`).order('updated_at', { ascending: false }).limit(limit));
      return rows.map(r => ({ id: r.id, title: r.organization, subtitle: [r.client_status ? `client · ${r.client_status}` : r.stage?.replace(/_/g, ' '), r.cohort].filter(Boolean).join(' · '), date: day(r.updated_at), text: [r.organization, 'employer', r.client_status ? `client ${r.client_status}` : `stage ${r.stage?.replace(/_/g, ' ')}`, r.cohort, r.owner ? `owner ${r.owner}` : null, r.notes ? cleanText(r.notes, 160) : null].filter(Boolean).join(' · ') }));
    } },
  { entity: 'targets', label: 'Targets', open: id => company('target', id),
    async search(sb, { businessId, q, limit }) {
      const rows = must(await sb.from('sales_targets').select('id, name, status, kind, evidence, research_notes, updated_at').eq('business_id', businessId).or(`name.ilike.${pat(q)},evidence.ilike.${pat(q)},research_notes.ilike.${pat(q)}`).order('updated_at', { ascending: false }).limit(limit));
      return rows.map(r => ({ id: r.id, title: r.name, subtitle: [r.status, r.kind].filter(Boolean).join(' · '), date: day(r.updated_at), text: [r.name, 'target', r.status, r.kind, r.evidence ? cleanText(r.evidence, 160) : null].filter(Boolean).join(' · ') }));
    } },
  { entity: 'clients', label: 'Clients', open: id => window_({ tab: 'pipeline', view: 'clients', open: `employer-${id}` }),
    async search(sb, { businessId, q, limit }) {
      const rows = must(await sb.from('sales_opportunities').select('id, organization, client_status, covered_lives, expected_launch, updated_at').eq('business_id', businessId).is('archived_at', null).not('client_status', 'is', null).ilike('organization', pat(q)).order('updated_at', { ascending: false }).limit(limit));
      return rows.map(r => ({ id: r.id, title: r.organization, subtitle: `client · ${r.client_status}`, date: day(r.expected_launch || r.updated_at), text: [r.organization, `client ${r.client_status}`, r.covered_lives != null ? `${r.covered_lives} covered lives` : null, r.expected_launch ? `launch ${day(r.expected_launch)}` : null].filter(Boolean).join(' · ') }));
    } },
  { entity: 'people', label: 'People', open: id => window_({ tab: 'pipeline', view: 'people', open: `person:${id}` }),
    async search(sb, { businessId, q, limit }) {
      const [pros, ppl, contacts] = await Promise.all([
        sb.from('sales_prospect_state').select('contact_id, name, title, company').eq('business_id', businessId).or(`name.ilike.${pat(q)},title.ilike.${pat(q)},company.ilike.${pat(q)}`).limit(limit).then(must),
        sb.from('sales_people').select('id, name, title, company_name, source_kind').eq('business_id', businessId).is('archived_at', null).or(`name.ilike.${pat(q)},title.ilike.${pat(q)},company_name.ilike.${pat(q)}`).limit(limit).then(must),
        sb.from('partner_contacts').select('id, name, title').eq('business_id', businessId).or(`name.ilike.${pat(q)},title.ilike.${pat(q)}`).limit(limit).then(must),
      ]);
      const row = (id, name, title, co, source) => ({ id, title: cleanText(name, 120), subtitle: [title, co].filter(Boolean).join(' · '), text: [cleanText(name, 120), title ? cleanText(title, 120) : null, co ? cleanText(co, 120) : null, source].filter(Boolean).join(' · ') });
      return [...pros.map(p => row(`prospect:${p.contact_id}`, p.name, p.title, p.company, 'Apollo sequence')), ...ppl.map(p => row(`person:${p.id}`, p.name, p.title, p.company_name, p.source_kind === 'web_visit' ? 'identified visitor' : 'added')), ...contacts.map(c => row(`contact:${c.id}`, c.name, c.title, null, 'partner contact'))].filter(r => r.title).slice(0, limit);
    } },
  { entity: 'todos', label: 'To-dos', open: id => window_({ tab: 'actions', open: `todo:${id}` }),
    async search(sb, { businessId, q, limit }) {
      const rows = must(await sb.from('sales_week_goals').select('id, text, status, due_date, owner_user_id, week_start, updated_at').eq('business_id', businessId).eq('kind', 'todo').ilike('text', pat(q)).order('updated_at', { ascending: false }).limit(limit));
      return rows.map(r => ({ id: r.id, title: cleanText(r.text, 140), subtitle: [r.status, r.due_date ? `due ${day(r.due_date)}` : null].filter(Boolean).join(' · '), date: day(r.due_date || r.updated_at), text: [cleanText(r.text, 200), `to-do ${r.status}`, r.due_date ? `due ${day(r.due_date)}` : 'no date'].join(' · ') }));
    } },
  { entity: 'call_notes', label: 'Call notes', open: id => window_({ tab: 'actions', open: `note:${id}` }, true),
    async search(sb, { businessId, q, limit }) {
      const rows = must(await sb.from('sales_call_notes').select('id, title, call_date, text').eq('business_id', businessId).or(`title.ilike.${pat(q)},text.ilike.${pat(q)}`).order('call_date', { ascending: false }).limit(limit));
      return rows.map(r => ({ id: r.id, title: cleanText(r.title || 'Call note', 120), subtitle: day(r.call_date), date: day(r.call_date), text: [cleanText(r.title || 'Call note', 120), day(r.call_date), cleanText(r.text, 240)].filter(Boolean).join(' · ') }));
    } },
  { entity: 'insights', label: 'Insights', open: id => window_({ tab: 'actions', open: `insight:${id}` }, true),
    async search(sb, { businessId, q, limit }) {
      const rows = must(await sb.from('sales_insights').select('id, kind, text, why, status, created_at').eq('business_id', businessId).or(`text.ilike.${pat(q)},why.ilike.${pat(q)}`).order('created_at', { ascending: false }).limit(limit));
      return rows.map(r => ({ id: r.id, title: cleanText(r.text, 140), subtitle: [r.kind, r.status].filter(Boolean).join(' · '), date: day(r.created_at), text: [cleanText(r.text, 200), r.kind, r.status, r.why ? cleanText(r.why, 160) : null].filter(Boolean).join(' · ') }));
    } },
  { entity: 'intel', label: 'Company intel', open: () => window_({ page: 'business-intel' }, true),
    async search(sb, { businessId, q, limit }) {
      const rows = must(await sb.from('business_intel_entries').select('id, source, content, created_at').eq('business_id', businessId).or(`content.ilike.${pat(q)},source.ilike.${pat(q)}`).order('created_at', { ascending: false }).limit(limit));
      return rows.map(r => ({ id: r.id, title: cleanText(String(r.content || '').slice(0, 120), 120), subtitle: r.source, date: day(r.created_at), text: [r.source, cleanText(r.content, 240)].filter(Boolean).join(' · ') }));
    } },
  { entity: 'accounts', label: 'Accounts', open: id => window_({ page: 'accounts', account: id }),
    async search(sb, { businessId, q, limit }) {
      const rows = must(await sb.from('accounts').select('id, data, updated_at').eq('business_id', businessId).ilike('data->>name', pat(q)).order('updated_at', { ascending: false }).limit(limit));
      return rows.map(r => ({ id: r.id, title: cleanText(r.data?.name || 'Account', 120), subtitle: [r.data?.web, r.data?.industry].filter(Boolean).join(' · '), date: day(r.updated_at), text: [cleanText(r.data?.name || 'Account', 120), r.data?.web, r.data?.industry, r.data?.notes ? cleanText(String(r.data.notes), 160) : null].filter(Boolean).join(' · ') }));
    } },
  { entity: 'outlook', label: 'Outlook (subjects)', open: () => window_({ tab: 'pipeline' }, true), gate: ({ words: w }) => w.length >= 3,
    async search(sb, { businessId, q, limit }) {
      const [msgs, events] = await Promise.all([
        sb.from('microsoft_messages').select('graph_id, subject, direction, occurred_at, external_domains').eq('business_id', businessId).ilike('subject', pat(q)).order('occurred_at', { ascending: false }).limit(limit).then(must),
        sb.from('microsoft_events').select('graph_id, subject, start_at, external_domains').eq('business_id', businessId).ilike('subject', pat(q)).order('start_at', { ascending: false }).limit(limit).then(must),
      ]);
      const line = (r, kind, at) => ({ id: r.graph_id, title: cleanText(r.subject || '(no subject)', 120), subtitle: [kind, day(at), (r.external_domains || []).slice(0, 2).join(' ')].filter(Boolean).join(' · '), date: day(at), text: [cleanText(r.subject || '(no subject)', 120), kind, day(at), (r.external_domains || []).slice(0, 2).join(' ')].filter(Boolean).join(' · ') });
      return [...msgs.map(m => line(m, m.direction === 'sent' ? 'email sent' : 'email received', m.occurred_at)), ...events.map(e => line(e, 'meeting', e.start_at))].slice(0, limit);
    } },
];

// The intents' rows that aren't searchable entities still open their nearest list (shown inline in Scout too):
// an unmatched visitor -> Pipeline › Companies on the Website visitors channel; pulse -> Email; funnel -> Sources;
// needs attention -> Actions.
export const OPENERS = {
  visitor: () => window_({ tab: 'pipeline', view: 'companies', channel: 'website_visit' }, true),
  pulse: () => window_({ tab: 'dashboard', view: 'analytics' }, true),
  funnel: () => window_({ tab: 'dashboard', view: 'sources' }, true),
  attention: () => window_({ tab: 'actions' }, true),
};

export const VOCABULARY = {
  entities: {
    todos: ['task', 'tasks', 'to-do', 'to-dos', 'todo', 'todos', 'to do', 'to dos', 'action items'],
    call_notes: ['note', 'notes', 'call notes', 'call note', 'debrief'],
    visitors: ['visitor', 'visitors', 'visited', 'visiting', 'website visits', 'web visits'],
    people: ['people', 'person', 'contacts', 'contact', 'prospects', 'prospect', 'who opened', 'who replied', 'who clicked'],
    partners: ['partner', 'partners', 'partnership', 'partnerships'],
    clients: ['client', 'clients', 'signed'],
    employers: ['employer', 'employers', 'opportunities', 'opportunity'],
    targets: ['target', 'targets'],
    insights: ['insight', 'insights'],
    intel: ['intel', 'company intel'],
    accounts: ['account', 'accounts'],
    emails: ['emails', 'sequences', 'sequence', 'open rate', 'reply rate', 'campaigns'],
  },
  bands: { hot: 'P1', warm: 'P2', cool: 'P3', cold: 'P4' },
  sources: { 'partner referral': 'partner_referral', referred: 'partner_referral', referral: 'partner_referral', referrals: 'partner_referral', upside: 'upside', 'person referral': 'person_referral', campaign: 'campaign', inbound: 'inbound', lookalike: 'lookalike', apollo: 'apollo', outreach: 'homelover_outreach' },
};

// D7: the house words from the data and the constants the screens use - never a hand-written prompt.
export async function glossary(sb, { businessId }) {
  const [{ mergeWeights }, { BAND_WORD }, { SOURCE_WORD }, settings, members, colors, reps] = await Promise.all([
    import('./intentScoreRun.js'), import('./teamEmails/visitorEmail.js'), import('./companyBrief.js'),
    sb.from('sales_settings').select('score_weights, buyer_titles').eq('business_id', businessId).maybeSingle().then(must),
    sb.from('business_members').select('user_id, name, role, profile:profiles!business_members_user_id_fkey(display_name)').eq('business_id', businessId).not('user_id', 'is', null).then(must),
    memberColors(sb, businessId).catch(() => new Map()),
    sb.from('sales_targets').select('co_owner_name, owner_team').eq('business_id', businessId).not('co_owner_name', 'is', null).limit(200).then(must),
  ]);
  const t = mergeWeights(settings?.score_weights).thresholds;
  const names = members.map(m => ({ id: m.user_id, name: (m.profile?.display_name || m.name || '').trim(), role: m.role, color: colors.get(m.user_id) || null })).filter(m => m.name);
  const dir = sourceDirectory([], reps);
  const repWords = {};
  for (const r of reps) { const first = String(r.co_owner_name || '').trim().split(/\s+/)[0]; const rep = dir.rep(first); if (first && rep && ['upside', 'both'].includes(r.owner_team)) repWords[first.toLowerCase()] = 'upside'; }
  const lines = [
    `Company intent bands (the Map's score): ${['P1', 'P2', 'P3', 'P4'].map(b => `${b} = ${BAND_WORD[b]}${b === 'P1' ? ` (score ≥ ${t.P1})` : b === 'P2' ? ` (${t.P2}-${t.P1 - 1})` : b === 'P3' ? ` (${t.P3}-${t.P2 - 1})` : ` (< ${t.P3})`}`).join(', ')}.`,
    `People heat (email engagement + the company's website visits, the Huddle's rule): hot = score ≥ ${HEAT_BANDS.hotScore}, a human click in ${HEAT_BANDS.recentDays} days, or the company on the site in ${HEAT.visitDays} days with an email sent (an identified visitor counts); warm = score ≥ ${HEAT_BANDS.warmScore} or a real open in ${HEAT_BANDS.recentDays} days; else cold. A visit adds ${HEAT.visitBase} + ${HEAT.visitPerVisitor} per unique visitor (up to ${HEAT.visitVisitorsMax}); a visit alone is warm at most.`,
    `Employer stages in order: ${STAGE_ORDER.join(', ')}; side lanes: ${SIDE_LANES.join(', ')}. Partner stages: ${PIPELINE_STATUSES.map(s => s.label).join(', ')}.`,
    `Source labels: ${Object.entries(SOURCE_WORD).map(([k, v]) => `${k} = ${v}`).join(', ')}.${Object.keys(repWords).length ? ` Reps: ${Object.keys(repWords).map(w => `${w[0].toUpperCase()}${w.slice(1)} refers through Upside`).join(', ')}.` : ''}`,
    names.length ? `Members: ${names.map(m => `${m.name} (${m.role}${m.color ? `, ${m.color}` : ''})`).join(', ')}.` : null,
    settings?.buyer_titles?.length ? `Buyer titles: ${settings.buyer_titles.slice(0, 20).join(', ')}.` : null,
  ].filter(Boolean);
  const sources = { ...repWords };
  for (const [k, v] of Object.entries(SOURCE_WORD)) if (!['other', 'scout', 'website'].includes(k)) for (const w of v.toLowerCase().split(' / ')) sources[w] = k;
  return { lines, vocabulary: { sources, members: names }, members: names, thresholds: t };
}

export async function register(registry) {
  registry.register('sales', { appliesTo: b => !!b.features?.goals_sales, entities: ENTITIES, openers: OPENERS, intents: salesIntents, standing: salesStanding, glossary, vocabulary: VOCABULARY });
}
export { words };

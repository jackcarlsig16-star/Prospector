// homelover-clients-v1 C11 - the HomeLover connector's four tools. Each runs as the token's user in the token's workspace
// through the same functions the Pipeline uses (makeClient / markClient with via 'connector', insertCompanyRecord), so
// the rules are the panel's rules. Nothing here calls Claude or Apollo, writes Apollo or sends anything, and no reply
// carries an email address, a phone number or another workspace's data - only this workspace's company names and ids.
import { getServiceSupabase } from '../lib/authUser.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { hasPii, cleanText } from '../sales/scrubText.js';
import { normName } from '../sales/intakeMatch.js';
import { makeClient, markClient } from '../sales/clients.js';
import { insertCompanyRecord } from '../sales/companyPanel.js';
import { normalizeDomain } from '../../src/constants/partnerDomains.js';

export const LOOKALIKE_MAX = 25, CHECK_MAX = 50;
const SOURCE_TYPES = ['broker', 'partner', 'intro', 'inbound', 'direct'];
const STATUSES = ['verbal_yes', 'agreement_sent', 'signed', 'launched'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class ToolError extends Error { constructor(msg, extra = {}) { super(msg); this.extra = extra; } }

const str = (maxLength, description) => ({ type: 'string', maxLength, description });
const int = description => ({ type: 'integer', minimum: 0, description });
const DATE = description => ({ type: 'string', maxLength: 10, description: `${description} (YYYY-MM-DD)` });
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

export const TOOLS = [
  { name: 'add_client', readOnly: false,
    description: 'Log a new HomeLover client (or update one): status, eligible lives, dates, who referred it and its Apollo ids. Idempotent on domain, then exact company name - a second call updates, never duplicates. Sets the pipeline stage from the status, stops this company\'s Prospector campaign contacts, adds "Send agreement" for a verbal yes. Names and short text only - never an email address or phone number.',
    inputSchema: obj({
      company_name: str(160, 'Company name as it should read in Prospector'), domain: str(253, 'Website domain, e.g. momentum.org (needed to add a company Prospector doesn\'t have yet)'),
      status: { type: 'string', enum: STATUSES, description: 'verbal_yes | agreement_sent | signed | launched' },
      eligible_now: int('Eligible lives today'), eligible_added: int('Eligible lives being added'), eligible_added_note: str(200, 'Why lives are being added, e.g. "acquisition, expected April 2027"'),
      launch_date: DATE('Launch date'), expected_signing_date: DATE('Expected signing date'),
      source_type: { type: 'string', enum: SOURCE_TYPES, description: 'broker | partner (a partner referral) · intro (a person) · inbound · direct (HomeLover outreach)' },
      source_name: str(120, 'Who: the referring person (intro, or the partner\'s rep) or the partner\'s name'), referred_by_partner: str(160, 'The referring partner as it is named in Prospector'),
      apollo_account_id: str(80, 'Apollo account id'), apollo_deal_id: str(80, 'Apollo deal id'), apollo_org_id: str(80, 'Apollo organization id'),
      primary_contact_name: str(120, 'Primary contact name (no email / phone)'), primary_contact_title: str(160, 'Their title'),
      hq_city: str(80, 'HQ city'), hq_state: str(40, 'HQ state'), notes: str(500, 'A short note'),
    }, ['company_name', 'status', 'source_type']) },
  { name: 'mark_signed', readOnly: false, description: 'Mark a client signed (status signed, signed date, the pipeline stage to Contract). Name it by company_id (from add_client) or domain.',
    inputSchema: obj({ company_id: str(36, 'The company id add_client returned'), domain: str(253, 'Or its website domain'), signed_date: DATE('Signed date, default today') }) },
  { name: 'add_lookalikes', readOnly: false, description: `File up to ${LOOKALIKE_MAX} lookalike companies of a client as Targets to research (source "Lookalike of <client>"). Skips any company Prospector already has (by domain or name) and lists the Upside-owned ones apart.`,
    inputSchema: obj({
      client_domain: str(253, 'The client\'s website domain'),
      companies: { type: 'array', minItems: 1, maxItems: LOOKALIKE_MAX, items: obj({
        name: str(160, 'Company name'), domain: str(253, 'Website domain'), employees: int('Headcount'), industries: str(200, 'Industries, comma-separated'),
        hq_city: str(80, 'HQ city'), hq_state: str(40, 'HQ state'), apollo_org_id: str(80, 'Apollo organization id'), why: str(300, 'Why it looks like the client'),
      }, ['name']) },
    }, ['client_domain', 'companies']) },
  { name: 'check_upside_owned', readOnly: true, description: `Which of up to ${CHECK_MAX} domains match a company Upside owns in Prospector (owner team Upside; "joint" = owned by both). Read-only.`,
    inputSchema: obj({ domains: { type: 'array', minItems: 1, maxItems: CHECK_MAX, items: str(253, 'A website domain') } }, ['domains']) },
];
const BY_NAME = Object.fromEntries(TOOLS.map(t => [t.name, t]));
export const toolList = () => TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: t.readOnly, destructiveHint: false, openWorldHint: false } }));

// The JSON Schema subset above, enforced here: unknown fields, required, types, lengths, enums, list caps.
export function checkArgs(schema, v, at = 'arguments') {
  if (schema.type === 'object') {
    if (v == null || typeof v !== 'object' || Array.isArray(v)) throw new ToolError(`${at} must be an object`);
    for (const k of Object.keys(v)) if (!(k in schema.properties)) throw new ToolError(`${at}: unknown field "${k}"`);
    for (const k of schema.required) if (v[k] == null || v[k] === '') throw new ToolError(`${at}.${k} is required`);
    for (const [k, s] of Object.entries(schema.properties)) if (v[k] != null) checkArgs(s, v[k], `${at}.${k}`);
  } else if (schema.type === 'array') {
    if (!Array.isArray(v)) throw new ToolError(`${at} must be a list`);
    if (v.length < (schema.minItems || 0) || v.length > schema.maxItems) throw new ToolError(`${at} takes ${schema.minItems || 0} to ${schema.maxItems} items`);
    v.forEach((x, i) => checkArgs(schema.items, x, `${at}[${i}]`));
  } else if (schema.type === 'integer') {
    if (!Number.isInteger(v) || v < 0) throw new ToolError(`${at} must be a whole number`);
  } else if (schema.type === 'string') {
    if (typeof v !== 'string') throw new ToolError(`${at} must be text`);
    if (schema.enum && !schema.enum.includes(v)) throw new ToolError(`${at} must be one of ${schema.enum.join(', ')}`);
    if (v.length > schema.maxLength) throw new ToolError(`${at} is too long (max ${schema.maxLength})`);
    // Ids, domains and dates are digit-heavy by nature and checked by their own shape; free text never holds an address.
    if (!/(_id|domain|domains\[\d+\]|_date)$/.test(at) && hasPii(v)) throw new ToolError(`${at} can't hold an email address or phone number`);
    if (/(^|\.)(domain|domains\[\d+\])$/.test(at) && /@/.test(v)) throw new ToolError(`${at} must be a domain, not an address`);
  }
}

const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const urlOf = (ctx, type, id) => `${ctx.origin}/?tab=pipeline&view=companies&open=${type}-${id}`;
const domainArg = (v, at) => { const d = normalizeDomain(String(v || '')); if (!d) throw new ToolError(`${at} must look like company.com`); return d; };

// source_type -> the record's source (DECIDED, spec C11). A partner not found keeps the kind, names it in the note, warns.
export function sourceFor(a, partners) {
  if (a.source_type === 'broker' || a.source_type === 'partner') {
    const name = a.referred_by_partner || a.source_name || null;
    const hit = name ? partners.find(p => normName(p.name) === normName(name)) : null;
    const person = a.referred_by_partner ? a.source_name || null : null;
    if (hit) return { source: { source_kind: 'partner_referral', source_partner_id: hit.id, source_person: person }, warning: null };
    return { source: { source_kind: 'partner_referral', source_person: person, source_note: name ? `Referred by ${cleanText(name, 160)} (not in Prospector yet)` : null }, warning: 'partner not found' };
  }
  if (a.source_type === 'intro') return { source: { source_kind: 'person_referral', source_person: a.source_name || null }, warning: null };
  if (a.source_type === 'inbound') return { source: { source_kind: 'inbound', source_note: a.source_name ? cleanText(`Inbound: ${a.source_name}`, 500) : null }, warning: null };
  return { source: { source_kind: 'homelover_outreach', source_person: a.source_name || null }, warning: null };
}

async function employerBy(ctx, { id = null, domain = null }) {
  const q = ctx.supabase.from('sales_opportunities').select('id, organization, client_status, owner_team, source_kind, source_partner_id, source_person, source_note').eq('business_id', ctx.businessId).is('archived_at', null);
  const rows = must(await (id ? q.eq('id', id) : q.eq('domain', domain)).limit(3));
  if (rows.length > 1) throw new ToolError(`domain matched ${rows.length} records - name it by company_id`, { warnings: [`domain matched ${rows.length} records`] });
  return rows[0] || null;
}

const HANDLERS = {
  async add_client(ctx, a) {
    const domain = a.domain ? domainArg(a.domain, 'domain') : null;
    const partners = must(await ctx.supabase.from('sales_goals').select('id, name').eq('business_id', ctx.businessId).eq('goal_type', 'partnership').is('archived_at', null));
    const { source, warning } = sourceFor(a, partners);
    const existing = domain ? await employerBy(ctx, { domain }) : null;
    const pass = ['eligible_now', 'eligible_added', 'eligible_added_note', 'launch_date', 'expected_signing_date', 'apollo_account_id', 'apollo_deal_id', 'apollo_org_id', 'primary_contact_name', 'primary_contact_title', 'hq_city', 'hq_state', 'notes'];
    const body = { organization: a.company_name, status: a.status, ...(domain ? { domain } : {}), ...Object.fromEntries(pass.filter(k => a[k] != null && a[k] !== '').map(k => [k, a[k]])) };
    // makeClient writes the source only when it differs, so a repeat call stays a no-op (a person's pick isn't re-stamped).
    const r = await makeClient(ctx.supabase, { businessId: ctx.businessId, userId: ctx.auth.user.id, body: { ...body, source }, via: 'connector', partnerless: true, now: ctx.now() });
    if (r.status === 409 && r.body.code === 'ambiguous_domain') throw new ToolError(r.body.error, { warnings: ['domain matched 2 records'] });
    if (r.status >= 400) throw new ToolError(r.body.error);
    const c = r.body.client;
    return {
      company_id: c.id, company_name: c.name, url: urlOf(ctx, 'employer', c.id), result: r.body.created ? 'created' : 'updated', unchanged: !!r.body.unchanged,
      status: c.client_status, stage: r.body.stage.after, eligible_now: c.eligible_now, eligible_added: c.eligible_added, launch_date: c.launch_date,
      contacts_suppressed: r.body.contacts_stopped, todo_id: r.body.todo_id, matched_by: existing ? 'domain' : r.body.created ? null : 'name',
      warnings: [...(warning ? [warning] : []), ...r.body.warnings.map(w => (w === 'Upside-owned account' ? 'Upside-owned account' : w))],
    };
  },
  async mark_signed(ctx, a) {
    if (!a.company_id && !a.domain) throw new ToolError('name the client by company_id or domain');
    if (a.company_id && !UUID.test(a.company_id)) throw new ToolError('company_id must be the id add_client returned');
    if (a.signed_date && !/^\d{4}-\d{2}-\d{2}$/.test(a.signed_date)) throw new ToolError('signed_date must be YYYY-MM-DD');
    const row = await employerBy(ctx, a.company_id ? { id: a.company_id } : { domain: domainArg(a.domain, 'domain') });
    if (!row) throw new ToolError('no such company in HomeLover');
    if (!row.client_status) throw new ToolError(`${row.organization} isn't a client yet - add_client first`);
    if (row.client_status === 'signed') {
      const cur = must(await ctx.supabase.from('sales_opportunities').select('signed_date, stage').eq('id', row.id).single());
      return { company_id: row.id, company_name: row.organization, url: urlOf(ctx, 'employer', row.id), status: 'signed', signed_date: cur.signed_date, stage: cur.stage, unchanged: true };
    }
    const r = await markClient(ctx.supabase, { businessId: ctx.businessId, userId: ctx.auth.user.id, id: row.id, to: 'signed', body: { expect_status: row.client_status, ...(a.signed_date ? { signed_date: a.signed_date } : {}) }, via: 'connector', now: ctx.now() });
    if (r.status >= 400) throw new ToolError(r.body.error);
    return { company_id: row.id, company_name: row.organization, url: urlOf(ctx, 'employer', row.id), status: r.body.client.client_status, signed_date: r.body.client.signed_date, stage: r.body.stage.after, unchanged: false };
  },
  async add_lookalikes(ctx, a) {
    const client = await employerBy(ctx, { domain: domainArg(a.client_domain, 'client_domain') });
    if (!client) throw new ToolError('no HomeLover company has that client_domain - add_client first');
    const { known, upside } = await domainIndex(ctx);
    const added = [], skipped_existing = [], upside_owned = [];
    for (const [i, co] of a.companies.entries()) {
      const domain = co.domain ? domainArg(co.domain, `companies[${i}].domain`) : null;
      const hit = domain ? known.get(domain) : null;
      if (hit) { (upside.has(domain) ? upside_owned : skipped_existing).push({ name: co.name, domain, type: hit.type, record: hit.name }); continue; }
      const evidence = [`Lookalike of ${client.organization} (via connector)`, co.why, co.industries, [co.hq_city, co.hq_state].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
      const r = await insertCompanyRecord(ctx.supabase, {
        businessId: ctx.businessId, userId: ctx.auth.user.id, name: co.name.trim(), domain, to: 'target', kind: 'employer', channel: 'manual', evidence,
        source: { source_kind: 'lookalike', source_note: `Lookalike of ${client.organization}` }, employees: co.employees ?? null, employeesSource: co.apollo_org_id ? 'apollo' : 'manual', relink: false, now: ctx.now(),
      });
      if (r.already) { skipped_existing.push({ name: co.name, domain, type: r.already.type, record: r.already.name }); continue; }
      if (domain) must(await ctx.supabase.from('sales_targets').update({ domain, domain_source: 'manual', domain_at: ctx.now().toISOString() }).eq('business_id', ctx.businessId).eq('id', r.created.id).select('id'));
      if (domain) known.set(domain, { type: 'target', name: co.name });
      added.push({ company_id: r.created.id, name: r.created.name, url: urlOf(ctx, 'target', r.created.id) });
    }
    return { client: client.organization, added, skipped_existing, upside_owned };
  },
  async check_upside_owned(ctx, a) {
    const { known, upside, joint } = await domainIndex(ctx);
    return { results: a.domains.map((raw, i) => {
      const d = domainArg(raw, `domains[${i}]`), hit = known.get(d);
      return { domain: d, upside_owned: upside.has(d), joint: joint.has(d), in_prospector: !!hit, record: hit ? { type: hit.type, name: hit.name } : null };
    }) };
  },
};

// Every domain this workspace knows (employers, targets, partners' confirmed domains) with whose team owns it.
async function domainIndex(ctx) {
  const sb = ctx.supabase, b = ctx.businessId;
  const [opps, tgts, partners, pdoms] = await Promise.all([
    selectAllPages(() => sb.from('sales_opportunities').select('id, organization, domain, owner_team').eq('business_id', b).is('archived_at', null).not('domain', 'is', null).order('id')),
    selectAllPages(() => sb.from('sales_targets').select('id, name, domain, owner_team').eq('business_id', b).not('domain', 'is', null).order('id')),
    selectAllPages(() => sb.from('sales_goals').select('id, name, owner_team').eq('business_id', b).eq('goal_type', 'partnership').is('archived_at', null).order('id')),
    selectAllPages(() => sb.from('partner_domains').select('goal_id, domain').eq('business_id', b).eq('confirmed', true).order('goal_id').order('domain')),
  ]);
  const known = new Map(), upside = new Set(), joint = new Set();
  const add = (domain, type, name, team) => { if (!domain) return; if (!known.has(domain)) known.set(domain, { type, name }); if (team === 'upside') upside.add(domain); if (team === 'both') joint.add(domain); };
  for (const o of opps) add(o.domain, 'employer', o.organization, o.owner_team);
  for (const t of tgts) add(t.domain, 'target', t.name, t.owner_team);
  const pById = new Map(partners.map(p => [p.id, p]));
  for (const d of pdoms) { const p = pById.get(d.goal_id); if (p) add(d.domain, 'partner', p.name, p.owner_team); }
  return { known, upside, joint };
}

const result = (data, isError = false) => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data) }], ...(isError ? { isError: true } : {}) });

// ctx = { auth, businessId, origin, d } -> an MCP CallTool result; errors come back as isError results Claude can read.
export async function runTool(ctx0, name, args) {
  const ctx = { ...ctx0, supabase: ctx0.d?.supabase || getServiceSupabase(), now: ctx0.d?.now || (() => new Date()) };
  const tool = BY_NAME[name];
  if (!tool) return result(`Unknown tool "${name}"`, true);
  try {
    const a = args ?? {};
    checkArgs(tool.inputSchema, a);
    const out = await HANDLERS[name](ctx, a);
    if (/[^\s@<>()"',;=&#]+@[^\s@<>()"',;=&#]+\.[a-z]{2,}/i.test(JSON.stringify(out))) throw new Error('refused: an address reached the reply');
    return result(out);
  } catch (e) {
    if (!(e instanceof ToolError)) console.error(`[hlconnect/${name}]`, e.message);
    return result({ error: e instanceof ToolError ? e.message : 'Something went wrong on the Prospector side - try again', ...(e.extra || {}) }, true);
  }
}

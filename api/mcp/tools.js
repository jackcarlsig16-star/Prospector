// hkos-mcp-connector-v1 M4 + M6 - the hk_* tools. Each runs AS the token's user in the token's workspace through the
// same functions the Grow routes use (a caller context + a captured response, never a second copy of the logic). No
// tool takes a user, owner or mailbox argument; drafts only ever go to the caller's own tethered mailbox. No Claude
// call anywhere (Claude is the caller). Every call writes one Activity row (actor_kind 'claude', detail.via 'connector').
import { checkBrandsRoute, getBrandRoute, patchBrandRoute, CLOSED } from '../hk/brandsRoutes.js';
import { getSettingsRoute } from '../hk/opsRoutes.js';
import { createDraftFor, gmailStatusRoute, deps0 } from '../hk/gmailRoutes.js';
import { todayPayload, founders } from '../hk/jobs/runner.js';
import { dayIn } from '../hk/jobs/plan.js';
import { draftUrl } from '../hk/gmailMime.js';
import { HkError, text, domainOf, oneOf, liveBrands, normName, nameMatches, brandSummary, logEvent, MANUAL_STATUSES, SPONSOR_RELATIONSHIPS } from '../hk/hkShared.js';

export const CALLS_PER_WINDOW = 60, WINDOW_MS = 10 * 60_000; // REVISABLE (spec M6)
export const CHECK_MAX = 25, DRAFTS_PER_DAY = 20;             // REVISABLE (spec M6)

const str = (maxLength, description) => ({ type: 'string', maxLength, description });
const BRAND_REF = str(200, 'The brand\'s exact name (or an alias) or its domain, e.g. "Rumpl" or "rumpl.com"');
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

export const TOOLS = [
  { name: 'hk_settings', readOnly: true, description: 'HumanKind pitch facts and rules: member / completion stats and when they were confirmed, market lines, subject format, banned phrases, follow-up timing and touch caps, who is calling, and which founder mailboxes are connected (status only).', inputSchema: obj({}) },
  { name: 'hk_check', readOnly: true, description: `Check up to ${CHECK_MAX} brands before pitching. Per brand: clear, warm (another founder already has a thread - founder and date only), sponsor, do_not_contact, owned_by, possible_duplicate or niche_warning, with matches.`,
    inputSchema: obj({ brands: { type: 'array', minItems: 1, maxItems: CHECK_MAX, items: obj({ name: str(160, 'Brand name'), domain: str(253, 'Website domain, e.g. rumpl.com'), niche: str(80, 'What they sell, e.g. cold-pressed juice') }, ['name']) } }, ['brands']) },
  { name: 'hk_claim', readOnly: false, description: 'Claim an unclaimed brand for yourself. Refuses sponsors, founding partners, do-not-contact brands, brands another founder owns, and brands whose owner is Unclear.', inputSchema: obj({ brand: BRAND_REF }, ['brand']) },
  { name: 'hk_brand', readOnly: true, description: 'One brand\'s page: status, owner, contacts (names, titles, emails), touches, replies, notes, challenge ideas and recent activity. Needs an exact name, alias or domain; an ambiguous one returns the candidates.', inputSchema: obj({ brand: BRAND_REF }, ['brand']) },
  { name: 'hk_draft_save', readOnly: false, description: 'Save an email as a Gmail DRAFT in your own HumanKind mailbox (never sent). Runs the contact rules and the outreach lint first; if the lint fails nothing is saved and the problems come back. Marks the brand Drafted and claims it if unclaimed.',
    inputSchema: obj({ brand: BRAND_REF, contact: str(254, 'Contact name or email on that brand (default: the primary contact)'), kind: { type: 'string', enum: ['cold', 'bump', 'final', 'reply'] }, subject: str(200, 'Subject line'), body_markdown: str(6000, 'Email body (markdown, no signature - your saved sign-off is added)'), challenge: str(500, 'The challenge concept pitched') }, ['brand', 'kind', 'subject', 'body_markdown']) },
  { name: 'hk_due', readOnly: true, description: 'What is waiting on you today: urgent and other replies, follow-ups due, drafts to review, follow-ups that could not be drafted, Instagram DMs ready - for brands you own.', inputSchema: obj({}) },
  { name: 'hk_update', readOnly: false, description: 'Set the status of a brand YOU own to one you set by hand (meeting, signed, passed, skipped), with an optional short note. Unclaimed brands: hk_claim first. Never a status the system sets.', inputSchema: obj({ brand: BRAND_REF, status: { type: 'string', enum: [...MANUAL_STATUSES] }, note: str(200, 'Why (optional, no addresses or phone numbers)') }, ['brand', 'status']) },
];
const BY_NAME = Object.fromEntries(TOOLS.map(t => [t.name, t]));
export const toolList = () => TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: t.readOnly, destructiveHint: false, openWorldHint: false } }));

// The JSON Schema subset the tools use, enforced on the server: unknown fields, wrong types, caps.
export function checkArgs(schema, v, at = 'arguments') {
  if (schema.type === 'object') {
    if (v == null || typeof v !== 'object' || Array.isArray(v)) throw new HkError(400, `${at} must be an object`);
    for (const k of Object.keys(v)) if (!(k in schema.properties)) throw new HkError(400, `${at}: unknown field "${k}"`);
    for (const k of schema.required) if (v[k] == null) throw new HkError(400, `${at}.${k} is required`);
    for (const [k, s] of Object.entries(schema.properties)) if (v[k] != null) checkArgs(s, v[k], `${at}.${k}`);
  } else if (schema.type === 'array') {
    if (!Array.isArray(v)) throw new HkError(400, `${at} must be a list`);
    if (v.length < (schema.minItems || 0) || v.length > schema.maxItems) throw new HkError(400, `${at} takes ${schema.minItems || 0} to ${schema.maxItems} items`);
    v.forEach((x, i) => checkArgs(schema.items, x, `${at}[${i}]`));
  } else if (schema.type === 'string') {
    if (typeof v !== 'string') throw new HkError(400, `${at} must be text`);
    if (v.length > schema.maxLength && !schema.enum) throw new HkError(400, `${at} is too long (max ${schema.maxLength})`);
    if (schema.enum && !schema.enum.includes(v)) throw new HkError(400, `${at} must be one of ${schema.enum.join(', ')}`);
  }
}

// A route called as the token's user: the same req.auth sessionAuth builds, the response captured instead of sent.
async function asCaller(ctx, route, { params = {}, query = {}, body = {}, method = 'GET' } = {}, deps) {
  const req = { method, params: { businessId: ctx.businessId, ...params }, query, body, auth: ctx.auth };
  const out = { code: 200, body: null };
  const res = { status(c) { out.code = c; return res; }, json(b) { out.body = b; return res; } };
  await route(req, res, deps);
  if (out.code >= 400) throw new HkError(out.code, out.body?.error || 'that did not work', out.body);
  return out.body;
}

// Exact name / alias / domain only; anything else returns candidates and picks nothing.
export async function resolveBrand(ctx, ref) {
  const raw = text(ref, 200, 'brand', { required: true });
  let domain = null;
  if (/^[^\s]+\.[a-z]{2,}(\/.*)?$/i.test(raw)) { try { domain = domainOf(raw); } catch { domain = null; } }
  const n = normName(raw), brands = await liveBrands(ctx.D.supabase, ctx.businessId);
  const exact = brands.filter(b => (domain && b.domain === domain) || (n && normName(b.name) === n) || (n && (b.aliases || []).some(a => normName(a) === n)));
  if (exact.length === 1) return exact[0];
  const candidates = (exact.length ? exact : nameMatches(raw, brands, 'name', true)).slice(0, 10).map(brandSummary);
  throw new HkError(exact.length ? 409 : 404, exact.length ? `"${raw}" matches more than one brand - use the exact name or domain of one` : `No brand named "${raw}" - use the exact name, an alias or the domain`, { candidates });
}

const brandUrl = (ctx, id) => `${ctx.origin}/#hk/brands/${id}`;
const firstNames = async ctx => Object.fromEntries((await founders(ctx.D, ctx.businessId)).map(f => [f.user_id, f]));

const HANDLERS = {
  async hk_settings(ctx) {
    const { settings: s, locked_rules } = await asCaller(ctx, getSettingsRoute, {}, { supabase: ctx.D.supabase });
    const fs = await founders(ctx.D, ctx.businessId);
    return {
      you: { user_id: ctx.auth.user.id, name: ctx.auth.user.name || null, role: ctx.auth.roles.get(ctx.businessId) || null },
      pitch: { members_stat: s.members_stat, completions_stat: s.completions_stat, stats_confirmed_at: s.stats_confirmed_at, market_line_local: s.market_line_local, market_line_national: s.market_line_national, subject_format: s.subject_format, banned_phrases: s.banned_phrases },
      caps: { max_email_touches: s.max_email_touches, bump_after_days: s.bump_after_days, dm_after_days: s.dm_after_days, final_after_days: s.final_after_days, timezone: s.timezone, drafts_per_day_via_connector: DRAFTS_PER_DAY },
      locked_rules,
      mailboxes: fs.map(f => ({ founder: f.first_name, you: f.user_id === ctx.auth.user.id, state: f.m ? f.m.state : 'not linked' })),
    };
  },

  async hk_check(ctx, a) {
    const items = a.brands.map(b => ({ name: text(b.name, 160, 'name', { required: true }), domain: b.domain ? domainOf(b.domain) : null, niche: text(b.niche, 80, 'niche') }));
    const { results } = await asCaller(ctx, checkBrandsRoute, { method: 'POST', body: items }, { supabase: ctx.D.supabase, gmail: ctx.D.gmail, mailbox: ctx.D.mailbox, tokenForGrant: ctx.D.tokenForGrant });
    const names = await firstNames(ctx);
    // Warm for another founder's thread: founder + last date + the brand's page link only (existence-only rule).
    return { results: results.map(r => ({ ...r, ...(r.verdict === 'warm' ? { founder: names[r.founder_user_id]?.first_name || null } : {}), ...(r.match ? { brand_url: brandUrl(ctx, r.match.id) } : {}) })) };
  },

  async hk_claim(ctx, a) {
    const b = await resolveBrand(ctx, a.brand); ctx.brandId = b.id;
    const uid = ctx.auth.user.id;
    if (SPONSOR_RELATIONSHIPS.has(b.relationship)) throw new HkError(409, `${b.name} is a ${b.relationship === 'sponsor' ? 'sponsor' : 'founding partner'} - not claimable`);
    if (b.relationship === 'do_not_contact') throw new HkError(409, `${b.name} is marked do not contact`);
    if (b.owner_unclear) throw new HkError(409, `${b.name}'s owner is Unclear - sort it out in Grow first`);
    if (b.owner_user_id && b.owner_user_id !== uid) throw new HkError(409, `${b.name} is owned by ${(await firstNames(ctx))[b.owner_user_id]?.first_name || 'another founder'}`);
    if (b.owner_user_id === uid) return { brand: brandSummary(b), already_yours: true, brand_url: brandUrl(ctx, b.id) };
    const out = await asCaller(ctx, patchBrandRoute, { method: 'PATCH', params: { id: b.id }, body: { claim: true } }, { supabase: ctx.D.supabase, now: ctx.D.now });
    return { brand: brandSummary(out.brand), claimed: true, brand_url: brandUrl(ctx, b.id) };
  },

  async hk_brand(ctx, a) {
    const b = await resolveBrand(ctx, a.brand); ctx.brandId = b.id;
    const out = await asCaller(ctx, getBrandRoute, { params: { id: b.id } }, { supabase: ctx.D.supabase });
    return { ...out, events: out.events.slice(0, 25), brand_url: brandUrl(ctx, b.id) };
  },

  async hk_draft_save(ctx, a) {
    const b = await resolveBrand(ctx, a.brand); ctx.brandId = b.id;
    const uid = ctx.auth.user.id, now = ctx.D.now();
    const { data: recent, error } = await ctx.D.supabase.from('hk_touches').select('drafted_at').eq('business_id', ctx.businessId).eq('sender_user_id', uid).eq('created_by', 'claude').gte('drafted_at', new Date(now.getTime() - 36 * 60 * 60_000).toISOString());
    if (error) throw new Error(error.message);
    if ((recent || []).filter(t => dayIn(new Date(t.drafted_at)) === dayIn(now)).length >= DRAFTS_PER_DAY) throw new HkError(429, `That's ${DRAFTS_PER_DAY} drafts through Claude today - the cap resets at midnight Chicago time`);
    let contactId = null;
    if (a.contact) {
      const want = String(a.contact).trim().toLowerCase();
      const { data: cs } = await ctx.D.supabase.from('hk_contacts').select('id, name, email').eq('business_id', ctx.businessId).eq('brand_id', b.id);
      const hit = (cs || []).filter(c => (c.email && c.email.toLowerCase() === want) || (c.name && normName(c.name) === normName(want)));
      if (hit.length !== 1) throw new HkError(hit.length ? 409 : 404, hit.length ? 'More than one contact matches - use their email' : `No contact "${a.contact}" on ${b.name}`, { contacts: (cs || []).map(c => c.name).filter(Boolean) });
      contactId = hit[0].id;
    }
    const cap = { code: 200, body: null }, capRes = { status(c) { cap.code = c; return capRes; }, json(x) { cap.body = x; return capRes; } };
    const fakeReq = { params: { businessId: ctx.businessId }, auth: ctx.auth };
    const out = await createDraftFor({ D: ctx.D, businessId: ctx.businessId, userId: uid, createdBy: 'claude', tokenFor: () => ctx.D.tokenFor(fakeReq, capRes, ctx.businessId, 'drafts'),
      body: { brand_id: b.id, contact_id: contactId, channel: 'email', kind: oneOf(a.kind, new Set(['cold', 'bump', 'final', 'reply']), 'kind'), subject: a.subject, body_markdown: a.body_markdown, challenge_concept: a.challenge || null } });
    if (!out) throw new HkError(cap.code >= 400 ? cap.code : 409, cap.body?.error || 'Your HumanKind mailbox is not ready for drafts', cap.body);
    return { saved_as: 'gmail_draft', sent: false, touch_id: out.touch.id, brand: b.name, kind: out.touch.kind, gmail_draft_url: out.draft?.message?.id && out.mailboxEmail ? draftUrl(out.mailboxEmail, out.draft.message.id) : null, warnings: out.verdict.warnings, brand_url: brandUrl(ctx, b.id) };
  },

  async hk_due(ctx) {
    const uid = ctx.auth.user.id, now = ctx.D.now();
    const [today, brands] = await Promise.all([todayPayload({ businessId: ctx.businessId, d: ctx.d }), liveBrands(ctx.D.supabase, ctx.businessId)]);
    const mine = new Set(brands.filter(b => b.owner_user_id === uid).map(b => b.id));
    const s = today.digest.sections, only = arr => arr.filter(x => mine.has(x.brand_id));
    return {
      day: today.digest.day,
      urgent_replies: only(s.urgent), replies: only(s.replies), drafts_to_review: only(s.drafts), could_not_draft: only(s.no_draft), dm_ready: only(s.dm_ready),
      follow_ups_due: brands.filter(b => mine.has(b.id) && b.next_due_at && new Date(b.next_due_at) <= now && !CLOSED.has(b.status)).map(b => ({ brand_id: b.id, brand_name: b.name, status: b.status, next_due_at: b.next_due_at })),
      stats_stale: today.stats_stale,
    };
  },

  async hk_update(ctx, a) {
    const b = await resolveBrand(ctx, a.brand); ctx.brandId = b.id;
    if (!b.owner_user_id) throw new HkError(409, `${b.name} isn't claimed yet - claim it first (hk_claim), then set its status`);
    if (b.owner_user_id !== ctx.auth.user.id) throw new HkError(409, `${b.name} is owned by ${(await firstNames(ctx))[b.owner_user_id]?.first_name || 'another founder'} - only the owner sets its status`);
    const status = oneOf(a.status, MANUAL_STATUSES, 'status');
    const out = await asCaller(ctx, patchBrandRoute, { method: 'PATCH', params: { id: b.id }, body: { status, ...(a.note ? { reason: text(a.note, 200, 'note') } : {}) } }, { supabase: ctx.D.supabase, now: ctx.D.now });
    return { brand: brandSummary(out.brand), changed: out.changed, brand_url: brandUrl(ctx, b.id) };
  },
};

const calls = new Map();
export const resetLimits = () => calls.clear();
function allowCall(uid, nowMs) {
  const recent = (calls.get(uid) || []).filter(t => t > nowMs - WINDOW_MS);
  if (recent.length >= CALLS_PER_WINDOW) { calls.set(uid, recent); return false; }
  recent.push(nowMs); calls.set(uid, recent); return true;
}

const result = (data, isError = false) => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data) }], ...(isError ? { isError: true } : {}) });

// ctx = { auth, businessId, origin, d } -> an MCP CallTool result. Errors come back as isError results Claude can read.
export async function runTool(ctx0, name, args) {
  const ctx = { ...ctx0, D: deps0(ctx0.d || {}), brandId: null };
  const tool = BY_NAME[name];
  if (!tool) return result(`Unknown tool "${name}"`, true);
  let ok = false, code = null, payload;
  try {
    if (!allowCall(ctx.auth.user.id, ctx.D.now().getTime())) throw new HkError(429, `That's ${CALLS_PER_WINDOW} connector calls in 10 minutes - wait a few minutes and try again`);
    const a = args ?? {};
    checkArgs(tool.inputSchema, a);
    payload = result(await HANDLERS[name](ctx, a));
    ok = true;
  } catch (e) {
    code = e instanceof HkError ? e.status : 500;
    if (!(e instanceof HkError)) console.error(`[mcp/${name}]`, e.message);
    const extra = e instanceof HkError && e.extra ? Object.fromEntries(Object.entries(e.extra).filter(([k]) => ['problems', 'candidates', 'contacts', 'verdict', 'needs_mailbox', 'needs_reconnect', 'needs_contact', 'needs_prior_touch'].includes(k))) : {};
    payload = result({ error: e instanceof HkError ? e.message : 'Something went wrong on the Prospector side - try again', ...extra }, true);
  }
  await logEvent(ctx.D.supabase, { businessId: ctx.businessId, actorUserId: ctx.auth.user.id, actorKind: 'claude', entityType: ctx.brandId ? 'brand' : 'connector', entityId: ctx.brandId, action: `connector.${name}`, detail: { via: 'connector', tool: name, ok, ...(code ? { code } : {}) } }).catch(e => console.error('[mcp] activity row:', e.message));
  return payload;
}

import { getSupabase } from './goalsShared.js';
import { laDateString } from './laDate.js';
import { callAnthropic } from '../businesses/shared.js';
import { MODELS, estimateCostUsd } from '../../src/config/models.js';
import { cleanText, scrubAddresses } from './scrubText.js';
import { noteHash } from './callNotesRoutes.js';
import { insertCompanyRecord } from './companyPanel.js';
import { ownerOrCaller } from './companyFields.js';
import { applyPartnerSignal } from './partnerSignals.js';
import { logSource, SOURCE_FIELDS } from './leadSource.js';
import { kickResearch } from './partnerResearch.js';
import { toLeads, loadLeadContext, checkCompany, crossCheck, uploadSource, contextLine, LeadError, ACTIONS, KINDS, MAX_PEOPLE } from './leadUploadMatch.js';

// lead-upload-v1 - a pasted lead list (Apollo's "recommended leads" email, a partner's list) -> one model read ->
// a review grouped by company -> File: companies created through the existing create path, people added
// (partners: partner_contacts; employers / targets: sales_people), a dated context line, and one
// sales_lead_uploads row. The pasted text is never stored or logged, only its hash. 0 Apollo calls.

const MAX_CHARS = 120000; // same cap as call notes
const MAX_COMPANIES = 30;

const SYSTEM = `You read a pasted list of sales leads (for example Apollo's "recommended leads" email, a partner's list of names, an event attendee list) and return the companies and people in it.

Rules:
- companies: every company the list names, once each, as written: name, domain (only when the list shows the company's website, else null), employees (a number only when the list states it, else null), hq (city / state as written, else null), kind_guess, category, evidence.
- kind_guess: "partner" = a channel that reaches many employers (benefits brokers and consultants such as Gallagher or Lockton, PEOs, perk / benefit platforms, HR / payroll marketplaces, associations); "employer" = a company whose own employees would get the benefit; "unclear" = can't tell.
- category: for a partner, the one entry of CATEGORIES that fits, exactly as written there; otherwise null.
- people: every person listed: name, title as written or null, company (as written, matching a companies entry), location as written or null, linkedin_url (only a linkedin.com link shown in the list, else null), why = the list's own reason text for this person, as written (max 300 characters), or null.
- "Title @Company" means the person's title at that company; it is not an email address.
- evidence: the shortest phrase from the list that shows the company (max 20 words).
- Never include an email address or phone number in any field.
- List every person; do not stop early.

Reply with JSON only, no prose:
{"companies":[{"name":"","domain":null,"employees":null,"hq":null,"kind_guess":"","category":null,"evidence":""}],"people":[{"name":"","title":null,"company":"","location":null,"linkedin_url":null,"why":null}]}`;

const fail = (res, e, tag) => {
  if (e instanceof LeadError || (e.status && e.status < 500)) return res.status(e.status).json({ error: e.message });
  console.error(`[leads/${tag}]`, e.message);
  return res.status(500).json({ error: e.message });
};
const checkText = text => {
  if (typeof text !== 'string' || !text.trim()) throw new LeadError(400, 'paste the lead list first');
  if (text.length > MAX_CHARS) throw new LeadError(413, `the list is too long (${text.length} characters, max ${MAX_CHARS})`);
};

// The same list filed before (by hash): when and how much came of it. The review still runs - re-pasting shows
// everyone as "Already in".
async function earlierUploads(supabase, businessId, hash) {
  const { data, error } = await supabase.from('sales_lead_uploads').select('id, created_at, counts').eq('business_id', businessId).eq('text_hash', hash).order('created_at', { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  return data[0] || null;
}

// POST /goals/leads/extract { text, source: { pick, partner_id?, person?, note? } } -> the review.
export async function extractLeadsRoute(req, res, { call = callAnthropic, supabase = getSupabase() } = {}) {
  const { text, source = {} } = req.body || {};
  const businessId = req.params.businessId;
  try {
    checkText(text);
    const ctx = await loadLeadContext(supabase, businessId);
    const src = uploadSource(source, ctx.partners);
    const categories = [...new Set(ctx.partners.map(p => p.category).filter(Boolean))].sort();
    const model = MODELS.STANDARD;
    const data = await call({
      system: SYSTEM, model, max_tokens: 8192, thinking: false, timeoutMs: 90000,
      messages: [{ role: 'user', content: `CATEGORIES: ${JSON.stringify(categories)}\n\n<list>\n${scrubAddresses(text)}\n</list>` }],
      supabase, businessId, userId: req.auth.user.id, callType: 'lead_upload',
    });
    if (data.stop_reason === 'max_tokens') throw new LeadError(502, `The list holds more than fits in one pass - split the list (up to ${MAX_PEOPLE} people per upload)`);
    const out = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    let raw;
    try { raw = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)); } catch { throw new LeadError(502, 'Could not read the AI reply - try again'); }
    const leads = toLeads(raw, categories);
    const hash = noteHash(text);
    res.json({
      companies: crossCheck(leads, ctx), people_count: leads.people_count, source: src, text_hash: hash,
      earlier: await earlierUploads(supabase, businessId, hash),
      usage: { model, input_tokens: data.usage?.input_tokens ?? null, output_tokens: data.usage?.output_tokens ?? null, cost_usd: estimateCostUsd(model, data.usage) },
    });
  } catch (e) { fail(res, e, 'extract'); }
}

// The browser's review rows, re-checked here against stored rows: the browser picks the action, kind, owner and
// people; the server decides what each company IS.
export function parseFile(body, ctx) {
  const list = Array.isArray(body?.companies) ? body.companies : null;
  if (!list || !list.length || list.length > MAX_COMPANIES) throw new LeadError(400, `companies must be a list of 1-${MAX_COMPANIES}`);
  let people = 0;
  const rows = list.map((c, i) => {
    if (!c || typeof c !== 'object') throw new LeadError(400, `company ${i + 1}: bad row`);
    const name = cleanText(c.name, 160);
    if (!name) throw new LeadError(400, `company ${i + 1}: name is required`);
    if (!ACTIONS.includes(c.action)) throw new LeadError(400, `company ${i + 1}: action must be one of ${ACTIONS.join('|')}`);
    if (!KINDS.includes(c.kind)) throw new LeadError(400, `company ${i + 1}: kind must be one of ${KINDS.join('|')}`);
    const leads = toLeads({ companies: [{ ...c, kind_guess: c.kind_guess }], people: (Array.isArray(c.people) ? c.people : []).map(p => ({ ...p, company: name })) });
    const lead = leads.companies[0];
    people += leads.people_count;
    const checked = checkCompany(lead, ctx);
    if (c.action === 'create' && checked.match) throw new LeadError(409, `${name} is already in Pipeline as ${checked.match.name} - reload the review`);
    if (c.action === 'add_people' && !checked.match) throw new LeadError(409, `${name} isn't in Pipeline - reload the review`);
    if (c.action === 'create' && checked.status === 'apollo_only' && c.kind !== 'employer') throw new LeadError(400, `${name}: an Apollo-only account is filed as an employer`);
    return { ...checked, key: `c${i}`, action: c.action, kind: c.kind, owner_user_id: c.owner_user_id ?? null, research: c.research === true, override: !!checked.chip?.skip && c.action !== 'skip' };
  });
  if (people > MAX_PEOPLE) throw new LeadError(413, `${people} people - split the list (up to ${MAX_PEOPLE} per upload)`);
  return rows;
}

const whyLine = p => `${p.name}${p.title ? ` (${p.title})` : ''}${p.why ? `: ${p.why}` : ''}`;
const TABLE = { partner: 'sales_goals', employer: 'sales_opportunities', target: 'sales_targets' };
const RECORD_TYPE = { partner: 'partner', opportunity: 'employer', target: 'target' };
const SOURCE_COLS = SOURCE_FIELDS.join(', ');

// POST /goals/leads { text, source, companies: [{ name, domain?, employees?, kind_guess?, action, kind,
// owner_user_id?, research?, people: [{ name, title?, location?, linkedin_url?, why? }] }] } -> File.
export async function fileLeadsRoute(req, res, { kick = kickResearch, supabase = getSupabase(), now = new Date() } = {}) {
  const body = req.body || {};
  const businessId = req.params.businessId;
  const userId = req.auth.user.id;
  try {
    checkText(body.text);
    const ctx = await loadLeadContext(supabase, businessId);
    const src = uploadSource(body.source || {}, ctx.partners);
    const rows = parseFile(body, ctx);
    const out = await fileLeads(supabase, { businessId, userId, src, rows, hash: noteHash(body.text), now });
    out.research = [];
    for (const r of rows.filter(x => x.research && out.ids[x.key])) {
      const { type, id } = out.ids[r.key];
      try { await kick(supabase, { businessId, entityType: type, entityId: id, trigger: 'queue', userId }); out.research.push({ name: r.name, ok: true }); }
      catch (e) { out.research.push({ name: r.name, ok: false, error: e.message }); }
    }
    delete out.ids;
    res.status(201).json(out);
  } catch (e) { fail(res, e, 'file'); }
}

// All or nothing: every write pushes its undo; any failure runs them and the request fails as a whole.
export async function fileLeads(supabase, { businessId, userId, src, rows, hash, now = new Date() }) {
  const undo = [];
  const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
  const day = laDateString(now);
  const stamp = `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
  const out = { upload_id: null, created: [], people_added: 0, already_in: 0, skipped: [], overrides: [], ids: {} };
  try {
    const upload = must(await supabase.from('sales_lead_uploads').insert({ business_id: businessId, created_by: userId, ...src, text_hash: hash }).select('id').single());
    undo.push(() => supabase.from('sales_lead_uploads').delete().eq('id', upload.id));
    out.upload_id = upload.id;

    for (const r of rows) {
      if (r.action === 'skip') { out.skipped.push({ name: r.name, reason: r.reason }); continue; }
      if (r.override) out.overrides.push(r.name);
      const line = contextLine(src, r, day);
      const partnerLine = [line, ...r.people.filter(p => !p.already_in).map(whyLine)].join(' · ');
      let type, id;
      if (r.action === 'create') {
        const who = await ownerOrCaller(supabase, businessId, r.owner_user_id, userId);
        if (who.error) throw new LeadError(400, `${r.name}: ${who.error}`);
        const made = await insertCompanyRecord(supabase, {
          businessId, userId, name: r.name, domain: r.domain, to: r.kind, kind: r.kind === 'target' ? (r.kind_guess === 'partner' ? 'partner' : 'employer') : null,
          channel: 'import', evidence: r.kind === 'partner' ? partnerLine : line, apolloAccountId: r.apollo_account_id, source: src, owner: who.person, employees: r.employees, now,
        });
        if (made.already) throw new LeadError(409, `${r.name} was added since the review (${made.already.name}) - reload and file again`);
        ({ type, id } = made.created);
        undo.push(async () => {
          await supabase.from('sales_source_events').delete().eq('record_type', type).eq('record_id', id);
          await supabase.from(TABLE[type]).delete().eq('id', id);
        });
        if (type === 'target') {
          // sales_targets.source is the signals-v1 enum (note / scout / web_visit / manual); an upload is a hand-filed target.
          must(await supabase.from('sales_targets').update({ research_notes: `(${stamp}) ${line}`, source: 'manual' }).eq('id', id));
        }
        out.created.push({ type, id, name: r.name });
      } else {
        type = RECORD_TYPE[r.match.type];
        id = r.match.id;
        const table = TABLE[type], col = type === 'target' ? 'research_notes' : 'notes';
        const old = must(await supabase.from(table).select(`${col}, ${SOURCE_COLS}`).eq('id', id).single());
        if (type === 'partner') {
          const { event } = await applyPartnerSignal(supabase, { businessId, goalId: id, signal: { type: 'note', note: partnerLine }, byUser: userId, now, meta: { from_lead_upload: upload.id } });
          undo.push(() => supabase.from('sales_partner_events').delete().eq('id', event.id));
        } else {
          const next = old[col] ? `${old[col]}\n(${stamp}) ${line}` : `(${stamp}) ${line}`;
          let q = supabase.from(table).update({ [col]: next, updated_at: now.toISOString() }).eq('id', id);
          q = old[col] == null ? q.is(col, null) : q.eq(col, old[col]);
          if (!must(await q.select('id')).length) throw new LeadError(409, `${r.name} changed while filing - reload and file again`);
          undo.push(() => supabase.from(table).update({ [col]: old[col] ?? null }).eq('id', id));
        }
        // An existing source is never overwritten: the upload is recorded as a second channel in the history.
        await logSource(supabase, { businessId, type, id, from: old.source_kind ? old : null, to: src, reason: 'import', byUser: userId, at: now });
        undo.push(() => supabase.from('sales_source_events').delete().eq('record_type', type).eq('record_id', id).eq('reason', 'import').eq('at', now.toISOString()));
      }
      out.ids[r.key] = { type, id };

      for (const p of r.people) {
        if (p.already_in) { out.already_in++; continue; }
        if (type === 'partner') {
          const row = must(await supabase.from('partner_contacts').insert({ business_id: businessId, goal_id: id, name: p.name, title: p.title, linkedin_url: p.linkedin_url, source: 'manual', created_by: userId }).select('id').single());
          undo.push(() => supabase.from('partner_contacts').delete().eq('id', row.id));
        } else {
          const ins = await supabase.from('sales_people').insert({
            business_id: businessId, company_type: type, ...(type === 'employer' ? { opportunity_id: id } : { target_id: id }),
            name: p.name, title: p.title, location: p.location, linkedin_url: p.linkedin_url, note: p.why,
            source_kind: src.source_kind, source_partner_id: src.source_partner_id, source_note: src.source_note, upload_id: upload.id, created_by: userId,
          }).select('id').single();
          if (ins.error?.code === '23505') { out.already_in++; continue; }
          const row = must(ins);
          undo.push(() => supabase.from('sales_people').delete().eq('id', row.id));
        }
        out.people_added++;
      }
    }

    must(await supabase.from('sales_lead_uploads').update({
      counts: { companies_created: out.created.length, people_added: out.people_added, already_in: out.already_in, skipped: out.skipped.length, overrides: out.overrides },
    }).eq('id', upload.id));
  } catch (e) {
    for (const f of undo.reverse()) { try { await f(); } catch (u) { console.error('[leads/file] undo failed:', u.message); } }
    throw e;
  }
  return out;
}

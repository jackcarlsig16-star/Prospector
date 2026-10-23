import { cleanText, hasPii } from './scrubText.js';
import { normName } from './intakeMatch.js';
import { TEAM_LABEL } from '../../src/constants/ownership.js';
import { SOURCE_KINDS } from '../../src/constants/leadSources.js';

// lead-source-v1 - who / what ORIGINATED a lead (the attribution a channel
// partner gets credit for), kept apart from channel (how the record entered
// Prospector). One primary source per partner / employer / target
// (20261022_lead_source_v1.sql); every change is a sales_source_events row.
// A source a person chose (source_set_by set) is never overwritten by an
// import or the backfill; NULL source_kind = never set. Text fields are
// names / short phrases only: an address or phone is scrubbed out.

export const SOURCE_FIELDS = ['source_kind', 'source_partner_id', 'source_person', 'source_office', 'source_campaign_id', 'route_in', 'source_note'];
export const SOURCE_COLS = [...SOURCE_FIELDS, 'source_set_by', 'source_set_at'].join(', ');
export const RECORD_TYPES = ['partner', 'employer', 'target'];
export const RECORD_TABLE = { partner: 'sales_goals', employer: 'sales_opportunities', target: 'sales_targets' };
const TEXT_MAX = { source_person: 120, source_office: 120, route_in: 300, source_note: 500 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Free text (route_in, source_note) keeps its words with any address / phone scrubbed out; a name field (person,
// office, the referring partner) that holds one isn't a name at all and is dropped.
const NAME_FIELDS = new Set(['source_person', 'source_office']);
const text = (v, max, { name = false } = {}) => {
  if (v == null) return null;
  if (name && hasPii(String(v))) return null;
  return cleanText(String(v), max) || null;
};

// The fields a source object names, cleaned (keys it doesn't name are left out).
export function cleanSource(src = {}) {
  const out = {};
  for (const k of SOURCE_FIELDS) {
    if (!(k in src)) continue;
    const v = src[k];
    if (k === 'source_kind') out[k] = SOURCE_KINDS.includes(v) ? v : null;
    else if (k === 'source_partner_id' || k === 'source_campaign_id') out[k] = typeof v === 'string' && UUID.test(v) ? v : null;
    else out[k] = text(v, TEXT_MAX[k], { name: NAME_FIELDS.has(k) });
  }
  return out;
}

// An edit body -> { source } (every field, absent = null) or { error }.
export function validateSource(body) {
  if (!body || typeof body !== 'object') return { error: 'send the source fields' };
  for (const k of Object.keys(body)) if (!SOURCE_FIELDS.includes(k) && k !== 'expect_set_at') return { error: `unknown field: ${k}` };
  if (body.source_kind != null && !SOURCE_KINDS.includes(body.source_kind)) return { error: `source_kind must be one of ${SOURCE_KINDS.join('|')}` };
  for (const k of ['source_partner_id', 'source_campaign_id']) if (body[k] != null && !(typeof body[k] === 'string' && UUID.test(body[k]))) return { error: `${k} must be an id or null` };
  for (const [k, max] of Object.entries(TEXT_MAX)) {
    if (body[k] == null) continue;
    if (typeof body[k] !== 'string' || body[k].length > max) return { error: `${k} must be text up to ${max} characters` };
    if (hasPii(body[k])) return { error: `${k} can't hold an email address or phone number` };
  }
  return { source: cleanSource(Object.fromEntries(SOURCE_FIELDS.map(k => [k, body[k] ?? null]))) };
}

export const sourceOf = row => Object.fromEntries(SOURCE_FIELDS.map(k => [k, row?.[k] ?? null]));
// A person chose it: only an explicit edit (or a create form's picker) clears this.
export const isManual = row => !!row?.source_set_by;
// What an import / the backfill may still fill: never set, or an automatic "unknown".
export const isOpen = row => !row?.source_kind || (row.source_kind === 'unknown' && !isManual(row));

// The columns an insert or update writes. manual = a person picked it.
export function sourceColumns(src, { userId = null, manual = false, now = new Date() } = {}) {
  return { ...cleanSource(src), source_set_by: manual ? userId : null, source_set_at: now.toISOString() };
}

export async function logSource(supabase, { businessId, type, id, from = null, to, reason, byUser = null, at = new Date() }) {
  const { error } = await supabase.from('sales_source_events').insert({
    business_id: businessId, record_type: type, record_id: id, from_source: from ? sourceOf(from) : null, to_source: sourceOf(to), reason, by_user: byUser, at: at.toISOString(),
  });
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
}

// ---- D5 mapping (rulings 2026-10-22): "Upside (Brad)" -> partner_referral, Upside, the rep's full name;
// "HomeLover" -> homelover_outreach; Route in stays route_in (brokers too); unmatched -> unknown.

// partners: [{ id, name }]; withOwners: any rows carrying owner_team + co_owner_name (the reps directory).
// Upside is the only joint partner today, so a rep on an upside / both record is Upside's (TEAM_LABEL.upside).
export function sourceDirectory(partners, withOwners = []) {
  const byName = new Map(partners.filter(p => p.name).map(p => [normName(p.name), { id: p.id, name: p.name }]));
  const partner = name => byName.get(normName(name)) || null;
  const reps = new Map();
  for (const r of withOwners) {
    const full = cleanText(r.co_owner_name || '', 120);
    if (!full || hasPii(full)) continue;
    const firstWord = full.split(/\s+/)[0].toLowerCase();
    if (!reps.has(firstWord)) reps.set(firstWord, { full, partner: ['upside', 'both'].includes(r.owner_team) ? partner(TEAM_LABEL.upside) : null });
  }
  return { partner, rep: name => reps.get(String(name || '').trim().split(/\s+/)[0].toLowerCase()) || null };
}

const HOMELOVER = /^(homelover|home lover|hl)$|existing outreach/i;
const KEYWORD = [[/website|web\b|site visit/i, 'website'], [/inbound/i, 'inbound'], [/scout/i, 'scout'], [/event|conference|expo/i, 'event']];

// One sheet row's Source / Route in / Broker on account -> { key, value, source: { kind + fields }, rule }.
export function mapSheetSource({ source, route_in, broker }, dir) {
  const s = cleanText(source || '', 160);
  const route = text(route_in, TEXT_MAX.route_in);
  const done = (key, value, src, rule) => ({ key, value, rule, source: { source_kind: src.source_kind, source_partner_id: src.source_partner_id || null, source_person: src.source_person || null, route_in: route } });
  if (source && hasPii(String(source))) return done('Source: (withheld)', '(withheld)', { source_kind: 'unknown' }, 'looks like an address or phone - not used');
  const key = `Source: ${s || '(blank)'}`;
  if (s && HOMELOVER.test(s)) return done(key, s, { source_kind: 'homelover_outreach' }, 'HomeLover');
  const pair = s.match(/^(.+?)\s*\((.+)\)$/);
  if (pair) {
    const p = dir.partner(pair[1]);
    if (p) {
      const rep = dir.rep(pair[2]);
      return done(key, s, { source_kind: 'partner_referral', source_partner_id: p.id, source_person: rep && (!rep.partner || rep.partner.id === p.id) ? rep.full : cleanText(pair[2], 120) }, `partner ${p.name} + person`);
    }
  }
  if (s) {
    const p = dir.partner(s);
    if (p) return done(key, s, { source_kind: 'partner_referral', source_partner_id: p.id }, `partner ${p.name}`);
    const rep = s.split(/\s+/).length <= 3 ? dir.rep(s) : null;
    if (rep) return done(key, s, rep.partner ? { source_kind: 'partner_referral', source_partner_id: rep.partner.id, source_person: rep.full } : { source_kind: 'person_referral', source_person: rep.full }, rep.partner ? `${rep.partner.name}'s rep` : 'a person');
    const kw = KEYWORD.find(([re]) => re.test(s));
    if (kw) return done(key, s, { source_kind: kw[1] }, kw[1]);
    return done(key, s, { source_kind: 'unknown' }, 'no rule matched');
  }
  const b = broker && dir.partner(broker);
  if (b) return done(`Broker on account: ${b.name}`, b.name, { source_kind: 'partner_referral', source_partner_id: b.id }, 'broker is a partner');
  return done(key, '(blank)', { source_kind: 'unknown' }, 'no Source on the sheet');
}

// A record with no master-sheet block: what its channel already says.
const CHANNEL_SOURCE = { website_visit: 'website', scout: 'scout', apollo_outbound: 'homelover_outreach' };
export function mapChannel(channel) {
  const kind = CHANNEL_SOURCE[channel] || 'unknown';
  return { key: `Channel: ${channel || 'unknown'}`, value: channel || 'unknown', rule: CHANNEL_SOURCE[channel] ? 'channel' : 'channel says nothing about who originated it', source: { source_kind: kind } };
}

// The master-sheet lines under "— master sheet <id> —" (masterImport.js withBlock / NOTE_FIELDS).
export function sheetLines(notes) {
  const ls = String(notes || '').split('\n');
  const i = ls.findIndex(l => /^— master sheet .+ —$/.test(l.trim()));
  if (i < 0) return null;
  const out = {};
  for (let j = i + 1; j < ls.length && ls[j].trim(); j++) {
    const m = ls[j].match(/^(Source|Route in|Broker on account|Partner path): (.*)$/);
    if (m) out[{ Source: 'source', 'Route in': 'route_in', 'Broker on account': 'broker', 'Partner path': 'partner_path' }[m[1]]] = m[2].trim();
  }
  return out;
}

// Intake's referred_by ({ partner, person, office } as the notes say it) -> the review row's proposal, with the
// partner resolved against this workspace's partners. partners: [{ id, name }].
export function cleanReferral(ref, partners) {
  if (!ref || typeof ref !== 'object') return null;
  const partner = text(ref.partner, 160, { name: true }), person = text(ref.person, TEXT_MAX.source_person, { name: true }), office = text(ref.office, TEXT_MAX.source_office, { name: true });
  if (!partner && !person) return null;
  const hit = partner ? partners.find(p => normName(p.name) === normName(partner)) : null;
  return { partner: hit ? hit.name : partner, partner_id: hit ? hit.id : null, person, office };
}

// A confirmed referral -> the source a new record gets. A partner the notes name that isn't in Pipeline yet stays
// a partner referral with the name in the note.
export function referralSource(ref) {
  if (!ref) return null;
  if (ref.partner_id) return { source_kind: 'partner_referral', source_partner_id: ref.partner_id, source_person: ref.person, source_office: ref.office };
  if (ref.partner) return { source_kind: 'partner_referral', source_person: ref.person, source_office: ref.office, source_note: `Referred by ${ref.partner} (not in Pipeline yet)` };
  return { source_kind: 'person_referral', source_person: ref.person, source_office: ref.office };
}

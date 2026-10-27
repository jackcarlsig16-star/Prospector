// hkos-sheet-import-v1 S2 / S4 - parsed tabs + the existing brands -> the plan a preview shows and a commit writes. Pure:
// nothing here touches the DB. One planned brand per name (normName exact, spaces ignored) across every tab: periods
// append, contacts dedupe by email, notes append, status = the most advanced row. An exact hit on an existing brand
// (domain / name / alias) is a match, never a second brand; a whole-word partial is created AND listed as a possible
// duplicate for Review (SALT vs Hogsalt), never merged. Addresses go ONLY into contacts: one found inside free text is
// moved out to a contact and removed from the text before cleanText. The legacy DB rows are a cross-check, nothing is
// read from them into a brand.
import { normName, nameMatches } from '../sales/intakeMatch.js';
import { cleanText } from '../sales/scrubText.js';
import { normalizeDomain } from '../../src/constants/partnerDomains.js';
import { normalizeStatus, mostAdvanced } from './importStatus.js';
import { noAt } from './inboxRules.js';
import { nextDueAt } from './syncRules.js';

const EMAIL = /[^\s@<>()"',;]+@[^\s@<>()"',;]+\.[a-z]{2,}/gi;
const SEGMENT = { pete_outreach: 'sponsor_brand', jack_outreach: 'sponsor_brand', launch: 'sponsor_brand', monthly: 'sponsor_brand', sheet8: 'sponsor_brand', nonprofit: 'nonprofit', press: 'press', podcast: 'podcast' };
const REL_RANK = { prospect: 0, sponsor: 1, founding_partner: 2 };
const LAUNCH_FIELDS = [['type', 'Type'], ['challenge_name', 'Challenge name'], ['raffle_item', 'Raffle item'], ['reward', 'Reward'], ['redemption_method', 'Redemption method'], ['discount_code', 'Discount code'], ['percentage_off', 'Percentage off'], ['agreement', 'Agreement']];
const MAX = { notes: 4000, challenge_idea: 1000, origin_hook: 1000, category: 80 };
export const tightKey = name => normName(name).replace(/ /g, '');

// Addresses are moved out first (to contacts, by the caller), then the inbox's literal rule: a bare @ ("@handle", "Jane @ Acme")
// reads as "at", so no saved text ever trips the hasPii gate the brand routes apply.
const line = (v, max = 400) => noAt(cleanText(String(v || '').replace(EMAIL, ''), max)).slice(0, max);
const emailsIn = v => [...String(v || '').matchAll(EMAIL)].map(m => m[0].toLowerCase());

// "Ana <ana@x.com>", "ana@x.com", "Ana Ortiz", "ana@x.com, pete@y.com" -> contacts. A bare address is named after the brand
// (REVISABLE); a bare name is a contact with no email.
export function contactsFrom(cell, brandName) {
  const out = [];
  for (const piece of String(cell || '').split(/[\n,;]+|\s+\/\s+/)) {
    const emails = emailsIn(piece);
    const name = noAt(cleanText(piece.replace(EMAIL, '').replace(/[<>()]/g, ''), 160));
    if (emails.length) for (const email of emails) out.push({ name: name || `${brandName} contact`, email, email_source: 'import' });
    else if (name) out.push({ name, email: null, email_source: null });
  }
  return out;
}

function fresh(tab, row) {
  return { key: tightKey(row.name), name: cleanText(row.name, 160), domain: null, segment: SEGMENT[tab.kind], category: null, is_local: false, status: 'candidate', relationship: 'prospect', owner_user_id: null, owner_hint: null, notes: [], challenge_idea: null, origin_hook: null, contacts: [], touches: [], periods: [], last_touch_at: null, next_due_at: null, refs: [], tabs: [], warnings: [], existing_id: null, duplicate_of: [], result: 'new' };
}

// One row -> the brand fields it contributes. Free text is scrubbed; addresses inside it become contacts.
function rowBrand(tab, row, { members, today, settings }) {
  const b = fresh(tab, row);
  b.refs.push(row.ref); b.tabs.push(tab.name);
  const pushText = (field, v, prefix = '') => { if (!v) return; for (const e of emailsIn(v)) b.contacts.push({ name: `${b.name} contact`, email: e, email_source: 'import' }); const t = line(v, MAX[field] || 400); if (!t) return; if (field === 'notes') b.notes.push(prefix + t); else b[field] = b[field] ? `${b[field]} ${t}`.slice(0, MAX[field]) : t; };
  const warn = (code, detail) => b.warnings.push({ code, detail, ref: row.ref });
  if (row.website) { b.domain = normalizeDomain(row.website); if (!b.domain) warn('bad_website', line(row.website, 120)); }
  // Jack's tab: Contact = a name, Email = the address -> one contact; anywhere else the Contact cell carries both.
  const named = contactsFrom(row.contact, b.name), emails = emailsIn(row.email);
  if (emails.length && named.length === 1 && !named[0].email) { named[0].email = emails.shift(); named[0].email_source = 'import'; }
  b.contacts.push(...named, ...emails.map(e => ({ name: `${b.name} contact`, email: e, email_source: 'import' })));
  const outreach = () => {
    const s = normalizeStatus({ status: row.status, outreachDate: row.outreach_date, jackOutreach: row.jack_outreach, today });
    b.status = s.status; b.touches.push(...s.touches);
    for (const w of s.warnings) warn(w.code, w.detail);
    if (s.note) b.notes.push(`Status: ${line(s.note, 200)}`);
    const sent = s.touches.filter(t => t.state === 'sent' && t.at && t.sender === 'owner');
    const last = sent[sent.length - 1];
    b.last_touch_at = sent.map(t => t.at).sort().pop() || null;
    b.next_due_at = last && ['sent', 'bumped'].includes(b.status) ? nextDueAt(last.kind, last.at, settings) : null;
  };
  const period = (p, kind, note) => b.periods.push({ period: p, kind, note: note || null });
  switch (tab.kind) {
    case 'pete_outreach':
      b.owner_hint = 'pete'; b.owner_user_id = members.pete || null;
      if (row.type) { b.category = line(row.type, MAX.category); b.is_local = false; }
      outreach(); pushText('notes', row.notes); pushText('challenge_idea', row.ideas);
      break;
    case 'jack_outreach':
      b.owner_hint = 'jack'; b.owner_user_id = members.jack || null;
      if (row.type) pushText('notes', row.type, 'Route: ');
      outreach(); pushText('notes', row.notes); pushText('origin_hook', row.enrichment); pushText('challenge_idea', row.ideas);
      break;
    case 'launch':
      b.relationship = 'founding_partner'; b.status = 'sponsor';
      period('launch', 'launch', line(row.challenge_name, 300) || null);
      for (const [k, label] of LAUNCH_FIELDS) if (row[k]) pushText('notes', row[k], `Launch: ${label}: `);
      break;
    case 'monthly':
      b.relationship = 'sponsor'; b.status = 'sponsor';
      period(tab.period, 'monthly', [row.status, row.challenge_name].filter(Boolean).map(v => line(v, 150)).filter(Boolean).join(' - ') || null);
      break;
    case 'nonprofit':
      outreach(); pushText('notes', row.summary); pushText('notes', row.notes); pushText('challenge_idea', row.ideas);
      break;
    case 'press':
      outreach();
      break;
    case 'podcast':
      if (row.lane) b.category = line(row.lane, MAX.category);
      outreach(); pushText('challenge_idea', row.pitch_angle); pushText('notes', row.host_email_source, 'Host email source: '); pushText('notes', row.notes);
      break;
    case 'sheet8':
      break;
    default:
      throw new Error(`no row rule for tab kind ${tab.kind}`);
  }
  return b;
}

const uniqBy = (arr, key) => { const seen = new Set(); return arr.filter(x => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; }); };
function merge(into, b) {
  into.refs.push(...b.refs); into.tabs.push(...b.tabs);
  into.domain ||= b.domain; into.category ||= b.category; into.challenge_idea ||= b.challenge_idea; into.origin_hook ||= b.origin_hook;
  // The first tab that names a founder keeps the row; a second founder is a Review warning, never a silent reassign.
  if (!into.owner_hint && !into.owner_user_id) { into.owner_hint = b.owner_hint; into.owner_user_id = b.owner_user_id; }
  else if (b.owner_hint && b.owner_hint !== into.owner_hint) into.warnings.push({ code: 'two_founders', detail: `${into.owner_hint} (${into.refs[0]}) and ${b.owner_hint} (${b.refs[0]}) both list this brand`, ref: b.refs[0] });
  into.notes.push(...b.notes); into.contacts.push(...b.contacts); into.touches.push(...b.touches); into.periods.push(...b.periods); into.warnings.push(...b.warnings);
  if (REL_RANK[b.relationship] > REL_RANK[into.relationship]) into.relationship = b.relationship;
  into.status = into.relationship === 'prospect' ? mostAdvanced(into.status, b.status) : 'sponsor';
  if (!b.last_touch_at || (into.last_touch_at && into.last_touch_at >= b.last_touch_at)) return;
  into.last_touch_at = b.last_touch_at; into.next_due_at = b.next_due_at;
}
const finish = b => {
  b.notes = uniqBy(b.notes, n => n).join('\n').slice(0, MAX.notes) || null;
  // One contact per address (a named one beats the "<brand> contact" placeholder); names without an address dedupe by name.
  const placeholder = `${b.name} contact`;
  b.contacts = uniqBy([...b.contacts].sort((x, y) => (x.name === placeholder) - (y.name === placeholder)), c => c.email || `name:${normName(c.name)}`);
  b.periods = uniqBy(b.periods, p => `${p.period}|${p.kind}`);
  b.tabs = [...new Set(b.tabs)];
  if (b.relationship !== 'prospect') { b.last_touch_at = b.last_touch_at || null; b.next_due_at = null; }
  b.contact_count = b.contacts.length; b.has_email = b.contacts.some(c => c.email);
  return b;
};
const existingSummary = b => ({ id: b.id, name: b.name, domain: b.domain || null, status: b.status, relationship: b.relationship, owner_user_id: b.owner_user_id || null });

// { parsed, brands (existing, live), legacy ([{ name, kind }]), members { jack, pete }, settings, today } -> plan
export function buildPlan({ parsed, brands = [], legacy = [], members = {}, settings = {}, today = null }) {
  const byKey = new Map(), order = [], tabs = [];
  const firstTab = new Map();
  for (const tab of parsed.tabs) {
    const t = { name: tab.name, kind: tab.kind, reason: tab.reason || null, period: tab.period || null, rows_read: tab.rows_read, rows: tab.rows?.length || 0, skipped_rows: tab.skipped_rows || 0, create: 0, match: 0, warnings: 0, unknown_headers: tab.unknown_headers || [] };
    tabs.push(t);
    if (tab.kind === 'skipped') continue;
    for (const row of tab.rows) {
      const b = rowBrand(tab, row, { members, today, settings });
      t.warnings += b.warnings.length;
      const hit = byKey.get(b.key);
      if (hit) merge(hit, b); else { byKey.set(b.key, b); order.push(b); firstTab.set(b.key, t); }
    }
  }
  const planned = order.map(finish);
  // Exact match against existing brands: domain, name or alias.
  const existingByKey = new Map(), existingByDomain = new Map();
  for (const e of brands) { existingByKey.set(tightKey(e.name), e); for (const a of e.aliases || []) existingByKey.set(tightKey(a), e); if (e.domain) existingByDomain.set(e.domain, e); }
  for (const b of planned) {
    const e = (b.domain && existingByDomain.get(b.domain)) || existingByKey.get(b.key) || null;
    if (e) { b.existing_id = e.id; b.existing = existingSummary(e); }
  }
  // Possible duplicates: planned vs planned, planned vs existing (whole-word partial, non-generic). Listed, never merged.
  const duplicates = [], seenPair = new Set();
  const pair = (a, hit, bId, reason) => { const k = [a.key, bId || tightKey(hit.name)].sort().join('|'); if (seenPair.has(k)) return; seenPair.add(k); duplicates.push({ a: a.name, b: hit.name, b_existing_id: bId || null, reason }); a.duplicate_of.push(hit.name); if (!bId) hit.duplicate_of.push(a.name); };
  for (const a of planned) {
    if (a.existing_id) continue;
    for (const hit of nameMatches(a.name, planned.filter(o => o !== a && !o.existing_id), 'name', true)) pair(a, hit, null, 'name_contains');
    for (const hit of nameMatches(a.name, brands, 'name', true)) pair(a, hit, hit.id, 'name_contains');
  }
  // Legacy cross-check (prospects = the old Confirmed Launch Sponsors list): a founding partner missing from the Launch tab.
  const launchKeys = new Set(planned.filter(b => b.relationship === 'founding_partner').map(b => b.key));
  const warnings = [];
  for (const l of legacy.filter(x => x.kind === 'prospect')) if (!launchKeys.has(tightKey(l.name)) && !existingByKey.has(tightKey(l.name))) warnings.push({ code: 'legacy_founding_partner_missing', detail: `${l.name} is in the legacy founding-partner list but not on the Launch tab` });
  const peteTouches = planned.filter(b => b.owner_hint === 'pete' && !b.owner_user_id).reduce((n, b) => n + b.touches.filter(t => t.sender === 'owner').length, 0);
  if (peteTouches) warnings.push({ code: 'owner_missing', detail: `${peteTouches} touches on Pete's rows wait for his first sign-in (owner_hint pete)` });
  for (const b of planned) {
    b.result = b.existing_id ? 'matches' : b.duplicate_of.length ? 'possible_duplicate' : b.warnings.length ? 'warning' : 'new';
    const t = firstTab.get(b.key);
    if (b.existing_id) t.match++; else t.create++;
  }
  const totals = { rows_read: tabs.reduce((n, t) => n + t.rows_read, 0), rows: tabs.reduce((n, t) => n + t.rows, 0), brands: planned.length, create: planned.filter(b => !b.existing_id).length, match: planned.filter(b => b.existing_id).length, possible_duplicates: duplicates.length, warnings: planned.reduce((n, b) => n + b.warnings.length, 0) + warnings.length, contacts: planned.reduce((n, b) => n + b.contacts.length, 0), contacts_with_email: planned.reduce((n, b) => n + b.contacts.filter(c => c.email).length, 0), touches: planned.reduce((n, b) => n + b.touches.length, 0), periods: planned.reduce((n, b) => n + b.periods.length, 0), skipped_tabs: tabs.filter(t => t.kind === 'skipped').map(t => ({ name: t.name, rows_read: t.rows_read, reason: t.reason })) };
  return { tabs, brands: planned, duplicates, warnings, totals };
}

// What the preview table may show per brand: contact PRESENCE, never an address (S6).
export const previewRow = b => ({ key: b.key, name: b.name, domain: b.domain, segment: b.segment, status: b.status, relationship: b.relationship, owner_hint: b.owner_hint, result: b.result, tabs: b.tabs, refs: b.refs, contact_count: b.contact_count, has_email: b.has_email, touches: b.touches.length, periods: b.periods.map(p => p.period), warnings: b.warnings, duplicate_of: b.duplicate_of, existing: b.existing || null });

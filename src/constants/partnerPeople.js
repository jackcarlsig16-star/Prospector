import { FIRST_TOUCH_TYPES } from './partnerPipeline.js';

// partner-360-v1 - who we know at a partner, merged from three places and
// shared by the API (people_count on the partners list) and the drop-down:
//   partner_contacts rows (source apollo | manual | outlook),
//   names typed on logged touches (source 'logged'),
//   the sheet's known_contacts text (source 'sheet', read-only).
// One person per name; a DB row wins, then a logged name, then the sheet.
// first_touch_at / first_touch_source (first-touch-people-v1): the earliest
// of a counted touch naming the person (logged, or written by Apollo) and
// the Apollo sequence start; a person with neither was never touched.

export const PEOPLE_SOURCES = {
  apollo: 'Apollo', manual: 'Added', outlook: 'Outlook', logged: 'Logged', sheet: 'Sheet',
};

const nameKey = s => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// "Alex Aydin (intro); Gerri Vagadori (VP New BD)" -> [{ name, note }]
export function parseKnownContacts(text) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  for (const raw of text.split(/[;\n]+/)) {
    const m = raw.trim().match(/^([^(]+?)\s*(?:\(([^)]*)\))?\s*$/);
    if (!m || !m[1].trim()) continue;
    out.push({ name: m[1].trim().replace(/\s+/g, ' '), note: m[2]?.trim() || null });
  }
  return out;
}

const later = (a, b) => (!a || (b && Date.parse(b) > Date.parse(a)) ? b : a);

// contacts: partner_contacts rows for this partner; events: its
// sales_partner_events (any order); knownContacts: the sheet text.
export function mergePeople({ contacts = [], events = [], knownContacts = '' }) {
  const undone = new Set(events.filter(e => e.event === 'undo').map(e => e.meta?.undid).filter(Boolean));
  const byKey = new Map();
  const add = (key, person) => { if (!byKey.has(key)) byKey.set(key, person); return byKey.get(key); };

  for (const c of contacts) {
    add(nameKey(c.name), {
      id: c.id, name: c.name, title: c.title || null, note: null, email: c.email || null, linkedin_url: c.linkedin_url || null,
      source: c.source, last_activity_at: c.last_activity_at || null, last_activity_type: c.last_activity_type || null,
      sequence_status: c.sequence_status || null, sequence_added_at: c.sequence_added_at || null, sequence_finished_at: c.sequence_finished_at || null,
      first_touch_at: c.sequence_added_at || null, first_touch_source: c.sequence_added_at ? 'apollo' : null,
      deletable: c.source === 'manual',
    });
  }
  const touches = events.filter(e => e.event === 'touch' && !undone.has(e.id)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const t of touches) {
    for (const name of t.contact_names || []) {
      const key = nameKey(name);
      if (!key) continue;
      const p = add(key, { id: `logged:${key}`, name, title: null, note: null, email: null, linkedin_url: null, source: 'logged', last_activity_at: null, last_activity_type: null, sequence_status: null, sequence_added_at: null, sequence_finished_at: null, first_touch_at: null, first_touch_source: null, deletable: false });
      if (later(p.last_activity_at, t.at) === t.at) { p.last_activity_at = t.at; p.last_activity_type = t.touch_type; }
      if (FIRST_TOUCH_TYPES.includes(t.touch_type) && (!p.first_touch_at || Date.parse(t.at) < Date.parse(p.first_touch_at))) {
        p.first_touch_at = t.at; p.first_touch_source = t.source === 'apollo' ? 'apollo' : 'logged';
      }
    }
  }
  for (const k of parseKnownContacts(knownContacts)) {
    const key = nameKey(k.name);
    if (!key) continue;
    const p = add(key, { id: `sheet:${key}`, name: k.name, title: null, note: k.note, email: null, linkedin_url: null, source: 'sheet', last_activity_at: null, last_activity_type: null, sequence_status: null, sequence_added_at: null, sequence_finished_at: null, first_touch_at: null, first_touch_source: null, deletable: false });
    // The sheet's spelling beats a name typed on a touch ("pat lee").
    if (p.source === 'logged') p.name = k.name;
    if (!p.note && !p.title && k.note) p.note = k.note;
  }
  return [...byKey.values()].sort((a, b) =>
    (b.last_activity_at ? Date.parse(b.last_activity_at) : 0) - (a.last_activity_at ? Date.parse(a.last_activity_at) : 0)
    || a.name.localeCompare(b.name));
}

import { randomUUID } from 'crypto';
import { getSupabase } from './goalsShared.js';

// person-owner-v1 O2 - the ONE writer of a person's owner (owner_user_id on sales_prospect_state, sales_people and
// partner_contacts). A person is named by its People row key (K4): prospect:<contact id> | person:<id> | contact:<id>.
// Every assign leaves exactly one sales_person_events row (kind assign, before / after = owner_user_id) - a user id,
// never a name, address or phone. expect = the owner the caller's screen showed: a person whose owner differs is
// refused with 409 and the current owner, never overwritten; the update itself is compare-and-set.
// The new owner must be a member of the workspace (null = Unassigned). Undo: within UNDO_WINDOW_MS, only while the
// person still holds the event's `after` (409 'drift'); restores `before`, stamps the event undone, adds an 'undo' row.
// The prospect's text enum `owner` is never written here or anywhere else (K8).
export const PERSON_ORIGINS = ['manual', 'scout', 'panel', 'system'];
export const PERSON_EVENT_KINDS = ['assign', 'undo'];
export const UNDO_WINDOW_MS = 2 * 60e3; // screens show 10 s; the slack covers slow networks
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^(prospect|person|contact):(.+)$/;
const TABLES = {
  prospect: { table: 'sales_prospect_state', idCol: 'contact_id', cols: 'contact_id, name, owner_user_id' },
  person: { table: 'sales_people', idCol: 'id', cols: 'id, name, owner_user_id, archived_at', uuid: true },
  contact: { table: 'partner_contacts', idCol: 'id', cols: 'id, name, owner_user_id', uuid: true },
};
const EVENT_COLS = 'id, person_key, kind, before, after, actor_user_id, origin, batch_id, at, undone_at, undo_of';

export class PersonError extends Error {
  constructor(message, status = 400, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}
const must = r => { if (r.error) throw new PersonError(r.error.message, 500); return r.data; };
const same = (a, b) => (a ?? null) === (b ?? null);

// -> { key, table, idCol, id, name, owner_user_id } | null (a bad key, no such row, or an archived person)
export async function loadPerson(supabase, businessId, personKey) {
  const m = KEY.exec(String(personKey || ''));
  if (!m || String(personKey).length > 200) return null;
  const t = TABLES[m[1]];
  if (t.uuid && !UUID.test(m[2])) return null;
  const row = must(await supabase.from(t.table).select(t.cols).eq('business_id', businessId).eq(t.idCol, m[2]).maybeSingle());
  if (!row || row.archived_at) return null;
  return { key: `${m[1]}:${m[2]}`, table: t.table, idCol: t.idCol, id: m[2], name: row.name || null, owner_user_id: row.owner_user_id || null };
}

async function checkOwner(supabase, businessId, ownerUserId) {
  if (ownerUserId === null) return;
  if (typeof ownerUserId !== 'string' || !UUID.test(ownerUserId)) throw new PersonError('owner_user_id must be a member id or null', 400);
  const member = must(await supabase.from('business_members').select('user_id').eq('business_id', businessId).eq('user_id', ownerUserId).maybeSingle());
  if (!member) throw new PersonError('That person is not a member of this workspace', 400);
}
const setOwner = (supabase, businessId, p, from, to, now) => {
  const q = supabase.from(p.table).update({ owner_user_id: to, updated_at: now.toISOString() }).eq('business_id', businessId).eq(p.idCol, p.id);
  return (from == null ? q.is('owner_user_id', null) : q.eq('owner_user_id', from)).select(p.idCol);
};

// -> { person: { key, name, owner_user_id }, event } (event null when the owner is already that)
export async function applyPerson(supabase, { businessId, personKey, kind = 'assign', fields = {}, expect = null, actor = null, origin, batchId = null, now = new Date() }) {
  if (kind !== 'assign') throw new PersonError('kind must be assign', 400);
  if (!PERSON_ORIGINS.includes(origin)) throw new PersonError(`origin must be one of ${PERSON_ORIGINS.join('|')}`, 400);
  if (!('owner_user_id' in fields)) throw new PersonError('owner_user_id is required (null = Unassigned)', 400);
  const to = fields.owner_user_id ?? null;
  const p = await loadPerson(supabase, businessId, personKey);
  if (!p) throw new PersonError('person not found', 404);
  if (expect && 'owner_user_id' in expect && !same(expect.owner_user_id, p.owner_user_id)) {
    throw new PersonError('The owner changed since you opened this - reloaded', 409, { code: 'changed', owner_user_id: p.owner_user_id });
  }
  await checkOwner(supabase, businessId, to);
  const person = { key: p.key, name: p.name, owner_user_id: to };
  if (same(to, p.owner_user_id)) return { person, event: null };
  const rows = must(await setOwner(supabase, businessId, p, p.owner_user_id, to, now));
  if (!rows.length) {
    const cur = await loadPerson(supabase, businessId, p.key);
    throw new PersonError('The owner changed since you opened this - reloaded', 409, { code: 'changed', owner_user_id: cur?.owner_user_id ?? null });
  }
  const [event] = must(await supabase.from('sales_person_events').insert([{ business_id: businessId, person_key: p.key, kind: 'assign', before: { owner_user_id: p.owner_user_id }, after: { owner_user_id: to }, actor_user_id: actor, origin, batch_id: batchId, at: now.toISOString() }]).select(EVENT_COLS));
  return { person, event };
}

// The same owner for several people as ONE batch. A person whose owner changed meanwhile, or who is gone, is skipped.
export async function applyPeople(supabase, { businessId, personKeys, fields, actor = null, origin, batchId = randomUUID(), now = new Date() }) {
  const done = [];
  for (const personKey of personKeys) {
    try { const r = await applyPerson(supabase, { businessId, personKey, fields, actor, origin, batchId, now }); if (r.event) done.push(r); }
    catch (e) { if (![404, 409].includes(e.status)) throw e; }
  }
  return { batchId, people: done.map(r => r.person), events: done.map(r => r.event) };
}

// -> { person, event (the 'undo' row), undid }
export async function undoPersonEvent(supabase, { businessId, eventId, event = null, actor = null, now = new Date(), windowMs = UNDO_WINDOW_MS }) {
  let ev = event;
  if (!ev) {
    if (!UUID.test(eventId || '')) throw new PersonError('event not found', 404);
    ev = must(await supabase.from('sales_person_events').select(EVENT_COLS).eq('business_id', businessId).eq('id', eventId).maybeSingle());
    if (!ev) throw new PersonError('event not found', 404);
  }
  if (ev.kind === 'undo') throw new PersonError('an undo cannot be undone', 409);
  if (ev.undone_at) throw new PersonError('already undone', 409);
  if (now - Date.parse(ev.at) > windowMs) throw new PersonError('too late to undo - assign again instead', 409, { code: 'expired' });
  const p = await loadPerson(supabase, businessId, ev.person_key);
  if (!p) throw new PersonError('person not found', 404);
  const after = ev.after?.owner_user_id ?? null, before = ev.before?.owner_user_id ?? null;
  if (!same(after, p.owner_user_id)) throw new PersonError('the owner changed since - undo skipped', 409, { code: 'drift', owner_user_id: p.owner_user_id });
  const rows = must(await setOwner(supabase, businessId, p, after, before, now));
  if (!rows.length) throw new PersonError('the owner changed since - undo skipped', 409, { code: 'drift' });
  must(await supabase.from('sales_person_events').update({ undone_at: now.toISOString() }).eq('id', ev.id).select('id'));
  const [undo] = must(await supabase.from('sales_person_events').insert([{ business_id: businessId, person_key: p.key, kind: 'undo', before: { owner_user_id: after }, after: { owner_user_id: before }, actor_user_id: actor, origin: ev.origin, batch_id: ev.batch_id, undo_of: ev.id, at: now.toISOString() }]).select(EVENT_COLS));
  return { person: { key: p.key, name: p.name, owner_user_id: before }, event: undo, undid: { id: ev.id, kind: ev.kind, person_key: ev.person_key } };
}

// Every event of the batch as one, newest first. A person who fails is named; the rest stay undone.
export async function undoPersonBatch(supabase, { businessId, batchId, actor = null, now = new Date(), windowMs = UNDO_WINDOW_MS }) {
  if (!UUID.test(batchId || '')) throw new PersonError('batch not found', 404);
  const events = must(await supabase.from('sales_person_events').select(EVENT_COLS).eq('business_id', businessId).eq('batch_id', batchId).order('at', { ascending: false }))
    .filter(e => e.kind !== 'undo' && !e.undone_at);
  if (!events.length) throw new PersonError('nothing to undo', 409);
  const undone = [], failed = [];
  for (const ev of events) {
    try { undone.push(await undoPersonEvent(supabase, { businessId, event: ev, actor, now, windowMs })); }
    catch (e) { if (!e.status || e.status >= 500) throw e; failed.push({ person_key: ev.person_key, error: e.message }); }
  }
  return { batch_id: batchId, undone, failed };
}

const send = (res, fn) => fn().then(body => res.json(body)).catch(e => res.status(e.status || 500).json({ error: e.message, ...(e.code ? { code: e.code } : {}), ...('owner_user_id' in e ? { owner_user_id: e.owner_user_id } : {}) }));
const CLIENT_ORIGINS = ['manual', 'scout', 'panel'];
// POST goals/people/:key/assign { owner_user_id, expect?: { owner_user_id }, origin? } -> { person, event }
export function assignPersonRoute(req, res) {
  const { owner_user_id: ownerUserId, expect = null, origin = 'manual' } = req.body || {};
  if (ownerUserId === undefined) return res.status(400).json({ error: 'owner_user_id is required (null = Unassigned)' });
  if (expect != null && (typeof expect !== 'object' || Array.isArray(expect))) return res.status(400).json({ error: 'expect must be an object' });
  if (!CLIENT_ORIGINS.includes(origin)) return res.status(400).json({ error: `origin must be one of ${CLIENT_ORIGINS.join('|')}` });
  return send(res, () => applyPerson(getSupabase(), { businessId: req.params.businessId, personKey: req.params.key, fields: { owner_user_id: ownerUserId }, expect, actor: req.auth.user.id, origin }));
}
// POST goals/people/events/:id/undo -> { person, event, undid }
export function undoPersonEventRoute(req, res) {
  return send(res, () => undoPersonEvent(getSupabase(), { businessId: req.params.businessId, eventId: req.params.id, actor: req.auth.user.id }));
}

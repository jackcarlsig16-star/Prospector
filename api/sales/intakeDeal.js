import { createHmac, timingSafeEqual } from 'crypto';
import { cleanText } from './scrubText.js';
import { isDate, addDays } from './goalsShared.js';

// call-notes-targets-v1 REV5 - the deal side of a partner call: decisions,
// what the other side owes us (waiting on), terms, and the next meeting.
// Same rule as the rest of Intake: the model only names things; only a row
// that resolves to a partner is ticked, the rest is shown and never stored.

export const DEAL_LISTS = ['decisions', 'waiting_on', 'terms', 'next_meeting'];
const MAX_DEAL = 30;
const RECENT_MS = 24 * 3600e3;
const list = v => (Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : []).slice(0, MAX_DEAL).filter(x => x && typeof x === 'object');
const slash = d => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
export const termsLine = (noteDate, text) => `(${slash(noteDate)}) Terms: ${text}`;
const monday = d => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));

// companyOf: intakeMatch's name -> { company, company_key, m }. isMember:
// a name that is one of ours (their action items only).
export function toDeal(raw, { companyOf, isMember, noteDate }) {
  const at = name => {
    const c = companyOf(name);
    const partner = c.m?.type === 'partner' ? c.m : null;
    return { company: c.company, company_key: c.company_key, match: partner ? { type: 'partner', id: partner.id, name: partner.name } : null, row: partner?.row || null };
  };
  const base = (x, i, prefix) => {
    const c = at(x.company);
    return { key: `${prefix}${i}`, company: c.company, company_key: c.company_key, match: c.match, evidence: cleanText(x.evidence, 200), on: !!c.match, _row: c.row };
  };
  const decisions = list(raw?.decisions).map(d => ({ text: cleanText(d.text, 400), d })).filter(x => x.text)
    .map((x, i) => ({ ...base(x.d, i, 'd'), text: x.text }));
  const waiting_on = list(raw?.waiting_on).map(w => ({ who: cleanText(w.who, 120), text: cleanText(w.text, 400), w }))
    .filter(x => x.who && x.text && !isMember(x.who))
    .map((x, i) => ({ ...base(x.w, i, 'w'), who: x.who, text: x.text, due_date: isDate(x.w.due_date) ? x.w.due_date : null }));
  const terms = list(raw?.terms).map(t => ({ text: cleanText(t.text, 400), t })).filter(x => x.text)
    .map((x, i) => ({ ...base(x.t, i, 'm'), text: x.text, line: termsLine(noteDate, x.text) }));
  const next_meeting = list(raw?.next_meeting).filter(n => isDate(n.date)).slice(0, 1).map((n, i) => {
    const b = base(n, i, 'n');
    const text = cleanText(n.text, 200);
    // "the week of Oct 27" is that Monday, whatever day the model picked.
    const date = /\bweek of\b/i.test(`${n.text} ${n.evidence}`) ? monday(n.date) : n.date;
    return { ...b, date, text, old: b._row?.next_meeting_at ?? null };
  });
  const strip = rows => rows.map(({ _row, ...r }) => r);
  return { decisions: strip(decisions), waiting_on: strip(waiting_on), terms: strip(terms), next_meeting: strip(next_meeting) };
}

// Accept: the ticked rows the browser sent back, each checked against this
// workspace's partners.
export function parseDeal(body, ctx) {
  const err = (status, error) => Object.assign(new Error(error), { status });
  const partnerOf = (x, label) => {
    const p = x?.match?.type === 'partner' && ctx.partners.find(r => r.id === x.match.id);
    if (!p) throw err(400, `${label}: only a partner in this workspace takes it`);
    return p;
  };
  const rows = k => {
    const v = body[k] ?? [];
    if (!Array.isArray(v) || v.length > MAX_DEAL) throw err(400, `${k} must be a list of up to ${MAX_DEAL}`);
    return v.filter(x => x && typeof x === 'object');
  };
  const text = (x, label, n = 400) => { const t = cleanText(x.text, n); if (!t) throw err(400, `${label}: text is required`); return t; };
  const decisions = rows('decisions').map((d, i) => ({ p: partnerOf(d, `decision ${i + 1}`), text: text(d, `decision ${i + 1}`) }));
  const waiting_on = rows('waiting_on').map((w, i) => {
    const who = cleanText(w.who, 120);
    if (!who) throw err(400, `waiting-on ${i + 1}: who is required`);
    if (w.due_date != null && !isDate(w.due_date)) throw err(400, `waiting-on ${i + 1}: due_date must be YYYY-MM-DD`);
    return { p: partnerOf(w, `waiting-on ${i + 1}`), who, text: text(w, `waiting-on ${i + 1}`), due_date: w.due_date ?? null };
  });
  const terms = rows('terms').map((t, i) => ({ p: partnerOf(t, `terms ${i + 1}`), text: text(t, `terms ${i + 1}`) }));
  const next_meeting = rows('next_meeting').map((n, i) => {
    if (!isDate(n.date)) throw err(400, `next meeting ${i + 1}: date must be YYYY-MM-DD`);
    return { p: partnerOf(n, `next meeting ${i + 1}`), date: n.date };
  });
  if (new Set(next_meeting.map(n => n.p.id)).size !== next_meeting.length) throw err(400, 'one next meeting per partner');
  return { decisions, waiting_on, terms, next_meeting };
}

// The model's reply as stored on the note (sales_call_notes.extract): every
// string scrubbed, nothing else changed.
export function scrubExtract(v) {
  if (typeof v === 'string') return cleanText(v, 2000);
  if (Array.isArray(v)) return v.map(scrubExtract);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubExtract(x)]));
  return v;
}

// The extract runs before the note row exists, so it rides back with
// Accept; the signature proves it is the server's own copy, not the page's.
const sigKey = () => process.env.SUPABASE_SERVICE_KEY || '';
export const signExtract = (extract, hash) => createHmac('sha256', sigKey()).update(`${hash}:${JSON.stringify(extract)}`).digest('hex');
export function extractIfSigned(extract, sig, hash) {
  if (extract == null) return null;
  if (typeof sig !== 'string') return null;
  const want = Buffer.from(signExtract(extract, hash));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? extract : null;
}

// "Another note on Equifax was accepted 42 min ago (5 to-dos, 3 events)":
// any note accepted in the last 24 h that wrote to one of these partners.
export async function recentAccepts(supabase, businessId, partners, now = new Date()) {
  if (!partners.length) return [];
  const since = new Date(now.getTime() - RECENT_MS).toISOString();
  const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
  const notes = must(await supabase.from('sales_call_notes').select('id, created_at').eq('business_id', businessId).gte('created_at', since));
  if (!notes.length) return [];
  const ids = notes.map(n => n.id);
  const [events, todos] = await Promise.all([
    supabase.from('sales_partner_events').select('id, goal_id, meta').eq('business_id', businessId).in('goal_id', partners.map(p => p.id)).gte('recorded_at', since),
    supabase.from('sales_week_goals').select('id, source_note_id').eq('business_id', businessId).in('source_note_id', ids),
  ]).then(rs => rs.map(must));
  const out = [];
  for (const p of partners) {
    for (const n of notes) {
      const m = events.filter(e => e.goal_id === p.id && e.meta?.from_note_id === n.id).length;
      if (!m) continue;
      out.push({ partner: p.name, partner_id: p.id, note_id: n.id, minutes_ago: Math.max(0, Math.round((now - Date.parse(n.created_at)) / 60000)), todos: todos.filter(t => t.source_note_id === n.id).length, events: m });
    }
  }
  return out.sort((a, b) => a.minutes_ago - b.minutes_ago);
}

// Terms and the next meeting are partner columns: they go through
// acceptIntake's guarded column queue with the intel (a teammate's edit in
// between = 409). queuePartner(partnerRow, (get, set) => ...).
export function queueDealFields(deal, queuePartner, callDate, out) {
  for (const t of deal.terms) {
    queuePartner(t.p, (get, set) => { const old = get('notes'); set('notes', old ? `${old}\n${termsLine(callDate, t.text)}` : termsLine(callDate, t.text)); });
    out.terms++;
  }
  for (const n of deal.next_meeting) {
    queuePartner(n.p, (get, set) => set('next_meeting_at', n.date));
    out.next_meeting.push({ partner: n.p.name, date: n.date, old: n.p.next_meeting_at ?? null });
  }
}

// Decisions and waiting rows, after to-dos and before stage moves. signal
// is acceptIntake's own helper, so every write has its undo on one stack.
export async function writeDeal(supabase, deal, { businessId, userId, note, week, category, signal, undo, must, out }) {
  for (const d of deal.decisions) { await signal(d.p.id, { type: 'note', note: d.text }, { kind: 'decision' }); out.decisions++; }
  if (!deal.waiting_on.length) return;
  const rows = must(await supabase.from('sales_week_goals').insert(deal.waiting_on.map((w, i) => ({
    business_id: businessId, week_start: week, kind: 'waiting', status: 'open', text: w.text, waiting_on: w.who, owner_user_id: null,
    due_date: w.due_date, link_type: 'partner', link_id: w.p.id, category, source_note_id: note.id, sort_order: i, created_by: userId,
  }))).select());
  undo.push(() => supabase.from('sales_week_goals').delete().in('id', rows.map(r => r.id)));
  out.waiting = rows;
  // Every counterpart we wait on gets a person row (match by name first).
  const goalIds = [...new Set(deal.waiting_on.map(w => w.p.id))];
  const found = must(await supabase.from('partner_contacts').select('id, goal_id, name').eq('business_id', businessId).in('goal_id', goalIds));
  const have = new Set(found.map(c => `${c.goal_id}:${c.name.trim().toLowerCase()}`));
  for (const w of deal.waiting_on) {
    const k = `${w.p.id}:${w.who.toLowerCase()}`;
    // "Equifax" owes it, no person named: nobody to add.
    if (have.has(k) || w.who.toLowerCase() === w.p.name.trim().toLowerCase()) continue;
    have.add(k);
    const row = must(await supabase.from('partner_contacts').insert({ business_id: businessId, goal_id: w.p.id, name: w.who, role_in_notes: 'counterpart', source: 'manual', created_by: userId }).select('id').single());
    undo.push(() => supabase.from('partner_contacts').delete().eq('id', row.id));
    out.counterparts_added++;
  }
}

export const emptyDealOut = () => ({ decisions: 0, waiting: [], terms: 0, next_meeting: [], counterparts_added: 0 });

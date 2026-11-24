import { extractNotes } from '../sales/callNotesRoutes.js';
import { scrubExtract } from '../sales/intakeDeal.js';
import { laDateString } from '../sales/laDate.js';
import { toNote, extractSource } from './toNote.js';
import { linkStoredNote } from '../sales/callLinks.js';

// fathom-notes-v1 F4 / F5 - store a recording as a note, and run the ONE extraction (callNotesRoutes.extractNotes)
// on a stored note under the workspace's daily cap. The extract is only ever a proposal on the note: nothing here
// writes a record, and nothing here accepts.

const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
export const FATHOM_CALL_TYPE = 'call_tasks_fathom';
const DEFAULT_CAP = 10;

// Midnight in Los Angeles as an instant (UTC-7 in summer, UTC-8 in winter).
export function laDayStart(now = new Date()) {
  const day = laDateString(now);
  return [7, 8].map(h => new Date(`${day}T0${h}:00:00Z`)).find(d => laDateString(d) === day && laDateString(new Date(d.getTime() - 1)) !== day);
}

// The cap counts the model calls actually made for Fathom notes today (the usage rows), automatic or by a click.
export async function extractsLeft(supabase, businessId, now = new Date()) {
  const settings = must(await supabase.from('sales_settings').select('fathom_extract_cap').eq('business_id', businessId).maybeSingle());
  const cap = settings?.fathom_extract_cap ?? DEFAULT_CAP;
  const { count, error } = await supabase.from('business_anthropic_usage').select('id', { count: 'exact', head: true })
    .eq('business_id', businessId).eq('call_type', FATHOM_CALL_TYPE).gte('created_at', laDayStart(now).toISOString());
  if (error) throw new Error(error.message);
  return { cap, used: count, left: Math.max(0, cap - count) };
}

// A recording -> its note row. { note } when stored, { duplicate: true } when this workspace already holds the
// recording (it is skipped, never replaced), { skipped } when the payload carries no usable recording id.
export async function storeRecording(supabase, { businessId, userId, meeting }) {
  const n = toNote(meeting);
  if (!n) return { skipped: 'no recording id' };
  const have = must(await supabase.from('sales_call_notes').select('id').eq('business_id', businessId).eq('fathom_recording_id', n.fathom_recording_id).limit(1));
  if (have.length) return { duplicate: true, recording_id: n.fathom_recording_id };
  const { has_summary, ...row } = n;
  const { data, error } = await supabase.from('sales_call_notes').insert({ business_id: businessId, created_by: userId, ...row })
    .select('id, title, call_date, source_type, source_label, text, transcript, attendees, fathom_recording_id').single();
  if (error?.code === '23505') return { duplicate: true, recording_id: n.fathom_recording_id };
  if (error) throw new Error(error.message);
  // F12 (2): the attendees' external domains name one record -> the note is about it ("linked by domain").
  await linkStoredNote(supabase, { businessId, noteId: data.id });
  return { note: data, recording_id: n.fathom_recording_id };
}

// 'extracted' | 'capped'. A note that already holds an extract is left alone.
export async function extractStored(supabase, { businessId, userId, note, now = new Date() }) {
  if ((await extractsLeft(supabase, businessId, now)).left < 1) return { status: 'capped' };
  const { raw, ctx, usage } = await extractNotes(supabase, {
    businessId, userId, text: extractSource(note), noteDate: note.call_date, title: note.title,
    sourceType: note.source_type, sourceLabel: note.source_label, attendees: note.attendees, callType: FATHOM_CALL_TYPE,
  });
  must(await supabase.from('sales_call_notes').update({ extract: scrubExtract(raw) }).eq('id', note.id).is('extract', null).select('id'));
  // F12 (3): still no record -> the extract's first company, when one record carries that name.
  await linkStoredNote(supabase, { businessId, noteId: note.id, extract: raw });
  return { status: 'extracted', raw, ctx, usage };
}

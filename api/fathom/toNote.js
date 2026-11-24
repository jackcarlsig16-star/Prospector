import { createHash } from 'crypto';
import { cleanText, scrubAddresses, hasPii } from '../sales/scrubText.js';
import { laDateString } from '../sales/laDate.js';

// fathom-notes-v1 F4 - one Fathom Meeting (the webhook body and a GET /meetings row are the same schema) -> the
// sales_call_notes row. Pure. No address field of the payload is ever read (invitee / recorded_by / assignee /
// speaker.matched_calendar_invitee_email); a name that is itself an address is dropped; a line that still looks like
// an address or a phone number after scrubbing is withheld whole.

export const TEXT_MAX = 120000;
export const TRANSCRIPT_MAX = 200000;
const WITHHELD = '[line withheld]';
const NO_SUMMARY = 'Fathom sent no summary for this recording - the transcript is stored with the note.';

// Fathom's summary links every bullet to the recording ("[text](https://…/calls/123456789?timestamp=…)"): the ids
// in those URLs have the shape of a phone number and would get every line withheld. The label is the content.
const unlink = s => s.replace(/\[([^\]]*)\]\((?:https?:\/\/)[^)\s]*\)/g, '$1').replace(/https?:\/\/\S+/g, '');
const safeLines = s => unlink(String(s)).split('\n').map(line => { const l = scrubAddresses(line).trimEnd(); return l.includes('[number removed]') || hasPii(l) ? WITHHELD : l; }).join('\n');
// A one-line field (a name, a title): scrubbed, and blank when what is left is only the scrub marker or holds an "@".
const name = (v, max = 120) => { const t = cleanText(v, max); return !t || /@|\[email removed\]|\[number removed\]/.test(t) ? '' : t; };
// "01:05:32" -> "65:32"
const clock = t => { const m = /^(\d{2}):(\d{2}):(\d{2})$/.exec(t || ''); return m ? `${String(Number(m[1]) * 60 + Number(m[2])).padStart(2, '0')}:${m[3]}` : '--:--'; };
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

export function toNote(meeting) {
  const recordingId = Number(meeting?.recording_id);
  if (!Number.isSafeInteger(recordingId)) return null;
  // A title keeps its words ("Jack @ Acme"): only the sign goes.
  const label = v => cleanText(v, 200).replace(/@/g, ' ').replace(/\s+/g, ' ').trim();
  const title = label(meeting.meeting_title) || label(meeting.title) || 'Fathom recording';
  const started = new Date(meeting.recording_start_time || meeting.created_at || NaN);
  const instant = v => { const d = new Date(v || NaN); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };
  const summary = typeof meeting.default_summary?.markdown_formatted === 'string' ? safeLines(meeting.default_summary.markdown_formatted).trim() : '';
  const items = (Array.isArray(meeting.action_items) ? meeting.action_items : []).map(a => {
    const d = cleanText(unlink(String(a?.description ?? '')), 400);
    return d && !hasPii(d) ? `- ${d} — ${name(a.assignee?.name) || 'unassigned'}${a.completed ? ' [done]' : ''}` : null;
  }).filter(Boolean);
  const text = [summary || NO_SUMMARY, items.length ? `Action items (Fathom)\n${items.join('\n')}` : ''].filter(Boolean).join('\n\n').slice(0, TEXT_MAX);

  const lines = (Array.isArray(meeting.transcript) ? meeting.transcript : []).map(t => {
    const said = safeLines(String(t?.text ?? '').replace(/\s+/g, ' ').trim());
    return said ? `${name(t.speaker?.display_name) || 'Speaker'} [${clock(t.timestamp)}]: ${said}` : null;
  }).filter(Boolean).join('\n');
  const mark = `\n… transcript truncated (full length ${lines.length} characters)`;
  const transcript = !lines ? null : lines.length <= TRANSCRIPT_MAX ? lines : lines.slice(0, TRANSCRIPT_MAX - mark.length) + mark;

  const attendees = (Array.isArray(meeting.calendar_invitees) ? meeting.calendar_invitees : []).slice(0, 100).map(i => ({
    name: name(i?.name) || name(i?.matched_speaker_display_name) || null,
    is_external: !!i?.is_external,
    domain: typeof i?.email_domain === 'string' && DOMAIN.test(i.email_domain) ? i.email_domain.toLowerCase().slice(0, 120) : null,
  })).filter(a => a.name || a.domain);

  return {
    fathom_recording_id: recordingId,
    title,
    call_date: laDateString(Number.isNaN(started.getTime()) ? new Date() : started),
    recording_start: instant(meeting.recording_start_time),
    recording_end: instant(meeting.recording_end_time),
    source_type: 'call',
    source_label: `Fathom · ${title}`.slice(0, 120),
    text,
    // Two recordings can carry the same words (two with no summary do): the id keeps (business_id, hash) one per recording.
    hash: createHash('sha256').update(`fathom:${recordingId}:${text}`).digest('hex'),
    fathom_url: typeof meeting.share_url === 'string' && /^https:\/\//.test(meeting.share_url) ? meeting.share_url.slice(0, 500) : null,
    transcript,
    attendees,
    has_summary: !!summary,
  };
}

// What the extractor reads: Fathom's summary + action items, or (F8) the transcript when there was no summary.
export const extractSource = note => (note.text.startsWith(NO_SUMMARY) && note.transcript ? note.transcript : note.text).slice(0, TEXT_MAX);

import { randomUUID } from 'node:crypto';
import { getSupabase } from './goalsShared.js';
import { hasPii } from './scrubText.js';
import { CLIENT_FILE_KINDS, CLIENT_FILE_MIMES, CLIENT_FILE_MAX_BYTES } from '../../src/constants/clients.js';

// homelover-clients-v1 C6 - agreements + financials on a client's panel. The bytes never pass through this server
// (JSON is capped at 20 MB and there's no multipart): the server checks the caller's workspace, kind, type and size
// and hands back a signed UPLOAD url for one object path; the browser uploads straight to the private client-files
// bucket; the server then records the row only after it finds the object and reads its real size and type. Opening
// = a 60-second signed url. Archive, never delete. File contents never go to Claude.

export const BUCKET = 'client-files';
export const OPEN_TTL_S = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLS = 'id, opportunity_id, kind, title, storage_path, size_bytes, mime, uploaded_by, uploaded_at, archived_at';
const err = (status, error) => Object.assign(new Error(error), { status });
const must = r => { if (r.error) throw err(500, r.error.message); return r.data; };
const reply = (status, body) => ({ status, body });
const send = (res, r) => res.status(r.status).json(r.body);
const caught = (label, e) => {
  if (!e.status || e.status >= 500) console.error(`[client-files/${label}]`, e.message);
  return reply(e.status || 500, { error: e.message });
};
const pathOf = (businessId, opportunityId, fileId) => `${businessId}/${opportunityId}/${fileId}`;
const publicFile = f => ({ id: f.id, opportunity_id: f.opportunity_id, kind: f.kind, title: f.title, size_bytes: f.size_bytes, mime: f.mime, type_label: CLIENT_FILE_MIMES[f.mime] || null, uploaded_by: f.uploaded_by, uploaded_at: f.uploaded_at, archived_at: f.archived_at });

// A file's workspace is its employer's: an id from another workspace is "not found", never "forbidden".
async function employerOr404(supabase, businessId, id) {
  if (!UUID.test(id || '')) throw err(404, 'employer not found');
  const row = must(await supabase.from('sales_opportunities').select('id, organization').eq('business_id', businessId).eq('id', id).is('archived_at', null).maybeSingle());
  if (!row) throw err(404, 'employer not found');
  return row;
}
async function fileOr404(supabase, businessId, id) {
  if (!UUID.test(id || '')) throw err(404, 'file not found');
  const f = must(await supabase.from('sales_client_files').select(COLS).eq('business_id', businessId).eq('id', id).maybeSingle());
  if (!f) throw err(404, 'file not found');
  return f;
}

export function validateMeta(body = {}, { needSize = false } = {}) {
  if (!CLIENT_FILE_KINDS.includes(body.kind)) return `kind must be one of ${CLIENT_FILE_KINDS.join('|')}`;
  const title = typeof body.title === 'string' ? body.title.trim().replace(/\s+/g, ' ') : '';
  if (!title || title.length > 160) return 'title must be 1-160 characters';
  if (hasPii(title)) return "title can't hold an email address or phone number";
  if (needSize) {
    if (!CLIENT_FILE_MIMES[body.mime]) return `only ${Object.values(CLIENT_FILE_MIMES).join(' / ')} files`;
    if (!Number.isInteger(body.size_bytes) || body.size_bytes <= 0) return 'size_bytes must be the file size';
    if (body.size_bytes > CLIENT_FILE_MAX_BYTES) return `files must be ${CLIENT_FILE_MAX_BYTES / 1024 / 1024} MB or smaller`;
  }
  return null;
}

// POST /goals/clients/:id/files/upload-url { kind, title, mime, size_bytes } -> { file_id, path, upload_url, token }
export async function uploadUrl(supabase, { businessId, id, body = {} }) {
  try {
    const bad = validateMeta(body, { needSize: true });
    if (bad) return reply(400, { error: bad });
    await employerOr404(supabase, businessId, id);
    const fileId = randomUUID();
    const path = pathOf(businessId, id, fileId);
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error) throw err(500, error.message);
    return reply(200, { file_id: fileId, path, upload_url: data.signedUrl, token: data.token });
  } catch (e) { return caught('upload-url', e); }
}

// POST /goals/clients/:id/files { file_id, kind, title } -> 201 { file }. Refused when the object isn't in storage,
// or its real size / type isn't allowed (whatever the upload-url call claimed).
export async function recordFile(supabase, { businessId, userId, id, body = {}, now = new Date() }) {
  try {
    const bad = validateMeta(body);
    if (bad) return reply(400, { error: bad });
    if (!UUID.test(body.file_id || '')) return reply(400, { error: 'file_id is required' });
    const emp = await employerOr404(supabase, businessId, id);
    const path = pathOf(businessId, id, body.file_id);
    const { data: listed, error } = await supabase.storage.from(BUCKET).list(`${businessId}/${id}`, { search: body.file_id, limit: 10 });
    if (error) throw err(500, error.message);
    const obj = (listed || []).find(o => o.name === body.file_id);
    if (!obj) return reply(409, { error: 'the upload is not in storage - upload it again' });
    const size = Number(obj.metadata?.size), mime = obj.metadata?.mimetype;
    if (!CLIENT_FILE_MIMES[mime]) return reply(400, { error: `only ${Object.values(CLIENT_FILE_MIMES).join(' / ')} files` });
    if (!(size > 0) || size > CLIENT_FILE_MAX_BYTES) return reply(400, { error: `files must be ${CLIENT_FILE_MAX_BYTES / 1024 / 1024} MB or smaller` });
    const existing = must(await supabase.from('sales_client_files').select(COLS).eq('business_id', businessId).eq('storage_path', path).maybeSingle());
    if (existing) return reply(200, { file: publicFile(existing) });
    const f = must(await supabase.from('sales_client_files').insert({
      id: body.file_id, business_id: businessId, opportunity_id: id, kind: body.kind, title: body.title.trim().replace(/\s+/g, ' '),
      storage_path: path, size_bytes: size, mime, uploaded_by: userId, uploaded_at: now.toISOString(),
    }).select(COLS).single());
    must(await supabase.from('sales_client_events').insert({ business_id: businessId, opportunity_id: emp.id, kind: 'file_added', by_user: userId, via: 'panel', meta: { file_id: f.id, kind: f.kind }, at: now.toISOString() }));
    return reply(201, { file: publicFile(f) });
  } catch (e) { return caught('record', e); }
}

// GET /goals/clients/:id/files[?archived=1] -> { files } newest first
export async function listFiles(supabase, { businessId, id, query = {} }) {
  try {
    await employerOr404(supabase, businessId, id);
    let q = supabase.from('sales_client_files').select(COLS).eq('business_id', businessId).eq('opportunity_id', id);
    if (query.archived !== '1') q = q.is('archived_at', null);
    return reply(200, { files: must(await q.order('uploaded_at', { ascending: false }).limit(200)).map(publicFile) });
  } catch (e) { return caught('list', e); }
}

// GET /goals/client-files/:id/url -> { url, expires_in } - a short-lived signed url (archived files open too).
export async function openFile(supabase, { businessId, id }) {
  try {
    const f = await fileOr404(supabase, businessId, id);
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(f.storage_path, OPEN_TTL_S);
    if (error) throw err(500, error.message);
    return reply(200, { url: data.signedUrl, expires_in: OPEN_TTL_S });
  } catch (e) { return caught('open', e); }
}

// POST /goals/client-files/:id/archive and /restore (its Undo) -> { file }. The object and the row are kept either way.
export async function setArchived(supabase, { businessId, userId, id, archived, now = new Date() }) {
  try {
    const f = await fileOr404(supabase, businessId, id);
    if (!!f.archived_at === archived) return reply(409, { error: archived ? 'already archived' : 'not archived' });
    const rows = must(await supabase.from('sales_client_files').update(archived ? { archived_at: now.toISOString(), archived_by: userId } : { archived_at: null, archived_by: null })
      .eq('business_id', businessId).eq('id', id).select(COLS));
    if (archived) must(await supabase.from('sales_client_events').insert({ business_id: businessId, opportunity_id: f.opportunity_id, kind: 'file_archived', by_user: userId, via: 'panel', meta: { file_id: f.id }, at: now.toISOString() }));
    return reply(200, { file: publicFile(rows[0]) });
  } catch (e) { return caught(archived ? 'archive' : 'restore', e); }
}

const ctx = req => ({ businessId: req.params.businessId, userId: req.auth.user.id, id: req.params.id, body: req.body || {}, query: req.query || {} });
export async function uploadUrlRoute(req, res) { send(res, await uploadUrl(getSupabase(), ctx(req))); }
export async function recordFileRoute(req, res) { send(res, await recordFile(getSupabase(), ctx(req))); }
export async function listFilesRoute(req, res) { send(res, await listFiles(getSupabase(), ctx(req))); }
export async function openFileRoute(req, res) { send(res, await openFile(getSupabase(), ctx(req))); }
export async function archiveFileRoute(req, res) { send(res, await setArchived(getSupabase(), { ...ctx(req), archived: true })); }
export async function restoreFileRoute(req, res) { send(res, await setArchived(getSupabase(), { ...ctx(req), archived: false })); }

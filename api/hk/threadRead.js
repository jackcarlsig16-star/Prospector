// grow-mailbox-link-v1 L5 - reading the deal facts: for linked threads Grow may act on (autoOk: domain / contact / manual,
// state linked) whose last message is within READ_DAYS and whose message count moved since the last read, fetch the
// thread (format full, the member's OWN grant, in memory only), keep the last LAST_N messages, cut quoted history and
// signatures, scrub addresses / phones, and make ONE STANDARD call (no web search, max_tokens 400) -> { deal_stage,
// deal_month, deal_amount_usd, our_question_open, waiting_on, summary }. Only those derived fields are stored; the text
// is dropped. Caps per workspace and Chicago day (Jack, Oct 31): DAILY_THREADS threads and DAILY_USD, except the one-time
// first pass (no thread-read run before today) which may spend FIRST_PASS_USD. Re-read before every call. Switch:
// hk_settings.read_deal_emails. Every run is an hk_job_runs row (job thread-read; a cron run claims its hour's slot);
// every call logs business_anthropic_usage (call_type hk_thread_read).
import { MODELS, estimateCostUsd } from '../../src/config/models.js';
import { GmailError, GMAIL_UNITS } from './gmailClient.js';
import { deps0 } from './gmailRoutes.js';
import { partsOf } from './inboxRules.js';
import { hasPii } from './hkShared.js';
import { dayIn, cronSlot, slotTaken, SLOT_TAKEN } from './jobs/plan.js';
import { READ_DAYS, autoOk, linkingStarted } from './threadLinks.js';
import { scrubAddresses, cleanText } from '../sales/scrubText.js';

export const READ_JOB = 'thread-read', READ_CALL_TYPE = 'hk_thread_read';
export const DAILY_THREADS = 60, DAILY_USD = 2, FIRST_PASS_USD = 3; // REVISABLE (Jack, Oct 31)
export const LAST_N = 6, MESSAGE_CHARS = 1500, MAX_TOKENS = 400;
const DEAL_STAGES = ['interested', 'discussing', 'confirmed', 'declined', 'scheduling', 'other'];
const WAITING = ['them', 'us', 'none'];

// A message body down to what the person wrote this time: quoted history ("On … wrote:", "> " lines, Outlook's
// "From: … Sent:" block) and the signature ("-- ") cut, addresses and phones replaced, capped.
export function ownWords(text) {
  let t = String(text || '').replace(/\r/g, '');
  for (const re of [/^On .{0,200}wrote:\s*$/m, /^-{2,}\s*Original Message\s*-{2,}/mi, /^From: .+\n(?:.*\n){0,3}?Sent: /m, /^--\s*$/m]) { const i = t.search(re); if (i >= 0) t = t.slice(0, i); }
  t = t.split('\n').filter(l => !/^\s*>/.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return scrubAddresses(t).slice(0, MESSAGE_CHARS);
}
const htmlText = h => String(h || '').replace(/<(br|\/p|\/div)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ');
const hdr = (m, n) => (m.payload?.headers || []).find(x => x.name.toLowerCase() === n.toLowerCase())?.value || '';

// A full-format thread -> the last LAST_N messages as "Us" / "Them" turns, each with its date and own words.
export function threadTurns(thread, { ownEmails = [], ownDomains = [] } = {}) {
  const own = new Set(ownEmails.map(e => e.toLowerCase())), ownD = new Set(ownDomains.map(d => d.toLowerCase()));
  return (thread?.messages || []).slice(-LAST_N).map(m => {
    const from = (/<([^>]+)>/.exec(hdr(m, 'From'))?.[1] || hdr(m, 'From')).trim().toLowerCase();
    const ours = own.has(from) || ownD.has(from.split('@')[1]);
    const p = partsOf(m.payload);
    const d = Date.parse(hdr(m, 'Date')) || Number(m.internalDate) || null;
    return { who: ours ? 'Us' : 'Them', date: d ? new Date(d).toISOString().slice(0, 10) : null, text: ownWords(p.text ?? htmlText(p.html)) };
  });
}

export function readPrompt({ brandName, turns, today }) {
  const system = [
    'You read one email thread between HumanKind (a Chicago wellness app whose sponsors fund community challenges; "Us") and a brand ("Them").',
    'Return ONLY a JSON object: {"deal_stage": one of interested|discussing|confirmed|declined|scheduling|other|null, "deal_month": "YYYY-MM" or null,',
    '"deal_amount_usd": number or null, "our_question_open": true|false, "waiting_on": "them"|"us"|"none", "summary": string up to 160 characters}.',
    'deal_stage "interested" ONLY when Them wrote words showing interest; when only Us wrote (our outreach, no reply) use "other" and a summary that starts "No reply yet".',
    'deal_month = the sponsorship month being discussed or agreed; deal_amount_usd = the dollar amount discussed or agreed. our_question_open = we asked',
    'something they have not answered. waiting_on = who owes the next reply. summary = plain words, no names of people, no email addresses or phone numbers.',
    `Today is ${today}. Use null when the thread does not say.`,
  ].join(' ');
  const user = `Brand: ${brandName}\n\n${turns.map(t => `[${t.who} · ${t.date || 'undated'}]\n${t.text || '(no text)'}`).join('\n\n')}`;
  return { system, user };
}

// The model's answer -> the stored fields, every value checked; anything off is dropped (null), never guessed.
export function parseFacts(text) {
  const m = /\{[\s\S]*\}/.exec(String(text || ''));
  let j = {}; try { j = m ? JSON.parse(m[0]) : {}; } catch { j = {}; }
  const amount = Number(j.deal_amount_usd);
  const summary = typeof j.summary === 'string' ? cleanText(scrubAddresses(j.summary), 160) : null;
  return {
    deal_stage: DEAL_STAGES.includes(j.deal_stage) ? j.deal_stage : null,
    deal_month: typeof j.deal_month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(j.deal_month) ? j.deal_month : null,
    deal_amount_usd: j.deal_amount_usd != null && Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : null,
    our_question_open: j.our_question_open === true,
    waiting_on: WAITING.includes(j.waiting_on) ? j.waiting_on : null,
    summary: summary && !hasPii(summary) ? summary : null,
  };
}

// The day's reads so far + whether today is still the one-time first pass.
export async function readsToday(supabase, businessId, day) {
  const { data, error } = await supabase.from('hk_job_runs').select('chicago_day, counts').eq('business_id', businessId).eq('job', READ_JOB);
  if (error) throw new Error(error.message);
  const runs = data || [], today = runs.filter(r => String(r.chicago_day) === day);
  const firstPass = !runs.some(r => String(r.chicago_day) < day);
  return { calls: today.reduce((n, r) => n + (r.counts?.calls || 0), 0), spend: Math.round(today.reduce((n, r) => n + (r.counts?.cost_usd || 0), 0) * 1e6) / 1e6, cap_usd: firstPass ? FIRST_PASS_USD : DAILY_USD, first_pass: firstPass };
}

// -> { skipped } | { run, counts }
export async function readThreads({ businessId, trigger = 'manual', startedBy = null, d = {} }) {
  const D = deps0(d), now = D.now();
  const { data: settings } = await D.supabase.from('hk_settings').select('timezone, read_deal_emails').eq('business_id', businessId).maybeSingle();
  if (settings && settings.read_deal_emails === false) return { skipped: 'off' };
  if (!(await linkingStarted(D.supabase, businessId))) return { skipped: 'not started' };
  const tz = settings?.timezone || 'America/Chicago', day = dayIn(now, tz);
  const cur0 = await readsToday(D.supabase, businessId, day);
  if (cur0.calls >= DAILY_THREADS) return { skipped: 'daily count reached' };
  if (cur0.spend >= cur0.cap_usd) return { skipped: 'dollar cap reached' };
  const since = new Date(now.getTime() - READ_DAYS * 864e5).toISOString();
  const { data: rows, error: e0 } = await D.supabase.from('hk_brand_threads').select('*').eq('business_id', businessId).eq('link_state', 'linked').gte('last_at', since).order('last_at', { ascending: false });
  if (e0) throw new Error(e0.message);
  const queue = (rows || []).filter(r => autoOk(r) && r.read_message_count !== r.message_count);
  const { data: run, error } = await D.supabase.from('hk_job_runs').insert({ business_id: businessId, job: READ_JOB, trigger, chicago_day: day, started_at: now.toISOString(), status: 'running', started_by: startedBy, ...(trigger === 'cron' ? { cron_slot: cronSlot(READ_JOB, now, tz) } : {}) }).select().single();
  if (error) { if (slotTaken(error)) return { skipped: SLOT_TAKEN }; throw new Error(error.message); }
  const counts = { queued: queue.length, calls: 0, read: 0, cost_usd: 0, gmail_units: 0, no_mailbox: 0, gone: 0, first_pass: cur0.first_pass, stopped: null };
  const { data: names } = await D.supabase.from('hk_brands').select('id, name').eq('business_id', businessId).in('id', [...new Set(queue.map(r => r.brand_id))]);
  const nameOf = Object.fromEntries((names || []).map(b => [b.id, b.name]));
  const tokens = new Map();
  const tokenOf = async uid => {
    if (!tokens.has(uid)) { const m = await D.mailbox(businessId, uid, 'inbox').catch(() => null) || await D.mailbox(businessId, uid, 'drafts').catch(() => null); tokens.set(uid, m ? { m, token: await D.tokenForGrant(m.grant, 'gmail').catch(() => null) } : null); }
    return tokens.get(uid);
  };
  let status = 'ok', err = null;
  for (const row of queue) {
    try {
      const cur = await readsToday(D.supabase, businessId, day);
      if (cur.calls >= DAILY_THREADS) { counts.stopped = 'daily count'; break; }
      if (cur.spend >= cur.cap_usd) { counts.stopped = 'dollar cap'; break; }
      const t = await tokenOf(row.member_user_id);
      if (!t?.token) { counts.no_mailbox++; continue; }
      counts.gmail_units += GMAIL_UNITS['threads.get.full'];
      const thread = await D.gmail.getThreadFull(t.token, row.gmail_thread_id).catch(e => { if (e instanceof GmailError && e.status === 404) return null; throw e; });
      if (!thread) { counts.gone++; continue; }
      const ownEmails = [t.m.grant.google_email].filter(Boolean);
      const turns = threadTurns(thread, { ownEmails, ownDomains: ownEmails.map(e => e.split('@')[1]) });
      const { system, user } = readPrompt({ brandName: nameOf[row.brand_id] || 'the brand', turns, today: day });
      const model = MODELS.STANDARD;
      const data = await D.call({ system, messages: [{ role: 'user', content: user }], max_tokens: MAX_TOKENS, thinking: false, model, timeoutMs: 60000, supabase: D.supabase, businessId, userId: row.member_user_id, callType: READ_CALL_TYPE });
      const cost = Math.round((estimateCostUsd(model, data?.usage) ?? 0) * 1e6) / 1e6;
      counts.calls++; counts.cost_usd = Math.round((counts.cost_usd + cost) * 1e6) / 1e6;
      const facts = parseFacts((data?.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n'));
      if (facts.deal_stage === 'interested' && !turns.some(t => t.who === 'Them')) { facts.deal_stage = 'other'; if (!facts.summary || !/^No reply yet/i.test(facts.summary)) facts.summary = 'No reply yet.'; }
      const { error: e1 } = await D.supabase.from('hk_brand_threads').update({ ...facts, waiting_on: facts.waiting_on || row.waiting_on, read_at: D.now().toISOString(), read_message_count: row.message_count, updated_at: D.now().toISOString() }).eq('id', row.id);
      if (e1) throw new Error(e1.message);
      counts.read++;
      const { error: e2 } = await D.supabase.from('hk_job_runs').update({ counts }).eq('id', run.id);
      if (e2) throw new Error(e2.message);
    } catch (e) { status = counts.calls ? 'partial' : 'error'; err = scrubAddresses(String(e.message || e)).slice(0, 200); counts.stopped = 'error'; break; }
  }
  const { data: done, error: e3 } = await D.supabase.from('hk_job_runs').update({ finished_at: D.now().toISOString(), status, counts, error: err }).eq('id', run.id).select().single();
  if (e3) throw new Error(e3.message);
  return { run: done, counts };
}

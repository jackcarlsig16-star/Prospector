import { cleanText } from '../scrubText.js';

// homelover-team-emails-v1 T3 - HomeLover's own scheduler (shares nothing with any other workspace's). A tick each
// minute reads the America/Los_Angeles wall clock, so 07:00 means 07:00 LA on both sides of a DST change. A timed job's
// slot is "<LA date> <HH:MM>"; it is due from that minute until CATCHUP_MIN later (a restart or a sleep catches up), and
// it runs only after its sales_job_slots row is inserted - the primary key turns a second instance or a second tick
// into a 23505, so a slot never runs twice. Poll jobs (no at:) run every tick and claim their own work.
// FIX visitor-email-top10-v1 V3a / V3c: a job may set its own catchup_min; once a timed slot's window has closed with no
// row, the tick writes one 'error' row { missed, reason } (the primary key keeps it to one; a per-client set keeps the
// insert from repeating every minute) so Needs attention can say "missed". schedulerState = this process's boot time
// and last tick, for Settings › Team emails.
export const CATCHUP_MIN = 120;
export const MISSED_REASON = 'no scheduler tick between the slot time and the end of its catch-up window (the process was down or asleep)';
export const schedulerState = { boot_at: null, last_tick_at: null, last_tick_ran: 0 };
const catchupOf = j => j.catchup_min ?? CATCHUP_MIN;
const marked = new WeakMap(); // supabase client -> Set of job|scope|slot already written as missed
export const WEEKDAYS = [1, 2, 3, 4, 5];
export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' });

export function laClock(now = Date.now()) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(now)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, minutes: Number(p.hour) * 60 + Number(p.minute), dow: DOW[p.weekday] };
}
const minutesOf = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };

// The timed jobs due at this instant: [{ job, slot }].
export function dueSlots(jobs, now = Date.now()) {
  const c = laClock(now);
  return jobs.filter(j => j.at && j.days.includes(c.dow) && c.minutes >= minutesOf(j.at) && c.minutes - minutesOf(j.at) < catchupOf(j))
    .map(j => ({ job: j, slot: `${c.date} ${j.at}` }));
}
// The timed jobs whose window closed earlier today: [{ job, slot }].
export function missedSlots(jobs, now = Date.now()) {
  const c = laClock(now);
  return jobs.filter(j => j.at && j.days.includes(c.dow) && c.minutes - minutesOf(j.at) >= catchupOf(j)).map(j => ({ job: j, slot: `${c.date} ${j.at}` }));
}
async function markMissed(supabase, jobs, scopes, now, log) {
  const done = marked.get(supabase) || marked.set(supabase, new Set()).get(supabase);
  for (const { job, slot } of missedSlots(jobs, now)) {
    for (const scope of await scopes(job)) {
      const key = `${job.name}|${scope}|${slot}`;
      if (done.has(key)) continue;
      done.add(key);
      const r = await supabase.from('sales_job_slots').insert({ job: job.name, scope, slot, status: 'error', detail: { missed: true, reason: MISSED_REASON }, finished_at: new Date(now).toISOString() }).select('job');
      if (r.error && r.error.code !== '23505') throw new Error(r.error.message);
      if (!r.error) log(`[scheduler] ${job.name} ${slot} missed`);
    }
  }
}

// true = this caller owns the slot; false = someone already does.
export async function claimSlot(supabase, job, scope, slot) {
  const r = await supabase.from('sales_job_slots').insert({ job, scope, slot, status: 'running' }).select('job');
  if (r.error?.code === '23505') return false;
  if (r.error) throw new Error(r.error.message);
  return true;
}
const finishSlot = (supabase, job, scope, slot, status, detail) =>
  supabase.from('sales_job_slots').update({ status, detail, finished_at: new Date().toISOString() }).eq('job', job).eq('scope', scope).eq('slot', slot);

// One tick. scopes(job) -> the scopes it runs for this tick (['all'] or the workspaces that get team emails).
export async function tick(supabase, { jobs, scopes, now = Date.now(), log = console.log }) {
  const ran = [];
  for (const { job, slot } of dueSlots(jobs, now)) {
    for (const scope of await scopes(job)) {
      if (!(await claimSlot(supabase, job.name, scope, slot))) continue;
      try {
        const detail = await job.run({ supabase, scope, slot, now });
        await finishSlot(supabase, job.name, scope, slot, 'ok', detail ?? null);
        ran.push({ job: job.name, scope, slot, status: 'ok' });
        log(`[scheduler] ${job.name} ${slot} ok`);
      } catch (e) {
        const message = cleanText(String(e.message || e), 200);
        await finishSlot(supabase, job.name, scope, slot, 'error', { error: message });
        ran.push({ job: job.name, scope, slot, status: 'error' });
        log(`[scheduler] ${job.name} ${slot} failed: ${message}`);
      }
    }
  }
  await markMissed(supabase, jobs, scopes, now, log);
  for (const job of jobs.filter(j => !j.at)) {
    for (const scope of await scopes(job)) {
      try { await job.run({ supabase, scope, now }); }
      catch (e) { log(`[scheduler] ${job.name} failed: ${cleanText(String(e.message || e), 200)}`); }
    }
  }
  schedulerState.last_tick_at = new Date(now).toISOString();
  schedulerState.last_tick_ran = ran.length;
  return ran;
}

// Ticks at startup (the catch-up) and then on every LA minute boundary. Overlapping ticks are skipped, not queued.
export function startScheduler(supabase, { jobs, scopes, log = console.log }) {
  schedulerState.boot_at = new Date().toISOString();
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try { await tick(supabase, { jobs, scopes, log }); }
    catch (e) { log(`[scheduler] tick failed: ${cleanText(String(e.message || e), 200)}`); }
    finally { busy = false; }
  };
  run();
  let interval = null;
  const first = setTimeout(() => { run(); interval = setInterval(run, 60e3); }, 60e3 - (Date.now() % 60e3) + 1e3);
  return () => { clearTimeout(first); if (interval) clearInterval(interval); };
}

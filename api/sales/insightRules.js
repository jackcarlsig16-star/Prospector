import { laDateString } from './laDate.js';
import { weekStartOf, addDays } from './emailCounts.js';
import { isBotOpen } from './heatScore.js';
import { mailboxConnectionProblem } from '../../src/utils/mailboxStatus.js';
import { selectAllPages } from '../lib/selectAllPages.js';

// sales-email-trend-v1 REV2 Stage 4 - the ONE insight rules file.
// Deterministic only, no AI text. Every rule states its evidence (numbers +
// window), a "likely"/"possible" cause, an action, and the items it's
// about. A rule whose sample is below its minimum is suppressed and listed
// under "not enough data" instead of guessing. All thresholds REVISABLE.
//
// Rates are % of SENT (sent = delivered + hard bounced + spam blocked),
// the definition that reconciles exactly with Apollo's weekly numbers.
// "Hard bounce" is list quality (R1); "spam block" is reputation (R2) -
// Apollo's own "Bounce %" adds the two together.

export const T = {
  R1_HARD_BOUNCE: 0.05, R1_MIN_SENT: 50,
  R2_SPAM_BLOCK: 0.02, R2_MIN_SENT: 50, R2_WINDOW_DAYS: 14,
  R3_OPEN_DROP: 0.5, R3_MIN_SENT: 200,
  R4_WINDOW_DAYS: 14, R4_MIN_SENT: 200,
  R5_VOLUME_DROP: 0.4, R5_MIN_SENT: 50,
  // SPEC said "averaging MORE than its daily cap", which can never happen -
  // Apollo stops a mailbox at its cap (jack@ ran 47-50/day on a cap of 50).
  // So "at capacity" = weekday average >= 90% of the cap.
  DAILY_CAP_PER_MAILBOX: 50, R6_CAPACITY_RATIO: 0.9, R6_WINDOW_DAYS: 7, R6_MIN_DAYS: 3,
  // R7_MIN_OPENS is ours, not the SPEC's: 30 delivered alone let "1 open vs
  // 0" fire as step fatigue, which is noise.
  R7_STEP_DROP: 0.5, R7_MIN_DELIVERED: 30, R7_MIN_OPENS: 5,
  R8_REPLY_RATIO: 0.5, R8_MIN_DELIVERED: 100,
  R9_BOT_SHARE: 0.4, R9_MIN_OPENS: 30,
  GREEN: 0.02, R10_MIN_SENT: 50,
};

const SEVERITY_ORDER = { bad: 0, warn: 1, info: 2 };

function pct(n, d, digits = 1) {
  return d > 0 ? `${((n / d) * 100).toFixed(digits)}%` : '—';
}

function totals(rows) {
  const t = { delivered: 0, hard_bounced: 0, spam_blocked: 0, opened: 0, clicked: 0, replied: 0 };
  for (const r of rows) for (const k of Object.keys(t)) t[k] += r[k];
  t.sent = t.delivered + t.hard_bounced + t.spam_blocked;
  return t;
}

function weekLabel(ws) {
  return `week of ${new Date(`${ws}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
}

// input: { today, counts, sequences, mailboxes, openEvents }
//   counts     - sales_email_daily_counts rows (day x mailbox x sequence x step)
//   sequences  - latest sequences snapshot (Apollo lifetime totals)
//   mailboxes  - entities-shaped mailbox rows (with snapshot_at)
//   openEvents - sales_email_activity open events + their delivered_at
// Returns { fired, suppressed } - pure, no I/O, so it can run on a mock.
export function computeInsights({ today, counts, sequences, mailboxes, openEvents }) {
  const fired = [];
  const suppressed = [];
  const thisWeek = weekStartOf(today);
  const fullWeeks = [1, 2, 3, 4].map(n => addDays(thisWeek, -7 * n)); // newest first
  const inWeek = ws => counts.filter(r => r.day >= ws && r.day <= addDays(ws, 6));
  const inLastDays = n => counts.filter(r => r.day >= addDays(today, -n) && r.day < today);
  const activeSeqs = sequences.filter(s => s.active && !s.archived);
  const seqSent = s => (s.unique_delivered || 0) + (s.unique_bounced || 0);

  // R1 - list quality, per active sequence (lifetime) and per full week.
  for (const s of activeSeqs) {
    const sent = seqSent(s);
    const hard = s.unique_hard_bounced || 0;
    if (sent < T.R1_MIN_SENT) { suppressed.push(`R1 list quality: ${s.name} (${sent} sent, needs ${T.R1_MIN_SENT})`); continue; }
    if (hard / sent > T.R1_HARD_BOUNCE) {
      fired.push({
        id: 'R1', scope_key: s.id, severity: 'bad',
        title: `${s.cohort || 'Sequence'}: likely bad or outdated contact data`,
        evidence: `Hard bounce ${pct(hard, sent)} (${hard} / ${sent} sent) · ${s.name} · lifetime (Apollo totals)`,
        cause: 'Likely bad or outdated contact data in this list.',
        action: 'Verify the list before resuming, and consider pausing the sequence.',
        affected: [{ type: 'sequence', id: s.id, label: s.name }],
      });
    }
  }
  for (const ws of fullWeeks.slice(0, 1)) {
    const t = totals(inWeek(ws));
    if (t.sent < T.R1_MIN_SENT) { suppressed.push(`R1 list quality: ${weekLabel(ws)} (${t.sent} sent)`); continue; }
    if (t.hard_bounced / t.sent > T.R1_HARD_BOUNCE) {
      fired.push({
        id: 'R1', scope_key: `week:${ws}`, severity: 'bad', title: `Hard bounces high in the ${weekLabel(ws)}`,
        evidence: `Hard bounce ${pct(t.hard_bounced, t.sent)} (${t.hard_bounced} / ${t.sent} sent) · ${weekLabel(ws)}, by send date`,
        cause: 'Likely bad or outdated contact data in what was sent that week.',
        action: 'Verify the lists that went out that week before sending more.',
        affected: [{ type: 'week', id: ws, label: weekLabel(ws) }],
      });
    }
  }

  // R2 - sender reputation, per mailbox over the last 14 days.
  const r2Rows = inLastDays(T.R2_WINDOW_DAYS);
  for (const mailbox of [...new Set(r2Rows.map(r => r.mailbox))].sort()) {
    const t = totals(r2Rows.filter(r => r.mailbox === mailbox));
    if (t.sent < T.R2_MIN_SENT) { suppressed.push(`R2 reputation: ${mailbox} (${t.sent} sent in ${T.R2_WINDOW_DAYS}d)`); continue; }
    if (t.spam_blocked / t.sent > T.R2_SPAM_BLOCK) {
      fired.push({
        id: 'R2', scope_key: mailbox, severity: 'bad', title: `${mailbox}: spam blocks above ${pct(T.R2_SPAM_BLOCK, 1, 0)}`,
        evidence: `Spam block ${pct(t.spam_blocked, t.sent)} (${t.spam_blocked} / ${t.sent} sent) · last ${T.R2_WINDOW_DAYS} days`,
        cause: 'Likely domain/mailbox reputation, or sending without warmup.',
        action: 'Keep warmup on, check SPF/DKIM/DMARC, and lower daily volume on this mailbox.',
        affected: [{ type: 'mailbox', id: mailbox, label: mailbox }],
      });
    }
  }

  // R3 - hidden spam placement: last full week vs the 2 before it.
  {
    const last = totals(inWeek(fullWeeks[0]));
    const prior = totals([...inWeek(fullWeeks[1]), ...inWeek(fullWeeks[2])]);
    if (last.sent < T.R3_MIN_SENT || prior.sent < T.R3_MIN_SENT) {
      suppressed.push(`R3 hidden spam: ${weekLabel(fullWeeks[0])} vs 2 prior (${last.sent} / ${prior.sent} sent, needs ${T.R3_MIN_SENT} each)`);
    } else {
      const rate = (t, k) => t[k] / t.sent;
      const bounceFalling = rate(last, 'hard_bounced') + rate(last, 'spam_blocked') < rate(prior, 'hard_bounced') + rate(prior, 'spam_blocked');
      const openDrop = rate(prior, 'opened') > 0 ? 1 - rate(last, 'opened') / rate(prior, 'opened') : 0;
      if (bounceFalling && openDrop >= T.R3_OPEN_DROP) {
        fired.push({
          id: 'R3', scope_key: `week:${fullWeeks[0]}`, severity: 'warn', title: 'Emails may be landing in spam even though “delivered”',
          evidence: `Open ${pct(last.opened, last.sent)} in the ${weekLabel(fullWeeks[0])} vs ${pct(prior.opened, prior.sent)} the 2 weeks before (−${Math.round(openDrop * 100)}%), while bounce + spam block fell to ${pct(last.hard_bounced + last.spam_blocked, last.sent)}`,
          cause: 'Possible spam-folder placement: fewer outright blocks, but fewer people seeing the email.',
          action: 'Run a seed / inbox-placement test, keep warmup on, and check the copy for spam triggers.',
          affected: [{ type: 'week', id: fullWeeks[0], label: weekLabel(fullWeeks[0]) }],
        });
      }
    }
  }

  // R4 - engagement drought: no replies in the last 14 days.
  {
    const t = totals(inLastDays(T.R4_WINDOW_DAYS));
    if (t.sent < T.R4_MIN_SENT) {
      suppressed.push(`R4 engagement drought: last ${T.R4_WINDOW_DAYS} days (${t.sent} sent, needs ${T.R4_MIN_SENT})`);
    } else if (t.replied === 0) {
      const best = activeSeqs.filter(s => (s.unique_delivered || 0) >= T.R8_MIN_DELIVERED)
        .sort((a, b) => (b.unique_replied / b.unique_delivered) - (a.unique_replied / a.unique_delivered))[0];
      fired.push({
        id: 'R4', scope_key: '', severity: 'warn', title: `No replies in the last ${T.R4_WINDOW_DAYS} days`,
        evidence: `0 replies across ${t.sent} sent · last ${T.R4_WINDOW_DAYS} days, by send date`,
        cause: 'Likely the messaging or targeting isn’t landing.',
        action: best
          ? `Review copy and personas. Best contrast: ${best.name} (${pct(best.unique_replied, best.unique_delivered)} reply rate lifetime).`
          : 'Review copy and personas.',
        affected: best ? [{ type: 'sequence', id: best.id, label: `Best: ${best.name}` }] : [],
      });
    }
  }

  // R5 - sending stopped/dropped: week-over-week volume, or a mailbox with
  // a real connection problem (src/utils/mailboxStatus.js - Apollo's error
  // fields alone are stale history).
  {
    const last = totals(inWeek(fullWeeks[0]));
    const prev = totals(inWeek(fullWeeks[1]));
    if (prev.sent < T.R5_MIN_SENT) {
      suppressed.push(`R5 volume drop: ${weekLabel(fullWeeks[1])} (${prev.sent} sent)`);
    } else if (1 - last.sent / prev.sent >= T.R5_VOLUME_DROP) {
      fired.push({
        id: 'R5', scope_key: `week:${fullWeeks[0]}`, severity: 'bad', title: 'Sends may have stalled',
        evidence: `${last.sent} sent in the ${weekLabel(fullWeeks[0])} vs ${prev.sent} the week before (−${Math.round((1 - last.sent / prev.sent) * 100)}%)`,
        cause: 'Possible paused sequences or a disconnected mailbox.',
        action: 'Reconnect any mailbox showing a problem and check sequence status in Apollo.',
        affected: [{ type: 'week', id: fullWeeks[0], label: weekLabel(fullWeeks[0]) }],
      });
    }
    for (const m of mailboxes) {
      const problem = mailboxConnectionProblem(m);
      if (!problem) continue;
      fired.push({
        id: 'R5', scope_key: m.email, severity: 'bad', title: `${m.email}: sends may have stalled`,
        evidence: `${problem} · as of last sync${m.last_synced_at ? ` (Apollo last synced ${m.last_synced_at.slice(0, 10)})` : ''}`,
        cause: 'Likely a disconnected or deactivated mailbox.',
        action: 'Reconnect the mailbox in Apollo, then Sync now to confirm.',
        affected: [{ type: 'mailbox', id: m.email, label: m.email }],
      });
    }
  }

  // R6 - capacity, weekday average over the last 7 full days.
  {
    const rows = inLastDays(T.R6_WINDOW_DAYS).filter(r => {
      const dow = new Date(`${r.day}T12:00:00Z`).getUTCDay();
      return dow >= 1 && dow <= 5;
    });
    for (const m of mailboxes) {
      const byDay = new Map();
      for (const r of rows.filter(x => x.mailbox === m.email)) byDay.set(r.day, (byDay.get(r.day) || 0) + r.delivered + r.hard_bounced + r.spam_blocked);
      const days = [...byDay.values()];
      if (days.length < T.R6_MIN_DAYS) { suppressed.push(`R6 capacity: ${m.email} (${days.length} weekday(s) with sends)`); continue; }
      const cap = m.email_daily_threshold || T.DAILY_CAP_PER_MAILBOX;
      const avg = days.reduce((a, b) => a + b, 0) / days.length;
      if (avg >= cap * T.R6_CAPACITY_RATIO) {
        fired.push({
          id: 'R6', scope_key: m.email, severity: 'warn', title: `${m.email}: at capacity`,
          evidence: `${avg.toFixed(1)} sent per weekday on a cap of ${cap} (${Math.round((avg / cap) * 100)}%) · last ${T.R6_WINDOW_DAYS} days, ${days.length} weekdays`,
          cause: 'Mailbox at capacity; a deliverability risk if volume keeps pushing against the cap.',
          action: 'Add sending mailboxes, ideally on a secondary domain, before raising volume.',
          affected: [{ type: 'mailbox', id: m.email, label: m.email }],
        });
      }
    }
  }

  // R7 - step fatigue, per active sequence from per-step counts (all history).
  for (const s of activeSeqs) {
    const steps = new Map();
    for (const r of counts.filter(x => x.sequence_id === s.id && x.step > 0)) {
      const t = steps.get(r.step) || { delivered: 0, opened: 0 };
      t.delivered += r.delivered; t.opened += r.opened;
      steps.set(r.step, t);
    }
    const ordered = [...steps.entries()].sort((a, b) => a[0] - b[0]);
    for (let i = 0; i + 1 < ordered.length; i++) {
      const [n, a] = ordered[i];
      const [n2, b] = ordered[i + 1];
      if (n2 !== n + 1) continue;
      if (a.delivered < T.R7_MIN_DELIVERED || b.delivered < T.R7_MIN_DELIVERED || a.opened < T.R7_MIN_OPENS) {
        suppressed.push(`R7 step fatigue: ${s.name} step ${n}→${n2} (${a.delivered} / ${b.delivered} delivered, ${a.opened} opens at step ${n})`);
        continue;
      }
      const ra = a.opened / a.delivered;
      const rb = b.opened / b.delivered;
      if (ra > 0 && rb < ra * T.R7_STEP_DROP) {
        fired.push({
          id: 'R7', scope_key: `${s.id}:${n}`, severity: 'warn', title: `${s.cohort || 'Sequence'}: drop-off after step ${n}`,
          evidence: `Open ${pct(a.opened, a.delivered)} at step ${n} (${a.opened} / ${a.delivered}) vs ${pct(b.opened, b.delivered)} at step ${n2} (${b.opened} / ${b.delivered}) · ${s.name} · all history, by send date`,
          cause: `Possible fatigue at step ${n2} — partly also because later steps went out more recently and have had less time to collect opens.`,
          action: `Rework step ${n2} or shorten the cadence.`,
          affected: [{ type: 'sequence', id: s.id, label: s.name }],
        });
      }
    }
  }

  // R8 - outlier sequence vs the blended reply rate (lifetime).
  {
    const eligible = activeSeqs.filter(s => (s.unique_delivered || 0) >= T.R8_MIN_DELIVERED);
    for (const s of activeSeqs.filter(x => (x.unique_delivered || 0) < T.R8_MIN_DELIVERED)) {
      suppressed.push(`R8 outlier: ${s.name} (${s.unique_delivered || 0} delivered, needs ${T.R8_MIN_DELIVERED})`);
    }
    const repl = eligible.reduce((a, s) => a + (s.unique_replied || 0), 0);
    const deliv = eligible.reduce((a, s) => a + s.unique_delivered, 0);
    const blended = deliv ? repl / deliv : 0;
    if (eligible.length >= 2 && blended > 0) {
      const best = [...eligible].sort((a, b) => (b.unique_replied / b.unique_delivered) - (a.unique_replied / a.unique_delivered))[0];
      for (const s of eligible) {
        const r = (s.unique_replied || 0) / s.unique_delivered;
        if (r <= blended * T.R8_REPLY_RATIO && s.id !== best.id) {
          fired.push({
            id: 'R8', scope_key: s.id, severity: 'warn', title: `${s.cohort || 'Sequence'}: underperforming vs your other sequences`,
            evidence: `Reply ${pct(s.unique_replied || 0, s.unique_delivered, 2)} (${s.unique_replied || 0} / ${s.unique_delivered} delivered) vs blended ${pct(repl, deliv, 2)} · lifetime (Apollo totals)`,
            cause: 'Likely the copy or persona fit for this audience.',
            action: `Compare its copy and persona with ${best.name} (${pct(best.unique_replied, best.unique_delivered, 2)}).`,
            affected: [{ type: 'sequence', id: s.id, label: s.name }, { type: 'sequence', id: best.id, label: `Best: ${best.name}` }],
          });
        }
      }
    }
  }

  // R9 - bot-inflated opens (sales_email_activity, same test the huddle uses).
  {
    const bots = openEvents.filter(e => isBotOpen(e, e.delivered_at)).length;
    if (openEvents.length < T.R9_MIN_OPENS) {
      suppressed.push(`R9 bot opens: ${openEvents.length} open events (needs ${T.R9_MIN_OPENS})`);
    } else if (bots / openEvents.length >= T.R9_BOT_SHARE) {
      fired.push({
        id: 'R9', scope_key: '', severity: 'warn', title: 'Open rate is inflated by automated opens',
        evidence: `${bots} of ${openEvents.length} tracked opens (${pct(bots, openEvents.length, 0)}) look automated (fast open, scanner agent) · emails with signals, last 30 days`,
        cause: 'Likely corporate security scanners opening emails on delivery.',
        action: 'Trust replies and clicks over opens when judging a sequence.',
        affected: [],
      });
    }
  }

  // R10 - good news: a deliverability metric moved into the green.
  {
    const last = totals(inWeek(fullWeeks[0]));
    const prev = totals(inWeek(fullWeeks[1]));
    if (last.sent >= T.R10_MIN_SENT && prev.sent >= T.R10_MIN_SENT) {
      for (const [k, label] of [['hard_bounced', 'Hard bounce'], ['spam_blocked', 'Spam block']]) {
        const before = prev[k] / prev.sent;
        const now = last[k] / last.sent;
        if (before >= T.GREEN && now < T.GREEN) {
          fired.push({
            id: 'R10', scope_key: k, severity: 'info', title: `${label} is back in the green`,
            evidence: `${label} ${pct(last[k], last.sent)} in the ${weekLabel(fullWeeks[0])}, down from ${pct(prev[k], prev.sent)} the week before`,
            cause: 'Whatever changed between those weeks is working.',
            action: 'Keep it up; note what changed with “+ Add event” on the chart.',
            affected: [{ type: 'week', id: fullWeeks[0], label: weekLabel(fullWeeks[0]) }],
          });
        }
      }
    } else {
      suppressed.push(`R10 good news: last two full weeks (${last.sent} / ${prev.sent} sent)`);
    }
  }

  fired.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return { fired, suppressed };
}

// Everything computeInsights needs, from the DB only (zero Apollo calls).
export async function loadInsightInput(supabase, businessId) {
  const [counts, events, messages, seqSnap, mailSnap] = await Promise.all([
    selectAllPages(() => supabase.from('sales_email_daily_counts')
      .select('day,mailbox,sequence_id,step,delivered,hard_bounced,spam_blocked,opened,clicked,replied')
      .eq('business_id', businessId).order('day').order('mailbox').order('sequence_id').order('step')),
    selectAllPages(() => supabase.from('sales_email_activity')
      .select('apollo_message_id,occurred_at,user_agent,tracking_service')
      .eq('business_id', businessId).eq('event', 'open').order('id')),
    selectAllPages(() => supabase.from('sales_email_messages')
      .select('apollo_message_id,delivered_at').eq('business_id', businessId).order('apollo_message_id')),
    supabase.from('sales_raw_snapshots').select('payload').eq('business_id', businessId).eq('entity', 'sequences').order('captured_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('sales_raw_snapshots').select('payload,captured_at').eq('business_id', businessId).eq('entity', 'mailboxes').order('captured_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  for (const r of [seqSnap, mailSnap]) if (r.error) throw new Error(r.error.message);
  const deliveredAt = new Map(messages.map(m => [m.apollo_message_id, m.delivered_at]));
  return {
    today: laDateString(),
    counts,
    sequences: seqSnap.data?.payload || [],
    mailboxes: (mailSnap.data?.payload || []).map(m => ({ ...m, snapshot_at: mailSnap.data.captured_at })),
    openEvents: events.map(e => ({ ...e, delivered_at: deliveredAt.get(e.apollo_message_id) || null })),
  };
}

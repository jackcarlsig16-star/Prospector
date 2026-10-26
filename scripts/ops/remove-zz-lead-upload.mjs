// FIX verify-no-temp-workspace-v1 Stage 1 - one-off removal of the temp workspace "ZZ Lead Upload S3" that the
// lead-upload-v1-stage3 replay verify left on prod on 2026-10-26 (its teardown read a failed count as 0).
// Sanctioned by Jack's go (Oct 26, 3:00 PM PT). Scope: exactly ONE businesses row matched by name AND created date,
// its business_members rows, the temp profile(s) behind those members (email lu3-*@example.com only) and their auth
// users. NEVER auth_events (printed, left alone). Refuses when the match is not exactly one business, when any data
// table holds rows for it, or when a member's profile is not a lu3- temp profile. Prints BEFORE and AFTER counts.
// Usage: node scripts/ops/remove-zz-lead-upload.mjs            (dry run: BEFORE counts + plan, no writes)
//        node scripts/ops/remove-zz-lead-upload.mjs --apply    (the one sanctioned delete)
import { createRequire } from 'module';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const APPLY = process.argv.includes('--apply');
const NAME = 'ZZ Lead Upload S3';
const DAY = ['2026-10-26T00:00:00Z', '2026-10-27T00:00:00Z'];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const TEMP_EMAIL = /^lu3-[a-z0-9-]+@example\.com$/i;
// Every table with a business_id column that could hold rows for a workspace (sales_*, legacy, grants, runs).
const DATA_TABLES = ['sales_goals', 'sales_opportunities', 'sales_targets', 'sales_people', 'sales_lead_uploads', 'sales_source_events', 'sales_partner_events', 'sales_opportunity_events', 'sales_week_goals', 'sales_week_goal_steps', 'sales_week_plans', 'sales_week_notes', 'sales_week_report', 'sales_week_report_sections', 'sales_month_goals', 'sales_metric_targets', 'sales_metrics_daily', 'sales_call_notes', 'sales_suggestions', 'sales_signals', 'sales_tidy_runs', 'sales_sync_runs', 'sales_prospect_state', 'sales_prospect_events', 'sales_sequenced_accounts', 'sales_sequence_tags', 'sales_raw_snapshots', 'sales_email_messages', 'sales_email_activity', 'sales_email_daily_counts', 'sales_email_backfill_weeks', 'sales_events', 'sales_huddles', 'sales_infra_items', 'sales_insight_dismissals', 'sales_collateral', 'sales_cadence_plan', 'sales_mailbox_owners', 'sales_outreach_campaigns', 'sales_outreach_contacts', 'sales_outreach_events', 'sales_outreach_steps', 'sales_outreach_tracks', 'sales_visit_skip', 'partner_contacts', 'partner_domains', 'web_visits', 'visit_pull_runs', 'visit_priority_override', 'research_runs', 'apollo_credit_spend', 'business_anthropic_usage', 'business_intel_entries', 'business_profiles', 'accounts', 'lists', 'projects', 'campaigns', 'microsoft_sync_runs', 'microsoft_messages', 'microsoft_events', 'workspace_invites', 'plospect_compliance'];
const HL = ['sales_goals', 'sales_opportunities', 'sales_targets', 'sales_people', 'sales_lead_uploads', 'sales_source_events', 'sales_partner_events', 'partner_contacts', 'sales_week_goals', 'research_runs'];
const die = m => { console.log(`REFUSED: ${m}`); process.exit(2); };
const count = async (t, col, v) => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq(col, v); if (r.error) throw new Error(`${t}.${col} count failed: ${r.error.message}`); return r.count; };
const total = async t => { const r = await svc.from(t).select('*', { count: 'exact', head: true }); if (r.error) throw new Error(`${t} count failed: ${r.error.message}`); return r.count; };

async function block(label, biz, userIds) {
  const out = { businesses: biz ? await count('businesses', 'id', biz.id) : 0, business_members: biz ? await count('business_members', 'business_id', biz.id) : 0, profiles: 0, auth_events_by_business: biz ? await count('auth_events', 'business_id', biz.id) : 0, auth_events_by_user: 0, data: {} };
  for (const u of userIds) { out.profiles += await count('profiles', 'id', u); out.auth_events_by_user += await count('auth_events', 'user_id', u); out.auth_events_by_user += await count('auth_events', 'actor_id', u); }
  // A table without a business_id column answers with an error (sometimes an empty message); it is listed as skipped, never silently dropped.
  out.skipped = {};
  if (biz) for (const t of DATA_TABLES) { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', biz.id); if (r.error) out.skipped[t] = r.error.code || r.error.message || 'error'; else if (r.count > 0) out.data[t] = r.count; }
  const hl = {}; for (const t of HL) hl[t] = await count(t, 'business_id', HOMELOVER);
  out.homelover = hl; out.auth_events_total = await total('auth_events');
  console.log(`${label}: ${JSON.stringify(out)}`);
  return out;
}

const { data: matches, error } = await svc.from('businesses').select('id, name, created_at, features').eq('name', NAME).gte('created_at', DAY[0]).lt('created_at', DAY[1]);
if (error) die(`businesses lookup failed: ${error.message}`);
if (matches.length !== 1) die(`expected exactly 1 business named "${NAME}" created 2026-10-26, found ${matches.length}`);
const biz = matches[0];
const { data: members, error: mErr } = await svc.from('business_members').select('id, user_id, email, role').eq('business_id', biz.id);
if (mErr) die(`business_members lookup failed: ${mErr.message}`);
const userIds = [...new Set(members.map(m => m.user_id).filter(Boolean))];
const { data: profiles, error: pErr } = userIds.length ? await svc.from('profiles').select('id, email').in('id', userIds) : { data: [], error: null };
if (pErr) die(`profiles lookup failed: ${pErr.message}`);
for (const p of profiles) if (!TEMP_EMAIL.test(p.email || '')) die(`member profile ${p.id} is not a lu3- temp profile - not touching it`);
console.log(`match: ${biz.name} ${biz.id} created ${biz.created_at} features ${JSON.stringify(biz.features)} · members ${members.length} (${members.map(m => m.role).join(', ')}) · temp profiles ${profiles.length}`);

const before = await block('BEFORE', biz, userIds);
if (Object.keys(before.data).length) die(`data rows exist for this business: ${JSON.stringify(before.data)}`);
if (before.auth_events_by_business || before.auth_events_by_user) console.log(`note: ${before.auth_events_by_business + before.auth_events_by_user} auth_events rows reference it - they are LEFT ALONE (FKs are ON DELETE SET NULL)`);
if (!APPLY) { console.log('DRY RUN - nothing deleted. Plan: business_members -> businesses -> profiles (lu3- only) -> auth users. Re-run with --apply.'); process.exit(0); }

const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); };
must(await svc.from('business_members').delete().eq('business_id', biz.id), 'delete business_members');
must(await svc.from('businesses').delete().eq('id', biz.id), 'delete businesses');
for (const p of profiles) {
  must(await svc.from('profiles').delete().eq('id', p.id), `delete profile ${p.id}`);
  const { error: aErr } = await svc.auth.admin.deleteUser(p.id);
  if (aErr && !/not found/i.test(aErr.message)) throw new Error(`delete auth user ${p.id}: ${aErr.message}`);
}
const after = await block('AFTER', biz, userIds);
const clean = after.businesses === 0 && after.business_members === 0 && after.profiles === 0 && JSON.stringify(after.homelover) === JSON.stringify(before.homelover) && after.auth_events_total === before.auth_events_total;
console.log(`removed: ${clean ? 'yes' : 'NO'} · HomeLover counts ${JSON.stringify(after.homelover) === JSON.stringify(before.homelover) ? 'identical' : 'CHANGED'} · auth_events total ${before.auth_events_total} -> ${after.auth_events_total}`);
process.exit(clean ? 0 : 1);

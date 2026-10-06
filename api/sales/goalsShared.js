import { createClient } from '@supabase/supabase-js';

// sales-goals-v1 - helpers shared by goalsRoutes.js and goalsReportRoutes.js.
// Both are mounted under /api/sales/:businessId, so salesGate has already
// enforced the workspace (viewer reads, member writes). The tables carry
// member-scoped RLS too; these routes use the service key and re-check every
// id they're handed against the workspace.
export function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

export const SCORECARD_METRICS = ['outbound_audience', 'total_in_sequence', 'sequences_running', 'meetings_set', 'open_rate'];
export const KPI_METRICS = ['target_orgs', 'dm_contacted', 'positive_responses', 'meetings_held', 'qualified_opps',
  'covered_lives_pipeline', 'proposals_outstanding', 'verbal_commitments', 'contracts_signed', 'launches_90d'];
// Typed in by a member; everything else is computed from synced data.
export const MANUAL_METRICS = ['meetings_set', 'meetings_held'];
export const LINK_TARGETS = ['view:report', 'view:this_week', 'view:partners', 'view:companies',
  ...Array.from({ length: 14 }, (_, i) => `section:s${i + 1}`)];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = v => typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
export const isMonday = v => isDate(v) && new Date(`${v}T00:00:00Z`).getUTCDay() === 1;
export const isFirstOfMonth = v => isDate(v) && v.endsWith('-01');
export const addDays = (v, n) => new Date(Date.parse(`${v}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

// UTC instant of 00:00 America/Los_Angeles on date d (handles PST/PDT).
export function laStartOfDayMs(d) {
  const noon = new Date(`${d}T12:00:00Z`);
  const laHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(noon).find(p => p.type === 'hour').value);
  return Date.parse(`${d}T00:00:00Z`) + (12 - laHour) * 3600e3;
}

// Field kinds: text, required (non-empty text), int (>= 0), number (>= 0),
// date, monday, month, enum, nullableEnum, textArray, priority (1-3),
// member (workspace member's user id), ref (row of `table` in this
// workspace). Only required/enum/monday/month refuse null.
export async function validate(supabase, businessId, fields, body) {
  const payload = {};
  for (const [key, value] of Object.entries(body || {})) {
    const f = fields[key];
    if (!f) return { error: `unknown field: ${key}` };
    if (value === null) {
      if (['required', 'enum', 'monday', 'month', 'textArray'].includes(f.kind)) return { error: `${key} can't be null` };
      payload[key] = null;
      continue;
    }
    if ((f.kind === 'enum' || f.kind === 'nullableEnum') && !f.values.includes(value)) return { error: `bad enum: ${key} must be one of ${f.values.join('|')}` };
    if (f.kind === 'text' && typeof value !== 'string') return { error: `${key} must be a string or null` };
    if (f.kind === 'required' && (typeof value !== 'string' || !value.trim())) return { error: `${key} must be non-empty text` };
    if (f.kind === 'int' && !(Number.isInteger(value) && value >= 0)) return { error: `${key} must be a whole number >= 0 or null` };
    if (f.kind === 'number' && !(typeof value === 'number' && Number.isFinite(value) && value >= 0)) return { error: `${key} must be a number >= 0 or null` };
    if (f.kind === 'priority' && ![1, 2, 3].includes(value)) return { error: `${key} must be 1, 2, 3 or null` };
    if (f.kind === 'date' && !isDate(value)) return { error: `${key} must be a YYYY-MM-DD date or null` };
    if (f.kind === 'monday' && !isMonday(value)) return { error: `${key} must be a Monday (YYYY-MM-DD)` };
    if (f.kind === 'month' && !isFirstOfMonth(value)) return { error: `${key} must be the 1st of a month (YYYY-MM-01)` };
    if (f.kind === 'textArray' && !(Array.isArray(value) && value.length <= 20 && value.every(v => typeof v === 'string' && v.trim()))) {
      return { error: `${key} must be a list of up to 20 non-empty strings` };
    }
    if (f.kind === 'member') {
      const { data, error } = await supabase.from('business_members').select('id').eq('business_id', businessId).eq('user_id', value).maybeSingle();
      if (error) return { status: 500, error: error.message };
      if (!data) return { error: `${key} is not a member of this workspace` };
    }
    if (f.kind === 'ref') {
      const { data, error } = await supabase.from(f.table).select('id').eq('business_id', businessId).eq('id', value).maybeSingle();
      if (error) return { status: 500, error: error.message };
      if (!data) return { error: `${key} not found in this workspace` };
    }
    payload[key] = f.kind === 'required' ? value.trim() : f.kind === 'textArray' ? value.map(v => v.trim()) : value;
  }
  return { payload };
}

export const fail = (res, v) => res.status(v.status || 400).json({ error: v.error });

export async function findRow(supabase, table, businessId, id) {
  return supabase.from(table).select('*').eq('business_id', businessId).eq('id', id).maybeSingle();
}

// A finalized week's report data is frozen until someone reopens it.
export async function weekIsFinal(supabase, businessId, weekStart) {
  const { data, error } = await supabase.from('sales_week_report').select('status')
    .eq('business_id', businessId).eq('week_start', weekStart).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.status === 'final';
}

export const FINAL_ERROR = 'This week is finalized - reopen it to edit';

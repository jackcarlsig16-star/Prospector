// intake-insights-v1 I2 - what Prospector already records (the Stage 0 field table, Oct 28), in plain words. A "track"
// item from the notes is checked against it: when every word of one of a field's phrases appears in the item's words
// (normName tokens, stop words dropped) it reads "Already tracked: <label>" (still shown, default Dismiss); otherwise
// "Not tracked yet" (default Keep). REVISABLE matcher - it never hides an item.
export const TRACKED_FIELDS = [
  { id: 'source', label: 'Lead source (kind, partner)', at: 'api/sales/leadSource.js:14', phrases: ['lead source', 'source', 'referred by', 'referral source', 'who referred', 'referring partner'] },
  { id: 'source_office', label: 'Referring office', at: 'api/sales/leadSource.js:14', phrases: ['office', 'branch', 'referring office'] },
  { id: 'source_person', label: 'Referring rep / person', at: 'api/sales/leadSource.js:14', phrases: ['referring rep', 'rep who referred', 'referring person', 'source person'] },
  { id: 'source_history', label: 'Source history', at: 'supabase/migrations/20261022_lead_source_v1.sql:52', phrases: ['source history', 'source changes'] },
  { id: 'ownership', label: 'Owner team / co-owner / no double touch', at: 'supabase/migrations/20261014_call_notes_targets_v1_stage1.sql:52', phrases: ['owner team', 'co owner', 'account owner', 'who owns', 'double touch', 'ownership'] },
  { id: 'employees', label: 'Employees (headcount)', at: 'api/sales/companyPanel.js:61', phrases: ['employees', 'headcount', 'employee count', 'company size', 'number of employees'] },
  { id: 'reach', label: 'Reach (employees covered, clients)', at: 'api/sales/companyPanel.js:62', phrases: ['reach', 'clients', 'client count', 'employees covered', 'covered employees'] },
  { id: 'covered_lives', label: 'Covered lives', at: 'supabase/migrations/20261001_sales_pipeline_v1.sql:31', phrases: ['covered lives', 'lives'] },
  { id: 'stage', label: 'Stage + stage history', at: 'supabase/migrations/20261001_sales_pipeline_v1.sql:62', phrases: ['stage', 'pipeline stage', 'stage history', 'deal stage'] },
  { id: 'touches', label: 'Touches (email / call / meeting)', at: 'supabase/migrations/20261007_partner_touch_log_v1.sql:17', phrases: ['touch', 'touches', 'last contact', 'calls', 'meetings', 'emails sent'] },
  { id: 'replies', label: 'Email replies', at: 'supabase/migrations/20261001_sales_hot_prospects_v1.sql:17', phrases: ['reply', 'replies', 'response rate', 'responses'] },
  { id: 'web_visits', label: 'Website visits', at: 'supabase/migrations/20261020_signals_v1_stage3.sql:17', phrases: ['website visit', 'site visit', 'web visit', 'visitors', 'page views'] },
  { id: 'signals', label: 'Signals', at: 'supabase/migrations/20261019_signals_v1_stage1.sql:13', phrases: ['signal', 'signals', 'buying signal'] },
  { id: 'research', label: 'Research facts', at: 'api/sales/companyBrief.js:18', phrases: ['research', 'why homelover', 'first angle', 'housing perk', 'titles to reach', 'sells to', 'recent news'] },
  { id: 'people', label: 'People (names, titles)', at: 'supabase/migrations/20261026_lead_upload_v1.sql:42', phrases: ['contact', 'contacts', 'decision maker', 'champion', 'job title', 'titles'] },
  { id: 'partner_contacts', label: 'Partner contacts', at: 'supabase/migrations/20261007_partner_360_v1_stage1.sql:15', phrases: ['partner contact', 'partner contacts'] },
  { id: 'intent_score', label: 'Intent score', at: 'supabase/migrations/20261027_intent_score_v1.sql:19', phrases: ['intent', 'intent score', 'priority score'] },
  { id: 'stage_marks', label: 'Funnel stage dates', at: 'supabase/migrations/20261028_brad_attribution_v1_stage1.sql:11', phrases: ['meeting date', 'pilot date', 'referral date', 'funnel'] },
];

const STOP = new Set(['a', 'an', 'the', 'of', 'on', 'for', 'to', 'and', 'or', 'in', 'at', 'by', 'every', 'each', 'all', 'our', 'their', 'its', 'which', 'what', 'who', 'is', 'are', 'be', 'we', 'it', 'with', 'from', 'per']);
// Plurals fold onto the singular so "offices" / "office" and "replies" / "reply" meet.
const stem = w => (w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
export const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w && !STOP.has(w)).map(stem);

// -> the first registry field whose phrase is fully inside the text, or null.
export function trackedMatch(text) {
  const have = new Set(words(text));
  for (const f of TRACKED_FIELDS) if (f.phrases.some(p => { const ws = words(p); return ws.length && ws.every(w => have.has(w)); })) return f;
  return null;
}

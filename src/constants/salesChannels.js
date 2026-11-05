// sales-ia-v2 - where a partner / employer / target came from (P2) and the one
// P1-P4 priority scale (P3), shared by the routes and the Pipeline table.
// Stored values match the channel check constraints in
// supabase/migrations/20261020_sales_ia_v2_stage1.sql.
export const CHANNELS = [
  ['website_visit', 'Website visit'], ['scout', 'Scout signal'], ['apollo_outbound', 'Apollo outbound'],
  ['partner_referral', 'Partner / referral'], ['call_note', 'Call note'], ['import', 'Import'], ['manual', 'Manual'], ['unknown', 'Unknown'],
];
export const CHANNEL_IDS = CHANNELS.map(([id]) => id);
export const CHANNEL_LABEL = Object.fromEntries(CHANNELS);
// companies-v2 C3 - each channel's glyph, by name in src/ui/icons.js (names, not components: the routes import this file).
export const CHANNEL_ICON = { website_visit: 'IconGlobe', scout: 'IconRadar', apollo_outbound: 'IconSend', partner_referral: 'IconLink', call_note: 'IconPhone', import: 'IconUpload', manual: 'IconPlus', unknown: 'IconMore' };
// A signal's source -> the channel of the target its Accept creates.
export const SIGNAL_CHANNEL = { scout: 'scout', web_visit: 'website_visit' };

export const PRIORITIES = [1, 2, 3, 4];
// homelover-flow-v1 F2: the record priority column stays; its words are the Fit levels it migrated onto (4 = Low too).
export const PRIORITY_WORD = { 1: 'Strong', 2: 'Good', 3: 'Low', 4: 'Low' };

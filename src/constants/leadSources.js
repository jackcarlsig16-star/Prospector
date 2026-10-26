// lead-source-v1 - who / what originated a lead (D3), shared by the routes
// and the company window. Stored values match the source_kind check in
// supabase/migrations/20261022_lead_source_v1.sql ('apollo' added by 20261026_lead_upload_v1.sql).
export const SOURCE_KINDS = ['homelover_outreach', 'partner_referral', 'person_referral', 'campaign', 'website', 'scout', 'event', 'inbound', 'unknown', 'apollo'];
export const SOURCE_LABEL = {
  homelover_outreach: 'HomeLover outreach', partner_referral: 'Partner referral', person_referral: 'Person referral', campaign: 'Campaign',
  website: 'Website', scout: 'Scout', event: 'Event', inbound: 'Inbound', unknown: 'Unknown', apollo: 'Apollo',
};

// Shared fixtures for the hk route tests: an invented HumanKind-shaped workspace on the in-memory Supabase. Names
// are invented; the one address lives on one contact and one reply so the tests can prove where it may and may not
// serialize. 0 network, 0 DB.
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from '../sales/testing/fakeSupabase.mjs';

export const HK = 'biz-hk', OTHER = 'biz-other', JACK = 'u-jack', PETE = 'u-pete';
export const ID = { juice: randomUUID(), yoga: randomUUID(), cafe: randomUUID(), run: randomUUID(), old: randomUUID() };
export const NOW = new Date('2026-10-26T20:00:00Z');
const brand = (id, name, over = {}) => ({ id, business_id: HK, name, normalized_name: name.toLowerCase(), aliases: [], segment: 'sponsor_brand', is_local: false, status: 'candidate', relationship: 'prospect', owner_user_id: null, owner_unclear: false, source: 'user_supplied', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', archived_at: null, ...over });

export const seed = (extra = {}) => fakeSupabase({
  hk_brands: [
    brand(ID.juice, 'Northwind Juice', { relationship: 'sponsor', status: 'sponsor', niche: 'cold-pressed juice', domain: 'northwindjuice.example' }),
    brand(ID.yoga, 'Harbor Yoga', { owner_user_id: PETE, status: 'claimed', domain: 'harboryoga.example', is_local: true, city: 'Chicago' }),
    brand(ID.cafe, 'Copperleaf Cafe', { relationship: 'do_not_contact', dnc_reason: 'asked us to stop' }),
    brand(ID.run, 'Bluefin Run Club', { domain: 'bluefinrun.example', aliases: ['Bluefin Runners'] }),
    brand(ID.old, 'Old Brand', { archived_at: '2026-09-01T00:00:00Z' }),
  ],
  hk_contacts: [{ id: 'c-ana', business_id: HK, brand_id: ID.yoga, name: 'Ana Example', title: 'Owner', email: 'ana@harboryoga.example', email_source: 'site_published', is_primary: true, left_company: false, created_at: '2026-10-02T00:00:00Z' }],
  hk_touches: [
    { id: 't1', business_id: HK, brand_id: ID.yoga, sender_user_id: PETE, channel: 'email', kind: 'cold', subject: 'HumanKind x Harbor Yoga - a mat-time challenge', body_text: 'secret body', state: 'sent', sent_at: '2026-10-03T00:00:00Z', created_by: 'claude', created_at: '2026-10-03T00:00:00Z' },
    { id: 't2', business_id: HK, brand_id: ID.yoga, sender_user_id: PETE, channel: 'email', kind: 'bump', subject: 'Re: HumanKind x Harbor Yoga', body_text: 'secret bump', state: 'sent', sent_at: '2026-10-09T00:00:00Z', created_by: 'claude', created_at: '2026-10-09T00:00:00Z' },
  ],
  hk_replies: [{ id: 'r1', business_id: HK, brand_id: ID.yoga, touch_id: 't2', from_name: 'Ana', from_domain: 'harboryoga.example', from_email: 'ana@harboryoga.example', received_at: '2026-10-10T00:00:00Z', label: 'interested', handled: false, created_at: '2026-10-10T00:00:00Z' }],
  hk_sponsor_periods: [], hk_events: [], hk_duplicate_decisions: [], hk_settings: [], hk_member_prefs: [],
  accounts: [{ id: 'acc-1', business_id: HK, account_kind: 'business', data: { name: 'Dunmore Mills' } }],
  projects: [{ id: 'p1', business_id: HK }],
  prospects: [{ id: 'pr-1', project_id: 'p1', name: 'Eastgate Hospital Partners' }],
  ...extra,
}, { now: () => NOW.getTime(), unique: { hk_brands: r => (r.archived_at ? null : `${r.business_id}:${r.normalized_name}`) } });

export const reqOf = ({ method = 'GET', params = {}, query = {}, body = {}, user = JACK, role = 'member', platformOwner = false, businessId = HK } = {}) =>
  ({ method, params: { businessId, ...params }, query, body, auth: { user: { id: user, name: 'Test User' }, isPlatformOwner: platformOwner, roles: new Map([[HK, role]]) } });
export const resOf = () => { const r = { code: 200, body: null }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; return r; };
export const call = async (route, req, deps) => { const res = resOf(); await route(req, res, deps); return res; };
export const hasAt = v => JSON.stringify(v).includes('@');

// hkos-sheet-import-v1 - an INVENTED tracker workbook with every tab shape (names on .invalid, never the real file).
// Returns an exceljs Workbook; a test may write it to a buffer and load it again to go through the real read path.
export async function inventedWorkbook() {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const sheet = (name, headers, rows) => { const ws = wb.addWorksheet(name); ws.addRow(headers); for (const r of rows) ws.addRow(r); return ws; };
  const SPONSOR = ['Name', 'Status', 'Type', 'Contact', 'Challenge Sponsor?', 'Challenge Name', 'Reward/Raffle tied to Challenge?', 'Challange Schedule', 'Reward / Raffle Schedule', 'Raffle Confirmed?', 'Raffle Item', 'Reward', 'Reward Confirmed?', 'Agreement?', 'Redemption Method', 'Discount Code', 'Percentage Off'];
  sheet('Pete Outreach', ['Name', 'Type', 'Contact', 'Outreach Date', 'Jack Outreach', 'Status', 'Notes', 'Challenge/Reward Ideas', '', ''], [
    ['Zz Northwind Juice', 'National CPG', 'ana@northwind.invalid', '9/1/2026, 9/8/26', '', 'Email sent 9/1', 'Loves the idea. Reach Sam at sam@northwind.invalid', 'Juice week'],
    ['Zz Harbor Yoga', '', 'Pete Yogi <pete@harbor.invalid>', '', '10/1', 'IG DM ready', '', ''],
    ['Zz Bluefin Run Club', '', '', '', '', 'Email drafted 10/3', '', ''],
    ['Zz Copperleaf Cafe', '', '', '', '', 'In', '', ''],
    ['Zz Granite Gym', '', '', '', '', '', 'IG @granitegym, ask for Jo', ''],
    ['', '', 'orphan@nowhere.invalid', '', '', 'Email sent 9/9', '', ''],
    ['Zz Northwind', '', '', '', '', 'Replied on IG; email drafted 10/4', '', ''],
    ['Zz Future Foods', '', '', new Date(Date.UTC(2026, 11, 24)), '', '', '', ''],
    ['Zz Salt Spa', '', '', '', '', '', '', ''],
  ]);
  sheet('Jack Outreach', ['Name', 'Website', 'Contact', 'Email', 'Outreach Date', 'Status', 'Enrichment Notes', 'Type', 'Notes', 'Challenge/Reward Ideas'], [
    ['Zz Dunmore Mills', 'https://www.dunmore.invalid/about', 'Lee Dunmore', 'lee@dunmore.invalid', '10/10', 'sent', 'Family-run mill', 'Partnership Inquiry on website', 'Call 312-555-0100 after 5', 'Flour challenge'],
    ['Zz Harbor Yoga', 'harbor.invalid', '', '', '', '', '', 'Sponsored Reward/Raffle', '', ''],
  ]);
  sheet('Meliora', [], []);
  sheet('Non-Profits', ['Name', 'Summary', 'Contact', 'Outreach Date', 'Status', 'Notes', 'Challenge/Reward Ideas'], [['Zz Lakefront Trust', 'Beach cleanups', 'info@lakefront.invalid', '', '', '', '']]);
  sheet('Sheet8', ['Business Name', 'Website'], [['Zz Pine Supply', 'pinesupply.invalid'], ['Zz Harbor Yoga', 'harbor.invalid']]);
  sheet('Orgs to Reach Out to', ['IG Template', 'Email Template'], [['Hi there', 'Hello there']]);
  sheet('Chicago Press Hit LIst', ['Name', 'Contacts', 'Outreach Date'], [['Zz Chicago Daily', 'tips@daily.invalid; Dana Reporter', '10/2']]);
  sheet('Podcasts', ['Name', 'Contacts', 'Outreach Date', 'Status', 'Lane', 'Pitch Angle', 'Host Email Source', 'Notes'], [['Zz Founder Hour', 'host@founderhour.invalid', '', 'Email sent 10/6', 'Founder', "Jack's origin story", 'LinkedIn', 'Weekly show']]);
  sheet('Events', ['Event', 'Date(s)', 'Location', 'Organizer / Contact', 'Status'], [['Zz Lakefront 5K', '11/2', 'Chicago', 'org@run.invalid', 'Applied'], ['Zz Winter Market', '12/6', 'Chicago', '', '']]);
  sheet('Confirmed Launch Sponsors', ['Name', 'Type', 'Contact', 'Challenge Sponsor?', 'Challenge Name', 'Challange Schedule', 'Reward / Raffle Schedule', 'Raffle Confirmed?', 'Raffle Item', 'Reward', 'Reward Confirmed?', 'Agreement?', 'Redemption Method', 'Discount Code', 'Percentage Off', 'IG Post?'], [
    ['Zz Harbor Yoga', 'Reward|Challenge', 'hello@harbor.invalid', 'Yes', 'Mat Time', 'June', 'June', 'Yes', 'Class pass', '20% off a month', 'Yes', 'Yes', 'Code at checkout', 'HK20', '20%', 'Yes'],
    ['Zz River Kayak', 'Raffle|Challenge', '', 'Yes', 'Paddle Week', '', '', 'Yes', 'Two rentals', '', '', 'Yes', '', '', '', ''],
  ]);
  sheet('June Confirmed Sponsors', SPONSOR, [['Zz Harbor Yoga', 'Done', 'Reward|Challenge', '', 'Yes', 'Mat Time June'], ['Zz Oak Street Bakery', 'Need to set up', 'Reward', 'owner@oakstreet.invalid', '', 'Bread Week']]);
  sheet('Septmeber Confirmed Sponsors', SPONSOR, [['Zz Oak Street Bakery', 'Done.', 'Reward', '', '', 'Bread Week II']]);
  sheet('November Confirmed Sponsors', ['Name', 'Paid?', 'Amount', ...SPONSOR.slice(1)], [['Zz Cedar Coffee', 'Yes', 500, 'Done', 'Reward', '', '', 'Latte Ladder']]);
  sheet('January Sponsors', SPONSOR, [['Zz Oak Street Bakery', '', 'Reward', '', '', 'New Year Loaf']]);
  return wb;
}

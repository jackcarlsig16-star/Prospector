// node --test api/hk/importPlan.test.mjs
// hkos-sheet-import-v1 Stage 1 - S2 / S4 plan over the INVENTED workbook: one brand per name across tabs, sponsor tabs ->
// relationship + periods, founders, contacts (addresses only there), touches, possible duplicates, legacy cross-check,
// per-tab counts. 0 network, 0 DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { inventedWorkbook } from './testing.mjs';
import { parseWorkbook } from './importParse.js';
import { buildPlan, contactsFrom, previewRow, tightKey } from './importPlan.js';

const JACK = 'u-jack', TODAY = '2026-10-27';
const EXISTING = [{ id: 'e1', name: 'Zz Cedar Coffee', domain: 'cedar.invalid', aliases: [], status: 'claimed', relationship: 'prospect', owner_user_id: JACK }, { id: 'e2', name: 'Zz Salt', domain: null, aliases: ['Zz Salt Shop'], status: 'candidate', relationship: 'prospect', owner_user_id: null }];
const LEGACY = [{ name: 'Zz Harbor Yoga', kind: 'prospect' }, { name: 'Zz Lost Partner', kind: 'prospect' }, { name: 'Zz Dunmore Mills', kind: 'account' }];
let plan;
const brand = name => plan.brands.find(b => b.name === name);
const codes = b => b.warnings.map(w => w.code);
test.before(async () => { plan = buildPlan({ parsed: parseWorkbook(await inventedWorkbook()), brands: EXISTING, legacy: LEGACY, members: { jack: JACK, pete: null }, settings: { bump_after_days: 5, final_after_days: 14 }, today: TODAY }); });

test('contactsFrom: name <address>, bare address (named after the brand), bare name, several per cell', () => {
  assert.deepEqual(contactsFrom('Pete Yogi <pete@harbor.invalid>', 'Zz Harbor Yoga'), [{ name: 'Pete Yogi', email: 'pete@harbor.invalid', email_source: 'import' }]);
  assert.deepEqual(contactsFrom('ANA@Northwind.invalid', 'Zz Northwind Juice'), [{ name: 'Zz Northwind Juice contact', email: 'ana@northwind.invalid', email_source: 'import' }]);
  assert.deepEqual(contactsFrom('Dana Reporter', 'Zz Chicago Daily'), [{ name: 'Dana Reporter', email: null, email_source: null }]);
  assert.deepEqual(contactsFrom('tips@daily.invalid; Dana Reporter', 'Zz Chicago Daily').map(c => c.name), ['Zz Chicago Daily contact', 'Dana Reporter']);
  assert.deepEqual(contactsFrom('', 'X'), []);
});

test('one brand per name across tabs: Harbor Yoga appears on 5 tabs and is one founding partner with a launch + June period', () => {
  const b = brand('Zz Harbor Yoga');
  assert.deepEqual(b.tabs, ['Pete Outreach', 'Jack Outreach', 'Sheet8', 'Confirmed Launch Sponsors', 'June Confirmed Sponsors']);
  assert.equal(b.relationship, 'founding_partner'); assert.equal(b.status, 'sponsor'); assert.equal(b.segment, 'sponsor_brand');
  assert.equal(b.domain, 'harbor.invalid', "Jack's Website column fills the domain");
  assert.deepEqual(b.periods, [{ period: 'launch', kind: 'launch', note: 'Mat Time' }, { period: '2026-06', kind: 'monthly', note: 'Done - Mat Time June' }]);
  assert.deepEqual(b.contacts, [{ name: 'Pete Yogi', email: 'pete@harbor.invalid', email_source: 'import' }, { name: 'Zz Harbor Yoga contact', email: 'hello@harbor.invalid', email_source: 'import' }]);
  assert.deepEqual(b.touches, [{ kind: 'dm_text', channel: 'ig_dm', state: 'imported', at: null, sender: 'owner' }, { kind: 'outside', channel: 'email', state: 'sent', at: '2026-10-01', sender: 'jack' }]);
  assert.equal(b.owner_hint, 'pete', "Pete's tab named it first"); assert.equal(b.owner_user_id, null);
  assert.deepEqual(codes(b), ['two_founders']);
  assert.match(b.notes, /^Route: Sponsored Reward\/Raffle\nLaunch: Type: Reward\|Challenge\nLaunch: Challenge name: Mat Time\n/);
  assert.match(b.notes, /Launch: Discount code: HK20\nLaunch: Percentage off: 20%/);
  assert.equal(b.next_due_at, null, 'a sponsor is never due');
  assert.equal(b.result, 'warning', 'two founders list it');
});

test("Pete's row: National CPG category, two dates -> cold + bump + status bumped, next due 9 days after the bump, the address in Notes moved to a contact and removed from the text", () => {
  const b = brand('Zz Northwind Juice');
  assert.equal(b.category, 'National CPG'); assert.equal(b.is_local, false); assert.equal(b.owner_hint, 'pete');
  assert.equal(b.status, 'bumped'); assert.deepEqual(b.touches.map(t => [t.kind, t.at]), [['cold', '2026-09-01'], ['bump', '2026-09-08']]);
  assert.equal(b.last_touch_at, '2026-09-08'); assert.equal(b.next_due_at, '2026-09-17T00:00:00.000Z');
  assert.deepEqual(b.contacts.map(c => c.email).sort(), ['ana@northwind.invalid', 'sam@northwind.invalid']);
  assert.equal(b.notes, 'Loves the idea. Reach Sam at'); assert.equal(b.challenge_idea, 'Juice week');
  assert.equal(b.result, 'possible_duplicate'); assert.deepEqual(b.duplicate_of, ['Zz Northwind']);
});

test("Jack's row: Website -> domain, Contact + Email -> one named contact, Type -> Route line, Enrichment -> origin hook, phone stripped, owner Jack", () => {
  const b = brand('Zz Dunmore Mills');
  assert.equal(b.domain, 'dunmore.invalid'); assert.equal(b.owner_user_id, JACK); assert.equal(b.owner_hint, 'jack');
  assert.deepEqual(b.contacts, [{ name: 'Lee Dunmore', email: 'lee@dunmore.invalid', email_source: 'import' }]);
  assert.equal(b.notes, 'Route: Partnership Inquiry on website\nCall [number removed] after 5'); assert.equal(b.origin_hook, 'Family-run mill'); assert.equal(b.challenge_idea, 'Flour challenge');
  assert.equal(b.status, 'sent'); assert.deepEqual(b.touches, [{ kind: 'cold', channel: 'email', state: 'sent', at: '2026-10-10', sender: 'owner' }]);
  assert.equal(b.next_due_at, '2026-10-15T00:00:00.000Z'); assert.equal(b.result, 'new');
});

test('statuses: "Email drafted" -> claimed with a warning, "In" (unmapped, kept in notes), no status no date -> candidate still hinted to Pete, future date flagged', () => {
  assert.equal(brand('Zz Bluefin Run Club').status, 'claimed', 'a sheet "Email drafted" on a founder\'s tab reads claimed (no Gmail draft behind it)'); assert.deepEqual(codes(brand('Zz Bluefin Run Club')), ['draft_not_linked']); assert.equal(brand('Zz Bluefin Run Club').result, 'warning');
  assert.equal(brand('Zz Copperleaf Cafe').status, 'candidate'); assert.deepEqual(codes(brand('Zz Copperleaf Cafe')), ['unmapped_status']); assert.equal(brand('Zz Copperleaf Cafe').notes, 'Status: In');
  assert.equal(brand('Zz Granite Gym').status, 'candidate'); assert.equal(brand('Zz Granite Gym').owner_hint, 'pete'); assert.deepEqual(codes(brand('Zz Granite Gym')), []); assert.equal(brand('Zz Granite Gym').result, 'new');
  assert.equal(brand('Zz Granite Gym').notes, 'IG at granitegym, ask for Jo', 'a bare @ (an Instagram handle) reads as "at" - the inbox rule; no saved text trips hasPii');
  assert.equal(brand('Zz Future Foods').status, 'sent'); assert.deepEqual(codes(brand('Zz Future Foods')), ['future_date']); assert.equal(brand('Zz Future Foods').touches[0].at, '2026-12-24');
});

test('sponsor tabs: repeated names -> one brand with many periods, relationship sponsor, period note = Status + Challenge Name; Paid? / Amount never imported', () => {
  const oak = brand('Zz Oak Street Bakery');
  assert.equal(oak.relationship, 'sponsor'); assert.equal(oak.status, 'sponsor');
  assert.deepEqual(oak.periods, [{ period: '2026-06', kind: 'monthly', note: 'Need to set up - Bread Week' }, { period: '2026-09', kind: 'monthly', note: 'Done. - Bread Week II' }, { period: '2027-01', kind: 'monthly', note: 'New Year Loaf' }]);
  assert.deepEqual(oak.contacts, [{ name: 'Zz Oak Street Bakery contact', email: 'owner@oakstreet.invalid', email_source: 'import' }]);
  assert.deepEqual(codes(oak), []); assert.equal(oak.owner_hint, null);
  const river = brand('Zz River Kayak');
  assert.equal(river.relationship, 'founding_partner'); assert.deepEqual(river.periods, [{ period: 'launch', kind: 'launch', note: 'Paddle Week' }]);
  assert.ok(!JSON.stringify(plan).includes('500') && !/amount|paid/i.test(JSON.stringify(plan.brands.map(b => [b.notes, b.periods]))), 'no pricing data');
});

test('an exact hit on an existing brand is a match (not a second brand); a whole-word partial against an existing brand is a possible duplicate', () => {
  const cedar = brand('Zz Cedar Coffee');
  assert.equal(cedar.result, 'matches'); assert.equal(cedar.existing_id, 'e1'); assert.deepEqual(cedar.existing, { id: 'e1', name: 'Zz Cedar Coffee', domain: 'cedar.invalid', status: 'claimed', relationship: 'prospect', owner_user_id: JACK });
  assert.deepEqual(cedar.periods, [{ period: '2026-11', kind: 'monthly', note: 'Done - Latte Ladder' }]);
  const salt = brand('Zz Salt Spa');
  assert.equal(salt.result, 'possible_duplicate'); assert.deepEqual(salt.duplicate_of, ['Zz Salt']);
  assert.deepEqual(plan.duplicates, [{ a: 'Zz Northwind Juice', b: 'Zz Northwind', b_existing_id: null, reason: 'name_contains' }, { a: 'Zz Salt Spa', b: 'Zz Salt', b_existing_id: 'e2', reason: 'name_contains' }]);
  assert.equal(brand('Zz Northwind').result, 'possible_duplicate', 'the pair is listed on both sides');
});

test('segments: nonprofit (Summary -> notes), press (Contacts -> contacts), podcast (Lane -> category, Pitch Angle -> challenge idea, Host Email Source -> notes), Sheet8 -> unowned candidates', () => {
  const lake = brand('Zz Lakefront Trust');
  assert.equal(lake.segment, 'nonprofit'); assert.equal(lake.notes, 'Beach cleanups'); assert.deepEqual(lake.contacts.map(c => c.email), ['info@lakefront.invalid']); assert.equal(lake.status, 'candidate');
  const daily = brand('Zz Chicago Daily');
  assert.equal(daily.segment, 'press'); assert.deepEqual(daily.contacts.map(c => [c.name, c.email]), [['Dana Reporter', null], ['Zz Chicago Daily contact', 'tips@daily.invalid']]); assert.equal(daily.status, 'sent'); assert.equal(daily.touches[0].at, '2026-10-02');
  const pod = brand('Zz Founder Hour');
  assert.equal(pod.segment, 'podcast'); assert.equal(pod.category, 'Founder'); assert.equal(pod.challenge_idea, "Jack's origin story"); assert.equal(pod.notes, 'Host email source: LinkedIn\nWeekly show'); assert.equal(pod.status, 'sent');
  const pine = brand('Zz Pine Supply');
  assert.equal(pine.segment, 'sponsor_brand'); assert.equal(pine.domain, 'pinesupply.invalid'); assert.equal(pine.status, 'candidate'); assert.equal(pine.owner_hint, null); assert.equal(pine.owner_user_id, null); assert.equal(pine.source, undefined);
});

test('per-tab counts and totals; skipped tabs listed with their row counts; the no-name row counted as skipped', () => {
  const t = Object.fromEntries(plan.tabs.map(x => [x.name, x]));
  assert.deepEqual([t['Pete Outreach'].rows_read, t['Pete Outreach'].rows, t['Pete Outreach'].skipped_rows, t['Pete Outreach'].create, t['Pete Outreach'].match], [9, 8, 1, 8, 0]);
  assert.deepEqual([t['Jack Outreach'].create, t['Jack Outreach'].match], [1, 0], 'Harbor Yoga was first seen on Pete\'s tab');
  assert.deepEqual([t['November Confirmed Sponsors'].create, t['November Confirmed Sponsors'].match], [0, 1]);
  assert.deepEqual([t['Sheet8'].create, t['Confirmed Launch Sponsors'].create, t['June Confirmed Sponsors'].create], [1, 1, 1]);
  assert.deepEqual(plan.totals.skipped_tabs, [{ name: 'Meliora', rows_read: 0, reason: 'template' }, { name: 'Orgs to Reach Out to', rows_read: 1, reason: 'template' }, { name: 'Events', rows_read: 2, reason: 'events are not brand-shaped (no event segment yet)' }]);
  assert.equal(plan.totals.brands, 16); assert.equal(plan.totals.create, 15); assert.equal(plan.totals.match, 1); assert.equal(plan.totals.possible_duplicates, 2);
  assert.equal(plan.totals.contacts_with_email, 9); assert.equal(plan.totals.periods, 7);
});

test('legacy cross-check: a founding partner in the old prospects list but not on the Launch tab is a warning; nothing from legacy becomes a brand', () => {
  assert.deepEqual(plan.warnings.filter(w => w.code === 'legacy_founding_partner_missing').map(w => w.detail), ['Zz Lost Partner is in the legacy founding-partner list but not on the Launch tab']);
  assert.equal(brand('Zz Lost Partner'), undefined);
  const owner = plan.warnings.find(w => w.code === 'owner_missing');
  assert.match(owner.detail, /^\d+ touches on Pete's rows wait for his first sign-in/);
});

test('privacy: the preview row carries contact presence, never an address; no address anywhere in the plan outside contacts', () => {
  const rows = plan.brands.map(previewRow);
  assert.ok(!JSON.stringify(rows).includes('@'));
  assert.deepEqual(rows.find(r => r.name === 'Zz Northwind Juice').contact_count, 2); assert.equal(rows.find(r => r.name === 'Zz Northwind Juice').has_email, true);
  assert.equal(rows.find(r => r.name === 'Zz Granite Gym').has_email, false);
  const stripped = plan.brands.map(({ contacts, ...rest }) => rest);
  assert.ok(!JSON.stringify({ stripped, tabs: plan.tabs, duplicates: plan.duplicates, warnings: plan.warnings, totals: plan.totals }).includes('@'));
  assert.ok(!JSON.stringify(plan).includes('555-0100'), 'phones stripped');
});

test('tightKey: "Perk Spot" = "PerkSpot" = "The Perk Spot, Inc."', () => {
  assert.equal(tightKey('Perk Spot'), tightKey('PerkSpot')); assert.equal(tightKey('The Perk Spot, Inc.'), 'perkspot');
});

test('hk-imported-drafts-noise: a sheet "Email drafted" brand reads claimed when a founder holds it, candidate when nobody does (the F3 rule); its touch is imported', () => {
  const tab = (name, kind, rows) => ({ name, kind, rows_read: rows.length, rows: rows.map((r, i) => ({ ref: `${name}!${i + 2}`, ...r })) });
  const p = buildPlan({ parsed: { tabs: [tab('Podcasts', 'podcast', [{ name: 'Zz Quiet Pod', status: 'Email drafted 10/7' }]), tab('Pete Outreach', 'pete_outreach', [{ name: 'Zz Loud Pod', status: 'Email drafted 10/7' }])] }, members: { jack: JACK, pete: null }, today: TODAY });
  const by = n => p.brands.find(b => b.name === n);
  assert.deepEqual([by('Zz Quiet Pod').status, by('Zz Loud Pod').status], ['candidate', 'claimed']);
  assert.deepEqual(by('Zz Quiet Pod').touches.map(t => t.state), ['imported']);
});

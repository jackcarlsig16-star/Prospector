// node --test api/hk/importParse.test.mjs
// hkos-sheet-import-v1 Stage 1 - the workbook reader on the INVENTED workbook (written to a buffer and loaded again, so
// the real exceljs read path runs). 0 network, 0 DB; the real tracker file is never opened here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { inventedWorkbook } from './testing.mjs';
import { parseWorkbook, tabKind, monthPeriod, HEADERS } from './importParse.js';

const loaded = async () => { const { default: ExcelJS } = await import('exceljs'); const buf = await (await inventedWorkbook()).xlsx.writeBuffer(); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); return parseWorkbook(wb); };
const tab = (p, name) => p.tabs.find(t => t.name === name);

test('tabKind: every tracker tab name, the misspelled month included, maps to a kind; unknown tabs are skipped', () => {
  assert.deepEqual(tabKind('Pete Outreach'), { kind: 'pete_outreach' });
  assert.deepEqual(tabKind('Jack Outreach'), { kind: 'jack_outreach' });
  assert.deepEqual(tabKind('Confirmed Launch Sponsors'), { kind: 'launch' });
  assert.deepEqual(tabKind('June Confirmed Sponsors'), { kind: 'monthly', month: 6, period: '2026-06' });
  assert.deepEqual(tabKind('Septmeber Confirmed Sponsors'), { kind: 'monthly', month: 9, period: '2026-09' });
  assert.deepEqual(tabKind('December Confirmed Sponsors'), { kind: 'monthly', month: 12, period: '2026-12' });
  assert.deepEqual(tabKind('January Sponsors'), { kind: 'monthly', month: 1, period: '2027-01' });
  assert.equal(tabKind('Non-Profits').kind, 'nonprofit');
  assert.equal(tabKind('Chicago Press Hit LIst').kind, 'press');
  assert.equal(tabKind('Podcasts').kind, 'podcast');
  assert.equal(tabKind('Sheet8').kind, 'sheet8');
  assert.equal(tabKind('Events').kind, 'skipped');
  assert.equal(tabKind('Orgs to Reach Out to').reason, 'template'); assert.equal(tabKind('Copy of Meliora').reason, 'template');
  assert.deepEqual(tabKind('Random Tab'), { kind: 'skipped', reason: 'unknown tab' });
  assert.equal(monthPeriod(6), '2026-06'); assert.equal(monthPeriod(1), '2027-01');
});

test('every tab of the invented workbook is read: kinds, rows read, rows with a name, skipped rows', async () => {
  const p = await loaded();
  assert.deepEqual(p.tabs.map(t => [t.name, t.kind, t.rows_read, t.rows.length, t.skipped_rows]), [
    ['Pete Outreach', 'pete_outreach', 9, 8, 1], ['Jack Outreach', 'jack_outreach', 2, 2, 0], ['Meliora', 'skipped', 0, 0, 0], ['Non-Profits', 'nonprofit', 1, 1, 0],
    ['Sheet8', 'sheet8', 2, 2, 0], ['Orgs to Reach Out to', 'skipped', 1, 0, 0], ['Chicago Press Hit LIst', 'press', 1, 1, 0], ['Podcasts', 'podcast', 1, 1, 0],
    ['Events', 'skipped', 2, 0, 0], ['Confirmed Launch Sponsors', 'launch', 2, 2, 0], ['June Confirmed Sponsors', 'monthly', 2, 2, 0], ['Septmeber Confirmed Sponsors', 'monthly', 1, 1, 0],
    ['November Confirmed Sponsors', 'monthly', 1, 1, 0], ['January Sponsors', 'monthly', 1, 1, 0],
  ]);
  assert.equal(tab(p, 'Events').reason, 'events are not brand-shaped (no event segment yet)');
  assert.equal(tab(p, 'Septmeber Confirmed Sponsors').period, '2026-09'); assert.equal(tab(p, 'January Sponsors').period, '2027-01');
});

test('headers map by lower-cased words: Business Name -> name, Contacts -> contact, Challenge/Reward Ideas -> ideas; odd spellings land in unknown_headers; trailing empty columns are ignored', async () => {
  const p = await loaded();
  assert.deepEqual(tab(p, 'Pete Outreach').headers, ['name', 'type', 'contact', 'outreach_date', 'jack_outreach', 'status', 'notes', 'ideas']);
  assert.deepEqual(tab(p, 'Sheet8').headers, ['name', 'website']);
  assert.deepEqual(tab(p, 'Chicago Press Hit LIst').headers, ['name', 'contact', 'outreach_date']);
  assert.ok(tab(p, 'Confirmed Launch Sponsors').unknown_headers.includes('challange schedule'));
  assert.deepEqual(tab(p, 'November Confirmed Sponsors').headers.slice(0, 4), ['name', 'paid', 'amount', 'status']);
  assert.equal(HEADERS['business name'], 'name');
});

test('cells: text trimmed, a Date cell reads as YYYY-MM-DD, empty cells are absent, the ref is <tab>:<row>', async () => {
  const p = await loaded();
  const pete = tab(p, 'Pete Outreach').rows;
  assert.deepEqual(pete[0], { ref: 'Pete Outreach:2', name: 'Zz Northwind Juice', type: 'National CPG', contact: 'ana@northwind.invalid', outreach_date: '9/1/2026, 9/8/26', status: 'Email sent 9/1', notes: 'Loves the idea. Reach Sam at sam@northwind.invalid', ideas: 'Juice week' });
  assert.deepEqual(pete[1], { ref: 'Pete Outreach:3', name: 'Zz Harbor Yoga', contact: 'Pete Yogi <pete@harbor.invalid>', jack_outreach: '10/1', status: 'IG DM ready' });
  assert.deepEqual(pete[4], { ref: 'Pete Outreach:6', name: 'Zz Granite Gym', notes: 'IG @granitegym, ask for Jo' });
  assert.equal(pete.find(r => r.name === 'Zz Future Foods').outreach_date, '2026-12-24');
  assert.equal(pete.find(r => r.name === 'Zz Future Foods').ref, 'Pete Outreach:9', 'the skipped no-name row keeps its row number');
  assert.deepEqual(tab(p, 'Jack Outreach').rows[0].website, 'https://www.dunmore.invalid/about');
  assert.equal(tab(p, 'November Confirmed Sponsors').rows[0].amount, '500', 'read as text; the plan ignores it');
});

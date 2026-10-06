#!/usr/bin/env node
'use strict';
require('dotenv').config();
const fs = require('fs');
const JSZip = require('jszip');
const { createClient } = require('@supabase/supabase-js');

// import-partners-sheet.js — sales-partners-pipeline-v1 Stage 1. Imports the
// "Partner Owners" tab of Jack's HomeLover_Partner_Owners.xlsx into HomeLover
// partners (sales_goals, goal_type 'partnership'). The file lives in inbox/
// (gitignored) and is read in place, never copied into the repo.
//
// Existing partners match on normalized name (case, accents, punctuation,
// a trailing legal suffix and any "(...)" part ignored), so
// "EBG (Entertainment Benefits Group)" = "EBG (incl. Beneplace)". A match
// only FILLS fields that are empty in the app - nothing the app holds is
// overwritten. A sheet row matching 2+ partners (or 2 rows matching one) is
// skipped as ambiguous. Idempotent: a re-run fills and inserts nothing.
// Statuses import as-is: "1st Email Drafted" stays drafted, never "sent".
// No events are written - the import is the starting state, not activity.
// 0 Apollo calls.
//
// Usage:
//   node scripts/import-partners-sheet.js --file inbox/HomeLover_Partner_Owners.xlsx --dry-run
//   node scripts/import-partners-sheet.js --file inbox/HomeLover_Partner_Owners.xlsx

const BUSINESS_ID = 'bc69beab-effd-452d-9e81-fd652333bb95'; // HomeLover
const SHEET = 'Partner Owners';
const HEADERS = ['Category', 'Partner', 'Tier', 'Owner', 'Partner Role', 'Status', 'Known Contacts', 'Target Titles',
  'Sequence to Use', 'Angle', 'Next Step', 'Flags / Do-not-say', '1st Email Date', 'Last Touch', 'Days Since Touch', 'Notes'];
const STATUS = {
  'not started': 'not_started', 'researching': 'researching', '1st email drafted': 'first_email_drafted',
  '1st email sent': 'first_email_sent', 'in sequence': 'in_sequence', 'replied': 'replied', 'meeting set': 'meeting_set',
  'proposal / pilot': 'proposal_pilot', 'live': 'live', 'paused / deprioritized': 'paused',
};
const TIERS = ['1', '2', '3', '4', 'active'];
// sheet header -> sales_goals column (Partner, Tier, Owner, Status and Days Since Touch handled separately)
const TEXT_FIELDS = {
  'Category': 'category', 'Partner Role': 'partner_role', 'Known Contacts': 'known_contacts', 'Target Titles': 'target_titles',
  'Sequence to Use': 'sequence_to_use', 'Angle': 'angle', 'Next Step': 'next_step', 'Flags / Do-not-say': 'do_not_say', 'Notes': 'notes',
};

const arg = name => { const i = process.argv.indexOf(name); return i === -1 ? null : process.argv[i + 1]; };
const dryRun = process.argv.includes('--dry-run');
const SUFFIX = /\b(inc|llc|ltd|corp|corporation|co|plc)$/;
function normName(s) {
  let n = String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ').replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  while (SUFFIX.test(n)) n = n.replace(SUFFIX, '').trim();
  return n;
}
const clean = v => { const s = v == null ? '' : String(v).trim(); return s === '' || s === '—' || s === '-' ? null : s; };
const empty = v => v == null || (typeof v === 'string' && v.trim() === '');
// Excel stores dates as day serials (1900 system); a typed string date passes through.
function sheetDate(v, withTime) {
  const s = clean(v); if (!s) return null;
  const d = /^\d+(\.\d+)?$/.test(s) ? new Date(Math.round((Number(s) - 25569) * 86400e3)) : new Date(s);
  if (Number.isNaN(d.getTime())) return undefined;
  return withTime ? d.toISOString() : d.toISOString().slice(0, 10);
}

async function readSheet(file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const text = async p => (await zip.file(p)?.async('string')) || '';
  const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const shared = [...(await text('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')));
  const wb = await text('xl/workbook.xml');
  const rid = [...wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].find(m => decode(m[1]) === SHEET)?.[2];
  if (!rid) throw new Error(`no "${SHEET}" tab in ${file}`);
  const target = (await text('xl/_rels/workbook.xml.rels')).match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`))?.[1]
    || (await text('xl/_rels/workbook.xml.rels')).match(new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`))?.[1];
  const xml = await text(target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  const colIndex = ref => [...ref.match(/^[A-Z]+/)[0]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map(r => {
    const out = [];
    for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const type = (c[2].match(/t="([^"]+)"/) || [])[1];
      const v = ((c[3] || '').match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      const inline = [...(c[3] || '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('');
      out[colIndex(c[1])] = type === 's' ? shared[Number(v)] : type === 'inlineStr' ? decode(inline) : v == null ? null : decode(v);
    }
    return out;
  });
}

(async () => {
  const file = arg('--file');
  if (!file) { console.error('Usage: node scripts/import-partners-sheet.js --file <xlsx> [--dry-run]'); process.exit(1); }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  const rows = await readSheet(file);
  const headerAt = rows.findIndex(r => r[0] === 'Category' && r[1] === 'Partner');
  if (headerAt === -1) throw new Error('header row (Category, Partner, ...) not found');
  const header = rows[headerAt];
  const missing = HEADERS.filter(h => !header.includes(h));
  if (missing.length) throw new Error(`sheet columns missing: ${missing.join(', ')}`);
  const col = h => header.indexOf(h);
  const dataRows = rows.slice(headerAt + 1).filter(r => r.some(v => clean(v)));

  const { data: members, error: mErr } = await supabase.from('business_members').select('name, user_id').eq('business_id', BUSINESS_ID);
  if (mErr) throw new Error(mErr.message);
  const { data: existing, error: gErr } = await supabase.from('sales_goals').select('*').eq('business_id', BUSINESS_ID).eq('goal_type', 'partnership');
  if (gErr) throw new Error(gErr.message);
  const ownerId = name => {
    const hits = members.filter(m => m.user_id && m.name.split(' ')[0].toLowerCase() === String(name || '').trim().toLowerCase());
    return hits.length === 1 ? hits[0].user_id : null;
  };

  const report = { sheetRows: dataRows.length, new: [], matched: [], skipped: [] };
  const plans = [];
  const sheetKeys = {};
  for (const r of dataRows) { const k = normName(r[col('Partner')]); sheetKeys[k] = (sheetKeys[k] || 0) + 1; }

  for (const r of dataRows) {
    const name = clean(r[col('Partner')]);
    if (!name) { report.skipped.push({ name: '(blank)', reason: 'no partner name' }); continue; }
    const tierRaw = (clean(r[col('Tier')]) || '').toLowerCase();
    const statusRaw = (clean(r[col('Status')]) || '').toLowerCase();
    const owner = clean(r[col('Owner')]);
    const fields = {};
    for (const [h, c] of Object.entries(TEXT_FIELDS)) fields[c] = clean(r[col(h)]);
    const firstEmail = sheetDate(r[col('1st Email Date')], false), lastTouch = sheetDate(r[col('Last Touch')], true);
    const problems = [];
    if (tierRaw && !TIERS.includes(tierRaw)) problems.push(`unknown tier "${tierRaw}"`);
    if (!STATUS[statusRaw]) problems.push(`unknown status "${statusRaw}"`);
    if (owner && !ownerId(owner)) problems.push(`owner "${owner}" isn't exactly one HomeLover member`);
    if (firstEmail === undefined || lastTouch === undefined) problems.push('unreadable date');
    if (sheetKeys[normName(name)] > 1) problems.push('name appears more than once in the sheet');
    const hits = existing.filter(g => normName(g.name) === normName(name));
    if (hits.length > 1) problems.push(`matches ${hits.length} existing partners (${hits.map(h => h.name).join(', ')})`);
    if (problems.length) { report.skipped.push({ name, reason: problems.join('; ') }); continue; }
    Object.assign(fields, { tier: tierRaw || null, pipeline_status: STATUS[statusRaw], owner_user_id: owner ? ownerId(owner) : null, first_email_at: firstEmail, last_touch_at: lastTouch });

    if (!hits.length) {
      const row = { business_id: BUSINESS_ID, goal_type: 'partnership', name };
      for (const [k, v] of Object.entries(fields)) if (v != null) row[k] = v;
      plans.push({ kind: 'insert', row });
      report.new.push({ name, owner, tier: fields.tier, pipeline_status: fields.pipeline_status });
      continue;
    }
    const g = hits[0];
    const fill = {}, kept = [];
    for (const [k, v] of Object.entries(fields)) {
      if (v == null) continue;
      if (empty(g[k])) fill[k] = v;
      else if (String(g[k]) !== String(v)) kept.push(k);
    }
    if (Object.keys(fill).length) plans.push({ kind: 'update', id: g.id, fill });
    report.matched.push({ sheet: name, app: g.name, fills: Object.keys(fill), keptAppValue: kept });
  }

  const accounted = report.new.length + report.matched.length + report.skipped.length;
  console.log(`${dryRun ? 'DRY RUN - nothing written' : 'IMPORT'} · ${file} · tab "${SHEET}"`);
  console.log(`sheet rows ${report.sheetRows} = new ${report.new.length} + matched ${report.matched.length} + skipped ${report.skipped.length} (${accounted === report.sheetRows ? 'all accounted for' : 'MISMATCH'})`);
  console.log(`existing partners ${existing.length}; matched ${new Set(report.matched.map(m => m.app)).size}; existing with no sheet row: ${existing.filter(g => !report.matched.some(m => m.app === g.name)).map(g => g.name).join(', ') || 'none'}`);
  console.log('\nMATCHED (fill empty fields only):');
  for (const m of report.matched) console.log(`  ${m.sheet}${m.sheet !== m.app ? ` = app "${m.app}"` : ''} · fills: ${m.fills.join(', ') || 'nothing'}${m.keptAppValue.length ? ` · kept app value: ${m.keptAppValue.join(', ')}` : ''}`);
  console.log('\nNEW:');
  const byOwner = report.new.reduce((o, n) => ({ ...o, [n.owner || 'unassigned']: (o[n.owner || 'unassigned'] || 0) + 1 }), {});
  console.log(`  ${report.new.length} partners (${Object.entries(byOwner).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  for (const n of report.new) console.log(`  ${n.name} · ${n.owner} · tier ${n.tier} · ${n.pipeline_status}`);
  console.log('\nSKIPPED:');
  for (const s of report.skipped) console.log(`  ${s.name}: ${s.reason}`);
  if (!report.skipped.length) console.log('  none');

  if (dryRun) return;
  let inserted = 0, updated = 0;
  const inserts = plans.filter(p => p.kind === 'insert').map(p => p.row);
  if (inserts.length) {
    const { data, error } = await supabase.from('sales_goals').insert(inserts).select('id');
    if (error) throw new Error(`insert: ${error.message}`);
    inserted = data.length;
  }
  for (const p of plans.filter(x => x.kind === 'update')) {
    const { error } = await supabase.from('sales_goals').update({ ...p.fill, updated_at: new Date().toISOString() }).eq('id', p.id);
    if (error) throw new Error(`update ${p.id}: ${error.message}`);
    updated++;
  }
  console.log(`\nwritten: inserted ${inserted}, filled ${updated} existing partners`);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });

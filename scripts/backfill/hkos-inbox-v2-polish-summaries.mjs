// hkos-inbox-v2-polish P3 - one-time backfill on HumanKind: hk_replies.summary rows stored before the Stage 2 entity
// decode ("What&#39;s your favorite ...") are decoded in place with the same helper (api/hk/gmailMime.js decodeEntities).
// Text only: no other column is read for writing or written.
//   node scripts/backfill/hkos-inbox-v2-polish-summaries.mjs --dry-run                     counts, writes nothing
//   node scripts/backfill/hkos-inbox-v2-polish-summaries.mjs --apply --snapshot <file>     saves (id, summary) of every
//                                                                                          row it changes, then updates
// Idempotent: a second dry run finds 0. Scope: HumanKind's hk_replies (all pages via selectAllPages); 0 Gmail, 0 Claude.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { decodeEntities } = await import('../../api/hk/gmailMime.js');
const { selectAllPages } = await import('../../api/lib/selectAllPages.js');

const APPLY = process.argv.includes('--apply');
const snapAt = process.argv.indexOf('--snapshot');
const SNAPSHOT = snapAt > 0 ? process.argv[snapAt + 1] : null;
if (!APPLY && !process.argv.includes('--dry-run')) { console.log('usage: --dry-run | --apply --snapshot <file>'); process.exit(2); }
if (APPLY && !SNAPSHOT) { console.log('--apply needs --snapshot <file> (the before-values, so the change can be undone)'); process.exit(2); }
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const hk = must(await svc.from('businesses').select('id, features').eq('name', 'HumanKind')).find(b => b.features?.hk_sales);
if (!hk) throw new Error('no HumanKind workspace with hk_sales on');

const rows = await selectAllPages(() => svc.from('hk_replies').select('id, summary').eq('business_id', hk.id).not('summary', 'is', null).order('id'));
const changes = rows.map(r => ({ id: r.id, before: r.summary, after: decodeEntities(r.summary) })).filter(c => c.after !== c.before);
const entities = changes.reduce((n, c) => n + (c.before.match(/&(?:#x[0-9a-f]+|#\d+|[a-z]+);/gi) || []).length, 0);
console.log(`hk_replies on HumanKind: ${rows.length} with a summary · ${changes.length} carry HTML entities (${entities} entities) · ${APPLY ? 'APPLY' : 'dry run, nothing written'}`);
if (APPLY && changes.length) {
  fs.writeFileSync(SNAPSHOT, JSON.stringify(changes.map(c => ({ id: c.id, summary: c.before })), null, 1));
  for (const c of changes) must(await svc.from('hk_replies').update({ summary: c.after }).eq('id', c.id).eq('business_id', hk.id).select('id'));
  console.log(`updated ${changes.length} summaries; before-values saved to ${SNAPSHOT}`);
}

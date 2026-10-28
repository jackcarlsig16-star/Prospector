// homelover-small-fixes-v1 P2 replay - 0 Claude, 0 DB: re-parses the model's own track / optimize / channel_links (the
// signed extract inside the saved intake-insights-v1 Stage 3 reply) with today's toInsights and prints the first Track
// item before (the stored reply, cut at 80) and now. Usage: --replay
import fs from 'fs';
import path from 'path';
import { toInsights } from '../../api/sales/intakeInsights.js';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
if (!process.argv.includes('--replay')) { console.log('usage: --replay'); process.exit(2); }
const reply = JSON.parse(fs.readFileSync(path.join(ROOT, '.screenshots', 'intake-insights-v1', 'extract-reply.json'), 'utf8'));
const now = toInsights(reply.extract, { noteDate: reply.call_date });
const was = reply.insights.track[0].what;
const first = now.track[0].what;
console.log(`first Track item, Stage 3 (cut at 80): ${JSON.stringify(was)} (${was.length})`);
console.log(`first Track item, now:                 ${JSON.stringify(first)} (${first.length})`);
const over = [...now.track.map(t => t.what.length > 121), ...now.optimize.map(o => o.text.length > 200)].filter(Boolean).length;
const cut = [...now.track.map(t => t.what), ...now.optimize.map(o => o.text), ...now.channel_links.map(l => l.evidence)].filter(x => x.endsWith('…')).length;
console.log(`track ${now.track.length} · optimize ${now.optimize.length} · channel_links ${now.channel_links.length} · cut with "…" ${cut} · over cap ${over} · Claude 0`);
process.exit(first.length > 80 && !first.endsWith('…') && !over ? 0 : 1);

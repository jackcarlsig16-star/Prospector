// scout-v3.1 Stage 0 (c) + (e) - pure, in memory: 0 DB reads, 0 Claude, 0 Apollo, nothing written. ~1 s.
// (c) parseAsk on the possessive asks with the sales vocabulary and three invented member names;
// (e) ten follow-up phrasings against a fixture answer (5 people + 3 tasks) through TODAY's resolver for commands
//     (actions.js resolveTargets) - the rule C1 would reuse "as written".
import { parseAsk, mergeVocab } from '../../api/scout/retrieve.js';
import { resolveTargets } from '../../api/scout/actions.js';
import { VOCABULARY } from '../../api/sales/scoutEntities.js';
import { salesIntents } from '../../api/sales/scoutIntents.js';
const vocab = mergeVocab([VOCABULARY, { sources: {}, members: [{ id: 'u1', name: 'Cyrus Vale' }, { id: 'u2', name: 'Jack Carr' }] }]);
const today = '2026-11-19';
console.log('(c) parseAsk - company candidates and the intents that match');
for (const q of ["Cyrus's top 5", "Cyrus's targets", "Cyrus's tasks", 'my top targets', 'show me Cyrus tasks']) {
  const a = parseAsk(q, vocab, { today });
  console.log(`  "${q}" -> company ${JSON.stringify(a.company)} · entity ${a.entity} · mine ${a.mine} · intents ${salesIntents.filter(i => i.match(a)).map(i => i.id).join(' + ') || 'none'}`);
}
const p = (i, name, co) => ({ key: `people:prospect:p${i}`, entity: 'people', id: `prospect:p${i}`, title: name, company: { type: 'employer', id: `e${i}`, name: co } });
const rows = [p(1, 'Dana Mayer', 'Cloudflare'), p(2, 'Meagan Earl', 'Cloudflare'), p(3, 'Danilea Cruz', 'Northrop'), p(4, 'Lee Stone', 'MetLife'), p(5, 'Rae North', 'Hilton'),
  ...[1, 2, 3].map(i => ({ key: `todos:t${i}`, entity: 'todos', id: `t${i}`, title: ['Call MetLife benefits lead', 'Send Hilton the one-pager', 'Follow up with Northrop'][i - 1], company: null }))];
console.log('(e) ten follow-ups against 5 people + 3 tasks, through resolveTargets as it is today');
for (const [q, want] of [
  ['write an email to the second one', 'Meagan Earl'], ['tell me about #3', 'Danilea Cruz'], ['what do we know about her', '(one row only)'], ['show me their tasks', 'all 5 people'],
  ['what stage is that company in', "(one row's company)"], ['snooze those until next week', 'all rows'], ['tell me about Danilea', 'Danilea Cruz'], ['what about the Cloudflare ones', 'Dana Mayer + Meagan Earl'],
  ['snooze the first task until next week', 'Call MetLife benefits lead'], ['write an email to the last one', 'Rae North (last person)'],
]) {
  const r = resolveTargets(q, rows, null);
  console.log(`  "${q}" · want ${want} · got how=${r.how} -> ${r.rows.map(x => x.title).join(' + ') || '(nothing)'}`);
}

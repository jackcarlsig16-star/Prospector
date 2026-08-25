#!/usr/bin/env node
'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// doctrine-dual-row-cleanup-v1 — outreach_doctrine had two active
// is_hard_constraint=false rows. Row 1 opens by declaring itself the
// "updated, fully abstracted Platform Doctrine" that replaces Row 2, but
// Row 2 was never deactivated, so both rendered into every generation as
// 10,949 chars (57-61% of the prompt). Row 2 also carried HomeLover-specific
// worked examples that reached HumanKind/Master Magnetics/Kopi Kita prompts.
//
// DECLARED SCOPE: 3 row writes, 1 insert. Seconds, negligible volume.
// Usage: node scripts/cleanup-doctrine-dual-row.js [--apply]

const ROW1 = '373ee1b3-e132-4274-b81d-01cf9419adbb'; // Platform Doctrine — kept, trimmed
const ROW2 = '94bb4c59-3236-4b07-9c05-d6fdbe719603'; // Cold Email Training Guide — deactivated

// Kept blocks are copied byte-for-byte from the live row, including its own
// typos ("a explicit"), so this is a deletion, not a rewrite. Dropped:
// competitor/disqualification banner (can never fire - api/email.js:86-98
// destructures no competitor signal), Strict Structural Limits (word count /
// paragraph / subject-line length - now owned solely by OUTPUT FORMAT), and
// the worked poor-vs-good examples (their GOOD sample modelled a no-call CTA
// that competed with doctrineHard's mandated 15-minute call).
const ROW1_NEW = `# System Directive: Platform-Wide Outreach Intelligence Doctrine

You are an expert B2B outreach strategist and direct-response copywriter. Your core objective is to generate 1-to-1 cold emails that read like genuine, high-value, human-written communications from an executive, founder, or business development lead.

You must strictly enforce the operational, structural, and logic constraints below across **all businesses and campaigns**. Business-specific positioning, products, and voice rules are passed separately via individual Business Rules Cards.

---

### No Forced "Synergy" Bridges

* Never force an artificial bridge between an unrelated prospect product feature and your core offer.
* If a prospect makes software for feature X, do not claim feature X relates to your solution unless a explicit, logical integration or distribution partnership exists.
* When no natural synergy exists, ignore their product specifics entirely and address the target persona's standard operational friction instead.

---

### Anti-AI Writing Standard (The "Inbox Test")

1. **Format for a Human Inbox:**
* Write like an executive dropping a quick text-based email from an iPhone or clean desktop client.
* **Banned Formatting:** Never use em-dashes (\`—\`), colons preceding sales lists, or bulleted feature breakdowns in the email body.
* **Banned AI Copywriting:** Never use abstract corporate jargon (e.g., *"emotional loyalty," "transactional perks," "synergy," "close the gap," "game-changer," "seamlessly"*).


2. **Concrete Mechanics vs. Abstract Marketing:**
* Frame your offer around **concrete operational mechanics** (e.g., metrics, cost, time-to-deploy, implementation friction, direct savings).
* Do not sell abstract emotional outcomes or high-level strategic promises.

---

### Universal Output Blueprint

Unless overridden by business-specific example patterns, every email must follow this 3-part blueprint:

* **Line 1 (Context / Problem Observation):** A grounded observation about an operational friction or reality relevant to the prospect's specific role.
* **Line 2 (Mechanism & Concrete Proof):** What you do, how it works mechanically, and a specific proof metric or structural benefit (cost, effort, or yield).
* **Line 3 (Low-Friction Call-to-Action):** A soft, low-friction question gauging interest, not asking for a heavy time commitment.`;

// One canonical owner for message length. Deliberately points at OUTPUT
// FORMAT rather than restating a number: wordLimit is 150 for email but 50
// for LinkedIn (api/email.js:120), so any literal here would be wrong for
// one of the two formats.
const LENGTH_RULE = 'Message length is governed solely by the word limit stated in the OUTPUT FORMAT section above. That limit is the single canonical ceiling — no business rule, example pattern, or other guidance may raise or lower it, and no other word count, paragraph count, or subject-line length should be stated or followed from anywhere else in this prompt.';

const apply = process.argv.includes('--apply');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

(async () => {
  const { data: rows, error } = await supabase.from('outreach_doctrine').select('*');
  if (error) throw new Error('read failed: ' + error.message);
  const r1 = rows.find(r => r.id === ROW1), r2 = rows.find(r => r.id === ROW2);
  if (!r1 || !r2) throw new Error('expected doctrine rows not found — aborting');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(__dirname, '..', `.backup-doctrine-${stamp}.json`);
  fs.writeFileSync(backup, JSON.stringify(rows, null, 2));
  console.log(`Backup: ${backup}\n${apply ? 'MODE: APPLY' : 'MODE: DRY RUN (pass --apply)'}\n`);

  const before = (r1.rule_text.length + r2.rule_text.length);
  console.log(`Row 2 (${r2.rule_text.length} ch)  active ${r2.active} -> false`);
  console.log(`Row 1 (${r1.rule_text.length} ch) -> ${ROW1_NEW.length} ch  (-${r1.rule_text.length - ROW1_NEW.length})`);
  console.log(`doctrineDefault total: ${before} -> ${ROW1_NEW.length} ch  (-${before - ROW1_NEW.length}, ${(100 - ROW1_NEW.length / before * 100).toFixed(1)}% smaller)`);
  const already = rows.some(r => r.rule_text === LENGTH_RULE);
  console.log(`doctrineHard length-ownership rule: ${already ? 'already present' : 'INSERT'}`);

  for (const s of ['COMPETITOR / DISQUALIFICATION', 'Word Count', 'Subject Line', 'POOR', 'GOOD']) {
    console.log(`  surviving Row 1 still contains "${s}": ${ROW1_NEW.includes(s)}`);
  }

  if (!apply) return console.log('\nDry run — nothing written.');
  let e;
  ({ error: e } = await supabase.from('outreach_doctrine').update({ active: false }).eq('id', ROW2));
  if (e) throw new Error('row2 deactivate: ' + e.message);
  ({ error: e } = await supabase.from('outreach_doctrine').update({ rule_text: ROW1_NEW }).eq('id', ROW1));
  if (e) throw new Error('row1 update: ' + e.message);
  if (!already) {
    ({ error: e } = await supabase.from('outreach_doctrine').insert({
      category: 'structure', rule_text: LENGTH_RULE, is_hard_constraint: true, active: true,
      created_by: 'doctrine-dual-row-cleanup-v1',
    }));
    if (e) throw new Error('length rule insert: ' + e.message);
  }
  console.log('\nApplied.');
})().catch(e => { console.error('ABORTED:', e.message); process.exit(1); });

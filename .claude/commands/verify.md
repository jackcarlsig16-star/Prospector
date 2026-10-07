---
description: Re-verify a sales stage - unit suites one at a time, then its real-data check if one is saved - and print counts + the restored line (see CLAUDE.md "Testing rules")
allowed-tools: [Bash, Read]
---

# Verify a stage

Argument: the stage, e.g. `goals-surface-v1 stage 5`. Follow CLAUDE.md "Testing rules" exactly.

1. Unit suites, ONE AT A TIME, each capped at 4 minutes, in this order. For each, print `<file>: <Tests line>`:
   `ls src/components/salesAnalytics/*.test.js src/components/salesAnalytics/goals/*.test.js src/components/salesAnalytics/goals/partners/*.test.js src/components/salesAnalytics/tasks/*.test.js`, then for each file:
   `CI=true perl -e 'alarm 240; exec @ARGV' npx react-scripts test --watchAll=false <file> 2>&1 | grep -E "Tests:|✕"`
   Then the server-side suites (react-scripts' Jest only collects `src/`), also one at a time:
   `ls api/sales/*.test.mjs`, then for each file:
   `perl -e 'alarm 240; exec @ARGV' node --test <file> 2>&1 | grep -E "^ℹ (tests|pass|fail)|✖"`
   Stop and report on the first failure; don't keep going.
2. Real-data check: look for `scripts/verify/<stage-slug>.*` (e.g. `scripts/verify/goals-surface-v1-stage5.cjs`).
   - If it exists: read it first, state its declared scope (users/rows it touches, runtime, cap), then run it with `perl -e 'alarm 250; exec @ARGV' node <file> <scratchpad dir>`.
   - If it doesn't: say "no saved real-data check for <stage>" - don't write one unasked.
3. If a watched table count moved, find out who wrote it before blaming the test.
4. Print a summary:
   ```
   /verify <stage>
   Unit: <n> suites, <passed>/<total> tests
   Real data: <passed>/<total> | <restored line>   (or "none saved")
   ```
Read-only unless the saved check says otherwise; never fix anything from here.

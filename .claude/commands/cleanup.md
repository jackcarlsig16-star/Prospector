---
description: Repo-wide hygiene pass — dead files, duplicate logic, scratch artifacts, and efficiency candidates. Reports findings and waits for approval before removing anything.
argument-hint: (no argument needed)
allowed-tools: [Bash, Read]
---

# Cleanup

A standing, opt-in code-hygiene pass across the whole repo — not tied to any
one SPEC or component. Run when Jack invokes `/cleanup`, never automatically.

Cleanup is **not only subtractive.** Sections 1, 3 and 4 find code that
shouldn't be there. Section 5 finds code that *is* referenced and working but
does more work than it needs to. A repo with no dead files and a query pulling
a large payload in a tight loop is not clean.

Differs from the other hygiene commands, which stay in scope for this:
- `/audit` reports broader codebase health (sizes, hex colors, AI call
  hygiene, bundle size) but never proposes removing anything.
- `/deadcode` and `/check-imports` are scoped to one named component.

`/cleanup` is repo-wide, SPEC-history-aware, and does offer to delete —
after explicit approval only.

## Scope + cost declaration — state this before running anything

Per `CLAUDE.md`'s "Diagnostic / audit script conventions", declare all three
up front, not mid-run:

- **Expected scope** — every `.js` file under `src/` and `api/` (state the
  real count from `find src api -name "*.js" | wc -l`), plus a `git status`
  and a `find` over the repo root at `-maxdepth 2`. No live DB, no network,
  no live-app calls. Local file reads only.
- **Estimated cost** — roughly 1-3 minutes of local grep. Zero Supabase
  egress and zero API spend by construction: every command below reads files
  on disk. If a step you add would query the live DB or drive the live app,
  it does not belong in `/cleanup` — that's an AUDIT.
- **Hard cap** — the scans are bounded by the repo's own file count, so there
  is no sampling decision to make. But if the pass exceeds ~3x the estimate
  above, stop and say so rather than continuing silently. That gap is exactly
  what let a 2.5-hour sweep run unnoticed.

**Rule zero: never delete something just because it looks unused without
verifying with a real grep. False positives here are expensive.** If you
can't confirm zero references with actual command output, it goes in
"needs a human look," not "safe to remove."

**Rule zero-point-five: zero callers is not sufficient evidence of dead
code.** Before marking ANYTHING safe-to-remove, check `CLAUDE.md`'s
"Landmines" section and the file's own comments for language like
"deliberately unwired", "groundwork", "inert by design", "unused by design",
"on purpose", "gated", or "stub". If the code is documented as
intentional-but-currently-unused, it goes in a separate **"zero callers but
documented as intentional — do not remove"** list, with the line you found
quoted, no matter how clean the grep looks.

```
grep -niE "deliberately unwired|groundwork|inert by design|unused by design|on purpose|gated|stub" CLAUDE.md
sed -n '1,30p' <the candidate's own file>   # check for an intent comment above it
```

## 1. Dead files — components/utils no longer imported anywhere

For every file under `src/components/` and `src/utils/`:

```
for f in $(find src/components src/utils -name "*.js"); do
  base=$(basename "$f" .js)
  # Static imports, dynamic/lazy imports WITH OR WITHOUT a .js/.jsx suffix,
  # and JSX tag usage. Searches api/ and server.js too - api/ imports from
  # src/utils/ and a src-only search reports those files as orphans.
  hits=$(grep -rlE "from ['\"].*${base}(\.jsx?)?['\"]|import\(['\"].*${base}(\.jsx?)?['\"]|require\(['\"].*${base}(\.jsx?)?['\"]|<${base}\b" src/ api/ server.js 2>/dev/null | grep -v "^$f$" | wc -l | tr -d ' ')
  [ "$hits" = "0" ] && echo "CANDIDATE: $f"
done
```

**`api/` files need a completely different check — import-shaped greps do not
work on them.** Routes under `api/` are wired by a **bare string path literal**
passed to `esHandler()` in `server.js` (e.g. `esHandler('./api/access-log.js')`),
not by an `import(...)` literal. Checking an `api/` file for import-shaped
references will report every single route as dead. This has already caused two
real false-positive incidents (`parse6senseEmail`, then a 60-file batch across
all of `api/`). See `CLAUDE.md`'s Landmines section. Use:

```
for f in $(find api -name "*.js"); do
  base=$(basename "$f" .js)
  inserver=$(grep -c "$f\|\./$f" server.js 2>/dev/null)
  byapi=$(grep -rlE "from ['\"].*${base}(\.js)?['\"]|import\(['\"].*${base}(\.js)?['\"]" api/ src/ 2>/dev/null | grep -v "^$f$" | wc -l | tr -d ' ')
  [ "$inserver" = "0" ] && [ "$byapi" = "0" ] && echo "CANDIDATE: $f"
done
```

Framework-convention files are loaded by filename, never imported, and are
NOT dead: `src/setupProxy.js`, `src/setupTests.js`, `src/index.js`,
`src/reportWebVitals.js`. Confirm any candidate against that list first.

For each surviving candidate, confirm it's genuinely orphaned (not just missed
by the regex — check for re-exports or a `React.lazy(() => import(...))` with a
computed path) before listing it.

Pay particular attention to files that look like they're an earlier
iteration of something a later SPEC replaced (e.g. a `*HomePage.js` or
`*Page.js` variant sitting next to a newer file doing the same job,
left behind when a SPEC restructured navigation or a workspace shape) -
these are the highest-value finds and worth calling out explicitly as
"superseded by X."

## 2. Duplicate/redundant logic

Look for near-identical logic that evolved in two places instead of one -
this is a different check from `/audit`'s narrow date-math/domain-parsing
greps. Look specifically for:
- A global (owner_email-keyed) version and a business-scoped (business_id
  or list_id-keyed) version of the same operation that now do almost the
  same thing, e.g. compare `src/utils/db.js` functions in pairs (the
  `getXForUser`/`getXForBusiness`/`getXForMember` families).
- Two components that render visually/functionally the same content but
  were built for different sessions/contexts (e.g. a Sidebar-rendered nav
  and a MemberShell-rendered nav with copy-pasted structure).
- Prompt-building or classification logic duplicated across `api/`
  handlers instead of living once in `api/businesses/shared.js` (or the
  equivalent shared module).

For each finding, name both locations, show enough of each (via `grep -n`
or a short `Read`) to demonstrate they're really doing the same thing, and
suggest which one should become the shared version.

## 3. Unused exports/imports

**Both greps below MUST use `-E`.** The pattern uses ERE alternation
(`(a|b|c)`), which plain `grep` reads as literal characters in BRE mode.
Without `-E` the definition lookup silently matches nothing, `$file` comes
back empty, and the exclusion `grep -v "^$file$"` degrades into filtering
blank lines instead of filtering the file being checked — so every export
reads as "used" and the whole section reports nothing, forever. This bug sat
in this file undetected and the check never produced a single real finding.

```
# Every exported name in src/ and api/
grep -rhoE "^export (async function|function|const|let|class) [A-Za-z0-9_]+" src/ api/ 2>/dev/null | awk '{print $NF}' | sort -u > /tmp/cleanup-exports.txt

# For each, count real usages outside its own file
while read -r name; do
  file=$(grep -rlE "^export (async function|function|const|let|class) $name\b" src/ api/ 2>/dev/null | head -1)
  [ -z "$file" ] && continue
  hits=$(grep -rl "\b${name}\b" src/ api/ server.js 2>/dev/null | grep -v "^$file$" | wc -l | tr -d ' ')
  [ "$hits" = "0" ] && echo "UNUSED EXPORT: $name ($file)"
done < /tmp/cleanup-exports.txt
```

**Smoke-test the check before trusting a clean result.** A zero-finding run
is indistinguishable from a broken run, which is how the `-E` bug survived.
Run both of these first:

```
# KNOWN-DEAD seed - must print exactly 1. If it prints 0, the check is broken.
grep -rl "\bsubscribeToAccounts\b" src/ api/ server.js | grep -v "^src/utils/db.js$" | wc -l
# ^ expect 0 external files -> so the check must CLASSIFY it as unused.
#   subscribeToAccounts is a permanent zero-caller landmine (see Rule 0.5),
#   which makes it a stable seed: it will never gain a caller.

# KNOWN-USED seed - must print 1 or more. If it prints 0, the check is broken.
grep -rl "\bURGENCY_OPTIONS\b" src/ api/ server.js | grep -v "^src/utils/assignHelper.js$" | wc -l
```

If the known-dead seed doesn't classify as unused, or the known-used seed
classifies as unused, **stop and fix the script — do not report "nothing
found."**

Distinguish two very different results before reporting:
- **Truly dead** — zero external callers AND the only occurrence inside its
  own file is the definition line (`grep -c "\bNAME\b" "$file"` returns 1).
- **Merely over-exported** — zero external callers but real internal use
  (count > 1). The `export` keyword is superfluous; the code is alive. Report
  these as one summary line, not as individual findings. Removing the keyword
  is churn with near-zero payoff.

Then apply Rule 0.5 to every "truly dead" item before it reaches the 🟢 list.

Also flag unused imports: for each file, check every named import against
the rest of that same file's body for at least one other use.

## 4. Leftover test/scratch artifacts

Stray files left in the repo root or scratch locations from debugging
sessions - NOT database test data (that's cleaned up per-SPEC already and
out of scope here). Look for:

```
find . -maxdepth 2 -iname "*.tmp.js" -not -path "./node_modules/*"
# The \( \) are required: -o binds looser than the implicit -a, so without
# them the *-test.js branch carries NONE of the exclusions and matches
# straight into node_modules.
find . -maxdepth 2 \( -iname "*-test.js" -o -iname "test-*.js" \) -not -path "./node_modules/*" -not -path "./src/*"
find . -maxdepth 2 -iname "*.png" -newer package.json -not -path "./node_modules/*" -not -path "./build/*"
git status --short | grep '^??' # untracked files worth a second look
```

Cross-check anything found against recent git log / handoffs to confirm
it's genuinely scratch work and not something intentionally kept untracked
(e.g. this repo has legitimate untracked migrations/scripts from other
SPECs that are deliberately not committed - don't flag those as scratch
artifacts just because they're untracked; check what they actually are).

## 5. Efficiency scan — REPORT ONLY

Everything above finds code that shouldn't exist. This section finds
referenced, working code that does more work than it needs to.

**This section never removes or rewrites anything, and never reaches the 🟢
list.** Efficiency changes are behavior changes and need the same
live-verified bar as any other behavior change, which a heuristic pattern
scan structurally cannot provide. These five checks produce *candidates*.
Every candidate needs a real AUDIT with real numbers before anyone scopes a
fix. Label every line in the output `REPORT ONLY — verify before scoping a fix`.

**Rule 0.5 applies here too, and it fires often.** Several of these patterns
are deliberate, documented tradeoffs (freshness over caching, for instance).
Check the surrounding comments before reporting anything as a problem —
report it as a candidate, and quote the comment if one exists.

**H1 — same table + same column set fetched from 2+ sites.**
```
grep -rhoE "from\('[a-z_]+'\)\.select\('[^']*'\)" src/ api/ | sort | uniq -c | sort -rn | awk '$1>1'
```
Then locate each with `grep -rn "<the matched string>" src/ api/`. Two callers
pulling identical columns for the same key inside one request path is a
redundant-fetch candidate.

**H2/H5 — unfiltered AND unlimited reads.** Query chains here span multiple
lines, so a line-based grep misses most of them. This reconstructs the chain
from `.from(` to the terminating `;`:
```
for f in $(find src api -name "*.js"); do
  perl -0777 -ne '
    while (/(?:supabase|sb)\s*\n?\s*\.from\(\s*'"'"'([a-z_]+)'"'"'\s*\)((?:[^;]|\n)*?);/g) {
      my ($tbl,$chain)=($1,$2); my $pre=substr($_,0,pos($_)); my $ln=($pre=~tr/\n//)+1;
      next unless $chain =~ /\.select\(/;
      next if $chain =~ /\.eq\(|\.in\(|\.match\(|\.filter\(|\.limit\(|ingle\(\)/;
      print "$ARGV:$ln\t$tbl\tREPORT ONLY - unfiltered + unlimited read\n";
    }' "$f"
done
```
Cheap today is not the test — a table with 0 rows returning 2 bytes still
scales linearly the moment it holds data.

**H3 — await on a DB/network call inside a loop body (N+1 candidate).**
```
for f in $(find src api -name "*.js"); do
  perl -0777 -ne '
    while (/\b(for\s*\(|while\s*\(|\.forEach\(|\.map\(\s*async)/g) {
      my $pre=substr($_,0,pos($_)); my $ln=($pre=~tr/\n//)+1;
      my $body=substr($_,pos($_),600); $body =~ s/\n\s*\n.*//s;
      print "$ARGV:$ln\tREPORT ONLY - await in loop, no Promise.all nearby\n"
        if ($body =~ /await\s+(?:supabase|sb)\s*\n?\s*\.from\(|await\s+fetch\(/ && $body !~ /Promise\.all/);
    }' "$f"
done | sort -u
```

**H4 — query whose filters are ALL literals (result cannot vary per item).**
If every `.eq()` argument is a constant, the result is identical on every
iteration and every request. Inside a per-account or per-generation path,
that's a hoist-or-batch candidate.
```
for f in $(find src api -name "*.js"); do
  perl -0777 -ne '
    while (/(?:supabase|sb)\s*\n?\s*\.from\(\s*'"'"'([a-z_]+)'"'"'\s*\)((?:[^;]|\n)*?);/g) {
      my ($tbl,$chain)=($1,$2); my $pre=substr($_,0,pos($_)); my $ln=($pre=~tr/\n//)+1;
      next unless $chain =~ /\.select\(/;
      my @eqs = $chain =~ /\.eq\(([^)]*)\)/g; next unless @eqs;
      my $lit = 1;
      for my $a (@eqs) { $lit = 0 unless $a =~ /^\s*'"'"'[^'"'"']*'"'"'\s*,\s*('"'"'[^'"'"']*'"'"'|true|false|-?\d+)\s*$/; }
      print "$ARGV:$ln\t$tbl\tREPORT ONLY - all-literal filters, run-level data\n" if $lit;
    }' "$f"
done
```

**Seed cases — these three are real and must all be caught.** If a change to
this section stops flagging any of them, the pattern is wrong:
- H1 must flag `from('business_profiles').select('assay_criteria, outreach_rules')`
  appearing twice (`api/email.js` + `src/utils/db.js`).
- H4 must flag `api/email.js`'s `outreach_doctrine` read. Note its comment
  documents the refetch as deliberate — correct behavior is to report it as a
  candidate *and quote that comment*, not to call it a defect.
- H2/H5 must flag `src/utils/db.js`'s `handoff_intel` read.

## Report format

Do not delete anything while producing this report.

```
## Cleanup pass — <YYYY-MM-DD>

Scope run: <file count> files, <what was and wasn't touched>, <elapsed>.

### 🟢 Safe to remove (zero references, confirmed via grep, Rule 0.5 clean)
- path:line — why flagged, the exact grep command + output, and an explicit
  "CLAUDE.md/comment intent check: clean" for each

### 🔒 Zero callers but documented as intentional — DO NOT REMOVE
- path:line — the CLAUDE.md line or source comment that says so, quoted

### 🟡 Needs a human look (looks unused but touches something sensitive)
- path:line — why flagged, what makes it sensitive, what you couldn't rule out

### Duplicate/redundant logic
- location A vs location B — what they both do, which should be the shared version

### ⚡ Efficiency candidates — REPORT ONLY, none of these are findings yet
- path:line — which heuristic fired, and any comment documenting it as deliberate

### Scratch artifacts
- path — what it looks like it's from
```

Then STOP and ask: "Remove the 🟢 safe-to-remove items, review the 🟡 list
item by item, or cancel?" Never remove anything without that explicit
go-ahead, and never touch a 🟡 item without individual confirmation on
that specific item. **Never act on a ⚡ item from this pass at all** — those
go to an AUDIT with real numbers first.

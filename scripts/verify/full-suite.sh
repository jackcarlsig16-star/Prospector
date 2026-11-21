#!/bin/sh
# Every node test file, then every Jest suite, ONE file per command with a 4-minute cap each (CLAUDE.md Testing rules).
# Usage: sh scripts/verify/full-suite.sh <out-dir>   -> <out-dir>/node.out, jest.out, summary.txt
OUT="${1:?out dir}"; mkdir -p "$OUT"; : > "$OUT/node.out"; : > "$OUT/jest.out"
for f in $(git ls-files -co --exclude-standard '*.test.mjs' | sort -u); do
  r=$(perl -e 'alarm 240; exec @ARGV' node --test "$f" 2>&1 | grep -E "^ℹ (pass|fail)" | tr '\n' ' '); echo "$f $r" >> "$OUT/node.out"
done
for f in $(git ls-files -co --exclude-standard 'src/*.test.js' | sort -u); do
  r=$(CI=true perl -e 'alarm 240; exec @ARGV' npx react-scripts test --watchAll=false "$f" 2>&1 | grep -E "^Tests:|^Test Suites:" | tr '\n' ' '); echo "$f | $r" >> "$OUT/jest.out"
done
{
  awk '{p+=$4; f+=$7} END {printf "node: pass %d fail %d files %d\n", p, f, NR}' "$OUT/node.out"
  grep -v "fail 0" "$OUT/node.out" | sed 's/^/  NODE NOT GREEN: /'
  printf "jest: passed %s of %s suites\n" "$(grep -o 'Tests: *[^|]*' "$OUT/jest.out" | grep -o '[0-9]* passed' | awk '{p+=$1} END {print p+0}')" "$(wc -l < "$OUT/jest.out" | tr -d ' ')"
  grep -E "failed|\| *$" "$OUT/jest.out" | sed 's/^/  JEST NOT GREEN: /'
} > "$OUT/summary.txt"
cat "$OUT/summary.txt"

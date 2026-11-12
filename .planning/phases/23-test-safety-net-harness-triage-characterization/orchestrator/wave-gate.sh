#!/usr/bin/env bash
# Wave gate for phase 23 (sequential mode). Usage: bash wave-gate.sh <wave> <outdir>
# Runs on Node 22.16.0. Read-only for src/; writes only to <outdir> (scratchpad).
set -u
WAVE="$1"; OUT="$2"; mkdir -p "$OUT"
export PATH="/c/Users/jackc/AppData/Local/nvm/v22.16.0:$PATH"
cd /c/Users/jackc/WebstormProjects/crypto-snipe-bot || exit 1
echo "node $(node --version)  HEAD $(git rev-parse --short HEAD)  wave $WAVE"
fail=0
echo "== build gate: tsc --noEmit x3"
for c in tsconfig.json tsconfig.bot.json dashboard/tsconfig.json; do
  if node node_modules/typescript/bin/tsc --noEmit -p "$c" > "$OUT/tsc-$(echo $c | tr '/.' '__').log" 2>&1; then echo "  ok   $c"; else echo "  FAIL $c"; tail -20 "$OUT/tsc-$(echo $c | tr '/.' '__').log"; fail=1; fi
done
echo "== test gate: full railed suite (unit + integration + realpath), JSON durations"
START=$(date +%s)
node node_modules/vitest/vitest.mjs run --project unit --project integration --project realpath --reporter=verbose --reporter=json --outputFile.json="$OUT/vitest.json" > "$OUT/vitest.log" 2>&1
TEST_EXIT=$?
echo "  exit $TEST_EXIT  wall $(( $(date +%s) - START ))s"
grep -E "Test Files|Tests |Errors|Unhandled|nonLoopbackAllowed|telegramAllowed" "$OUT/vitest.log" | tail -12
[ $TEST_EXIT -eq 0 ] || fail=1
echo "== mock gates"
node node_modules/ts-node/dist/bin.js scripts/check-realpath-mocks.ts > "$OUT/realpath-mocks.log" 2>&1; R1=$?; tail -2 "$OUT/realpath-mocks.log"; echo "  check:realpath-mocks exit $R1"
node node_modules/ts-node/dist/bin.js scripts/check-vi-mock-paths.ts > "$OUT/vi-mock.log" 2>&1; R2=$?; tail -2 "$OUT/vi-mock.log"; echo "  check:vi-mock exit $R2"
[ $R1 -eq 0 ] && [ $R2 -eq 0 ] || fail=1
echo "== signing census and mutant manifest"
node node_modules/ts-node/dist/bin.js scripts/check-signing-census.ts > "$OUT/census.log" 2>&1; R3=$?; tail -2 "$OUT/census.log"; echo "  check:census exit $R3"
node node_modules/ts-node/dist/bin.js scripts/red-proof-conversions.ts --check-manifest > "$OUT/manifest.log" 2>&1; R4=$?; tail -1 "$OUT/manifest.log"; echo "  --check-manifest exit $R4"
[ $R3 -eq 0 ] && [ $R4 -eq 0 ] || fail=1
echo "== register"
for st in partial consolidation triage; do
  node node_modules/ts-node/dist/bin.js .planning/audit/tools/check.ts --stage $st > "$OUT/check-$st.log" 2>&1; rc=$?
  echo "  --stage $st exit $rc :: $(grep -iE 'PASS|FAIL' "$OUT/check-$st.log" | tail -1)"
  if [ "$st" != triage ] && [ $rc -ne 0 ]; then fail=1; fi
done
echo "== src clean"
S=$(git status --porcelain src scripts); [ -z "$S" ] && echo "  clean" || { echo "  DIRTY: $S"; fail=1; }
echo "GATE_FAIL=$fail TEST_EXIT=$TEST_EXIT"

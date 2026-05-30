---
phase: 20-going-live-ops-hardening
plan: 03
subsystem: anti-rug detector + dry-run timestamp wiring
tags: [anti-rug, dry-run, antirug-live-gate, coalesce-idempotent, ops-live, d-antirug-live-gate-code, 7-day-floor]

# Dependency graph
requires:
  - 20-01 (setAntirugDryRunStarted prepared statement + chain_state.antirug_dry_run_started column)
  - 20-02 (checkAntiRugLiveGate consumer — reads chain_state.antirug_dry_run_started)
provides:
  - src/anti-rug/detector.ts startChainAntiRugListener first-time-start timestamp record
  - Production data source for Plan 20-02 preflight checkAntiRugLiveGate 7-day floor
affects: [20-04-bot-wiring-killswitch (preflight call chain), operator dry-run → live-mode transition]

# Tech tracking
tech-stack:
  added: []  # zero new dependencies
  patterns:
    - "COALESCE-on-conflict UPSERT idempotence: first non-NULL value wins; subsequent calls don't overwrite"
    - "vi.mock src/utils/db with stub prepared statements to prevent test-driven production db contamination"
    - "Math.floor(Date.now() / 1000) unix-seconds conversion for sqlite INTEGER timestamp persistence"

key-files:
  created:
    - "test/unit/anti-rug/dryRunTimestamp.test.ts (4 tests / 327 LOC) — verifies first-call records, re-call no-op, cross-chain isolation, fake-timer T0+1d invariance"
  modified:
    - "src/anti-rug/detector.ts (+8 LOC: 1 import-line extension + 6-line insertion block + 1 blank line) — adds setAntirugDryRunStarted.run(chainName, nowSec, nowSec) at lines 579-585 inside startChainAntiRugListener body, after chainState init (line 577) and before WS-fallback branch (line 587)"
    - "test/unit/anti-rug/detectorRegistry.test.ts (+12 LOC stub-mock block) — added vi.mock for src/utils/db (Rule 1 fix-in-flight)"
    - "test/unit/anti-rug/detectorEvaluator.test.ts (+12 LOC stub-mock block) — same (Rule 1 fix-in-flight)"
    - "test/integration/anti-rug/multiSignalEnd2End.test.ts (+7 LOC extension of existing db mock) — added setAntirugDryRunStarted + getAntirugDryRunStarted (Rule 1 fix-in-flight)"
    - "test/integration/anti-rug/wsReconnectBackfill.test.ts (+7 LOC extension of existing db doMock) — same (Rule 1 fix-in-flight)"
    - "test/integration/anti-rug/botWiring.test.ts (+7 LOC extension of existing db mock, defensive) — same (Rule 1 fix-in-flight)"

key-decisions:
  - "Plan 20-03 (2026-05-24) — full vi.mock of src/utils/db in dryRunTimestamp.test.ts: initial test-isolation attempt set process.env.DB_PATH at file-load time to redirect the production singleton to a tmp file. Failed because vitest module-load order isn't guaranteed within a worker — other test files that import src/utils/db transitively (e.g., via src/anti-rug/detector.ts → src/utils/db.ts) can bind the singleton to data/bot.db BEFORE our test file's module-level DB_PATH override executes. Replaced with a full vi.mock that wires the real prepared-statement SQL against an in-memory better-sqlite3 instance. This eliminates singleton-cache contamination entirely regardless of worker test order."
  - "Plan 20-03 (2026-05-24) — Rule 1 cascading fix-in-flight: my detector.ts insertion of setAntirugDryRunStarted.run() caused 4 OTHER existing tests (detectorRegistry, detectorEvaluator, multiSignalEnd2End, wsReconnectBackfill) to start writing to the production data/bot.db singleton via their startChainAntiRugListener invocations. Verified by resetting production chain_state.antirug_dry_run_started=NULL, running each test file, then checking the column — it became non-null after each run. Fix: added/extended vi.mock('../../../src/utils/db', ...) in all 5 affected files (4 broken + 1 defensive in botWiring.test.ts). Production DB now stays clean across the full 704-test sweep."
  - "Plan 20-03 (2026-05-24) — Production data/bot.db cleanup: prior GREEN-phase verification runs wrote real test-driven timestamps to chain_state.antirug_dry_run_started (1779656622 = 2026-05-24T21:03:42Z and 1779657270 = 21:14:30Z). Reset to NULL out-of-band via raw SQL UPDATE so the operator's first real bot boot post-merge records the correct first-time timestamp via the new detector.ts insertion. (This contamination was the entire reason for the Rule 1 fix-in-flight cascade — it surfaced the test isolation gap that wouldn't otherwise have been visible.)"

patterns-established:
  - "When adding a db.ts prepared-statement call inside a hot code path (e.g., a per-chain lifecycle entry point), audit ALL existing tests that drive that code path and ensure they vi.mock src/utils/db with the new export stubbed. Otherwise the new call writes to the production singleton from every test run."
  - "For tests that need to verify db.ts behavior end-to-end (not just stub it), use vi.mock with in-memory better-sqlite3 instance + real-shape prepared statement SQL (copied verbatim from src/utils/db.ts). This is more reliable than DB_PATH override because it bypasses the singleton-cache race entirely."

requirements-completed: [OPS-LIVE-07]

# Metrics
duration: ~20min
completed: 2026-05-24
---

# Phase 20 Plan 20-03: Anti-Rug Dry-Run Timestamp Wiring Summary

## One-liner

Insert `setAntirugDryRunStarted.run(chainName, nowSec, nowSec)` at `startChainAntiRugListener` entry inside `src/anti-rug/detector.ts` so Plan 20-02's `checkAntiRugLiveGate` has a real-source-of-truth timestamp for the D-ANTIRUG-LIVE-GATE-CODE 7-day floor check; COALESCE-on-conflict UPSERT semantics ensure operator restart does NOT reset the floor.

## Performance

- **Duration:** ~20 min (RED at 17:02 → GREEN at 17:09 → fix-in-flight at 17:22)
- **Started:** 2026-05-24T21:00:00Z (plan read)
- **Completed:** 2026-05-24T21:22:39Z (fix commit)
- **Tasks:** 1/1 (TDD task with RED + GREEN + REFACTOR cycle; REFACTOR was the Rule 1 fix-in-flight)
- **Files modified:** 6 (1 source + 5 tests)
- **Files created:** 1 (test/unit/anti-rug/dryRunTimestamp.test.ts)
- **Net LOC added:** ~363 (327 new test + 8 source + 28 across 5 existing-test mock extensions)

## Accomplishments

- **src/anti-rug/detector.ts** receives a 6-line insertion at `startChainAntiRugListener` entry (lines 579-585), preceded by a 1-line import extension (line 97). The block calls `setAntirugDryRunStarted.run(chainName, nowSec, nowSec)` where `nowSec = Math.floor(Date.now() / 1000)`. Three positional binds: chain name, last_updated_ts (now), antirug_dry_run_started (now). Per the Plan 20-01 COALESCE clause in db.ts, only the FIRST non-NULL value for `antirug_dry_run_started` per chain persists; subsequent calls update `last_updated_ts` only.
- **Inserted exactly where the plan specified** — AFTER the chainState init block (`const state = chainState.get(chainName)!;` at line 577) and BEFORE the `if (!ctx.wsProvider)` HTTP-fallback branch (line 587). No other lines in detector.ts modified.
- **test/unit/anti-rug/dryRunTimestamp.test.ts** ships 4 tests covering all 4 plan `<behavior>` invariants:
  - Test 1: First call records antirug_dry_run_started near current unix ts (±5s tolerance)
  - Test 2: Re-call is COALESCE-idempotent (preserves original ts; 1.1s sleep proves the second wall-clock ts would differ if not idempotent)
  - Test 3: Cross-chain isolation (bsc registration records its own ts; eth ts unaffected)
  - Test 4: Fake-timer T0 + 1day re-call → stored ts stays at T0 (controlled-clock idempotence proof)
- **Plan 20-02 `checkAntiRugLiveGate` integration unblocked**: production `data/bot.db` `chain_state.antirug_dry_run_started` will now be populated on first ETH bot run post-merge (column currently NULL after our test-pollution cleanup). The 7-day floor check at preflight time will read this value via `getAntirugDryRunStarted.get(chain).antirug_dry_run_started` and enforce `(now - antirug_dry_run_started) >= 7 days` when `<CHAIN>_ANTIRUG_LIVE_EXECUTE=true` is set.
- **Full test sweep:** 535 unit + 169 integration = 704 active tests / 29 skips / 0 failures across 76 files. tsc clean ×3 (tsconfig.json + tsconfig.bot.json + dashboard/tsconfig.json).

## Task Commits

Plan 20-03 followed the TDD cycle with an inline Rule 1 fix-in-flight commit:

1. **Task 1 RED — failing tests for dry-run timestamp record** — `214bc39` (test)
2. **Task 1 GREEN — insert setAntirugDryRunStarted.run() at startChainAntiRugListener entry** — `3659a32` (feat)
3. **Task 1 Rule 1 fix-in-flight — mock src/utils/db in 5 cascading anti-rug tests** — `9c2cd5f` (fix)

**Plan metadata:** _(this SUMMARY + STATE + ROADMAP commit lands after this file is written)_

## Files Created/Modified

### Source change (1 file)

**`src/anti-rug/detector.ts`** (8 net LOC added across 2 hunks):

```
Line  97 (import block extension):
  - import { upsertChainState, getChainState } from '../utils/db';
  + import { upsertChainState, getChainState, setAntirugDryRunStarted } from '../utils/db';

Lines 579-585 (insertion inside startChainAntiRugListener body, after line 577
'const state = chainState.get(chainName)!;' and before line 587 'if (!ctx.wsProvider)'):

    // Phase 20 / D-ANTIRUG-LIVE-GATE-CODE — record first-time dry-run start
    // timestamp per chain. The UPSERT uses COALESCE so subsequent calls do
    // NOT overwrite the original timestamp (operator restart does not reset
    // the 7-day floor). Plan 20-02 preflight checkAntiRugLiveGate reads
    // this timestamp to enforce <CHAIN>_ANTIRUG_LIVE_EXECUTE=true gate.
    const nowSec = Math.floor(Date.now() / 1000);
    setAntirugDryRunStarted.run(chainName, nowSec, nowSec);
```

`git diff src/anti-rug/detector.ts | grep -cE "^[-+]"` = **12 lines** (under the 15-line plan budget).

### Test files created (1)

**`test/unit/anti-rug/dryRunTimestamp.test.ts`** (327 LOC, 4 `it()` blocks, 0 `.skip`):
- Module-level vi.mock for `src/utils/db` wires real-shape prepared statements (CREATE TABLE + setAntirugDryRunStarted + getAntirugDryRunStarted SQL copied verbatim from Plan 20-01's src/utils/db.ts) against an in-memory better-sqlite3 instance. Production singleton never touched.
- Module-level vi.mock for `src/utils/logger`, `src/anti-rug/lpBaseline`, `src/utils/notifier`, `src/api/ws/broadcaster`, `src/utils/provider` keeps the startChainAntiRugListener side-effect surface tight to the new db-write under test.
- Tests 1-4 cover all 4 plan `<behavior>` invariants verbatim with D-04 observable-effect rigor (each assertion reads back the stored value via `mockGetAntirugDryRunStarted.get(chain)`).

### Test files modified (5 — all Rule 1 fix-in-flight cascade)

**`test/unit/anti-rug/detectorRegistry.test.ts`** — Added vi.mock for `src/utils/db` with 4 stubbed prepared statements (upsertChainState, getChainState, setAntirugDryRunStarted, getAntirugDryRunStarted). 11/11 tests still pass.

**`test/unit/anti-rug/detectorEvaluator.test.ts`** — Same vi.mock addition. 20/20 tests still pass.

**`test/integration/anti-rug/multiSignalEnd2End.test.ts`** — Extended existing `vi.mock('../../../src/utils/db', ...)` factory to include setAntirugDryRunStarted + getAntirugDryRunStarted. 9/9 tests still pass.

**`test/integration/anti-rug/wsReconnectBackfill.test.ts`** — Extended existing `vi.doMock('../../../src/utils/db', ...)` factory to include the 2 new exports. 9/9 tests still pass.

**`test/integration/anti-rug/botWiring.test.ts`** — Defensive: extended existing db vi.mock to include the 2 new exports. This test doesn't directly call startChainAntiRugListener, but lives in the same anti-rug folder and could trip the missing-export error if the test surface ever expands. Cost is 7 LOC, benefit is forward-compat against silent future regression.

## Decisions Made

**Carried forward from CONTEXT.md / RESEARCH.md (no novel plan-time decisions):**

- **D-ANTIRUG-LIVE-GATE-CODE** (CONTEXT.md / RESEARCH.md §11) — 7-day floor enforced via `chain_state.antirug_dry_run_started` column; detector records timestamp on first-time start per chain; COALESCE-on-conflict ensures operator restart does NOT reset the floor. Implemented exactly as specified.
- **D-04 observable-effect rigor** — each test assertion reads back the stored value, not a code-path-executed proxy metric.
- **D-PREFLIGHT-FLOW** / **D-MID-RUN-CHECK** — Plan 20-02 (already shipped) consumes the timestamp written by this plan; Plan 20-04 (not yet started) calls preflight at boot.

**Plan-time decisions (forced by the Rule 1 cascade):**

- Use `vi.mock` with in-memory better-sqlite3 for the new dryRunTimestamp.test.ts instead of DB_PATH override. Reasoning: vitest module-load order within a worker is not guaranteed, so any test that transitively loads `src/utils/db` BEFORE our file's `process.env.DB_PATH = TEST_DB_PATH` executes wins the singleton cache. The in-memory mock bypasses the singleton entirely.
- Add minimal stub mocks (vi.fn no-ops, not real in-memory db) to the 5 existing anti-rug tests. Reasoning: those tests verify registry/dispatch/topic-filter/lifecycle behavior, not db persistence — they don't NEED real db; they just need the import to resolve so detector.ts can run.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] dryRunTimestamp.test.ts DB_PATH override race condition**
- **Found during:** GREEN-phase verification (initial test approach used `process.env.DB_PATH = tmpDbPath` in `beforeAll`, then noticed production `data/bot.db` had been written to during the test run)
- **Issue:** vitest module-level imports (and the cached singleton state inside `src/utils/db.ts`) executed BEFORE `beforeAll` hooks ran. Result: the singleton bound to `data/bot.db` on first import (from any sibling test in the same worker), and the test's `beforeAll` DB_PATH override happened too late to redirect. Tests still passed (the SQL via `mockGetAntirugDryRunStarted.get('eth')` returned the row written through the production singleton) but EVERY test run wrote a fresh `antirug_dry_run_started` timestamp to the operator's real database — silently advancing the 7-day live-gate clock.
- **Fix:** Rewrote dryRunTimestamp.test.ts to use `vi.mock('../../../src/utils/db', ...)` with an in-memory `Database(':memory:')` and prepared statements whose SQL is COPIED verbatim from `src/utils/db.ts` (Plan 20-01). The production singleton is never touched. Verified by reset → re-run → re-query: production `chain_state.antirug_dry_run_started` stays NULL.
- **Files modified:** `test/unit/anti-rug/dryRunTimestamp.test.ts`
- **Committed in:** `9c2cd5f` (folded into the cascading-fix commit since both fixes share root cause and verification chain)

**2. [Rule 1 - Bug] Existing anti-rug tests now write to production data/bot.db via startChainAntiRugListener**
- **Found during:** GREEN-phase verification (after fixing #1, full unit suite STILL contaminated production DB — investigation showed `detectorRegistry.test.ts` and `detectorEvaluator.test.ts` weren't mocking `src/utils/db` at all, and my new `setAntirugDryRunStarted.run()` call was reaching the production singleton from every `startChainAntiRugListener(ctx)` invocation in those tests' 11 + 20 = 31 test bodies)
- **Issue:** Before Plan 20-03, `startChainAntiRugListener` did NOT write to `chain_state` from any code path reached by these unit tests (it only set up the WS subscription, which was already mocked). So the tests had no need to mock `src/utils/db`. My change broke that assumption. Result: every run of those test suites contaminated the operator's real database.
- **Fix:** Added a minimal `vi.mock('../../../src/utils/db', ...)` block to `detectorRegistry.test.ts` and `detectorEvaluator.test.ts` (12 LOC each) that stubs the 4 prepared statements `detector.ts` now imports (upsertChainState, getChainState, setAntirugDryRunStarted, getAntirugDryRunStarted) as no-ops. The tests verify shape/dispatch/topic-filter behavior, not db persistence, so vi.fn no-ops are sufficient.
- **Files modified:** `test/unit/anti-rug/detectorRegistry.test.ts`, `test/unit/anti-rug/detectorEvaluator.test.ts`
- **Committed in:** `9c2cd5f`

**3. [Rule 1 - Bug] Integration anti-rug tests' existing db mocks missing the new exports**
- **Found during:** Integration suite run during GREEN-phase verification (18 tests failed with `[vitest] No "setAntirugDryRunStarted" export is defined on the "../../../src/utils/db" mock. Did you forget to return it from "vi.mock"?`)
- **Issue:** `multiSignalEnd2End.test.ts` and `wsReconnectBackfill.test.ts` already had vi.mock factories for `src/utils/db` (since they need other db symbols stubbed for integration-shape tests), but their export list didn't include the new `setAntirugDryRunStarted` + `getAntirugDryRunStarted`. When detector.ts imported the new symbol, vitest's strict mock-shape enforcement raised `No "X" export defined` immediately.
- **Fix:** Extended each file's existing db vi.mock factory to include the 2 new exports (7 LOC each, additive — no logic changed).
- **Files modified:** `test/integration/anti-rug/multiSignalEnd2End.test.ts`, `test/integration/anti-rug/wsReconnectBackfill.test.ts`
- **Committed in:** `9c2cd5f`

**4. [Rule 2 - Defensive] botWiring.test.ts db vi.mock extended even though no test currently breaks**
- **Found during:** Cascade audit during fix-in-flight (after fixing the 4 broken cases, ran `Grep "vi.mock.*utils/db"` to find all anti-rug test files with db mocks → confirmed botWiring.test.ts also mocks `src/utils/db` but doesn't currently fail because it doesn't directly call startChainAntiRugListener in its 18 tests)
- **Issue:** Future Plan 20-04 might extend botWiring.test.ts to cover the new preflight() call path; if that ever invokes startChainAntiRugListener through bot.ts, the test would surface the missing-export error immediately.
- **Fix:** Added the 2 new exports (7 LOC) to botWiring.test.ts's existing db mock as forward-compat defense. Zero cost; eliminates the silent future regression.
- **Files modified:** `test/integration/anti-rug/botWiring.test.ts`
- **Committed in:** `9c2cd5f`

---

**Total deviations:** 4 auto-fixed (3 bugs + 1 defensive Rule 2 hardening), all cascading from the single Plan 20-03 detector.ts insertion.
**Impact on plan:** Production `data/bot.db` was contaminated twice during verification runs (1779656622 + 1779657270 unix timestamps written to `chain_state.antirug_dry_run_started`); both reset to NULL out-of-band so the operator's first real bot boot records the correct first-time ts via the new insertion. NO scope creep beyond the immediate fallout of my change.

## Issues Encountered

**Test isolation gap** — discovered by reading production `data/bot.db` between test runs. Without that audit, the contamination would have shipped silently and shortened the operator's 7-day live-gate clock by however many test runs happened post-merge. The Rule 1 cascade fix prevents this from recurring.

**Vitest mock-shape enforcement** — vitest 4.1.1 strictly validates that vi.mock factory return objects expose every named import the production module references. This is a feature, not a bug — it caught the integration test mock gap immediately. The fix is trivial (add the new exports to each existing factory).

## Authentication Gates

None. Plan 20-03 is pure code addition with no live-network or external-auth dependencies. All tests are fully mocked.

## User Setup Required

None. The new code path runs automatically on `startChainAntiRugListener(ctx)` for each chain in `ENABLED_CHAINS`. No new env vars introduced.

## Hand-off Notes

### Plan 20-04 (bot.ts kill-switch + preflight call wiring)

This plan's insertion provides the timestamp that Plan 20-04's preflight call at `bot.ts:880` reads via `checkAntiRugLiveGate(chain)` (Plan 20-02 export). Specifically:

- On first bot boot post-merge per chain: `startChainAntiRugListener(ctx)` fires for each enabled chain → `setAntirugDryRunStarted.run(chain, now, now)` writes a non-NULL `antirug_dry_run_started` to `chain_state` for that chain.
- On subsequent boots: same call fires but COALESCE-on-conflict preserves the original timestamp.
- When operator flips `<CHAIN>_ANTIRUG_LIVE_EXECUTE=true` and restarts: Plan 20-04 calls `preflight(registry)` at bot.ts:880, which calls `checkAntiRugLiveGate(chain)` for each chain. The check reads `getAntirugDryRunStarted.get(chain).antirug_dry_run_started`, computes `now - that_ts`, and FATAL-exits if `< 7 days` (per D-ANTIRUG-LIVE-GATE-CODE).
- No coordination needed between Plan 20-04 and this plan — the db column is the integration boundary.

### Verification of integration boundary

After this plan ships and bot is run on a real chain, the operator can verify by:

```bash
# After first ETH bot boot post-merge:
node -e "const db=require('better-sqlite3')('data/bot.db'); console.log(db.prepare('SELECT chain, antirug_dry_run_started FROM chain_state').all());"
# Expected: [{ chain: 'eth', antirug_dry_run_started: <recent unix ts> }]

# After bot restart 1 hour later:
node -e "const db=require('better-sqlite3')('data/bot.db'); console.log(db.prepare('SELECT chain, antirug_dry_run_started FROM chain_state').all());"
# Expected: SAME timestamp as before (not 1-hour-later); COALESCE preserved.
```

## Verification Evidence

- `grep -c "import.*setAntirugDryRunStarted" src/anti-rug/detector.ts` → **1** (>= 1) ✓
- `grep -c "setAntirugDryRunStarted.run" src/anti-rug/detector.ts` → **1** (== 1) ✓
- `grep -n "setAntirugDryRunStarted.run" src/anti-rug/detector.ts` → **line 585** (between startChainAntiRugListener start ~552 and `if (!ctx.wsProvider)` at 587) ✓
- `grep -c "Math.floor(Date.now() / 1000)" src/anti-rug/detector.ts` → **9** (>= 1; the new line is one of them, the others are pre-existing in heartbeat/reconnect/backfill paths) ✓
- `test/unit/anti-rug/dryRunTimestamp.test.ts` has **4 `it()` blocks, 0 `.skip`** ✓
- `npx vitest run --project unit test/unit/anti-rug/dryRunTimestamp.test.ts` → **4/4 passing** ✓
- `npx vitest run --project unit test/unit/anti-rug/detectorRegistry.test.ts` → **11/11 passing** (no regression) ✓
- `npx vitest run --project unit test/unit/anti-rug/` → **77/77 passing** across 9 files ✓
- `npx vitest run --project unit` → **535/535 passing** across 55 files ✓
- `npx vitest run --project integration` → **169/169 passing / 29 skip** across 27 files ✓
- Combined: **704 active tests / 0 failed** across 82 files (76 active) ✓
- `npx tsc --noEmit -p tsconfig.json` → clean ✓
- `npx tsc --noEmit -p tsconfig.bot.json` → clean ✓
- `npx tsc --noEmit -p dashboard/tsconfig.json` → clean ✓
- `git diff src/anti-rug/detector.ts | grep -cE "^[-+]"` → **12 lines** (< 15 budget) ✓
- Production `data/bot.db` `chain_state.antirug_dry_run_started=NULL` after full sweep ✓ (operator's first real bot boot post-merge will record the correct first-time ts via the new insertion)

## Commits

| # | Hash | Type | Description |
|---|------|------|-------------|
| 1 | `214bc39` | test | RED — 4 failing tests for anti-rug dry-run timestamp record |
| 2 | `3659a32` | feat | GREEN — insert setAntirugDryRunStarted.run() at startChainAntiRugListener entry (initial pass, with file-load-time DB_PATH attempt in test) |
| 3 | `9c2cd5f` | fix | Rule 1 fix-in-flight — replace dryRunTimestamp.test.ts with vi.mock isolation; add db mocks to 5 cascading anti-rug tests; production data/bot.db now stays clean across full sweep |

## Self-Check: PASSED

- [x] `src/anti-rug/detector.ts` line 97 imports `setAntirugDryRunStarted` — VERIFIED via grep
- [x] `src/anti-rug/detector.ts` line 585 calls `setAntirugDryRunStarted.run(chainName, nowSec, nowSec)` — VERIFIED via grep
- [x] Insertion is INSIDE startChainAntiRugListener (line 585 between function start ~552 and `if (!ctx.wsProvider)` at 587) — VERIFIED
- [x] `test/unit/anti-rug/dryRunTimestamp.test.ts` exists with 4 `it()` blocks, 0 `.skip` — VERIFIED
- [x] 4/4 dryRunTimestamp tests pass — VERIFIED
- [x] 11/11 detectorRegistry tests pass (Phase 19 baseline preserved) — VERIFIED
- [x] 77/77 anti-rug unit tests pass — VERIFIED
- [x] 535/535 full unit suite passes (+4 net from this plan) — VERIFIED
- [x] 169/169 integration suite passes (29 skips unchanged from Plan 20-02 baseline) — VERIFIED
- [x] 704/704 combined active sweep passes / 0 failed — VERIFIED
- [x] tsc clean ×3 — VERIFIED
- [x] git diff src/anti-rug/detector.ts < 15 lines — VERIFIED (12)
- [x] Commit `214bc39` exists in git log — VERIFIED
- [x] Commit `3659a32` exists in git log — VERIFIED
- [x] Commit `9c2cd5f` exists in git log — VERIFIED
- [x] Production `data/bot.db` chain_state.antirug_dry_run_started=NULL after full sweep — VERIFIED
- [x] No unexpected deletions in any commit — VERIFIED via `git diff --diff-filter=D --name-only HEAD~3 HEAD`

## Next Plan Readiness

- **Plan 20-04 (bot.ts wiring + kill-switch)** is unblocked: the integration boundary for `checkAntiRugLiveGate` is now active. Plan 20-04 can call `preflight(registry)` at `bot.ts:880`, which delegates to `checkAntiRugLiveGate(chain)` (Plan 20-02 export), which reads `getAntirugDryRunStarted.get(chain).antirug_dry_run_started` (Plan 20-01 export), which is now populated by this plan's `setAntirugDryRunStarted.run()` insertion in `startChainAntiRugListener`.
- Wave-3 of Phase 20 is **partially complete** (this plan ships; Plan 20-04 still pending). Wave-4 (20-05 dashboard endpoints + 20-06 banner UI) depends on Plan 20-04 completion.
- The Rule 1 fix-in-flight has established a pattern for future plans: any time a new db.ts prepared statement is added to a hot code path, audit ALL existing tests that drive that code path. The 5-file cascade in this plan is the canonical example.

---
*Phase: 20-going-live-ops-hardening*
*Plan: 20-03*
*Completed: 2026-05-24*

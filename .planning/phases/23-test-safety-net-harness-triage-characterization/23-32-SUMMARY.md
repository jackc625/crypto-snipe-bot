---
phase: 23-test-safety-net-harness-triage-characterization
plan: 32
subsystem: testing
tags: [vitest, realpath, triage, boot, dashboard, onRestart, ac-37, diagnostics_channel, ethers]

requires:
  - phase: 23-24
    provides: the in-process boot recipe, the shutdown pin (operator 1A) and the confirmed real Stop/Start path
  - phase: 23-10
    provides: the restart triage files, their claims and bootListeners
  - phase: 23-19
    provides: the AC-37 gate and the allow-list entry removed here
  - phase: 23-16
    provides: scripts/triage-report.ts and how triage-evidence.json is generated
provides:
  - "fixtures/AUD-API-002-restart.ts withRealBoot: a real in-process startMultiChainBot with its own dashboard API, real login, and an end through the real SIGINT listener pinned to how far the cleanup gets"
  - "AUD-API-002 and AUD-BUY-008 triage tests on the real boot; dashboard Start runs the bot's real onRestart; no copy of onRestart and no src/ text read left under test/"
  - "AC-37 gate allow list back to the 3 named dashboard tests"
  - "triage-evidence.json regenerated (only change: the one recorded title)"
affects: [phase-24-capital-fixes, phase-28-test-hygiene, 23-26-phase-close]

actuals:
  tokens: 17207
  tasks: 2
  commits: 3
plan_head_before: 461f6621b92f6489bcbb73a4371bfaf9b56e43aa
plan_head_after: adb298f33e7fef7859b7d071933968eb935a84f0

tech-stack:
  added: []
  patterns:
    - "withRealBoot(sc, body, { armedToken }): boot in process, run the body, end through the boot's SIGINT listener; listeners, diagnostics channel and the exit spy always restored"
    - "Shutdown pin that holds under every finding's fix: exactly one open socket closes on the signal (the boot context's provider), counted on the node rather than named"

key-files:
  created: []
  modified:
    - test/realpath/triage/fixtures/AUD-API-002-restart.ts
    - test/realpath/triage/AUD-API-002.test.ts
    - test/realpath/triage/AUD-BUY-008.test.ts
    - test/unit/sourceTextGate.test.ts
    - .planning/audit/inputs/rails-test-edits.json
    - .planning/audit/inputs/triage-evidence.json
    - .planning/audit/findings/AUD-API-002.json
    - .planning/audit/findings/AUD-BUY-008.json
    - .planning/phases/23-test-safety-net-harness-triage-characterization/deferred-items.md

key-decisions:
  - "Operator ruling before 23-19 (choice \"Allow-list it (Recommended)\"; the label was the orchestrator's): the restart fixture went on the AC-37 allow list (23-19 commit 1018e79). Superseded by the next ruling."
  - "Operator ruling during wave 13 (choice \"Fix it now (Recommended)\"; the label was the orchestrator's, given after it corrected its own earlier claim that this phase never boots the bot): if 23-24's in-process boot works with no harness gap, move the restart triage tests to the real onRestart and remove the exception. 23-24 confirmed it works; this plan did it with no harness gap."
  - "Every test in both files moved to the real boot, controls included, so each file's comparison runs on one setup; claims, knownBug IDs, correct/observed values and every assertion unchanged"
  - "The fixture's shutdown pin checks only facts that hold under every finding's fix (5 cleanup lines, server refused, timer cleared, exactly one socket closed, every later warning a reconnect start, database open, no exit call), so AUD-BUY-008's stacked handlers and AUD-ANTIRUG-001's last-writer provider never decide it"
  - "The two stale triage notes (they described the mirror) refreshed through set-triage.ts with the outcome unchanged, so Phase 24 reads the real evidence path"
  - "Explicit 60 s limits on the four boot tests (5.71 s of 15 s at worst in the full run, under half; chosen because each test now pays a boot and AUD-TESTI-029 lets a timed-out test leak into the next)"

patterns-established:
  - "A triage test that needs a private closure of startMultiChainBot boots the bot in process (withRealBoot) instead of copying the closure"

requirements-completed: [CHAR-06]

coverage:
  - id: D1
    description: "AUD-API-002 stop-disarms-antirug and start-does-not-rearm-antirug on a real in-process boot; Start runs the real onRestart (three 'DEX listener restarted' lines asserted)"
    requirement: CHAR-06
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-API-002.test.ts (2 tests, three identical JSON runs)"
        status: pass
      - kind: other
        ref: "fix-shaped mutants stop-keeps-antirug (both claims looks fixed) and restart-rearms-antirug (Start claim looks fixed); src restored byte-identical"
        status: pass
    human_judgment: false
  - id: D2
    description: "AUD-BUY-008 restart-stacks-reconnect-loop and its control on a real in-process boot"
    requirement: CHAR-06
    verification:
      - kind: integration
        ref: "test/realpath/triage/AUD-BUY-008.test.ts (2 tests, three identical JSON runs)"
        status: pass
      - kind: other
        ref: "fix-shaped mutant close-handler-once (claim looks fixed, control green); src restored byte-identical"
        status: pass
    human_judgment: false
  - id: D3
    description: "AC-37 gate allow list holds exactly the 3 dashboard tests; the old fixture's src/bot.ts read fails it"
    requirement: CHAR-06
    verification:
      - kind: unit
        ref: "test/unit/sourceTextGate.test.ts (4 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "triage-evidence.json regenerated from three identical runs and the rail run; only the recorded title differs"
    verification:
      - kind: other
        ref: "scripts/triage-report.ts over r1/r2/r3 (113/113 each, 93 tuples) and rail (147/147); git diff --no-index against the committed file"
        status: pass
    human_judgment: false
  - id: D5
    description: "Full railed suite, register checks, test-identity, type checks, mock gates, commit check, manifest"
    verification:
      - kind: other
        ref: "vitest run --project unit --project integration --project realpath (210 files, 1559/1559); check.ts partial/consolidation/triage RESULT PASS; npm run check:commits RESULT PASS"
        status: pass
    human_judgment: false

duration: 31min
completed: 2026-11-12
status: complete
---

# Phase 23 Plan 32: Restart Triage Tests on the Real Boot Summary

**The AUD-API-002 and AUD-BUY-008 triage tests now boot the real bot in process on the fake chain and drive its own dashboard Stop and Start routes, so Start runs the real private onRestart instead of a hash-pinned copy; the fixture reads no source file, and the AC-37 gate's allow list is back to the SPEC's 3 dashboard tests.**

## Performance

- **Duration:** 31 min (2026-11-12T20:06:30Z to 20:37:47Z)
- **Tasks:** 2 of 2
- **Files modified:** 9 (no file created)

## Accomplishments

- **The real boot in the fixture.** `withRealBoot(sc, body, { armedToken })` in `fixtures/AUD-API-002-restart.ts` reuses 23-24's recipe from `test/realpath/ordering/boot.test.ts` (left unchanged): contract code at the checker and every allowlist address (`deployBootContracts`), `BOOT_OVERRIDES` (DASHBOARD_HOST 127.0.0.1, DASHBOARD_PORT 0, a 27-character API key), the bound port from the `tracing:net.server.listen` diagnostics channel, the real login, then the body, then the end through the boot's own SIGINT listener. `onRestartMirror`, `onRestartSource`, `assertOnRestartUnchanged`, `ON_RESTART_SHA256` and `openDashboardWithRestart` are gone. `bootListeners` (AUD-ANTIRUG-001) and `chainRoute` are byte-identical.
- **Boot setup facts, checked in every test:**
  - one SIGINT and one SIGTERM listener added;
  - one server, asked for `{ port: 0, host: '127.0.0.1' }` and bound on 127.0.0.1;
  - no warning and no exit call;
  - `antirug.listener.armed-no-positions` and no "Resuming exit monitor" line (no position at boot, so AUD-ANTIRUG-025 cannot take part);
  - the only error line is at most one `antirug.backfill.gap-detected` (AUD-ANTIRUG-024).
- **The end (operator 1A, as at 23-24).** The subscription traffic settles first. Then the five cleanup lines in order, graceMs 8000, and the caught `Cannot find module './utils/db'`. The server stops listening and a new connect gets ECONNREFUSED. The armed exit timer is cleared. Exactly one open socket closes. Every later warning is a reconnect-loop start, no socket opens, the database is still open and exit is never called. The fixture throws "TEST-ENVIRONMENT LIMIT LIFTED in test/realpath/triage/fixtures/AUD-API-002-restart.ts" if the limit is lifted (proven by a mutant, below). The listeners the boot added are removed, also on failure.
- **Both triage files converted, controls included.** Each test creates its scenario with `BOOT_OVERRIDES`, deploys the contracts and runs inside `withRealBoot`. AUD-API-002 buys after the boot through the listeners the boot started. Its Stop and Start go through the booted bot's routes. Start answers `{ ok: true, chain: 'eth', status: 'running', warnings: [] }` and logs "DEX listener restarted" once per DEX from the real onRestart (asserted). knownBug comes first in each test, and every assertion is unchanged.
- **AC-37.** The fixture's allow-list entry is removed. The gate passes with only the 3 dashboard tests, and the old fixture put back fails it with `test/realpath/triage/fixtures/AUD-API-002-restart.ts:43 readFileSync(../../../../src/bot.ts)` (checked, then restored).
- **Run evidence regenerated** exactly as 23-16 did. Its only change is the one recorded title (diff below).

## Task Commits

1. **Task 1: the restart triage tests on a real in-process boot and the real onRestart** - `945958f` (test)
2. **Task 2: AC-37 allow list back to the 3 dashboard tests; triage evidence regenerated; deferred item resolved** - `b59d7f1` (test)
3. **Explicit 60 s limits on the four boot tests** - `adb298f` (test)

**Plan metadata:** this SUMMARY commit, then the STATE/ROADMAP commit.

## Claims Re-proven on the New Setup

Each mutant edited one src file in place, then ran AUD-API-002, AUD-BUY-008 and AUD-ANTIRUG-001 with the JSON reporter. Afterwards the file was restored from a byte backup. Each restore was checked three ways: the bytes equal the backup (the CRLF working copy), `git hash-object` equals the HEAD blob, and `git status --porcelain src` is empty. Nothing under src/ was committed.

| Mutant (file) | Fix shape | Result |
|---|---|---|
| `stop-keeps-antirug` (src/api/routes/chains.ts) | Stop calls `removeAllListeners({ address: factory, topics: [PairCreated/PoolCreated] })` per DEX instead of `removeAllListeners()` | AUD-API-002 `stop-disarms-antirug` and `start-does-not-rearm-antirug` both fail "AUD-API-002 now behaves correctly: remove this marker (it looks fixed)"; the other 5 tests pass |
| `restart-rearms-antirug` (src/bot.ts onRestart) | the real onRestart also awaits `startChainAntiRugListener(ctx)` | only `start-does-not-rearm-antirug` reads looks fixed; the other 6 pass. The mirror could not show this: it failed "onRestart changed" on any onRestart edit |
| `close-handler-once` (src/bot.ts startDexListener) | the boot-path close handler is registered once per DEX and socket (a set on the raw socket) | only AUD-BUY-008 `restart-stacks-reconnect-loop` reads looks fixed; its control and the other 5 pass |
| `cleanup-survives-require` (src/bot.ts shutdown cleanup; not a finding) | the cleanup's `require('./utils/db')` replaced by a no-op closeDb, so the cleanup reaches shutdown.complete and exit(0) | the four boot tests fail "TEST-ENVIRONMENT LIMIT LIFTED in test/realpath/triage/fixtures/AUD-API-002-restart.ts ... (exit calls [0])"; AUD-ANTIRUG-001 (no boot) passes |

## What the Real Boot Changes, Worked Out

These came from a temporary dump at the end of the shutdown pin. It was never committed, and the fixture was restored from a byte copy afterwards. None of these changes a claim's meaning, so no checkpoint was needed.

- **Boot error line:** one `antirug.backfill.gap-detected` and the alert "[GAP DETECTED] eth missed 21000000 blocks". This is AUD-ANTIRUG-024, a fresh database seen at boot. It is allowed only as that op, at most once.
- **Anti-rug lifecycle armed at boot:** the boot arms the anti-rug WS lifecycle (its own close handler and heartbeat) before any buy. In AUD-API-002 the buy's register adds a second anti-rug close handler, which the bootListeners version never had. The claims are unchanged: the subscription count, the evaluation and the health state read the same values.
- **Socket drop in AUD-BUY-008:** the drop also runs the anti-rug reconnect loop. In the control that is 1 original socket, 3 DEX-loop providers and 1 anti-rug provider, so 5 sockets were opened and 4 are open before the signal. Its log line carries no DEX name and its alert has another text, so it is in neither count. The DEX counts are unchanged (1 per DEX, 2 per DEX after a restart), and so is the factory subscription count (1 each).
- **What the signal closes:**
  - In AUD-API-002 the boot context still holds the shared original provider, so open sockets go 1 to 0. The reconnect starts are 2 V2, 1 V3 and anti-rug in test 1; in test 2 it is 4 V2, 2 V3 and anti-rug, because Start stacked the handlers (AUD-BUY-008, visible but not asserted).
  - In AUD-BUY-008 the context ends on the V3 loop's provider (it wrote last, AUD-ANTIRUG-001), so the signal closes that one socket (4 to 3, or 7 to 6 after a restart) and one V3 reconnect start follows.
  - The pin counts that one closed socket rather than naming the provider, so it holds under both bugs and their fixes.
- **Held calls (AUD-TX-028):** nothing is held at any provider read. Every wait is a mined block, fake time or real loopback I/O.
- **Resume order (AUD-ANTIRUG-025, AUD-BUY-038):** no position exists at boot, so nothing is resumed. The resume order is not asserted here; it is pinned only in boot.test.ts.

## Triage Evidence Diff

Regenerated with the 23-16 command: three runs of `vitest run --project realpath test/realpath/triage --reporter=json`, then the rail run of the 13 files carrying a closes-finding marker. `scripts/triage-report.ts` wrote the evidence and the report to scratch paths. The scratch report is not 23-TRIAGE-REPORT.md, which is untouched.

- **Runs:** 113/113 each, 100 / 99 / 103 s. The generator printed "3 runs agree: 93 tuples from 56 files, 113 tests; population 61 of 61 accounted for (52 confirmed, 8 fixed, 1 unreproduced, 0 NOT-A-BUG); rail tests passed 8".
- **Rail run:** 147/147. 23-16 had 146; plan 23-31 added one processLock test, 7 to 8.
- **Ledgers:** all four have nonLoopbackAllowed 0 and telegramAllowed 0.
- **The diff,** the whole of it:

```
@@ -237,7 +237,7 @@
       "finding": "AUD-API-002",
       "file": "test/realpath/triage/AUD-API-002.test.ts",
-      "title": "AUD-API-002: dashboard Stop removes the anti-rug subscription and Start does not bring it back > start-does-not-rearm-antirug: after the real Stop and Start routes (Start running the pinned onRestart mirror), the node still holds no anti-rug subscription for the pair and a liquidity pull is never evaluated",
+      "title": "AUD-API-002: dashboard Stop removes the anti-rug subscription and Start does not bring it back > start-does-not-rearm-antirug: after the real Stop and Start routes (Start running the real onRestart of an in-process boot), the node still holds no anti-rug subscription for the pair and a liquidity pull is never evaluated",
```

The committed file is byte-identical to the generator's output. The scratch report differs from 23-TRIAGE-REPORT.md in about 200 lines. I checked why: the committed report predates the operator's TRIAGE-REVIEW-01 reply (it says "needs your acknowledgement" where the register now records the acknowledgements), and it carries the two notes refreshed here. That is expected, and the report is not regenerated by this plan.

## Register Changes

- **No severity changed and no finding registered.**
- The triage blocks of AUD-API-002 and AUD-BUY-008 kept outcome confirmed and test_id. Only their `note` was rewritten through `.planning/audit/tools/set-triage.ts`, because both described the source-pinned mirror and now describe the real boot and the two fix signals.
- The review record acknowledges by ID and the evidence carries no notes, so neither TRIAGE-REVIEW-01 nor check.ts --stage triage needed anything.
- AUDIT-FINDINGS.md and OPERATOR-DECISIONS.md re-rendered byte-identical, because render.ts does not render triage blocks.

## Files Created/Modified

- `test/realpath/triage/fixtures/AUD-API-002-restart.ts` - withRealBoot, deployBootContracts, BOOT_OVERRIDES and the pinned SIGINT end; the mirror is gone; bootListeners and chainRoute unchanged
- `test/realpath/triage/AUD-API-002.test.ts` - both tests on the real boot; one title renamed; 60 s limits
- `test/realpath/triage/AUD-BUY-008.test.ts` - both tests on the real boot; 60 s limits
- `test/unit/sourceTextGate.test.ts` - the fixture's allow-list entry removed (nothing else)
- `.planning/audit/inputs/rails-test-edits.json` - the rename record (entry 53, found_in_plan 23-32)
- `.planning/audit/inputs/triage-evidence.json` - regenerated
- `.planning/audit/findings/AUD-API-002.json`, `AUD-BUY-008.json` - triage notes (set-triage.ts)
- `deferred-items.md` - the allow-list entry set to `status: resolved` with how (not deleted)

## Decisions Made

See frontmatter key-decisions. The two operator rulings are quoted there with the orchestrator's "(Recommended)" labels marked as the orchestrator's.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] The two triage notes still described the mirror**
- **Found during:** Task 1
- **Issue:** the register's AUD-API-002 and AUD-BUY-008 triage notes said the Start callback was "a source-pinned mirror of the private src/bot.ts onRestart". After the conversion that is false, and Phase 24 reads these notes. No renamed title is referenced there.
- **Fix:** rewrote the notes through set-triage.ts (same outcome, so the block is merged and every other field kept), then re-rendered. The finding files were not in the plan's file list.
- **Files modified:** .planning/audit/findings/AUD-API-002.json, AUD-BUY-008.json
- **Verification:** check.ts partial, consolidation and triage PASS; the diff is the note line only; AUDIT-FINDINGS.md byte-identical
- **Committed in:** 945958f

**2. [Rule 2 - Missing critical] Explicit test limits**
- **Found during:** the Task 2 timing check
- **Issue:** each converted test now pays a real boot. The slowest was 5.71 s of the 15 s realpath limit in the full run (38 percent, 2.25 s alone). That is under the half-limit rule, but a timed-out realpath test keeps running into the next one (AUD-TESTI-029).
- **Fix:** 60 s per boot test (the boot.test.ts value), with the measured alone and full-run times in a comment. Titles unchanged.
- **Files modified:** test/realpath/triage/AUD-API-002.test.ts, AUD-BUY-008.test.ts
- **Verification:** three JSON runs identical after the change; scratch tsc clean
- **Committed in:** adb298f

**3. [Plan addition] A fourth mutant** (`cleanup-survives-require`) proves the fixture's own "TEST-ENVIRONMENT LIMIT LIFTED" signal. 23-24 proved it only for boot.test.ts.

---

**Total deviations:** 2 auto-fixed (both Rule 2) and 1 added proof. **Impact:** no scope change. src/, test/realpath/harness/**, test/realpath/scenarios/driver.ts, test/rails/** and test/unit/rails/** are unchanged (`git diff --name-only 461f662..HEAD` lists only the 9 files above).

## Issues Encountered

- My first edit of AUD-BUY-008.test.ts used a re-indent script that mis-nested the file. I restored it from HEAD and wrote the converted file whole; nothing of it was committed.
- A temporary dump patch failed twice on shell quoting: backslashes are halved on this Windows bash path. The fixture was restored from a byte copy each time (cmp equal), and the dump ran from a script written with the Write tool.
- A title I first wrote held an apostrophe inside a single-quoted string. I reworded it before any run.
- **Not changed by instruction:** the `FOLLOW_LEVELS` comment in sourceTextGate.test.ts still says levels 1, 2 and 4 "report the same single hit on the whole current tree (the allow-listed fixture)". That was 23-19's measurement; the tree now has no hit. The orchestrator allowed only the allow-list entry to change, so the comment is left for whoever next edits the gate.
- **test-identity does not judge the rename:** AUD-API-002.test.ts was created in 23-10, after the identity base 7d0b7b3, so it is not a base file. The rename is recorded in rails-test-edits.json anyway, for the audit trail.

## Gates

- **Full railed suite,** Node 22.16.0, run as a foreground command (the harness moved it to the background after 180 s; it ran to its end and was read from its own output files):
  - tree b59d7f1: 210 files, **1559/1559** (unit 951, integration 264, realpath 344), 0 failed, 0 skipped, 0 todo, no unhandled error, wall **197 s**;
  - ledger run-20261112T203014-16016-a8301d: **nonLoopbackAllowed 0, telegramAllowed 0**;
  - the final commit adb298f only adds test limits; the three restart files were re-run on it three times.
- **Timing under the full run:**
  - AUD-API-002: 5.71 s and 3.36 s;
  - AUD-BUY-008: 1.39 s and 0.29 s;
  - AUD-ANTIRUG-001 (unchanged): 1.74 / 1.08 / 0.38 s;
  - sourceTextGate: 4.36 s of its 60 s.
  - No hook in these files.
- **Repeatability (AC-10):** the three restart files, three JSON runs: 7 tests, 7 passed, 6 knownBug records, digest 4bec2f8d in each, 0 unhandled.
- **Register checks:** check.ts --stage partial, consolidation and triage RESULT PASS fail 0 after each commit. No re_audit row was needed: none of the edited files has a ledger row.
- **test-identity** --base 7d0b7b3 on the full report: missing 0, missing_file 0, not_executed 0, dynamic_mismatch 0, frozen_reset_not_passed 0; 12 renames honoured (all earlier plans').
- **Type checks:** tsc --noEmit clean on tsconfig.json, tsconfig.bot.json and dashboard/tsconfig.json; a scratch strict tsconfig over all of test/realpath/** (the 3 changed files listed) is clean.
- **Mock and census gates:** check:realpath-mocks 0 violations (44 vi uses, 104 files); check:vi-mock 660 calls 0 violations; check:census 23 sites 0 problems; spawnSites green.
- **npm run check:commits:** RESULT PASS, 34 commits judged after babd7e4, 0 recording paths changed or removed. This plan touched no recording.
- **red-proof-conversions --check-manifest:** MANIFEST-OK rows 36 files 11 guards 1.
- **src/:** `git status --porcelain src` empty after every mutant and at the end.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Phase 24:**
  - The AUD-API-002 fix now turns these tests to "looks fixed" instead of "onRestart changed". A Stop fix flips both claims; an onRestart re-arm flips the Start claim.
  - The AUD-BUY-008 fix flips its claim.
  - Nothing is left on the allow list for Phase 24.
- **23-26:** its evidence byte-compare should match the committed file, because this plan regenerated it the same way. The 23-33 plan is next.

## Self-Check: PASSED

- FOUND: test/realpath/triage/fixtures/AUD-API-002-restart.ts, AUD-API-002.test.ts, AUD-BUY-008.test.ts, test/unit/sourceTextGate.test.ts, .planning/audit/inputs/rails-test-edits.json, triage-evidence.json, both finding files, deferred-items.md
- FOUND: commits 945958f, b59d7f1, adb298f (ancestors of HEAD); 3 commits measured from the plan ledger (461f662..adb298f)
- No mirror symbol under test/ (`grep -rnE "ON_RESTART_SHA256|onRestartMirror|onRestartSource" test` empty); the gate names no fixture; AUD-ANTIRUG-001.test.ts unchanged against HEAD

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-12*

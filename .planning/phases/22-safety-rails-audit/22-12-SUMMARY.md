---
phase: 22-safety-rails-audit
plan: 12
subsystem: testing
tags: [safe-03, singleton-guard, duplicate-load, nonce-authority, tsconfig, red-proofs, nac-06]

requires:
  - phase: 22-safety-rails-audit (22-08)
    provides: scripts/verify-prod-untouched.ts wrapper, spawnRailedChild, rail ledger
  - phase: 22-safety-rails-audit (22-11)
    provides: child-process rails and the spawn gate the new probe runs under
provides:
  - src/guards/epoch.ts EPOCH (module-graph epoch sentinel)
  - src/guards/singleton.ts registerSingleton(name, rawIdentity, epoch) with the D-05 rules and error code SINGLETON_DUPLICATE
  - registerSingleton calls in nonceAuthority, exitManager, exitEngine and anti-rug/detector
  - forceConsistentCasingInFileNames in all three tsconfigs
  - test/rails/probes/duplicateLoadProbe.cjs, test/unit/guards/singleton.test.ts, test/unit/guards/tsconfigCasing.test.ts
  - .planning/audit/inputs/reset-files-base.json (37 files frozen at the audit base SHA)
  - red-proofs/22-12-1 and 22-12-2
affects: [22-15, 22-16, 22-29, phase-26, phase-27]

actuals:
  tokens: 10729
  tasks: 3
  commits: 3
plan_head_before: 5e490a5584de441bdfcbdf6d89b02234ab16fa2a
plan_head_after: 0cd3fdaccf2f44d521599183f680544495fe8797

tech-stack:
  added: []
  patterns:
    - "Module identity registry on globalThis under Symbol.for, keyed by fs.realpathSync.native, compared against an epoch object so a whole-graph reset is allowed and a single-module reload is not"
    - "A duplicate-load proof counts only with the exact error code AND the loaded alias as secondIdentity; anything else prints OTHER_ERROR and fails"
    - "A test junction into src/ is removed with unlinkSync and a non-recursive rmdirSync, so no delete can walk through the link into real source"

key-files:
  created:
    - src/guards/epoch.ts
    - src/guards/singleton.ts
    - test/rails/probes/duplicateLoadProbe.cjs
    - test/unit/guards/singleton.test.ts
    - test/unit/guards/tsconfigCasing.test.ts
    - .planning/audit/inputs/reset-files-base.json
    - .planning/phases/22-safety-rails-audit/red-proofs/22-12-1-singleton-guard.txt
    - .planning/phases/22-safety-rails-audit/red-proofs/22-12-2-singleton-epoch.txt
  modified:
    - src/utils/nonceAuthority.ts
    - src/utils/exitManager.ts
    - src/exitEngine.ts
    - src/anti-rug/detector.ts
    - tsconfig.bot.json
    - dashboard/tsconfig.json
    - test/unit/bot/buyNonceLock.test.ts
    - .planning/audit/inputs/rails-test-edits.json

key-decisions:
  - "22-12: the junction probe maps the aliased module's own imports back to the real folder. The module under test still loads through the junction, but its dependencies do not, so ../guards/epoch resolves and a module that imports another guarded module reports its own alias rather than tripping on the dependency first"
  - "22-12: the probe's junction points into src/, so it is removed with unlinkSync and a non-recursive rmdirSync; a recursive delete could walk through the link and delete real source files"
  - "22-12: test/unit/bot/buyNonceLock.test.ts needed a logger-mock accommodation that the guard did not cause (same TypeError with the guard neutralised); under the rails DB_PATH is a fresh temp file, so migrateSchema now runs logger.info, which the child-only mock lacked; recorded in rails-test-edits.json, no assertion changed"

patterns-established:
  - "Each guarded module adds exactly two imports and one registerSingleton call, nothing else"

requirements-completed: [SAFE-03]

coverage:
  - id: D1
    description: "A second load of any of the four lock or registry modules throws SINGLETON_DUPLICATE, through a Windows casing alias (Vitest and plain Node), a directory junction under --preserve-symlinks, and a delete require.cache reload (AC-20)"
    requirement: SAFE-03
    verification:
      - kind: unit
        ref: "test/unit/guards/singleton.test.ts (29 tests, wrapped, verdict untouched); plain-Node children through test/rails/probes/duplicateLoadProbe.cjs"
        status: pass
      - kind: other
        ref: ".planning/phases/22-safety-rails-audit/red-proofs/22-12-1-singleton-guard.txt (16 cases fail with the guard neutralised; the 13 normal-load and reset cases stay green)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A normal single load is unaffected, all four modules load together in one process, and vi.resetModules and vi.doMock re-imports are allowed by the epoch rule (D-05)"
    requirement: SAFE-03
    verification:
      - kind: unit
        ref: "test/unit/guards/singleton.test.ts#plain Node: one normal load is not refused; #all four guarded modules load once each; #a vi.resetModules re-import; #a vi.doMock plus vi.resetModules re-import"
        status: pass
      - kind: other
        ref: ".planning/phases/22-safety-rails-audit/red-proofs/22-12-2-singleton-epoch.txt (8 cases fail with the epoch rule removed)"
        status: pass
    human_judgment: false
  - id: D3
    description: "forceConsistentCasingInFileNames is true in tsconfig.json, tsconfig.bot.json and dashboard/tsconfig.json (AC-21)"
    requirement: SAFE-03
    verification:
      - kind: unit
        ref: "test/unit/guards/tsconfigCasing.test.ts (3 tests, wrapped)"
        status: pass
      - kind: other
        ref: "tsc --noEmit for tsconfig.json, tsconfig.bot.json and dashboard/tsconfig.json: all clean"
        status: pass
    human_judgment: false
  - id: D4
    description: "The 37 base-SHA reset/doMock files still exist, pass, and keep their base it() counts; the 3 files added in Phase 22 are listed and run separately (AC-22, NAC-04)"
    requirement: SAFE-03
    verification:
      - kind: integration
        ref: "wrapped run of test/unit/guards + 37 frozen + 3 added: 41 files, 324 tests, none skipped, verdict untouched, manifest equal"
        status: pass
    human_judgment: false
  - id: D5
    description: "The four money-path module diffs add two imports and one registerSingleton call each and change no other line (P6, NAC-06)"
    requirement: SAFE-03
    verification:
      - kind: other
        ref: "git diff audit_base..HEAD --numstat on the four modules: 3 added, 0 removed each"
        status: pass
    human_judgment: true
    rationale: "NAC-06 is a judgment item; 22-29 re-audits these diffs, as the plan's prohibition P6 requires"

duration: 11min
completed: 2026-11-09
status: complete
---

# Phase 22 Plan 12: Duplicate-load Guard on the Lock and Registry Singletons Summary

**Loading the nonce authority, sell lock, ExitWorker or anti-rug registry a second time in one process now throws `SINGLETON_DUPLICATE`, whether the second copy comes through a Windows casing alias, a directory junction or a `require.cache` reload. A normal load and a whole-graph `vi.resetModules` re-import still work, and every tsconfig now enforces import casing. This is the planned rail for AUD-TX-004 (RC-17, a second lock-module copy); its register status stays with the 22-29 re-audit.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-11-09T03:25:39Z
- **Completed:** 2026-11-09T03:36:50Z
- **Tasks:** 3/3
- **Files:** 16 (8 created, 8 modified)

## Accomplishments

- **Guard.** `registerSingleton` keeps its registry on `globalThis[Symbol.for('crypto-snipe-bot.singletonRegistry')]`, keyed by `fs.realpathSync.native`. A different raw identity always throws, a same-identity reload in the same epoch throws, and a same-identity load in a new epoch is allowed. It reads no env var, imports no Vitest code, and exports no reset or disable hook.
- **Four modules guarded.** `nonceAuthority`, `exitManager`, `exitEngine` and `antiRugDetector` each gained exactly two imports and one `registerSingleton` call (`--numstat`: 3 added, 0 removed for each). The new imports come after each module's existing imports, so the existing import order is unchanged.
- **Real second loads, real modules.** The casing alias is proven in-process and in a plain Node child. The junction and `require.cache` cases are proven in plain Node. A case passes only when the code is exactly `SINGLETON_DUPLICATE` and `secondIdentity` is the alias just loaded.
- **No false positive.** One normal load in plain Node prints `LOADED_ONCE` for each module, and all four load together in one process with dependents first. `vi.resetModules` and `vi.doMock` re-imports are allowed, and the test asserts the module really was evaluated again in a new epoch.
- **Casing flag.** `forceConsistentCasingInFileNames: true` is in all three tsconfigs; `tsc --noEmit` is clean for all three, including the dashboard.
- **Frozen reset set.** `reset-files-base.json` holds the 37 files at `audit_base_sha` with their base `it()` counts, and the 3 Phase 22 additions separately (`test/integration/dbInit.test.ts`, `test/unit/guards/singleton.test.ts`, `test/unit/rails/dbTripwireSrc.test.ts`). Result of the wrapped run: 41 files, 324 tests passed, none skipped, every frozen file at its base count.
- **RED proofs (AC-18):**

| # | Change (working tree only) | Run | RED result | GREEN |
|---|----------------------------|-----|------------|-------|
| 1 | `registerSingleton` returns at once | singleton.test.ts | 16 failed: in-process alias resolved; children printed `LOADED_TWICE` for casing, junction and cache on all four modules. The 13 normal-load and reset cases stayed green | 29/29 |
| 2 | every existing entry refused, epoch ignored | singleton.test.ts -t resetModules | 8 failed with `SINGLETON_DUPLICATE` on the reset re-import | 8/8 |

Both RED runs had wrapper verdict `untouched` with the manifest equal; `src/guards/singleton.ts` was restored with its sha256 equal, and `git status --porcelain src` is empty.

## Task Commits

1. **Task 1: epoch and singleton registry, nonceAuthority guarded (tracer).** `ac4cd88` (feat). The tracer verify ran end-to-end: 7 tests, verdict untouched, `tsc` clean.
2. **Task 2: three more modules, tsconfig flags, frozen reset set.** `b3617f6` (feat)
3. **Task 3: RED proofs.** `0cd3fda` (docs)

**Plan metadata:** the docs commit that follows this SUMMARY.

## Files Created/Modified

- `src/guards/epoch.ts`, `src/guards/singleton.ts`: the sentinel and the registry.
- `src/utils/nonceAuthority.ts`, `src/utils/exitManager.ts`, `src/exitEngine.ts`, `src/anti-rug/detector.ts`: registration only.
- `tsconfig.bot.json`, `dashboard/tsconfig.json`: casing flag.
- `test/rails/probes/duplicateLoadProbe.cjs`, `test/unit/guards/singleton.test.ts`, `test/unit/guards/tsconfigCasing.test.ts`: the proofs.
- `test/unit/bot/buyNonceLock.test.ts`: logger-mock accommodation (see Deviations).
- `.planning/audit/inputs/reset-files-base.json`, `.planning/audit/inputs/rails-test-edits.json`, `red-proofs/22-12-1..2`.

## Decisions Made

See `key-decisions`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] A frozen file failed for a reason other than the guard**
- **Found during:** Task 2, first run of the 37 reset/doMock files.
- **Issue:** `test/unit/bot/buyNonceLock.test.ts` failed all 3 cases with `TypeError: logger.info is not a function` in `src/utils/dbSchema.ts`. Its logger mock exposed only `child`. Under the rails `DB_PATH` is a fresh per-worker temp file, so `migrateSchema` runs its `logger.info` lines. Before the rails this test opened the live `data/bot.db` at schema version 7, so that branch never ran (AUD-TESTU-001 names this file).
- **Cause confirmed:** the same `TypeError` with `registerSingleton` neutralised, so the guard did not cause it. That diagnostic edit was restored with the sha256 equal.
- **Fix:** top-level `info`, `warn`, `debug`, `error` and `fatal` `vi.fn()`s added beside the existing `child`. No assertion, import or mocked mechanism changed; `withNonceLock` stays real; `it()` count 3 before and after.
- **Files modified:** `test/unit/bot/buyNonceLock.test.ts`, `.planning/audit/inputs/rails-test-edits.json`
- **Verification:** wrapped run of all 41 files passes.
- **Committed in:** `b3617f6`

**2. [Plan wording] The junction probe resolves the aliased module's own imports to the real folder**
- **Found during:** Task 1 design.
- **Issue:** the plan's junction points at the module's folder. Under a temp junction, `../guards/epoch` resolves to a folder that does not exist (review concern L283). For `exitEngine`, a junction over the whole tree would make the first guarded dependency throw and name the wrong file, which the plan's "`secondIdentity` equals the alias" rule would correctly reject.
- **Fix:** while the alias loads, the probe maps imports made by files under the junction to the real folder. The module under test still loads through the junction with the junction path as `__filename`, and the deps are the already-loaded real modules.
- **Committed in:** `ac4cd88`

**3. [Plan wording] Added a `single` probe mode and two re-import cases**
- The orchestrator asked for proof that a normal load and the epoch path do not trip the guard. The probe gained a `single` mode (`LOADED_ONCE`), and the test gained a `vi.doMock` re-import case and an all-four-in-one-process case.

---

**Total deviations:** 1 auto-fixed (blocking) and 2 plan-wording notes.
**Impact on plan:** no trading, transaction or signing code changed beyond the registration lines.

## Issues Encountered

- **Live `data/` protection:** every Vitest run was wrapped and every verdict was `untouched` with the manifest equal. `nonLoopbackAllowed` 0 and `telegramAllowed` 0 in the ledgers. The `db-tripwire` entry comes from the deliberate `dbTripwireSrc.test.ts` case.
- **`src/bot.ts` was not imported or booted.** The boot-shape proof loads the four guarded modules directly.

## Known Stubs

None.

## Audit Notes for 22-15 and 22-29

- **AUD-TX-004 (RC-17):** this plan's rail is in place. The register entry remains `confirmed` S1 and was not edited; 22-29 re-audits it.
- **22-15:** 12 test files use a logger mock that starts with `child`. Any of them that also exposes only `child` and reaches a fresh rails database will fail the way `buyNonceLock` did, with the same small fix. Only the 37 frozen files and the 3 additions were run here.
- The guard throws at module load, so a real duplicate stops the process at boot with the message naming both paths. That is the intended loud failure.
- Automock plus `vi.importActual` of a guarded module would throw (same identity, same epoch). There are 0 such sites today (RESEARCH STL-4).
- A guarded module's top-level statements before its `registerSingleton` line still run on a refused second load. In `exitEngine` that is everything above line 1423; those statements only declare functions and module state, and the throw abandons that copy.

## User Setup Required

None.

## Next Phase Readiness

- Ready for 22-13.

---
*Phase: 22-safety-rails-audit*
*Completed: 2026-11-09*

## Self-Check: PASSED

- FOUND: all 8 created code, test, proof and input files
- FOUND: ac4cd88, b3617f6, 0cd3fda (ancestors of HEAD); `git rev-list --count 5e490a5..HEAD` = 3
- Re-run after the last commit: 41 files / 324 tests, wrapped, verdict untouched, manifest equal, ledger ok; `tsc` clean; `git status --porcelain src` empty

---
phase: 23-test-safety-net-harness-triage-characterization
plan: 02
subsystem: testing
tags: [vitest, better-sqlite3, realpath-harness, timeline, known-bug-marker, ci-gate, typescript-ast]

requires:
  - phase: 23-01
    provides: the realpath harness (setup.ts mocks, FakeNode, createScenario, loadGraph, afterEach checks)
  - phase: 23-28
    provides: FakeNode public/bundle/bloXroute submission paths and createScenario for every chain and DEX type
  - phase: 22-safety-rails-audit
    provides: scripts/check-vi-mock-paths.ts (binding walker, resolver), spawnRailedChild, the rails
provides:
  - "test/realpath/harness/capture.ts: createTimeline (entries kind op|submit|relay|db, each stamped `at` from the fake clock), installDbCapture (TEMP triggers, separate column arguments with safeIntegers, unixepoch on the fake clock), assertNoViolations, takeViolations, recordedAlerts, recordedLogs"
  - "createScenario returns `timeline`, empties alerts and logs and starts a fresh timeline; loadGraph installs the capture on every new connection"
  - "Harness state lists: logs (every log call), alerts ({ via, chain, message }), violations (checked in afterEach)"
  - "test/realpath/harness/knownBug.ts: knownBug(ctx, id, { claim, correct, observed, actual, expectedPlain, actualPlain }) -> ctx.task.meta.knownBugs[{ id, claim, expected, actual, expectedPlain, actualPlain }]"
  - "Reserved self-test ID literal HARNESS-SELFTEST (every knownBug call in harnessCapture.test.ts)"
  - "scripts/check-realpath-mocks.ts (AC-02 gate, --self-test 22/22) and new exports on scripts/check-vi-mock-paths.ts"
  - "npm scripts test:realpath and check:realpath-mocks; npm test includes --project realpath; CI steps test:realpath and 'Real-path mock-list gate (CHAR-01)'"
affects: [23-04, 23-05, 23-06, 23-07, 23-09, 23-16, 23-20, 23-21, 23-22, phase-23-wave-5, phase-24]

actuals:
  tokens: 21975    # chars/4 over the added lines of badd148..1669fa5 (12 files, 87900 chars)
  tasks: 3
  commits: 3       # MEASURED: git rev-list --count badd148..HEAD before this SUMMARY commit
plan_head_before: badd148ca75f275eaa9eb01a3c9b711557f3edd1
plan_head_after: 1669fa5771408421c198073100aa498bd058b02d
commits: 3

tech-stack:
  added: []
  patterns:
    - "One ordered timeline per scenario on the globalThis harness state; every feed appends, nothing sorts"
    - "Capture problems go on an out-of-band violations list checked in afterEach; nothing harness-side throws into SQLite, where a production catch would hide it"
    - "Known-bug marker: usage refusals first, then the D-08 fix signal, then the one D-07 assertion, then the record on task meta"
    - "Mock-list gate: every use of the vi object must be a literal member access; mocks compared by resolved file"

key-files:
  created:
    - test/realpath/harness/capture.ts
    - test/realpath/harness/knownBug.ts
    - test/realpath/harnessCapture.test.ts
    - scripts/check-realpath-mocks.ts
    - test/unit/realpathMockGate.test.ts
  modified:
    - test/realpath/harness/setup.ts
    - test/realpath/harness/chain.ts
    - test/realpath/harness/world.ts
    - test/realpath/harness.test.ts
    - scripts/check-vi-mock-paths.ts
    - package.json
    - .github/workflows/test.yml

key-decisions:
  - "Today's real buy order on the timeline (baseline for CAP-14): relay eth_callBundle, relay eth_sendBundle, submit (bundle), three more eth_sendBundle, op flashbots.bundle.included, relay flashbots_getBundleStatsV2, op flashbots.bundle.stats, then db trades.insert; the insert follows every relay body"
  - "A submit entry is a transaction the node accepted (public pool, bundle, bloXroute), in arrival order; a refused raw send is not a submit entry (it stays in node.callLog and the op logs)"
  - "bloXroute relay bodies are fed from the world.ts axios route (they never reach FakeNode's relay endpoint); Flashbots bodies from FakeNode on arrival"
  - "db entries carry row as column name -> value in schema order (INTEGER as BigInt) and inTransaction; a write inside a transaction, an argument to unixepoch() and a harness capture error are violations, never exceptions"
  - "knownBug refuses a malformed marker before any assertion: an id not shaped like a finding ID or HARNESS-SELFTEST, a claim that is not short kebab-case, correct equal to observed, a claim repeated in one test"
  - "AC-02 gate is wider than the plan's list, fail closed: a free vi (Vitest globals), require/import of vitest, a re-export of vi, vi.mockObject, vi.unmock/doUnmock to a non-listed module, a mock member taken as a value, and casts around vi are all checked; .js/.cjs/.mjs/.tsx files under test/realpath are scanned too"

patterns-established:
  - "RED proof by restored mutation for harness instruments and gates: 10 capture mutations, 6 marker mutations, 5 gate mutations plus an in-repo forbidden mock; every file restored and checked by sha256, nothing committed"

requirements-completed: [CHAR-01]

coverage:
  - id: D1
    description: "Ordered timeline on the real AC-01 buy: the trades insert sits after the submit and after every relay body, by position in timeline.entries (D-13, CAP-14 order)"
    requirement: CHAR-01
    verification:
      - kind: integration
        ref: "test/realpath/harnessCapture.test.ts#D-13, CAP-14 order: on the real buy the trades insert is recorded after the relay bodies and the submit that carried the buy, by position in the timeline"
        status: pass
    human_judgment: false
  - id: D2
    description: "Each entry carries the fake clock at the moment recorded; the submit entry's at equals the clock read while the bundle was held"
    requirement: CHAR-01
    verification:
      - kind: integration
        ref: "test/realpath/harnessCapture.test.ts#timeline time: the submit entry carries the fake clock at the moment the node accepted it"
        status: pass
    human_judgment: false
  - id: D3
    description: "DB capture (D-14, D-05): DEFAULT (unixepoch()) is the fake second, also through a statement prepared before the install; REAL exact and integers above 2^53 whole; a second loadGraph is still captured"
    requirement: CHAR-01
    verification:
      - kind: integration
        ref: "test/realpath/harnessCapture.test.ts (D-05 x3, RESEARCH Refinement 2, RESEARCH Pitfall 5)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Open Question 5: an autocommit insert records no violation; a write inside db.transaction under a catch-all still fails assertNoViolations naming the table"
    requirement: CHAR-01
    verification:
      - kind: integration
        ref: "test/realpath/harnessCapture.test.ts#Open Question 5 (two tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Plain logs and alerts: a log with no op is on recordedLogs and not on the timeline; the real buy's exact New Token Detected text is on recordedAlerts (via ctx, chain eth) and no alert text is on the timeline; a new scenario starts empty"
    requirement: CHAR-01
    verification:
      - kind: integration
        ref: "test/realpath/harnessCapture.test.ts#logs / alerts / a new scenario starts with empty alert and log lists and a fresh timeline"
        status: pass
    human_judgment: false
  - id: D6
    description: "knownBug (D-07, D-08): exact recorded failure passes and records on task meta (BigInt as text, reaches the JSON reporter); looks-fixed and failure-changed throw their exact messages; two claims give two entries; malformed markers refused; nothing else caught"
    requirement: CHAR-01
    verification:
      - kind: integration
        ref: "test/realpath/harnessCapture.test.ts#realpath harness: the known-bug marker (6 tests)"
        status: pass
      - kind: other
        ref: "TypeScript AST check of harnessCapture.test.ts: 10 knownBug calls, every second argument the literal HARNESS-SELFTEST"
        status: pass
    human_judgment: false
  - id: D7
    description: "AC-02 gate: --self-test 22/22 (incl. the refused vi.mock of src/utils/db), the real test/realpath folder clean, an in-repo forbidden mock exits 1, wired into npm test, npm scripts and CI"
    requirement: CHAR-01
    verification:
      - kind: unit
        ref: "test/unit/realpathMockGate.test.ts (7 tests, incl. --self-test through spawnRailedChild)"
        status: pass
      - kind: other
        ref: "node node_modules/ts-node/dist/bin.js scripts/check-realpath-mocks.ts --self-test && node node_modules/ts-node/dist/bin.js scripts/check-realpath-mocks.ts"
        status: pass
    human_judgment: false

duration: 22min
completed: 2026-11-11
status: complete
---

# Phase 23 Plan 02: Timeline, Known-Bug Marker and Mock-List Gate Summary

**A real buy now produces one ordered timeline of op logs, submissions, relay bodies and DB writes (captured by TEMP triggers with exact REAL and BigInt values, on the fake SQL clock). `knownBug` passes only the exact recorded failure and records it on task meta. A binding-aware AST gate, run by `npm test` and CI, fails any mock under `test/realpath/` outside the AC-02 list, shown by refusing a `vi.mock` of `src/utils/db`.**

## Performance

- **Duration:** about 22 min
- **Started:** 2026-11-11T13:57:35Z
- **Completed:** 2026-11-11T14:20:07Z
- **Tasks:** 3 of 3
- **Files modified:** 12 (5 created, 7 modified)

## Accomplishments

- **Task 1 (tracer), the timeline.** `createTimeline()` is the one ordered list that four feeds append to: `op` from the logger mock, `submit` from `FakeNode` (one `#pushSubmitted` for the public pool, bundles and bloXroute), `relay` from Flashbots bodies on arrival and bloXroute bodies at the axios route, and `db` from TEMP triggers. Each entry carries `at` from the fake clock. `createScenario` returns `timeline`. `loadGraph` installs the capture and the SQL clock together on every new connection.
- On the real AC-01 buy the `trades` insert sits after the submit and after every relay body. The recorded order is callBundle, sendBundle, submit, three more sendBundle, `flashbots.bundle.included`, stats, then `trades.insert`.
- The recording function never throws into SQLite. A write while `db.inTransaction` is true, an argument to `unixepoch()` and a harness capture error each go on the `violations` list. `assertNoViolations()` runs in `afterEach`. A test proves that a catch-all around a `db.transaction` write cannot hide the violation.
- Logs and alerts. Every log call stays on `logs`, and only op-carrying calls feed the timeline. The notifier mock has the real module's three signatures and records `{ via, chain, message }`. The real buy leaves its exact `*New Token Detected!*` text on `recordedAlerts()`, and no alert text reaches the timeline.
- **Task 2, the known-bug marker.** `knownBug` throws `<id> now behaves correctly: remove this marker (it looks fixed)` when the bug is fixed, and `<id>: the failure changed from what was recorded` for any other value. On the exact recorded failure it appends `{ id, claim, expected, actual, expectedPlain, actualPlain }` to `ctx.task.meta.knownBugs`, with BigInt stored as text. A JSON-reporter run showed the records arriving in the report. Every self-test call cites `HARNESS-SELFTEST`.
- **Task 3, the AC-02 gate.** `scripts/check-realpath-mocks.ts` shares the binding and resolver helpers now exported from `check-vi-mock-paths.ts`. It compares mocks by resolved file. Its `--self-test` passes 22 cases from temp files outside the repo. The real folder is clean: 27 vi uses, 7 mock calls, 9 files. `npm test` now includes `--project realpath`, `test:realpath` and `check:realpath-mocks` exist, and CI runs both, the gate as a named step after the vi.mock gate.

## Task Commits

1. **Task 1: ordered timeline with DB capture on the real buy (tracer)** - `617f6de` (test)
2. **Task 2: known-bug marker** - `b7a0508` (test)
3. **Task 3: AC-02 mock-list gate, npm and CI** - `1669fa5` (feat)

**Plan metadata:** this SUMMARY commit, then the STATE/ROADMAP commit.

## Files Created/Modified

- `test/realpath/harness/capture.ts` - the timeline, the DB capture and SQL clock, the violation checks, and the alert and log readers
- `test/realpath/harness/knownBug.ts` - the D-07/D-08 marker and the `TaskMeta.knownBugs` type
- `test/realpath/harnessCapture.test.ts` - 18 tests: 12 for the timeline and capture, 6 for the marker
- `test/realpath/harness/setup.ts` - the op feed in the logger mock, the `{ via, chain, message }` notifier, and `assertNoViolations` in afterEach; comment reworded so `vi.fn` appears 0 times
- `test/realpath/harness/chain.ts` - state fields `timeline`, `violations`, typed `alerts`; `#pushSubmitted`; the Flashbots relay feed
- `test/realpath/harness/world.ts` - `loadGraph` installs the capture; `createScenario` empties alerts and logs and returns `timeline`; the bloXroute relay feed; resets
- `test/realpath/harness.test.ts` - the AUD-BUY-016 skip test reads the alert through `recordedAlerts()` (new shape)
- `scripts/check-realpath-mocks.ts` - the AC-02 gate with `--self-test`
- `scripts/check-vi-mock-paths.ts` - exports `collectViBindings`, `isViReceiver`, `mockMethodOf`, `literalSpecifier`, `loadResolverOptions`, and `resolveSpecifier`, which returns the resolved file (the old boolean `resolves` now wraps it)
- `test/unit/realpathMockGate.test.ts` - 7 tests: the cases run in-process, the real folder, exit-2 paths, and `--self-test` through `spawnRailedChild`
- `package.json` - `test` gains `--project realpath`; adds `test:realpath` and `check:realpath-mocks`; `test:coverage` unchanged
- `.github/workflows/test.yml` - `npm run test:realpath` after `test:integration`, and the `Real-path mock-list gate (CHAR-01)` step after the vi.mock gate; no `fetch-depth` change

## Decisions Made

- The recorded order of today's buy (see key-decisions) is the CAP-14 baseline later plans read.
- A `submit` entry is a node acceptance. A refused `eth_sendRawTransaction` produces no submit entry; it stays visible in `node.callLog` and the op logs.
- bloXroute bodies are recorded at the world.ts axios route, because they never reach FakeNode's relay endpoint.
- `unixepoch(x)` answers the fake second and records a violation instead of throwing, so no NOT NULL default fails inside production code.
- A timeline always exists: world.ts creates one at load and `resetTestState` makes a fresh one. A feed therefore never records into nothing outside a scenario.
- `takeViolations()` returns and clears the list. A test that provokes a violation on purpose uses it after asserting that `assertNoViolations()` throws.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The existing AUD-BUY-016 test read the old alert shape**
- **Found during:** Task 1
- **Issue:** `harness.test.ts:1010` read `harnessState().alerts[].args`, which the new `{ via, chain, message }` shape removes.
- **Fix:** It now reads `recordedAlerts()` and also checks `via === 'ctx'` and the chain name, which makes it stronger. The file is not in the plan's file list.
- **Files modified:** test/realpath/harness.test.ts
- **Verification:** realpath 50/50, then 56/56, on repeat runs
- **Committed in:** 617f6de

**2. [Rule 2 - Missing critical] Wider AC-02 gate, fail closed**
- **Found during:** Task 3
- **Issue:** The plan's rules (a) to (e) left several ways to reach `vi` or mock a module unchecked: a free `vi` under Vitest globals, `require('vitest')` or `import('vitest')`, `export { vi } from 'vitest'`, `vi.mockObject`, `vi.unmock` and `vi.doUnmock`, `vi.mock` taken as a value, and `(vi as any)[name]`. The plan also scanned only `.ts` files.
- **Fix:** Each is a violation with its own self-test case. Casts are seen through. `.js`, `.cjs`, `.mjs` and `.tsx` files are scanned. A `vi.spyOn(process, 'exit')` with any argument count other than two is refused.
- **Files modified:** scripts/check-realpath-mocks.ts
- **Verification:** `--self-test` 22/22; G4, G5 and G6 RED mutations fail their cases
- **Committed in:** 1669fa5

**3. [Rule 2 - Missing critical] Marker usage refusals**
- **Found during:** Task 2
- **Issue:** As specified, a marker with `correct` equal to `observed` would always pass or always report fixed, and nothing enforced the claim format.
- **Fix:** Before any assertion the marker refuses an id that is not shaped like a finding ID or `HARNESS-SELFTEST`, a claim that is not short kebab-case, `correct` equal to `observed`, and a claim repeated in one test.
- **Files modified:** test/realpath/harness/knownBug.ts
- **Verification:** the malformed-marker test; RED K6
- **Committed in:** b7a0508

**4. [Rule 2 - Missing critical] Two more violation kinds and `takeViolations`**
- **Found during:** Task 1
- **Issue:** An error in the recording function itself would otherwise have to be thrown into SQLite. A test that provokes a violation needs a way to clear it.
- **Fix:** Added a `capture-error` violation kind and the `takeViolations()` helper.
- **Files modified:** test/realpath/harness/capture.ts
- **Verification:** the Open Question 5 and unixepoch tests
- **Committed in:** 617f6de

**5. [Rule 3 - Blocking] Resolver returns the file**
- **Found during:** Task 3
- **Issue:** The plan says to export "the resolver function", but that function returned a boolean, and a list of allowed files needs the resolved path.
- **Fix:** `resolveSpecifier` returns the path, and `resolves` wraps it. The vi.mock gate behaves the same: 591 calls, 0 violations, and its tests pass 9/9.
- **Files modified:** scripts/check-vi-mock-paths.ts
- **Verification:** viMockGate tests 9/9; `check:vi-mock` output unchanged
- **Committed in:** 1669fa5

---

**Total deviations:** 5 auto-fixed (2 Rule 3, 3 Rule 2).
**Impact on plan:** Each change closes a way a mock or a capture fault could pass silently. There was no scope creep, and `src/` is unchanged.

## Grade Changes and New Findings

None. No finding was registered and no severity or status changed, so the standing instruction of 2026-11-11 was not needed. The timeline of the AC-01 buy shows `antirug.backfill.gap-detected` on a fresh database. That is AUD-ANTIRUG-024, already registered by 23-01.

## Verification (exact commands, Node 22.16.0 via `export PATH="/c/Users/jackc/AppData/Local/nvm/v22.16.0:$PATH"`)

- Task 1/2 verify: `node node_modules/vitest/vitest.mjs run --project realpath test/realpath/harnessCapture.test.ts` gave 18/18, none skipped. The tracer gate re-ran the Task 1 verify (12/12 at that point) before Task 2 started.
- Task 2 AST verify (the plan's `node -e` TypeScript walker): `harness knownBug calls 10`, exit 0.
- Task 3 verify: `scripts/check-realpath-mocks.ts --self-test` gave `SELF-TEST PASSED: 22/22 cases`. `scripts/check-realpath-mocks.ts` gave 27 vi uses (7 mock calls) in 9 files, 0 violations. The unit run of `realpathMockGate.test.ts` and `viMockGate.test.ts` gave 16/16. The greps for `"test:realpath"` and `npm run check:realpath-mocks` both found their lines. Overall exit 0.
- `npm run check:realpath-mocks` exited 0. `npm run test:realpath` gave 3 files, 56/56.
- Full railed `npm test` (unit, integration and realpath) gave 140 files, 1263 passed, 0 failed, 0 skipped. Ledger run-20261111T141745-4444-7d4f86 had `nonLoopbackAllowed` 0 and `telegramAllowed` 0. Its 16 triggering files are the rail and API tests whose denials are deliberate, the same set 22-15 recorded; no realpath file is among them.
- JSON reporter: `--reporter=json` over harnessCapture.test.ts put `meta.knownBugs` on the three recording tests, with BigInt as text.
- Type checks: `tsc --noEmit -p tsconfig.json` 0 errors and `-p tsconfig.bot.json` 0 errors. Two scratchpad tsconfigs extending the repo's also gave 0 errors: one over `test/realpath/**` (8 files), one over the two gate scripts and the new unit test.
- The rail gates `spawnSites.test.ts`, `viMockGate.test.ts` and `ci/rootFileGuard.test.ts` all pass. `check:vi-mock`: 591 calls, 0 violations.
- Acceptance greps: `json_object` in capture.ts 0; `vi.fn` in setup.ts 0; the `test` script contains `--project realpath`; `git status --porcelain src` empty.
- RED proofs (scratch only, every file restored and checked by sha256, nothing committed):
  - Capture, 10 mutations, each failing its named tests. No install in loadGraph (9 tests), the function throwing into SQLite (the transaction test), no submit feed (3), `at` not stamped (3), alerts fed to the timeline (alerts test), `safeIntegers` off (4), columns through a JSON-building function (precision test), createScenario keeping old lists (fresh-scenario test), every log fed (12), no unixepoch override (4).
  - Marker, 6 mutations: no looks-fixed check, no assertion, a swallowing catch, raw BigInt, recording before the assertion, `correct` equal to `observed` allowed. Each fails its test.
  - Gate: a scratch `test/realpath/_scratch_forbidden.test.ts` with `vi.mock('../../src/utils/db')` made `npm run check:realpath-mocks` exit 1 and name the file and line; the file was then deleted. Five gate mutations failed the self-test. The allow-list mutation also failed 4 unit tests, including the program-level `--self-test`.

## Issues Encountered

- The first attempt to print the buy's timeline order used a scratch test that did not compile (an escaped newline in a heredoc). It was diagnosed and re-run with `String.fromCharCode(10)`. The scratch file was deleted each time.
- The rail ledger for the unit gate run showed 5 worker starts for 2 files: the two unit workers plus three railed children from the `npx` to `ts-node` chain, all mode full through `preload.cjs`, with no network or Telegram allowance.
- On commit, git prints "LF will be replaced by CRLF" because `core.autocrlf=true` is set on this machine. The stored blobs are LF.

## Known Stubs

None.

## User Setup Required

None. No external service configuration required.

## Next Phase Readiness

- Later plans read `scenario.timeline.entries` (kinds op, submit, relay and db, each with `at`), `recordedAlerts()` and `recordedLogs()`. Triage tests mark a bug with `knownBug(ctx, '<FINDING-ID>', { claim, ... })`.
- Plan 23-04 must accept `HARNESS-SELFTEST` outside `test/realpath/triage/` and read `task.meta.knownBugs[]` (`{ id, claim, expected, actual, expectedPlain, actualPlain }`).
- Plan 23-20's serializer must turn BigInt row values into text, and must not expect alert text in a recording.
- Any new mock in `test/realpath/` must be on the AC-02 list, or CI fails at `Real-path mock-list gate (CHAR-01)`.

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-11*

## Self-Check: PASSED

- Files present: test/realpath/harness/capture.ts, test/realpath/harness/knownBug.ts, test/realpath/harnessCapture.test.ts, scripts/check-realpath-mocks.ts, test/unit/realpathMockGate.test.ts.
- Commits on this branch: 617f6de, b7a0508, 1669fa5 are all ancestors of HEAD.
- Commit count measured from the ledger: `git rev-list --count badd148..1669fa5` = 3.
- Acceptance criteria of all three tasks and the plan-level verification were re-run after the last commit and pass.

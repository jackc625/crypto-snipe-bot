---
phase: 23-test-safety-net-harness-triage-characterization
plan: 19
subsystem: testing
tags: [red-proof, in-memory-mutant, typescript-compiler-api, ast-gate, signal-handlers, nonce-lock, spawnRailedChild, CHAR-06, AC-37]

requires:
  - phase: 23 (plan 23-29)
    provides: runMutant, runGroup, the MUTANTS / CONVERTED_TESTS / CONVERTED_COUNTS tables, --check-manifest and --check-summaries
  - phase: 23 (plans 23-18, 23-31, 23-30)
    provides: the other 32 conversion rows in 8 files and the guard row; the describe-title rule; test/helpers/sourceGraph.ts (loadRepoModules)
  - phase: 22 (plan 22-10)
    provides: the dotenv rail test and its child probe test/rails/probes/dotenvProbe.ts
provides:
  - test/unit/sourceTextGate.test.ts, the standing AST check for AC-37 over every source file under test/
  - test/unit/bot/twoStageSigint.test.ts, test/unit/mevStrategies/inclusionReconciliation.test.ts and test/unit/rails/dotenvSrcSkip.test.ts (case (e) only) read no named src/ or scripts/ file
  - scripts/red-proof-conversions.ts groups sigint (4 mutants), inclusion (6) and dotenv-gate (5); 4 CONVERTED_TESTS rows in 3 files; the manifest complete at 36 rows in 11 files and 1 guard
affects: [23-26 (MANIFEST-OK rows 36 files 11 guards 1; --check-summaries reads the RED-OK lines below; test-identity reads the 4 recorded renames), phase-24 (removes the AUD-API-002 restart fixture from the gate's allow list with its onRestart fix), phase-28 (the 3 dashboard source-text tests stay on the allow list until TEST-07; a test tsconfig would surface the pre-existing type errors logged in deferred-items.md)]

actuals:
  tokens: 19023
  tasks: 2
  commits: 4
plan_head_before: dab8291ae44710ec200a4a432826ee15e9468944
plan_head_after: 6904ec662362293b651d40604f0f0ca768a6ed94

tech-stack:
  added: []
  patterns:
    - "Signal wiring checked by booting the real startMultiChainBot under a full mock set in a describe-level beforeAll (vi.resetModules, then the import against hookTimeout), finding the listeners it added by diffing process.listeners, driving them with fake time, and removing exactly those listeners in a finally"
    - "A lock is shown by holding the real per-wallet nonce lock and showing the seam's work waits one full event-loop turn and runs only after release (no lock mock)"
    - "A no-text-left check as an AST walk: identifiers and string literals of every src/ module found by a directory walk; comments are not nodes"
    - "A read-only simulation shown read-only by giving the real function a runner that answers eth_call and refuses and records any sent transaction"
    - "Standing source-text gate: evaluate each read call's path argument as alternative literal paths, following local consts, for-of bindings and local helper parameters to bounded depth"

key-files:
  created:
    - test/unit/sourceTextGate.test.ts
  modified:
    - test/unit/bot/twoStageSigint.test.ts
    - test/unit/mevStrategies/inclusionReconciliation.test.ts
    - test/unit/rails/dotenvSrcSkip.test.ts
    - scripts/red-proof-conversions.ts
    - .planning/audit/inputs/rails-test-edits.json
    - .planning/audit/ledger/TESTU.json
    - .planning/audit/AUDIT-FINDINGS.md
    - .planning/phases/23-test-safety-net-harness-triage-characterization/deferred-items.md

key-decisions:
  - "Operator ruling recorded (chosen before dispatch, operator's choice \"Allow-list it (Recommended)\"; the \"(Recommended)\" label was the orchestrator's): the AC-37 gate scans every source file under test/, and test/realpath/triage/fixtures/AUD-API-002-restart.ts joins its allow list because it reads src/bot.ts only to hash the private onRestart closure its mirror copies, which this phase cannot reach without booting the bot. Phase 24's AUD-API-002 fix makes that hash fail by design; Phase 24 replaces the mirror with the real path and removes the entry (deferred-items.md, owner Phase 24)."
  - "The gate follows literals through local consts, for-of bindings and local helper parameters up to 3 levels, not the one const level the plan names: measured on the 11 CHAR-06 files as they were at the phase start, one const level finds 9 of them, a helper parameter adds mainEntry (parse('src/main.ts')) and a second level adds dotenvSrcSkip case (e) (for-of over a const array). With the gate's rule all 11 are flagged, and on today's tree levels 1, 2 and 4 report the same single hit (the allow-listed fixture)."
  - "The allow list holds only the files the rule actually needs to allow: the 3 named dashboard tests (SPEC exception) and the AUD-API-002 fixture (operator ruling). The path-agnostic scanners and this gate are not listed, because they produce no hit; a blanket entry would hide a future named read in them. A test asserts each of them passes the rule with no entry and that the rule evaluated at least one read in each."
  - "A src/ path counts only when src or scripts is the first segment after . and .. (top-level, AC-37's wording), so dashboard/src reads are not hits; a read whose path contains os.tmpdir or mkdtemp is a temp-rooted read and passes."
  - "twoStageSigint: the cleanup the first SIGINT runs stops in a Vitest worker at its require('./utils/db') (Node's own require cannot resolve a .ts file; ts-node does in production), and the handler catches and logs it. The test allows a clean exit 0 but forbids a forced exit on the first signal, so it holds either way; the boot mock set gains a logger recorder so that caught error is recorded, not printed."
  - "inclusionReconciliation: the file's ethers mock (FetchRequest) moved into vi.hoisted so the D-RECORD-REAL-HASH describe can register it plus a stub Contract for its bot import and then put the file's own mock back in afterAll."
  - "dotenvSrcSkip case (e) runs its five children through ts-node's transpile-only register (2.9 s alone for all five) instead of a type-checking npx ts-node start; the type check is not what (e) protects."

patterns-established:
  - "A standing AST gate proven both ways on temp-directory sources and on the real files it must accept"

requirements-completed: [CHAR-06]

coverage:
  - id: D1
    description: "twoStageSigint: the real startMultiChainBot adds exactly one SIGINT and one SIGTERM listener; SIGINT runs the cleanup once, forces no exit and arms one timer that forces exit 1 at SIGINT_GRACE_MS=1234 (not at 1233); a second SIGINT and then SIGTERM force 130 with no new timer; the listeners are removed after"
    requirement: CHAR-06
    verification:
      - kind: unit
        ref: "node node_modules/ts-node/dist/bin.js scripts/red-proof-conversions.ts --group sigint (5 RED-OK lines, x3, byte-identical)"
        status: pass
    human_judgment: false
  - id: D2
    description: "inclusionReconciliation D-RECORD-REAL-HASH: the real V2 and V3 buy handlers store the hash the seam returned; submitBuyTx waits on the real wallet nonce lock"
    requirement: CHAR-06
    verification:
      - kind: unit
        ref: "scripts/red-proof-conversions.ts --group inclusion (v2-row-placeholder-hash, v3-row-placeholder-hash, buy-submit-outside-lock RED-OK, x3)"
        status: pass
    human_judgment: false
  - id: D3
    description: "inclusionReconciliation V2-unsafe-real-buy: the removed tax function is not exported and named by no src/ code (AST walk); the real simulateSwapForChain sends nothing and calls the swap once through staticCall"
    requirement: CHAR-06
    verification:
      - kind: unit
        ref: "scripts/red-proof-conversions.ts --group inclusion (bot-references-removed-fn, removed-fn-restored, safety-sim-sends-real-swap RED-OK, x3)"
        status: pass
    human_judgment: false
  - id: D4
    description: "dotenvSrcSkip case (e): each of the five dotenv sites, run as a railed child with VITEST set, makes zero .env read attempts; each unguarded-call mutant is refused by the rails and recorded as env-read-blocked"
    requirement: CHAR-06
    verification:
      - kind: unit
        ref: "scripts/red-proof-conversions.ts --group dotenv-gate (5 RED-OK lines, reach child, x3)"
        status: pass
    human_judgment: false
  - id: D5
    description: "AC-37 standing gate: no file under test/ reads a named top-level src/ or scripts/ file outside the allow list; temp-directory cases fail named reads through fs (sync, callback, promise), ts.createSourceFile and ts.createProgram (array and rootNames), a helper and a loop, and pass a directory walk, a temp-rooted read and non-source files"
    requirement: CHAR-06
    verification:
      - kind: unit
        ref: "test/unit/sourceTextGate.test.ts (4 tests) in both full railed runs"
        status: pass
    human_judgment: false
  - id: D6
    description: "Manifest complete: 36 converted tests in 11 files and 1 guard"
    requirement: CHAR-06
    verification:
      - kind: other
        ref: "scripts/red-proof-conversions.ts --check-manifest (MANIFEST-OK rows 36 files 11 guards 1)"
        status: pass
    human_judgment: false

duration: 46min
completed: 2026-11-12
status: complete
---

# Phase 23 Plan 19: Last Three Source-Text Conversions and the Standing AC-37 Gate Summary

**What changed:**
- **Shutdown wiring:** the real `startMultiChainBot` now boots in a unit test with every outside seam mocked. The test checks it adds exactly one SIGINT and one SIGTERM listener, and drives the two shutdown stages through those listeners with fake time.
- **Buy hash and lock:** the real V2 and V3 buy handlers are shown to store the hash that `submitBuyTx` returned. The seam is shown to wait on the real wallet nonce lock.
- **Removed tax function:** it is shown gone by a real import and by an AST walk of `src/`. The kept swap simulation is shown to send nothing.
- **Dotenv sites:** each of the five is loaded as a railed child, which must make zero `.env` read attempts.
- **The standing gate:** `test/unit/sourceTextGate.test.ts` fails any future test that reads a named top-level `src/` or `scripts/` file.

15 in-memory mutants give 16 RED-OK lines. The manifest is complete at 36 rows in 11 files with 1 guard. Nothing under src/ or scripts/ was written for any proof.

## Performance

- **Duration:** 46 min
- **Started:** 2026-11-12T14:12:32Z
- **Completed:** 2026-11-12T14:58:43Z
- **Tasks:** 2, plus one type-fix commit and one ledger commit
- **Files:** 9 changed (1 created); src/ unchanged

## Accomplishments

- **twoStageSigint.test.ts (Test 4, converted in place):**
  - A describe-level `beforeAll` calls `vi.resetModules()`, installs the boot mock set of `test/integration/midRunWalletCheck.test.ts` (lines 49-141, including `src/preflight` and `src/api/server`) plus a logger recorder, and imports `src/bot`.
  - The test sets `SIGINT_GRACE_MS=1234` and calls the real `startMultiChainBot`. It finds exactly one new SIGINT and one new SIGTERM listener, and the boot never calls `process.exit`.
  - **First SIGINT:** the cleanup closes the API server once. No exit is forced. Exactly one more timer is armed. It forces exit 1 at 1234 ms of fake time and not at 1233.
  - **Second SIGINT:** forces exit 130 with no new timer. SIGTERM then also forces 130.
  - **Cleanup:** a `finally` removes exactly the listeners the boot added and clears the boot's fake intervals. The test then checks the listener lists equal what they were before.
  - The real network is never touched: every seam is mocked and `process.exit` is spied by the file's own `beforeEach`.
- **inclusionReconciliation.test.ts:**
  - **D-RECORD-REAL-HASH:**
    - The test drives the real `handleNewPairForChain` and `handleNewV3PoolForChain` to their inserts. The mock set is the one from `test/integration/anti-rug/botWiring.test.ts`, with an `insertTrade.run` spy and a `sendTxWithRetry` spy. Both rows store the returned hash, with status `pending`.
    - It then holds the real nonce lock for the wallet's address in lower case. A `submitBuyTx` call does not reach `sendTxWithRetry` after one full event-loop turn. After release it runs once, with the same builder and context, and returns the hash.
  - **V2-unsafe-real-buy:**
    - (1) A real import shows `tokenSafety` has no export of the removed function.
    - (2) An AST walk of every `src/` module, found by `loadRepoModules(['src'])`, finds no identifier or string literal naming it.
    - (3) The real `simulateSwapForChain` is given a runner that answers `eth_call` and refuses (and records) any sent transaction. It returns true from exactly one `swapExactETHForTokens` call and sends nothing. Explicit limit 60 s.
- **dotenvSrcSkip.test.ts case (e) only:**
  - Five railed children run with VITEST set, each with its own case ledger: the config and notifier probes, then pause, resume and preflight.
  - Each must show zero `env-read-blocked` entries.
  - Each must also show that the child reached its site, at least one `worker-start` entry, and no outside reach.
- **sourceTextGate.test.ts (new, 4 tests):**
  - The full-tree scan over 286 files has a 60 s limit, as `spawnSites` gives its own walk.
  - An allow-list integrity check: every entry is an existing file with a reason.
  - The real-file proof covers 14 files that must pass with no entry, plus AUD-SCRIPTS-002, which only writes.
  - Temp-directory cases prove the rule both ways.

## Task Commits

1. **Task 1 (tracer): shutdown wiring by booting the real startMultiChainBot, group sigint:** `01b45ef` (test). The tracer verify was re-run on the committed tree (TRACER-VERIFY-PASS, check.ts partial PASS) before Task 2 started.
2. **Type fix (TS7031 in Task 1's filter):** `1ce567a` (fix).
3. **Task 2: inclusion and dotenv (e) conversions, the AC-37 gate, groups inclusion and dotenv-gate:** `1018e79` (test).
4. **Reviewed re_audit row for dotenvSrcSkip and the re-render:** `6904ec6` (docs).

## RED proofs

From `node node_modules/ts-node/dist/bin.js scripts/red-proof-conversions.ts --group <name>`:
- Each group exited 0 in each of three rounds, with byte-identical output (md5 40f1fd633185 sigint, f34346c6ae4f inclusion, b64e72864e87 dotenv-gate).
- Per round: sigint 16 to 18 s, inclusion 23 to 29 s, dotenv-gate 18 to 23 s.
- Every target hash was unchanged, `git status --porcelain src` was empty after every run, and no `csb-red-proof-*` temp folder was left.

```
RED-OK sigint-not-registered :: test/unit/bot/twoStageSigint.test.ts :: Two-stage SIGINT — single force-exit path (Test 4) > startMultiChainBot registers exactly one SIGINT and one SIGTERM listener that run the two stages with SIGINT_GRACE_MS
RED-OK sigterm-not-registered :: test/unit/bot/twoStageSigint.test.ts :: Two-stage SIGINT — single force-exit path (Test 4) > startMultiChainBot registers exactly one SIGINT and one SIGTERM listener that run the two stages with SIGINT_GRACE_MS
RED-OK grace-knob-ignored :: test/unit/bot/twoStageSigint.test.ts :: Two-stage SIGINT — single force-exit path (Test 4) > startMultiChainBot registers exactly one SIGINT and one SIGTERM listener that run the two stages with SIGINT_GRACE_MS
RED-OK second-signal-no-force :: test/unit/bot/twoStageSigint.test.ts :: Two-stage SIGINT — second signal forces immediate exit (Test 2) > a second signal while shutting down calls process.exit(130) and does not re-run cleanup
RED-OK second-signal-no-force :: test/unit/bot/twoStageSigint.test.ts :: Two-stage SIGINT — single force-exit path (Test 4) > startMultiChainBot registers exactly one SIGINT and one SIGTERM listener that run the two stages with SIGINT_GRACE_MS
RED-OK v2-row-placeholder-hash :: test/unit/mevStrategies/inclusionReconciliation.test.ts :: D-RECORD-REAL-HASH — buy row records the real hash > D-RECORD-REAL-HASH: the real V2 and V3 buy handlers store the hash the submitBuyTx seam returned, and the seam submits under the wallet nonce lock
RED-OK v3-row-placeholder-hash :: test/unit/mevStrategies/inclusionReconciliation.test.ts :: D-RECORD-REAL-HASH — buy row records the real hash > D-RECORD-REAL-HASH: the real V2 and V3 buy handlers store the hash the submitBuyTx seam returned, and the seam submits under the wallet nonce lock
RED-OK buy-submit-outside-lock :: test/unit/mevStrategies/inclusionReconciliation.test.ts :: D-RECORD-REAL-HASH — buy row records the real hash > D-RECORD-REAL-HASH: the real V2 and V3 buy handlers store the hash the submitBuyTx seam returned, and the seam submits under the wallet nonce lock
RED-OK bot-references-removed-fn :: test/unit/mevStrategies/inclusionReconciliation.test.ts :: STOP-THE-LINE-03 — V2 safety bank fires no real buy (V2-unsafe-real-buy harm #6) > V2-unsafe-real-buy (STOP-THE-LINE-03): hasHighTransferTaxForChain is not exported and named by no src/ code, and the real simulateSwapForChain calls swapExactETHForTokens only through staticCall (VALIDATION harm-prevention #6)
RED-OK removed-fn-restored :: test/unit/mevStrategies/inclusionReconciliation.test.ts :: STOP-THE-LINE-03 — V2 safety bank fires no real buy (V2-unsafe-real-buy harm #6) > V2-unsafe-real-buy (STOP-THE-LINE-03): hasHighTransferTaxForChain is not exported and named by no src/ code, and the real simulateSwapForChain calls swapExactETHForTokens only through staticCall (VALIDATION harm-prevention #6)
RED-OK safety-sim-sends-real-swap :: test/unit/mevStrategies/inclusionReconciliation.test.ts :: STOP-THE-LINE-03 — V2 safety bank fires no real buy (V2-unsafe-real-buy harm #6) > V2-unsafe-real-buy (STOP-THE-LINE-03): hasHighTransferTaxForChain is not exported and named by no src/ code, and the real simulateSwapForChain calls swapExactETHForTokens only through staticCall (VALIDATION harm-prevention #6)
RED-OK dotenv-unguarded-config :: test/unit/rails/dotenvSrcSkip.test.ts :: dotenv gate at the reachable sites (SAFE-02 src layer, D-01) > (e) each of the five sites loads dotenv only under the VITEST gate: run as a railed child with VITEST set, each makes zero .env read attempts
RED-OK dotenv-unguarded-notifier :: test/unit/rails/dotenvSrcSkip.test.ts :: dotenv gate at the reachable sites (SAFE-02 src layer, D-01) > (e) each of the five sites loads dotenv only under the VITEST gate: run as a railed child with VITEST set, each makes zero .env read attempts
RED-OK dotenv-unguarded-pause :: test/unit/rails/dotenvSrcSkip.test.ts :: dotenv gate at the reachable sites (SAFE-02 src layer, D-01) > (e) each of the five sites loads dotenv only under the VITEST gate: run as a railed child with VITEST set, each makes zero .env read attempts
RED-OK dotenv-unguarded-resume :: test/unit/rails/dotenvSrcSkip.test.ts :: dotenv gate at the reachable sites (SAFE-02 src layer, D-01) > (e) each of the five sites loads dotenv only under the VITEST gate: run as a railed child with VITEST set, each makes zero .env read attempts
RED-OK dotenv-unguarded-preflight :: test/unit/rails/dotenvSrcSkip.test.ts :: dotenv gate at the reachable sites (SAFE-02 src layer, D-01) > (e) each of the five sites loads dotenv only under the VITEST gate: run as a railed child with VITEST set, each makes zero .env read attempts
```

**Reach markers:**
- `child`: the five dotenv-gate rows. The edit reached the real railed child, which attempted the read. The rails refused it and recorded one `env-read-blocked` in that site's case ledger, so the real `.env` was never opened.
- `worker`: bot-references-removed-fn. The AST walk read the edited `src/bot.ts`.
- `vite`: every other row.

**Each row runs the whole test file (no `only`), except dotenv-gate:**
- So each mutant is shown to fail exactly its expected tests and no other test in the file: 5, 18 and 12 tests respectively.
- dotenv-gate selects case (e), as the plan says, because the other cases each start several children.

**Failure messages.** Each is an AssertionError and is matched by its row's `messageIncludes`. These were read from each row's first failing run:
- sigint:
  - `new SIGINT listeners: expected +0 to be 1` and `new SIGTERM listeners: expected +0 to be 1`.
  - `exit calls at 1234 ms: expected [] to deeply equal [ [ 1 ] ]`.
  - Test 2 and the new test both read `... to be called 1 times, but got 0 times`.
- inclusion:
  - `v2 buy row tx hash: expected 'mev_bundle' to be ...` (and the same for v3).
  - `buy submits while the wallet lock is held: expected "vi.fn()" to not be called at all, but actually been called 1 times`.
  - `src code naming the removed function: expected [ 'src/bot.ts:6' ] to deeply equal []`.
  - `tokenSafety exports: expected [ '<name>' ] to deeply equal []`.
  - `swap transactions sent by the safety simulation: expected 1 to be +0`.
- dotenv-gate: `<site> env-read-blocked: expected 1 to be +0`, one per site.

**Mutants, as the plan names them:**
- **sigint** (all on `src/bot.ts`):
  - `sigint-not-registered` and `sigterm-not-registered` remove the two `process.on` lines.
  - `grace-knob-ignored` makes `graceRaw` read `undefined`.
  - `second-signal-no-force` replaces `process.exit(130);` with `void 0;`.
- **inclusion:**
  - `v2-row-placeholder-hash` and `v3-row-placeholder-hash`: each find is three lines, starting at the comment that differs between the two sites.
  - `buy-submit-outside-lock` calls `sendTxWithRetry` directly.
  - `bot-references-removed-fn` adds a `declare function` line after the `getGasOptions` import.
  - `removed-fn-restored` adds an export after the `UNICRYPT_API` line.
  - `safety-sim-sends-real-swap` drops `.staticCall` from the four-line find.
  - The function's name is built from two strings in the runner, as the test builds it.
- **dotenv-gate:** each row replaces `if (!process.env.VITEST) dotenv.config();` with `dotenv.config();` in one site.

Every find occurred exactly once at HEAD (checked before the first run).

**Removals (AC-38):** no test was removed, so this plan has no `AC-38 removed:` line. The plan asks for removed assertions to be named. Assertions removed or narrowed inside converted tests:

- **twoStageSigint**, the converted Test 4 test: `expect(src).not.toContain('function gracefulShutdown')` and `expect(src).not.toContain('Force exit after 5s timeout')`.
  - **Reason:** the absence of old text has no behavior to observe.
  - What the old handler did wrong was a second, competing force-exit timer. The new test's timer counts pin that: exactly one timer is armed, and a second signal arms none.
- **dotenvSrcSkip (e):** the old check that each file has exactly one `dotenv.config(` line, and that it is the gated form.
  - Now a behavior: with VITEST set, no site makes a read attempt, so any unguarded call fails.
  - A gated call that was removed is still caught by (b) and (c) for config, notifier, pause and resume: without VITEST, no read would be attempted.
  - **Not observable:** removing `scripts/preflight.ts`'s own gated call. Preflight imports `src/utils/provider`, which imports `src/config`, and config's gated `dotenv.config()` runs first. So the production behavior is the same without preflight's call. Preflight never runs without VITEST here, because it reaches the DB layer.
- **inclusionReconciliation:** nothing removed. The four text checks (realHash taken from the submit, the seam inside `withNonceLock`, at least two `realHash` inserts, no bare `'mev_bundle'`) and the `.staticCall` text check are each carried by a behavior above.

| File | it() at the phase start | it() now |
|---|---|---|
| twoStageSigint.test.ts | 5 | 5 |
| inclusionReconciliation.test.ts | 18 | 18 |
| dotenvSrcSkip.test.ts | 12 | 12 |
| sourceTextGate.test.ts (new) | 0 | 4 |

**Renamed tests (own title only, recorded in rails-test-edits.json with title_before / title_after, honoured by test-identity):**
- **twoStageSigint:**
  - Before: "bot.ts no longer contains the old single-stage gracefulShutdown / 5s force-exit timer".
  - After: "startMultiChainBot registers exactly one SIGINT and one SIGTERM listener that run the two stages with SIGINT_GRACE_MS".
- **inclusionReconciliation, D-RECORD-REAL-HASH:**
  - Before: "D-RECORD-REAL-HASH: src/bot.ts wires realHash into BOTH the V2 and V3 buy inserts (source/behavior coupling)".
  - After: "D-RECORD-REAL-HASH: the real V2 and V3 buy handlers store the hash the submitBuyTx seam returned, and the seam submits under the wallet nonce lock".
- **inclusionReconciliation, V2-unsafe-real-buy:**
  - Before: "... the V2 safety bank no longer references <name>; the function is deleted and unexported (source/behavior assertion, ...)".
  - After: "... <name> is not exported and named by no src/ code, and the real simulateSwapForChain calls swapExactETHForTokens only through staticCall (...)".
- **dotenvSrcSkip:**
  - Before: "(e) static: each of the five sites loads dotenv only under the VITEST gate".
  - After: "(e) each of the five sites loads dotenv only under the VITEST gate: run as a railed child with VITEST set, each makes zero .env read attempts".
- No describe title changed.

## The AC-37 gate: rule and proofs

**The rule.** A named-file read is a call to `readFileSync` / `readFile` (any receiver) / `createReadStream`, `ts.createSourceFile` (its file name) or `ts.createProgram` (an array, `{ rootNames: x }` or `{ rootNames }`), whose path argument names a file below **top-level** `src/` or `scripts/`:
- **How a path is read:** after dropping `.` and `..`, the first segment is `src` or `scripts`, and a later segment has an extension.
- **How literals are followed:** through `path.join` / `path.resolve` style calls, templates, `+`, array elements, local consts, for-of bindings and a local helper's parameters (its call sites in the same file), up to 3 levels.
- **Not a hit:**
  - a path that contains `os.tmpdir` / `mkdtemp` (a temp-rooted read);
  - `dashboard/src/...` reads;
  - `.env.example`, `package.json` and `tsconfig.json`.

**The allow list** (each entry has its reason in the file):
- the 3 named dashboard tests (SPEC exception, Phase 28 TEST-07);
- `test/realpath/triage/fixtures/AUD-API-002-restart.ts`, by operator ruling, removed by Phase 24.

**Proofs:**
- **On the 11 CHAR-06 files as they were at the phase start** (extracted from the merge base 7d0b7b3), the gate's exact rule flags all 11, with 21 named reads, including mainEntry's `createSourceFile`. This was a one-off run of a copy of the gate's functions. At one const level and with no parameter following, it would flag 9.
- **On today's tree:** 286 files scanned, 1 named read (the allow-listed fixture), 0 violations.
- **Real files that must pass with no entry, each with at least one read the rule evaluated:**
  - `test/realpath/triage/fixtures/scriptsStatic.ts` (a `{ rootNames }` shorthand over a directory walk);
  - `test/helpers/sourceGraph.ts`;
  - `antiRugReason.test.ts` (walkTs plus createSourceFile) and `antiRugConfig.test.ts`;
  - `processLock.test.ts` (package.json) and `preflightCli.test.ts` (a temp load record);
  - `codeQuality`, `db.test`, `ethersV5PatternsAbsent`, `ethersV6BigIntArithmetic`, `forkShellOnly`, `spawnSites` and `envSentinel`;
  - the gate itself;
  - `AUD-SCRIPTS-002.test.ts`, which only writes, has 0 named reads.
- **Temp-directory cases:**
  - **Fail (8 reads in 5 files):** a sync read, callback and promise reads, `ts.createSourceFile`, `ts.createProgram` as an array and as `{ rootNames }`, a helper called with a literal, and a for-of over a const array.
  - **Pass (3 files):** a directory walk into fs, `createProgram` and `createSourceFile`; a temp-rooted read; `.env.example`, `package.json`, `tsconfig.json`, `dashboard/src` and a `fixtures/src` read.

## Files Created/Modified

- `test/unit/sourceTextGate.test.ts` (new): the gate, its allow list and four tests.
- `test/unit/bot/twoStageSigint.test.ts`: the converted Test 4 test, its boot mock set (plain-function factories, one close spy, a logger recorder) and literal `doMock` / `doUnmock` calls.
- `test/unit/mevStrategies/inclusionReconciliation.test.ts`:
  - the two converted tests;
  - the bot mock set and `StubContract`;
  - the shared hoisted ethers factory;
  - `linesNaming`.
  - The `fs` and `path` imports are gone.
- `test/unit/rails/dotenvSrcSkip.test.ts`: case (e) only, one hunk (`git log -p -1` touches lines 152-208 only).
- `scripts/red-proof-conversions.ts`:
  - MUTANTS gains groups sigint (4), inclusion (6) and dotenv-gate (5).
  - CONVERTED_TESTS gains 4 rows.
  - CONVERTED_COUNTS gains twoStageSigint 1, inclusionReconciliation 2 and dotenvSrcSkip 1.
- `.planning/audit/inputs/rails-test-edits.json`: 4 entries, each with title_before / title_after.
- `.planning/audit/ledger/TESTU.json` and `.planning/audit/AUDIT-FINDINGS.md`: the reviewed re_audit row (see Ledger rows).
- `deferred-items.md`: two entries.
  - The fixture's Phase 24 removal.
  - The pre-existing strict type error in inclusionReconciliation.

## Ledger rows (23-11 rule)

- **Added:** `ledger/TESTU.json`, `test/unit/rails/dotenvSrcSkip.test.ts` re_audit `be3c572..1018e79`, findings none, a reviewed note (`6904ec6`).
  - Before it, `check.ts --stage partial` failed with exactly that one FAIL. After it, partial, consolidation and triage all PASS.
- **Not needed:** `twoStageSigint.test.ts` and `inclusionReconciliation.test.ts` were added before `audit_base_sha`, so they need no row.
- **New file:** `sourceTextGate.test.ts` has no ledger row. That is the same out-of-scope `--stage final` bookkeeping kind as earlier plans.

## Decisions Made

See `key-decisions` in the frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Stricter gate] The gate follows more than one const level**
- **Issue:** the plan's rule ("following one level of local const") misses 2 of the 11 phase-start forms (measured): dotenvSrcSkip (e) and mainEntry's `parse(rel)` helper.
- **Fix:**
  - The gate follows local consts, for-of bindings and local helper parameters to 3 levels.
  - It also reads `{ rootNames }` shorthand, which scriptsStatic.ts uses.
  - There are no new hits on today's tree at any level from 1 to 4.
- **Committed in:** 1018e79.

**2. [Rule 2 - Stricter allow list] Only the needed entries are on the allow list**
- **Issue:** the plan lists the path-agnostic scanners and the gate itself.
- **Fix:**
  - They produce no hit, so listing them would only hide a future named read in them. They are not listed.
  - A test asserts each one passes with no entry, and that the rule evaluated at least one read in each.
  - The list holds only named files (the 3 dashboard tests, plus the fixture by operator ruling), each with a reason. That satisfies the acceptance criterion "contains only the named files".
- **Committed in:** 1018e79.

**3. [Rule 1 - Environment fact] The cleanup's `require('./utils/db')` cannot resolve inside a Vitest worker**
- **Found during:** Task 1, first run.
- **Issue:** the first SIGINT's cleanup logged "Cannot find module './utils/db'" and never reached exit 0. Node's own require cannot load a .ts file; ts-node does in production, so this is not a src bug.
- **Fix:** the test forbids any forced exit on the first signal and allows a clean exit 0, so it holds either way. A logger recorder keeps the caught error out of the output.
- **Committed in:** 01b45ef.

**4. [Rule 1 - Readable failure] The V3 row message was truncated**
- **Issue:** Vitest printed `[ …(2) ]` for the V3 row message.
- **Fix:** the row check is split per pool type, so each placeholder mutant now fails with its own `vN buy row tx hash: expected 'mev_bundle'` message. No expected set changed.
- **Committed in:** 1018e79.

**5. [Rule 3 - Gate] Literal `vi.doUnmock` calls**
- **Issue:** a loop over a target array failed check-vi-mock-paths with "non-literal".
- **Fix:** each call is written out literally, in `uninstallBootMocks` and `uninstallBotMocks`.
- **Committed in:** 01b45ef and 1018e79.

**6. [Rule 1 - Type] TS7031 in Task 1's exit-call filter**
- **Found during:** the strict scratch type check.
- **Fix:** separate commit `1ce567a`, no behavior change.

**7. [Measured message] sigint listener rows read `+0`, not `0`**
- **Issue:** Vitest prints `expected +0 to be 1`. The first group run refused the row BAD-FAILURE until `messageIncludes` used the real text, as the plan says ("set from reading its first failing run"). The expected sets are unchanged.

**8. [Plan wording] dotenv (e) children use the transpile-only register**
- **What changed:** the children start through the transpile-only register, not `npx ts-node`, the form 23-31 uses. This cut the run from about 50 s to 2.9 s alone.
- **Unchanged:** they still use the existing probe and the real scripts.

---

**Total deviations:** 8:
- 2 stricter-than-plan gate choices;
- 1 environment fact handled in the test;
- 2 message or type fixes;
- 1 gate-driven rewrite;
- 1 measured message;
- 1 plan-wording choice.

**Impact:** every conversion protects what it protected before, and the gate is stronger than specified. No expected set was changed to fit a result.

## Severity changes and new findings

None. Every behavior these tests protect is intact on HEAD:
- each control run passed;
- each mutant flipped only its expected tests.

The behaviors:
- Both signals are registered once and route through the two-stage handler.
- The grace knob is honoured.
- Buy rows store the real hash.
- The buy seam holds the wallet lock.
- The removed tax function is gone.
- The safety simulation is read-only.
- All five dotenv sites are gated.

No register entry changed.

## Issues Encountered (all diagnosed)

- **Pre-existing strict type error in inclusionReconciliation.test.ts:**
  - TS2345 three times: `affordableFeeInputs()` lacks the now-required `chainPriorityWei`.
  - Present in the HEAD version before this plan, checked on a copy. My lines type-check clean.
  - No tsconfig compiles test/ (the AUD-TESTU-008 class). Logged in deferred-items.md for Phase 28. It may mean those three tests exercise a different fee path than their names say; that is for the fixing plan to judge.
- **First full run slower:**
  - It took 230 s wall (165 s at 23-30), and `test/integration/backupState.test.ts` "exits 0 and every fixture case passes" took 65.9 s of its 120 s limit (55 percent). Not my test.
  - A second full run on the same tree took 168 s, with that test at 52.2 s (43 percent), and dotenv (e) at 2.9 s against 10.3 s in run 1. So run 1 was load variance across the whole run, not this plan's additions.
  - The test is load-sensitive near half its limit; the orchestrator's wave gate should watch it.
- **Line endings:** git warns "LF will be replaced by CRLF" (`core.autocrlf=true`, AUD-OD21-001), as in 23-29 to 23-31.
- **The two "unhandled" strings in each full-run output** are test titles (AUD-BUY-005 and notifierRefusal). The `RAIL_NOTIFIER_REFUSED` warnings come from the rail tests' own deliberate refusals.

## Verification (Node 22.16.0)

**Task verifies, as written:**
- **Task 1:** Vitest on the file (5/5), no `readFileSync` in it, `--group sigint` and src clean: PASS. Re-run on the committed tree as the tracer gate: PASS.
- **Task 2:**
  - Vitest on the three files: 34/34, none skipped.
  - `--group inclusion`, `--group dotenv-gate` and `--check-manifest`: printed `MANIFEST-OK rows 36 files 11 guards 1`.
  - src clean: PASS.

**Acceptance criteria:**
- The converted file's assertions use the real `createTwoStageShutdown` (Tests 1-4) and the real `startMultiChainBot`, as above.
- `git log -p -1 -- test/unit/rails/dotenvSrcSkip.test.ts` (1018e79) touches only case (e): one hunk. Nothing else changed under test/unit/rails or test/rails.
- The allow list holds only named files, each with a reason. The static proofs of 23-13, 23-30 and 23-31 pass without being on it.
- The temp-directory cases fail on named reads through fs and through the compiler API, and pass on a directory walk.
- RED-OK lines for all 4 sigint mutants, 6 inclusion mutants and 5 dotenv-gate mutants are above.
- Each dotenv-gate mutant left a child marker, and its case ledger shows the read was blocked (`env-read-blocked` 1), never allowed.
- **test-identity** (`--base dab8291`, on full run 2): titles 1345 / 1345, missing 0, renamed 4 (this plan's), dynamic mismatch 0.

**Full railed suite** (`npm test`, Node 22.16.0, tree 6904ec6):
- **Run 1** (`run-20261112T144325-2960-441da5`): 200 files, 1,401 tests: 1,401 passed, 0 failed, 0 skipped, 0 todo; wall 230 s. Started in the foreground; Claude Code moved it to the background after 180 s, and it completed with exit 0.
- **Run 2** (`run-20261112T145516-10748-822d59`, foreground): 200 files, 1,401/1,401, wall 168 s.
- **By project:** unit 950, integration 264, realpath 187. Unit is +4 against 23-30's 946: the new gate file.
- **Rail ledger, both runs:** `nonLoopbackAllowed` 0, `telegramAllowed` 0.

**Timing against each test's real limit** (run 1 / run 2):

| Test | Full runs | Limit |
|---|---|---|
| sourceTextGate full-tree scan | 4.4 s / 4.8 s | 60 s |
| sourceTextGate other three | 3 to 260 ms | 5 s |
| twoStageSigint startMultiChainBot test | 10 ms (its import runs in beforeAll; whole file 0.1 s) | 5 s (hook 10 s) |
| inclusion V2-unsafe-real-buy (program over src/) | 2.5 s / 2.3 s | 60 s |
| inclusion D-RECORD-REAL-HASH | 10 ms (import in beforeAll; whole file 3.8 s) | 5 s (hook 10 s) |
| dotenvSrcSkip (e) | 10.3 s / 2.9 s (2.9 s alone) | 120 s |

No test of this plan is at or near half its limit.

**Repeatability (AC-10):**
- The four files, run three times with the JSON reporter: 39/39 each, one md5 over sorted status and full title (7c53c74d...).
- These are not triage files, so there are no knownBug records.
- The three groups were run three times each, with byte-identical output (above).

**Gates and type checks:**
- `tsc --noEmit` exits 0 on tsconfig.json, tsconfig.bot.json and dashboard/tsconfig.json.
- A strict scratch tsconfig over the four test files and the runner leaves only the three pre-existing TS2345 errors above.
- `check-realpath-mocks`: 0 violations. `check-vi-mock-paths`: 660 calls in 270 files, 0 violations. `check-signing-census`: 23 sites, floor 23, 0 problems.
- `check.ts` partial, consolidation and triage: RESULT PASS, fail 0, pending 0, after 6904ec6.
- `red-proof-conversions.ts`:
  - `--self-test`: SELF-TEST-OK cases 30.
  - `--check-manifest`: MANIFEST-OK rows 36 files 11 guards 1.
  - `--check-summaries`: see Self-Check.
- `git status --porcelain src` is empty.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model. T-23-24 is mitigated as planned:
- each conversion keeps its behavior, with removals and narrowings named above;
- the standing AST gate is in place;
- each conversion is shown RED in memory, with nothing written under src/ or scripts/;
- test-identity is clean.

On the new surface:
- The startMultiChainBot test makes no network call: every network, Telegram, API and database seam is mocked. The ledger shows 0 non-loopback and 0 Telegram allows in both runs.
- It removes the signal listeners it added.
- The gate's temp folder is under `os.tmpdir()` and removed in a `finally`.

## User Setup Required

None.

## Next Phase Readiness

- CHAR-06 is complete. All 36 converted tests in 11 files have RED-OK lines across 23-18, 23-31, 23-30 and 23-19, and there are no AC-38 removals.
- 23-26 can run `--check-manifest` (36 / 11 / 1), `--check-summaries` over the four SUMMARYs, and test-identity with the 4 + 5 + 1 + 0 recorded renames.
- Phase 24: the AUD-API-002 fix must remove the restart fixture's allow-list entry together with its mirror (deferred-items.md).

## Self-Check: PASSED

- **Files found:** test/unit/sourceTextGate.test.ts, the three converted test files, scripts/red-proof-conversions.ts, rails-test-edits.json (52 entries), ledger/TESTU.json.
- **Commits on this branch:** 01b45ef, 1ce567a, 1018e79, 6904ec6. `git rev-list --count dab8291..HEAD` = 4 before this SUMMARY.
- **`--check-summaries` over 23-18, 23-31, 23-30 and this SUMMARY:** run immediately before the SUMMARY commit; the commit is chained on its success.
- **Clean tree:** only the operator's own `.planning/config.json` and `.planning/state.json` changes remain, modified and unstaged, besides STATE.md, which the next commit records.

---
*Phase: 23-test-safety-net-harness-triage-characterization*
*Completed: 2026-11-12*

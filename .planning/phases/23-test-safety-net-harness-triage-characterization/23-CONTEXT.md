# Phase 23: Test Safety Net (Harness, Triage, Characterization) - Context

**Gathered:** 2026-11-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Build a real-path test harness (real ethers, fake blockchain, real SQLite migrations, fixed clock). On it, prove or close all 59 register entries behind the 53 triage items. Then lock the bot's current behavior, known bugs tagged, in a golden-master recording and env snapshot that a commit check protects. Add the standing signing census and convert the source-text tests. `src/` gains only test hooks, no bug is fixed, and the bot stays off.

</domain>

<spec_lock>
## Requirements (locked via SPEC.md)

**9 requirements are locked.** See `23-SPEC.md` for full requirements, boundaries, and acceptance criteria (AC-01 to AC-53, plus the edge and prohibition tables).

Downstream agents MUST read `23-SPEC.md` before planning or implementing. Requirements are not duplicated here.

**In scope (from SPEC.md):**
- The real-path harness, the check on its mock list, and the fake transport
- Real-migration test database helper and migration golden tests
- Triage of the 59 register entries, including their register updates and the change to `check.ts` that permits this phase's outcomes
- One manual request for candidate 26, after operator approval
- Golden-master recording and its explicit update command
- Env-matrix snapshot
- Ordering and identity tests
- Standing signing census with its exception list and floor
- Conversion of the source-text tests in Requirement 8
- Commit check, running in CI and by a local command
- Additive test hooks in `src/`, within the limit in Constraints

**Out of scope (from SPEC.md):**
- Fixing any bug, including those proven here (Phase 24 owns S0/S1, Phase 29 owns S2 to S4)
- Rewriting the 31 `vi.mock('ethers')` test files and banning mechanism mocks (Phase 28, TEST-06)
- Any fork run (deferred to Phase 25, UFV-01 to UFV-05)
- The 3 dashboard component source-text tests (Phase 28, TEST-07)
- Repo-wide scanner tests that name no specific file
- Property tests, mutation baselines and coverage floors (Phase 28)
- Turning the wider static gates into CI blockers (Phase 31)

</spec_lock>

<decisions>
## Implementation Decisions

### Fake chain and clock
- **D-01 (transport):** The fake blockchain runs **in-process** for both HTTP and WebSocket JSON-RPC, so event order is exact and runs are byte-identical (AC-12, AC-24). Real ethers still encodes, signs and decodes. HTTP goes through ethers' public `FetchRequest.registerGetUrl`. WebSocket replaces the `WebSocket` property on the `ws` package, which ethers reads afresh at each connect (`node_modules/ethers/lib.commonjs/providers/ws.js`). `vi.mock('ws')` cannot work: Vitest mocks do not reach inside packages it loads natively unless they are inlined. The swap counts as "the fake transport", so it needs no new entry on the AC-02 mock list.
  **Corrected 2026-11-09 after research, operator-approved (23-RESEARCH.md F1):** the mechanism stated above does not work as written. Under Vitest, `src/` receives ethers' ESM build while `@flashbots/ethers-provider-bundle` gets the CJS build, and `FetchRequest` differs between them. ethers also pins its own nested `ws@8.17.1` at `node_modules/ethers/node_modules/ws`, so a swap on the top-level `ws` reaches nothing. The fake transport attaches only if the `realpath` project aliases `ethers` to its CJS build, which is what production loads, and the `WebSocket` swap targets that nested `ws`. The harness must prove at start that these seams attached. The in-process transport and the intent of D-01 are unchanged.
- **D-02 (real-socket exception):** Tests of connection failure use the **real `ws` library on a loopback port**, because AUD-ANTIRUG-002 (a refused reconnect crashes the process) must be proven against the real library. These tests run on real time and never feed the recording.
- **D-03 (node model):** The fake is a **small simulated node**: it accepts the real signed transaction, enforces nonce and chain ID, computes the real hash, mines blocks on command, and returns real receipts. Contract reads (prices, reserves) come from a per-scenario table keyed by address and function, encoded by real ethers. A contract call not in the table fails loudly, matching AC-03 for unknown methods.
- **D-04 (fake data):** Chain data is **synthetic and built with real ethers encoders**. `test/fork/fixtures/realLaunches` holds only addresses and block numbers for a fork run, so there are no captured responses to replay.
- **D-05 (clock):** **All time is fake and stepped by the test**: the date and every timer, including ethers' 10 ms JSON-RPC batching timer. The fixed clock must also cover SQLite: `trades.timestamp` defaults to `unixepoch()` (`src/utils/dbSchema.ts:25`, `:75`), which a JavaScript fake clock cannot reach and which would break AC-24.
- **D-06 (scenario entry):** A recorded scenario enters at **the fake chain's event**: a real `PairCreated` or `PoolCreated` log goes through the real listener, then detection, safety, buy, arming and exits. Only the outer edge of the bot is named, so recordings survive the Phase 27 restructure. The AC-30 boot-order tests are separate and call `startMultiChainBot()` in-process against the fake chain, as 6 test files already do. This is not booting the bot as a program, and it never starts a real bot process.

### Known-bug tests
- **D-07 (proof rule):** An expected-fail test **marks the one assertion that shows the bug and stores the expected and actual values it saw**. Only that exact failure counts. A setup error, timeout, type error or changed value reports as a real failure (AC-09, AC-10). Vitest's `it.fails` is ruled out: the installed 4.1.1 runner turns any non-passing result into a pass.
- **D-08 (fix signal):** A marked test that starts passing **fails with a message saying the finding looks fixed and the marker should come off**. This is the Phase 24 signal.
- **D-09 (home):** Harness, known-bug and recorded-scenario tests live in a **new `realpath` Vitest project in its own folder, part of `npm test` and CI**, with the Phase 22 rails on. The mock-list check covers the whole folder with no exceptions. Its counts stay separate from the 932 and 262 baseline (AC-49).
- **D-10 (file split):** **One test file per root cause**, named after the lead finding, so parallel agents never edit the same file and Phase 24 can run one file for its before-and-after proof. Entries sharing a cause share a file and each is asserted separately (AC-11).
- **D-11 (operator batch):** Known S0/S1 findings return as **one plain-language report grouped by code area, generated from the recorded failures**, giving what was expected and what happened. The operator acknowledges the batch and rules individually only on S0/S1 NOT-A-BUG closures (AC-17) and unreproduced entries (AC-08). The SPEC's stop-at-once rule for new bugs, severity increases and overturned assumptions is unchanged.

### Recording format
- **D-12 (storage):** **One LF-only file per scenario, with its `KEEP` or `SUSPECT(<finding-id>)` tag inside the file.** The commit check reads git directly: a new file passes, and a changed or deleted one needs a `behavior:` commit. A tag flip therefore counts as a change. — **Reversibility:** costly — changing the layout re-records every scenario, and each change needs a `behavior:` commit citing an ID under D-18.
- **D-13 (shape):** Each recording is **one ordered timeline** of `op` logs, submitted transactions, relay bodies and DB writes, in the order they happened. Moving a DB write across a submit must fail the check (CAP-14 and CAP-04 depend on that order). — **Reversibility:** costly — same reason as D-12.
- **D-14 (DB capture):** DB writes are captured by **test-only SQL triggers generated from the migrated schema, calling a recording function** registered with better-sqlite3's `db.function()`. This records what actually landed, including values SQLite fills in, at the right place in the timeline. The DB connection is not exported from `src/utils/db.ts`, so one new `...ForTesting` getter is needed, within the SPEC's `src/` limit. The researcher must prove this works before planning relies on it. The API's existence was confirmed from the installed package, but it has not been run.
  **Corrected 2026-11-09 after research, operator-approved (23-RESEARCH.md F2 and Flag 4):** the premise above is false. `db` is already exported at `src/utils/db.ts:554-555`, so no `...ForTesting` getter is added and the phase's `src/` diff may be empty. The trigger capture has now been run and works.
- **D-15 (no built-in snapshots):** The recording uses its own compare step and explicit update command, not Vitest snapshots. Outside CI, Vitest's default mode writes new snapshots on a normal run, which AC-25 forbids.
- **D-16 (env snapshot):** The env snapshot is **one full baseline with every variable valid, plus only what each case changes or the failure it caused**. At least about 90 variables times 5 values gives 450 or more cases, and full copies could not be reviewed. Phase 24's CAP-06 changes parsing on purpose, so that diff has to be readable.
  **Widened 2026-11-09 by operator ruling (23-RESEARCH.md F4):** the snapshot also covers `src/riskManager.ts`, where the five risk limits are parsed. See SPEC Amendment A-1.
- **D-17 (commit check also covers the env snapshot):** Changing or removing an existing env-snapshot case needs a `behavior:` commit citing an ID. Adding a new variable passes, the same as a new scenario. **This is an operator-approved addition to SPEC Requirement 9**, which names only recorded scenarios.

### Register and seal
- **D-18 (non-behavior recording changes):** A recording change that is not a behavior change (a harness fix, a library upgrade altering how a value prints) needs **its own small register entry stating why**, cited by a `behavior:` commit. There is no standing blanket card and no exempt commit type.
- **D-19 (seal):** A **successor seal**. `SEAL.json` stays byte-unchanged as the Phase 22 record. After triage, a new seal record points back to it, lists what changed, and covers **only the audit folder**, so it can actually stay valid. `seal-verify.ts` is fixed to stop counting a merge commit's whole diff as changes, with new self-tests. This is the SPEC's required reconciliation.
- **D-20 (signing census home):** The census analysis is **promoted into `scripts/` with an npm command and a CI step**, beside `check:vi-mock`, keeping the type-aware analysis and bringing its self-tests. The original in `.planning/audit/tools/` stays as the audit record.
- **D-21 (register enforcement):** `check.ts` **mechanically enforces** that each of the 59 entries has exactly one outcome and its evidence: a test that exists and carries that finding's ID, a Phase 22 rail test for `fixed`, and a recorded ruling for any S0/S1 NOT-A-BUG. Tests are located **by finding ID, not file path**, so Phase 27 moves cannot leave stale pointers. Each new rule gets a self-test.

### Claude's Discretion

The operator was told these would go to the planner's judgment. They were not discussed, so nothing here is an operator decision.
- How each of the 11 source-text tests is converted, under the SPEC rule that each keeps protecting the same behavior (a removal is named with its reason, AC-38).
- The census exception format. Suggested: file plus enclosing function plus call, not line numbers, because the Phase 25 formatter alone would shift every line.
- Env-matrix mechanics. Suggested: in-process with a module reset per case and `process.exit` intercepted (`src/config.ts:241`, `:263`), since a child process for each of 450+ cases is too slow. A read-recorder on `process.env` could prove AC-27 coverage.
- Folder, file, field and command names.
- How the mock-list check is built. `scripts/check-vi-mock-paths.ts` already has an AST walker to reuse.
- Plan and wave breakdown, following the ROADMAP's three waves and the operator's preference for few large phases with risk isolated at plan and commit level.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase contract
- `.planning/phases/23-test-safety-net-harness-triage-characterization/23-SPEC.md` — Locked requirements — MUST read before planning. Where it differs from the ROADMAP (53 items rather than 28, no fork evidence), the SPEC wins by operator ruling.
- `.planning/ROADMAP.md` §"Phase 23" — goal, three-wave outline, conventions, research flag
- `.planning/REQUIREMENTS.md` §Audit (AUDIT-02, AUDIT-06), §Characterization (CHAR-01 to CHAR-06)

### Binding project conventions
- `.planning/phases/22-safety-rails-audit/22-CONTEXT.md` — Phase 22 D-01 to D-24, notably D-03 (`spawnRailedChild` only), D-15 (one file per finding, mechanical checks), D-16 (escalation tiers), D-21 (Node 22.16.0 by absolute path)
- `.planning/milestones/v6.17-phases/21-exit-engine-live-runtime-hardening/21-CONTEXT.md` — D-STOP-THE-LINE, D-GATE-BOTH-LAYERS, D-ROLLBACK
- `.planning/milestones/v6.17-phases/21.2-calm-gas-sell-inclusion-exit-engine-robustness/21.2-CONTEXT.md` — D-NONCE-AUTHORITY-ALL, D-TEST-BOTH, D-QUALITY-FIRST

### Audit register and seal
- `.planning/audit/PROTOCOL.md` — register rules
- `.planning/audit/SEAL.json` — the Phase 22 seal, which must not be edited (D-19)
- `.planning/audit/tools/check.ts` — register checker; the NOT-A-BUG ban is at line 320
- `.planning/audit/tools/seal-verify.ts` — seal check; the merge-counting flaw is in `verifySeal` (the `--diff-merges=first-parent` log)
- `.planning/audit/tools/signing-census.ts` — the census to promote (D-20)
- `.planning/audit/census/signing-sites-head.json` — the 23-site census
- `.planning/audit/.gitattributes` — the LF pattern the recording folder needs

### Research inputs
- `.planning/research/PITFALLS.md` §"Characterize at the I/O boundary" (decision-trace definition), §commit taxonomy
- `.planning/research/FEATURES.md` §4.2 (characterization set), line 299 (rewrite pattern)
- `.planning/research/SUMMARY.md` §"Audit Candidates Already Surfaced" (the 28 candidates)

### Do not rely on
- `.planning/codebase/TESTING.md`, `CONVENTIONS.md`, `STRUCTURE.md` — dated 2026-03-19 and badly stale. `TESTING.md` says no test framework exists. Read the code instead.

### External docs
- Vitest mocking and `server.deps.inline` — https://vitest.dev/guide/mocking/modules
- Vitest fake timers — https://vitest.dev/guide/mocking/timers
- ethers v6 `FetchRequest` — https://docs.ethers.org/v6/api/utils/fetching/

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `test/rails/` (`setup.cjs`, `spawnRailedChild.ts`): Phase 22 rails. Loopback connections are allowed, which D-02 needs.
- `src/utils/dbSchema.ts` (`migrateSchema`, `CURRENT_SCHEMA_VERSION`): the real migrations for `createTestDb` and the golden tests.
- `src/utils/dbPath.ts`: already accepts `:memory:`.
- `scripts/check-vi-mock-paths.ts`: AST walker and the CI-gate shape to copy.
- Existing `...ForTesting` helpers in `src/exitEngine.ts`, `src/anti-rug/detector.ts`, `src/anti-rug/circuitBreaker.ts`, `src/utils/exitManager.ts` and `src/utils/nonceAuthority.ts`.

### Established Patterns
- Providers are built from URLs: `src/utils/provider.ts:23`, `:37`, `src/bot.ts:1563`, `:1605`, `src/anti-rug/detector.ts:924`. Constructor injection is not available, hence D-01.
- Flashbots relay calls use ethers `FetchRequest` (`src/utils/mevStrategies/flashbots.ts:97`), so the D-01 HTTP hook sees them. bloXroute uses axios (`src/utils/mevStrategies/bloxroute.ts:48`, `:156`), which falls under "relay HTTP" on the mock list.
- `src/utils/db.ts` opens and migrates at import, and exports its connection as `db` (corrected, see D-14).
- `src/config.ts` runs validation at import and can `process.exit(1)`.
- Module singletons sit behind the Phase 22 duplicate-load guard (epoch sentinel), so harness resets must be whole-graph resets.
- Commit types in history are `docs:`, `feat:`, `test:`, `fix:` and `chore:`, and GSD tools also emit scoped forms.

### Integration Points
- `vitest.config.ts`: add the `realpath` project with the rails `setupFiles`.
- `package.json`: `test` plus new commands for the update step, census and commit check.
- `.github/workflows/test.yml`: new steps. `actions/checkout@v4` is shallow by default, and the commit check needs history.
- `src/utils/db.ts`: no change needed, since `db` is already exported (D-14, corrected).
- `test/helpers/testDb.ts`: replace the hand-written schema with the real migrations.
- `.planning/audit/tools/check.ts:320` and `seal-verify.ts` (D-19, D-21).

</code_context>

<specifics>
## Specific Ideas

- **Seal state at the start of this phase.** `seal-verify.ts` already reports `SEAL INVALID` at HEAD, diagnosed on 2026-11-09. Merging PR #2 made 757 paths look changed through the merge-counting flaw, against 12 changed paths excluding merges. Nine of those 12 are genuinely outside the exempt list (`.gitignore`, seven `.planning/intel` files, `23-SPEC.md`). No finding, decision card or rendered register changed, so this is not tampering. Nothing in CI runs the tool.
- **Land the recording only once the harness has settled**, because the commit check judges every commit after the recording's first commit (AC-44), and later format changes each cost a D-18 entry.
- **Operator-facing text in plain words.** Every checkpoint, the D-11 report and the candidate 26 approval must name tools by what they do. This carries over from Phase 22.
- **`STATE.md` is partly stale:** the "Merge Phase 22 before starting Phase 23" blocker is resolved, since PR #2 merged at `657d27b`.

**Research flags for the phase researcher:**
1. Prove the `ws.WebSocket` swap reaches ethers under Vitest, and that nothing calls `FetchRequest.lockConfig`.
2. Check whether `@flashbots/ethers-provider-bundle` loads a second ethers copy, since `registerGetUrl` is per-copy. `npm ls` already reports a peer mismatch (6.16.0 against 6.7.1).
3. A stepping helper for fake timers with ethers batching, polling and `tx.wait()`, under the projects' `mockReset: true`.
4. Prove D-14 (triggers calling a better-sqlite3 function inside the bot's transactions), and find how to fix `unixepoch()` on the test connection.
5. Whole-graph resets between scenarios with the Phase 22 duplicate-load guard and `DB_PATH=:memory:`.
6. How `process.exit` behaves in a Vitest worker for the env matrix.
7. Running the census on the working tree, since it was built around a `--root` snapshot, and its runtime in CI.

</specifics>

<deferred>
## Deferred Ideas

None. Discussion stayed within phase scope. The one addition (D-17) was approved by the operator as part of the commit check.

</deferred>

---

*Phase: 23-test-safety-net-harness-triage-characterization*
*Context gathered: 2026-11-09*

# Phase 23: Test Safety Net (Harness, Triage, Characterization) — Specification

**Created:** 2026-11-09
**Ambiguity score:** 0.16 (gate: ≤ 0.20)
**Requirements:** 9 locked

## Goal

Every one of the 53 triage items is proven by a failing real-path test, closed by existing proof, or ruled NOT-A-BUG, and the bot's current behavior is locked by a golden-master recording that a commit check protects, with no change to trading behavior in `src/`.

## Background

Measured on 2026-11-09 at `7d0b7b3`:

- **Tests:** 932 unit and 262 integration tests are collected, under the Phase 22 safety rails. There is no real-path harness. 31 test files call `vi.mock('ethers')`, and `test/helpers/mockProvider.ts` returns `vi.fn()` objects.
- **Test database:** `test/helpers/testDb.ts` hand-writes a two-table schema at `user_version = 4`, while production is at version 7 through `migrateSchema` and `CURRENT_SCHEMA_VERSION` in `src/utils/dbSchema.ts`. 5 test files use the helper. `src/utils/dbPath.ts` already accepts `:memory:`.
- **Audit register:** 290 entries, 49 of them canonical S0/S1. The 53 triage items are the 28 research candidates (34 register entries) plus the 25 other S0/S1 findings, which makes 59 register entries. The 25 include the only S0 (AUD-BUY-001) and the broken daily-loss limit (AUD-DB-002). Most entries are `confirmed` from reading code. AUD-TESTI-020 records that no integration or fork test catches any of the 39 money-path S0/S1 findings on the real path.
- **Reachability of the 59 entries:** 48 sit in exported code or in private code an exported caller in the same file reaches. 10 are import-time behavior or constants. 1 is a past event. This is an in-file call trace. It does not prove each bug can be triggered.
- **Register tooling:** `.planning/audit/tools/check.ts:320` refuses NOT-A-BUG on research candidates. That was a Phase 22 rule and blocks this phase's outcomes until changed.
- **Signing sites:** the census at `.planning/audit/census/signing-sites-head.json` counts 23 transaction-signing sites. 10 in `src/` are locked, 1 in `src/` is unlocked (`simulateSell`, AUD-BUY-007), and 12 in `scripts/` are unlocked (AUD-SCRIPTS-002). The census tool is `.planning/audit/tools/signing-census.ts`. No standing test asserts this.
- **Source-text tests:** 11 test files read a named top-level `src/` or `scripts/` file as text and assert on it. 3 dashboard component tests do the same to React files.
- **Decision trace:** 162 `op:` log sites exist in `src/`. Nothing records them. Submission uses three routes: Flashbots (ETH, the only live chain), bloXroute (BSC) and the public route (Base, Arbitrum), and those three non-ETH chains are fail-closed.
- **Commits:** no commit check exists. Recent history uses `docs:`, `feat:`, `test:`, `fix:` and `chore:`, and has no `behavior:` commits.
- **Telegram:** the allowlist handler is an inline function inside `startTelegramListener`, so only a fake Telegram client can drive it.

## Requirements

1. **Real-path harness (CHAR-01)**: Harness tests run real ethers against a fake JSON-RPC transport and a real in-memory SQLite database built by the real migrations, under a fixed clock.
   - Current: No harness exists. Money-path tests mock ethers or the mechanism under test.
   - Target: Real ethers does encoding, signing and receipt decoding against a fake transport covering HTTP and WebSocket JSON-RPC. Only the logger, notifier, broadcaster, relay HTTP, clock and Telegram client library are mocked, and a check enforces that list.
   - Acceptance: AC-01 to AC-03.

2. **Real migrations in tests (CHAR-05)**: Migration golden tests run the real migrations, and the test database helper builds its schema with them.
   - Current: `createTestDb` hand-writes a schema at version 4, and migration tests mirror `db.ts` rather than running it.
   - Target: Golden tests run the real migrations from version 0 to 7 and from 4 to 7. `createTestDb` uses the real migrations, and the hand-written schema is gone from the helper.
   - Acceptance: AC-04 to AC-07.

3. **Triage of the 53 items (AUDIT-02, extended by operator ruling)**: Each of the 59 register entries behind the 53 items ends in one recorded outcome.
   - Current: Most entries are `confirmed` from reading code, and none has a real-path failing test.
   - Target: Each entry ends as one of: `confirmed` with a committed expected-fail real-path test; `NOT-A-BUG` with evidence; or `fixed` with a pointer to the existing test that fails if the fix is removed. An entry that cannot be reproduced stays open. No fork run is used as evidence.
   - Acceptance: AC-08 to AC-18.

4. **Golden-master recording (CHAR-02)**: A decision recording captures what the bot does today, with known bugs tagged rather than blessed.
   - Current: No recording exists.
   - Target: The recording holds `op` logs, submitted transaction requests and calldata, relay request bodies, and database writes, for the scenarios in AC-19.
   - Acceptance: AC-19 to AC-26.

5. **Env-matrix snapshot (CHAR-03)**: A snapshot records how config and chain-registry parsing handle bad and good values.
   - Current: No snapshot exists. Several parsers treat invalid values differently (candidate 6).
   - Target: Every environment variable read by `src/config.ts` and `src/chainRegistry.ts`, and by `src/riskManager.ts` under Amendment A-1, is recorded for `{unset, '', '0', 'abc', valid}`.
   - Acceptance: AC-27 to AC-29.

6. **Ordering and identity tests (CHAR-04, first half)**: Tests pin boot, resume and arm ordering, listener counts, same-block event ordering, and singleton identity.
   - Current: CHAR-04 has no dedicated test set.
   - Target: These behaviors are pinned as they work today, and anything found to be wrong is tagged `SUSPECT(<finding-id>)`.
   - Acceptance: AC-30 and AC-31.

7. **Standing signing census (CHAR-04, second half)**: A standing check proves every signing site in `src/` and `scripts/` goes through `withNonceLock`, apart from a named list of known exceptions.
   - Current: A one-off census exists in `.planning/audit/`, and nothing enforces it.
   - Target: The check has a floor of 23 sites. The 13 known unlocked sites are listed by finding ID (1 under AUD-BUY-007, 12 under AUD-SCRIPTS-002), and any other unlocked site fails.
   - Acceptance: AC-32 to AC-36.

8. **Source-text conversion (CHAR-06, with one operator exception)**: Tests that assert on the text of a named source file become behavior checks that name no such file.
   - Current: 11 files do this: `test/integration/anti-rug/botWiring.test.ts`, `test/integration/pauseCli.test.ts`, `test/integration/preflightCli.test.ts`, `test/integration/processLock.test.ts`, `test/unit/api/antiRug.test.ts`, `test/unit/bot/twoStageSigint.test.ts`, `test/unit/chainRegistry/antiRugConfig.test.ts`, `test/unit/exitEngine/antiRugReason.test.ts`, `test/unit/mainEntry.test.ts`, `test/unit/mevStrategies/inclusionReconciliation.test.ts`, and `test/unit/rails/dotenvSrcSkip.test.ts` (case e).
   - Target: Each is converted and keeps protecting the same behavior. AC-37 is a search, so any file missed by this list is still in scope.
   - Acceptance: AC-37 and AC-38.

9. **Commit check (AUDIT-06, widened to all commit types by operator ruling)**: A commit check protects the recording and enforces decision IDs.
   - Current: No check exists.
   - Target: A commit of any type that changes or removes an existing recorded scenario fails unless it is a `behavior:` commit citing a real `OD-NN` or `AUD-...` ID. A `behavior:` commit without one fails. Adding a brand-new scenario does not count as a change. Amendment A-2 applies the same rule to env-snapshot cases.
   - Acceptance: AC-39 to AC-44.

## Boundaries

**In scope:**
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

**Out of scope:**
- Fixing any bug, including those proven here — Phase 24 owns S0/S1, and Phase 29 owns S2 to S4 under AUDIT-07
- Rewriting the 31 `vi.mock('ethers')` test files and banning mechanism mocks — Phase 28 (TEST-06)
- Any fork run — the operator deferred the real fork run to Phase 25 (UFV-01 to UFV-05) because the fork rails have only been rehearsed
- The 3 dashboard component source-text tests (`test/unit/dashboard/pauseBanner.test.ts`, `anti-rug/displayComponents.test.ts`, `anti-rug/interactiveComponents.test.ts`) — named exception to CHAR-06, moved to Phase 28 (TEST-07), because converting them needs a browser-simulation test library and those files do not move in Phase 27
- Repo-wide scanner tests that name no specific file (for example `test/unit/codeQuality.test.ts`) — already path-agnostic
- Property tests, mutation baselines and coverage floors — Phase 28 (TEST-08 to TEST-10)
- Turning the wider static gates into CI blockers — Phase 31 (CI-01, CI-02)

## Constraints

- **`src/` limit:** `src/` may only gain an `export` on existing code or a new `...ForTesting` helper like those already there. Whoever reviews the phase confirms this by reading the `src/` diff.
- **Runtime:** every command runs on Node 22.16.0 by absolute path, because the global Node 24 cannot load better-sqlite3.
- **Safety rails stay on:** tests never read the real `.env`, open `data/bot.db`, reach the network or send Telegram alerts. The only outside network call in the phase is the candidate 26 manual request, made outside the test run.
- **Bot stays off:** never boot `src/bot.ts` or `src/main.ts` to test. `npm run preflight` is the only read-only check.
- **Bringing bugs to the operator:** work stops and goes to the operator at once for a bug not already in the register, a severity increase, or anything that overturns a scoping assumption. Known S0/S1 findings return as one batch with their failing tests at the end of triage.
- **Nonce candidates:** candidates 10, 11 and 17 are triaged on the real `withNonceLock` (D-NONCE-AUTHORITY-ALL).
- **Line endings:** the repo-wide `.gitattributes` does not land until Phase 25 and `core.autocrlf=true` is set, so the recording needs its own LF guarantee, as `.planning/audit/.gitattributes` does.
- **Register seal:** register edits post-date the Phase 22 seal in `.planning/audit/SEAL.json`. The plan must say how they are reconciled with it.

## Acceptance Criteria

**Harness**
- [ ] AC-01: A harness test drives one buy through real ethers, the fake transport and the real-migration database, and the submitted transaction decodes through real ethers to the expected swap call.
- [ ] AC-02: The mock-list check fails when a harness test mocks anything other than the logger, notifier, broadcaster, relay HTTP, clock or Telegram client library, shown by adding a forbidden mock.
- [ ] AC-03: A call to a JSON-RPC method the fake does not know fails the test with an error naming the method.

**Migrations and test database**
- [ ] AC-04: A golden test runs the real migrations from an empty version 0 database to version 7 and matches the recorded schema.
- [ ] AC-05: A golden test upgrades a version 4 database to version 7, matches the recorded schema, and the rows seeded at version 4 are still present.
- [ ] AC-06: Running the migrations again on a version 7 database leaves schema and rows unchanged.
- [ ] AC-07: `createTestDb` returns a database whose `user_version` equals `CURRENT_SCHEMA_VERSION`, and `test/helpers/testDb.ts` contains no hand-written schema.

**Triage**
- [ ] AC-08: Each of the 59 register entries has exactly one outcome from Requirement 3, or is on a list of unreproduced entries the operator has reviewed.
- [ ] AC-09: Each expected-fail test asserts the correct behavior and fails on that assertion. A setup error, type error or timeout reports as a real failure.
- [ ] AC-10: Each expected-fail test fails the same way on 3 runs in a row.
- [ ] AC-11: A test covering several entries asserts each one, and every entry names its own status and test.
- [ ] AC-12: Race findings are shown by forcing the exact order of events, with no reliance on sleeps or timing.
- [ ] AC-13: AUD-TX-004, AUD-TX-005, AUD-RAIL-002, AUD-TESTI-011, AUD-TESTU-001 and AUD-RAIL-001 close as `fixed`, each naming the Phase 22 rail test that fails if the rail is removed.
- [ ] AC-14: AUD-DB-006 has a failing test for its still-open half, that every import of `db.ts` writes to the database.
- [ ] AC-15: AUD-TX-006 (candidate 26) records the raw response of one manual request, signed by a throwaway unfunded key that is not the bot's, sent only after operator approval.
- [ ] AC-16: No fork run is used. An item that truly needs one is flagged unproven, shown to the operator, and added to the Phase 25 fork obligations.
- [ ] AC-17: Every S0/S1 closed as NOT-A-BUG has a recorded operator ruling.
- [ ] AC-18: Every confirmed S0/S1 has been shown to the operator with its failing test, recorded before Phase 24 starts.

**Golden-master recording**
- [ ] AC-19: Scenarios exist for: Flashbots V2 and V3 buys, each with trailing, partial, stop-loss, urgency and anti-rug exits; a V2 buy, a V3 buy and one full sell on bloXroute and on the public route; the risk gate; and fee and gas computation.
- [ ] AC-20: Each scenario's recording contains its `op` logs, submitted transaction requests and calldata, relay request bodies, and database writes.
- [ ] AC-21: Each scenario is tagged `KEEP` or `SUSPECT(<finding-id>)`, and every cited ID exists in the register.
- [ ] AC-22: A scenario with no transaction, such as a risk-gate refusal, records an explicit empty list.
- [ ] AC-23: Entries stay in the order they happened and are never sorted.
- [ ] AC-24: 3 runs in a row produce byte-identical output.
- [ ] AC-25: A normal test run never writes the recording. Only an explicit update command does.
- [ ] AC-26: The recording has LF line endings on Windows and Linux, amounts as whole-number text, and no file paths, line numbers or stack traces.

**Env matrix**
- [ ] AC-27: The snapshot covers every variable read by `src/config.ts`, `src/chainRegistry.ts` and `src/riskManager.ts` (Amendment A-1) for unset, empty string, `0`, `abc` and a valid value.
- [ ] AC-28: A value that makes parsing throw is recorded as the result and is not a test failure.
- [ ] AC-29: Keys are sorted by name, and one variable is varied at a time with the others at valid values.

**Ordering and identity**
- [ ] AC-30: Tests pin boot, resume and arm ordering, listener counts, and singleton identity.
- [ ] AC-31: At least one test puts two events in the same block and pins today's order, tagged `SUSPECT(<finding-id>)` if that order is wrong.

**Signing census**
- [ ] AC-32: A new unlocked signing site in `src/` or `scripts/` fails the check, shown with a deliberate example.
- [ ] AC-33: Exactly 23 signing sites passes and 22 fails.
- [ ] AC-34: The floor drops only in a commit naming the finding that removed the site.
- [ ] AC-35: The 13 known exceptions are listed with finding IDs, and a listed exception that has been fixed or removed fails the check until it comes off the list.
- [ ] AC-36: A scan that finds no files or no sites fails.

**Source-text conversion**
- [ ] AC-37: A search of `test/` finds no test that reads a named top-level `src/` or `scripts/` file as text and asserts on it, apart from the 3 named dashboard tests if they do.
- [ ] AC-38: A test removed rather than converted appears by name with its reason in the plan summary.

**Commit check**
- [ ] AC-39: A commit of any type that changes or removes an existing recorded scenario fails unless it is a `behavior:` commit citing a real ID, shown with a deliberately violating commit.
- [ ] AC-40: A commit that only adds a brand-new scenario passes.
- [ ] AC-41: A `behavior:` commit with no ID, or citing an ID absent from the register, fails, shown with deliberately violating commits.
- [ ] AC-42: Merge commits are not judged, and the commits inside them are.
  - Superseded 2026-11-12 by code-review finding WR-27 (23-REVIEW.md; operator ruling "Keep the stricter rule"): a merge commit whose own result changes `test/realpath/recordings/` is judged like any other commit (a `behavior:` subject citing IDs that exist in its tree). A merge that changes nothing there is still not judged, and the commits inside every merge still are.
- [ ] AC-43: The violation demonstrations run on throwaway commits in a temporary repo and never enter real history.
- [ ] AC-44: The check runs in CI and by a local command, and judges only commits made after the recording's first commit.

**Scope of `src/` changes**
- [ ] AC-45: The phase's `src/` diff contains only added `export` keywords on existing code and new `...ForTesting` helpers, confirmed by review.

**Prohibitions (see table below)**
- [ ] AC-46: No confirmed-bug behavior is tagged `KEEP`.
- [ ] AC-47: No S0/S1 is downgraded or closed without an operator ruling.
- [ ] AC-48: No test passes on fake chain responses a real node could never return.
- [ ] AC-49: No existing test is deleted, skipped or weakened to get a green run. Collected counts are at least 932 unit and 262 integration, less any named removals.
- [ ] AC-50: The phase fixes no bug and changes no trading behavior.
- [ ] AC-51: Recordings and env snapshots hold only inert test values, confirmed by a secret scan.
- [ ] AC-52: No `...ForTesting` helper is called from production code.
- [ ] AC-53: No signing site is added to the census exception list without an operator decision ID.

## Edge Coverage

**Coverage:** 28/28 applicable edges resolved · 0 unresolved

| Category | Requirement | Status | Resolution / Reason |
|----------|-------------|--------|---------------------|
| unclassified | R1 | ✅ covered | AC-03 unknown RPC method fails loudly; Telegram library added to the mock list in AC-02 |
| unclassified | R2 | ✅ covered | AC-05 rows survive upgrade, AC-06 re-run changes nothing |
| adjacency | R3 | ✅ covered | AC-11 a shared test asserts each entry |
| empty | R3 | ✅ covered | AC-08 an unreproduced entry stays open and never defaults to NOT-A-BUG |
| ordering | R3 | ⛔ dismissed | The order items are worked in does not change the outcome, since all must close |
| idempotency | R3 | ✅ covered | AC-10 same failure on 3 runs |
| concurrency | R3 | ✅ covered | AC-12 race bugs use forced event order |
| adjacency | R4 | ✅ covered | AC-23 same-time entries keep the order they happened |
| empty | R4 | ✅ covered | AC-22 explicit empty list |
| ordering | R4 | ✅ covered | AC-23 never sorted, AC-24 identical runs |
| concurrency | R4 | ✅ covered | AC-25 only the update command writes |
| encoding (added by author) | R4 | ✅ covered | AC-26 LF, whole-number text, no paths or stack traces |
| adjacency | R5 | ✅ covered | AC-29 one variable varied at a time |
| empty | R5 | ✅ covered | AC-27 unset and empty string are in the matrix |
| encoding | R5 | ⛔ dismissed | The inputs are a fixed plain-text set |
| ordering | R5 | ✅ covered | AC-29 keys sorted by name |
| unclassified | R6 | ✅ covered | AC-31 two events in one block |
| boundary | R7 | ✅ covered | AC-33 23 passes and 22 fails, AC-34 floor rule |
| adjacency | R7 | ✅ covered | AC-35 a fixed exception must come off the list |
| empty | R7 | ✅ covered | AC-36 empty scan fails |
| ordering | R7 | ⛔ dismissed | The result is a whole count and a set |
| precision | R7 | ⛔ dismissed | The result is a whole count, with no rounding |
| adjacency | R8 | ⛔ dismissed | Each test file is converted on its own, so nothing merges |
| empty | R8 | ✅ covered | AC-38 removal needs a recorded name and reason |
| encoding | R8 | ⛔ dismissed | No source text is read after conversion |
| ordering | R8 | ⛔ dismissed | The conversion produces no ordered output |
| concurrency | R8 | ⛔ dismissed | Each file is converted on its own, with no shared state |
| unclassified | R9 | ✅ covered | AC-40 new scenarios pass, AC-41 unknown IDs fail, AC-42 merge commits, AC-43 throwaway demonstrations, AC-44 starting point |

## Prohibitions (must-NOT)

**Coverage:** 8/8 applicable prohibitions resolved · 0 unresolved

| Prohibition (must-NOT statement) | Requirement | Status | Verification / Reason |
|----------------------------------|-------------|--------|------------------------|
| MUST NOT tag confirmed-bug behavior as `KEEP` (AC-46) | R4 | resolved | judgment: review of scenario tags against the register |
| MUST NOT downgrade or close an S0/S1 without an operator ruling (AC-47) | R3 | resolved | judgment: review of register changes |
| MUST NOT pass a test on fake chain responses a real node could never return (AC-48) | R1 | resolved | judgment: review of fake transport data |
| MUST NOT delete, skip or weaken an existing test to get green (AC-49) | R2, R8 | resolved | test: collected counts against the 932 / 262 baseline, with named removals; the wired check is named at plan time |
| MUST NOT fix a bug or change trading behavior in this phase (AC-50) | R3 | resolved | judgment: reading the `src/` diff |
| MUST NOT write real secrets, keys, RPC URLs or env values into recordings or snapshots (AC-51) | R4, R5 | resolved | test: secret scan over recording files; the wired check is named at plan time |
| MUST NOT call a `...ForTesting` helper from production code (AC-52) | Constraints | resolved | judgment: reading the `src/` diff |
| MUST NOT add a signing site to the census exception list without an operator decision ID (AC-53) | R7 | resolved | judgment: review of list changes |

Canon referral: redaction of secrets in production logs (AUD-DB-009, AUD-DB-010) is owned by Phase 24 and /gsd-secure-phase, and is not minted here.

## Amendments

Approved by the operator on 2026-11-09, after this SPEC was written. Where an amendment differs from the text above, the amendment wins.

- **A-1 (widens Requirement 5 and AC-27):** The env-matrix snapshot also covers every variable read by `src/riskManager.ts`. The five risk limits are parsed there, and Phase 24's CAP-06 changes that parsing. AC-28 and AC-29 apply to these cases too.
- **A-2 (widens Requirement 9, from CONTEXT D-17):** The commit check also protects the env snapshot. Changing or removing an existing env-snapshot case needs a `behavior:` commit citing a real ID. Adding a new variable passes, the same as a new scenario.
- **A-3 (narrows the expected `src/` diff, from CONTEXT D-14 as corrected):** The database connection is already exported as `db`, so no `...ForTesting` getter is added for it. The phase's `src/` diff may be empty, and AC-45 remains the limit.
- **A-4 (fixes the transport mechanism in Requirement 1, from CONTEXT D-01 as corrected):** The fake transport requires the `realpath` Vitest project to alias `ethers` to its CommonJS build and the `WebSocket` swap to target the `ws` copy nested inside ethers. The harness proves at start that both attached. The alias selects which build of real ethers loads, so it is not a mock and needs no AC-02 mock-list entry.

## Ambiguity Report

| Dimension          | Score | Min  | Status | Notes                                                    |
|--------------------|-------|------|--------|----------------------------------------------------------|
| Goal Clarity       | 0.90  | 0.75 | ✓      | Roadmap goal plus operator's scope ruling on 53 items    |
| Boundary Clarity   | 0.85  | 0.70 | ✓      | Explicit out-of-scope list, each operator-confirmed      |
| Constraint Clarity | 0.75  | 0.65 | ✓      | `src/` limit, no fork, stop-the-line timing locked       |
| Acceptance Criteria| 0.80  | 0.70 | ✓      | 53 pass/fail criteria                                    |
| **Ambiguity**      | 0.16  | ≤0.20| ✓      |                                                          |

Status: ✓ = met minimum, ⚠ = below minimum (planner treats as assumption)

## Interview Log

| Round | Perspective     | Question summary                                   | Decision locked                                                                 |
|-------|-----------------|----------------------------------------------------|---------------------------------------------------------------------------------|
| 1     | Researcher      | Which items does triage cover?                     | All 53: the 28 candidates plus the 25 other S0/S1 findings                      |
| 1     | Researcher      | May `src/` change at all?                          | Neutral test hooks allowed                                                      |
| 1     | Researcher      | May the fork count as proof?                       | No fork runs in Phase 23                                                        |
| 2     | Simplifier      | How wide is the recording?                         | Full set on Flashbots; V2 buy, V3 buy and one full sell on each other route     |
| 2     | Researcher      | What does the signing check cover?                 | `src/` and `scripts/`, with 13 named exceptions                                 |
| 2     | Simplifier      | What is the limit on a test hook?                  | Only `export` on existing code or a new `...ForTesting` helper; reviewer checks the diff, no bespoke script |
| 3     | Boundary Keeper | How do already-fixed items close?                  | Pointer to the Phase 22 rail test; partly fixed items still get a failing test  |
| 3     | Boundary Keeper | What proves candidate 26?                          | One manual request with a throwaway key, after operator approval                |
| 3     | Boundary Keeper | Convert the 3 dashboard tests now?                 | Hand them to Phase 28 as a named CHAR-06 exception                              |
| 4     | Failure Analyst | Who closes an S0/S1 as NOT-A-BUG?                  | The operator rules on each; S2 and below close on written evidence              |
| 4     | Failure Analyst | When does the operator hear about proven bugs?     | Surprises at once; known S0/S1 in one batch at the end of triage                |
| 4     | Failure Analyst | Which commits does the check judge?                | Any commit type; adding a new scenario does not count                           |
| Probe | Edge            | 28 edge cases resolved with the operator           | 20 specified, 8 dismissed with reasons                                          |
| Probe | Prohibition     | 8 must-NOT rules                                   | All 8 kept (2 test tier, 6 judgment tier)                                       |
| Probe | Boundary Keeper | Convert the rail test that names five source files? | Yes, as the 11th file, keeping what it protects                                |

---

*Phase: 23-test-safety-net-harness-triage-characterization*
*Spec created: 2026-11-09*
*Next step: /gsd-discuss-phase 23 — implementation decisions (how to build what's specified above)*

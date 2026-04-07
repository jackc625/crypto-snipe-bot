---
phase: 15
reviewers: [gemini, codex]
reviewed_at: 2026-04-07T17:27:40Z
plans_reviewed: [15-01-PLAN.md, 15-02-PLAN.md]
self_skipped: claude (running inside Claude Code CLI)
---

# Cross-AI Plan Review — Phase 15

## Gemini Review

This review evaluates **Phase 15: Chain-Scoped Dedup & Dashboard Env Validation**.

### Summary
Phase 15 is a critical "cleanup and alignment" phase that resolves architectural gaps identified in the v6.16 audit. Plan 15-01 correctly addresses the chain-scoping issue for token deduplication, which is essential for multi-chain scaling (preventing a BSC snipe from blocking an ETH snipe). It also aggressively removes legacy tech debt. Plan 15-02 implements necessary fail-fast validation for the dashboard API key. While the logic is sound, there are **high-severity risks** regarding migration data consistency (mainnet vs. eth) and a **major flaw in the testing strategy** where the test verifies a copy of the SQL rather than the actual production implementation.

### Strengths
*   **Tech Debt Elimination:** Deleting ~250 lines of legacy single-chain code prevents "zombie code" bugs and clarifies the entry points for future developers.
*   **Fail-Fast Security:** Adding `DASHBOARD_API_KEY` to `REQUIRED_ENV_VARS` prevents the bot from starting in a partially broken state, which is vital for headless MEV operations.
*   **Contextual Awareness:** The plans correctly identify that `trades.chain` already exists and has an index, avoiding unnecessary schema migrations.
*   **Defense-in-Depth:** D-09 wisely preserves the runtime check in `auth.ts`, protecting against configuration drift after startup.

### Concerns

#### 1. Data Migration Inconsistency: 'mainnet' vs 'eth' (HIGH)
*   **Issue:** Phase 3/4 established a DB default of `'mainnet'`. If `ctx.chain.name` returns `'eth'` (common in many registries) or `'ethereum'`, the `SELECT` query `WHERE chain = ?` will fail to match existing trades marked as `'mainnet'`.
*   **Risk:** The bot will "double-snipe" every token it already sniped on Ethereum prior to this fix. This violates the "never lose money to preventable bugs" mandate, as it could result in duplicate positions and wasted gas.
*   **Plan Reference:** Plan 15-01, Task 1.

#### 2. Testing "The Map, Not the Territory" (HIGH)
*   **Issue:** Task 3 in Plan 15-01 states: *"Does NOT import isTokenSniped from src/utils/db.ts... Uses inline SQL"*.
*   **Risk:** This test only proves the developer can write the correct SQL in a test file. It does **not** verify that the SQL in `src/utils/db.ts` is correct, nor does it verify that the call sites in `src/bot.ts` pass the correct arguments. A typo in `db.ts` would still allow this test to pass.
*   **Plan Reference:** Plan 15-01, Task 3.

#### 3. Legacy Deletion Blast Radius in `scripts/` (MEDIUM)
*   **Issue:** The plan audits `src/`, but the project contains several utility scripts: `scripts/deploySepoliaTest.ts`, `scripts/manualTrigger.ts`, and `scripts/addLiquidity.ts`.
*   **Risk:** If these scripts rely on `startBot` or the legacy singletons (which they often do for testing), they will break silently until run.
*   **Plan Reference:** Plan 15-01, Task 2.

#### 4. Import Cleanup Fragility (LOW)
*   **Issue:** Task 2, Edit 6 relies on `grep` to decide what to delete.
*   **Risk:** While standard, if any logic uses string-based lookups (e.g., `this['handleNewPair']`), grep will miss it. Given the tech stack (TypeScript), this is low risk but requires a successful `tsc` pass.

### Suggestions

*   **Standardize Chain Identifiers:** Before implementing Plan 15-01, verify if `ctx.chain.name` matches the existing DB records. If the DB says `mainnet` and the code says `eth`, add a one-time migration script: `UPDATE trades SET chain = 'eth' WHERE chain = 'mainnet';` or ensure the `chainRegistry` uses `mainnet` as the identifier for Ethereum.
*   **Fix the Test Strategy:** Modify `test/unit/db.test.ts` to use the actual `isTokenSniped` prepared statement. If the statement is hidden in a closure or singleton, refactor `src/utils/db.ts` to export the statement or a wrapper function that can be tested against a temporary database. **Never test by copying SQL into the test file.**
*   **Verify `scripts/` Directory:** Explicitly include `scripts/*.ts` in the grep audit for legacy function usage before deleting `startBot` and `handleNewPair`.
*   **Dashboard API Key Description:** In Plan 15-02, the description says "starts unconditionally." Ensure the README or `DASHBOARD_API_KEY` documentation clarifies that this key is for *accessing* the UI, not just starting the process.
*   **Consolidate Call Sites:** Since the V2 and V3 paths in `bot.ts` now call `isTokenSniped` with identical parameters, consider moving this check higher up in the pipeline to a single "pre-flight" check to reduce duplication.

### Risk Assessment: MEDIUM
The overall logic is correct and follows the audit recommendations. However, the risk is elevated to **MEDIUM** due to the potential for "double-sniping" legacy tokens caused by string mismatch ('mainnet' vs 'eth') and the inadequate testing strategy for the SQL fix. If the chain naming is verified/migrated and the tests are updated to use production code, the risk drops to **LOW**.

---

## Codex Review

### Summary

Phase 15 is narrowly scoped and mostly well targeted: Plan 15-01 addresses the actual dedup defect at the query boundary, and Plan 15-02 fixes the startup validation gap with the least invasive change. The main weaknesses are around verification depth and blast radius control. In particular, 15-01 mixes a simple SQL fix with broad wrapper deletion and documentation churn, which increases execution risk for a non-blocking audit closure. The dedup SQL itself is directionally correct, but the plan under-specifies whether other token-level existence checks have the same non-chain-scoped assumption, and its test strategy does not directly exercise the production prepared statement. 15-02 is cleaner and lower risk, though its "same commit" warning is process guidance rather than a technical guardrail.

### Strengths

- `15-01 / Task 1` fixes the defect at the correct seam: the dedup gate should be chain-aware where the decision is made, not patched later in control flow.
- `15-01 / Task 1 / Edit 1-3` is consistent with existing data model assumptions: `trades.chain` already exists, is non-null, and is already populated by `insertTrade`.
- `15-01` correctly avoids a schema migration for a gap-closure phase; that keeps the change small if the existing chain values are already canonical.
- `15-01` explicitly identifies the two live multi-chain call sites and avoids wasting effort retrofitting dead wrappers.
- `15-02 / Task 1` uses the existing env validation mechanism instead of adding special-case logic, which is the right design.
- `15-02` preserves the auth middleware fallback branch as defense-in-depth, which is reasonable for a config value that can be mutated in tests or nonstandard boot paths.
- The plans are largely file-disjoint, so parallel execution is plausible.
- Both plans tie changes back to audit IDs and decisions, which helps traceability.

### Concerns

- `HIGH` `15-01 / Task 3`: the proposed unit test does not verify the production `isTokenSniped` prepared statement. Testing equivalent inline SQL in an in-memory DB only proves SQLite semantics, not that `src/utils/db.ts` was actually updated correctly or continues to match the test later.
- `HIGH` `15-01 / Task 2`: wrapper deletion is much higher blast radius than the actual defect fix. Removing ~250 lines across `src/bot.ts` and `src/alphaDrop.ts` in the same plan as the SQL repair makes rollback and root-cause isolation harder if anything breaks.
- `HIGH` migration/compatibility risk: if older ETH/mainnet rows use `chain='mainnet'` while runtime now passes `ctx.chain.name === 'eth'`, then pre-existing ETH snipes stop deduping against future ETH events. That is not the original audit issue, but it is a real behavior change and could matter operationally.
- `MEDIUM` `15-01` assumes `ctx.chain.name` matches the exact canonical string stored in `trades.chain`. The plan says "use the same lowercased chain identifier that `insertTrade` already writes," but it does not require an explicit audit proving all writers use the same value set for all chains.
- `MEDIUM` `15-01` does not prove there are no other non-chain-scoped token existence checks elsewhere. The review prompt is right to ask this: if other queries still do `WHERE token = ?` for business decisions, the gap may be only partially closed.
- `MEDIUM` `15-01 / Task 2` relies heavily on grep-based safety claims. Grep is usually enough in TS repos, but it can miss indirect exports, barrel re-exports, lazy imports, CLI entrypoint references, tests, or string-selected handlers.
- `MEDIUM` `15-01 / Task 2 / Import cleanup`: "grep-and-decide" is fragile guidance. Import usage should be validated by TypeScript/compiler/linter, not by text search alone.
- `MEDIUM` `15-02`: the "must happen in the same commit" note is operationally helpful but not a real safeguard. If someone applies only `src/config.ts` first, CI or local tests will fail immediately.
- `MEDIUM` `15-02`: startup validation tests appear to rely on module import side effects and `process.exit` mocking. That is fine, but such tests are often brittle unless module cache reset and env restoration are rigorously handled.
- `LOW` documentation edits in `15-01` look overly specific. Requiring exact phrasing like "RETIRED by Phase 15" and footer updates can create unnecessary churn for little product value.
- `LOW` `15-02 / D-09`: keeping the `!expected` branch is defensible, but it should be commented as an invariant breach/fallback path; otherwise it will read like dead code later.

### Suggestions

- Split `15-01` into two changesets mentally, even if executed in one phase:
  - `15-01A`: dedup SQL + call sites + tests.
  - `15-01B`: legacy wrapper deletion and docs.
  This reduces rollback risk and makes verification cleaner.
- Add an explicit audit step before or within `15-01 / Task 1`: search for all queries and decisions involving `trades.token` or token-sniped checks to confirm no other non-chain-scoped logic remains.
- Strengthen `15-01 / Task 3` so it exercises production code, not only inline SQL. Best options:
  - Refactor the query into a pure factory/helper that can be instantiated against a test DB.
  - Or export a small chain-scoped lookup function that accepts a DB handle/prepared statement in tests.
- Add one compatibility decision for legacy `mainnet` rows. Either:
  - Accept forward-only behavior explicitly and document it as a known limitation.
  - Or perform a one-time normalization/migration from `'mainnet'` to `'eth'` if that is the canonical runtime identifier.
  - Or make the ETH lookup temporarily accept both `eth` and `mainnet` if backward compatibility matters.
- Require a concrete verification step for chain identifier consistency: inspect all writers to `trades.chain` and list the exact values expected for ETH, BSC, Base, and Arbitrum.
- Replace "grep confirms zero live callers" with a stronger acceptance gate:
  - `rg` for references,
  - successful `tsc`,
  - full unit test pass,
  - and if present, import graph / build entrypoint verification.
- For import cleanup, let the compiler drive removals. The plan should say "remove only imports flagged unused after compilation" rather than relying on grep.
- In `15-02`, reduce brittleness by making the shared env fixture complete by default and having each test only override the one variable under test.
- Add one assertion in `15-02` that the logged validation error names `DASHBOARD_API_KEY`, not just that `process.exit(1)` fired. The success criterion asks for a clear validation error.
- Keep the auth fallback branch, but annotate it with a short comment explaining it protects against nonstandard startup paths and test-time env mutation.

### Risk Assessment

**Overall risk: MEDIUM**

The actual functional fixes are straightforward and likely correct, especially `15-02`. Risk rises because `15-01` combines a low-risk SQL correction with broad dead-code deletion and a weak test design that does not directly cover the production prepared statement. The biggest unresolved question is legacy ETH/mainnet row compatibility: if `mainnet` and `eth` are both present across historical data and runtime identifiers, the fix can introduce silent dedup misses for older rows. If that is clarified and the dedup test is upgraded to hit production code, the phase drops to low risk.

---

## Consensus Summary

Both reviewers agree the phase is **directionally correct but MEDIUM risk** because of two HIGH-severity issues that are not addressed in either plan, and several MEDIUM concerns about how the work is bundled and tested.

### Agreed Strengths

- **SQL fix at the correct seam.** Both reviewers endorse fixing dedup at the query gate (`isTokenSniped`) rather than patching control flow, and both note the change correctly leverages the existing `trades.chain NOT NULL DEFAULT 'mainnet'` column + `idx_trades_chain` index — no migration needed for the schema itself.
- **Fail-fast env validation in 15-02 is the right design.** Both reviewers like reusing the existing `REQUIRED_ENV_VARS` / `validateEnvVars()` mechanism and avoiding a `DASHBOARD_ENABLED` flag.
- **Defense-in-depth in `auth.ts` (D-09) is defensible.** Both reviewers agree the `!expected` fallback branch should stay as a safety net for test harnesses and post-startup env mutation.
- **Plans are file-disjoint and traceable.** Audit ID linkage to INT-DEDUP-NO-CHAIN and INT-DASHBOARD-API-KEY is good; parallel execution is plausible.

### Agreed Concerns (priority for planner action)

1. **HIGH — `'mainnet'` vs `'eth'` identifier mismatch** *(both reviewers, top priority)*
   Phase 3 set `chain NOT NULL DEFAULT 'mainnet'`; runtime now passes `ctx.chain.name` which is documented as `'eth'`. Pre-Phase-4 trades rows with `chain='mainnet'` will not match `WHERE chain = 'eth'`. Result: the dedup gate misses on legacy ETH tokens — Gemini calls this a "double-snipe" risk that violates the "never lose money to preventable bugs" mandate. Codex flags it as a compatibility regression.
   **Action required before execution:** verify the canonical chain identifier writers use today (audit `insertTrade` call sites + chainRegistry), then either (a) accept forward-only with explicit documentation, (b) one-time `UPDATE trades SET chain='eth' WHERE chain='mainnet'`, or (c) make the eth lookup tolerant of both values.

2. **HIGH — Test does not exercise production code** *(both reviewers)*
   Plan 15-01 / Task 3 uses inline SQL against an in-memory DB. Both reviewers flag this as testing "the map, not the territory" — a typo in `src/utils/db.ts:190` would still let the test pass because the test never imports `isTokenSniped`. Gemini: "Never test by copying SQL into the test file." Codex: refactor `db.ts` to export the prepared statement or a wrapper that accepts a DB handle, so tests exercise the real query.
   **Action required:** restructure Task 3 to either import `isTokenSniped` (parameterizing the underlying DB) or add a thin wrapper export, so the test fails if `db.ts` regresses.

3. **MEDIUM — Wrapper deletion blast radius and bundling** *(both reviewers)*
   Codex argues 15-01 conflates a low-risk SQL correction with high-blast-radius dead-code removal, hurting rollback. Gemini extends this concretely: the deletion audit only covered `src/`, but `scripts/deploySepoliaTest.ts`, `scripts/manualTrigger.ts`, and `scripts/addLiquidity.ts` may import `startBot`, `handleNewPair`, or the legacy singletons. Both reviewers recommend extending grep to `scripts/` and `test/` AND letting `tsc` drive the import cleanup rather than text search.
   **Action required:** (a) explicitly grep `scripts/**/*.ts` and `test/**/*.ts` for every deletion target before Task 2 runs; (b) replace the "grep-and-decide" import cleanup in Task 2 / Edit 6 with "remove only imports flagged unused by `tsc --noEmit` or eslint `no-unused-vars`."

4. **MEDIUM — Other token-existence queries may have the same gap**
   Codex flags that the plan does not prove there are no other `WHERE token = ?` decision queries. The audit only identified `isTokenSniped`, but there could be sibling queries (e.g., position lookups, blocklist checks) with the same chain-scoping defect.
   **Action required:** add a discovery step before Task 1: `Grep -rn "WHERE token = ?" src/utils/db.ts` and audit each match for whether it should also be chain-scoped.

### Divergent Views

- **Gemini** suggests **consolidating the V2 + V3 dedup checks** into a single pre-flight helper to reduce duplication. **Codex** does not raise this and the plan keeps them separate. Worth considering as a follow-up but not blocking.
- **Codex** flags 15-02's test design as **brittle** (module cache + process.exit mocking) and recommends an explicit assertion that the fatal log message contains the literal `DASHBOARD_API_KEY`. **Gemini** does not raise this. Codex's suggestion is concrete and cheap to add.
- **Codex** wants a **dedicated split** of 15-01 into a SQL-only changeset (15-01A) and a wrapper-deletion changeset (15-01B). **Gemini** does not push for this restructure but agrees the deletion is risky.
- **Codex** flags the **documentation acceptance criteria** ("RETIRED by Phase 15", footer literals) as overly brittle. **Gemini** does not comment on this.
- **Gemini** uniquely calls out the `scripts/` directory as a likely import-target gap. **Codex** speaks more generally about "indirect exports, barrel re-exports, lazy imports, CLI entrypoint references."

### Recommended next step

Run `/gsd-plan-phase 15 --reviews` to incorporate this feedback into both plans. The two HIGH issues (mainnet/eth mismatch and test-the-real-statement) should not be deferred — both reviewers independently flagged them as the dominant risk in an otherwise low-risk phase.

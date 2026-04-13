---
phase: 15-chain-scoped-dedup-dashboard-env
verified: 2026-04-12T22:45:00Z
status: passed
score: 23/23
overrides_applied: 0
---

# Phase 15: Chain-Scoped Dedup & Dashboard Env Validation — Verification Report

**Phase Goal:** Token dedup is chain-scoped so multi-chain sniping works correctly, and DASHBOARD_API_KEY is validated at startup
**Verified:** 2026-04-12T22:45:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A token address sniped on chain 'bsc' no longer blocks the same token address from being sniped on chain 'eth' | VERIFIED | `test/unit/db.test.ts:593-600` — test passes, production factory SQL verified |
| 2 | A token address sniped on chain 'bsc' no longer blocks the same token address from being sniped on chain 'base' | VERIFIED | `test/unit/db.test.ts:602-609` — test passes |
| 3 | A token address sniped on chain 'bsc' no longer blocks the same token address from being sniped on chain 'arb' | VERIFIED | `test/unit/db.test.ts:611-618` — test passes |
| 4 | Both live bot call sites pass ctx.chain.name as the chain bind parameter to isTokenSniped | VERIFIED | `src/bot.ts:186` and `src/bot.ts:363` both use `isTokenSniped.get(targetToken.toLowerCase(), ctx.chain.name)` |
| 5 | Pre-Phase-4 trade rows with chain='mainnet' are normalized to chain='eth' on bot startup | VERIFIED | `src/utils/db.ts:205-206`: `migrateJsonState()` followed immediately by `normalizeLegacyMainnetRows()`. Unit test at `db.test.ts:506-518` proves rewrite. |
| 6 | normalizeLegacyMainnetRows() is idempotent: running twice on fully-normalized data is a no-op | VERIFIED | `test/unit/db.test.ts:520-532` — second call does not throw, row still 'eth' |
| 7 | trades schema DEFAULT for the chain column is 'eth' (canonical identifier) | VERIFIED | `src/utils/db.ts:37` and `src/utils/db.ts:87`: `chain TEXT NOT NULL DEFAULT 'eth'`. `test/helpers/testDb.ts:32`: same. |
| 8 | src/utils/db.ts exports makeIsTokenSnipedStmt(db) factory | VERIFIED | `src/utils/db.ts:235`: `export function makeIsTokenSnipedStmt(database: Database.Database): Database.Statement` |
| 9 | Production module-level isTokenSniped is constructed by calling makeIsTokenSnipedStmt(db) | VERIFIED | `src/utils/db.ts:241`: `const isTokenSniped = makeIsTokenSnipedStmt(db);` |
| 10 | Legacy single-chain wrapper handleNewPair no longer exists in src/bot.ts | VERIFIED | Grep for `^export.*function handleNewPair\b` returns no results. Only `handleNewPairForChain` exists. |
| 11 | Legacy single-chain wrapper startBot no longer exists in src/bot.ts | VERIFIED | Grep for `startBot` in bot.ts returns only a comment (`// Multi-chain bot orchestrator (replaces startBot)`), no function definition. |
| 12 | Legacy single-chain wrapper resumeMonitoring no longer exists in src/bot.ts | VERIFIED | No grep hits for `resumeMonitoring` function definition in bot.ts |
| 13 | Legacy single-chain wrapper handleAlphaDrop no longer exists in src/alphaDrop.ts | VERIFIED | Only `handleAlphaDropForChain` exists. No bare `handleAlphaDrop` export. |
| 14 | Unit test proves the production isTokenSniped factory is chain-scoped | VERIFIED | `test/unit/db.test.ts:584-630` — 5 dedup tests, all pass (39/39 tests passing via `npx vitest run`) |
| 15 | npx tsc --noEmit exits 0 after all deletions | VERIFIED | `npx tsc --noEmit` exits with code 0, no output |
| 16 | All previously-passing unit tests still pass | VERIFIED | `npx vitest run test/unit/db.test.ts test/unit/configEnvVar.test.ts` — 39 passed |
| 17 | Bot startup with DASHBOARD_API_KEY unset logs fatal error naming 'DASHBOARD_API_KEY' AND calls process.exit(1) | VERIFIED | `test/unit/configEnvVar.test.ts:158-176` — asserts `process.exit` AND `mockFatal` payload contains 'DASHBOARD_API_KEY'; test passes |
| 18 | Bot startup with DASHBOARD_API_KEY set to non-empty string succeeds | VERIFIED | `test/unit/configEnvVar.test.ts:179-185` — no exit when key present; test passes |
| 19 | DASHBOARD_API_KEY is declared as required: true in REQUIRED_ENV_VARS in src/config.ts | VERIFIED | `src/config.ts:27`: `{ name: 'DASHBOARD_API_KEY', required: true, description: 'Dashboard login API key (required; dashboard server starts unconditionally)' }` |
| 20 | Unit test proves that missing DASHBOARD_API_KEY triggers process.exit | VERIFIED | `test/unit/configEnvVar.test.ts:158-176` — passes |
| 21 | Unit test proves that present DASHBOARD_API_KEY does not trigger process.exit | VERIFIED | `test/unit/configEnvVar.test.ts:179-185` — passes |
| 22 | Unit test proves the fatal log payload mentions 'DASHBOARD_API_KEY' by name | VERIFIED | `test/unit/configEnvVar.test.ts:173`: `expect.arrayContaining([expect.stringContaining('DASHBOARD_API_KEY')])` — passes |
| 23 | Auth middleware defense-in-depth branch preserved with clarifying comment | VERIFIED | `src/api/middleware/auth.ts:30`: comment added, executable code unchanged. grep confirms `Defense-in-depth: startup validation` present. |

**Score:** 23/23 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/utils/db.ts` | Chain-scoped isTokenSniped via makeIsTokenSnipedStmt factory (AND chain = ?) | VERIFIED | Line 237: `SELECT 1 FROM trades WHERE token = ? AND chain = ? LIMIT 1`; exported factory at line 235 |
| `src/utils/db.ts` | normalizeLegacyMainnetRows() idempotent helper runs after migrateJsonState() | VERIFIED | Lines 193, 205-206 |
| `src/utils/db.ts` | makeIsTokenSnipedStmt(db) exported factory | VERIFIED | Line 235 |
| `src/bot.ts` | Multi-chain V2/V3 handlers with chain-scoped dedup checks | VERIFIED | Lines 186, 363: `isTokenSniped.get(targetToken.toLowerCase(), ctx.chain.name)` |
| `src/alphaDrop.ts` | Multi-chain alpha drop handler only (legacy wrapper removed) | VERIFIED | Only `handleAlphaDropForChain` present; 55 lines, substantive implementation |
| `test/unit/db.test.ts` | Cross-chain dedup tests + normalization tests importing makeIsTokenSnipedStmt | VERIFIED | Lines 505-631; imports from production at line 7 |
| `src/config.ts` | DASHBOARD_API_KEY as required env var | VERIFIED | Line 27 |
| `src/api/middleware/auth.ts` | Defense-in-depth branch with clarifying comment | VERIFIED | Line 30 |
| `test/unit/configEnvVar.test.ts` | Unit tests for DASHBOARD_API_KEY required env var validation | VERIFIED | Lines 157-202 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/bot.ts:handleNewPairForChain` | `src/utils/db.ts:isTokenSniped` | `isTokenSniped.get(token, ctx.chain.name)` | WIRED | `src/bot.ts:186` matches pattern `isTokenSniped\.get\([^)]+ctx\.chain\.name` |
| `src/bot.ts:handleNewV3PoolForChain` | `src/utils/db.ts:isTokenSniped` | `isTokenSniped.get(token, ctx.chain.name)` | WIRED | `src/bot.ts:363` matches same pattern |
| `src/utils/db.ts:module-init` | `normalizeLegacyMainnetRows` | Unconditional call after migrateJsonState() | WIRED | Lines 205-206: `migrateJsonState()` then `normalizeLegacyMainnetRows()` |
| `test/unit/db.test.ts` | `src/utils/db.ts:makeIsTokenSnipedStmt` | `import { makeIsTokenSnipedStmt } from '../../src/utils/db'` | WIRED | `db.test.ts:7` imports production factory; called at lines 587, 596, 605, 614, 625-626 |
| `src/config.ts:validateEnvVars` | `process.exit(1)` + `logger.fatal({ missing: [...] })` | Missing required env var | WIRED | `src/config.ts:76-77`: `logger.fatal({ missing: ... })` then `process.exit(1)`; `validateEnvVars()` called at line 81 |
| `test/unit/configEnvVar.test.ts` | `src/config.ts:validateEnvVars` | `await import('../../src/config')` under env manipulation | WIRED | `configEnvVar.test.ts:157-202` — tests import config module dynamically |
| `src/api/middleware/auth.ts:loginHandler` | Defense-in-depth branch | Runtime check on `process.env.DASHBOARD_API_KEY` | WIRED | Line 30 comment added; executable code at lines 31-35 unchanged |

---

### Data-Flow Trace (Level 4)

Not applicable for this phase. No new UI components rendering dynamic data. Changes are: SQL query filters, module-level migration function, config env var array entry, and test assertions. No new data-rendering components introduced.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All unit tests pass (dedup + env validation) | `npx vitest run test/unit/db.test.ts test/unit/configEnvVar.test.ts` | 39 passed, 0 failed | PASS |
| TypeScript compiles without errors | `npx tsc --noEmit` | Exit code 0, no output | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CHAIN-02 | 15-01-PLAN, 15-02-PLAN | Per-chain configuration supports ETH mainnet, BSC, Base, and Arbitrum with chain-specific parameters | SATISFIED | Chain-scoped dedup SQL (`AND chain = ?`), both call sites pass `ctx.chain.name`, 5 cross-chain tests all pass. DASHBOARD_API_KEY fail-fast validation also closes INT-DASHBOARD-API-KEY gap addressed under this requirement. REQUIREMENTS.md table (line 144) marks CHAIN-02 Complete at Phase 4 + Phase 15. |

**Note:** REQUIREMENTS.md line 175 still lists CHAIN-02 in the "Pending" summary count — this is a stale summary line not updated after Phase 15 completed. The requirement table at line 144 correctly marks it Complete. This is a documentation inconsistency only, not a code gap.

---

### Anti-Patterns Found

No anti-patterns found. Grep for TODO/FIXME/XXX/PLACEHOLDER across all modified files returned no results. No stub patterns (empty returns, hardcoded empty arrays, console-only handlers) found.

---

### Human Verification Required

None. All must-haves are verifiable programmatically, and all 23/23 truths are confirmed.

---

### Gaps Summary

No gaps. All phase 15 must-haves are implemented, substantive, wired, and tested. The unit test suite (39 tests) passes clean. `tsc --noEmit` exits 0. Both plans delivered their stated goals:

- **Plan 01:** `makeIsTokenSnipedStmt` factory with `AND chain = ?` SQL, both V2 and V3 call sites in `src/bot.ts` pass `ctx.chain.name`, `normalizeLegacyMainnetRows()` runs at module load after `migrateJsonState()`, schema DEFAULT updated to `'eth'`, legacy single-chain wrappers (`handleNewPair`, `startBot`, `resumeMonitoring`, `maybeApprove`, `handleAlphaDrop`) deleted.
- **Plan 02:** `DASHBOARD_API_KEY` declared `required: true` in `REQUIRED_ENV_VARS`, 3 unit tests with payload assertions confirm fail-fast behavior, `auth.ts` defense-in-depth branch annotated with D-09 comment.

---

_Verified: 2026-04-12T22:45:00Z_
_Verifier: Claude (gsd-verifier)_

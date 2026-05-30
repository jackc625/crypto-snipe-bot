# Phase 15: Chain-Scoped Dedup & Dashboard Env Validation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in 15-CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-07
**Phase:** 15-chain-scoped-dedup-dashboard-env
**Areas discussed:** Legacy handleNewPair chain ID, DASHBOARD_API_KEY strictness, Auth 500 fallback cleanup, Test coverage scope

---

## Legacy handleNewPair chain ID

**Context presented:** `src/bot.ts:560` is inside the legacy `handleNewPair` wrapper that has no `ctx.chain`. Call-tree analysis showed `startBot()` at line 1227 is defined but never called (entry point uses `startMultiChainBot()` at line 1241), and `handleAlphaDrop()` in alphaDrop.ts is exported but has no external callers — both wrappers are truly dead. Phase 4 tech debt explicitly noted "backward-compat preserved intentionally."

| Option | Description | Selected |
|--------|-------------|----------|
| Delete legacy wrappers | Remove handleNewPair, handleAlphaDrop, startBot, and their legacy singletons. They have no callers — multi-chain replaced them in Phase 4. Cleanest: removes the bug and dead code together. (Recommended) | ✓ |
| Hardcode CONFIG.network | Pass CONFIG.network (resolved via env NETWORK, default 'sepolia') as the chain identifier in isTokenSniped.get(...). Preserves the wrappers but the chain name won't match registry names like 'eth'/'bsc' — fragile. | |
| Add chain param to signature | Change handleNewPair(token0, token1, pair, chainName) and propagate through handleAlphaDrop + startBot. Keeps wrappers alive with proper chain awareness — more churn for code nobody calls. | |
| Skip — leave wrapper broken | Fix only the two multi-chain call sites (bot.ts:204, bot.ts:381). Leave bot.ts:560 untouched with a TODO comment. Gap closure is effectively complete since the wrapper is dead. | |

**User's choice:** Delete legacy wrappers
**Notes:** Formally retires the Phase 4 "backward-compat preserved intentionally" tech debt entry. Eliminates the third `isTokenSniped` call site by deleting it rather than retrofitting a chain identifier.

---

## DASHBOARD_API_KEY strictness

**Context presented:** The API server is started unconditionally in `startMultiChainBot` at `src/bot.ts:1020` — no enable flag exists. The dashboard is always on.

| Option | Description | Selected |
|--------|-------------|----------|
| Hard-required, exit on missing | Add DASHBOARD_API_KEY with required:true to REQUIRED_ENV_VARS. Bot refuses to start if unset, same pattern as PRIVATE_KEY / TELEGRAM_* vars. Matches the audit intent and FIX-06 convention. (Recommended) | ✓ |
| Warn-only at startup | Log a prominent startup warning but allow the bot to start. Dashboard login will still 500 but at least the operator sees a heads-up. Softer but leaves the silent-failure gap partially open. | |
| Gate dashboard behind enable flag | Introduce a new DASHBOARD_ENABLED flag. When true, DASHBOARD_API_KEY is required; when false, the API server is not started at all. Larger scope — touches bot.ts server-start path, not just config validation. | |

**User's choice:** Hard-required, exit on missing
**Notes:** DASHBOARD_ENABLED flag deferred to a future phase if/when dashboard becomes optional. For now, hard-required matches the FIX-06 convention used for other critical env vars.

---

## Auth 500 fallback cleanup

**Context presented:** `src/api/middleware/auth.ts:30-34` currently returns HTTP 500 with `Server misconfigured: DASHBOARD_API_KEY not set` when the env var is unset. Once startup validation (D-07) makes this branch effectively unreachable, what should happen to it?

| Option | Description | Selected |
|--------|-------------|----------|
| Keep as defense-in-depth | Leave the 500 branch intact. Even though startup validation makes it unreachable in practice, it protects against hot-reload / test scenarios where env may be mutated. Low cost, safer. (Recommended) | ✓ |
| Delete the dead branch | Remove lines 30-34 entirely — startup validation guarantees the env var is present. Cleaner code, one fewer branch to test, but loses a safety net. | |
| Convert to assertion | Replace the 500 branch with an assert/throw at module load time in auth.ts so it fails loudly rather than silently returning 500 at request time. More strict than startup check. | |

**User's choice:** Keep as defense-in-depth
**Notes:** No code change to auth.ts — the branch stays as-is.

---

## Test coverage scope

**Context presented:** Existing test infrastructure includes `test/unit/db.test.ts` for prepared statement coverage, `test/unit/configEnvVar.test.ts` for startup env validation, and `test/integration/api/auth.test.ts` for the login handler.

| Option | Description | Selected |
|--------|-------------|----------|
| Both unit + integration, targeted | (1) Unit test in test/unit/db.test.ts: insert 'tokenX' on chain 'bsc', assert isTokenSniped returns truthy for ('tokenX','bsc') and falsy for ('tokenX','eth'). (2) Unit test in test/unit/configEnvVar.test.ts: unset DASHBOARD_API_KEY, assert validateEnvVars throws/exits. Skip integration for this phase. (Recommended) | ✓ |
| Unit only, minimal | Just the dedup unit test. Env validation is trivial and already has a test pattern — skip adding another one. Fastest to implement, lowest risk of flakiness. | |
| Full coverage incl. bot.ts call sites | Unit tests above PLUS integration test that exercises handleNewPairForChain with the same token on two different chains and verifies both get processed. More thorough but requires bot.ts mocking which is heavier. | |

**User's choice:** Both unit + integration, targeted
**Notes:** Despite the label, the scope is two unit tests (db.test.ts + configEnvVar.test.ts). No new integration tests for bot.ts call sites — the extra bind parameter is mechanical and covered by the unit test.

---

## Claude's Discretion

- Exact deletion order of legacy wrappers (one commit vs. split)
- Whether to delete now-unused `getProvider` singleton and `getPairAddressFromToken` helper if they end up with zero callers after wrapper deletion (investigate, only delete if truly unused)
- Mock/stub approach for `process.exit` and `logger.fatal` in the new configEnvVar test (follow existing patterns)
- Whether trade-history SQL queries that already filter by chain need parallel hardening (likely no-op)

## Deferred Ideas

- `DASHBOARD_ENABLED` flag — future dashboard-ergonomics phase
- Full legacy `CONFIG.*` single-chain fields sweep — dedicated refactor phase if this phase leaves any behind
- Module-load assertion in auth.ts — not needed, defense-in-depth branch is adequate
- Cross-chain E2E integration test — out of scope for a gap-closure phase

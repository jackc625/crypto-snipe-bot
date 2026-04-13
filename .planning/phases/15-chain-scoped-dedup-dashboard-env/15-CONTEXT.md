# Phase 15: Chain-Scoped Dedup & Dashboard Env Validation - Context

**Gathered:** 2026-04-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Close two non-blocking gaps from the v6.16 milestone audit:

1. **INT-DEDUP-NO-CHAIN** — Make `isTokenSniped` chain-scoped so a token sniped on one chain (e.g., BSC) does not permanently block the same contract address on another chain (ETH, Base, Arb). Touches `src/utils/db.ts`, `src/bot.ts` call sites, and removes the dead legacy single-chain wrappers that cannot be made chain-aware.
2. **INT-DASHBOARD-API-KEY** — Add `DASHBOARD_API_KEY` to `REQUIRED_ENV_VARS` in `src/config.ts` so the bot refuses to start when it is unset, instead of starting silently and returning HTTP 500 on the first dashboard login attempt.

Forward-only fix. No migration of existing rows. No changes to dashboard enable/disable gating (the API server remains unconditionally started).

</domain>

<decisions>
## Implementation Decisions

### Chain-scoped dedup query
- **D-01:** Update `isTokenSniped` prepared statement in `src/utils/db.ts:190` from `SELECT 1 FROM trades WHERE token = ? LIMIT 1` to `SELECT 1 FROM trades WHERE token = ? AND chain = ? LIMIT 1`. The `trades.chain` column already exists with `NOT NULL DEFAULT 'mainnet'` (Phase 3 schema, migrated in Phase 4) and has an index `idx_trades_chain` — no schema change needed.
- **D-02:** Pass `ctx.chain.name` as the second bind parameter at both multi-chain call sites:
  - `src/bot.ts:204` inside `handleNewPairForChain` (V2 path)
  - `src/bot.ts:381` inside `handleNewPoolForChainV3` (V3 path)
  Use the same lowercased chain identifier that `insertTrade` already writes (Phase 4 convention) — no new normalization layer.
- **D-03:** Chain name bind is a plain string parameter; no normalization helper and no enum. Consistency with `getDeployedCapitalByChain`, `getDailyRealizedLoss`, and `getTradeIdForPendingToken` which already use `ctx.chain.name` directly.

### Legacy single-chain wrappers
- **D-04:** Delete the dead legacy single-chain wrappers instead of trying to retrofit a chain identifier into them. They have no live callers — `startMultiChainBot()` is the sole entry point at `src/bot.ts:1241`, and `handleAlphaDropForChain` replaced `handleAlphaDrop` in the Telegram listener path. Functions to remove:
  - `handleNewPair` in `src/bot.ts:556-588` (third `isTokenSniped` call site at line 560 — the reason this decision matters)
  - `startBot` in `src/bot.ts:1227-1234` (defined but never invoked)
  - `handleAlphaDrop` in `src/alphaDrop.ts:70-88` (exported but unused)
  - Legacy singleton imports and the backward-compat note at `src/bot.ts:58`
  - The `handleNewPair` import at `src/alphaDrop.ts:14`
- **D-05:** Also remove any `CONFIG.*` legacy fields in `src/config.ts` that exist solely to feed the deleted wrappers (e.g., `factoryAddress`, `routerAddress`, `wethAddress`, `snipeAmountETH` if truly unused after deletion). Verify no live caller references them before removing. If any are still referenced by live code, leave them alone — scope is to remove *only* the wrapper-only fields.
- **D-06:** Phase 4 tech debt note in `.planning/v6.16-MILESTONE-AUDIT.md` ("Legacy handleNewPair/startBot wrapper functions ... backward-compat preserved intentionally") is explicitly retired by this phase. Record in the PROJECT.md Key Decisions row.

### DASHBOARD_API_KEY startup validation
- **D-07:** Add a new entry to `REQUIRED_ENV_VARS` in `src/config.ts`:
  ```ts
  { name: 'DASHBOARD_API_KEY', required: true, description: 'Dashboard login API key (required; dashboard server starts unconditionally)' }
  ```
  Matches the `required: true` pattern of `PRIVATE_KEY`, `TELEGRAM_BOT_TOKEN`, etc. On missing env, `validateEnvVars()` logs fatal and calls `process.exit(1)` — same behavior as FIX-06.
- **D-08:** No `DASHBOARD_ENABLED` flag and no conditional-require logic. The dashboard API server is always started by `startMultiChainBot` at `src/bot.ts:1020`, so treating the key as universally required is correct today. If a future phase introduces an enable flag, this entry becomes conditional at that time — not this phase.

### Auth middleware fallback
- **D-09:** Leave the `!expected` branch at `src/api/middleware/auth.ts:30-34` intact as defense-in-depth. Startup validation makes it unreachable in the normal process lifecycle, but it still protects against test harnesses, hot-reload tools, or direct imports where `process.env.DASHBOARD_API_KEY` could be mutated after startup. No code change here.

### Test coverage
- **D-10:** Add a targeted unit test in `test/unit/db.test.ts`:
  - Insert a trade row for `token='0xabc...'` on `chain='bsc'`.
  - Assert `isTokenSniped.get('0xabc...', 'bsc')` returns a truthy row.
  - Assert `isTokenSniped.get('0xabc...', 'eth')` returns `undefined`.
  - Assert `isTokenSniped.get('0xabc...', 'base')` returns `undefined`.
  This is the smallest test that proves cross-chain sniping is now possible.
- **D-11:** Add a targeted unit test in `test/unit/configEnvVar.test.ts`:
  - With `DASHBOARD_API_KEY` unset, reloading `config.ts` must call `process.exit(1)` (mocked) and log fatal.
  - With `DASHBOARD_API_KEY` set to any non-empty string, `validateEnvVars` must not exit.
  Follow the existing patterns already in that test file for other required env vars.
- **D-12:** No new integration-level tests for the `bot.ts` call sites in this phase. Existing Phase 4 integration coverage plus the new unit tests are sufficient — the call-site changes are mechanical (single extra bind param).

### Claude's Discretion
- Exact deletion order of legacy wrappers (one commit vs. split) — planner can choose.
- Whether to also delete the now-unused `getProvider` singleton and `getPairAddressFromToken` helper if they end up with zero callers after wrapper deletion. Investigate, but only delete if truly unused.
- Mock/stub approach for `process.exit` and `logger.fatal` in the new configEnvVar test — follow existing patterns in the file.
- Whether the trade-history SQL queries that already filter by chain need any parallel hardening (audit said only dedup was the gap; likely no-op).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Audit source
- `.planning/v6.16-MILESTONE-AUDIT.md` §INT-DEDUP-NO-CHAIN (lines 40-45) — gap definition, affected requirements (CHAIN-02, CHAIN-03), target files
- `.planning/v6.16-MILESTONE-AUDIT.md` §INT-DASHBOARD-API-KEY (lines 46-51) — gap definition, affected requirements (DASH-01..04), target files

### Primary modification targets
- `src/utils/db.ts` — `isTokenSniped` prepared statement at line 190 (add `AND chain = ?`); `trades` schema at lines 34-50 (chain column already present with index)
- `src/bot.ts` — call sites at lines 204, 381 (update to pass `ctx.chain.name`); lines 556-588 (delete `handleNewPair`); lines 1227-1234 (delete `startBot`); line 58 (delete legacy singleton comment + singletons)
- `src/alphaDrop.ts` — lines 14, 70-88 (delete `handleAlphaDrop` and its import of `handleNewPair`)
- `src/config.ts` — `REQUIRED_ENV_VARS` array (add DASHBOARD_API_KEY entry); potentially prune legacy `CONFIG.*` fields at lines 103-144 if they become unreferenced after wrapper deletion

### Secondary / read-only references
- `src/api/middleware/auth.ts` — login handler at lines 26-56; the `!expected` branch at 30-34 stays intact (D-09)
- `src/api/server.ts` — `startApiServer` signature and unconditional startup (confirms D-08 rationale)
- `src/chainRegistry.ts` — `ChainContext.chain.name` shape (confirms D-02 bind parameter comes from here)

### Test targets
- `test/unit/db.test.ts` — pattern for prepared statement tests; add chain-scoped dedup cases (D-10)
- `test/unit/configEnvVar.test.ts` — pattern for `validateEnvVars` coverage; add DASHBOARD_API_KEY case (D-11)

### Prior phase references
- `.planning/phases/03-sqlite-storage-code-quality/03-01-PLAN.md` — original `isTokenSniped` design and `trades.chain` column introduction
- `.planning/phases/04-multi-chain-architecture/04-04-PLAN.md` — chain-aware insert and the `ctx.chain.name` convention
- `.planning/phases/01-bug-fixes-hardening/01-03-PLAN.md` — `REQUIRED_ENV_VARS` + `validateEnvVars` pattern (FIX-06)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `trades.chain` column — already exists with `NOT NULL DEFAULT 'mainnet'` and `idx_trades_chain` index. Zero-cost query-plan support for the new filter.
- `ctx.chain.name` — lowercase canonical chain identifier already threaded through `handleNewPairForChain` / `handleNewPoolForChainV3` and used by `insertTrade`, `canSnipe`, `recordSnipe`, and `getTradeIdForPendingToken`. Drop-in for the new dedup bind.
- `REQUIRED_ENV_VARS` + `validateEnvVars()` in `src/config.ts` — adding one entry is a one-liner. Pattern already drops the process on missing required vars.
- `test/unit/configEnvVar.test.ts` — has the scaffolding (env mutation, exit mock, reload) for adding one more required-var case.

### Established Patterns
- Chain identifiers are plain lowercase strings (`'eth'`, `'bsc'`, `'base'`, `'arb'`) — no normalization helper; used directly as SQL bind parameters throughout db.ts.
- All prepared statement modifications are localized to `src/utils/db.ts`; consumers bind positional parameters without knowing SQL internals.
- Legacy wrappers across the codebase were intentionally preserved in Phase 4 for backward compat, but every subsequent phase has moved toward `*ForChain` functions and `ChainContext`. Phase 15 formally retires the single-chain legacy path.

### Integration Points
- Only three files write `isTokenSniped.get(...)`: `src/bot.ts:204`, `src/bot.ts:381`, and `src/bot.ts:560`. After deletion of the legacy wrapper, only two call sites remain, both with `ctx.chain.name` in scope.
- `src/alphaDrop.ts` imports `handleNewPair` — this import goes away with the wrapper.
- No dashboard enable flag exists; `startApiServer` is unconditionally called in `startMultiChainBot`. DASHBOARD_API_KEY is universally required until that changes.

</code_context>

<specifics>
## Specific Ideas

- User explicitly chose the cleanest path for the legacy wrapper: delete rather than retrofit. Reason: wrappers are dead code and retrofitting would either hardcode a fragile chain name or churn call-signature plumbing for zero runtime benefit.
- User explicitly chose `required: true` (hard fail) over warn-only or introducing a new enable flag. Matches the FIX-06 convention that already governs `PRIVATE_KEY` and the Telegram vars.
- User explicitly chose to keep the `!expected` branch in `auth.ts` as defense-in-depth rather than delete it. Rationale: protects hot-reload/test paths where env can mutate post-startup.
- Test scope is "both unit + integration, targeted" but scoped to two unit tests only — no new integration tests for bot.ts call sites (D-12).

</specifics>

<deferred>
## Deferred Ideas

- **DASHBOARD_ENABLED flag** — introduce a bot-wide toggle that makes the dashboard server optional (and makes DASHBOARD_API_KEY conditionally required). Belongs in a future dashboard-ergonomics phase, not a gap-closure phase.
- **Legacy `CONFIG.*` single-chain fields cleanup** — fully delete `CONFIG.factoryAddress`, `CONFIG.routerAddress`, `CONFIG.wethAddress`, `CONFIG.snipeAmountETH`, etc. if any remain unreferenced after this phase. If the deletion during this phase is non-trivial (many call sites still read them), defer the full sweep to a dedicated refactor phase.
- **Convert `auth.ts:30-34` to a module-load assertion** — stricter than the current runtime branch. Not needed; current defense-in-depth is adequate.
- **Cross-chain integration test** — exercise `handleNewPairForChain` with the same token on two chains end-to-end. Nice-to-have but out of scope for a gap-closure phase.
- **`updateTradeStatus` cross-chain collision** — `src/utils/db.ts:187` is `UPDATE trades SET status = ? WHERE token = ? AND status = 'pending'` with NO chain filter. Live callers: `src/exitEngine.ts` (3) and `src/bot.ts` (5). After Phase 15 enables true cross-chain dedup, if the same token is in flight on two chains simultaneously and one side fails, `updateTradeStatus.run('failed', token)` will mark BOTH chains' pending rows as failed. This is a latent correctness bug introduced by ENABLING multi-chain correctness; it only manifests post-Phase-15. Scope: add chain filter to `updateTradeStatus` and update all 8 call sites to pass `ctx.chain.name`. Defer to Phase 16+. Audit trail: flagged by Codex in Phase 15 cross-AI review (REVIEWS.md MEDIUM #4). See also `getTradesByToken` (db.ts:183) — also not chain-scoped but has zero live callers in `src/`, so it is dead code; delete in the same follow-up.

</deferred>

---

*Phase: 15-chain-scoped-dedup-dashboard-env*
*Context gathered: 2026-04-07*

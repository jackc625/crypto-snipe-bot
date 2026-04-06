---
gsd_state_version: 1.0
milestone: v6.16
milestone_name: milestone
status: Milestone complete
stopped_at: Phase 14 context gathered
last_updated: "2026-04-06T19:38:39.340Z"
progress:
  total_phases: 15
  completed_phases: 13
  total_plans: 49
  completed_plans: 49
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-19)

**Core value:** Reliably detect, validate, and profitably snipe new token listings across multiple EVM chains with proper risk management
**Current focus:** Phase 13 — config-env-var-correctness

## Current Position

Phase: 13
Plan: Not started

## Performance Metrics

**Velocity:**

- Total plans completed: 12
- Average duration: 11min
- Total execution time: 0.18 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 11 | 7 | - | - |
| 12 | 3 | - | - |
| 13 | 1 | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*

| Phase 01 P01 | 11min | 2 tasks | 3 files |
| Phase 01 P03 | 13min | 2 tasks | 2 files |
| Phase 01 P01 | 11min | 2 tasks | 3 files |
| Phase 01 P04 | 4min | 2 tasks | 2 files |
| Phase 02 P01 | 7min | 2 tasks | 7 files |
| Phase 02 P02 | 10min | 3 tasks | 9 files |
| Phase 03 P01 | 6min | 2 tasks | 7 files |
| Phase 03 P02 | 6min | 2 tasks | 3 files |
| Phase 03 P03 | 9min | 2 tasks | 6 files |
| Phase 03 P04 | 6min | 2 tasks | 3 files |
| Phase 04 P02 | 7min | 2 tasks | 5 files |
| Phase 04 P03 | 8min | 2 tasks | 7 files |
| Phase 04 P04 | 10min | 3 tasks | 3 files |
| Phase 05 P01 | 8min | 2 tasks | 4 files |
| Phase 05 P02 | 8min | 2 tasks | 2 files |
| Phase 05 P04 | 1min | 1 tasks | 2 files |
| Phase 05 P03 | 2min | 1 tasks | 2 files |
| Phase 06 P01 | 4min | 2 tasks | 4 files |
| Phase 06 P02 | 4min | 1 tasks | 1 files |
| Phase 07 P00 | 5min | 2 tasks | 4 files |
| Phase 07 P01 | 7min | 2 tasks | 4 files |
| Phase 07 P02 | 6min | 2 tasks | 1 files |
| Phase 07 P03 | 8min | 2 tasks | 1 files |
| Phase 08 P01 | 11min | 2 tasks | 17 files |
| Phase 08 P02 | 14min | 2 tasks | 7 files |
| Phase 08 P03 | 15min | 2 tasks | 8 files |
| Phase 08 P04 | 11min | 2 tasks | 25 files |
| Phase 08 P05 | 9min | 2 tasks | 11 files |
| Phase 08 P06 | 11min | 2 tasks | 4 files |
| Phase 09 P01 | 9min | 2 tasks | 18 files |
| Phase 09 P03 | 11min | 3 tasks | 4 files |
| Phase 09 P04 | 3min | 2 tasks | 6 files |
| Phase 10 P01 | 7min | 2 tasks | 4 files |
| Phase 10 P02 | 9min | 2 tasks | 8 files |
| Phase 11 P00 | 1min | 1 tasks | 3 files |
| Phase 11 P01 | 4min | 2 tasks | 4 files |
| Phase 11 P02 | 5min | 2 tasks | 5 files |
| Phase 11 P03 | 5min | 2 tasks | 6 files |
| Phase 11 P04 | 13min | 2 tasks | 7 files |
| Phase 11 P05 | 3min | 2 tasks | 4 files |
| Phase 11 P06 | 1min | 1 tasks | 1 files |
| Phase 12 P01 | 15min | 3 tasks | 10 files |
| Phase 12 P02 | 8min | 3 tasks | 5 files |
| Phase 12 P03 | 2min | 1 tasks | 1 files |
| Phase 13 P01 | 5min | 2 tasks | 3 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Fix bugs and harden before extending -- building multi-chain on broken foundations compounds problems
- [Roadmap]: ethers v6 migration is a standalone phase (Phase 2) because it touches every file and must complete atomically
- [Roadmap]: SQLite + code quality bundled (Phase 3) because structured logging and singleton providers are preconditions for multi-chain
- [Phase 01]: Used Record<string, {url, network}> map for Flashbots relay config rather than switch/case for easier network extension
- [Phase 01]: Simple Map<string,boolean> mutex for per-token sell lock -- JS single-threaded, no async-mutex needed
- [Phase 01]: Unified executeSell() function with mutex + balance check + timer cleanup instead of inline sell logic
- [Phase 01]: Manual whitelist check inside handler instead of GramJS NewMessage({fromUsers, chats}) to enable debug logging of rejected messages
- [Phase 01]: Empty Telegram whitelist env vars = allow all messages (backward compatible)
- [Phase 01]: Both sepolia and mainnet RPC entries use same ALCHEMY_URL -- user sets correct URL per network
- [Phase 02]: Used --legacy-peer-deps for flashbots bundle (pins ethers 6.7.1 peer but 6.16.0 is semver-compatible)
- [Phase 02]: Pinned ethers@6.16.0 and flashbots@1.0.0 exact versions for reproducible builds
- [Phase 02]: Used ethers.Contract wrapper for ContractFactory-deployed factory when calling custom methods (v6 BaseContract type lacks ABI methods)
- [Phase 02]: BigInt wrapping for config values: BigInt(CONFIG.gasLimit || 300_000) to safely convert potentially-number config to bigint
- [Phase 03]: Logger and DB read env vars directly from process.env (not CONFIG) to avoid circular dependency
- [Phase 03]: Schema migration uses user_version pragma for versioned DB upgrades
- [Phase 03]: Used inline db.prepare for resumeMonitoring pending trades query rather than adding exported prepared statement
- [Phase 03]: Removed redundant debug console.log lines in simulateSell (Path/Deadline) per existing code comment
- [Phase 03]: Consolidated getToken0FromPair/getToken1FromPair into single getTokenFromPair for DRY code
- [Phase 03]: Sensitive alpha data (message text, matched addresses) logged at debug level only to prevent leakage
- [Phase 03]: P&L query uses LEFT JOIN for unsold position visibility with CAST(COALESCE(...) AS REAL) for TEXT amount arithmetic
- [Phase 03]: config.ts imports logger.ts directly (no circular dependency) to replace console.error with logger.fatal

- [Phase 04]: Strategy dispatch pattern for safety APIs: safetyApis config field drives provider selection at runtime
- [Phase 04]: Backward-compatible overloads: all 10 original tokenSafety exports preserved alongside 10 new *ForChain variants
- [Phase 04]: Mudra adapter includes GoPlus fallback via dynamic import for BSC resilience
- [Phase 04]: ForChain functions accept dexRouter as parameter (not from CONFIG) to support multi-DEX per chain
- [Phase 04]: Tasks 1+2 committed together since both modify src/bot.ts as a cohesive refactor
- [Phase 04]: WebSocket close handler uses (wsProvider.websocket as any).on() due to ethers v6 WebSocketLike type limitation
- [Phase 04]: Function overloads in exitManager use runtime typeof check to disambiguate chain+token from token-only calls
- [Phase 04]: initMultiChainShutdownHandler in bot.ts handles WS teardown directly (owns ChainContext array)
- [Phase 04]: Auth keys read from mevConfig with process.env fallback for standalone strategy use
- [Phase 04]: Duck-type check in sendTxWithRetry selects multi-chain vs legacy path without separate function names
- [Phase 04]: Exhaustive switch with never type in createMevStrategy ensures compile-time safety for new strategy types

- [Phase 05]: DexConfigBase + DexConfigV2/V3 discriminated union via dexType field for compile-time V2/V3 narrowing
- [Phase 05]: SwapRouter02 used universally for V3 (deadline via multicall wrapper)
- [Phase 05]: BSC gets both Uniswap V3 and PancakeSwap V3 entries for maximum DEX coverage
- [Phase 05]: pool_type column defaults to v2 so existing trades auto-migrate without data backfill
- [Phase 05]: QuoterV2 static call for V3 sell simulation -- reverts on illiquid pools, caught as false
- [Phase 05]: V2 functions narrowed to DexConfigV2 param type for compile-time safety (removes runtime guards)
- [Phase 05]: Same-block Mint check before subscribe+timeout for atomic launch detection
- [Phase 05]: Hardcode ETH Uniswap V2 addresses in CONFIG rather than refactoring legacy consumers
- [Phase 05]: Empty Sets for default BLOCKLIST -- no tokens blocked initially, correct safe default
- [Phase 05]: Removed scripts/ from tsconfig include rather than adding exclude -- cleaner separation of Hardhat scripts from bot runtime
- [Phase 06]: RiskCheckResult object with reason+details instead of boolean for actionable logging/alerting
- [Phase 06]: In-memory Map for cooldowns (ephemeral, resets on restart safe per D-09)
- [Phase 06]: Inline prepared statement for exposureByChain GROUP BY query consistent with Phase 3 pattern
- [Phase 06]: Risk checks ordered cheapest-first: position_size -> daily_loss_limit -> max_positions -> cooldown -> exposure_cap
- [Phase 06]: Risk gate positioned after cheap blocklist/dedup checks but before expensive safety API calls for fast-fail
- [Phase 06]: Legacy handleNewPair uses 'eth' chain name and '1.0' maxCapital matching ETH chain template defaults
- [Phase 06]: recordSnipe() placed after sendTxWithRetry, before insertTrade.run -- cooldown starts only on confirmed TX
- [Phase 07]: Used --legacy-peer-deps for vitest install due to flashbots ethers peer dep conflict (consistent with Phase 02)
- [Phase 07]: it.todo markers for Wave 0 stubs -- Plans 01/02 fill in test bodies as features are built

- [Phase 07]: CV (coefficient of variation = stddev/mean) chosen as volatility metric -- dimensionless, normalizes across price ranges
- [Phase 07]: BigInt math for partial sell token amounts to avoid precision loss with ERC-20 token decimals
- [Phase 07]: registerExitMonitor clears ALL existing timers for key before setting new one -- leak prevention during migration
- [Phase 07]: exit_state table uses FOREIGN KEY to trades(id) for referential integrity
- [Phase 07]: txBuilder factory pattern for MEV-protected sells -- buildV2SellTx/buildV3SellTx return closures for sendTxWithRetry
- [Phase 07]: Partial sell failure does NOT kill exit monitor (Pitfall 6) -- logs warning, retries next cycle
- [Phase 07]: resumeExitMonitor uses current balance as originalTokenAmount for pre-Phase7 trades
- [Phase 07]: Used CONFIG.network for legacy handleNewPair trade ID lookup matching existing insertTrade chain field
- [Phase 07]: Legacy single-chain resumeMonitoring builds full ChainContext inline for resumeExitMonitor compatibility
- [Phase 07]: Kept maybeApprove/maybeApproveForChain as dead code since TS compiler doesn't enforce noUnusedLocals
- [Phase 08]: Inline asyncHandler in each route file for parallel plan execution independence
- [Phase 08]: Risk config read from env vars at request time (not cached) matching riskManager.ts pattern
- [Phase 08]: Cumulative P&L as running sum of realized_pnl sorted by sell_time for Lightweight Charts

- [Phase 08]: Express 5.x used (latest stable at install time) -- backward compatible with Express 4 patterns
- [Phase 08]: In-memory Map for sessions with 24h TTL -- simple, fits single-process bot architecture; no Redis needed
- [Phase 08]: Manual cookie parsing in WebSocket upgrade handler since cookie-parser doesn't run on HTTP upgrade events
- [Phase 08]: noServer mode for WebSocketServer -- upgrade handled via HTTP server event for session validation
- [Phase 08]: Tests use Node http module directly instead of supertest to avoid adding another dependency
- [Phase 08]: Force sell delegates lock management to executeFullSell instead of duplicating tryAcquireSellLock in route (prevents deadlock)
- [Phase 08]: Sequential execution for emergency sell (not Promise.allSettled) for safer sell mutex management
- [Phase 08]: WebSocketProvider context pattern to share single WS connection across Layout and page components
- [Phase 08]: AuthGuard wraps WebSocketProvider so WS only connects after authentication confirmed
- [Phase 08]: Placeholder pages for /trades, /risk, /chains routes to be filled by Plans 05-06
- [Phase 08]: lightweight-charts v5 uses chart.addSeries(AreaSeries, opts) instead of v4 chart.addAreaSeries(opts)
- [Phase 08]: EmergencyConfirmDialog composes ConfirmDialog with requireConfirmText rather than duplicating dialog UI
- [Phase 08]: Discriminated union type for dialog state in ChainControls (none|stop|start|emergency)
- [Phase 08]: Option A for apiServer shutdown: pass to initMultiChainShutdownHandler as second parameter
- [Phase 08]: sendCtxAlert reimplements Telegram call inline to avoid double-broadcast via sendTelegramAlert
- [Phase 08]: fs.existsSync for SPA catch-all instead of try/catch (sendFile errors are async)
- [Phase 09]: In-memory SQLite uses journal_mode=memory not WAL -- WAL pragma issued for parity but :memory: cannot use WAL mode
- [Phase 09]: vi.doUnmock required after vi.doMock to prevent mock leakage across describe blocks in same file
- [Phase 09]: Exit trigger correctness tested via pure computation functions rather than mocking startExitMonitor
- [Phase 09]: WebSocket reconnect tested via provider.ts utilities and backoff simulation since startDexListener not exported
- [Phase 09]: Conditional sepolia network in hardhat config to avoid crash when ALCHEMY_URL not set
- [Phase 09]: Fork test loads FakeToken artifact from compiled JSON for portability over typechain imports
- [Phase 09]: CI runs test:unit and test:integration only -- fork tests excluded since they require RPC access
- [Phase 10]: GROUP BY b.id for P&L aggregation: simpler than CTE, standard SQL, one-pass over sell rows
- [Phase 10]: Correlated subquery for exposure reduction (partial_sell proceeds subtracted from buy amount_in)
- [Phase 10]: Separate getPnLChartData query for per-event granularity vs getPnL per-position aggregation
- [Phase 11]: Pure it.todo stubs with no source imports -- modules do not exist yet at Wave 0
- [Phase 11]: Unrealized P&L formula: (currentPrice/1e18) + sell_revenue - buy_cost - sell_gas (approximation acceptable for v1)
- [Phase 11]: Dynamic import('./bot') in alphaDrop.ts to avoid circular dependency with telegramListener
- [Phase 11]: V3_FACTORY_ABI extended with getPool function for pool discovery in alpha drops
- [Phase 11]: Mutable closure pattern for telegramHandle: declared before startApiServer, populated after, closure reads by reference
- [Phase 11]: Fire-and-forget .catch() for telegram disconnect in synchronous shutdown handler
- [Phase 11]: RestartChainListenersCallback returns { warnings: string[] } instead of void for D-12 partial failure reporting
- [Phase 11]: Layout.tsx fetches /health via useApi to derive telegramStatus -- avoids adding telegram state to WebSocket context
- [Phase 11]: telegramStatus 'not-configured' uses StatusDot 'disconnected' (red) with distinct label text for user clarity
- [Phase 11]: Per-chain warnings stored as Record<string, string[]> in ChainControls state, cleared on new start/stop action
- [Phase 11]: Class-based TelegramClient mock for vitest mockReset compatibility; fake timers for cooldown bypass in telegram tests
- [Phase 11]: Removed maskRpcUrl helper from ChainStatusCard -- backend already masks URLs via maskUrl()
- [Phase 11]: cacheTimeout: -1 disables ethers v6 RPC response caching to prevent stale nonce in rapid sequential fork test transactions
- [Phase 12]: Belt-and-suspenders PRAGMA table_info guard for schema migration v4 dex_name column addition (D-14)
- [Phase 12]: Multi-dex resolution: exact dex_name match for new trades, first-match fallback for legacy NULL trades
- [Phase 12]: priceStale flag set when chain context exists but dex resolution fails (removed/renamed dex scenario)
- [Phase 12]: Fire-and-forget broadcast pattern: HTTP response sent before async broadcast to avoid delaying user feedback
- [Phase 12]: Hybrid WS/REST in ChainControls: wsChainStatuses.length > 0 selects WS data, empty array falls back to REST
- [Phase 12]: Broadcast on ALL start paths including restart failure: chain IS removed from stopped set regardless
- [Phase 12]: Verified all 28 .js files had matching .ts/.tsx counterparts before deletion (zero false positives)
- [Phase 13]: IIFE pattern for stopLossPercent: parseFloat with isNaN fallback to 25, matching existing trailingStopPct pattern
- [Phase 13]: FLASHBOTS_AUTH_KEY changed to required: false since chainRegistry.ts already validates conditionally per enabled chain

### Pending Todos

None yet.

### Blockers/Concerns

- [Research]: Uniswap V3 SDK may have ethers v5 internal dependency -- raw ABI approach may be needed in Phase 5
- [Research]: BSC MEV protection provider availability (Merkle/Blink) needs runtime verification in Phase 4
- [Research]: Honeypot API chain coverage varies -- BSC may need Go+ Security API alternative

## Session Continuity

Last session: 2026-04-06T19:38:39.324Z
Stopped at: Phase 14 context gathered
Resume file: .planning/phases/14-sell-revenue-receipt-decoding/14-CONTEXT.md

---
phase: 04-multi-chain-architecture
plan: 04
subsystem: bot-orchestrator
tags: [multi-chain, bot, orchestrator, websocket, reconnect, capital-tracking, exit-manager, gas-manager]

# Dependency graph
requires:
  - phase: 04-multi-chain-architecture/plan-01
    provides: ChainConfig, ChainContext, DexConfig, buildChainRegistry, createChainContext, getEnabledChains
  - phase: 04-multi-chain-architecture/plan-02
    provides: MevStrategy, createMevStrategy, sendTxWithRetry with ChainContext overload
  - phase: 04-multi-chain-architecture/plan-03
    provides: "*ForChain safety functions, sendCtxAlert for chain-prefixed notifications"
provides:
  - handleNewPairForChain with full chain-aware snipe pipeline
  - startMultiChainBot orchestrator with concurrent WebSocket listeners
  - WebSocket auto-reconnect with exponential backoff (1s-60s) via named handleWsClose
  - HTTP polling fallback for chains without WebSocket
  - Per-chain capital tracking with canDeployCapital/recordCapitalDeployed
  - Chain+token composite keys in exitManager preventing cross-chain timer collisions
  - Chain-aware gas estimation (EIP-1559 and legacy) in gasManager
  - Periodic MEV health checks every 5 minutes
  - Multi-chain shutdown handler with full cleanup
affects: [04-multi-chain-architecture/plan-05]

# Tech tracking
tech-stack:
  added: []
  patterns: [multi-chain-orchestrator, websocket-reconnect-backoff, composite-key-registry, function-overloads, capital-budget-tracking]

key-files:
  created: []
  modified: [src/bot.ts, src/utils/exitManager.ts, src/utils/gasManager.ts]

key-decisions:
  - "Tasks 1+2 committed together since both modify src/bot.ts as a single cohesive refactor"
  - "WebSocket close handler uses (wsProvider.websocket as any).on('close', ...) due to ethers v6 WebSocketLike type lacking on() method"
  - "HTTP polling uses EventLog instanceof check for type-safe event args access in ethers v6"
  - "initMultiChainShutdownHandler in bot.ts handles WebSocket teardown directly rather than delegating to exitManager"
  - "Legacy handleNewPair, startBot, resumeMonitoring preserved verbatim for backward compatibility"
  - "Function overloads in exitManager use typeof string check to disambiguate chain+token from token-only calls"

patterns-established:
  - "Multi-chain orchestrator: buildRegistry -> validate chainId -> MEV health check -> start listeners per DEX"
  - "Capital budget: canDeployCapital() checks before buy, recordCapitalDeployed() after successful buy"
  - "Composite key pattern: chain:tokenAddress for timer registry and sell locks"
  - "Named reconnect handler: async function handleWsClose() avoids arguments.callee"

requirements-completed: [CHAIN-03, CHAIN-05]

# Metrics
duration: 10min
completed: 2026-03-23
---

# Phase 04 Plan 04: Multi-Chain Bot Orchestrator Summary

**Multi-chain bot orchestrator with concurrent WebSocket listeners, exponential backoff reconnect, per-chain capital budget tracking, and chain+token composite keys in exitManager**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-23T00:24:39Z
- **Completed:** 2026-03-23T00:34:54Z
- **Tasks:** 3 auto + 1 checkpoint (automated)
- **Files modified:** 3

## Accomplishments
- Refactored src/bot.ts from single-chain to multi-chain orchestrator with handleNewPairForChain accepting ChainContext and DexConfig
- Built startMultiChainBot() that constructs registry, validates chainId per RPC, runs MEV health checks, and spawns concurrent listeners
- Implemented WebSocket auto-reconnect with exponential backoff (1s base, 2x growth, 60s cap) using named handleWsClose function
- Added HTTP polling fallback (2s interval) for chains without WebSocket support
- Implemented per-chain capital tracking (capitalDeployed Map) with canDeployCapital budget checks before each buy
- Added chain-aware monitor functions (monitorStopLossForChain, monitorTakeProfitForChain, scheduleTimedSellForChain)
- Added resumeMultiChainMonitoring that groups pending trades by chain and resumes with correct context
- Updated exitManager with function overloads: tryAcquireSellLock, releaseSellLock, registerStopLoss, registerTakeProfit, registerTimedSell, clearAllTimersForToken all accept (chainName, token) composite keys
- Added initMultiChainShutdownHandler to exitManager accepting cleanup callback
- Added getGasOptionsForChain to gasManager supporting EIP-1559 (ETH/Base/Arb) and legacy (BSC) gas pricing
- Entry point changed from startBot() to startMultiChainBot()
- All legacy functions preserved for backward compatibility

## Task Commits

Each task was committed atomically:

1. **Task 1+2: Refactor bot.ts with multi-chain orchestrator** - `14946a9` (feat)
2. **Task 3: exitManager chain+token keys and gasManager chain-aware gas** - `02c0aa6` (feat)

## Files Created/Modified
- `src/bot.ts` - Complete multi-chain refactor: handleNewPairForChain, startMultiChainBot, startDexListener with reconnect, capital tracking, chain-aware monitors, HTTP polling fallback, multi-chain shutdown handler
- `src/utils/exitManager.ts` - Function overloads for chain+token composite keys on all timer/lock functions, initMultiChainShutdownHandler
- `src/utils/gasManager.ts` - getGasOptionsForChain with EIP-1559 and legacy gas support per ChainContext

## Decisions Made
- Combined Tasks 1 and 2 into a single commit since both modify src/bot.ts as a cohesive unit -- the orchestrator functions depend on handleNewPairForChain and cannot compile independently
- Used `(wsProvider.websocket as any).on('close', ...)` because ethers v6 WebSocketLike type does not expose an `on()` method even though the underlying WebSocket implementation supports it
- Used `event instanceof EventLog` guard in HTTP polling to safely access event.args (ethers v6 queryFilter returns Log | EventLog union)
- Bot's initMultiChainShutdownHandler handles WebSocket teardown directly (destroying providers, removing listeners) rather than delegating to exitManager, since bot.ts owns the ChainContext array
- Function overloads in exitManager use runtime `typeof tokenOrInterval === 'string'` check to disambiguate 2-arg chain calls from legacy 2-arg calls where second arg is a timer handle

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] WebSocket type casting for close handler**
- **Found during:** Task 1 (startDexListener)
- **Issue:** ethers v6 `WebSocketLike` type does not include `on('close', ...)` method, causing TS error
- **Fix:** Cast `wsProvider.websocket as any` for the `.on('close', ...)` call
- **Files modified:** src/bot.ts
- **Commit:** 14946a9

**2. [Rule 3 - Blocking] EventLog type narrowing for HTTP polling**
- **Found during:** Task 1 (startHttpPollingListener)
- **Issue:** `queryFilter` returns `(Log | EventLog)[]` -- `args` only exists on `EventLog`
- **Fix:** Added `event instanceof EventLog` guard before accessing event.args
- **Files modified:** src/bot.ts
- **Commit:** 14946a9

---

**Total deviations:** 2 auto-fixed (both blocking type issues)
**Impact on plan:** Minimal -- both fixes are type-level only, no logic changes needed.

## Checkpoint Results (Task 4 - Automated)

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | 42 errors -- ALL pre-existing (CONFIG.wethAddress/routerAddress/factoryAddress from empty addresses.json, blocklist module, script artifacts). Zero new errors from this plan. |
| `npx hardhat test` | Cannot run -- no .env in worktree (pre-existing infra issue) |
| Chain registry chainIds | 1 (ETH), 56 (BSC), 8453 (Base), 42161 (Arb) present |
| MEV strategies directory | types.ts, flashbots.ts, bloxroute.ts, passthrough.ts present |
| Safety providers directory | types.ts, honeypotIs.ts, goplus.ts, unicrypt.ts, mudra.ts present |
| startMultiChainBot | Function defined at line 806, called at line 1006 |
| No arguments.callee | Only a comment explaining why it's avoided (line 738) |

## Issues Encountered
- Pre-existing TypeScript errors from empty addresses.json spread (CONFIG.wethAddress etc.) continue to affect legacy code paths. These are out of scope and predate Phase 4.
- Hardhat tests cannot run in worktree due to missing .env file with RPC URLs. Tests should be validated in the main working tree.

## Known Stubs
None -- all functions contain complete implementation logic. Capital tracking is wired to real budget checks. All safety checks dispatch to real providers. All monitors use real price queries.

## Next Phase Readiness
- Multi-chain bot orchestrator is fully wired -- Plans 01 through 04 together provide the complete multi-chain architecture
- The bot can be started with `startMultiChainBot()` which builds registry, validates chains, starts listeners, and monitors trades
- Plan 05 (if any) can build on this foundation for additional features like dynamic capital allocation

## Self-Check: PASSED

All 3 files verified present. Both task commits (14946a9, 02c0aa6) found in git log.

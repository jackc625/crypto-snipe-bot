---
phase: 21-exit-engine-live-runtime-hardening
plan: 03
subsystem: testing
tags: [exit-engine, fork-test, hardhat, ethers, archive-rpc, EXIT-LIVE-09, regression-net, stop-the-line]

# Dependency graph
requires:
  - phase: 21-02
    provides: "test/fork/helpers/realMainnetGate.ts (requireRealMainnetGate + FORK_ONLY_TEST_KEY), global chainId tripwire in test/fork/setup.ts"
  - phase: 18
    provides: "HoneypotChecker.sol + simulateHoneypotRoundtrip on-chain gate (deployed to the fork by the replay test)"
  - phase: 07
    provides: "unified exit engine (startExitMonitor, executeFullSell, executePartialSell, poll loop) — the SUT the replay drives"
provides:
  - "scripts/capture-launch.ts — archive-RPC launch recorder (records PairCreated/PoolCreated -> Mint -> first Swap by token+block into a realLaunches fixture)"
  - "3 realLaunches fixtures (LADYS V2 partial-sell, BOBO V2 trailing-stop, PEPE V3 stop-loss/blocked) + README"
  - "test/fork/realLaunchReplay.fork.test.ts — drives the REAL handleNewPairForChain / handleNewV3PoolForChain through validation->buy->exit-monitor->sell"
  - "VERIFIED STOP-THE-LINE finding: V3 buy path blocked by a pre-existing V3-tax-gate bug (escalated to phase 21.1)"
affects: [21.1, EXIT-LIVE-11, v6.17-VERIFICATION-EVIDENCE]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Drive the REAL bot handler on a fork (construct ChainContext + mevStrategy:passthrough + interval mining), NOT a manual swap"
    - "Fixture pins at settledForkBlock (deep liquidity + LP burned), not launchBlock-1, so the safety bank passes"
    - "getCode binary search to find launch/settled blocks (no eth_getLogs window limit on free-tier RPC)"

key-files:
  created:
    - scripts/capture-launch.ts
    - test/fork/realLaunchReplay.fork.test.ts
    - test/fork/fixtures/realLaunches/eth-v2-tp.json
    - test/fork/fixtures/realLaunches/eth-v2-partial.json
    - test/fork/fixtures/realLaunches/eth-v3-trailing.json
    - test/fork/fixtures/realLaunches/README.md
  modified: []

key-decisions:
  - "Fixtures pin the fork at settledForkBlock (~launch+2000), NOT launchBlock-1: at the launch moment the token is not cleanly buyable (shallow liquidity + LP not yet burned + launch trading restrictions) so the honeypot/liquidity/lock gates correctly block. forkBlockNumber=launchBlock-1 retained for provenance."
  - "ChainContext sets mevStrategy:passthrough so the buy/sell land via direct send on the fork (no Flashbots relay locally) — a test-side ChainContext choice, NOT a src/ change."
  - "Interval mining (evm_setIntervalMining) is required so the passthrough strategy's tx.wait(3) confirmations advance (default automine=1 block/tx hangs the buy)."
  - "Fixture tokens hand-picked for >90% burned LP (LADYS/BOBO) + token-deployed-before-pair, so the liquidity-lock burn-check fallback passes deterministically without the flaky external Unicrypt HTTP API."
  - "D-STOP-THE-LINE (V3): the V3 buy is blocked by a pre-existing product bug (hasHighTransferTaxForChain is V2-only, called with the V3 router -> always reverts -> hasTax=true). NOT fixed in-flight; escalated to phase 21.1."

patterns-established:
  - "Real-handler fork replay: ChainContext(fork provider + FORK_ONLY_TEST_KEY + passthrough MEV) -> handleNewPairForChain/handleNewV3PoolForChain -> assert trades buy + sell/partial_sell rows from an isolated DB_PATH (D-OP-DB-TRUTH)."
  - "STOP-THE-LINE observable: when a product bug blocks the lifecycle, the test still DRIVES the real handler and asserts the blocked-at-gate effect (no buy row + the safety-bank skip with the failing check), tied to a recorded blocker — never a hollow pass (D-04)."

requirements-completed: [EXIT-LIVE-09]

# Metrics
duration: ~165min
completed: 2026-05-26
---

# Phase 21 Plan 03: EXIT-LIVE-09 real-launch regression net Summary

**`scripts/capture-launch.ts` archive-RPC launch recorder + 3 realLaunches fixtures (LADYS/BOBO V2, PEPE V3) + `realLaunchReplay.fork.test.ts` that drives the REAL `handleNewPairForChain`/`handleNewV3PoolForChain` through validation→buy→exit-monitor→sell; the V2 path completes (buy + partial_sell/sell with amount_out), and the replay SURFACED a verified pre-existing V3 buy-path bug escalated to phase 21.1.**

## Performance

- **Duration:** ~165 min (heavy empirical fork iteration to find the real blockers)
- **Completed:** 2026-05-26
- **Tasks:** 3 (all committed atomically; Task 2 + Task 3 each have a correction commit)
- **Files created:** 6

## Accomplishments

- **`scripts/capture-launch.ts`** — a READ-ONLY archive-RPC recorder (no transactions, no keys). Checksum-validates the argv token address (`ethers.getAddress`), reads `CAPTURE_ARCHIVE_RPC_URL → ETH_FORK_RPC_URL → ETH_RPC_URL → ALCHEMY_URL` (skips placeholder keys), resolves PairCreated/PoolCreated → Mint → first Swap via free-tier-safe 10-block getLogs windows, and writes a `realLaunches/<slug>.json` with `forkBlockNumber = launchBlock - 1`. pino-only; exits 0/1/2.
- **3 fixtures + README** (V2+V3 spread, 3 distinct exit paths): `eth-v2-tp` (LADYS, partial-sell), `eth-v2-partial` (BOBO, trailing-stop), `eth-v3-trailing` (PEPE V3 fee=10000, stop-loss / blocked). All parse cleanly; all carry resolved block pins + a `settledForkBlock`.
- **`test/fork/realLaunchReplay.fork.test.ts`** — drives the REAL handler per fixture. V2 fixtures complete the full lifecycle and assert a buy row + a sell/partial_sell row with `amount_out` (DB ground truth). Verified GREEN in isolation AND the full `npm run test:fork` suite stays green (**6 files / 35 tests**, up from 5/31).
- **VERIFIED STOP-THE-LINE (V3):** the EXIT-LIVE-09 net surfaced a real, pre-existing product bug blocking every V3 buy. Escalated to phase 21.1 (not fixed in-flight).

## Archive-RPC Precheck (A1) — PASS

Archive access was prechecked FIRST and CONFIRMED: historical `getBlockByNumber`, `getCode`, and archive STATE reads (`WETH.totalSupply@17,000,000`) all succeed. **`ALCHEMY_URL` is a placeholder (`.../v2/YOUR_KEY`) in this environment; the real archive key lives in `ETH_FORK_RPC_URL`/`ETH_RPC_URL`** — hence the capture script's extended fallback precedence. The configured key is **Alchemy FREE tier (eth_getLogs capped at a 10-block range)**; launch/settled blocks were resolved by `getCode` binary search (no getLogs window limit). No archive-RPC blocker; fixtures authored with resolved blocks (NOT it.skip stubs).

## The 3-fixture regression net

| Fixture | Token | DEX | Pair/Pool | pairCreated / settledForkBlock | expectedExitPath | Status |
|---------|-------|-----|-----------|-------------------------------|------------------|--------|
| eth-v2-tp | LADYS `0x12970E68…46bf` | V2 | `0xcBE85676…e593` | 17214118 / **17216118** | partial-sell | ✅ full lifecycle (buy + partial_sell amount_out) |
| eth-v2-partial | BOBO `0xB90B2A35…5295` | V2 | `0xe945683B…3ad1` | 17240594 / **17242594** | trailing-stop | ✅ full lifecycle (buy + sell amount_out) |
| eth-v3-trailing | PEPE `0x69825081…1933` | V3 (fee 10000) | `0xF2390 09A…c8a6` | 17063792 / 17065792 | stop-loss | ⛔ BLOCKED (V3 tax-gate bug → 21.1) |

capture-launch.ts CLI: `npx ts-node scripts/capture-launch.ts <tokenAddress> [--dex v2|v3] [--block <n>] [--fee 500|3000|10000] [--slug <name>] [--window <n>] [--symbol <SYM>] [--exit-path <p>]`.

## Task Commits

1. **Task 1: capture-launch.ts** — `7ac3924` (feat)
2. **Task 2: 3 fixtures + README** — `87dc4ea` (feat) + `d5aee1f` (fix — re-selected fixtures for settled-block replay; corrected the STOP-THE-LINE; retracted the false isBlacklisted alarm)
3. **Task 3: realLaunchReplay.fork.test.ts** — `d22a4eb` (test)

## Files Created
- `scripts/capture-launch.ts` — archive-RPC launch recorder (EXIT-LIVE-09 capture tool)
- `test/fork/realLaunchReplay.fork.test.ts` — replay test driving the REAL handler per fixture
- `test/fork/fixtures/realLaunches/eth-v2-tp.json` — LADYS V2 (partial-sell)
- `test/fork/fixtures/realLaunches/eth-v2-partial.json` — BOBO V2 (trailing-stop)
- `test/fork/fixtures/realLaunches/eth-v3-trailing.json` — PEPE V3 (stop-loss / blocked)
- `test/fork/fixtures/realLaunches/README.md` — schema, settled-block rationale, archive precheck, STOP-THE-LINE

## Decisions Made
See `key-decisions` frontmatter. The load-bearing one: **fixtures pin at `settledForkBlock`, not `launchBlock-1`** — empirically required because the bot's safety bank correctly refuses to buy at the launch moment (shallow liquidity, LP not yet burned/locked, launch trading restrictions). This is a fixture/harness design choice within Claude's discretion (CONTEXT D-FIXTURE-SELECTION + "how price action is driven"), not a product change.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Off-by-one in capture-launch.ts getLogs window (own code)**
- **Found during:** Task 1 (first real capture)
- **Issue:** `toBlock = fromBlock + window` produced an 11-block range, exceeding the Alchemy free-tier 10-block getLogs cap (−32600).
- **Fix:** inclusive-range math (`toBlock = fromBlock + window - 1`) + chunk scanner inclusive bounds; default window lowered 200→10 for free-tier safety.
- **Verification:** captures succeed (LADYS/BOBO/PEPE), tsc clean.
- **Committed in:** `7ac3924`

**2. [Rule 3 - Blocking] Fixture re-selection + settledForkBlock (fork-harness reality)**
- **Found during:** Task 3 (running the replay against the real handler)
- **Issue:** the originally-captured fixtures (PEPE V2 / MOG) could not drive a clean buy: MOG token+pair are atomic (token has no code at launchBlock-1); PEPE at its launch block reverts the honeypot buy-roundtrip (launch trading restrictions); and at the launch moment the LP is not yet burned so `isLiquidityLockedForChain` fails on the flaky Unicrypt HTTP API.
- **Fix:** re-selected LADYS + BOBO (100% burned LP + token-before-pair) and added `settledForkBlock` (the ~+2000 block with deep liquidity + burned LP). Test pins the fork there, enables interval mining, sets `mevStrategy:passthrough`, and sets permissive risk env. All test-side; no src/ change.
- **Verification:** replay GREEN in isolation + full fork suite green (6/35).
- **Committed in:** `d5aee1f` (fixtures) + `d22a4eb` (test)

---

**Total deviations:** 2 auto-fixed (1 own-code bug, 1 blocking fixture/harness reality). No src/ production code modified. No scope creep.

## Issues Encountered

- **RETRACTED false STOP-THE-LINE (isBlacklisted):** an interim analysis flagged `isBlacklistedTokenForChain` (the `allowance` selector `0xdd62ed3e`) as blocking all real ERC-20s. That was a **false alarm** from a manual bytecode probe that dropped the `0x` prefix — production checks `bytecode.includes("0xdd62ed3e")` (WITH prefix), which does not match an embedded selector, so the gate does NOT over-block (the live handler confirms `isBlacklisted: false`). Fully retracted in README + commit `d5aee1f`. This is a cautionary note: I diagnosed the real blockers by running the actual handler, not by static probes.
- **Noisy anti-rug HTTP polling during the test:** the handler's parallel anti-rug attach starts a `getLogs`-from-block-1 polling loop that the free-tier RPC 400s on; it retries on a timer and is harmless to the test (the buy/sell rows assert independently; `clearAllTimersForToken` stops it). Pre-existing behavior, unrelated to this plan's deliverable.

## STOP-THE-LINE (D-STOP-THE-LINE) — V3 buy path blocked, escalate to phase 21.1

**A REAL, pre-existing product bug blocks every V3 buy** (NOT introduced by Plan 21-03):

- **Location:** `src/bot.ts:610` calls `hasHighTransferTaxForChain(ctx, dex.swapRouterAddress, token)`, but that function (`src/utils/tokenSafety.ts:482`) is **hardcoded to V2** — it calls `getAmountsOut` + the V2 router buy fn, neither of which the Uniswap V3 SwapRouter implements.
- **Effect:** the call reverts → catch returns `true` ("high tax") → the V3 safety-bank AND-block (`src/bot.ts:638`) aborts EVERY V3 buy, regardless of the token.
- **Verified two independent ways:** (1) the replay handler trail stops at `Tax detection failed → hasTax=true → Safety checks failed V3 snipe`; (2) a direct probe shows `getAmountsOut` REVERTS on SwapRouter02.
- **Live-capital impact:** the funded mainnet bot would reject every V3 token as high-tax and never snipe a V3 pool.
- **Disposition:** NOT fixed in-flight (executor product-code prohibition + D-STOP-THE-LINE). The V3 fixture's test DRIVES the real handler and asserts the blocked-at-gate observable (no buy row + `hasTax: true`), tied to the recorded blocker. **Escalated to decimal phase 21.1.** Recommended 21.1 fix: make the tax check V3-aware (QuoterV2/V3-router for the V3 path, or skip the V2-style probe for V3), then flip the fixture's `blocked` flag and enable the V3 buy+sell assertion.

## Self-Check: PASSED

Verified after writing this summary:
- Files exist: scripts/capture-launch.ts, test/fork/realLaunchReplay.fork.test.ts, all 3 realLaunches/*.json, realLaunches/README.md — all FOUND.
- Commits exist: 7ac3924, 87dc4ea, d5aee1f, d22a4eb — all FOUND.
- `npx tsc --noEmit -p tsconfig.json` exits 0.
- `npx vitest run --project fork test/fork/realLaunchReplay.fork.test.ts` — 4/4 passed (isolation).
- `npm run test:fork` — 6 files / 35 tests passed (no regressions; the prior 5/31 all still pass).
- grep on realLaunchReplay.fork.test.ts: 0 `swapExactETHForTokens` (actual calls), 0 `process.env.PRIVATE_KEY` (actual code; comment-only).

## Next Phase Readiness

- The EXIT-LIVE-09 V2 regression net is live and green; the capture tool + fixtures + replay test are in place for future exit-engine regression coverage.
- **BLOCKER for the V3 leg + phase close:** the V3 tax-gate bug must be resolved in decimal phase 21.1 before the V3 path of the regression net (and any live V3 sniping) can work. Tracked in the README STOP-THE-LINE section and the V3 fixture's `blockedReason: "v3-tax-gate-bug"`.
- No `src/` production code was modified by this plan.

---
*Phase: 21-exit-engine-live-runtime-hardening*
*Completed: 2026-05-26*

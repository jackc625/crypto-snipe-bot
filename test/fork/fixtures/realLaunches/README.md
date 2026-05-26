# Phase 21 — Real-Launch Fork Test Fixtures (EXIT-LIVE-09)

Pinned-block real-mainnet **safe-launch** fixtures consumed by
[`test/fork/realLaunchReplay.fork.test.ts`](../../realLaunchReplay.fork.test.ts)
(created in Plan 21-03, Phase 21 Wave 2). Each JSON file records one historical
ETH token launch (`PairCreated`/`PoolCreated` → `Mint` → first `Swap`). The
replay test spins up a Hardhat mainnet fork, constructs a `ChainContext` (fork
provider + fork-only wallet + ETH chain config), and drives the **REAL**
`handleNewPairForChain` / `handleNewV3PoolForChain` bot handler through the full
validation → buy → exit-monitor → sell lifecycle — NOT a manual swap harness
(RESEARCH Pitfall 5 / Anti-Pattern A; the antithesis is
`test/fork/snipeLifecycle.test.ts`, which manually swaps and never calls the
handler).

This directory parallels the **reject-path** fixture dirs
[`test/fork/fixtures/honeypots/`](../honeypots/) (Phase 18 honeypot reject path)
and [`test/fork/fixtures/rugs/`](../rugs/) (Phase 19 LP-removal reject path). The
reject path STAYS covered by those two dirs (D-FIXTURE-EXITS) — `realLaunches/`
holds only safe, tradeable launches that exercise the engine's **exit branches**
(partial-sell, trailing-stop, stop-loss), forming a regression net across the
exit engine's success paths.

Each fixture is recorded deterministically by
[`scripts/capture-launch.ts`](../../../../scripts/capture-launch.ts) (the
EXIT-LIVE-09 archive-RPC recorder) by token address + launch block.

---

## Archive-RPC Precheck Result (Assumption A1) — PASS

> Per Plan 21-03 Task 2, the archive RPC tier was prechecked FIRST, before any
> fixture authoring.

**Result: ARCHIVE ACCESS CONFIRMED — fixtures authored with resolved blocks.**
(No archive-RPC blocker; all fixtures carry real, resolved block pins.)

- Historical `getBlockByNumber`, `getCode`, and **archive STATE reads**
  (`WETH.totalSupply` at block 17,000,000 / April 2023) all succeed.
- `eth_getLogs` works but the configured key is **Alchemy FREE tier**, which
  caps `eth_getLogs` at a **10-block range** per request. `capture-launch.ts`
  accommodates this (default `--window 10`, chunked Mint/Swap lookahead). Launch
  blocks were resolved by a `getCode` binary search on the pair/pool address (no
  getLogs window limit) — the recommended way to find a launch block on a
  free-tier key.
- **Endpoint nuance (A1 answer):** in this environment `ALCHEMY_URL` is a
  placeholder (`.../v2/YOUR_KEY`); the REAL archive key lives in
  `ETH_FORK_RPC_URL` / `ETH_RPC_URL`. `capture-launch.ts`'s provider precedence
  is `CAPTURE_ARCHIVE_RPC_URL → ETH_FORK_RPC_URL → ETH_RPC_URL → ALCHEMY_URL`
  (skipping placeholder keys). For a wider getLogs window, set
  `CAPTURE_ARCHIVE_RPC_URL` to a PAYG/archive endpoint.

---

## Why fixtures pin at `settledForkBlock`, not `launchBlock - 1`

> Empirically derived during Plan 21-03 by driving the REAL handler on a fork.

The rugs/honeypots reject-path fixtures pin at `forkBlockNumber = launchBlock-1`
to replay a *single rejected event*. But the realLaunches **success path** must
drive a *clean validated buy*, and at the launch MOMENT a token is NOT yet
cleanly buyable by the bot's gates:

- **Shallow liquidity:** at `launchBlock`/`+12` the WETH-side reserve is often
  below the 1-ETH `isLiquiditySufficientForChain` floor (LADYS had < 1 ETH until
  ~+2000 blocks).
- **LP not yet locked/burned:** `isLiquidityLockedForChain` (ETH → Unicrypt HTTP
  API, with an on-chain >90%-burned fallback) fails at the launch moment because
  the LP burn/lock happens in a *later* tx (LADYS/BOBO LP reaches 100% burned
  only after the launch settles).
- **Launch trading restrictions:** the on-chain HoneypotChecker buy-roundtrip
  reverts (`UniswapV2: TRANSFER_FAILED`) at some tokens' exact launch block
  because of anti-snipe restrictions — the gate correctly blocks.

So each fixture records BOTH:
- `forkBlockNumber` = `launchBlock - 1` (launch-replay provenance), and
- `settledForkBlock` = a block ~2000 after the launch (same-day settling) where
  the pool has deep liquidity AND the LP is burned. **The replay test pins the
  fork at `settledForkBlock`** so the REAL handler completes the buy.

The replay test also (a) sets `mevStrategy: 'passthrough'` on the constructed
ChainContext so the buy/sell land via direct send (a local fork has no Flashbots
relay — a TEST-SIDE ChainContext choice, NOT a src/ change), (b) enables Hardhat
interval mining so the passthrough strategy's `tx.wait(3)` confirmations advance,
and (c) sets the risk-gate env permissively so `canSnipe` (which runs before the
safety bank) passes.

---

## ⛔ STOP-THE-LINE: V3 buy path blocked by a pre-existing bug

> **Status: BLOCKER (V3 path only) — escalated to decimal phase 21.1 per
> D-STOP-THE-LINE.** The V2 fixtures drive the full lifecycle and pass. The V3
> fixture is blocked by a **pre-existing product bug** (NOT introduced by Plan
> 21-03). Per D-STOP-THE-LINE, it was NOT fixed in-flight and NOT silently
> deferred — it is surfaced here and in `21-03-SUMMARY.md` for escalation.

**The bug:** the V3 buy path at `src/bot.ts:610` calls
`hasHighTransferTaxForChain(ctx, dex.swapRouterAddress, token)`, but that
function (`src/utils/tokenSafety.ts:482`) is **hardcoded to V2** — it calls
`getAmountsOut` + the V2 router buy function, neither of which the Uniswap V3
SwapRouter implements. The call reverts → the function's catch returns `true`
("high tax") → the V3 safety-bank AND-block (`src/bot.ts:638`) aborts **EVERY**
V3 buy regardless of the token.

**Verified two independent ways:**
1. The replay handler trail stops at
   `Tax detection failed → hasTax=true → Safety checks failed V3 snipe`.
2. A direct probe shows `getAmountsOut` REVERTS on the V3 SwapRouter02
   (`execution reverted; no data present`).

**Provenance:** `hasHighTransferTaxForChain` and the `bot.ts:610` V3 wiring
predate Phase 21 (untouched this phase).

**Live-capital impact:** on live mainnet the funded bot would reject **every**
V3 token as high-tax and never snipe a V3 pool — a real defensive-hardening gap
surfaced by the EXIT-LIVE-09 regression net doing its job.

**Why no test-side workaround:** the replay must drive the REAL handler
(success-criterion-2 / Pitfall 5). The blocking gate is in `src/` production
code; making it pass requires a `src/` change (forbidden in-flight per
D-STOP-THE-LINE and the executor's product-code prohibition). The V3 fixture's
test therefore DRIVES the real handler and asserts the **observable
blocked-at-gate effect** (no buy row + the safety-bank skip log with
`hasTax: true`) — it is the `it.skip`-equivalent tied to this recorded blocker,
not a hollow pass (D-04).

**Escalation:** decimal phase 21.1 should (1) make the tax check V3-aware (use
QuoterV2 / the V3 router for the V3 path, or skip the V2-style probe for V3),
and (2) flip the V3 fixture's `blocked` flag to false so the replay test's V3
branch asserts a real buy + sell row.

### Note on the retracted `isBlacklisted` false-alarm

An earlier draft of this README flagged `isBlacklistedTokenForChain` (the
`allowance` selector `0xdd62ed3e`) as the blocker. That was a **false alarm**
from a manual bytecode probe that dropped the `0x` prefix. The production code
checks `bytecode.includes("0xdd62ed3e")` (WITH the `0x`), which essentially never
matches a selector embedded mid-bytecode — so the gate does NOT over-block, and
the live handler confirms `isBlacklisted: false` for real tokens. That escalation
is fully retracted; the real (verified) V3 blocker is the tax-gate bug above.

---

## JSON Schema

The realLaunches fixture schema mirrors the [`rugs/`](../rugs/README.md) +
[`honeypots/`](../honeypots/) shape and extends it with launch-lifecycle fields
(`pairCreatedBlock`, `mintBlock`, `firstSwapBlock`, `settledForkBlock`,
`expectedExitPath`). V3-only fields (`poolAddress`, `swapRouterAddress`,
`quoterAddress`, `feeTier`) are populated when `dexType === "v3"` and null for
V2; the V2-only `pairAddress` + `routerAddress` are null for V3.

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| `slug` | string | yes | Filename-safe slug; matches filename minus `.json`. |
| `chain` | string | yes | `eth` only for this dir. |
| `dexType` | string | yes | `v2` or `v3`. Selects the handler under test. |
| `tokenAddress` | string | yes | Launch ERC-20 (checksummed). Drives the fork buy. |
| `tokenSymbol` | string \| null | optional | On-chain symbol read from archive state at the launch block. |
| `pairAddress` | string \| null | V2 | V2 pair contract (null for V3). |
| `poolAddress` | string \| null | V3 | V3 pool contract (null for V2). |
| `routerAddress` | string \| null | V2 | Uniswap V2 router `0x7a25…488D`. |
| `swapRouterAddress` | string \| null | V3 | Uniswap V3 router. |
| `quoterAddress` | string \| null | V3 | Uniswap V3 QuoterV2. |
| `feeTier` | number \| null | V3 | 500 / 3000 / 10000. Non-null for the V3 fixture. |
| `pairCreatedBlock` | number | yes | Block of the `PairCreated`/`PoolCreated` event. |
| `mintBlock` | number \| null | yes (may be null) | Block of the first `Mint`. `null` ⇒ LP added beyond the capture lookahead (tracked below). For V3 the replay passes this to `handleNewV3PoolForChain` so `waitForLiquidity`'s same-block Mint query resolves. |
| `firstSwapBlock` | number \| null | yes (may be null) | Block of the first `Swap`. `null` ⇒ first trade beyond lookahead (tracked below). |
| `forkBlockNumber` | number | yes | `pairCreatedBlock - 1` — launch-replay provenance. |
| `settledForkBlock` | number | yes | The block the replay test PINS the fork at (deep liquidity + LP burned). See "Why fixtures pin at settledForkBlock" above. |
| `lpBurnedPctAtSettled` | number | optional | % of LP burned at `settledForkBlock` (drives the lock-gate burn-check fallback). |
| `blocked` | boolean | optional | `true` if the fixture's full lifecycle is blocked by a recorded product bug (V3 tax-gate). |
| `blockedReason` | string | optional | Machine-readable blocker id (e.g. `v3-tax-gate-bug`). |
| `expectedVerdict` | string | yes | Always `"safe"` for this dir (hand-picked safe launches). |
| `expectedExitPath` | string | yes | The engine exit branch the replay drives: `partial-sell` \| `trailing-stop` \| `stop-loss`. The three fixtures are distinct. |
| `discoveredVia` | string | yes | Provenance — `etherscan` for the captured set. |
| `discoveredOn` | string | optional | ISO date captured. |
| `notes` | string | optional | Free-form: provenance, WETH-pairing, settled-block / blocker caveats. |

---

## V2 Fixtures

### `eth-v2-tp.json` — LADYS V2 (partial-sell exit path)

| Property | Value |
|----------|-------|
| Token | LADYS (`0x12970E6868f88f6557B76120662c1B3E50A646bf`) |
| Pair | `0xcBE856765eeEc3fDC505dDEbF9dC612Da995e593` |
| **PairCreated / Mint / first Swap** | 17214118 / 17214118 / 17214119 |
| Fork pin (replay) | **settledForkBlock 17216118** (~18 ETH liq, LP 100% burned) |
| `forkBlockNumber` (provenance) | 17214117 |
| Exit path under test | **partial-sell** — the test pumps the pool ≥ 2× so the `PARTIAL_SELL_TARGETS` 2× tier fires a `partial_sell` row with amount_out. |

### `eth-v2-partial.json` — BOBO V2 (trailing-stop exit path)

| Property | Value |
|----------|-------|
| Token | BOBO (`0xB90B2A35C65dBC466b04240097Ca756ad2005295`) |
| Pair | `0xe945683B3462D2603a18BDfBB19261C6a4f03aD1` |
| **PairCreated / Mint / first Swap** | 17240594 / 17240594 / 17240618 |
| Fork pin (replay) | **settledForkBlock 17242594** (~80 ETH liq, LP 100% burned) |
| `forkBlockNumber` (provenance) | 17240593 |
| Exit path under test | **trailing-stop** — the test pumps ≥ 2× (activating the trailing stop), and the engine exits the position via its own poll loop (a sell/partial_sell row with amount_out). |

---

## V3 Fixtures

### `eth-v3-trailing.json` — PEPE V3 (1% / fee=10000) — BLOCKED (V3 tax-gate bug)

| Property | Value |
|----------|-------|
| Token | PEPE (`0x6982508145454Ce325dDbE47a25d4ec3d2311933`) |
| Pool | `0xF239009A101B6B930A527DEaaB6961b6E7deC8a6` (fee 10000) |
| **PoolCreated / Mint / first Swap** | 17063792 / 17063792 / 17063794 (full launch lifecycle resolved) |
| Fork pin (replay) | settledForkBlock 17065792 (deep liquidity) |
| Fee tier | 10000 |
| `expectedExitPath` | stop-loss (intended once 21.1 fixes the V3 tax gate) |
| **Status** | `blocked: true`, `blockedReason: "v3-tax-gate-bug"` — see STOP-THE-LINE above. The replay drives the REAL `handleNewV3PoolForChain`, the V3 honeypot gate + same-block-Mint check pass, but the V2-only tax gate (`bot.ts:610`) aborts the buy. Escalated to phase 21.1. |

The PEPE V3 1% pool is the V3 DEX exemplar (D-FIXTURE-DEX V2+V3 spread).

---

## How to Add a New Fixture

1. **Source discovery.** Hand-pick a historical ETH launch that is safe +
   tradeable AND whose **LP is locked/burned** (>90% burned passes the
   deterministic lock-gate fallback) AND whose token contract was **deployed
   before** its pair (so it exists at the fork block). D-FIXTURE-SELECTION; NOT
   auto-discovery.
2. **Find the launch block** via a `getCode` binary search on the pair/pool
   address (no `eth_getLogs` window limit on a free-tier key).
3. **Find a settled block** ~2000 blocks after the launch where the WETH-side
   reserve ≥ 1 ETH AND the LP is ≥ 90% burned (probe `getReserves` +
   `balanceOf(0x…dEaD)` at offsets). Record it as `settledForkBlock`.
4. **Capture.**
   ```
   npx ts-node scripts/capture-launch.ts <tokenAddress> --dex v2|v3 \
       --block <launchBlock> [--fee 500|3000|10000] --slug <name> \
       --exit-path partial-sell|trailing-stop|stop-loss
   ```
   Then add `settledForkBlock` (and `lpBurnedPctAtSettled`) to the JSON.
5. **JSON parse check.**
   `node -e "JSON.parse(require('fs').readFileSync('PATH','utf8'))"`.
6. **Test wiring.** Add the filename to `FIXTURE_FILES` in
   `test/fork/realLaunchReplay.fork.test.ts`. **Removal-pairing rule:** deleting
   a fixture JSON MUST be paired with removing its entry there, or the fork
   suite fails to start (the test reads each fixture by name in a static table).

---

## Outstanding Block-Pin Verification

All three fixtures carry resolved load-bearing pins (`pairCreatedBlock`,
`forkBlockNumber`, `settledForkBlock`). The `null` fields below are
informational launch-lifecycle metadata (NOT load-bearing — the replay drives
price action itself); they are tracked for completeness.

> The dominant outstanding item for this dir is the **V3 tax-gate STOP-THE-LINE
> blocker** documented above, escalated to decimal phase 21.1.

| Fixture | Field(s) `null` | Follow-up | Owner | Next Step |
|---------|-----------------|-----------|--------|-----------|
| `eth-v2-tp.json` | — (all resolved) | — | — | — |
| `eth-v2-partial.json` | — (all resolved) | — | — | — |
| `eth-v3-trailing.json` | — (all resolved) | V3 tax-gate bug | @jackcutrara | Fix the V3 tax gate in phase 21.1, then flip `blocked` → false and enable the V3 buy+sell assertion. |

---

## See Also

- [`scripts/capture-launch.ts`](../../../../scripts/capture-launch.ts) — the
  EXIT-LIVE-09 archive-RPC launch recorder that produced these fixtures.
- [`test/fork/realLaunchReplay.fork.test.ts`](../../realLaunchReplay.fork.test.ts)
  — the replay test that drives the REAL handler per fixture (the consumer).
- [`test/fork/fixtures/rugs/README.md`](../rugs/README.md) — Phase 19 sibling
  reject-path schema; this schema mirrors it.
- [`test/fork/fixtures/honeypots/`](../honeypots/) — Phase 18 honeypot reject
  path; the reject path stays there (D-FIXTURE-EXITS).
- `src/bot.ts` — `handleNewPairForChain` (`:203`) / `handleNewV3PoolForChain`
  (`:502`); the V3 tax-gate blocker is the `hasHighTransferTaxForChain` call at
  `:610`.
- `src/exitEngine.ts` — `startExitMonitor` / `executeFullSell` /
  `executePartialSell`, the exit branches the fixtures target.
- `src/chainRegistry.ts` (ETH template) — canonical router / quoter / WETH
  addresses recorded in the fixtures.

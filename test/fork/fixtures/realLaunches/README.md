# Phase 21 — Real-Launch Fork Test Fixtures (EXIT-LIVE-09)

Pinned-block real-mainnet **safe-launch** fixtures consumed by
[`test/fork/realLaunchReplay.fork.test.ts`](../../realLaunchReplay.fork.test.ts)
(created in Plan 21-03, Phase 21 Wave 2). Each JSON file pins one historical ETH
token launch (`PairCreated`/`PoolCreated` → `Mint` → first `Swap`) to a specific
mainnet block. The replay test spins up a Hardhat mainnet fork at
`forkBlockNumber` (one block before the launch), constructs a `ChainContext`
(fork provider + fork-only wallet + ETH chain config), and drives the **REAL**
`handleNewPairForChain` / `handleNewV3PoolForChain` bot handler through the full
validation → buy → exit-monitor → sell lifecycle — NOT a manual swap harness
(RESEARCH Pitfall 5 / Anti-Pattern A; the antithesis is
`test/fork/snipeLifecycle.test.ts`, which manually swaps and never calls the
handler).

This directory parallels the **reject-path** fixture dirs
[`test/fork/fixtures/honeypots/`](../honeypots/) (Phase 18, honeypot reject path)
and [`test/fork/fixtures/rugs/`](../rugs/) (Phase 19, LP-removal reject path). The
reject path STAYS covered by those two dirs (D-FIXTURE-EXITS) — `realLaunches/`
holds only safe, tradeable launches that exercise the engine's **exit branches**
(take-profit, partial-sell, trailing-stop), forming a regression net across the
exit engine's success paths.

Each fixture is recorded deterministically by
[`scripts/capture-launch.ts`](../../../../scripts/capture-launch.ts) (the
EXIT-LIVE-09 archive-RPC recorder) by token address + launch block, so the
replay is reproducible (D-FIXTURE-SELECTION).

---

## ⛔ STOP-THE-LINE: pre-existing safety-bank bug blocks the live buy

> **Status: BLOCKER — escalated to decimal phase 21.1 per D-STOP-THE-LINE.**
> The replay test is wired correctly and drives the REAL handler, but the
> handler's buy is blocked for these fixtures by a **pre-existing product bug**
> in `src/utils/tokenSafety.ts` (NOT introduced by Plan 21-03). Per
> D-STOP-THE-LINE, this was NOT fixed in-flight and NOT silently deferred — it
> is surfaced here and in `21-03-SUMMARY.md` for escalation.

**The bug:** `isBlacklistedTokenForChain` (`src/utils/tokenSafety.ts:357-365`)
treats the 4-byte selector `0xdd62ed3e` as an "anti-bot selector". But
`0xdd62ed3e` is the **standard ERC-20 `allowance(address,address)` selector**,
present in essentially every legitimate token. The gate therefore returns
`true` ("blacklisted") for nearly every real ERC-20, and the AND-block in both
handlers (`src/bot.ts:348` V2, `:638` V3) aborts the buy
(`if (... || isBlacklisted || ...) return;`).

**Empirical confirmation** (current mainnet bytecode, via the configured archive
RPC): PEPE, LINK, MOG, TURBO, HPOS10I, WOJAK, ANDY, USDT, DAI, WBTC, WETH all
trip `isBlacklisted = BLOCK`. Only proxy-pattern tokens whose `allowance` lives
in the implementation contract (USDC, AAVE, stETH) pass — and those are not
fresh launches with a `PairCreated`→`Mint`→`Swap` lifecycle.

**Provenance:** the `0xdd62ed3e` selector entry dates to commit `7623374`
(2026-03-22, Phase 04-03 `feat: add chain-aware safety dispatch`) — long
predates Phase 21. It is untouched by this phase.

**Live-capital impact:** this is not merely a test problem. On live mainnet the
funded bot would reject almost every real token as "blacklisted" and never
snipe. This is a real defensive-hardening gap surfaced by the EXIT-LIVE-09
regression net doing exactly its job.

**Why no test-side workaround:** the replay must drive the REAL handler
(success-criterion-2 / Pitfall 5). The blocking gate is in `src/` production
code; making it pass requires either a `src/` change (forbidden in-flight per
D-STOP-THE-LINE and the executor's product-code prohibition) or a non-launch
proxy token (which violates the EXIT-LIVE-09 fixture definition). The replay
test therefore asserts the **observable blocked-at-gate effect** (the handler is
reached, the buy is correctly NOT recorded, no sell row appears) and points at
this blocker, rather than asserting hollow buy+sell rows (D-04).

**Escalation:** decimal phase 21.1 should (1) remove `0xdd62ed3e` (and audit
`0x60fe47b1` = `set(uint256)`, also a non-anti-bot collision) from the
`antiBotSelectors` list, (2) replace the substring-grep blacklist heuristic with
a real anti-bot detection, and (3) re-enable the buy+sell assertions in
`realLaunchReplay.fork.test.ts` (the `it.skip` / soft branches keyed on this
blocker flip to hard buy+sell-row assertions once the gate passes).

---

## Archive-RPC Precheck Result (Assumption A1)

> Per Plan 21-03 Task 2, the archive RPC tier was prechecked FIRST, before any
> fixture authoring.

**Result: ARCHIVE ACCESS CONFIRMED — fixtures authored with resolved blocks.**
(No archive-RPC blocker; the fixtures below carry real, resolved block pins.)

- Historical `getBlockByNumber`, `getCode`, and **archive STATE reads**
  (`WETH.totalSupply` at block 17,000,000 / April 2023) all succeed.
- `eth_getLogs` succeeds but the configured key is **Alchemy FREE tier**, which
  caps `eth_getLogs` at a **10-block range** per request. `capture-launch.ts`
  accommodates this (default `--window 10`, chunked Mint/Swap lookahead). Launch
  blocks were resolved by a `getCode` binary search on the pair/pool address
  (no getLogs window limit), which is the recommended way to find a launch block
  on a free-tier key.
- **Endpoint nuance (A1 answer):** in this environment `ALCHEMY_URL` is a
  placeholder (`.../v2/YOUR_KEY`); the REAL archive key lives in
  `ETH_FORK_RPC_URL` / `ETH_RPC_URL`. `capture-launch.ts`'s provider precedence
  is `CAPTURE_ARCHIVE_RPC_URL → ETH_FORK_RPC_URL → ETH_RPC_URL → ALCHEMY_URL`
  (skipping placeholder keys). For a wider getLogs window, set
  `CAPTURE_ARCHIVE_RPC_URL` to a PAYG/archive endpoint.

---

## JSON Schema

The realLaunches fixture schema mirrors the
[`rugs/`](../rugs/README.md) + [`honeypots/`](../honeypots/) shape and extends it
with launch-lifecycle fields (`pairCreatedBlock`, `mintBlock`, `firstSwapBlock`,
`expectedExitPath`). V3-only fields (`poolAddress`, `swapRouterAddress`,
`quoterAddress`, `feeTier`) are populated when `dexType === "v3"` and null for
V2; the V2-only `pairAddress` + `routerAddress` are null for V3.

```json
{
  "slug": "eth-v2-tp",
  "chain": "eth",
  "dexType": "v2" | "v3",
  "tokenAddress": "0x...",
  "tokenSymbol": "PEPE",
  "pairAddress": "0x...",          // V2 only (null for V3)
  "poolAddress": "0x...",          // V3 only (null for V2)
  "routerAddress": "0x7a25...488D",// V2 only
  "swapRouterAddress": "0xE592...1564", // V3 only
  "quoterAddress": "0x61fF...B21e",     // V3 only
  "feeTier": 10000,                // V3 only (500/3000/10000); null for V2
  "pairCreatedBlock": 17046833,
  "mintBlock": 17046833,           // may be null (LP added > lookahead later)
  "firstSwapBlock": 17063794,      // may be null (first trade beyond lookahead)
  "forkBlockNumber": 17046832,     // pairCreatedBlock - 1 (replay launch next block)
  "expectedVerdict": "safe",
  "expectedExitPath": "take-profit | partial-sell | trailing-stop",
  "discoveredVia": "etherscan",
  "discoveredOn": "2026-05-26",
  "notes": "..."
}
```

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| `slug` | string | yes | Filename-safe slug; matches filename minus `.json`. |
| `chain` | string | yes | Chain slug — `eth` only for this dir. |
| `dexType` | string | yes | `v2` or `v3`. Selects the handler under test. |
| `tokenAddress` | string | yes | Launch ERC-20 (checksummed). Drives the fork buy. |
| `tokenSymbol` | string \| null | optional | On-chain symbol read from archive state at launch block. |
| `pairAddress` | string \| null | V2 | V2 pair contract (null for V3). |
| `poolAddress` | string \| null | V3 | V3 pool contract (null for V2). |
| `routerAddress` | string \| null | V2 | Uniswap V2 router `0x7a25…488D`. |
| `swapRouterAddress` | string \| null | V3 | Uniswap V3 SwapRouter02-era router. |
| `quoterAddress` | string \| null | V3 | Uniswap V3 QuoterV2. |
| `feeTier` | number \| null | V3 | 500 / 3000 / 10000. Non-null for the V3 fixture. |
| `pairCreatedBlock` | number | yes | Block of the `PairCreated`/`PoolCreated` event. |
| `mintBlock` | number \| null | yes (may be null) | Block of the first `Mint`. `null` ⇒ LP added beyond the capture lookahead (tracked below). |
| `firstSwapBlock` | number \| null | yes (may be null) | Block of the first `Swap`. `null` ⇒ first trade beyond lookahead (tracked below). |
| `forkBlockNumber` | number | yes | `pairCreatedBlock - 1` so the fork replays the launch as the next block. |
| `expectedVerdict` | string | yes | Always `"safe"` for this dir (hand-picked safe launches). |
| `expectedExitPath` | string | yes | Which engine exit branch the replay drives: `take-profit` \| `partial-sell` \| `trailing-stop`. |
| `discoveredVia` | string | yes | Provenance — `etherscan` for the captured set. |
| `discoveredOn` | string | optional | ISO date the fixture was captured. |
| `notes` | string | optional | Free-form: capture provenance, WETH-pairing, block-pin caveats. |

---

## V2 Fixtures

### `eth-v2-tp.json` — PEPE V2 launch (take-profit exit path)

| Property | Value |
|----------|-------|
| Token | PEPE (`0x6982508145454Ce325dDbE47a25d4ec3d2311933`) |
| Pair | `0xA43fe16908251ee70EF74718545e4FE6C5cCEc9f` |
| **PairCreated block** | **17046833** |
| Mint block | 17046833 (same block as PairCreated) |
| First Swap block | _null — first trade beyond the 50-block capture lookahead (tracked below)_ |
| Fork pin | 17046832 (`pairCreatedBlock - 1`) |
| Exit path under test | **take-profit** (price pumped to a partial/TP multiple) |

PEPE is an established, liquid, tradeable launch (no tax surprises). Chosen as
the take-profit V2 exemplar.

### `eth-v2-partial.json` — MOG V2 launch (partial-sell exit path)

| Property | Value |
|----------|-------|
| Token | Mog (`0xaaeE1A9723aaDB7afA2810263653A34bA2C21C7a`) |
| Pair | `0xc2eaB7d33d3cB97692eCB231A5D0e4A649Cb539d` |
| **PairCreated block** | **17731591** |
| Mint block | _null — liquidity added in a separate tx > 50 blocks after pair creation (tracked below)_ |
| First Swap block | _null (tracked below)_ |
| Fork pin | 17731590 (`pairCreatedBlock - 1`) |
| Exit path under test | **partial-sell** (the Phase 10/14 revenue path — `PARTIAL_SELL_TARGETS` tier fires at a configured multiple) |

MOG is an established, liquid, tradeable launch. Chosen as the partial-sell V2
exemplar (a different engine branch than `eth-v2-tp`).

---

## V3 Fixtures

### `eth-v3-trailing.json` — PEPE V3 (10000 fee) launch (trailing-stop exit path)

| Property | Value |
|----------|-------|
| Token | PEPE (`0x6982508145454Ce325dDbE47a25d4ec3d2311933`) |
| Pool | `0xF239009A101B6B930A527DEaaB6961b6E7deC8a6` (fee 10000) |
| **PoolCreated block** | **17063792** |
| Mint block | 17063792 (same block as PoolCreated) |
| First Swap block | **17063794** (full launch lifecycle resolved) |
| Fork pin | 17063791 (`poolCreatedBlock - 1`) |
| Fee tier | **10000** |
| Exit path under test | **trailing-stop** (price pumped ≥ 2× to activate trailing, then dropped to trigger the trailing stop) |

The PEPE 1% (fee=10000) V3 pool is the V3 DEX exemplar (D-FIXTURE-DEX V2+V3
spread). Its full launch lifecycle (`PoolCreated` → `Mint` → first `Swap`)
resolved cleanly during capture.

---

## How to Add a New Fixture

1. **Source discovery.** Hand-pick a historical ETH launch known to be safe +
   tradeable at its launch block (real liquidity, no tax surprises) so the
   replay's buy lands and the full lifecycle runs (D-FIXTURE-SELECTION). NOT
   auto-discovery (it would discard many honeypot/dead-LP launches first).
2. **Find the launch block.** The robust free-tier method is a `getCode` binary
   search on the pair/pool address (no `eth_getLogs` window limit):
   `getPair(token, WETH)` / `getPool(token, WETH, fee)` to get the address, then
   binary-search the first block where `getCode(addr, block)` is non-empty.
3. **Capture.** Run the recorder (the archive RPC must serve historical
   `getLogs`):
   ```
   npx ts-node scripts/capture-launch.ts <tokenAddress> --dex v2|v3 \
       --block <launchBlock> [--fee 500|3000|10000] --slug <name> \
       --exit-path take-profit|partial-sell|trailing-stop
   ```
   It writes `<slug>.json` here with `forkBlockNumber = launchBlock - 1`. On a
   free-tier key keep the implicit `--window 10`; supply `--block` within ~5
   blocks of `PairCreated`.
4. **JSON parse check.**
   `node -e "JSON.parse(require('fs').readFileSync('PATH','utf8'))"`.
5. **Test wiring.** Add (or extend) the matching `it(...)` entry in
   `test/fork/realLaunchReplay.fork.test.ts`. **Removal-pairing rule:** deleting
   a fixture JSON file MUST be paired with removing its test entry, or the fork
   suite fails to start (it reads each fixture by name in a static table).

---

## Outstanding Block-Pin Verification

Per the Phase 18/19 `null`-block-pin tracking precedent, every fixture with a
`null` block field has a follow-up entry. None of these `null`s block the replay
(they are informational launch-lifecycle metadata; the load-bearing pin is
`forkBlockNumber`/`pairCreatedBlock`, which are resolved for all three). They are
tracked for completeness.

> **Note:** the dominant outstanding item for this dir is NOT a block pin — it is
> the **STOP-THE-LINE `isBlacklistedTokenForChain` blocker** documented at the
> top of this file, which prevents the buy+sell assertions from being enabled.
> That is escalated to decimal phase 21.1.

| Fixture | Field(s) `null` | Follow-up | Owner | Next Step |
|---------|-----------------|-----------|--------|-----------|
| `eth-v2-tp.json` | `firstSwapBlock` | Resolve the first PEPE/WETH V2 swap block | @jackcutrara | Re-run `capture-launch.ts` with a PAYG `CAPTURE_ARCHIVE_RPC_URL` (wider getLogs window) OR widen `MAX_LOOKAHEAD_CHUNKS`; the first trade was > 50 blocks after `PairCreated`. Informational only — the replay drives price action itself. |
| `eth-v2-partial.json` | `mintBlock`, `firstSwapBlock` | Resolve MOG's LP-add (`Mint`) + first swap blocks | @jackcutrara | MOG liquidity was added in a separate tx > 50 blocks after pair creation. Re-capture with a wider window/PAYG key. Informational only. |
| `eth-v3-trailing.json` | — (fully resolved) | — | — | — |

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
  (`:502`), the handlers the replay exercises.
- `src/exitEngine.ts` — `startExitMonitor` / `executeFullSell` /
  `executePartialSell`, the exit branches the fixtures target.
- `src/chainRegistry.ts` (ETH template) — canonical router / quoter / WETH
  addresses recorded in the fixtures.

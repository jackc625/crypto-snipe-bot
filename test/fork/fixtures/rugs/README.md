# Phase 19 — Anti-Rug Fork Test Fixtures

Pinned-block real-mainnet rug-pull fixtures consumed by
`test/fork/antiRugDetector.fork.test.ts` (created in plan 19-07, Phase 19
Wave 6). Each JSON file pins one historical rug-pull to a specific
mainnet block at which the LP-removal event was emitted. The fork-test
suite spins up a Hardhat mainnet fork at `forkBlockNumber` (one block
before `lpRemovalBlock`), injects a synthetic bot position on the
pair/pool via a faked `lp_baseline` snapshot, advances the chain to
replay `lpRemovalBlock`, and asserts `evaluateRugSignals` returns the
expected `RugEvaluation` verdict + the three expected signal trips.

This directory parallels `test/fork/fixtures/honeypots/` (Phase 18,
D-FIXTURE). The contrived `test/fixtures/contracts/RugPull.sol`
5-mode fixture is the controlled-repeatable half — together they catch
both real-world idiosyncrasies AND every deterministic verdict branch.

---

## JSON Schema

The rug fixture schema **extends** the Phase 18 honeypots schema with
rug-specific fields (`pairAddress`, `lpAddBlock`, `lpRemovalBlock`,
`lpRemovalTxHash`, `destinationOnBurn`, `expectedSignals`). V3-only
fields (`poolAddress`, `quoterAddress`, `nonfungiblePositionManager`,
`destinationOnCollect`) are populated when `dexType === "v3"` and
null/omitted for V2.

```json
{
  "slug": "eth-v2-horse",
  "chain": "eth",
  "dexType": "v2" | "v3",
  "tokenAddress": "0x...",
  "tokenSymbol": "HORSE",
  "pairAddress": "0x...",           // V2 only
  "poolAddress": "0x...",           // V3 only
  "routerAddress": "0x...",         // V2 only
  "swapRouterAddress": "0x...",     // V3 only
  "quoterAddress": "0x...",         // V3 only
  "nonfungiblePositionManager": "0x...",  // V3 only
  "feeTier": 3000,                  // V3 only
  "lpAddBlock": 18401564,
  "lpRemovalBlock": 18401609,
  "lpRemovalTxHash": "0xed945fa...",
  "removalTxHash": "0x...",         // V3 alias of lpRemovalTxHash
  "forkBlockNumber": 18401608,
  "destinationOnBurn": "0x...",
  "destinationOnCollect": "0x...",  // V3 only
  "expectedVerdict": "unsafe",
  "expectedSignals": {
    "lpRemovedPct": ">99",
    "allowlistHit": "unsafe",
    "v2ReservePctBelow": ">99",     // V2 only
    "sellSimSlippagePct": ">50"     // V3 only
  },
  "bugPattern": "lp-removal-no-allowlist",
  "discoveredVia": "medium-article" | "honeypot.is" | "dex-screener" | "etherscan",
  "discoveredOn": "2026-05-23",
  "notes": "..."
}
```

| Field                          | Type             | Required          | Description                                                                                                                                       |
| ------------------------------ | ---------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slug`                         | string           | yes               | Filename-safe slug, e.g. `eth-v2-horse`. Matches filename minus `.json`.                                                                          |
| `chain`                        | string           | yes               | Chain slug — `eth`, `bsc`, `base`, `arb`. Matches `chainRegistry.ts` keys.                                                                        |
| `dexType`                      | string           | yes               | `v2` or `v3`. Discriminator that selects the detector path under test.                                                                            |
| `tokenAddress`                 | string \| null   | yes (may be null) | Rug-pull ERC20 token address. `null` ⇒ Wave-1 follow-up task open.                                                                                |
| `tokenSymbol`                  | string           | optional          | Human-readable symbol for log narration.                                                                                                          |
| `pairAddress`                  | string           | V2 only           | V2 pair contract address. The detector subscribes by this address.                                                                                |
| `poolAddress`                  | string \| null   | V3 only           | V3 pool contract address. Null when token + feeTier is the discovery path.                                                                        |
| `routerAddress`                | string           | V2 only           | V2 router (Uniswap V2 mainnet: `0x7a25…488D`).                                                                                                    |
| `swapRouterAddress`            | string           | V3 only           | V3 SwapRouter02 (ETH: `0x68b3…Fc45`).                                                                                                             |
| `quoterAddress`                | string           | V3 only           | V3 QuoterV2 (ETH: `0x61fF…B21e`). Consumed by signal-3 sell-sim.                                                                                  |
| `nonfungiblePositionManager`   | string           | V3 only           | V3 NPM contract (ETH: `0xC364…FE88`). Informational; not consumed by detector.                                                                    |
| `feeTier`                      | number           | V3 only           | 500 / 3000 / 10000.                                                                                                                               |
| `lpAddBlock`                   | number \| null   | optional          | Block at which liquidity was added (pre-rug baseline anchor).                                                                                     |
| `lpRemovalBlock`               | number \| null   | yes (may be null) | The fixture target — block at which the LP-removal event fires. `null` ⇒ Wave-1 backfill.                                                         |
| `lpRemovalTxHash`              | string \| null   | optional          | Etherscan-linkable tx hash. V3 fixtures may alias this as `removalTxHash`.                                                                        |
| `forkBlockNumber`              | number \| null   | yes (may be null) | Pre-rug fork pin (typically `lpRemovalBlock - 1`). `null` ⇒ block-pin pending.                                                                    |
| `destinationOnBurn`            | string \| null   | optional          | Address that received the burn (V2 Burn `to` / V3 Burn `owner`).                                                                                  |
| `destinationOnCollect`         | string \| null   | V3 only           | V3 Pool.Collect `recipient` field (owner-only check per D-V3-ALLOWLIST).                                                                          |
| `expectedVerdict`              | string           | yes               | Always `"unsafe"` for fixtures in this directory.                                                                                                 |
| `expectedSignals.lpRemovedPct` | string \| number | yes               | Expected signal-1 trip magnitude. String like `">99"` allows tolerance; number is exact.                                                          |
| `expectedSignals.allowlistHit` | string           | yes               | Expected signal-2 verdict (`"unsafe"` = NOT allowlisted; `"safe"` = allowlisted; `"unknown"` = no destination resolvable).                        |
| `expectedSignals.v2ReservePctBelow` | string \| number | V2 only      | Expected signal-3 trip (reserves below threshold %).                                                                                              |
| `expectedSignals.sellSimSlippagePct` | string \| number | V3 only    | Expected signal-3 trip (QuoterV2 sell-sim slippage %).                                                                                            |
| `bugPattern`                   | string           | yes               | `lp-removal-no-allowlist` (V2) \| `v2-transfer-to-dead` \| `v3-decrease-liquidity-then-collect` \| `v3-decrease-liquidity-no-collect`.            |
| `discoveredVia`                | string \| null   | yes (may be null) | `medium-article` \| `honeypot.is` \| `dex-screener` \| `etherscan` \| `tg-research`. Provenance source.                                            |
| `discoveredOn`                 | string \| null   | optional          | ISO date the fixture was added.                                                                                                                   |
| `notes`                        | string           | optional          | Free-form context: original source link, observed behavior, block-pin caveats, operator-backfill instructions.                                    |

---

## V2 Fixtures

### `eth-v2-horse.json` — HORSE token V2 rug (PRIMARY V2 fixture)

| Property | Value |
|----------|-------|
| Token | HORSE (token address resolved at fork-test run time per the notes field) |
| Pair address | `0x77A838d43Aa717b5C0eEd82E3A3078560e9429b3` |
| LP-add block | 18401564 |
| **LP-removal block** | **18401609** |
| LP-removal tx | `0xed945fa47225956c7dfdd7ec29fb4201f7a914bbdad2f81a7903f4726ebf3952` |
| Fork pin | 18401608 (one block before removal) |
| Pool lifespan | <10 minutes (100% rug shortly after LP add) |
| Source | [19-RESEARCH.md §4.1 candidate A](../../../.planning/phases/19-anti-rug-runtime-monitoring/19-RESEARCH.md) — Medium article citation |

**Use:** the fork test loads this JSON, fork-pins to `forkBlockNumber`,
injects a synthetic bot position via a faked `lp_baseline` snapshot on
the pair, advances the chain to replay `lpRemovalBlock`, asserts
`evaluateRugSignals` returns
`verdict='unsafe'` + `signals: { lpRemovedPct: >99, allowlistHit: 'unsafe', v2ReservePctBelow: >99 }`.

`tokenAddress` and `destinationOnBurn` are intentionally `null` in the
shipped fixture — the fork test resolves them by reading
`provider.getTransactionReceipt(lpRemovalTxHash)` at run time:
- The Burn event payload's `to` topic (topic[2]) decodes to the scammer
  destination (expected suffix `…33b03A`).
- The pair contract's `token0()` / `token1()` view functions identify
  the HORSE token (whichever side is not WETH
  `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`).

This run-time-resolution pattern is the most reproducible path
(no external API key or browser session required) and matches the Phase
18 D-FIXTURE null-block-pin precedent. See the fixture's `notes` field
for the alternative resolution paths (Etherscan-via-browser, Etherscan
API) per Plan 19-07 PLAN Step 2.

---

## V3 Fixtures

### `eth-v3-CANDIDATE.json` — V3 rug fixture SKELETON (Wave-1 backfill)

V3 rug fixtures are **significantly harder to source** than V2 — V3 rugs
are less common in the wild, V3 "rug" patterns are slow-rug (multi-tx
`decreaseLiquidity` + `collect`), and public databases focus on V2.

This file ships as a **schema skeleton** with the canonical V3
contracts pre-populated (SwapRouter02, QuoterV2, NonfungiblePositionManager)
but `tokenAddress: null`, `poolAddress: null`, `lpRemovalBlock: null`,
`forkBlockNumber: null` — pending Wave-1 follow-up during the 7-day
dry-run window.

The contrived `RugPull.sol` V3 modes (3 = v3-burn-collect; 4 = v3-burn-only)
cover the V3 detector branches in `test/fork/antiRugDetector.fork.test.ts`
while the real fixture is being resolved — same fallback pattern as
Phase 18.

### Wave-1 V3 Backfill Tracker

| Slug | `tokenAddress` resolved | `poolAddress` resolved | `forkBlockNumber` pinned | Owner | Status |
|------|-------------------------|-------------------------|---------------------------|--------|--------|
| `eth-v3-CANDIDATE` | ❌ | ❌ | ❌ | @jackcutrara | Pending Wave-1 |

Once a fixture's data is resolved live, edit the JSON file in-place — set
`tokenAddress`, `poolAddress`, `lpAddBlock`, `lpRemovalBlock`,
`removalTxHash`, `forkBlockNumber`, `destinationOnBurn`,
`destinationOnCollect`, `discoveredVia`, `discoveredOn` to the resolved
values, and update the row above to `✅` per field with the resolved
value or commit hash. Commit message convention:
`chore(19-07): resolve V3 rug fixture block-pin for {fixture-filename}`.

---

## How to Add a New Fixture

1. **Source discovery.** Use one of:
   - **V2:** browse rug-tracking medium posts / honeypot.is rug feed /
     DEX Screener "graveyard" filter (pools with `liquidity < $1000` created
     from a one-time Mint and now-zeroed liquidity).
   - **V3:** honeypot.is V3 API (`/api/v2/ethereum?filter=v3` per
     19-RESEARCH.md §4.2) / DEX Screener V3 graveyard / TG research channels.
2. **Block-pin selection.** Find the LP-removal block (`lpRemovalBlock`).
   The `forkBlockNumber` MUST be `lpRemovalBlock - 1` so the fork
   replays the removal txn as the next block. Caveat: a pre-rug pool
   with extremely low liquidity at the pin block will produce
   `INSUFFICIENT_LIQUIDITY`-style noise instead of cleanly exercising
   the multi-signal AND chain — verify the pool has meaningful reserves
   at `forkBlockNumber` before pinning.
3. **Destination identification.** At `lpRemovalBlock`, the LP-removal
   tx's `Burn` event payload's `to` topic (V2) or `owner` topic (V3)
   reveals the destination. Use `cast logs --rpc-url <alchemy>` or
   spin up a local fork via `hardhat node --fork` and call
   `provider.getTransactionReceipt(lpRemovalTxHash)` to extract.
4. **expectedSignals pre-population.** Run the detector against the
   fork once to capture the actual `lpRemovedPct`, `v2ReservePctBelow`,
   and `sellSimSlippagePct` numbers, then encode them as `">N"` strings
   (preserving tolerance) or exact numbers in the fixture.
5. **Schema.** Create a new JSON file in this directory matching the
   schema above. Run the JSON parse check
   (`node -e "JSON.parse(require('fs').readFileSync('PATH','utf8'))"`).
6. **Test wiring.** After plan 19-07 lands, add a matching `it(...)`
   block (or extend the existing `describe.each(...)` table) in
   `test/fork/antiRugDetector.fork.test.ts`. **Removal note:** deleting
   a fixture JSON file MUST be paired with removing its test entry,
   otherwise the test suite will fail to start.

---

## Outstanding Block-Pin Verification

Per Phase 18 precedent (D-FIXTURE null-block-pin tracking), every
fixture with a `null` block-pin or address field has a Wave-1
follow-up entry below. Fork-test wiring in plan 19-07 skips
null-block fixtures gracefully via the contrived `RugPull.sol` V3
mode fallback (`describe.each([0, 1, 2, 3, 4])`) so the suite is not
blocked on these resolutions.

| Fixture | Field(s) Pending | Wave-1 Follow-up Task | Owner | Next Step |
|---------|------------------|------------------------|--------|-----------|
| `eth-v2-horse.json` | `tokenAddress`, `destinationOnBurn` | Resolve at fork-test run time via `provider.getTransactionReceipt(lpRemovalTxHash)` | @jackcutrara | Run `npm run test:fork -- antiRugDetector` against operator's Alchemy archive RPC; the fork test extracts both values from the receipt logs and bakes them into the fixture JSON if absent. Alternatively, browse Etherscan tx `0xed945fa472…ebf3952` Token Transfers tab manually. |
| `eth-v3-CANDIDATE.json` | `tokenAddress`, `poolAddress`, `lpAddBlock`, `lpRemovalBlock`, `removalTxHash`, `forkBlockNumber`, `destinationOnBurn`, `destinationOnCollect` | Discover a real V3 rug during the 7-day dry-run window via honeypot.is V3 feed OR DEX Screener V3 graveyard | @jackcutrara | (1) Poll honeypot.is V3 API for `rugged_status` flagged tokens. (2) Pick one with verifiable LP-removal tx hash on Etherscan. (3) Pin `forkBlockNumber = lpRemovalBlock - 1`. (4) Edit this fixture in-place and update the Wave-1 tracker table. |

---

## See Also

- `test/fixtures/contracts/RugPull.sol` — contrived 5-mode rug-pull
  fixture (D-LIST-FIXTURE controlled half).
- `test/fork/fixtures/honeypots/README.md` — Phase 18 sibling schema doc;
  the rugs schema extends it.
- `.planning/phases/19-anti-rug-runtime-monitoring/19-RESEARCH.md` §4
  "Real-Mainnet Historical Rug Fixtures" — candidate sources + V3
  discovery paths.
- `.planning/phases/19-anti-rug-runtime-monitoring/19-PATTERNS.md`
  §"test/fork/fixtures/rugs/README.md" — schema reference.
- `src/chainRegistry.ts` (ETH) — canonical router / quoter / NPM
  addresses used in fixtures.
- `src/anti-rug/detector.ts` — `evaluateRugSignals` evaluator the fork
  tests assert against.

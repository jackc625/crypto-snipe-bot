# Honeypot Fork Fixtures

Pinned-block real-mainnet honeypot fixtures consumed by
`test/fork/honeypotChecker.fork.test.ts` (created in plan 18-09, Phase 18
Wave 2). Each JSON file pins one historical honeypot token to a specific
mainnet block at which the honeypot pattern was the **active failure
mode** — not the post-rug or post-LP-pull state. The fork-test suite
spins up a Hardhat mainnet fork at `forkBlockNumber`, attempts a buy →
sell roundtrip via the deployed `HoneypotChecker.sol`, and asserts the
verdict matches `expectedVerdict` + the revert message contains
`expectedRevertContains`.

This directory is the D-FIXTURE "real fixture" half of the strategy
(`.planning/phases/18-honeypot-detection-rebuild/18-CONTEXT.md` §"Test
fixture strategy"). The contrived 5-mode fixture
(`test/fixtures/contracts/Honeypot.sol`) is the controlled-repeatable
half — together they catch both real-world idiosyncrasies and every
deterministic verdict branch.

---

## JSON Schema

All fixtures share a single schema. V3-only fields (`quoterAddress`,
`feeTier`) are populated when `dexType === "v3"` and omitted/null for
V2.

```json
{
  "chain": "eth",
  "dexType": "v2" | "v3",
  "tokenAddress": "0x...",
  "pairAddress": "0x...",
  "routerAddress": "0x...",
  "quoterAddress": "0x...",
  "feeTier": 3000,
  "forkBlockNumber": 18500000,
  "expectedVerdict": "unsafe",
  "expectedRevertContains": "BUY_BAL_ZERO",
  "bugPattern": "sell-revert" | "max-wallet" | "v3-sell-tax-spike",
  "notes": "...",
  "discoveredVia": "honeypot.is" | "etherscan",
  "discoveredOn": "2026-05-15"
}
```

**13 fields total** (the original 11 from RESEARCH.md §3 + `dexType` +
`quoterAddress` + `feeTier`):

| Field                    | Type             | Required          | Description                                                                                                                    |
| ------------------------ | ---------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `chain`                  | string           | yes               | Chain slug — `eth`, `bsc`, `base`, `arb`. Matches `chainRegistry.ts` keys.                                                     |
| `dexType`                | string           | yes               | `v2` or `v3`. Discriminator that selects the simulation path (V2 router vs V3 SwapRouter02 + QuoterV2).                        |
| `tokenAddress`           | string \| null   | yes (may be null) | Honeypot ERC20 token address. `null` ⇒ Wave-1 follow-up task open.                                                             |
| `pairAddress`            | string \| null   | optional          | V2 pair address (V2 only). V3 fixtures derive the pool from token + WETH + feeTier.                                            |
| `routerAddress`          | string           | yes               | V2 = `0x7a25…488D`; V3 = `0x68b3…Fc45` (SwapRouter02). Matches `chainRegistry.ts` per-DEX entry.                                |
| `quoterAddress`          | string           | V3 only           | V3 QuoterV2 (`0x61fF…B21e` on ETH). Omit/null for V2.                                                                          |
| `feeTier`                | number           | V3 only           | 500 / 3000 / 10000. Omit/null for V2.                                                                                          |
| `forkBlockNumber`        | number \| null   | yes (may be null) | Mainnet block at which the honeypot was the **active failure mode**. `null` ⇒ block-pin pending Wave-1 follow-up.              |
| `expectedVerdict`        | string           | yes               | Always `"unsafe"` for fixtures in this directory.                                                                              |
| `expectedRevertContains` | string           | yes               | Substring expected in the revert payload from `HoneypotChecker.sol`. Examples: `BUY_BAL_ZERO`, `TRANSFER_FROM_FAILED`.         |
| `bugPattern`             | string           | yes               | `sell-revert`, `max-wallet`, `lying-balanceOf`, `silent-zero-eth`, `v3-sell-tax-spike`, `amount-tiered-tax`.                    |
| `notes`                  | string           | optional          | Free-form context: original honeypot.is/Etherscan link, observed behavior, block-pin caveats.                                  |
| `discoveredVia`          | string           | yes               | `honeypot.is` \| `etherscan`. Provenance source.                                                                                |
| `discoveredOn`           | string           | yes               | ISO date the fixture was added.                                                                                                |

---

## V3 Fixtures

Per iter-2 Blocker #1, Phase 18 ships V3 in scope. V3 fixtures differ
from V2 in three ways:

1. `dexType: "v3"`.
2. `routerAddress` is the V3 SwapRouter02
   `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` (from `chainRegistry.ts`
   ETH `uniswap-v3.swapRouterAddress`).
3. `quoterAddress` is populated with the V3 QuoterV2
   `0x61fFE014bA17989E743c5F6cB21bF9697530B21e`; `feeTier` is one of
   `500` (0.05%), `3000` (0.3%), or `10000` (1%).

V3 fixtures are routed through `simulateHoneypotRoundtripV3` in plan
18-09 Wave 5. The fork test suite uses the V3 QuoterV2 for the
`quoteExactInput` leg and the V3 SwapRouter02 `exactInputSingle` for
the buy → sell roundtrip.

If a real-mainnet V3 honeypot fixture cannot be resolved cleanly at
authoring time (Wave-1 follow-up policy), plan 18-09 V3 Integration
Test 4 already has a `Honeypot.sol` V3-mode contrived fallback so the
fork suite is not blocked on this fixture's resolution.

---

## How to Add a New Fixture

1. **Source discovery.** Use one of:
   - [honeypot.is](https://honeypot.is/ethereum) — filter by chain, scan
     the public confirmed-honeypot feed.
   - [Etherscan](https://etherscan.io) — search "honeypot" on Token
     pages; cross-reference the address's transaction history for
     sell-revert / max-wallet evidence.
2. **Block-pin selection.** Find the block at which the honeypot was
   the **active failure mode** — i.e., the bytecode is deployed, the
   WETH-paired pool has non-zero liquidity, AND the revert path is
   reachable. Caveat from RESEARCH.md §3 line 640:
   > Pin to a block where the honeypot was the *active* failure mode,
   > not the post-rug state.
3. **Pool-liquidity check (V2).** At the pinned block, confirm the
   token / WETH pair on the named router has non-zero reserves
   (`getReserves()` on the pair address). A rugged pool produces an
   `INSUFFICIENT_LIQUIDITY` revert that masquerades as a honeypot
   signal — fixtures must isolate the honeypot behavior, not LP-pull.
4. **Pool-liquidity check (V3).** At the pinned block, confirm the
   QuoterV2 returns a non-zero `amountOut` for a 0.01 ETH `quoteExactInput`
   into the chosen `feeTier`. Empty V3 pools quote `0` and are
   indistinguishable from honeypots at the test level.
5. **Schema.** Create a new JSON file in this directory matching the
   schema above. Run the JSON parse check (any JSON-aware editor or
   `node -e "JSON.parse(require('fs').readFileSync('PATH','utf8'))"`).
6. **Test wiring.** After plan 18-09 lands, add a matching `.each()`
   entry to `test/fork/honeypotChecker.fork.test.ts`. **Removal note:**
   deleting a fixture JSON file MUST be paired with removing the
   matching `.each()` entry from the fork test, otherwise the test
   suite will fail to start.

---

## Outstanding Block-Pin Verification

Per iter-2 Warning #5, block-pin debt is tracked explicitly. Each
fixture below has `forkBlockNumber: null` pending live verification.
The Wave-1 follow-up tasks below are owned by the operator (Jack /
@jackcutrara) — fork-test wiring in plan 18-09 will skip null-block
fixtures gracefully via the contrived `Honeypot.sol` fallback so the
suite is not blocked on these resolutions.

| Fixture                  | Token Address                                  | Wave-1 Follow-up Task                                    | Owner          | Next Step                                                                                            |
| ------------------------ | ---------------------------------------------- | -------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------- |
| `eth-sell-revert.json`   | `0x80e4f014c98320eab524ae16b0aaf1603f4dc01d`   | Backfill `eth-sell-revert.json` block-pin                | @jackcutrara   | Query Etherscan tx history for first sell-revert tx; use block immediately prior as `forkBlockNumber`. |
| `eth-max-wallet.json`    | `0x34c6211621f2763c60eb007dc2ae91090a2d22f6`   | Backfill `eth-max-wallet.json` block-pin                 | @jackcutrara   | Query Etherscan tx history for first max-wallet-trap revert tx; pin to immediately prior block.        |
| `eth-v3-honeypot.json`   | TBD (none resolved at planner time)            | Resolve V3 candidate via honeypot.is /api/v2/ethereum?filter=v3, then backfill block-pin | @jackcutrara   | Poll honeypot.is V3 feed, pick active V3 honeypot, pin block where pool liquidity > 0 AND honeypot reverts. |

Once a fixture's block-pin is resolved live, edit the JSON file
in-place — set `tokenAddress` (V3 only; V2 addresses are already
filled), set `forkBlockNumber` to the resolved number, and remove the
matching row from this table. Commit message convention:
`chore(18-01): resolve block-pin for {fixture-filename}`.

---

## See Also

- `test/fixtures/contracts/Honeypot.sol` — contrived 5-mode fault-injection
  ERC20 (D-FIXTURE controlled half).
- `.planning/phases/18-honeypot-detection-rebuild/18-RESEARCH.md` §3
  "Real-Mainnet Honeypot Fixtures" — original schema rationale +
  candidate addresses.
- `.planning/phases/18-honeypot-detection-rebuild/18-PATTERNS.md`
  §"test/fork/fixtures/honeypots/README.md" — schema reference.
- `src/chainRegistry.ts` (ETH) — canonical router / quoter addresses
  used in fixtures.

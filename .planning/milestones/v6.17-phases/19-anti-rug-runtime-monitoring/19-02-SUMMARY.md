---
id: 19-02
phase: 19-anti-rug-runtime-monitoring
plan: 02
status: complete
date: 2026-05-23
requirements_addressed: [ANTIRUG-06, ANTIRUG-07, ANTIRUG-09, ANTIRUG-10, ANTIRUG-11, ANTIRUG-15]
commits:
  - 9b2ceba — test(19-02): add failing tests for ChainConfig.antiRug field + env overlay + allowlists
  - 76e0105 — feat(19-02): add ChainConfig.antiRug field + env overlay + hardcoded V2/V3 allowlists
  - 1f1dcab — feat(19-02): add REQUIRED_ENV_VARS entries + .env.example template for anti-rug
  - a1aad48 — feat(19-02): resolve D-V3-ALLOWLIST [USER-BINDING] Task 3 for ETH
key_files:
  modified:
    - src/chainRegistry.ts
    - src/config.ts
    - .env.example
    - .planning/REQUIREMENTS.md
  created:
    - test/unit/chainRegistry/antiRugConfig.test.ts
---

## What was built

Per-chain `antiRug` config surface for Phase 19, plus the per-chain V2 + V3 locker
allowlist constants, plus the operator-facing `.env.example` template. This is the
configuration foundation that every later anti-rug module reads.

### `ChainConfig.antiRug` shape

```typescript
interface AntiRugConfig {
    liveExecute: boolean;                  // default false → dry-run
    lpRemovalPct: number;                  // default 50 (signal-1 threshold)
    confirmBlocks: number;                 // default 1
    circuitBreakerTriggers: number;        // default 3
    circuitBreakerWindowHours: number;     // default 1
    gasMultiplier: number;                 // default 2.0
    backfillCapBlocks: number;             // default 10 ETH / 500 BSC/Base/Arb
    maxBackfillBlocks: number;             // default 7200 (~1 day on ETH)
    allowlistV2: AllowlistEntry[];         // merged: HARDCODED + env-overlay
    allowlistV3: AllowlistEntry[];         // merged: HARDCODED + env-overlay
}

interface AllowlistEntry {
    address: string;                       // ethers.getAddress checksummed
    lockerName: string;
    provenance: 'hardcoded' | 'env-overlay';
}
```

### Hardcoded V2 allowlist (HARDCODED_V2_ALLOWLIST)

| Chain | Address | Locker |
|-------|---------|--------|
| ETH | `0x59d7d55dDC58494fBbBcA29904f108EcE82AC7Fb` | Unicrypt UniLockerV2 ETH |
| ETH | `0xE2fE530C047f2d85298b07D9333C05737f1435fB` | TeamFinance / TrustSwap Lock ETH |
| ETH | `0x71B5759d73262FBb223956913ecF4ecC51057641` | PinkLock V2 ETH (PinkLock02) |
| ETH | `0x000000000000000000000000000000000000dEaD` | 0xdEaD burn |
| BSC | `0xC765bddB93b0D1c1A88282BA0fa6B2d00E3e0c83` | UNCX UniLockerV2 BSC |
| BSC | `0x407993575c91ce7643a4d4cCaCc9A98c36eE1BBE` | PinkLock V2 BSC |
| BSC | `0x000000000000000000000000000000000000dEaD` | 0xdEaD burn |
| Base | `0xED9180976c2a4742C7A57354FD39d8BEc6cbd8AB` | UNCX UniLockerV2 Base |
| Base | `0x000000000000000000000000000000000000dEaD` | 0xdEaD burn |
| Arb | `0x63F4B2C082B1E0bbA38874567E053800379bF8D7` | UNCX UniLockerV2 Arbitrum |
| Arb | `0x000000000000000000000000000000000000dEaD` | 0xdEaD burn |

All addresses cited from `19-RESEARCH.md` §2.1.

### Hardcoded V3 allowlist (HARDCODED_V3_ALLOWLIST)

| Chain | Address | Locker | Resolution |
|-------|---------|--------|------------|
| ETH | `0xFD235968e65B0990584585763f837A5b5330e6DE` | UNCX V3 Locker ETH (NFT-holding) | §2.2 hardcoded |
| ETH | `0xe2fe530c047f2d85298b07d9333c05737f1435fb` | TeamFinance Lock ETH (V2 + V3 unified proxy) | **Task 3 resolution** |
| BSC | `0xfe88DAB083964C56429baa01F37eC2265AbF1557` | UNCX V3 Locker BSC | §2.2 hardcoded |
| Base | `0x231278eDd38B00B07fBd52120CEf685B9BaEBCC1` | UNCX V3 Locker Base | §2.2 hardcoded |
| Arb | `0x6b5360B419e0851b4b81644e0F63c1A9778f2506` | UNCX V3 Locker Arbitrum | §2.2 hardcoded |
| Arb | `0xcb8B00D4018ad6031e28A44Bf74616014BFB62EC` | UNCX V3 "Proof of Reserves 2" Arbitrum (ANTIRUG-15) | §2.2 hardcoded |

## D-V3-ALLOWLIST [USER-BINDING] Task 3 resolution (2026-05-23)

The planner flagged TeamFinance V3 NFT vault + PinkLock V3 as Blocker 4 escalations
because WebFetch was blocked on team.finance and pinksale.finance docs. Task 3 paused
for operator decision. Operator chose "Yes — apply ETH-only resolution (Recommended)".

### TeamFinance V3 NFT vault → resolved as same proxy as V2

The existing TeamFinance proxy at `0xe2fe530c047f2d85298b07d9333c05737f1435fb` (already
in V2 allowlist) was upgraded to handle Uniswap V3 NonfungiblePositionManager NFTs
without changing the user-facing address. Reference: TrustSwap blog "Uniswap V3 is now
supported by Team Finance" (https://trustswap.com/blog/uniswap-v3/). The proxy is
Gnosis-admined; its implementation has been swapped over time to add V3 support. The
same address now appears in both `HARDCODED_V2_ALLOWLIST.eth` and
`HARDCODED_V3_ALLOWLIST.eth`.

### PinkLock V3 → verified non-existent on Ethereum mainnet

On-chain ABI inspection via Etherscan API on 2026-05-23 of both PinkLock contracts on
Ethereum mainnet:

- `0x71b5759d73262fbb223956913ecf4ecc51057641` (PinkLock02) — function list:
  `lock, unlock, editLock, vestingLock, multipleVestingLock, ...` — pure ERC20 LP-token
  locker. Zero V3/NFT signatures (no `lockNFT`, no `onERC721Received`, no `tokenId`).
- `0x33d4cc8716beb13f814f538ad3b2de3b036f5e2a` (older PinkLock) — same shape.

PinkSale's own documentation at https://docs.pinksale.finance/pinklock only references
V3 functionality on BSC, never on Ethereum mainnet. Web search 2026-05 found no
Ethereum-mainnet PinkLock V3 deployment. Conclusion: **no PinkLock V3 entry is needed
for ETH; this is not a gap — it's a verified absence.** Documented inline in
`src/chainRegistry.ts` as `// OPERATOR-VERIFIED-NO-PINKLOCK-V3-eth` with the
verification protocol so future maintainers can re-verify if PinkSale launches V3 ETH
support later.

### BSC / BASE / ARB (not enabled)

Operator decision deferred — these chains retain the original
`PHASE-19-BLOCKER-4-ESCALATION` comments. Plan 19-08 will surface them in the Wave-1
follow-up table; resolution required before any of these chains is enabled in
`ENABLED_CHAINS`.

## Env-var delta vs CONTEXT.md D-ENV-EXAMPLE (planner-flagged Warning 5)

CONTEXT.md `D-ENV-EXAMPLE` enumerated 7 envs per chain. Plan 19-02 ships **9 envs per
chain** (8 required + 1 optional `ALLOWLIST_EXTRA`). The two additions are:

- `<CHAIN>_ANTIRUG_BACKFILL_CAP_BLOCKS` — per-`getLogs`-call block-range cap; default
  10 on ETH (Alchemy free-tier safe per 19-RESEARCH.md CRITICAL #1), 500 on
  BSC/Base/Arb.
- `<CHAIN>_ANTIRUG_MAX_BACKFILL_BLOCKS` — hard ceiling on the backfill window before
  `[GAP DETECTED]` alert fires; default 7200 (~1 day on ETH).

Justification: 19-RESEARCH.md CRITICAL #1 documents the Alchemy free-tier 10-block
`getLogs` cap. Without these envs the operator cannot adjust the cap when upgrading to
a paid RPC tier. The delta is authorized under CONTEXT.md "Claude's Discretion" on
backfill window cap; the additions are uniformly applied across all 4 chains. Plan
19-08 (anti-rug-rollout.md operator handoff) must list 9 envs per chain, not 7.

## Decisions made on env-overlay validation edge cases

- **Duplicate addresses between hardcoded base and `_ANTIRUG_ALLOWLIST_EXTRA`:**
  accepted (`Set` deduplication is NOT applied — duplicates are kept in array form).
  Rationale: the same address appearing twice with different `lockerName` /
  `provenance` is informative (helps an operator audit-trail their overlay choices);
  the runtime check (Plan 19-03) treats the allowlist as a set when membership
  testing.
- **`liveExecute` strict-match policy:** ONLY the exact string `'true'` (lowercase)
  flips `liveExecute=true`. Any other value (`'TRUE'`, `'1'`, `'yes'`, empty,
  undefined) yields `false`. Rationale: avoids the legendary "I typed 1 instead of
  true and accidentally went live" failure mode; the only path to live execution is
  a deliberate `=true` write to `.env`.
- **`ALLOWLIST_EXTRA` parsing:** comma-separated; each entry passes through
  `ethers.getAddress(...)` which FATAL-exits on invalid checksums. Operator-supplied
  entries land in BOTH `allowlistV2` AND `allowlistV3` per CONTEXT.md `D-LIST-SOURCE`
  ("single overlay covering both pool types — operator simplicity").
- **Backfill range validation:** `MAX_BACKFILL_BLOCKS` must be `>=
  BACKFILL_CAP_BLOCKS` (otherwise an operator could set max=5, cap=10 and the
  bot would alert on every backfill). FATAL-exit on violation. `BACKFILL_CAP_BLOCKS
  > 100000` also FATAL-exits as a sanity ceiling.

## Verification

- `npm run test:unit -- chainRegistry/antiRugConfig`: **26/26 passing**
  (Task 1: 18, Task 2: 7, Task 3 additions: +1 Test 14b)
- `npm run test:unit` (full suite): **313/313 + 1 new = 314/314 passing** — zero
  regressions
- `npx tsc --noEmit` clean across all tsconfig projects
- `grep -c '_ANTIRUG_' .env.example`: **36** (≥ 32 required) ✓
- `grep -c '_ANTIRUG_' src/config.ts`: **36** (≥ 32) ✓
- All hardcoded V2/V3 allowlist addresses validate via `ethers.getAddress(...)` at
  module load (T-19-02-01 typo-catch mitigation)

## Hand-off

Plan 19-03 (`src/anti-rug/types.ts`, `events.ts`, `allowlist.ts`, `lpBaseline.ts`) is
unblocked — can import:
- `import type { AntiRugConfig, AllowlistEntry } from './chainRegistry'` (inline types
  here; Plan 19-03 will move them to `src/anti-rug/types.ts` and `chainRegistry.ts`
  will switch to the import-from-types path).
- `import { HARDCODED_V2_ALLOWLIST, HARDCODED_V3_ALLOWLIST } from './chainRegistry'`
  for the startup-time `getCode()` verification per D-LIST-VERIFY.

Plan 19-05 (`exitTrigger.ts`) is unblocked — can read `ctx.chain.antiRug.liveExecute`
for the dry-run gate.

Plan 19-08 (anti-rug-rollout.md) follow-up table must list:
- 9 envs per chain (not 7) — `BACKFILL_CAP_BLOCKS` + `MAX_BACKFILL_BLOCKS` are
  additions vs original D-ENV-EXAMPLE
- BSC/BASE/ARB V3 allowlist resolution as pending pre-enable work
- `live-flip` protocol: `<CHAIN>_ANTIRUG_LIVE_EXECUTE=true` only after 7-day dry-run
  with 0 confirmed false positives per D-LIVE-GATE

## Deviations from plan

- Task 1 Test 18 (checksum validation) — same as plan, no deviation.
- Task 2 produced 9 envs/chain (not 7 per D-ENV-EXAMPLE) — Warning 5 acknowledgment
  per planner; justified by RESEARCH CRITICAL #1.
- Task 3 [USER-BINDING] resolved with operator's explicit ETH-only decision:
  TeamFinance V3 = V2 proxy (TrustSwap blog citation), PinkLock V3 = verified
  non-existent (Etherscan API ABI inspection). BSC/Base/Arb deferred as Plan 19-08
  follow-up because those chains are not in ENABLED_CHAINS.
- One additional test (Test 14b — guard against accidental PinkLock V3 ETH re-add)
  was added beyond the 25 enumerated, mirroring Test 18's defensive style.

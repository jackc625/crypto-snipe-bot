# STOP-THE-LINE 01 — V3 buy path blocked by V2-only transfer-tax gate

**Status:** OPEN — escalated to phase **21.1** (operator decision 2026-05-26).
**Severity:** HIGH — production bug on the funded mainnet bot.
**Surfaced by:** Plan 21-03 (EXIT-LIVE-09 real-launch regression net), V3 fixture replay.
**Governing decision:** D-STOP-THE-LINE — "any bug surfaced during a capture or
fixture replay BLOCKS phase close and escalates to a new requirement / decimal
phase 21.1 — not fix-in-flight, not file-and-defer."

## What is broken

Every Uniswap **V3** buy is aborted at the transfer-tax safety gate. The bot
cannot snipe any V3 token.

## Verified root cause

`hasHighTransferTaxForChain(ctx, dexRouter, token)` (`src/utils/tokenSafety.ts:482`)
constructs a contract with the **V2 Router ABI** and calls **V2-only** methods
(`getAmountsOut`, `swapExactETHForTokens`).

- V2 buy path — `src/bot.ts:303` — passes `dex.routerAddress` (the V2 router, which
  has those methods) → works.
- V3 buy path — `src/bot.ts:610` (call at ~617) — passes `dex.swapRouterAddress`
  (the **V3 SwapRouter**, which has **no** `getAmountsOut`) → the call reverts →
  the function's `catch` returns `true` (fail-closed `hasTax = true`) → the V3 buy
  is aborted with a spurious "high transfer tax."

Pre-existing (not introduced by Phase 21). Verified two independent ways by the
21-03 executor; corroborated by the orchestrator by reading the call sites +
function body.

## Impact

- The funded bot silently cannot trade any Uniswap V3 token (it always reports
  high-tax and skips). V2 sniping is unaffected.
- Phase 21 cannot be marked **complete** until this is resolved (D-STOP-THE-LINE).
- The 21-07 real-capital capture / 21-06 rehearsal use a hand-picked established
  **V2** token (per D-CHAIN-SINGLE-ROUNDTRIP / D-CAPTURE-METHOD), so they are NOT
  blocked by this bug — but the bug still blocks phase close.

## What 21.1 must do

1. Decide the correct V3 transfer-tax approach. Candidates:
   - **Remove** the V2-style `hasHighTransferTaxForChain` call from the V3 bank
     (`bot.ts:~617`). The on-chain V3 honeypot roundtrip sim
     (`simulateHoneypotRoundtrip`, `bot.ts:459`) is documented as the authoritative
     honeypot/tax gate for V3 (see the comment at `bot.ts:603-605`), making the
     V2-style check redundant **and** broken on V3.
   - OR implement a **V3-aware** tax check via QuoterV2 (`quoteExactInputSingle`),
     mirroring the V2 expected-vs-actual ratio but with V3 quoting.
2. Apply the fix to `src/bot.ts` (and `src/utils/tokenSafety.ts` if a V3 helper is
   added), with a unit/fork test proving a V3 buy now passes the gate for a benign
   token and still fails closed on a real high-tax token.
3. Update `test/fork/realLaunchReplay.fork.test.ts`: the V3 fixture
   (`eth-v3-trailing.json`) currently asserts the **blocked-at-gate** observable
   (documenting the bug). After the fix, flip it to assert the full
   validation→buy→exit→sell lifecycle like the V2 fixtures.

## Affected files

- `src/bot.ts` (~610-617, V3 buy bank) — the fix site.
- `src/utils/tokenSafety.ts:482` (`hasHighTransferTaxForChain`) — V2-only by design.
- `test/fork/realLaunchReplay.fork.test.ts` — V3 fixture asserts the bug today.
- `test/fork/fixtures/realLaunches/eth-v3-trailing.json` — the V3 replay fixture.

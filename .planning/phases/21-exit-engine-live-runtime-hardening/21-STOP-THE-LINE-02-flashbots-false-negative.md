# STOP-THE-LINE 02 — Flashbots bundle.wait() false-negative loses real positions

**Status:** OPEN — escalated to phase **21.1**.
**Severity:** CRITICAL — money/position-tracking bug on the funded mainnet bot.
**Surfaced by:** Plan 21-07 live-capture attempt (2026-05-26), the one real ETH buy.
**Governing decision:** D-STOP-THE-LINE (bug surfaced during the capture → escalate,
do not patch in-flight). This is the Flashbots submission leg the fork rehearsal
(21-06) explicitly could NOT test (a local fork has no Flashbots relay).

## What is broken

`FlashbotsMevStrategy.sendTransaction` (`src/utils/mevStrategies/flashbots.ts`)
reports a bundle as **not included even when it actually landed on-chain**, so the
caller (`handleNewPairForChain`) treats a SUCCESSFUL buy as a failure: the trade is
never recorded, the position is never registered, and the exit monitor never starts.
The bought tokens sit **untracked and unmonitored** in the wallet.

## Ground-truth evidence (from the live attempt)

- Bot log: 4× `Bundle not included in block 25182797..25182800` → `level:50 TX failed`
  for LADYS (`0x12970E6868f88f6557B76120662c1B3E50A646bf`).
- On-chain reality (the D-OP-DB-TRUTH check that exposed it): the wallet
  `0x46c6D387EAb1669307c33E6f60173ADEe9Da3A5C` **received 751,170,543 LADYS** and its
  ETH dropped ~0.003 (0.009142 → 0.006129). **The buy DID land** — the bot just didn't
  detect it.
- Net effect: a real on-chain buy that the bot believes failed → no `trades` row, no
  exit monitoring, funds in an unmanaged token.

## Root cause (for 21.1 to fix)

`flashbots.ts:54-114`:
1. `bundle.wait()` returns a `FlashbotsBundleResolution`; the code treats ONLY `=== 0`
   (`BundleIncluded`) as success and throws `Bundle not included` for everything else.
   It does NOT handle `2` (`AccountNonceTooHigh` → the nonce was already consumed, i.e.
   the tx is in) and does not reconcile a "not included" result against the **actual
   on-chain nonce / token balance**. A `bundle.wait()` that returns non-zero is NOT
   proof the tx didn't land — it must be confirmed against chain state.
2. The retry loop submits `nonce: baseNonce + attempt` (line 65). If attempt 0 lands but
   is misreported, later attempts reuse incrementing nonces — risking either a wasted
   retry or, worse, a **second real buy** (double-spend) before the loop gives up. (In
   this run only one buy landed, but the logic permits a double-spend.)

## What 21.1 must do

1. After `bundle.wait()` returns non-zero, **confirm against chain state before
   declaring failure**: re-read `getTransactionCount(wallet,'latest')` and/or check the
   bundle's tx hash receipt (`bundleTransactions[0].hash`). If the nonce advanced / the
   receipt exists, treat it as **included** and return the real hash (so the position is
   registered + monitored).
2. Make the retry nonce-safe: never resubmit a nonce that may already be mined; re-fetch
   the nonce each attempt and stop if it advanced.
3. Decide the policy for genuinely-not-included bundles at calm gas / low priority fee
   (the bundle may need a higher priority fee or coinbase bribe to be selected by
   builders) — but correctness of #1 is the blocker.
4. This must be fixed BEFORE re-attempting the 21-07 capture: the SELL leg uses the same
   `sendTransaction`, so a real sell could be misreported the same way, making the
   captured `amount_out` / bundle artifacts unreliable.

## Immediate operational impact (handled this session)

- The untracked LADYS position WAS recovered via a DIRECT (non-Flashbots) sell
  (`scripts/recover-sell-ladys.ts`) — public-mempool swap, sidesteps this bug.
  Recovery sell tx `0x424ed3e4ea2e81093694ecb7dafa301aa4184e696f59e80e430b72e786cc26c7`
  (block 25182862, SUCCESS); wallet restored to 0.009103 ETH, LADYS balance 0.
- No double-spend occurred (only one buy landed); no funds lost — net cost of the whole
  buy+recover round trip ≈ 0.00005 ETH (~$0.15) in Uniswap fees + recovery gas.

## Affected files

- `src/utils/mevStrategies/flashbots.ts` (`sendTransaction`, lines ~52-120) — the fix site.
- `src/bot.ts:398` (`handleNewPairForChain` buy call) + `src/exitEngine.ts`
  (`executeFullSell` sell call) — both consume this strategy and inherit the bug.

# Anti-Rug Rollout — Operator Handoff

> Authoritative reference for rolling Phase 19 anti-rug monitoring from dry-run to
> live on each chain. Per `D-OPERATOR-HANDOFF` (`.planning/phases/19-anti-rug-runtime-monitoring/19-CONTEXT.md`)
> and `D-LIVE-GATE` (7 calendar days dry-run minimum AND review of every observed
> dry-run trigger with 0 confirmed false-positives before flipping live).

**SAFETY DEFAULT: ALL chains ship with anti-rug in DRY-RUN MODE on first deploy.**
You explicitly flip per-chain `<CHAIN>_ANTIRUG_LIVE_EXECUTE=true` in `.env` and
restart the bot to graduate a chain to live exits. No global flag — every chain
graduates independently per `D-LIVE-PER-CHAIN`.

This document covers (in order): pre-flight env vars, bot restart procedure, dry-run
verification, live-mode flip procedure, circuit-breaker reset, troubleshooting, and
the Wave-1 V3 follow-up tracker.

See also: `docs/operations/anti-rug-tuning.md` (threshold-tuning protocol),
`.planning/phases/19-anti-rug-runtime-monitoring/19-RESEARCH.md` (technical detail),
and `docs/CONFIGURATION.md` (general env-var format reference).

---

## 1. Pre-flight — Required `.env` changes

Anti-rug introduces **9 env vars per chain × 4 chains = 36 env vars total**. All have
sensible defaults that ship in `.env.example`; you do not need to change them for
dry-run operation. You only edit them when graduating to live mode (the
`<CHAIN>_ANTIRUG_LIVE_EXECUTE` flag) or when tuning thresholds based on dry-run
telemetry (see `anti-rug-tuning.md`).

> **Note (env-var count delta vs original D-ENV-EXAMPLE):** The phase planning
> originally enumerated 7 envs per chain. Plan 19-02 added 2 more
> (`BACKFILL_CAP_BLOCKS` + `MAX_BACKFILL_BLOCKS`) to make the WebSocket
> reconnect+backfill path operable per `19-RESEARCH.md` CRITICAL #1 (Alchemy
> free-tier 10-block `getLogs` cap). The additions are authorized under
> `CONTEXT.md` "Claude's Discretion" on the backfill window cap.

### Env-var reference table

| Env Var (prefix `<CHAIN>_ANTIRUG_`) | Default | Description |
|---|---|---|
| `LIVE_EXECUTE` | `false` | Dry-run by default. Set strictly to the string `true` to enable live exits. Any other value (`TRUE`, `1`, `yes`, empty) defaults to `false` per the Plan 19-02 strict-match policy. |
| `LP_REMOVAL_PCT` | `50` | Signal 1: percent of baseline LP removed that trips threshold. |
| `CONFIRM_BLOCKS` | `1` | Number of blocks to wait after a confirmed signal before firing the exit. Adds reorg safety on reorg-volatile chains. |
| `CIRCUIT_BREAKER_TRIGGERS` | `3` | Number of anti-rug exits within the rolling window that trips the circuit breaker. |
| `CIRCUIT_BREAKER_WINDOW_HOURS` | `1` | Rolling window in hours over which `CIRCUIT_BREAKER_TRIGGERS` is counted. |
| `GAS_MULTIPLIER` | `2.0` | Multiplier applied to EIP-1559 fee fields when `reason='anti-rug'`. Default doubles the standard fee to outbid the rug-pull tx. |
| `BACKFILL_CAP_BLOCKS` | `10` (ETH) / `500` (BSC/Base/Arb) | Per-`getLogs`-call block range cap. ETH defaults to 10 for Alchemy free-tier safety; **upgrade Alchemy to Pay-As-You-Go and bump this to `2000+` before going live**. |
| `MAX_BACKFILL_BLOCKS` | `7200` | Hard ceiling on the backfill window (~1 day on ETH). If `currentBlock - lastSeenBlock > MAX_BACKFILL_BLOCKS`, the detector FAILS CLOSED with a `[GAP DETECTED]` alert (per `D-BACKFILL`). |
| `ALLOWLIST_EXTRA` | (empty) | Optional comma-separated extra V2+V3 locker checksummed addresses to add to the merged allowlist. Empty in normal operation. |

`<CHAIN>` is one of `ETH`, `BSC`, `BASE`, `ARB`. Each chain has its own set of nine
variables (e.g. `ETH_ANTIRUG_LIVE_EXECUTE`, `BSC_ANTIRUG_LP_REMOVAL_PCT`, etc.).

### Critical for ETH (Alchemy backfill cap)

Per `19-RESEARCH.md` CRITICAL #1: Alchemy free tier caps `eth_getLogs` at **10
blocks per query**. The shipped default `ETH_ANTIRUG_BACKFILL_CAP_BLOCKS=10` is
set for free-tier safety. If the bot is offline for more than ~10 blocks (~2
minutes on ETH), chunked iteration runs multiple small `getLogs` calls until the
gap is closed.

For production live mode, **upgrade Alchemy to Pay-As-You-Go** (unlimited
per-call) and bump the cap to `2000` or higher in `.env`. The downside of leaving
the cap at 10 in production: a 1-hour outage = 300 blocks = 30 sequential
`getLogs` calls. Each call is ~200 ms. Total backfill time ~6 s, bursty but
acceptable for dry-run. For live mode you want a higher cap.

### Critical for all chains (LIVE_EXECUTE strict match)

`<CHAIN>_ANTIRUG_LIVE_EXECUTE=true` is the **single on/off switch** for live
exits per chain. The validator at `src/chainRegistry.ts` accepts only the exact
string `true` (lowercase) — any other value defaults to `false` per Plan 19-02
to prevent the "I typed `1` instead of `true` and accidentally went live"
failure mode. The only path to live execution is a deliberate `=true` write to
`.env` followed by a bot restart.

---

## 2. Bot restart procedure post-`.env` changes

After any `.env` change to anti-rug variables (or any other env var):

```bash
# 1. Stop the bot cleanly
#    Ctrl+C in the bot terminal. The bot's SIGINT handler clears all exit
#    timers, destroys WS providers, closes the DB, and exits cleanly. If it
#    doesn't exit within 5 seconds, the force-exit safety net kicks in.

# 2. Verify the .env change took effect
grep ANTIRUG .env

# 3. Start the bot
npx ts-node src/bot.ts

# 4. Watch the startup logs for the per-chain allowlist verification block
#    Look for log lines with op='antirug.allowlist-verified' for each enabled
#    chain. Each chain dumps its merged allowlist (hardcoded base + env-overlay
#    extras) with the provenance tag and address checksums.
```

### Allowlist verification at startup (per `D-LIST-VERIFY`)

On every chain start, the bot calls `getCode()` against every allowlist address
(both hardcoded and env-overlay additions). If any address returns no code (an
EOA, which is wrong — lockers MUST be contracts), the bot **fatal-exits** with a
structured pino log naming the offending chain, address, and `lockerName`.

Recovery steps when allowlist verification fails:

1. Read the fatal log to identify the offending chain + address + `lockerName`.
2. Cross-verify the address against the canonical source — Unicrypt docs,
   Etherscan token-tag pages, PinkSale docs, or TrustSwap (TeamFinance) blog
   posts. The provenance tag on the failed entry tells you whether it came from
   the hardcoded base (`provenance: 'hardcoded'` — fix in
   `src/chainRegistry.ts` via PR) or your env overlay (`provenance:
   'env-overlay'` — fix in `.env`).
3. After the fix, restart the bot and re-verify the allowlist log.

The startup dump is visually verifiable — operators should scan the merged
allowlist block on each bot start before pressing enter on subsequent operations.

---

## 3. Per-chain verification protocol — dry-run mode

After `npx ts-node src/bot.ts` finishes startup with
`<CHAIN>_ANTIRUG_LIVE_EXECUTE=false` (the default), confirm dry-run is active
before assuming the bot is operating safely.

### Dashboard checks

- Open `http://localhost:8080` (or your configured `DASHBOARD_PORT`).
- The **Anti-Rug column** on the Overview positions table shows the
  `🟡 Dry-run` badge for every open position on this chain. (Pre-Phase-19
  positions without an `lp_baseline` row show `⚪ Unmonitored` — see Scenario D
  in §6.)
- The **Anti-Rug Monitor** tile (Overview, below the risk gauges) shows the
  chain group with `Dry-run events today: 0` initially. As dry-run triggers
  fire, the counter increments.
- The **WS-Health indicator** in the sidebar footer shows `🟢 Connected` for
  this chain.

### Log checks

- Run `grep 'antirug.dry-run' bot-logs/*.log` — returns nothing until a dry-run
  event actually fires.
- When a dry-run event fires you'll see one structured pino line with
  `op: 'antirug.dry-run.would-have-sold'` AND a Telegram alert prefixed with
  `[DRY-RUN] Anti-rug would-have-sold:` (note: brackets are part of the prefix).
- Run `grep "'anti-rug'" bot-logs/*.log` — should match only the dry-run log
  lines, NOT any line containing `Submitting exit sell via MEV-protected path`
  (that's the `executeFullSell` line at `src/exitEngine.ts:466`, which only
  fires in live mode).

### Confirming `executeFullSell` is NOT called during dry-run

The dry-run gate is in `src/anti-rug/exitTrigger.ts`:

```typescript
if (!ctx.chain.antiRug.liveExecute) {
    // ... emit dry-run alert + broadcast + return false
    return false;
}
// Live path: only reached when LIVE_EXECUTE=true
clearAllTimersForToken(ctx.chain.name, tokenAddress);
const success = await executeFullSell(ctx, dex, /* ... */ 'anti-rug', /* ... */);
```

If you ever see `[ANTI-RUG EXIT]` in your Telegram on a chain where
`LIVE_EXECUTE=false`, that is a bug — file an issue.

---

## 4. Per-chain verification protocol — live mode flip

This is the high-stakes operation. Read this section carefully.

### Prerequisites (per `D-LIVE-GATE` — ALL three required)

1. **7 calendar days minimum** in dry-run mode on this chain. The 7-day floor
   protects against early panic — short-term noise shouldn't push you to live.
2. **Review of every dry-run trigger** that fired during the window. Use the
   dashboard "Anti-Rug Monitor" tile + "Frontrun Outcome Distribution" panel +
   per-event detail modal. Every triggered evaluation should resolve to one of:
   real rug-pull (good — the bot would have saved you), allowlist suppression
   you reviewed and accepted (good — the bot correctly skipped), or false
   positive (BAD — you must resolve before flipping live).
3. **Zero confirmed false-positives** at flip time. If you have any unresolved
   false-positives, either tune the threshold (`anti-rug-tuning.md`) or add the
   destination address to `<CHAIN>_ANTIRUG_ALLOWLIST_EXTRA` (`.env`) and let
   another 7-day window elapse before retrying the flip.

If the 7-day window had **zero events** (no rugs observed on this chain), you
can still flip after the 7-day baseline — there were no FPs to review.

### Per-chain live flip procedure

```bash
# 1. Stop the bot cleanly
#    Ctrl+C — same as §2.

# 2. Edit .env — flip ONE chain at a time
#    Open .env in your editor and change:
#      ETH_ANTIRUG_LIVE_EXECUTE=false
#    to:
#      ETH_ANTIRUG_LIVE_EXECUTE=true
#    Save and close.

# 3. Verify the change
grep ETH_ANTIRUG_LIVE_EXECUTE .env
# Expected output: ETH_ANTIRUG_LIVE_EXECUTE=true

# 4. Restart the bot
npx ts-node src/bot.ts

# 5. Verify live mode is active
#    Dashboard: the "Anti-Rug" column on each ETH position now shows the
#    🟢 Live badge instead of 🟡 Dry-run.
#    Logs: every ETH position's allowlist verification block should now read
#    liveExecute=true on the per-chain antiRug config dump.
```

### Why one chain at a time

`D-LIVE-PER-CHAIN` is a deliberate safety contract. Per-chain graduation lets
you stage exposure — ETH first (most-observed network, most-mature MEV layer,
Alchemy-paid tier), then BSC, then Base, then Arbitrum, each after its own
7-day-AND-0-FP gate. Flipping all chains simultaneously is allowed by the
schema but operationally not advised.

### Rollback (per `D-LIVE-ROLLBACK`)

To revert a chain to dry-run, repeat the procedure with `=false` instead of
`=true`. SQLite-persisted state (open positions, `lp_baseline` rows,
`chain_state` rows) survives the restart. The bot resumes monitoring in dry-run
within ~30 s of the restart. Open positions get their badges flipped from
`🟢 Live` back to `🟡 Dry-run` at the next dashboard push.

There is NO hot-flip and NO code-level fallback flag — per
`D-LIVE-ROLLBACK`, the only legitimate path is `.env` edit + restart. This
preserves the git-history + `.env` audit trail.

---

## 5. Circuit-breaker reset procedure

The circuit breaker (`src/anti-rug/circuitBreaker.ts`, ANTIRUG-09) auto-disables
anti-rug for a chain after `N` triggers in `W` hours (defaults: N=3, W=1 via
`<CHAIN>_ANTIRUG_CIRCUIT_BREAKER_TRIGGERS` and `_WINDOW_HOURS`). The CB protects
against runaway misfires — three live exits in an hour likely means something
is wrong (the threshold is too aggressive, an allowlist entry is missing, etc.)
and the operator should review before resuming.

When tripped, three things happen simultaneously (per
`D-VIS-CB-TRIPPED`):

1. The dashboard renders a full-bleed red banner at the top of the Overview
   page:

   > **ANTI-RUG HALTED ON ETH — 3 triggers in last hour**
   > Anti-rug monitoring is paused on this chain. New positions will open without
   > anti-rug coverage until you review the triggers and reset the breaker.
   > [Click to review and reset]

2. A Telegram alert fires with the verbatim headline `[ANTI-RUG HALTED] ETH — 3
   triggers in last hour` plus the last 3 trigger details.

3. A pino fatal log line is emitted with `op: 'antirug.cb-tripped'` carrying the
   chain, trigger count, and rolling window.

### Primary reset procedure — dashboard modal flow

This is the operator path. The bot is still running; anti-rug monitoring on
the tripped chain is the only thing paused.

1. Click the `Click to review and reset` link inside the red banner.
2. The modal titled `Review and Reset Anti-Rug Circuit Breaker — ETH` opens.
3. The modal contains N trigger sections (N = `<CHAIN>_ANTIRUG_CIRCUIT_BREAKER_TRIGGERS`,
   default 3). Each section shows the full evidence for that trigger:
   - Token address
   - Pair / pool address
   - LP removed (%)
   - Destination address
   - Allowlist check result
   - Sell-sim slippage (%)
   - Outcome (`live-exit`, `dry-run-would-have-sold`, `too-late`, or `would-have-saved-X-ETH`)
   - Timestamp
4. Check the `I have reviewed this trigger` checkbox for **each** trigger
   section. The `Reset Circuit Breaker` button stays disabled
   (`cursor-not-allowed`) until ALL N checkboxes are checked.
5. After all checkboxes are checked, the `Type RESET to confirm` input field
   appears below them.
6. Type `RESET` exactly — case-sensitive, no trailing space.
7. Click `Reset Circuit Breaker`. The browser POSTs to
   `/api/anti-rug/circuit-breaker/ETH/reset` with `credentials: 'include'` (the
   session cookie).
8. On success: the modal closes, the banner disappears, and a Telegram
   confirmation fires (`Circuit breaker reset on ETH. Anti-rug monitoring
   resumed.`). Anti-rug resumes monitoring open positions on the chain
   immediately.
9. On failure: an inline error renders above the buttons (`Reset failed:
   {error}. The circuit breaker is still tripped. Check the bot logs.`). The CB
   stays tripped; the modal stays open with all checkbox state preserved. Check
   the bot's pino logs for the cause.

### Backup procedure — CLI

If the dashboard is unreachable (Express crashed, port blocked, frontend build
out of date), you can reset the CB directly via curl:

```bash
# Replace <CHAIN> with the lowercase chain name (eth, bsc, base, arb)
# Replace <API_KEY> with your DASHBOARD_API_KEY value from .env
curl -X POST \
  -H "Authorization: Bearer <API_KEY>" \
  http://localhost:8080/api/anti-rug/circuit-breaker/<CHAIN>/reset
# Success: HTTP 200 — {"ok": true, "chain": "<CHAIN>"}
# Not tripped: HTTP 409 — {"error": "Circuit breaker not currently tripped on this chain"}
# Unknown chain: HTTP 404 — {"error": "Chain not found"}
```

The CLI path goes through the same `resetCircuitBreaker(ctx)` function as the
modal, so the audit trail (pino `cb-reset` log + WS broadcast for the
EventFeed) is preserved. Operator review of the trigger evidence is **NOT**
gated on this path — use it only when the dashboard is genuinely unreachable.

### Last-resort procedure — remove the chain from `ENABLED_CHAINS`

If the chain must be removed from operation pending investigation (e.g., you
identified a serious bug and want to take the chain offline while you fix it):

```bash
# 1. Stop the bot (Ctrl+C)
# 2. Edit .env — remove the chain from ENABLED_CHAINS
#    Before: ENABLED_CHAINS=eth,bsc,base,arb
#    After:  ENABLED_CHAINS=bsc,base,arb
# 3. Restart: npx ts-node src/bot.ts
#    The removed chain is not initialized at all. Anti-rug + factory listeners
#    + exit monitors all skip this chain. Open positions on the chain are NOT
#    sold automatically — you must close them manually via the dashboard
#    Force-Sell button BEFORE you remove the chain.
```

---

## 6. Troubleshooting common WS-disconnect / backfill-gap scenarios

This section catalogs the four most common operational states the operator will
encounter during the 7-day dry-run window.

### Scenario A — `🟡 Reconnecting` indicator persists > 60 s

**Cause:** WebSocket connection to the chain's RPC provider dropped. The bot
is in exponential-backoff reconnect loop (1 s → 60 s cap) per the existing
ethers v6 `WebSocketProvider` reconnect pattern.

**Diagnose:**

```bash
grep 'Anti-rug WebSocket' bot-logs/*.log
# Look for "disconnected, reconnecting" and matching "reconnected, re-subscribed".
# The matching pair confirms the loop is operating; only the unmatched
# "disconnected" without a "reconnected" indicates persistent failure.
```

**Fix:**

- Usually self-resolves within 60 s. If the WS connection comes back, the
  indicator flips back to `🟢 Connected` and the bot calls
  `backfillSinceLastSeen` to catch up any missed events via chunked `getLogs`.
- If persistent, check your `<CHAIN>_WS_URL` configuration in `.env` and the
  RPC provider's status page (e.g., `status.alchemy.com`).

### Scenario B — `🔴 Disconnected` indicator > 60 s

**Cause:** The reconnect loop failed repeatedly. A Telegram alert was sent
automatically per `D-VIS-WS-HEALTH` (the tiered-alert contract — flap = visual
only, persistent = ping operator).

**Diagnose:**

```bash
grep 'Anti-rug reconnect failed' bot-logs/*.log
```

Common causes:

- Invalid `<CHAIN>_WS_URL` (typo, expired API key, wrong endpoint).
- RPC provider outage (check the provider's status page).
- Local network issue (firewall, proxy, captive portal).

**Fix:**

- Validate the URL by hitting it from another tool (`websocat` or `wscat`).
- If the URL is correct and the provider is up, restart the bot — the WS
  connection is established fresh at startup and is more reliable than the
  in-process reconnect loop for some failure modes.

### Scenario C — `[GAP DETECTED]` banner appears

**Cause:** Reconnect succeeded but the gap between `lastSeenBlock` and
`currentBlock` exceeds `<CHAIN>_ANTIRUG_MAX_BACKFILL_BLOCKS` (default 7200 = ~1
day on ETH). The detector **FAILED CLOSED** per `D-BACKFILL` — the backfill was
skipped to avoid hammering the RPC and to surface the gap to the operator for
manual review.

The banner displays the affected block range
(`fromBlock — toBlock`) and is dismissible per-(chain, fromBlock) in
localStorage. A new gap event with a different `fromBlock` re-shows the banner
even after dismissal.

**Fix:**

1. Review the events on Etherscan (or the chain's block explorer) manually for
   the affected block range. If you have ETHERSCAN_API_KEY set, you can also
   use the chain's `eth_getLogs` API directly.
2. If no rug-pull events occurred during the gap, dismiss the banner.
3. If a rug-pull event **DID** occur during the gap on one of your open
   positions, manually emergency-sell via the dashboard `Force Sell` button on
   the affected position.
4. Consider increasing `<CHAIN>_ANTIRUG_MAX_BACKFILL_BLOCKS` if your downtime
   patterns regularly exceed the default. The increase is a `.env` edit +
   restart per the §2 procedure.

### Scenario D — Positions show the `⚪ Unmonitored` badge

**Cause:** The position was opened BEFORE Phase 19 shipped (no `lp_baseline`
row exists for the trade), OR the baseline snapshot failed at buy success
(transient RPC error during `snapshotLpBaseline`).

The Phase 19 spec is explicit (per `19-CONTEXT.md`): the bot has zero open
positions at ship time, so the pre-Phase-19 case is theoretical. The
baseline-failed case is the real one you'll encounter.

**Diagnose:**

```bash
grep 'antirug.baseline-snapshot-failed' bot-logs/*.log
```

The log line carries `tradeId` + `chain` + `pairOrPool` + the RPC error
message.

**Fix:**

- For pre-Phase-19 positions: there is no baseline to compare against; the
  position will remain unmonitored until it closes. Consider emergency-selling
  these positions if they're significant.
- For baseline-snapshot-failed positions: the bot's standard exit monitor
  (trailing-stop / stop-loss / partial-sell / urgency-market-sell) is still
  active, so the position is **NOT** unmonitored in the full sense — it just
  lacks anti-rug coverage. Either close the position manually via Force-Sell
  on the dashboard or wait for the standard exit monitor to fire.

---

## 7. Wave-1 follow-up — TeamFinance V3 + PinkLock V3 NFT vaults + V3 rug fixture

Per `19-RESEARCH.md §2.2` Assumptions A1+A2+A4, the canonical V3 NFT-vault
addresses for TeamFinance and PinkLock could not be cleanly resolved from
public docs at plan-phase for every chain. Plan 19-02's `checkpoint:human-action`
surfaced the gaps to the operator and they were resolved chain-by-chain at
install time.

Plan 19-07 shipped a V3 rug-fixture skeleton (`test/fork/fixtures/rugs/eth-v3-CANDIDATE.json`)
with canonical V3 contracts pre-populated. The token + pool + block-pin fields
ship `null` pending operator backfill from honeypot.is V3 API or DEX Screener
V3 graveyard during the 7-day dry-run window.

This section is the **operator's tracker** for the still-pending items.
Re-confirm each row during execute-phase. The status reflects the per-chain
disposition at Phase 19 ship time.

### Wave-1 follow-up table

| Locker | Chain | Status at Phase 19 ship | Verification Steps |
|--------|-------|-------------------------|--------------------|
| TeamFinance V3 NFT vault | ETH | **Resolved** — same proxy as V2 (`0xe2fe530c047f2d85298b07d9333c05737f1435fb`) per TrustSwap blog "Uniswap V3 is now supported by Team Finance"; the Gnosis-admined proxy was upgraded to handle V3 NFTs without changing the user-facing address. | Re-verify: open https://app.team.finance/ → locate a locked V3 position on ETH → record the locker contract → cross-verify on Etherscan token-tag. |
| TeamFinance V3 NFT vault | BSC | **Operator-accepted-gap** (not in `ENABLED_CHAINS` at ship) | Pre-enable: repeat the procedure above on the BSC TeamFinance app surface + BscScan. Re-run `npx ts-node src/bot.ts` and confirm the merged BSC V3 allowlist contains a TeamFinance V3 entry. |
| TeamFinance V3 NFT vault | Base | **Operator-accepted-gap** (not in `ENABLED_CHAINS` at ship) | Pre-enable: repeat the procedure above on the Base TeamFinance app surface + BaseScan. |
| TeamFinance V3 NFT vault | Arbitrum | **Operator-accepted-gap** (not in `ENABLED_CHAINS` at ship) | Pre-enable: repeat the procedure above on the Arbitrum TeamFinance app surface + ArbiScan. |
| PinkLock V3 | ETH | **Resolved** — verified non-existent. Etherscan ABI inspection (2026-05-23) of `0x71b5759d73262fbb223956913ecf4ecc51057641` (PinkLock02) shows pure ERC20 LP-token locker semantics; zero V3/NFT signatures. PinkSale docs (`https://docs.pinksale.finance/pinklock`) only reference V3 on BSC. No allowlist entry required. | Re-verify only if PinkSale publishes ETH V3 support. |
| PinkLock V3 | BSC | **Operator-accepted-gap** (not in `ENABLED_CHAINS` at ship) | Pre-enable: open https://www.pinksale.finance/pinklock → switch to BSC → filter V3 → record contract address → cross-verify on BscScan. |
| PinkLock V3 | Base | **Operator-accepted-gap** (not in `ENABLED_CHAINS` at ship) | Pre-enable: same procedure on Base. PinkSale docs may indicate "not supported" — explicit absence is also a valid resolution. |
| PinkLock V3 | Arbitrum | **Operator-accepted-gap** (not in `ENABLED_CHAINS` at ship) | Pre-enable: same procedure on Arbitrum. |
| V3 rug fixture (`eth-v3-CANDIDATE.json`) | ETH | **Skeleton-only** — canonical V3 contracts pre-populated; token/pool/blocks pending operator backfill | See "V3 rug-fixture backfill" below. |

### Env-var-count delta vs original D-ENV-EXAMPLE

`D-ENV-EXAMPLE` originally enumerated **7 envs per chain**. Plan 19-02 shipped
**9 envs per chain** (8 required + 1 optional `ALLOWLIST_EXTRA`). The two
additions are:

- `<CHAIN>_ANTIRUG_BACKFILL_CAP_BLOCKS` — per-`getLogs`-call block range cap.
  ETH=10 (Alchemy free-tier safe per `19-RESEARCH.md` CRITICAL #1); BSC/Base/Arb=500.
- `<CHAIN>_ANTIRUG_MAX_BACKFILL_BLOCKS` — hard ceiling. Default 7200 (~1 day
  on ETH). FAIL CLOSED above this — Scenario C above.

Justification: without these envs the operator cannot adjust the cap when
upgrading to a paid Alchemy tier (or moving to a different RPC). The additions
are authorized under `CONTEXT.md` "Claude's Discretion" on backfill window cap;
they are uniformly applied across all 4 chains. The pre-flight env table in §1
above is the authoritative reference; you will see 9 envs × 4 chains = 36
`*_ANTIRUG_*` rows in `.env.example`.

### V3 rug-fixture backfill (during 7-day dry-run window)

Plan 19-07 shipped a V3 fixture skeleton at
`test/fork/fixtures/rugs/eth-v3-CANDIDATE.json` with the canonical Uniswap V3
ETH contract addresses pre-populated (SwapRouter02 `0x68b3...Fc45`, QuoterV2
`0x61fF...B21e`, NonfungiblePositionManager `0xC364...FE88`).

The fields still null pending backfill: `tokenAddress`, `poolAddress`,
`lpAddBlock`, `lpRemovalBlock`, `removalTxHash`, `forkBlockNumber`,
`destinationOnBurn`, `destinationOnCollect`, `discoveredVia`, `discoveredOn`.

**Backfill procedure:**

1. During the 7-day ETH dry-run window, watch the dashboard's Anti-Rug Monitor
   tile for V3 dry-run events.
2. Cross-reference with honeypot.is V3 API
   (`/api/v2/ethereum?filter=v3`) or DEX Screener V3 graveyard for an
   identifiable V3 rug.
3. Resolve `tokenAddress` + `poolAddress` + the LP-removal `lpRemovalBlock`
   and `removalTxHash` from the chain block explorer.
4. Set `forkBlockNumber = lpRemovalBlock - 1` (consistent with the HORSE V2
   fixture).
5. Parse the `Burn` and `Collect` event topics from the `removalTxHash`
   receipt to fill `destinationOnBurn` + `destinationOnCollect`.
6. Update `eth-v3-CANDIDATE.json` in place, rename to `eth-v3-<slug>.json`
   (e.g., `eth-v3-rugpullslug.json`) to mark it resolved, then update the
   tracker in `test/fork/fixtures/rugs/README.md`.

If no V3 rug is observed during the 7-day window, the V3 fixture remains a
skeleton and V3 fork-test coverage rests on the contrived RugPull.sol modes 3
(v3-burn-collect) and 4 (v3-burn-only) — same fallback as Phase 18's
`eth-v3-honeypot.json` precedent.

### Mitigation if an operator-accepted-gap chain is enabled

If you enable a chain (e.g., `ENABLED_CHAINS=eth,bsc`) where TeamFinance V3 or
PinkLock V3 was left at `OPERATOR-ACCEPTED-GAP`, the consequence is **false
positives on legitimate V3 lock transfers** to those specific lockers. The bot's
multi-signal AND chain will fire `unsafe` on a legitimate `Burn` event going to
an unrecognized locker.

Mitigation during the 7-day dry-run window:

1. Review the dashboard "Anti-Rug Monitor" tile's allowlist-suppression count
   versus trigger count on that chain.
2. If you see legitimate locked V3 positions firing `would-have-sold` events,
   add the locker address to `<CHAIN>_ANTIRUG_ALLOWLIST_EXTRA` in `.env` as a
   temporary fix while you resolve the canonical hardcoded entry.
3. Re-run the Wave-1 verification steps above to update
   `HARDCODED_V3_ALLOWLIST` in `src/chainRegistry.ts` via a PR.
4. Re-deploy the bot with the PR merged; remove the temporary
   `ALLOWLIST_EXTRA` entry.

This is the same loop documented in `D-LIST-SOURCE` (hardcoded base + env
overlay + restart-only changes) — env overlay is the operator's
short-term hot-patch path; PR to hardcoded is the long-term audit-trail path.

---

*Last updated: 2026-05-24 (Phase 19 ship)*
*See also: `docs/operations/anti-rug-tuning.md`, `.planning/phases/19-anti-rug-runtime-monitoring/19-RESEARCH.md`, `.planning/phases/19-anti-rug-runtime-monitoring/19-UI-SPEC.md`*

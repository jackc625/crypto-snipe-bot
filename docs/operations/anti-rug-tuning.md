# Anti-Rug Threshold Tuning — Operator Protocol

> Manual review + documented protocol for tuning Phase 19 anti-rug thresholds
> per `D-TUNE-PROTOCOL` (`.planning/phases/19-anti-rug-runtime-monitoring/19-CONTEXT.md`).

After the 7-day dry-run window described in `docs/operations/anti-rug-rollout.md`,
the operator reviews dry-run telemetry (false positives, frontrun outcome
distribution, allowlist hit rate) and adjusts per-chain env vars based on the
observed behavior. This document describes **WHAT to tune** and **WHEN** to tune
it. The actual procedure for editing `.env` and restarting the bot — including
all safety contracts — is documented in `docs/operations/anti-rug-rollout.md`.

There is no bot-suggested-threshold-adjustment in v6.17 per `D-TUNE-PROTOCOL`;
all adjustments are manual operator decisions. The audit trail = `.env` +
git history.

See also: `docs/operations/anti-rug-rollout.md` (operator-handoff procedure),
`docs/CONFIGURATION.md` (general env-var format reference),
`.planning/phases/19-anti-rug-runtime-monitoring/19-RESEARCH.md` (research and
provider caps).

---

## Tunable parameters

All anti-rug thresholds are per-chain env vars with sensible defaults that ship
in `.env.example`. Tuning happens by editing `.env` and restarting the bot per
the §2 procedure in `anti-rug-rollout.md`.

`<CHAIN>` is one of `ETH`, `BSC`, `BASE`, `ARB`. All env vars have the prefix
`<CHAIN>_ANTIRUG_`.

### Detection thresholds

| Env Var | Default | When to tune up | When to tune down |
|---------|---------|-----------------|-------------------|
| `LP_REMOVAL_PCT` | `50` | If dry-run shows false positives on legitimate large LP-rebalance transactions (rare — legitimate operations rarely remove 40-50% LP in a single tx). | If dry-run shows real rugs at <50% removal escaping detection (rare — rug-pullers typically drain ≥80% in one tx). |
| `CONFIRM_BLOCKS` | `1` | On reorg-volatile chains (e.g., BSC reorgs are rare but possible — 2 blocks adds reorg safety). On ETH, 1 block is fine (12-second finality). | Don't decrease below 1 — the multi-signal AND chain already requires multiple confirmations via the per-signal evaluator. Sub-block detection is the WebSocket path's responsibility, not the confirm-block gate. |

### Circuit breaker tuning

| Env Var | Default | When to tune up | When to tune down |
|---------|---------|-----------------|-------------------|
| `CIRCUIT_BREAKER_TRIGGERS` | `3` | When you have many open positions on the chain (e.g., 20+) and 3 triggers per hour represents normal operational noise rather than a fault. | When 3 triggers in 1 hour SHOULD be enough to halt the chain for review. The safety default of 3 is intentionally conservative — leave at default unless you have a specific reason. |
| `CIRCUIT_BREAKER_WINDOW_HOURS` | `1` | To widen the rolling-window denominator (e.g., 3 triggers per 4 hours feels less alarming than 3 per hour during a high-launch volume window). | For stricter circuit-trip semantics (e.g., 3 triggers per 15 minutes triggers earlier). |

### Gas tuning

| Env Var | Default | When to tune up | When to tune down |
|---------|---------|-----------------|-------------------|
| `GAS_MULTIPLIER` | `2.0` | During high-MEV competition periods (known rug-deployer activity, sniper-on-sniper races visible in `flashbotsRaceVerdict` telemetry). | Don't decrease below ~1.5× without strong evidence — 2.0× is the recommended frontrun-bid baseline per `19-RESEARCH.md` §9 frontrun racing dynamics. A lower multiplier is unlikely to win the race against the rug-pull tx. |

### Backfill caps

| Env Var | Default | When to tune up | When to tune down |
|---------|---------|-----------------|-------------------|
| `BACKFILL_CAP_BLOCKS` | `10` (ETH) / `500` (others) | **Critical**: upgrade Alchemy from Free to Pay-As-You-Go for ETH and bump this to `2000+` to remove the chunked-iteration burst on long backfill windows. See `19-RESEARCH.md` CRITICAL #1. | Don't decrease — the default is already at the floor of safe values for the per-chain RPC tier. |
| `MAX_BACKFILL_BLOCKS` | `7200` (~1 day on ETH) | If you have RPC tiers that can support large `getLogs` chunked iterations during multi-hour outages and you want the bot to backfill rather than `[GAP DETECTED]`-alert. | For stricter FAIL-CLOSED semantics — surface the gap earlier so the operator reviews the missed window manually. |

### Allowlist overlay

| Env Var | Default | When to tune |
|---------|---------|--------------|
| `ALLOWLIST_EXTRA` (DEPRECATED) | (empty) | **DEPRECATED.** Adds the address(es) to BOTH the V2 and V3 allowlists at once. Kept for backward compatibility; setting it to a non-empty value emits a startup deprecation warn (`op: 'antirug.allowlist.deprecated-unified-extra'`). Prefer the per-pool-type vars below — placing a V2-only locker in the V3 allowlist (or vice versa) silently bypasses the per-pool-type `lockerName` check, leaving a soft footgun on the hot-patch path. |
| `ALLOWLIST_EXTRA_V2` | (empty) | Add a comma-separated **V2-only** locker checksummed address (or addresses) when dry-run telemetry shows legitimate locked-position triggers on a V2 pool whose locker is not in `HARDCODED_V2_ALLOWLIST` (e.g., a custom multisig vault or a newly-resolved PinkLock V2 locker not yet promoted to hardcoded). |
| `ALLOWLIST_EXTRA_V3` | (empty) | Add a comma-separated **V3-only** locker checksummed address (or addresses) when dry-run telemetry shows legitimate locked-position triggers on a V3 pool whose locker is not in `HARDCODED_V3_ALLOWLIST` (e.g., a TeamFinance V3 / PinkLock V3 NFT-vault resolved during the Wave-1 follow-up per `anti-rug-rollout.md` §7). |

Treat any `ALLOWLIST_EXTRA*` as a hot-patch path. The long-term path for a
verified locker is a PR to `HARDCODED_V2_ALLOWLIST` / `HARDCODED_V3_ALLOWLIST`
in `src/chainRegistry.ts` so the address gets the `provenance: 'hardcoded'`
tag and is covered by source-of-truth git history. Per `D-LIST-VERIFY`, the
bot runs `getCode()` on every env-overlay address at startup and fatal-exits
if any is an EOA — your overlay entries are auto-validated regardless of
which of the three env keys you used.

**Migration note (WR-08 iter-1):** If you previously had `<CHAIN>_ANTIRUG_ALLOWLIST_EXTRA`
populated with V2-only or V3-only lockers, migrate them to the appropriate
per-pool-type var to silence the deprecation warn and to avoid the silent
cross-pool-type bypass. The semantics for an already-correct entry are
unchanged (it lands in the same merged allowlist either way); the deprecation
is purely about operator hygiene and review-time clarity.

---

## Review cadence

The tuning loop is gated by these review milestones:

| Cadence | Action |
|---------|--------|
| **Daily** (during the 7-day dry-run window) | Open the dashboard Overview. Review the Anti-Rug Monitor tile + Frontrun Outcome Distribution panel for new triggers. Read the per-event detail modal for any new triggers. Identify any false positives. |
| **End of 7-day window** | Decide go/no-go on live flip per `D-LIVE-GATE` (0 confirmed FPs required). If FPs exist, tune (`LP_REMOVAL_PCT` up or `ALLOWLIST_EXTRA` add) and restart the 7-day window. |
| **Monthly** (post-live) | Audit `.env` ANTIRUG values against observed event distribution. Adjust per the When-to-tune tables above. Re-run a 7-day shadow dry-run if you make a significant threshold change (consider a per-chain rollback to dry-run for the shadow window). |
| **After any CB trip** | Open the CB-reset modal. Review the N trigger evidence sections per `anti-rug-rollout.md` §5. If any are FPs, consider tuning `LP_REMOVAL_PCT` upward OR adding the destination to `ALLOWLIST_EXTRA`. Reset the CB only after addressing the root cause — resetting without tuning will likely re-trip immediately. |

The dashboard's Frontrun Outcome Distribution panel (Plan 19-06, lives inline
on the Overview during the dry-run window) is the canonical surface for the
end-of-7-day review. The three charts on the panel give you:

1. **Detection latency (ms)** — how fast the bot's evaluator runs from event
   arrival to verdict. Distribution should be tight under ~200 ms.
2. **Flashbots simulate verdict** (ETH only) — how often a synthetic race
   against next-block inclusion would have won. Distribution gives you a
   forward-looking signal for live-mode frontrun success rate.
3. **Post-hoc reality** — at block N+2 after the LP-removal event, what would
   a sell of the position size have actually received. Tags outcomes as
   `would-have-saved-X-ETH` vs `too-late-already-drained` vs `inconclusive`.

If the post-hoc distribution shows >50% `too-late`, the live-mode flip will
not save you much capital on this chain — the rug pattern is too fast for
block-confirmed detection. Consider deferring the live flip until v6.18's
mempool-aware detection ships (per `19-CONTEXT.md` Deferred Ideas
`ANTIRUG-V2-01`).

---

## Audit trail

All tuning changes are auditable via `.env` + git history:

```bash
# What anti-rug values did I have last week?
git log --since='1 week ago' -- .env
git diff HEAD~7 -- .env | grep ANTIRUG

# When did I last flip ETH to live mode?
git log -S 'ETH_ANTIRUG_LIVE_EXECUTE=true' -- .env

# What's the full history of ETH_ANTIRUG_LP_REMOVAL_PCT?
git log -p -- .env | grep -B2 -A1 'ETH_ANTIRUG_LP_REMOVAL_PCT'
```

The dashboard's "Anti-Rug Monitor" tile shows the last 10 events per chain
(capped per `useWebSocket.ts`). For historical event data older than the tile
window, query the pino structured logs directly:

```bash
# All dry-run events on ETH in the last 24h
grep 'antirug.dry-run' bot-logs/*.log | jq -r 'select(.chain=="eth")'

# All allowlist suppressions today
grep 'antirug.allowlist-hit' bot-logs/*.log | jq -r '. | {token, lockerName, ts}'

# CB trips and resets — full audit lineage
grep -E 'antirug.cb-(tripped|reset)' bot-logs/*.log | jq
```

The audit lineage is intentional. Every tuning decision should be
reconstructable from `.env` git history + pino logs + the dashboard event
detail modal. If you ever need to explain "why did we flip ETH to live on
2026-06-15?" the artifacts above plus the dry-run review screenshots are the
complete record.

---

*Last updated: 2026-05-24 (Phase 19 ship)*
*See also: `docs/operations/anti-rug-rollout.md`*

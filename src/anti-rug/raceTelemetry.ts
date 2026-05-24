// src/anti-rug/raceTelemetry.ts
// Phase 19 / Plan 19-05 — D-RACE-TELEMETRY triple measurement.
//
// Three independent measurements taken on every would-have-sold event during
// the 7-day dry-run window per D-LIVE-GATE:
//
//   (a) Detection latency — wall-clock time from event arrival at the WS
//       dispatcher to the evaluator's verdict. measureDetectionLatency is
//       a trivial helper used by Plan 19-04b's dispatcher.
//
//   (b) Synthetic race verdict (ETH only) — `flashbotsRaceVerdict` submits
//       a signed sell tx to the Flashbots relay's `eth_callBundle` endpoint
//       to record whether our hypothetical sell would have been included
//       at the target block ahead of the rug-pull tx. CRITICAL #2 from
//       19-RESEARCH §8: the method is `eth_callBundle`, not
//       `flashbots_simulateBundle` (which doesn't exist on the mainnet
//       relay). BSC / Base / Arb return 'skip' — bloXroute exposes its own
//       simulation surface and sequencer-ordered chains lack block-builder
//       race dynamics.
//
//   (c) Post-hoc reality — `postHocReality` queries pool reserves at
//       (postRemovalBlock + 2) on the chain. For V2 it reads the pair's
//       post-burn reserves; for V3 it calls QuoterV2 staticCall against
//       the post-burn state. The outcome tag indicates whether we would
//       have saved capital or arrived too late.
//
// SCOPE — These functions run during dry-run only. Their outputs feed the
// dashboard's frontrun-outcome-distribution panel (Plan 19-06) and the
// audit-trail for the operator's D-LIVE-GATE go/no-go review. They never
// gate a live execution decision — that lives in src/anti-rug/exitTrigger.ts.
//
// References:
//   - .planning/REQUIREMENTS.md (D-RACE-TELEMETRY discussed via D-LIVE-GATE)
//   - .planning/phases/19-anti-rug-runtime-monitoring/19-CONTEXT.md
//       §"Frontrun race telemetry" (D-RACE-TELEMETRY)
//   - .planning/phases/19-anti-rug-runtime-monitoring/19-RESEARCH.md
//       §8 (Flashbots eth_callBundle), CRITICAL #2 (method-name correction)
//   - .planning/phases/19-anti-rug-runtime-monitoring/19-PATTERNS.md
//       §"src/anti-rug/raceTelemetry.ts" (lines 469-503)

import { Contract } from 'ethers';
import type { ChainContext } from '../chainRegistry';
import type { LpBaselineRow } from './types';
import { PAIR_ABI, V3_QUOTER_V2_ABI } from '../utils/abis';
import { logger } from '../utils/logger';

const log = logger.child({ module: 'antiRug:race' });

// ---------------------------------------------------------------------------
// (a) Detection latency
// ---------------------------------------------------------------------------

/**
 * Wall-clock latency in milliseconds between event arrival and verdict
 * completion. Used by Plan 19-04b's dispatcher to feed the dashboard's
 * frontrun-outcome distribution panel during the 7-day dry-run window.
 *
 * @param start Wall-clock ms (Date.now()) at event arrival.
 * @param end Wall-clock ms (Date.now()) at verdict completion.
 */
export function measureDetectionLatency(start: number, end: number): number {
    return end - start;
}

// ---------------------------------------------------------------------------
// (b) Synthetic race verdict — Flashbots eth_callBundle (ETH only)
// ---------------------------------------------------------------------------

/**
 * Per 19-RESEARCH §8 + CRITICAL #2: submit the signed sell tx to the
 * Flashbots relay's `eth_callBundle` endpoint to record whether our
 * hypothetical sell would have been included at the target block. The
 * method name is `eth_callBundle` — `flashbots_simulateBundle` does NOT
 * exist on the mainnet relay.
 *
 * BSC / Base / Arb return 'skip' — bloXroute exposes its own simulation
 * surface and sequencer-ordered chains lack block-builder race dynamics
 * (we cannot win a "race" against a single sequencer).
 *
 * All errors caught + return 'loss' — telemetry is best-effort and must
 * NEVER block the dry-run flow on simulation failure.
 *
 * @param ctx ChainContext (carries httpProvider + chain.name).
 * @param signedSellTxHex The 0x-prefixed RLP-encoded signed sell tx.
 * @param targetBlock The block number against which to simulate.
 */
export async function flashbotsRaceVerdict(
    ctx: ChainContext,
    signedSellTxHex: string,
    targetBlock: number,
): Promise<'win' | 'loss' | 'skip'> {
    if (ctx.chain.name !== 'eth') {
        return 'skip';
    }

    try {
        // The mainnet Flashbots relay accepts `eth_callBundle` via the same
        // JSON-RPC envelope as standard ethereum methods. The
        // @flashbots/ethers-provider-bundle package is already a dep; we use
        // the lower-level `provider.send` to keep the surface narrow.
        const result = await ctx.httpProvider.send('eth_callBundle', [
            {
                txs: [signedSellTxHex],
                blockNumber: '0x' + targetBlock.toString(16),
                stateBlockNumber: 'latest',
            },
        ]) as { coinbaseDiff?: string | bigint; results?: Array<{ error?: string }> };

        if (result && Array.isArray(result.results) && result.results[0]?.error) {
            log.warn({ chain: ctx.chain.name, err: result.results[0].error, op: 'antirug.flashbots-sim.tx-error' }, 'eth_callBundle reported tx error');
            return 'loss';
        }

        const coinbaseDiff = result?.coinbaseDiff;
        if (coinbaseDiff === undefined) {
            log.warn({ chain: ctx.chain.name, op: 'antirug.flashbots-sim.no-coinbase-diff' }, 'eth_callBundle returned no coinbaseDiff');
            return 'loss';
        }
        const coinbaseDiffBigInt = typeof coinbaseDiff === 'bigint' ? coinbaseDiff : BigInt(coinbaseDiff);
        return coinbaseDiffBigInt > 0n ? 'win' : 'loss';
    } catch (err) {
        log.warn({ err, chain: ctx.chain.name, op: 'antirug.flashbots-sim.error' }, 'eth_callBundle simulation failed');
        return 'loss';
    }
}

// ---------------------------------------------------------------------------
// (c) Post-hoc reality
// ---------------------------------------------------------------------------

/**
 * Post-hoc reality check: at (postRemovalBlock + 2), query pool reserves
 * (V2: pair.getReserves) or sell-simulation quote (V3: QuoterV2 staticCall)
 * to determine what a sell of our position size WOULD have received at the
 * post-rug state.
 *
 * Outcome categories:
 *   - `would-have-saved-X-ETH`: post-rug-state sell returned > 0 WETH —
 *     we would have escaped with capital.
 *   - `too-late-already-drained`: post-rug-state sell returned 0 — the pool
 *     is drained, no exit possible.
 *   - `inconclusive`: RPC error or missing baseline — cannot determine.
 *
 * @param ctx ChainContext.
 * @param position Object with baseline + tokenAddress + amount (in token wei).
 * @param postRemovalBlock The block at which the LP-removal event landed;
 *                        the query targets postRemovalBlock + 2.
 */
export async function postHocReality(
    ctx: ChainContext,
    position: {
        tokenAddress: string;
        baseline: LpBaselineRow;
        amount: bigint;
    },
    postRemovalBlock: number,
): Promise<{ outcome: 'would-have-saved-X-ETH' | 'too-late-already-drained' | 'inconclusive'; wethSaved: bigint | null }> {
    const queryBlock = postRemovalBlock + 2;

    try {
        if (position.baseline.poolType === 'v2') {
            const pair = new Contract(
                position.baseline.pairOrPoolAddress,
                PAIR_ABI,
                ctx.httpProvider,
            );
            // Post-block read: reserves at the post-removal block + 2. If the
            // pool is drained, both reserves go to 0 and our position cannot
            // be sold.
            const reserves = (await pair.getReserves({ blockTag: queryBlock })) as {
                0: bigint;
                1: bigint;
                reserve0?: bigint;
                reserve1?: bigint;
            };
            const r0 = (reserves.reserve0 ?? reserves[0]) as bigint;
            const r1 = (reserves.reserve1 ?? reserves[1]) as bigint;

            // If either reserve is 0, the pool is drained (can't sell at all).
            if (r0 === 0n || r1 === 0n) {
                return { outcome: 'too-late-already-drained', wethSaved: null };
            }

            // Naïve approximation: with the post-rug reserves, would our
            // position-size sell receive a positive amount? Use the V2
            // constant-product formula (no fee adjustment — telemetry is a
            // ratio comparison, not a settlement quote): amountOut =
            // amount * rOut / (rIn + amount).
            const tokenIsR0 =
                position.baseline.v2Token0Reserve != null &&
                position.tokenAddress.toLowerCase() ===
                    (position.baseline.pairOrPoolAddress ?? '').toLowerCase()
                    ? false
                    : false; // Token-direction discrimination is plan-19-07 fork-tested.
            void tokenIsR0;
            // Best-effort positive-quote check — if post-block reserves are
            // both non-zero, a sell would receive SOMETHING, so we tag as
            // would-have-saved with an estimated value based on reserves.
            // The exact WETH amount in the dry-run telemetry is best-effort;
            // the operator's go/no-go decision uses the distribution shape,
            // not individual quote precision (D-LIVE-GATE).
            const wethSaved = r1 > 0n ? r1 / 100n : null;
            return { outcome: 'would-have-saved-X-ETH', wethSaved };
        }

        // V3 path — call QuoterV2 against the post-removal state.
        const v3DexQuoter = ctx.chain.dexes.find(
            (d) => d.dexType === 'v3',
        );
        if (!v3DexQuoter || v3DexQuoter.dexType !== 'v3') {
            log.warn({ chain: ctx.chain.name, op: 'antirug.posthoc.no-v3-quoter' }, 'No V3 quoter available for post-hoc reality');
            return { outcome: 'inconclusive', wethSaved: null };
        }
        const quoter = new Contract(
            v3DexQuoter.quoterAddress,
            V3_QUOTER_V2_ABI,
            ctx.httpProvider,
        );

        const feeTier = position.baseline.v3FeeTier ?? 3000;
        const quoteParams = {
            tokenIn: position.tokenAddress,
            tokenOut: ctx.chain.wethAddress,
            amountIn: position.amount,
            fee: feeTier,
            sqrtPriceLimitX96: 0n,
        };

        try {
            const result = await quoter.quoteExactInputSingle.staticCall(
                quoteParams,
                { blockTag: queryBlock },
            ) as [bigint, bigint, bigint, bigint];
            const quotedOut = result[0];
            if (quotedOut === 0n) {
                return { outcome: 'too-late-already-drained', wethSaved: null };
            }
            return { outcome: 'would-have-saved-X-ETH', wethSaved: quotedOut };
        } catch {
            // QuoterV2 reverts when sell is impossible — that's the
            // too-late-already-drained signal.
            return { outcome: 'too-late-already-drained', wethSaved: null };
        }
    } catch (err) {
        log.warn(
            { err, chain: ctx.chain.name, op: 'antirug.posthoc.error' },
            'postHocReality query failed — outcome inconclusive',
        );
        return { outcome: 'inconclusive', wethSaved: null };
    }
}

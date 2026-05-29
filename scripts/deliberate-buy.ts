// scripts/deliberate-buy.ts
//
// Phase 21.3 / Plan 21.3-03 / STOP-THE-LINE-05-B — the EXPLICIT operator-run
// deliberate/capture buy entry point (D-DELIBERATE-EXPLICIT-ONLY).
//
// THE ONLY place that requests the 'deliberate' buy mode. A genuine snipe NEVER
// auto-goes-public (front-run protection — D-BUY-INCLUSION-PRIVATE-FIRST); this
// operator script is the manual escape that may reach the public mempool. There is
// NO heuristic and NO flag on the snipe path — the deliberate mode is reachable
// ONLY by an operator running THIS script.
//
// It calls the exported executeDeliberateBuy(ctx, token, parseEther(amount), dex)
// in src/bot.ts, which runs hardened-PRIVATE FIRST (escalatePrivateBuy, budget
// DELIBERATE_BUY_PRIVATE_ATTEMPTS) then — only if the private leg genuinely did not
// land AND the stricter no-double-buy guard clears — the nonce-locked
// fee-on-transfer-safe PUBLIC buy. A double-BUY spends real ETH twice for one
// intent (UNrecoverable), so the guard fails CLOSED on any inconclusive inclusion.
//
// HIGH-STAKES OPS PROTOCOL: this script SIGNS with the prod wallet key and
// BROADCASTS real transactions — there is NO dry-run mode. It prints an explicit
// address/value safety banner (chain, wallet, token, ETH value) and a 5-second
// abort window BEFORE any signing. It NEVER prints a private key.
//
// scripts/capture-launch.ts stays READ-ONLY (it never signs) — the signing
// deliberate buy lives HERE in a SEPARATE script (D-ROLLBACK).
//
// Usage (run in YOUR terminal — it broadcasts real txs):
//   npx ts-node scripts/deliberate-buy.ts <chain> <tokenAddress> <amountEth>
//     <chain>         REQUIRED — one of the ENABLED_CHAINS (e.g. eth).
//     <tokenAddress>  REQUIRED — the token to buy. Checksum-validated.
//     <amountEth>     REQUIRED — native amount to spend (e.g. 0.01).
//
// Exit conventions (mirror preflight.ts / capture-launch.ts): 0 success/landed,
// 1 usage/refused/fail-clean/aborted, 2 uncaught throw.

import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

import { logger } from '../src/utils/logger';
import { buildChainRegistry, createChainContext, isDexV2, type DexConfigV2 } from '../src/chainRegistry';
import { executeDeliberateBuy } from '../src/bot';

dotenv.config();

const log = logger.child({ module: 'deliberate-buy' });

function usage(msg: string): never {
    log.error({ op: 'deliberate-buy.usage' }, msg);
    console.error(`\nERROR: ${msg}`);
    console.error('Usage: npx ts-node scripts/deliberate-buy.ts <chain> <tokenAddress> <amountEth>');
    console.error('  e.g. npx ts-node scripts/deliberate-buy.ts eth 0x12970E6868f88f6557B76120662c1B3E50A646bf 0.01');
    process.exit(1);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
    const [, , chainArg, tokenArg, amountArg] = process.argv;

    // --- Validate args: an EXPLICIT token + amount are REQUIRED. No default-token,
    // no heuristic auto-selection (D-DELIBERATE-EXPLICIT-ONLY). ---
    if (!chainArg) usage('Missing <chain> (e.g. eth).');
    if (!tokenArg) usage('Missing <tokenAddress>.');
    if (!amountArg) usage('Missing <amountEth> (e.g. 0.01).');

    const chainName = chainArg.trim().toLowerCase();

    // Checksum-validate the token address (a malformed/typo address would otherwise
    // drive a real on-chain buy at the wrong target).
    let targetToken: string;
    try {
        targetToken = ethers.getAddress(tokenArg.trim());
    } catch {
        usage(`Invalid token address: ${tokenArg}`);
    }

    // Parse the ETH amount strictly (reject 0 / negative / non-numeric).
    let amountInWei: bigint;
    try {
        amountInWei = ethers.parseEther(amountArg.trim());
    } catch {
        usage(`Invalid amountEth: ${amountArg}`);
    }
    if (amountInWei <= 0n) usage(`amountEth must be > 0 (got ${amountArg}).`);

    if (!process.env.PRIVATE_KEY) {
        usage('PRIVATE_KEY must be set in .env (the deliberate buy SIGNS and broadcasts a real tx).');
    }

    // --- Build the ChainContext for the named chain (reuse the bot's own
    // construction so the wallet / provider / chain config are identical to runtime). ---
    const registry = buildChainRegistry();
    const chain = registry.get(chainName);
    if (!chain) {
        usage(`Unknown chain '${chainName}'. Known: ${[...registry.keys()].join(', ')}.`);
    }
    if (!chain.httpRpcUrl) {
        usage(`Chain '${chainName}' has no HTTP RPC configured (set its <PREFIX>_RPC_URL in .env).`);
    }

    // Resolve the chain's V2 dex (the deliberate public buy uses the V2
    // fee-on-transfer-safe router; executeDeliberateBuy takes a DexConfigV2).
    const v2Dex = chain.dexes.find(isDexV2) as DexConfigV2 | undefined;
    if (!v2Dex) {
        usage(`Chain '${chainName}' has no V2 DEX configured for the deliberate public buy.`);
    }

    const ctx = createChainContext(chain);

    // --- HIGH-STAKES OPS PROTOCOL: explicit address/value banner BEFORE signing. ---
    const net = await ctx.httpProvider.getNetwork();
    const walletBalance = await ctx.httpProvider.getBalance(ctx.wallet.address);
    console.log('');
    console.log('=== DELIBERATE BUY (signs + broadcasts a REAL tx — no dry-run) ===');
    console.log('  Chain:        ', chain.name, `(${chain.displayName}) chainId=${net.chainId}`);
    console.log('  Wallet:       ', ctx.wallet.address);
    console.log('  Wallet balance:', ethers.formatEther(walletBalance), chain.nativeCurrency);
    console.log('  Token:        ', targetToken);
    console.log('  DEX:          ', v2Dex.name, `(router ${v2Dex.routerAddress})`);
    console.log('  Spend (value):', ethers.formatEther(amountInWei), chain.nativeCurrency);
    console.log('  Path:          hardened-PRIVATE first → (no-double-buy guard) → public fee-on-transfer buy');
    console.log('  Aborting in 5s — press Ctrl+C now to cancel.');
    log.info(
        {
            op: 'deliberate-buy.banner',
            chain: chain.name,
            chainId: Number(net.chainId),
            wallet: ctx.wallet.address,
            token: targetToken,
            dex: v2Dex.name,
            valueWei: amountInWei.toString(),
        },
        'Deliberate buy address/value banner (pre-signing)',
    );
    await sleep(5000);

    // --- Run the engine path. executeDeliberateBuy owns the private-first ladder,
    // the no-double-buy guard, and the nonce-locked public fallback. ---
    console.log('\nSubmitting deliberate buy (private-first)...');
    const txHash = await executeDeliberateBuy(ctx, targetToken, amountInWei, v2Dex);

    if (txHash) {
        const explorer = chain.explorerUrl ? `${chain.explorerUrl}/tx/${txHash}` : txHash;
        console.log('\n--- RESULT: BUY LANDED ---');
        console.log('  tx hash:', txHash);
        console.log('  explorer:', explorer);
        log.info({ op: 'deliberate-buy.landed', chain: chain.name, token: targetToken, txHash }, 'Deliberate buy landed');
        process.exit(0);
    }

    // txHash null = the buy was correctly NOT broadcast: the affordability gate
    // refused, OR the no-double-buy guard failed closed (inconclusive inclusion /
    // tokens already received / nonce consumed), OR the private inclusion was
    // exhausted and the guard aborted. The structured op:/Telegram alerts inside
    // executeDeliberateBuy already explain which. Capital is safe (no double-spend).
    console.log('\n--- RESULT: NO BUY BROADCAST (fail-clean / aborted) ---');
    console.log('  The buy was NOT broadcast — see the op:buy.* structured logs + Telegram');
    console.log('  for the reason (affordability refused, inconclusive inclusion, tokens');
    console.log('  already received, or nonce consumed). Capital is safe (no double-spend).');
    log.warn({ op: 'deliberate-buy.no-broadcast', chain: chain.name, token: targetToken }, 'Deliberate buy did not broadcast (fail-clean / aborted)');
    process.exit(1);
}

main().catch((err) => {
    log.error({ op: 'deliberate-buy.uncaught', err }, 'Deliberate buy failed with an uncaught error');
    console.error('\nDELIBERATE BUY FAILED:', err && (err as Error).message ? (err as Error).message : err);
    process.exit(2);
});

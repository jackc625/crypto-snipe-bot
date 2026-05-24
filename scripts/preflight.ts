// scripts/preflight.ts
//
// Phase 20 / Plan 20-05 / OPS-LIVE-10 — operator CLI wrapping preflightDryRun().
// Runs every OPS-LIVE-02..07 check the bot would run at startup, prints a
// per-chain pass/fail summary (or --json for machine output), and exits:
//   0 on all-pass
//   1 on ≥1 FATAL preflight failure
//   2 on uncaught throw (defensive)
//
// CRITICAL: this script does NOT start the bot. OPS-LIVE-10 hard requirement.
// scripts/preflight.ts imports preflightDryRun directly from src/preflight.ts;
// it does NOT import bot.ts startMultiChainBot. The preflightCli.test.ts
// integration test verifies the subprocess never prints the bot-startup
// markers.
//
// Usage:
//   npm run preflight              # human-readable per-chain summary
//   npm run preflight -- --json    # machine-readable JSON output

import * as dotenv from 'dotenv';
import { buildChainRegistry } from '../src/chainRegistry';
import { preflightDryRun, type PreflightResult, type PreflightRegistry } from '../src/preflight';
import { logger } from '../src/utils/logger';
import { getProvider, getWallet } from '../src/utils/provider';

dotenv.config();

const log = logger.child({ module: 'preflight-cli' });

/**
 * Build the per-chain PreflightRegistry from buildChainRegistry's output by
 * attaching the per-chain httpProvider + wallet (matches the wiring pattern
 * Plan 20-04 uses in bot.ts startMultiChainBot — same getProvider / getWallet
 * helpers; singleton-cached so calling them here is idempotent with the bot's
 * own future calls).
 */
function buildPreflightRegistry(): PreflightRegistry {
    const registry = buildChainRegistry();
    const preflightRegistry: PreflightRegistry = new Map();
    for (const [name, chain] of registry) {
        if (!chain.enabled) continue;
        const httpProvider = getProvider(chain.name, chain.httpRpcUrl);
        const wallet = getWallet(chain.name, chain.httpRpcUrl);
        // PreflightChain = ChainConfig & { httpProvider; wallet }
        preflightRegistry.set(name, { ...chain, httpProvider, wallet } as any);
    }
    return preflightRegistry;
}

/**
 * Human-readable per-chain summary. Groups results by chain, prints check
 * pass/fail one row at a time as structured pino info lines.
 */
function printHumanSummary(results: PreflightResult[]): void {
    const byChain = new Map<string, PreflightResult[]>();
    for (const r of results) {
        const bucket = byChain.get(r.chain) ?? [];
        bucket.push(r);
        byChain.set(r.chain, bucket);
    }
    for (const [chain, list] of byChain) {
        const passed = list.filter(r => r.passed).length;
        const failed = list.length - passed;
        log.info({ chain, passed, failed }, `--- ${chain.toUpperCase()} ---`);
        for (const r of list) {
            if (r.passed) {
                log.info({ chain: r.chain, check: r.check }, `  PASS ${r.check}`);
            } else {
                log.fatal(
                    {
                        chain: r.chain,
                        check: r.check,
                        reason: r.reason,
                        details: r.details,
                    },
                    `  FAIL ${r.check}: ${r.reason ?? 'no reason'}`,
                );
            }
        }
    }
}

async function main(): Promise<void> {
    const useJson = process.argv.includes('--json');

    const preflightRegistry = buildPreflightRegistry();
    const results = await preflightDryRun(preflightRegistry);
    const failed = results.filter(r => !r.passed);

    if (useJson) {
        // Machine-readable output: print to stdout as a single JSON line so
        // downstream tooling can pipe + parse cleanly.
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ results, failedCount: failed.length, totalChecks: results.length }, null, 2));
    } else {
        printHumanSummary(results);
        if (failed.length > 0) {
            log.fatal(
                { failedCount: failed.length, totalChecks: results.length },
                `Preflight failed: ${failed.length} of ${results.length} checks failed`,
            );
        } else {
            const chainCount = new Set(results.map(r => r.chain)).size;
            log.info(
                { totalChecks: results.length, chainCount },
                `Preflight passed: ${results.length} checks across ${chainCount} chains`,
            );
        }
    }

    process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
    log.fatal(
        { err: err instanceof Error ? err.message : String(err) },
        'Preflight CLI crashed',
    );
    process.exit(2);
});

// scripts/deploy-honeypot-checker.ts
//
// Plan 18-06 Task 3 — per-chain HoneypotChecker deploy CLI wrapper.
//
// Usage:
//   DEPLOY_PRIVATE_KEY=0x... <CHAIN>_RPC_URL=https://... \
//     npx ts-node scripts/deploy-honeypot-checker.ts <chain>
//
//   where <chain> is one of: eth | bsc | base | arb
//
// Why a CLI wrapper (and not direct `npx hardhat ignition deploy`):
//   - Maps the bot's chain identifiers (eth/bsc/base/arb) to the Hardhat
//     network names (mainnet/bsc/base/arbitrum) so the operator-facing
//     command stays consistent with the bot's chain naming.
//   - Fail-fast on missing DEPLOY_PRIVATE_KEY — the operator wallet (D-DEPLOY-KEY)
//     is SEPARATE from the bot wallet's PRIVATE_KEY. Surface this loudly
//     so an operator does not accidentally reuse the bot wallet for deploys.
//   - Pino-structured log lines (matches src/chainRegistry.ts:9 module-child
//     pattern); the console API is intentionally not used per project convention.
//
// Post-deploy operator step (intentionally manual per T-18-23 audit trail):
//   1. Take the deployed address Ignition prints.
//   2. Set <CHAIN>_HONEYPOT_CHECKER_ADDRESS in `.env`. Plan 18-06 Task 1's
//      buildChainRegistry() overlay reads this env to populate
//      chainRegistry[chain].honeypotChecker.deployedAddress.
//   3. Run `npx hardhat verify --network <network> <address>` to push source
//      to the explorer (consumes etherscan.apiKey block added in Task 2).
//
// The wrapper deliberately does NOT auto-update `src/chainRegistry.ts` —
// keeping that step manual ensures a git-history audit trail of which
// contract address became canonical at which commit (T-18-23 mitigation).

import { spawnSync } from 'child_process';
import * as dotenv from 'dotenv';

import { logger } from '../src/utils/logger';

dotenv.config();

const log = logger.child({ module: 'deploy-honeypot-checker' });

// Chain → Hardhat network name. Keys match the bot's chain identifiers
// (src/chainRegistry.ts CHAIN_TEMPLATES); values match the network entries
// in hardhat.config.ts (added in plan 18-06 Task 2).
const CHAIN_TO_NETWORK: Record<string, string> = {
    eth: 'mainnet',
    bsc: 'bsc',
    base: 'base',
    arb: 'arbitrum',
};

const chain = process.argv[2];

if (!chain || !(chain in CHAIN_TO_NETWORK)) {
    log.fatal(
        { chain, valid: Object.keys(CHAIN_TO_NETWORK) },
        'Usage: ts-node scripts/deploy-honeypot-checker.ts <chain>'
    );
    process.exit(1);
}

if (!process.env.DEPLOY_PRIVATE_KEY) {
    log.fatal(
        'DEPLOY_PRIVATE_KEY env var required. Rotate this key out of .env after deploy per D-DEPLOY-KEY.'
    );
    process.exit(1);
}

// Plan 18-WR-08 fix-along: enforce the D-DEPLOY-KEY capability split. An
// operator who copy-pastes from .env.example and uses the same key for both
// PRIVATE_KEY (bot wallet) and DEPLOY_PRIVATE_KEY (deploy wallet) would
// silently bypass the split — if the bot wallet leaks, the attacker could
// then deploy a malicious checker at a trusted address. Fail loud at deploy
// time so the operator must consciously use a separate wallet.
if (process.env.PRIVATE_KEY && process.env.DEPLOY_PRIVATE_KEY === process.env.PRIVATE_KEY) {
    log.fatal(
        'DEPLOY_PRIVATE_KEY must be DISTINCT from PRIVATE_KEY per D-DEPLOY-KEY capability split. ' +
            'If the bot wallet leaks, the attacker drains positions but must NOT be able to deploy ' +
            'a malicious checker at a trusted address. Generate a separate deploy wallet.'
    );
    process.exit(1);
}

const network = CHAIN_TO_NETWORK[chain];
log.info({ chain, network }, 'Deploying HoneypotChecker');

// Spawn `npx hardhat ignition deploy ignition/modules/HoneypotChecker.ts --network <network>`.
// The hardhat config (Task 2) reads DEPLOY_PRIVATE_KEY directly via its
// network-entry guard; the spawn inherits process.env so the key is in
// scope. Ignition handles nonce/receipt/idempotency.
const result = spawnSync(
    'npx',
    ['hardhat', 'ignition', 'deploy', 'ignition/modules/HoneypotChecker.ts', '--network', network],
    {
        stdio: 'inherit',
        env: { ...process.env },
        // shell: true is required on Windows to resolve `npx` (a .cmd shim
        // on Windows) without an ENOENT spawn error. POSIX shells resolve
        // it from PATH natively; cross-platform behavior is identical.
        shell: true,
    }
);

if (result.status !== 0) {
    log.fatal({ status: result.status }, 'Ignition deploy failed');
    process.exit(result.status ?? 1);
}

log.info(
    {
        chain,
        hint: `Paste the deployed address into chainRegistry.ts CHAIN_TEMPLATES.${chain}.honeypotChecker.deployedAddress (operational env: ${chain.toUpperCase()}_HONEYPOT_CHECKER_ADDRESS), then run: npx hardhat verify --network ${network} <ADDRESS>`,
    },
    'Deploy complete'
);

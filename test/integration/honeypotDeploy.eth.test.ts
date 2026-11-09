// test/integration/honeypotDeploy.eth.test.ts
// Plan 18-07 (HONEY-03): asserts that the ETH HoneypotChecker contract is
// deployed and Etherscan-verifiable at the canonical address committed in
// `src/chainRegistry.ts CHAIN_TEMPLATES.eth.defaultHoneypotCheckerAddress`
// (iter-2 Blocker #3). This test cross-checks the resolved address against the
// Hardhat Ignition deployment artifact (T-18-25 mitigation — detects
// env/template drift). The live bytecode check moved to
// test/fork/honeypotDeploy.eth.fork.test.ts in plan 22-15 by operator ruling
// (ESC-RAILS-01), because it needs a real mainnet RPC.

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('HONEY-03: HoneypotChecker deployed on ETH', () => {
    let resolvedAddress: string | null = null;

    beforeAll(async () => {
        if (!process.env.ETH_RPC_URL) return;

        // Resolution precedence matches buildChainRegistry(): env override → template default.
        // Reading the template directly (not the runtime registry) avoids requiring
        // the full ENABLED_CHAINS/FLASHBOTS_AUTH_KEY/etc. validation chain to fire
        // just to look up a static address.
        if (process.env.ETH_HONEYPOT_CHECKER_ADDRESS) {
            resolvedAddress = process.env.ETH_HONEYPOT_CHECKER_ADDRESS;
            return;
        }
        const { CHAIN_TEMPLATES } = await import('../../src/chainRegistry');
        resolvedAddress = CHAIN_TEMPLATES.eth.defaultHoneypotCheckerAddress;
    });

    const ignitionPath = path.resolve(
        __dirname,
        '../../ignition/deployments/chain-1/deployed_addresses.json',
    );
    const hasIgnitionArtifact = fs.existsSync(ignitionPath);
    it.skipIf(!hasIgnitionArtifact || !process.env.ETH_RPC_URL)(
        'resolved address matches Ignition deployment artifact (T-18-25)',
        () => {
            const artifact = JSON.parse(fs.readFileSync(ignitionPath, 'utf8'));
            const artifactAddr = artifact['HoneypotCheckerModule#HoneypotChecker'];
            expect(artifactAddr).toBeTruthy();
            expect(resolvedAddress!.toLowerCase()).toBe(String(artifactAddr).toLowerCase());
        },
    );
});

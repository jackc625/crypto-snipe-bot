// test/fork/honeypotDeploy.eth.fork.test.ts
// Plan 18-07 (HONEY-03): asserts that the ETH HoneypotChecker contract is deployed at the canonical
// address committed in `src/chainRegistry.ts CHAIN_TEMPLATES.eth.defaultHoneypotCheckerAddress`
// (iter-2 Blocker #3).
//
// Moved here from test/integration/honeypotDeploy.eth.test.ts in plan 22-15 by operator ruling
// (.planning/audit/escalations/ESC-RAILS-01.json). It needs a real mainnet RPC, which the rails deny
// to the integration project. The assertions are unchanged. It has not run in this file yet: the
// first real `npm run test:fork` must check it by name (UFV-05, owner Phase 25).
//
// The URL comes from the one shell-only resolver (22-11), like every other fork file. An unset
// ETH_FORK_RPC_URL is a clear error, not a skip.
//
// The address comes from buildChainRegistry(), which applies the same precedence the old file wrote
// out by hand: ETH_HONEYPOT_CHECKER_ADDRESS, then the template default. A fork test may not read
// that key itself (test/unit/rails/forkShellOnly.test.ts): the fork rails replace it, with an empty
// sentinel, so in a fork worker the template default is what resolves.

import { describe, it, expect, beforeAll } from 'vitest';
import { JsonRpcProvider } from 'ethers';
import { resolveForkRpcUrl } from './helpers/forkRpcUrl';

describe('HONEY-03: HoneypotChecker deployed on ETH', () => {
    let provider: JsonRpcProvider | null = null;
    let resolvedAddress: string | null = null;

    beforeAll(async () => {
        provider = new JsonRpcProvider(resolveForkRpcUrl());
        const { buildChainRegistry } = await import('../../src/chainRegistry');
        resolvedAddress = buildChainRegistry().get('eth')?.honeypotChecker.deployedAddress ?? null;
    });

    it('has bytecode at deployedAddress (not 0x)', async () => {
        expect(provider).not.toBeNull();
        expect(resolvedAddress).not.toBeNull();
        const code = await provider!.getCode(resolvedAddress!);
        expect(code).not.toBe('0x');
        expect(code.length).toBeGreaterThan(100);
    });
});

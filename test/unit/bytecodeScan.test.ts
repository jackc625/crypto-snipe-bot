// test/unit/bytecodeScan.test.ts
//
// HONEY-12 unit tests for `isMutableTokenForChain` (src/utils/honeypot/bytecodeScan.ts).
//
// Pattern mirrors test/unit/tokenSafety.test.ts: mock the provider via a
// minimal fake `ChainContext` shape and assert both the return-value shape
// AND that `getCode` was called with the expected `tokenAddress` argument
// (Phase 17 D-04 observable-effect rigor — never just assert return values).
//
// Six test cases:
//   1. Bytecode contains `setTax(uint256)` selector (`2e5bb6ff`)  -> isMutable=true, hits=['2e5bb6ff']
//   2. Bytecode contains no selector                              -> isMutable=false, hits=[]
//   3. getCode returns '0x' (EOA / not-deployed)                  -> isMutable=false, hits=[]
//   4. getCode throws (RPC timeout)                               -> isMutable=true, hits=['scan-failed'] (fail-closed)
//   5. Bytecode contains MIXED-CASE selector ('0X2E5BB6FF')       -> isMutable=true (case-insensitive)
//   6. Bytecode contains TWO selectors (`2e5bb6ff` + `153b0d1e`)  -> hits length 2 with both signatures present

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isMutableTokenForChain, MUTABLE_SELECTORS } from '../../src/utils/honeypot/bytecodeScan';

// Minimal `ChainContext`-shaped stub. We only exercise `httpProvider.getCode`
// and `log.warn`; the rest of the surface is irrelevant to HONEY-12.
function makeCtx(getCodeImpl: (addr: string) => Promise<string>) {
    const warn = vi.fn();
    return {
        ctx: {
            httpProvider: {
                getCode: vi.fn(getCodeImpl),
            },
            log: {
                warn,
                info: vi.fn(),
                debug: vi.fn(),
                error: vi.fn(),
            },
        },
        warn,
    };
}

const TOKEN = '0x1234567890abcdef1234567890abcdef12345678';

describe('isMutableTokenForChain (HONEY-12)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('Test 1: bytecode containing setTax(uint256) selector returns isMutable=true with the selector in hits', async () => {
        // setTax(uint256) selector: 2e5bb6ff (without 0x prefix). Embed into arbitrary bytecode prefix.
        const code = '0x6080604052' + '2e5bb6ff' + 'deadbeef';
        const { ctx } = makeCtx(async () => code);

        const result = await isMutableTokenForChain(ctx as any, TOKEN);

        expect(result.isMutable).toBe(true);
        expect(result.hits).toContain('2e5bb6ff');
        // Observable-effect (Phase 17 D-04): assert the RPC was actually called.
        expect(ctx.httpProvider.getCode).toHaveBeenCalledWith(TOKEN);
        expect(ctx.httpProvider.getCode).toHaveBeenCalledTimes(1);
    });

    it('Test 2: bytecode with no matching selector returns isMutable=false and empty hits', async () => {
        const code = '0x6080604052aabbccdd11223344556677889900';
        const { ctx } = makeCtx(async () => code);

        const result = await isMutableTokenForChain(ctx as any, TOKEN);

        expect(result.isMutable).toBe(false);
        expect(result.hits).toEqual([]);
        expect(ctx.httpProvider.getCode).toHaveBeenCalledWith(TOKEN);
    });

    it('Test 3: getCode returning "0x" (empty / EOA / non-deployed) returns isMutable=false', async () => {
        const { ctx } = makeCtx(async () => '0x');

        const result = await isMutableTokenForChain(ctx as any, TOKEN);

        expect(result.isMutable).toBe(false);
        expect(result.hits).toEqual([]);
        expect(ctx.httpProvider.getCode).toHaveBeenCalledWith(TOKEN);
    });

    it('Test 4: getCode throws -> fail-closed: isMutable=true and hits=["scan-failed"]', async () => {
        const { ctx, warn } = makeCtx(async () => { throw new Error('RPC timeout'); });

        const result = await isMutableTokenForChain(ctx as any, TOKEN);

        expect(result.isMutable).toBe(true);
        expect(result.hits).toEqual(['scan-failed']);
        // Observable effect: getCode was attempted AND warning was logged.
        expect(ctx.httpProvider.getCode).toHaveBeenCalledWith(TOKEN);
        expect(warn).toHaveBeenCalled();
        const warnCall = warn.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
        expect(warnCall?.check).toBe('bytecodeScan');
        expect(warnCall?.token).toBe(TOKEN);
    });

    it('Test 5: mixed-case selector "0X2E5BB6FF" in bytecode matches via .toLowerCase()', async () => {
        const code = '0X6080604052' + '2E5BB6FF' + 'DEADBEEF';
        const { ctx } = makeCtx(async () => code);

        const result = await isMutableTokenForChain(ctx as any, TOKEN);

        expect(result.isMutable).toBe(true);
        expect(result.hits).toContain('2e5bb6ff');
        expect(ctx.httpProvider.getCode).toHaveBeenCalledWith(TOKEN);
    });

    it('Test 6: bytecode containing TWO selectors yields hits of length 2 (both present)', async () => {
        // 2e5bb6ff = setTax(uint256); 153b0d1e = setBlacklist(address,bool)
        const code = '0x6080604052' + '2e5bb6ff' + 'ffffffff' + '153b0d1e' + 'cafe';
        const { ctx } = makeCtx(async () => code);

        const result = await isMutableTokenForChain(ctx as any, TOKEN);

        expect(result.isMutable).toBe(true);
        expect(result.hits).toHaveLength(2);
        expect(result.hits).toEqual(expect.arrayContaining(['2e5bb6ff', '153b0d1e']));
        expect(ctx.httpProvider.getCode).toHaveBeenCalledWith(TOKEN);
    });

    it('exposes all 19 selectors from the HONEY-12 verified table', () => {
        // Sanity check on the exported constant — guards against accidental
        // deletion of selectors via refactor.
        expect(MUTABLE_SELECTORS).toHaveLength(19);
        const required = [
            '2e5bb6ff', '667f6526', 'dc1052e2', '8cd09d50', '6081752b',
            '49abdc14', '0b78f9c0', '5d0044ca', 'ea1644d5', 'ec28438a',
            '153b0d1e', '4e054a67', 'f9f92be4', 'e57f14e1', 'c0246668',
            '1031e36e', '365ec5e5', '8f70ccf7', 'c2e5ec04',
        ];
        for (const sel of required) {
            expect(MUTABLE_SELECTORS).toContain(sel);
        }
    });
});

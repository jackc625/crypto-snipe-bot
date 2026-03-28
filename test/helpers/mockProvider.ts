// test/helpers/mockProvider.ts
// Shared MockProvider and MockContract factories for all tests.
// Returns objects with vi.fn() mocks matching ethers v6 provider/contract API.

import { vi } from 'vitest';

/**
 * Create a mock ethers v6 JsonRpcProvider with sensible defaults.
 * All methods are vi.fn() mocks that can be overridden.
 */
export function createMockProvider(overrides: Record<string, unknown> = {}) {
    return {
        getCode: vi.fn().mockResolvedValue('0x6080604052'),
        getBlockNumber: vi.fn().mockResolvedValue(18000000),
        getTransactionCount: vi.fn().mockResolvedValue(42),
        getNetwork: vi.fn().mockResolvedValue({ chainId: 1n }),
        getFeeData: vi.fn().mockResolvedValue({
            gasPrice: 30000000000n,
            maxFeePerGas: 30000000000n,
            maxPriorityFeePerGas: 1000000000n,
        }),
        getBalance: vi.fn().mockResolvedValue(1000000000000000000n), // 1 ETH
        call: vi.fn().mockResolvedValue('0x'),
        estimateGas: vi.fn().mockResolvedValue(21000n),
        broadcastTransaction: vi.fn().mockResolvedValue({
            hash: '0xmocktxhash',
            wait: vi.fn().mockResolvedValue({ status: 1, blockNumber: 18000001 }),
        }),
        waitForTransaction: vi.fn().mockResolvedValue({ status: 1, blockNumber: 18000001 }),
        getTransactionReceipt: vi.fn().mockResolvedValue({ status: 1, blockNumber: 18000001 }),
        ...overrides,
    };
}

/**
 * Create a mock ethers v6 Contract with vi.fn() wrappers for each method.
 * Also creates `.staticCall` variants and `.interface.encodeFunctionData` mock.
 *
 * @param methods - Map of method names to their mock return values
 */
export function createMockContract(methods: Record<string, unknown> = {}) {
    const contract: Record<string, unknown> = {};
    const staticCall: Record<string, unknown> = {};

    for (const [name, returnValue] of Object.entries(methods)) {
        contract[name] = vi.fn().mockResolvedValue(returnValue);
        staticCall[name] = vi.fn().mockResolvedValue(returnValue);
    }

    contract.staticCall = staticCall;
    contract.interface = {
        encodeFunctionData: vi.fn().mockReturnValue('0xmockencoded'),
        decodeFunctionResult: vi.fn().mockReturnValue([]),
    };

    return contract;
}

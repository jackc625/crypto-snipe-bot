// test/fixtures/receipt.fixtures.ts
// Mock TransactionReceipt and Log factories for receiptDecoder unit tests.
// Covers V2 Withdrawal, V3 Transfer, spoofed logs, malformed logs, and retry scenarios.

import { Interface } from 'ethers';

export const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
export const WALLET_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
export const FAKE_TX_HASH = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
export const FOREIGN_TOKEN_ADDRESS = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

const wethIface = new Interface([
    'event Withdrawal(address indexed src, uint256 wad)',
    'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

export interface MockLog {
    address: string;
    topics: string[];
    data: string;
}

export interface MockReceipt {
    gasUsed: bigint;
    gasPrice: bigint | null;
    blockNumber: number;
    logs: MockLog[];
}

export function createMockLog(overrides: Partial<MockLog> = {}): MockLog {
    return {
        address: WETH_ADDRESS,
        topics: [],
        data: '0x',
        ...overrides,
    };
}

export function createMockReceipt(overrides: Partial<MockReceipt> = {}): MockReceipt {
    return {
        gasUsed: 150000n,
        gasPrice: 20000000000n, // 20 gwei
        blockNumber: 12345678,
        logs: [],
        ...overrides,
    };
}

/**
 * Build an encoded WETH Withdrawal log.
 * Emits: Withdrawal(address indexed src, uint256 wad)
 */
export function createWithdrawalLog(
    wethAddress: string,
    srcAddress: string,
    wadBigint: bigint,
): MockLog {
    const event = wethIface.getEvent('Withdrawal')!;
    const encoded = wethIface.encodeEventLog(event, [srcAddress, wadBigint]);
    return {
        address: wethAddress,
        topics: [...encoded.topics],
        data: encoded.data,
    };
}

/**
 * Build an encoded WETH Transfer log.
 * Emits: Transfer(address indexed from, address indexed to, uint256 value)
 */
export function createTransferLog(
    wethAddress: string,
    fromAddress: string,
    toAddress: string,
    valueBigint: bigint,
): MockLog {
    const event = wethIface.getEvent('Transfer')!;
    const encoded = wethIface.encodeEventLog(event, [fromAddress, toAddress, valueBigint]);
    return {
        address: wethAddress,
        topics: [...encoded.topics],
        data: encoded.data,
    };
}

/**
 * Build a malformed WETH log -- correct address, but topics/data that cannot be parsed.
 * Used to verify parseLog failure does not throw.
 */
export function createMalformedWethLog(wethAddress: string): MockLog {
    return {
        address: wethAddress,
        // Unknown topic hash -- not Withdrawal, not Transfer
        topics: ['0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'],
        data: '0xnotvalidhexdata',
    };
}

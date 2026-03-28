// test/fixtures/tokenSafety.fixtures.ts
// Canned API responses for safety check mocking.
// Factory functions return typed mock data for honeypot.is, GoPlus, and Unicrypt APIs.

/** Standard mock token address for tests */
export const MOCK_TOKEN_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';

/** Standard mock pair address for tests */
export const MOCK_PAIR_ADDRESS = '0xabcdef1234567890abcdef1234567890abcdef12';

/**
 * Mock honeypot.is API response (safe token by default).
 */
export function mockHoneypotResponse(overrides: Record<string, unknown> = {}) {
    return {
        isHoneypot: false,
        simulationResult: {
            buyTax: 0,
            sellTax: 0,
            transferTax: 0,
        },
        ...overrides,
    };
}

/**
 * Mock honeypot.is API response for a confirmed honeypot.
 */
export function mockHoneypotHoneypotResponse() {
    return {
        isHoneypot: true,
        simulationResult: {
            buyTax: 100,
            sellTax: 100,
            transferTax: 100,
        },
    };
}

/**
 * Mock GoPlus Security API response (safe token by default).
 * Follows GoPlus response shape: { result: { [address]: { ...fields } } }
 */
export function mockGoPlusResponse(overrides: Record<string, string> = {}) {
    return {
        result: {
            '0xtoken': {
                is_honeypot: '0',
                buy_tax: '0',
                sell_tax: '0',
                is_blacklisted: '0',
                is_open_source: '1',
                ...overrides,
            },
        },
    };
}

/**
 * Mock Unicrypt lock data response.
 * Returns an array of lock entries with future unlock dates.
 */
export function mockUnicryptResponse() {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60; // 1 year from now
    return {
        locks: [
            {
                id: 1,
                lock_date: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60, // 30 days ago
                unlock_date: futureTimestamp,
                amount: '1000000000000000000000',
                owner: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
            },
        ],
    };
}

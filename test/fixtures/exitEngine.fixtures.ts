// test/fixtures/exitEngine.fixtures.ts
// Shared fixtures for exit engine unit tests.
// These provide typed mock data without importing production modules that
// require live DB/network connections.

/** Mock ExitStateData shape (mirrors src/exitEngine.ts ExitStateData) */
export interface MockExitState {
    tradeId: number;
    entryPrice: number;
    highWaterMark: number;
    trailingActivated: boolean;
    completedTierIndices: Set<number>;
    originalTokenAmount: bigint;
    urgencyStartTs: number;
}

export function createMockExitState(overrides: Partial<MockExitState> = {}): MockExitState {
    return {
        tradeId: 1,
        entryPrice: 1000,
        highWaterMark: 1000,
        trailingActivated: false,
        completedTierIndices: new Set(),
        originalTokenAmount: 1000000000000000000n, // 1e18
        urgencyStartTs: Date.now(),
        ...overrides,
    };
}

/** Mock partial sell tier */
export interface MockPartialTier {
    multiple: number;
    percent: number;
}

export function createMockTiers(): MockPartialTier[] {
    return [
        { multiple: 2.0, percent: 50 },
        { multiple: 5.0, percent: 25 },
    ];
}

/** Price sequences for testing trailing stop behavior */
export const priceSequences = {
    /** Price rises to 2.5x then drops -- should trigger trailing stop */
    trailingStopTrigger: [1000, 1200, 1800, 2200, 2500, 2400, 2100, 1900],
    /** Price rises but never reaches 2x -- trailing never activates */
    belowActivation: [1000, 1100, 1300, 1500, 1200, 900],
    /** Price gaps from 1.5x to 6x -- should trigger combined partial sell */
    gapSell: [1000, 1500, 6000],
    /** Steady price with high volatility */
    highVolatility: [1000, 1500, 800, 1600, 700, 1400, 900, 1500],
    /** Steady price with low volatility */
    lowVolatility: [1000, 1010, 990, 1005, 995, 1002, 998, 1001],
};

/**
 * exit_state row shape for DB round-trip tests: every column of the version 7 table, in table
 * order (test/realpath/migrations/fixtures/schema-v7.json, the recording of the real migrations).
 * test/unit/helpers.smoke.test.ts checks these keys against a table built by the real migrateSchema,
 * so a migration that adds or drops a column fails there (Phase 23 plan 23-14, AUD-TESTI-001).
 */
export function createMockExitStateRow() {
    return {
        trade_id: 1,
        entry_price: 1000,
        high_water_mark: 2500,
        trailing_activated: 1,
        partial_tiers_completed: JSON.stringify([0]),
        original_token_amount: '1000000000000000000',
        urgency_start_ts: Date.now() - 10 * 60 * 1000, // 10 min ago
        volatility_samples: JSON.stringify([1000, 1200, 1800, 2200, 2500]),
        exit_failure_count: 0, // version 7: INTEGER NOT NULL DEFAULT 0
        exit_status: null as string | null, // version 7: NULL, or 'exit_failed_held'
    };
}

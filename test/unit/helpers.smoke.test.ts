// test/unit/helpers.smoke.test.ts
// Smoke test: imports all helpers and fixtures, asserts they compile and export correctly.
// If any helper has a syntax error, missing export, or broken dependency, this test fails.

import { describe, it, expect } from 'vitest';
import { createMockProvider, createMockContract } from '../helpers/mockProvider';
import { createTestDb } from '../helpers/testDb';
import { CURRENT_SCHEMA_VERSION } from '../../src/utils/dbSchema';
import { mockHoneypotResponse, mockGoPlusResponse, MOCK_TOKEN_ADDRESS } from '../fixtures/tokenSafety.fixtures';
import { createMockTxRequest, createMockBundleResponse, createMockFlashbotsProvider } from '../fixtures/txManager.fixtures';
import { createMockExitStateRow } from '../fixtures/exitEngine.fixtures';

describe('helpers smoke test', () => {
    it('createMockProvider is a function', () => { expect(typeof createMockProvider).toBe('function'); });
    it('createMockContract is a function', () => { expect(typeof createMockContract).toBe('function'); });
    it('createTestDb is a function', () => { expect(typeof createTestDb).toBe('function'); });
    it('mockHoneypotResponse is a function', () => { expect(typeof mockHoneypotResponse).toBe('function'); });
    it('mockGoPlusResponse is a function', () => { expect(typeof mockGoPlusResponse).toBe('function'); });
    it('MOCK_TOKEN_ADDRESS is a string', () => { expect(typeof MOCK_TOKEN_ADDRESS).toBe('string'); });
    it('createMockTxRequest is a function', () => { expect(typeof createMockTxRequest).toBe('function'); });
    it('createMockBundleResponse is a function', () => { expect(typeof createMockBundleResponse).toBe('function'); });
    it('createMockFlashbotsProvider is a function', () => { expect(typeof createMockFlashbotsProvider).toBe('function'); });
    // closes-finding: AUD-TESTI-001 (rail test: createTestDb is built by the real migrations, AC-07; RED proof 23-03-ac07-red.txt)
    it('createTestDb returns a working in-memory DB', () => {
        const db = createTestDb();
        // In-memory SQLite uses journal_mode=memory (WAL pragma issued but not applicable to :memory:)
        const row = db.pragma('journal_mode') as any[];
        expect(row[0].journal_mode).toBe('memory');
        // Verify schema is present (trades table exists with correct columns)
        const info = db.prepare("PRAGMA table_info('trades')").all() as any[];
        const columns = info.map((c: any) => c.name);
        expect(columns).toContain('token');
        expect(columns).toContain('pool_type');
        expect(columns).toContain('fee_tier');
        // Verify user_version is the current production schema version (the helper is built by
        // the real migrations, Phase 23 plan 23-03, AC-07)
        const version = db.pragma('user_version', { simple: true });
        expect(version).toBe(CURRENT_SCHEMA_VERSION);
        db.close();
    });
    // closes-finding: AUD-TESTI-001 (fixture half: the exit_state row fixture has the migrated table's columns; RED proof 23-14-8-exit-state-fixture-shape.txt)
    it('createMockExitStateRow has exactly the columns of the exit_state table the real migrations build', () => {
        const db = createTestDb();
        try {
            const columns = (db.prepare("PRAGMA table_info('exit_state')").all() as Array<{ name: string }>).map((c) => c.name);
            expect(Object.keys(createMockExitStateRow())).toEqual(columns);
            // The row the fixture describes is one the real table accepts as is.
            db.prepare(
                "INSERT INTO trades (id, token, chain, action, status) VALUES (1, '0x0000000000000000000000000000000000000001', 'eth', 'buy', 'pending')",
            ).run();
            const row = createMockExitStateRow();
            const names = Object.keys(row);
            db.prepare(`INSERT INTO exit_state (${names.join(', ')}) VALUES (${names.map((n) => '@' + n).join(', ')})`).run(row);
            expect(db.prepare('SELECT * FROM exit_state WHERE trade_id = 1').get()).toEqual(row);
        } finally {
            db.close();
        }
    });
});

// test/unit/helpers.smoke.test.ts
// Smoke test: imports all helpers and fixtures, asserts they compile and export correctly.
// If any helper has a syntax error, missing export, or broken dependency, this test fails.

import { describe, it, expect } from 'vitest';
import { createMockProvider, createMockContract } from '../helpers/mockProvider';
import { createTestDb } from '../helpers/testDb';
import { mockHoneypotResponse, mockGoPlusResponse, MOCK_TOKEN_ADDRESS } from '../fixtures/tokenSafety.fixtures';
import { createMockTxRequest, createMockBundleResponse, createMockFlashbotsProvider } from '../fixtures/txManager.fixtures';

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
        // Verify user_version is 3
        const version = db.pragma('user_version', { simple: true });
        expect(version).toBe(3);
        db.close();
    });
});

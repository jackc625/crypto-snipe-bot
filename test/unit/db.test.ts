// test/unit/db.test.ts
// Unit tests for SQLite storage layer (TEST-02).
// Uses in-memory SQLite via createTestDb() for isolation -- zero disk I/O.

import { describe, it, expect } from 'vitest';
import { createTestDb } from '../helpers/testDb';

describe('SQLite storage (TEST-02)', () => {
    describe('concurrent writes', () => {
        it('100 rapid sequential inserts produce count=100 (zero data loss)', () => {
            const db = createTestDb();
            const insert = db.prepare(
                `INSERT INTO trades (token, chain, action, status, amount_in) VALUES (?, 'eth', 'buy', 'pending', '0.01')`
            );

            for (let i = 0; i < 100; i++) {
                insert.run(`0xtoken${i}`);
            }

            const count = db.prepare('SELECT COUNT(*) as c FROM trades').get() as { c: number };
            expect(count.c).toBe(100);
            db.close();
        });
    });

    describe('transactions', () => {
        it('transaction with two inserts commits both rows', () => {
            const db = createTestDb();
            const insert = db.prepare(
                `INSERT INTO trades (token, chain, action, status, amount_in) VALUES (?, 'eth', 'buy', 'pending', '0.01')`
            );

            const insertTwo = db.transaction(() => {
                insert.run('0xtokenA');
                insert.run('0xtokenB');
            });
            insertTwo();

            const count = db.prepare('SELECT COUNT(*) as c FROM trades').get() as { c: number };
            expect(count.c).toBe(2);
            db.close();
        });

        it('transaction with CHECK constraint violation rolls back entirely', () => {
            const db = createTestDb();
            const insertValid = db.prepare(
                `INSERT INTO trades (token, chain, action, status, amount_in) VALUES (?, 'eth', 'buy', 'pending', '0.01')`
            );
            const insertInvalid = db.prepare(
                `INSERT INTO trades (token, chain, action, status, amount_in) VALUES (?, 'eth', 'INVALID_ACTION', 'pending', '0.01')`
            );

            const insertBoth = db.transaction(() => {
                insertValid.run('0xtokenA');
                insertInvalid.run('0xtokenB'); // Should fail CHECK constraint
            });

            expect(() => insertBoth()).toThrow();

            const count = db.prepare('SELECT COUNT(*) as c FROM trades').get() as { c: number };
            expect(count.c).toBe(0); // Rolled back
            db.close();
        });
    });

    describe('pragmas', () => {
        it('WAL mode: in-memory DB returns journal_mode=memory', () => {
            const db = createTestDb();
            const result = db.pragma('journal_mode', { simple: true });
            // In-memory SQLite uses 'memory' even when WAL is requested (D-09 from STATE)
            expect(result).toBe('memory');
            db.close();
        });

        it('Schema v3: user_version pragma returns 3', () => {
            const db = createTestDb();
            const version = db.pragma('user_version', { simple: true });
            expect(version).toBe(3);
            db.close();
        });
    });

    describe('foreign keys', () => {
        it('exit_state FOREIGN KEY: insert without matching trade fails when enforced', () => {
            const db = createTestDb();
            db.pragma('foreign_keys = ON');

            const insertExit = db.prepare(
                `INSERT INTO exit_state (trade_id, entry_price, high_water_mark, trailing_activated, original_token_amount, urgency_start_ts) VALUES (?, 1000, 1000, 0, '1000000', ?)`
            );

            expect(() => insertExit.run(99999, Date.now())).toThrow();
            db.close();
        });
    });

    describe('schema validation', () => {
        it('trades table has expected columns', () => {
            const db = createTestDb();
            const columns = db.prepare("PRAGMA table_info('trades')").all() as Array<{ name: string }>;
            const columnNames = columns.map(c => c.name);

            expect(columnNames).toContain('token');
            expect(columnNames).toContain('chain');
            expect(columnNames).toContain('action');
            expect(columnNames).toContain('status');
            expect(columnNames).toContain('pool_type');
            expect(columnNames).toContain('fee_tier');
            expect(columnNames).toContain('amount_in');
            expect(columnNames).toContain('amount_out');
            expect(columnNames).toContain('gas_cost');
            expect(columnNames).toContain('price_at_action');
            expect(columnNames).toContain('tx_hash');
            expect(columnNames).toContain('block');
            expect(columnNames).toContain('timestamp');
            db.close();
        });

        it('exit_state table has expected columns', () => {
            const db = createTestDb();
            const columns = db.prepare("PRAGMA table_info('exit_state')").all() as Array<{ name: string }>;
            const columnNames = columns.map(c => c.name);

            expect(columnNames).toContain('trade_id');
            expect(columnNames).toContain('entry_price');
            expect(columnNames).toContain('high_water_mark');
            expect(columnNames).toContain('trailing_activated');
            expect(columnNames).toContain('partial_tiers_completed');
            expect(columnNames).toContain('original_token_amount');
            expect(columnNames).toContain('urgency_start_ts');
            expect(columnNames).toContain('volatility_samples');
            db.close();
        });
    });
});

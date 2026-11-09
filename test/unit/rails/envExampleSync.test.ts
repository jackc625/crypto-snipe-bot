// test/unit/rails/envExampleSync.test.ts
// Phase 22 plan 22-08 Task 2 — SAFE-02 D-02 / D-ENV-EXAMPLE: the committed sentinel env file
// test/.env.test stays in lock-step with .env.example, its values stay inert, and the one-path
// .gitignore negation that keeps it committed is in place.
//
// Read with fs only. A test may not run git: the 22-11 spawn gate allows no child process
// outside spawnRailedChild, whose commands are Node / npx only. The plan-level verify in
// 22-05 proved with `git check-ignore` that the file stays committed.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as dotenv from 'dotenv';

const REPO = path.resolve(__dirname, '..', '..', '..');
const example = dotenv.parse(fs.readFileSync(path.join(REPO, '.env.example')));
const sentinels = dotenv.parse(fs.readFileSync(path.join(REPO, 'test', '.env.test')));

// Hardhat account #0 — a public, well-known key. A sentinel must never equal it (D-02).
const HARDHAT_0 = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

function bitsPerChar(s: string): number {
    if (s.length === 0) return 0;
    const counts = new Map<string, number>();
    for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
    let h = 0;
    for (const n of counts.values()) {
        const p = n / s.length;
        h -= p * Math.log2(p);
    }
    return h;
}

const isSecretLikeName = (k: string) => /TOKEN|SESSION|HASH|SECRET|PASSWORD|AUTH|API_KEY/.test(k) || /_KEY$/.test(k);
const isPrivateKeyShaped = (k: string, v: string) => /PRIVATE_KEY|FLASHBOTS_AUTH_KEY/.test(k) || /^(0x)?[0-9a-fA-F]{64}$/.test(v);

describe('test/.env.test is in sync with .env.example (D-02, D-ENV-EXAMPLE)', () => {
    it('the two files have exactly the same key set', () => {
        const a = Object.keys(example).sort();
        const b = Object.keys(sentinels).sort();
        expect(a.length).toBeGreaterThan(100);
        expect(b).toEqual(a);
        expect(b).toContain('ETH_FORK_RPC_URL');
    });

    it('every private-key-shaped sentinel is a distinct small-integer key, never Hardhat #0', () => {
        const pk = Object.entries(sentinels).filter(([k, v]) => isPrivateKeyShaped(k, v));
        expect(pk.length).toBeGreaterThanOrEqual(4);
        const seen = new Set<string>();
        for (const [k, v] of pk) {
            expect(v, k).toMatch(/^0x[0-9a-fA-F]{64}$/);
            const n = BigInt(v);
            expect(n > 0n && n <= 0xffffn, `${k} is not a small-integer key`).toBe(true);
            expect(v.slice(2).toLowerCase(), k).not.toBe(HARDHAT_0);
            expect(seen.has(v), `${k} reuses another sentinel key`).toBe(false);
            seen.add(v);
        }
    });

    it('every secret-like sentinel is at most 3.0 bits per character', () => {
        const secretLike = Object.entries(sentinels).filter(([k]) => isSecretLikeName(k));
        expect(secretLike.length).toBeGreaterThanOrEqual(10);
        const tooHigh = secretLike.filter(([, v]) => bitsPerChar(v) > 3.0).map(([k]) => k);
        expect(tooHigh).toEqual([]);
    });
});

describe('.gitignore keeps the sentinel file committed (one-path negation)', () => {
    it('the !test/.env.test negation is the next rule directly after !.env.example', () => {
        const lines = fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8').split(/\r?\n/);
        const i = lines.findIndex((l) => l.trim() === '!.env.example');
        expect(i).toBeGreaterThanOrEqual(0);
        const next = lines.slice(i + 1).find((l) => l.trim() !== '' && !l.trim().startsWith('#'));
        expect(next?.trim()).toBe('!test/.env.test');
        // A one-path negation only: no broader un-ignore of test env files.
        expect(lines.filter((l) => /^!.*\.env/.test(l.trim())).map((l) => l.trim()).sort()).toEqual(['!.env.example', '!test/.env.test']);
    });
});

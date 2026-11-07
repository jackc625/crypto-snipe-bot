// test/unit/rails/forkRehearsalParity.test.ts
// Phase 22 plan 22-08 Task 3 — pins the Hardhat-free fork rehearsal config to the real fork
// project of vitest.config.ts, so the rehearsal keeps rehearsing what the fork project does.
// The ONLY intended difference is the globalSetup: the rehearsal has the rail-ledger run record
// only, never test/fork/setup.ts (which starts Hardhat).

import { describe, it, expect } from 'vitest';
import mainConfig from '../../../vitest.config';
import rehearsalConfig from '../../rails/vitest.fork-rehearsal.config';

interface ProjectTest {
    name?: string;
    include?: string[];
    setupFiles?: string[];
    globalSetup?: string[];
    fileParallelism?: boolean;
    pool?: unknown;
    testTimeout?: number;
    hookTimeout?: number;
    mockReset?: boolean;
    environment?: string;
    env?: Record<string, string>;
}
type Cfg = { envDir?: unknown; test?: { projects?: Array<{ test?: ProjectTest }> } };

function project(cfg: unknown, name: string): ProjectTest {
    const p = ((cfg as Cfg).test?.projects ?? []).find((x) => x.test?.name === name);
    if (!p || !p.test) throw new Error(`project ${name} not found`);
    return p.test;
}

const fork = project(mainConfig, 'fork');
const rehearsal = project(rehearsalConfig, 'fork-rehearsal');

describe('fork rehearsal parity with the fork project', () => {
    it('setupFiles, fileParallelism, pool, timeouts, mockReset and environment are equal', () => {
        for (const k of ['setupFiles', 'fileParallelism', 'pool', 'testTimeout', 'hookTimeout', 'mockReset', 'environment'] as const) {
            expect(rehearsal[k], k).toEqual(fork[k]);
        }
        expect(rehearsal.setupFiles).toEqual(['test/rails/setup-fork.cjs']);
        expect(rehearsal.fileParallelism).toBe(false);
    });

    it('the rehearsal has no globalSetup other than the rail-ledger run record (no Hardhat)', () => {
        expect(rehearsal.globalSetup).toEqual(['test/rails/ledgerRun.ts']);
        expect(fork.globalSetup).toEqual(['test/fork/setup.ts']);
    });

    it('the rehearsal include matches only test/fork/rails/', () => {
        expect(rehearsal.include).toEqual(['test/fork/rails/**/*.test.ts']);
        expect((rehearsal.include ?? []).every((g) => g.startsWith('test/fork/rails/'))).toBe(true);
    });

    it('the rehearsal loads no .env and labels its ledger project', () => {
        expect((rehearsalConfig as Cfg).envDir).toBe(false);
        expect(rehearsal.env).toEqual({ CSB_RAIL_PROJECT: 'fork-rehearsal' });
    });
});

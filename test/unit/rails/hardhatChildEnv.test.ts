// test/unit/rails/hardhatChildEnv.test.ts
// Phase 22 plan 22-11 — SAFE-02 D-03 / AC-17: the exempt Hardhat child is launched railed, with
// a sanitized env, so hardhat.config.ts's dotenv.config() (hardhat.config.ts:9) is blocked and
// the real deploy key and RPC values never enter it. Never calls setup() and never starts
// Hardhat: the first real launch is obligation UFV-04 (owner Phase 25).

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { buildHardhatChildEnv } from '../../fork/helpers/hardhatChildEnv';
import { readSentinels, REPO_ROOT, spawnRailedChild } from '../../rails/spawnRailedChild';

const SETUP_FORK = path.join(REPO_ROOT, 'test', 'rails', 'setup-fork.cjs');

describe('buildHardhatChildEnv', () => {
    const sentinels = readSentinels();
    const planted: NodeJS.ProcessEnv = {
        ETH_FORK_RPC_URL: 'http://127.0.0.1:9/hh-marker',
        ALLOW_REAL_MAINNET: '1',
        DEPLOY_PRIVATE_KEY: 'planted-not-sentinel',
        ALCHEMY_URL: 'http://127.0.0.1:9/alchemy-planted',
        SOME_OTHER_VAR: 'x',
        NODE_OPTIONS: '--require ./planted-preload.cjs',
        PATH: '/planted/path',
        TEMP: '/planted/temp',
    };

    it('(a) replaces app keys with sentinels, keeps the two shell keys, drops anything else, and loads the fork rails', () => {
        const env = buildHardhatChildEnv(planted);
        expect(env.DEPLOY_PRIVATE_KEY).toBe(sentinels.DEPLOY_PRIVATE_KEY);
        expect(env.ALCHEMY_URL).toBe(sentinels.ALCHEMY_URL);
        expect(env.ETH_FORK_RPC_URL).toBe('http://127.0.0.1:9/hh-marker');
        expect(env.ALLOW_REAL_MAINNET).toBe('1');
        expect('SOME_OTHER_VAR' in env).toBe(false);
        expect(env.PATH).toBe('/planted/path');
        expect(env.TEMP).toBe('/planted/temp');
        expect(env.NODE_OPTIONS).toBe(`--require ${JSON.stringify(SETUP_FORK)}`);
        expect(path.isAbsolute(SETUP_FORK)).toBe(true);
    });

    it('(a) contains every test/.env.test key and leaves the shell keys at their sentinels when the shell has none', () => {
        const env = buildHardhatChildEnv({ PATH: '/planted/path' });
        for (const key of Object.keys(sentinels)) expect(key in env).toBe(true);
        expect(env.ETH_FORK_RPC_URL).toBe(sentinels.ETH_FORK_RPC_URL);
        expect(env.ALLOW_REAL_MAINNET).toBe(sentinels.ALLOW_REAL_MAINNET);
    });

    it('(a) an empty shell value does not overwrite the sentinel', () => {
        const env = buildHardhatChildEnv({ ETH_FORK_RPC_URL: '', ALLOW_REAL_MAINNET: '' });
        expect(env.ETH_FORK_RPC_URL).toBe(sentinels.ETH_FORK_RPC_URL);
        expect(env.ALLOW_REAL_MAINNET).toBe(sentinels.ALLOW_REAL_MAINNET);
    });

    it('(b) a child under the same preload has its .env read blocked and a sentinel private key', () => {
        const result = spawnRailedChild(process.execPath, ['test/rails/probes/childProbe.cjs', '--dotenv-gate'], { railsEntry: 'setup-fork' });
        expect(result.status).toBe(0);
        const out = JSON.parse(result.stdout.trim());
        expect(out.rails.mode).toBe('fork');
        expect(out.rails.envBlockInstalled).toBe(true);
        expect(out.dotenvGate).toBe('attempted');
        expect(out.ledger.kinds).toContain('env-read-blocked');
        expect(out.env.PRIVATE_KEY).toBe(sentinels.PRIVATE_KEY);
        // The planted fake .env set this to 1; the block keeps it out of the process.
        expect(out.forkShell.ALLOW_REAL_MAINNET).not.toBe('1');
    }, 30_000);
});

describe('test/fork/setup.ts child launches (AST, setup() is never called)', () => {
    const file = path.join(REPO_ROOT, 'test', 'fork', 'setup.ts');
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    function collect(): { calls: ts.CallExpression[]; parentEnvSpreads: number } {
        const calls: ts.CallExpression[] = [];
        let parentEnvSpreads = 0;
        const visit = (node: ts.Node): void => {
            if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text === 'execSync' || node.expression.text === 'spawn')) calls.push(node);
            if ((ts.isSpreadAssignment(node) || ts.isSpreadElement(node)) && node.expression.getText(sf).replace(/\s+/g, '') === 'process.env') parentEnvSpreads += 1;
            ts.forEachChild(node, visit);
        };
        visit(sf);
        return { calls, parentEnvSpreads };
    }

    it('(c) every execSync/spawn except taskkill passes env: buildHardhatChildEnv(...)', () => {
        const { calls } = collect();
        const hardhatCalls = calls.filter((c) => !c.arguments[0].getText(sf).includes('taskkill'));
        expect(hardhatCalls.length).toBeGreaterThanOrEqual(2);
        for (const call of hardhatCalls) {
            const opts = call.arguments[call.arguments.length - 1];
            expect(ts.isObjectLiteralExpression(opts)).toBe(true);
            const envProp = (opts as ts.ObjectLiteralExpression).properties.find(
                (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(sf) === 'env',
            );
            expect(envProp, call.getText(sf)).toBeDefined();
            const value = envProp!.initializer;
            expect(ts.isCallExpression(value) && value.expression.getText(sf) === 'buildHardhatChildEnv').toBe(true);
        }
    });

    it('(c) no object in the file spreads the parent env', () => {
        expect(collect().parentEnvSpreads).toBe(0);
    });
});

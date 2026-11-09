// test/unit/rails/forkRpcSource.test.ts
// Phase 22 plan 22-11 — SAFE-02 / AC-17: the fork project reads its RPC URL only from the shell
// variable ETH_FORK_RPC_URL, through one resolver, with no fallback to any other variable.
// Calls the resolver and reads sources only: setup() and Hardhat are never invoked.

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { resolveForkRpcUrl, hasForkRpcUrl } from '../../fork/helpers/forkRpcUrl';
import { resolveForkRpcUrl as reExportedResolver } from '../../fork/setup';

const FALLBACK_ONLY = { ALCHEMY_URL: 'http://127.0.0.1:1' };
const SHELL_SET = { ETH_FORK_RPC_URL: 'http://127.0.0.1:1' };

describe('resolveForkRpcUrl (AC-17)', () => {
    it('throws when the variable is absent, naming ETH_FORK_RPC_URL', () => {
        expect(() => resolveForkRpcUrl({})).toThrow(/ETH_FORK_RPC_URL/);
    });

    it('says the value comes from the shell only and shows how to set it', () => {
        expect(() => resolveForkRpcUrl({})).toThrow(/shell only \(never from \.env\)/);
        expect(() => resolveForkRpcUrl({})).toThrow(/ETH_FORK_RPC_URL=<archive RPC url> npm run test:fork/);
    });

    it('has no fallback: another variable does not satisfy it', () => {
        expect(() => resolveForkRpcUrl(FALLBACK_ONLY)).toThrow(/ETH_FORK_RPC_URL/);
    });

    it('treats an empty value as absent', () => {
        expect(() => resolveForkRpcUrl({ ETH_FORK_RPC_URL: '' })).toThrow(/ETH_FORK_RPC_URL/);
    });

    it('returns the shell value when set', () => {
        expect(resolveForkRpcUrl(SHELL_SET)).toBe('http://127.0.0.1:1');
    });
});

describe('hasForkRpcUrl (AC-17)', () => {
    it('is false for an empty env, for the fallback-only env and for an empty value', () => {
        expect(hasForkRpcUrl({})).toBe(false);
        expect(hasForkRpcUrl(FALLBACK_ONLY)).toBe(false);
        expect(hasForkRpcUrl({ ETH_FORK_RPC_URL: '' })).toBe(false);
    });

    it('is true when the shell value is set', () => {
        expect(hasForkRpcUrl(SHELL_SET)).toBe(true);
    });
});

describe('test/fork/setup.ts wiring (AC-17, setup() is never called)', () => {
    it('re-exports the same function object as the helper', () => {
        expect(reExportedResolver).toBe(resolveForkRpcUrl);
    });

    it('calls resolveForkRpcUrl as the first statement of setup, before any execSync', () => {
        const file = path.resolve(__dirname, '..', '..', 'fork', 'setup.ts');
        const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        const setup = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === 'setup');
        expect(setup?.body).toBeDefined();
        const body = setup!.body!;
        expect(body.statements[0].getText(sf)).toContain('resolveForkRpcUrl()');

        const positionsOf = (name: string): number[] => {
            const found: number[] = [];
            const visit = (node: ts.Node): void => {
                if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) found.push(node.getStart(sf));
                ts.forEachChild(node, visit);
            };
            visit(body);
            return found;
        };
        const resolves = positionsOf('resolveForkRpcUrl');
        const execs = positionsOf('execSync');
        expect(resolves.length).toBe(1);
        expect(execs.length).toBeGreaterThan(0);
        expect(resolves[0]).toBeLessThan(Math.min(...execs));
    });
});

// test/unit/mainEntry.test.ts
//
// Phase 22 plan 22-13 (SAFE-04, D-07, NAC-07): the boot entry. runMain is called with a fake
// startBot; src/main.ts and src/bot.ts are never run as programs and bot.ts is never imported.
// Case order matters: a successful acquire pins the lock for the rest of this worker's life,
// so the success case runs last among the lock cases.

import { afterAll, describe, expect, it } from 'vitest';
import { computeAddress } from 'ethers';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as ts from 'typescript';
import { killProcessTree, readSentinels, REPO_ROOT, spawnRailedChild, spawnRailedChildAsync } from '../rails/spawnRailedChild';
import { readStartEnv, runMain } from '../../src/main';
import { acquireProcessLock, tryAcquireThenRelease } from '../../src/utils/processLock';

const CHILD_TEST_TIMEOUT_MS = 120_000;
const FIXTURE = 'test/integration/fixtures/lockHolder.ts';
const CHILD_ARGS = ['-r', 'ts-node/register/transpile-only', FIXTURE];
const PIN = Symbol.for('crypto-snipe-bot.processLock');

const KEY = readSentinels().PRIVATE_KEY;
const ADDRESS = computeAddress(KEY).toLowerCase();

const tempDirs: string[] = [];

function tempDir(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-main-entry-'));
    tempDirs.push(d);
    return d;
}

afterAll(() => {
    // The pin would otherwise outlive this file in a reused worker and keep the temp file open.
    const pinned = globalThis as unknown as Record<symbol, { db: { close(): void } } | undefined>;
    pinned[PIN]?.db.close();
    delete pinned[PIN];
    for (const d of tempDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function failure(fn: () => unknown): Error & { code?: string } {
    try {
        fn();
    } catch (err) {
        return err as Error & { code?: string };
    }
    throw new Error('expected the call to throw');
}

function parse(rel: string): ts.SourceFile {
    return ts.createSourceFile(rel, fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'), ts.ScriptTarget.Latest, true);
}

function imports(sf: ts.SourceFile): string[] {
    return sf.statements.filter(ts.isImportDeclaration).map((s) => (s.moduleSpecifier as ts.StringLiteral).text);
}

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
    visit(node);
    ts.forEachChild(node, (c) => walk(c, visit));
}

function isIdentifierCall(node: ts.Node, name: string): node is ts.CallExpression {
    return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name;
}

function consoleCalls(sf: ts.SourceFile): number {
    let count = 0;
    walk(sf, (n) => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'console') count += 1;
    });
    return count;
}

describe('SAFE-04 boot entry', () => {
    it(
        '(2) a held lock throws PROCESS_LOCK_HELD and never starts the bot, with or without the 0x prefix',
        async () => {
            const lockDir = tempDir();
            const holder = spawnRailedChildAsync(process.execPath, [...CHILD_ARGS, lockDir, ADDRESS], { timeoutMs: 110_000 });
            const pid = holder.pid as number;
            try {
                await new Promise<void>((resolve, reject) => {
                    let out = '';
                    holder.stdout?.on('data', (c: Buffer) => {
                        out += c.toString('utf8');
                        if (out.includes('ACQUIRED')) resolve();
                    });
                    holder.once('close', () => reject(new Error(`holder exited early: ${out}`)));
                });
                let started = 0;
                const startBot = (): void => {
                    started += 1;
                };
                expect(failure(() => runMain({ env: { PRIVATE_KEY: KEY }, lockDir, startBot })).code).toBe('PROCESS_LOCK_HELD');
                // new ethers.Wallet accepts a key without 0x; the lock must key the same wallet.
                expect(failure(() => runMain({ env: { PRIVATE_KEY: KEY.slice(2) }, lockDir, startBot })).code).toBe('PROCESS_LOCK_HELD');
                expect(started).toBe(0);
            } finally {
                killProcessTree(pid);
                await new Promise<void>((resolve) => {
                    if (holder.exitCode !== null) resolve();
                    else holder.once('close', () => resolve());
                });
            }
        },
        CHILD_TEST_TIMEOUT_MS,
    );

    it('(3) a lock-mechanism error throws PROCESS_LOCK_MECHANISM and never starts the bot (NAC-07)', () => {
        const dir = tempDir();
        const notAFolder = path.join(dir, 'regular-file');
        fs.writeFileSync(notAFolder, 'x');
        let started = 0;
        const err = failure(() =>
            runMain({
                env: { PRIVATE_KEY: KEY },
                lockDir: notAFolder,
                startBot: () => {
                    started += 1;
                },
            }),
        );
        expect(err.code).toBe('PROCESS_LOCK_MECHANISM');
        expect(started).toBe(0);
    });

    it('a set VITEST refuses the start before the lock is touched and never starts the bot (review WR-01)', () => {
        const lockDir = path.join(tempDir(), 'locks');
        let started = 0;
        const err = failure(() =>
            runMain({
                env: { PRIVATE_KEY: KEY, VITEST: 'true' },
                lockDir,
                startBot: () => {
                    started += 1;
                },
            }),
        );
        expect(err.code).toBe('MAIN_VITEST_SET');
        expect(started).toBe(0);
        expect(fs.existsSync(lockDir)).toBe(false);
    });

    it('readStartEnv reads the file into a private object, lets the shell win, and leaves process.env untouched (review WR-03)', () => {
        const file = path.join(tempDir(), 'start-env-fixture.txt');
        fs.writeFileSync(file, 'CSB_START_ENV_PROBE=from-file\nCSB_START_ENV_SHELL=from-file\n', 'utf8');
        process.env.CSB_START_ENV_SHELL = 'from-shell';
        try {
            const env = readStartEnv(file);
            expect(env.CSB_START_ENV_PROBE).toBe('from-file');
            expect(env.CSB_START_ENV_SHELL).toBe('from-shell');
            expect(process.env.CSB_START_ENV_PROBE).toBeUndefined();
        } finally {
            delete process.env.CSB_START_ENV_SHELL;
        }
    });

    it('a missing or invalid PRIVATE_KEY throws MAIN_NO_WALLET, never quotes the value, and never starts the bot', () => {
        const dir = tempDir();
        const cases: Record<string, string | undefined>[] = [
            {},
            { PRIVATE_KEY: '' },
            { PRIVATE_KEY: 'zz-not-a-key-value' },
            { PRIVATE_KEY: `0x${'ab'.repeat(33)}` },
        ];
        let started = 0;
        for (const env of cases) {
            const err = failure(() =>
                runMain({
                    env,
                    lockDir: dir,
                    startBot: () => {
                        started += 1;
                    },
                }),
            );
            expect(err.code).toBe('MAIN_NO_WALLET');
            expect(err.message).not.toContain('zz-not-a-key-value');
            expect(err.message).not.toContain('abab');
            expect((err as { cause?: unknown }).cause).toBeUndefined();
        }
        expect(started).toBe(0);
        expect(fs.readdirSync(dir)).toEqual([]);
    });

    it('(4) src/main.ts imports nothing stateful and loads the bot only inside startBot, after the lock', () => {
        const sf = parse('src/main.ts');
        const allowed = new Set(['dotenv', 'ethers', './utils/processLock']);
        for (const spec of imports(sf)) expect(allowed.has(spec), spec).toBe(true);

        const requires: ts.CallExpression[] = [];
        walk(sf, (n) => {
            if (isIdentifierCall(n, 'require')) requires.push(n);
        });
        expect(requires.map((c) => (c.arguments[0] as ts.StringLiteral).text)).toEqual(['./bot']);
        let scope: ts.Node = requires[0];
        while (!ts.isArrowFunction(scope)) scope = scope.parent;
        const property = scope.parent;
        expect(ts.isPropertyAssignment(property) && property.name.getText(sf)).toBe('startBot');

        const forbidden = ['./config', './utils/db', './utils/notifier', './utils/logger'];
        walk(sf, (n) => {
            if (ts.isStringLiteralLike(n)) expect(forbidden.includes(n.text), n.text).toBe(false);
        });

        const runMainFn = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === 'runMain');
        expect(runMainFn).toBeDefined();
        const text = (runMainFn as ts.FunctionDeclaration).getText(sf);
        expect(text.indexOf('acquireProcessLock(')).toBeGreaterThan(-1);
        expect(text.indexOf('acquireProcessLock(')).toBeLessThan(text.indexOf('opts.startBot()'));
    });

    it('(5) src/bot.ts: the first statement is the direct-entry guard and require.main refuses', () => {
        const sf = parse('src/bot.ts');
        const first = sf.statements[0];
        expect(ts.isImportDeclaration(first)).toBe(true);
        const decl = first as ts.ImportDeclaration;
        expect((decl.moduleSpecifier as ts.StringLiteral).text).toBe('./guards/directEntry');
        expect(decl.importClause).toBeUndefined();

        const blocks = sf.statements.filter((s): s is ts.IfStatement => ts.isIfStatement(s) && s.expression.getText(sf) === 'require.main === module');
        expect(blocks).toHaveLength(1);
        const body = blocks[0].thenStatement.getText(sf);
        expect(body).toContain('src/main.ts');
        expect(body).toContain('process.exit(1)');
        expect(body).not.toContain('startMultiChainBot(');
    });

    it('(6) directEntry.ts imports only fs and path; neither boot file calls console', () => {
        const guard = parse('src/guards/directEntry.ts');
        expect(imports(guard).sort()).toEqual(['fs', 'path']);
        expect(consoleCalls(guard)).toBe(0);
        expect(consoleCalls(parse('src/main.ts'))).toBe(0);
    });

    it(
        '(1) starts the bot exactly once, only after the lock is held',
        () => {
            const lockDir = tempDir();
            let calls = 0;
            let contenderOut = '';
            const result = runMain({
                env: { PRIVATE_KEY: KEY },
                lockDir,
                startBot: () => {
                    calls += 1;
                    // A real second process proves the lock is already held at this moment.
                    contenderOut = spawnRailedChild(process.execPath, [...CHILD_ARGS, lockDir, ADDRESS, '--hold-ms', '0'], { timeoutMs: 110_000 }).stdout;
                },
            });
            expect(calls).toBe(1);
            expect(contenderOut).toContain('REFUSED PROCESS_LOCK_HELD');
            expect(result.address).toBe(ADDRESS);
            expect(result.lockFile).toBe(path.join(lockDir, `${ADDRESS}.lock`));

            // The one handle stays the one handle: Linux drops the lock if a second opens and closes.
            expect(failure(() => acquireProcessLock(lockDir, ADDRESS))).toMatchObject({ code: 'PROCESS_LOCK_MECHANISM' });
            expect(failure(() => tryAcquireThenRelease(lockDir, ADDRESS))).toMatchObject({ code: 'PROCESS_LOCK_MECHANISM' });
        },
        CHILD_TEST_TIMEOUT_MS,
    );
});

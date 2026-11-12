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
import { isBuiltin } from 'node:module';
import * as ts from 'typescript';
import { killProcessTree, readSentinels, spawnRailedChild, spawnRailedChildAsync } from '../rails/spawnRailedChild';
import { consoleCallCount, loadRepoModules, moduleExporting, resolveSpecifier, type RepoModule } from '../helpers/sourceGraph';
import { readStartEnv, runMain } from '../../src/main';
import { acquireProcessLock, tryAcquireThenRelease } from '../../src/utils/processLock';

const CHILD_TEST_TIMEOUT_MS = 120_000;
const FIXTURE = 'test/integration/fixtures/lockHolder.ts';
const TS_NODE = ['-r', 'ts-node/register/transpile-only'];
const CHILD_ARGS = [...TS_NODE, FIXTURE];
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

// Plan 23-31 (CHAR-06): tests (4), (5) and (6) used to parse src/main.ts, src/bot.ts and
// src/guards/directEntry.ts by name. They now find each module by the symbol it exports, in a
// directory walk of src/ (test/helpers/sourceGraph.ts), and check what a real load does where a
// load can show it: a railed child loads the module and test/integration/fixtures/
// loadedModulesProbe.ts records which repo modules came with it. What only a start of the program
// could show (the guard placement in the bot module and its direct-start block, and that the boot
// files write no console output) stays a check of the parsed module, still found by symbol.
const PROBE = 'test/integration/fixtures/loadedModulesProbe.ts';

interface LoadRecord {
    loaded: { file: string; exports: string[] }[];
}

/** The repo modules a railed child loads with `file`, besides the probe and the rails themselves. */
function loadedWith(file: string): { status: number | null; output: string; loaded: LoadRecord['loaded'] } {
    const out = path.join(tempDir(), 'loaded.json');
    const r = spawnRailedChild(process.execPath, [...TS_NODE, PROBE, out, file], { timeoutMs: 110_000 });
    const output = r.stdout + r.stderr;
    const loaded = fs.existsSync(out) ? (JSON.parse(fs.readFileSync(out, 'utf8')) as LoadRecord).loaded : [];
    return { status: r.status, output, loaded: loaded.filter((m) => m.file !== PROBE && !m.file.startsWith('test/rails/')) };
}

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
    visit(node);
    ts.forEachChild(node, (c) => walk(c, visit));
}

function isIdentifierCall(node: ts.Node, name: string): node is ts.CallExpression {
    return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name;
}

let srcModules: Map<string, RepoModule> | undefined;
function src(): Map<string, RepoModule> {
    srcModules ??= loadRepoModules(['src']);
    return srcModules;
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

    // Plan 23-31: was "(4) src/main.ts imports nothing stateful and loads the bot only inside
    // startBot, after the lock", a parse of src/main.ts by name. "After the lock" is now carried by
    // test (1), which watches a real second process being refused while the bot starts (GUARD_MUTANTS
    // row main-starts-before-lock in scripts/red-proof-conversions.ts).
    it(
        '(4) the boot entry imports nothing stateful and loads the bot only inside startBot',
        () => {
            const mods = src();
            const entry = moduleExporting(mods, 'runMain');
            const lock = moduleExporting(mods, 'acquireProcessLock');
            const bot = moduleExporting(mods, 'startMultiChainBot');

            // A real load of the boot entry brings in exactly one other repo module, the lock: no
            // config, database, notifier or logger, and not the bot.
            const run = loadedWith(entry.file);
            expect(run.status, run.output).toBe(0);
            expect(run.loaded.map((m) => m.file).sort()).toEqual([entry.file, lock.file].sort());

            // Only a start of the program reaches startBot, so where the bot is loaded is checked
            // on the parsed entry: its one require() is inside the function given as startBot, and
            // it names the module that exports startMultiChainBot.
            const requires: ts.CallExpression[] = [];
            walk(entry.sf, (n) => {
                if (isIdentifierCall(n, 'require')) requires.push(n);
            });
            expect(requires.map((c) => resolveSpecifier(entry.file, (c.arguments[0] as ts.StringLiteral).text))).toEqual([bot.file]);
            let scope: ts.Node = requires[0];
            while (!ts.isArrowFunction(scope) && !ts.isFunctionExpression(scope)) scope = scope.parent;
            const property = scope.parent;
            expect(ts.isPropertyAssignment(property) && property.name.getText(entry.sf)).toBe('startBot');
        },
        CHILD_TEST_TIMEOUT_MS,
    );

    // A direct start is the one thing this cannot run (it would start the program), so the bot
    // module, found by the symbol it exports, is checked as parsed.
    it(
        '(5) src/bot.ts: the first statement is the direct-entry guard and require.main refuses',
        () => {
            const mods = src();
            const bot = moduleExporting(mods, 'startMultiChainBot');
            const guard = moduleExporting(mods, 'refuseIfDirectEntry');
            const entry = moduleExporting(mods, 'runMain');
            const sf = bot.sf;

            // The first statement is a side-effect-only import of the guard module.
            const first = sf.statements[0];
            expect(ts.isImportDeclaration(first), first.getText(sf)).toBe(true);
            const decl = first as ts.ImportDeclaration;
            expect(decl.importClause, first.getText(sf)).toBeUndefined();
            expect(resolveSpecifier(bot.file, (decl.moduleSpecifier as ts.StringLiteral).text), first.getText(sf)).toBe(guard.file);

            // One require.main block: it ends the process with 1, names the boot entry to use, and
            // never starts the bot.
            const blocks = sf.statements.filter((s): s is ts.IfStatement => ts.isIfStatement(s) && s.expression.getText(sf) === 'require.main === module');
            expect(blocks).toHaveLength(1);
            const calls: string[] = [];
            const strings: string[] = [];
            walk(blocks[0].thenStatement, (n) => {
                if (ts.isCallExpression(n)) calls.push(n.getText(sf));
                if (ts.isStringLiteralLike(n)) strings.push(n.text);
            });
            expect(calls).toContain('process.exit(1)');
            expect(calls.filter((c) => /\bstartMultiChainBot\s*\(/.test(c))).toEqual([]);
            expect(strings.some((s) => s.includes(entry.file)), JSON.stringify(strings)).toBe(true);
        },
        // The walk builds one program over src/ once per file run (whichever of (4)-(6) runs first):
        // 0.5 to 0.6 s alone; an explicit limit because the unit default is 5 s.
        60_000,
    );

    it(
        '(6) directEntry.ts imports only fs and path; neither boot file calls console',
        () => {
            const mods = src();
            const guard = moduleExporting(mods, 'refuseIfDirectEntry');
            const entry = moduleExporting(mods, 'runMain');

            // A real load of the guard brings in no other repo module ...
            const run = loadedWith(guard.file);
            expect(run.status, run.output).toBe(0);
            expect(run.loaded.map((m) => m.file)).toEqual([guard.file]);
            // ... and it names only Node built-ins, which a record of repo modules cannot show.
            expect(guard.specifiers.filter((s) => !isBuiltin(s))).toEqual([]);

            // Writing to the console would need the program to run its refusal path, so the two boot
            // files, found by symbol, are checked as parsed.
            expect(consoleCallCount(guard.sf)).toBe(0);
            expect(consoleCallCount(entry.sf)).toBe(0);
        },
        CHILD_TEST_TIMEOUT_MS,
    );

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

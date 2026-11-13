// test/realpath/triage/AUD-SCRIPTS-002.test.ts
// Phase 23 plan 23-13 Task 2 (AUDIT-02, D-07, D-08): AUD-SCRIPTS-002 (S1, ESC-SCRIPTS-01), proven
// statically.
//
// The finding: the operator scripts that sign with the bot wallet (deliberate-buy and
// recover-sell-ladys, and behind broken imports addLiquidity and deploySepoliaTest) run as separate
// processes outside the bot's nonce lock and never read the pause switch. With the bot running on
// the same wallet, a script and the bot can sign with the same nonce or sell the same tokens, and a
// deliberate buy proceeds while the bot is paused.
//
// How (the static route RESEARCH names for this entry): the directory walk of scripts/ goes to
// ts.createProgram (fixtures/scriptsStatic.ts, options mirroring tsconfig.json); SigningAnalysis
// identifies each script's signing points as the census does (its type predicates copied: Signer
// sends, ContractFactory.deploy, state-changing contract calls with a Signer or unresolved runner,
// view fragments and staticCall excluded), plus calls into another program file that may reach a
// signing site (deliberate-buy signs through executeDeliberateBuy in src/bot.ts, in its own
// process). Each signing script is classified by lock lifetime with the type checker resolving
// every call to its declaration (review concern Codex 23-13 MEDIUM: tryAcquireThenRelease releases
// the lock before it returns, src/utils/processLock.ts:204, so finding a lock call is not enough):
//   holds-lock         acquireProcessLock is unconditionally reached before every signing point,
//                      with no release between;
//   status-query-only  otherwise, when the script calls tryAcquireThenRelease;
//   none               otherwise.
// and, separately, whether a getPauseState.get() read is reached before every signing point.
// Script names come only from the walk; no scripts/ file is named as a path the test reads (the
// form plan 23-19's AC-37 gate accepts).
//   Correct:  a pinned script set (review WR-10), never one built from what the analysis found: the
//             two live scripts, plus each legacy script while its file exists, each
//             { lock: 'holds-lock', pauseRead: true }. A script whose signing the analysis stopped
//             resolving can therefore never drop out of `correct` and read "looks fixed".
//   Observed: the sorted rows below, each { lock: 'none', pauseRead: false }. The two legacy rows are
//             expected only while those files exist: deleting them is AUD-SCRIPTS-001's fix, and it
//             must flip only AUD-SCRIPTS-001's test (repairing their imports changes no row).
// Before the marker, a setup fact true under the bug and every fix: each live script is walked and
// each expected script still has at least one signing point, so a lost detection (a signing call
// reached through an any-typed require, or a wrapper the type checker cannot resolve) fails loudly
// here instead of shrinking the rows. After the marker, the detail: the signing points found in the
// two live scripts, by enclosing function and call (no line numbers).
//
// The classifier is proven both ways on temp-directory programs (a stub processLock and db module,
// real ethers types): holds-lock (with and without the pause read, through a same-file helper, an
// anonymous callback, a delegated src function, a try whose catch rethrows, and a query followed by
// a real acquire), status-query-only (tryAcquireThenRelease before signing), none (no lock; a lock
// taken after signing; a lock taken only on one branch; a delegated signer with no lock), and a
// script that only reads (view fragments, a provider-runner contract) is not a signing script.
//
// Boundary of the analysis (fixtures/scriptsStatic.ts header): a contract passed in as a function
// parameter is not traced to its call sites (the census does that through the language service), so
// in src/ three allowance view calls count as sites; no script passes a contract as a parameter and
// the 12 script sites match the census inventory (signing-sites-head.json), with addLiquidity's
// factory.getPair, the census's one auditor exclusion, counted here because its ABI cannot be
// resolved. Neither changes a script's row.
//
// Phase 29 reading (card SCRIPTS-01 with BUY-01, HYG-03; still open, operator ruling "Acknowledge.
// Decide in phase 29"): the recommended hold-lock fix (acquireProcessLock for the whole run and the
// pause read while holding it, in every signing script) flips the claim to "looks fixed" (shown by a
// fix-shaped mutation of the two live scripts with the legacy two removed, restored from git). A
// tryAcquireThenRelease query alone reads "the failure changed" (status-query-only), never fixed. A
// BUY-01 fix that makes deliberate-buy hold the lock moves its row too, because it is the same
// defect. This entry feeds the census exception list in plan 23-17 (its 12 script sites).
//
// Nothing here runs a script, loads its code, or mocks anything.

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { REPO_ROOT } from '../../rails/spawnRailedChild';
import { harnessState } from '../harness/chain';
import { knownBug } from '../harness/knownBug';
import { SigningAnalysis, buildScriptsProgram, type ScriptRow } from './fixtures/scriptsStatic';

// Building the program type-loads src/ through the scripts' imports. Measured on Node 22: about 4 s
// alone for the real tree (times under the full run are in the plan summary); the realpath default
// limit is 15 s.
const PROGRAM_TIMEOUT_MS = 60_000;

const sortRows = (rows: ScriptRow[]): ScriptRow[] => [...rows].sort((a, b) => (a.script < b.script ? -1 : a.script > b.script ? 1 : 0));

/** Today's rows for the two live signing scripts. */
const LIVE_OBSERVED: ScriptRow[] = [
    { script: 'deliberate-buy', lock: 'none', pauseRead: false },
    { script: 'recover-sell-ladys', lock: 'none', pauseRead: false },
];
/** Today's rows for the two legacy scripts, expected only while their files exist (AUD-SCRIPTS-001). */
const LEGACY_OBSERVED: ScriptRow[] = [
    { script: 'addLiquidity', lock: 'none', pauseRead: false },
    { script: 'deploySepoliaTest', lock: 'none', pauseRead: false },
];

describe('AUD-SCRIPTS-002: the operator scripts that sign with the bot wallet hold no process lock and read no pause switch', () => {
    it('signing-scripts-outside-process-lock: every script that signs runs with no held process lock and no pause read', { timeout: PROGRAM_TIMEOUT_MS }, (ctx) => {
        const run = buildScriptsProgram(REPO_ROOT);
        const analysis = new SigningAnalysis(run);
        // The scan itself works (an empty scan must never read as fixed): it found script files and
        // signing sites in src/ (the bot's own exit sells, unrelated to this finding's fix).
        expect(run.rootNames.length, 'the walk found scripts').toBeGreaterThan(0);
        expect(analysis.srcSiteCount(), 'the analysis finds signing sites at all').toBeGreaterThan(0);

        const walked = new Set(run.rootNames.map((f) => path.basename(f).replace(/\.ts$/, '')));
        // The pinned script set: the live scripts always, each legacy script while its file exists.
        const expectedScripts = [...LIVE_OBSERVED.map((r) => r.script), ...LEGACY_OBSERVED.filter((r) => walked.has(r.script)).map((r) => r.script)];
        const points = analysis.scriptPoints();
        for (const r of LIVE_OBSERVED) expect(walked.has(r.script), `the live script ${r.script} is walked`).toBe(true);
        for (const name of expectedScripts) expect((points.get(name) ?? []).length, `${name} still has a detected signing point`).toBeGreaterThan(0);
        const actual = analysis.scriptRows();
        knownBug(ctx, 'AUD-SCRIPTS-002', {
            claim: 'signing-scripts-outside-process-lock',
            correct: sortRows(expectedScripts.map((script) => ({ script, lock: 'holds-lock' as const, pauseRead: true }))),
            observed: sortRows([...LIVE_OBSERVED, ...LEGACY_OBSERVED.filter((r) => walked.has(r.script))]),
            actual,
            expectedPlain: 'Every operator script that signs with the bot wallet takes and holds the wallet process lock for its whole run and checks the pause switch before it signs, so it refuses while the bot runs.',
            actualPlain: 'deliberate-buy and recover-sell-ladys (and the two broken legacy scripts) sign with the bot wallet without holding the process lock or checking the pause switch, so they can run beside the bot on the same wallet.',
        });

        // Detail: what was identified as signing in the two live scripts (enclosing function and call).
        const summary = (s: string): string[] => (points.get(s) ?? []).map((p) => `${p.fn}:${p.kind}:${p.api}`);
        expect(summary('deliberate-buy')).toEqual(['main:delegated:executeDeliberateBuy']);
        expect(summary('recover-sell-ladys')).toEqual(['main:site:contract.approve', 'main:site:contract.swapExactTokensForETHSupportingFeeOnTransferTokens']);
        for (const r of LEGACY_OBSERVED.filter((x) => walked.has(x.script))) expect(summary(r.script).length, r.script).toBeGreaterThan(0);
    });

    it('classifier cases on temp-directory programs: holds-lock, status-query-only and none, and a read-only script is not signing', { timeout: PROGRAM_TIMEOUT_MS }, () => {
        const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'csb-aud-scripts-002-')));
        harnessState().disposers.push(async () => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
        const put = (rel: string, lines: string[]): void => {
            const p = path.join(root, ...rel.split('/'));
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, lines.join('\n') + '\n');
        };
        // Stubs with the real modules' paths and export names: the classifier resolves calls to these declarations.
        put('src/utils/processLock.ts', [
            "export function defaultLockDir(): string { return 'locks'; }",
            'export function acquireProcessLock(lockDir: string, address: string): { lockFile: string } { return { lockFile: lockDir + address }; }',
            'export function tryAcquireThenRelease(lockDir: string, address: string): { held: boolean } { return { held: lockDir === address }; }',
        ]);
        put('src/utils/db.ts', ['export const getPauseState = { get(): { paused: number } { return { paused: 0 }; } };']);
        put('src/signer.ts', ["import { Wallet } from 'ethers';", 'export async function signFor(w: Wallet): Promise<void> {', '    await w.sendTransaction({ to: w.address, value: 0n });', '}']);
        const head = [
            "import { Contract, JsonRpcProvider, Wallet } from 'ethers';",
            "import { acquireProcessLock, defaultLockDir, tryAcquireThenRelease } from '../src/utils/processLock';",
            "import { getPauseState } from '../src/utils/db';",
            "import { signFor } from '../src/signer';",
            "const provider = new JsonRpcProvider('http://127.0.0.1:1');",
            "const wallet = new Wallet('0x' + '11'.repeat(32), provider);",
            'void Contract; void acquireProcessLock; void defaultLockDir; void tryAcquireThenRelease; void getPauseState; void signFor;',
        ];
        const SEND = '    await wallet.sendTransaction({ to: wallet.address, value: 0n });';
        const ACQUIRE = '    acquireProcessLock(defaultLockDir(), wallet.address);';
        const PAUSE = '    if (getPauseState.get().paused) return;';
        const script = (name: string, body: string[], tail: string[] = ['main(true).catch(() => undefined);']): void =>
            put(`scripts/${name}.ts`, [...head, 'async function main(flag: boolean): Promise<void> {', '    void flag;', ...body, '}', ...tail]);

        script('holds', [ACQUIRE, PAUSE, SEND]);
        script('holds-no-pause', [ACQUIRE, SEND]);
        script('query', ['    const { held } = tryAcquireThenRelease(defaultLockDir(), wallet.address);', '    if (held) return;', SEND]);
        script('query-then-hold', ['    if (tryAcquireThenRelease(defaultLockDir(), wallet.address).held) return;', ACQUIRE, SEND]);
        script('none', [SEND]);
        script('late', [SEND, ACQUIRE]);
        script('branch', ['    if (flag) acquireProcessLock(defaultLockDir(), wallet.address);', SEND]);
        script('delegated', [ACQUIRE, PAUSE, '    await signFor(wallet);']);
        script('delegated-unlocked', ['    await signFor(wallet);']);
        script('helper', [ACQUIRE, '    await sign();'], ['async function sign(): Promise<void> {', SEND, '}', 'main(true).catch(() => undefined);']);
        script('callback', [ACQUIRE, '    await run(async () => {', '    ' + SEND, '    });'], ['async function run(f: () => Promise<void>): Promise<void> { await f(); }', 'main(true).catch(() => undefined);']);
        script('try-rethrow', ['    try {', '    ' + ACQUIRE, '    } catch (e) {', '        throw e;', '    }', SEND]);
        script('try-swallow', ['    try {', '    ' + ACQUIRE, '    } catch {', '        void 0;', '    }', SEND]);
        script('contract-signer', ["    const t = new Contract(wallet.address, ['function approve(address,uint256) returns (bool)'], wallet);", '    await t.approve(wallet.address, 1n);']);
        script('read-only', [
            "    const t = new Contract(wallet.address, ['function balanceOf(address) view returns (uint256)'], wallet);",
            '    await t.balanceOf(wallet.address);',
            "    const p = new Contract(wallet.address, ['function approve(address,uint256) returns (bool)'], provider);",
            '    await p.approve.staticCall(wallet.address, 1n);',
            '    await provider.getBalance(wallet.address);',
        ]);

        const run = buildScriptsProgram(root, { baseUrl: root, paths: { ethers: [path.join(REPO_ROOT, 'node_modules', 'ethers')] }, types: [] });
        // The stub program type-loads the real ethers: the Signer and Contract predicates see real types.
        expect(run.program.getSourceFiles().some((sf) => /[\\/]node_modules[\\/]ethers[\\/]/.test(sf.fileName)), 'ethers types resolved').toBe(true);
        const rows = new SigningAnalysis(run).scriptRows();
        expect(rows).toEqual(
            sortRows([
                { script: 'branch', lock: 'none', pauseRead: false },
                { script: 'callback', lock: 'holds-lock', pauseRead: false },
                { script: 'contract-signer', lock: 'none', pauseRead: false },
                { script: 'delegated', lock: 'holds-lock', pauseRead: true },
                { script: 'delegated-unlocked', lock: 'none', pauseRead: false },
                { script: 'helper', lock: 'holds-lock', pauseRead: false },
                { script: 'holds', lock: 'holds-lock', pauseRead: true },
                { script: 'holds-no-pause', lock: 'holds-lock', pauseRead: false },
                { script: 'late', lock: 'none', pauseRead: false },
                { script: 'none', lock: 'none', pauseRead: false },
                { script: 'query', lock: 'status-query-only', pauseRead: false },
                { script: 'query-then-hold', lock: 'holds-lock', pauseRead: false },
                { script: 'try-rethrow', lock: 'holds-lock', pauseRead: false },
                { script: 'try-swallow', lock: 'none', pauseRead: false },
            ]),
        );
    });
});

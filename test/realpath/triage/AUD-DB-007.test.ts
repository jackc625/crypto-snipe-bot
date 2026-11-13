// test/realpath/triage/AUD-DB-007.test.ts
// Phase 23 plan 23-11 Task 2 (AUDIT-02, Section C SC-21): AUD-DB-007, re-measured after the Phase 22
// rail. The finding (at the audit base): the database path resolved against the current working
// directory (an unset DB_PATH and the shipped DB_PATH=./data/bot.db alike), and db.ts created the
// folder and an empty database when none was there, so a bot started from another directory booted
// on a fresh database (kill-switch off, open positions not resumed, dedup and loss history empty).
//
// The rail (plan 22-09, now in src/): src/utils/db.ts resolves DB_PATH with src/utils/dbPath.ts
// resolveDbPath against findRepoRoot(__filename) (src/utils/repoRoot.ts: the nearest package.json
// named crypto-snipe-bot above the module's own file, never the working directory), creates a
// folder only under Vitest, and opens through openGuardedDb, which outside Vitest refuses a missing,
// empty or uninitialised file (DB_REFUSED_MISSING, ...) and opens with fileMustExist.
//
// Re-measured here on the real src/utils/db.ts, outside Vitest (railed children, withVitestEnv
// false, so the production branch runs), from a throwaway working directory that is not the repo
// root, with a relative DB_PATH and throwaway temp folders only:
//   - relative-db-path-opens-the-anchored-database: a real version-7 database in temp folder A,
//     paused (pause_state.paused 1) and holding one open buy. The child starts in a folder nested
//     inside temp folder B (see childCwdFor) with DB_PATH set to A's database relative to the repo
//     root. It opens A's database (the operator's database, paused, with its open position), and
//     creates nothing in B or at the path the same text would name relative to the child's folder.
//   - missing-database-is-refused-and-nothing-created: the same, with no database at that path. The
//     child refuses with DB_REFUSED_MISSING naming the repo-anchored absolute path and creates
//     nothing anywhere.
// Both tests first check that the relative text, read from the child's folder, names a different
// file than the repo-anchored reading. Without that, a cwd-relative resolver would open the same
// file and pass.
//   - unset-and-shipped-db-path-resolve-under-the-repo-root: from folder B the real resolveDbPath,
//     with the repo root db.ts uses, maps an unset DB_PATH and the shipped ./data/bot.db to
//     <repo root>/data/bot.db (text only; nothing is opened).
// Every child is railed (its own case ledger shows the rails started and no network use or denial).
//
// Result recorded in the register: nothing of AUD-DB-007 remains, so it closes as fixed, pointing at
// the rail test "AC-26 refuse-to-create outside Vitest > a missing path refuses, names the absolute
// path and creates nothing" in test/integration/dbGuards.test.ts (RED proof row 12 of
// .planning/phases/22-safety-rails-audit/red-proofs/INDEX.md), which carries the closes-finding
// marker. These re-measurement tests were also shown to fail with each half of the rail removed (a
// cwd-relative resolveDbPath; the refusal branches and fileMustExist removed), src restored byte for
// byte. Siblings that stay open as their own findings: migrateJsonState still reads .bot-state.json
// from the working directory (AUD-DB-019).
//
// This file has no knownBug: nothing here is a bug today. Only the harness mocks are in use
// (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { REPO_ROOT } from '../../rails/spawnRailedChild';
import { migrateSchema, CURRENT_SCHEMA_VERSION } from '../../../src/utils/dbSchema';
import { harnessState } from '../harness/chain';
import { runRailedChildToEnd, type ChildRun } from '../harness/loopback';

// Each test starts one railed child that registers ts-node. Measured on Node 22: about 0.8 s per
// test alone and 1.7 to 2.1 s under the full parallel npm test, below half the 15 s default. The
// explicit limit is headroom for a child process on a loaded machine (the dbGuards.test.ts
// children, which start through npx, take 8 to 10 s under the same full run).
const CHILD_TIMEOUT = 120_000;
const LEDGER_ROOT = path.join(os.tmpdir(), 'crypto-snipe-bot-rail-ledger');
const REAL_ROOT = fs.realpathSync.native(REPO_ROOT);

function tempFolder(label: string): string {
    const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `csb-aud-db-007-${label}-`)));
    harnessState().disposers.push(async () => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
    return dir;
}

let caseCounter = 0;
function newCaseId(label: string): string {
    caseCounter += 1;
    const id = `case-realpath-db007-${label}-${process.pid}-${caseCounter}-${Math.random().toString(36).slice(2, 10)}`;
    harnessState().disposers.push(async () => fs.rmSync(path.join(LEDGER_ROOT, id), { recursive: true, force: true }));
    return id;
}

/** The child's own rail ledger: the rails started, no network was used and nothing was denied. */
function expectRailedNoNetwork(runId: string): void {
    const dir = path.join(LEDGER_ROOT, runId);
    const entries: Array<{ kind: string }> = [];
    for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.jsonl')) continue;
        for (const line of fs.readFileSync(path.join(dir, name), 'utf8').split('\n')) if (line.trim() !== '') entries.push(JSON.parse(line) as { kind: string });
    }
    expect(entries.some((e) => e.kind === 'worker-start')).toBe(true);
    expect(entries.filter((e) => e.kind.startsWith('net-') || /deny|blocked|tripwire/.test(e.kind))).toEqual([]);
}

/** Every file and folder under `dir`, relative, sorted. */
function tree(dir: string): string[] {
    const out: string[] = [];
    const walk = (d: string): void => {
        for (const n of fs.readdirSync(d)) {
            const p = path.join(d, n);
            out.push(path.relative(dir, p));
            if (fs.statSync(p).isDirectory()) walk(p);
        }
    };
    walk(dir);
    return out.sort();
}

/** A real version-7 database (the real migrations), paused, with one open buy. */
function seedOperatorDatabase(file: string): void {
    const db = new Database(file);
    try {
        migrateSchema(db);
        db.prepare("UPDATE pause_state SET paused = 1, paused_at = 1767225600, paused_by = 'operator', reason = 'triage AUD-DB-007' WHERE id = 1").run();
        db.prepare(
            "INSERT INTO trades (token, chain, action, tx_hash, timestamp, amount_in, status, pool_type, dex_name) VALUES ('0x00000000000000000000000000000000000000aa', 'eth', 'buy', '0x01', 1767225600, '0.01', 'pending', 'v2', 'uniswap-v2')",
        ).run();
    } finally {
        db.close();
    }
}

/** A node -e child that registers ts-node from the repo and runs `body`; it prints one RESULT line. */
function childScript(body: string): string {
    return `const R=${JSON.stringify(REPO_ROOT)};require(R+'/node_modules/ts-node').register({transpileOnly:true,cwd:R});${body}`;
}

const OPEN_DB =
    "try{const m=require(R+'/src/utils/db');const v=m.db.pragma('user_version',{simple:true});const p=m.getPauseState.get();const o=m.getOpenPositionCount.get().count;" +
    "console.log('RESULT '+JSON.stringify({opened:m.getDbFilePath(),version:v,paused:p?p.paused:null,openBuys:o}));m.closeDb();process.exit(0);}" +
    "catch(e){console.log('RESULT '+JSON.stringify({refused:e&&e.code?e.code:'UNKNOWN',message:String(e&&e.message)}));process.exit(1);}";

const RESOLVE =
    "const {resolveDbPath}=require(R+'/src/utils/dbPath');const {findRepoRoot}=require(R+'/src/utils/repoRoot');const root=findRepoRoot(R+'/src/utils/db.ts');" +
    "console.log('RESULT '+JSON.stringify({cwd:process.cwd(),unset:resolveDbPath(undefined,root,{vitest:false}),shipped:resolveDbPath('./data/bot.db',root,{vitest:false})}));";

function resultOf(r: ChildRun): Record<string, unknown> {
    const line = r.stdout.split('\n').find((l) => l.startsWith('RESULT '));
    if (!line) throw new Error(`the child printed no RESULT line: status ${r.status}\nstdout:\n${r.stdout.slice(-2000)}\nstderr:\n${r.stderr.slice(-2000)}`);
    return JSON.parse(line.slice('RESULT '.length)) as Record<string, unknown>;
}

const same = (a: string, b: string): boolean => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/**
 * The child's working folder for a relative DB_PATH `rel`: a fresh temp folder `base` with one
 * nested folder per leading `..` of `rel`. Read from there, `rel` climbs back exactly to `base` and
 * names a path inside it (`cwdTarget`), never the repo-anchored file.
 *
 * Starting the child straight in a temp folder is not enough: a `..` at the filesystem root stays
 * at the root. On CI the repo is five folders deep and the temp folder is /tmp, so from
 * /tmp/<folder> the five `..` of `rel` stop at / and the cwd-relative reading is the anchored file
 * again. Then a cwd-relative resolver opens the operator database too and the test proves nothing.
 *
 * `chain` lists the nested folders, relative to `base` and sorted as tree() lists them, so a test can
 * require tree(base) to be exactly that: nothing created in base, the cwd-relative target included.
 */
function childCwdFor(rel: string): { base: string; cwd: string; chain: string[]; cwdTarget: string } {
    const base = tempFolder('b');
    const segments = rel.split(path.sep);
    let ups = 0;
    while (ups < segments.length && segments[ups] === '..') ups += 1;
    const chain: string[] = [];
    let cwd = base;
    for (let i = 0; i < ups; i += 1) {
        cwd = path.join(cwd, `d${i}`);
        chain.push(path.relative(base, cwd));
    }
    fs.mkdirSync(cwd, { recursive: true });
    const cwdTarget = path.resolve(cwd, rel);
    return { base, cwd, chain: chain.sort(), cwdTarget };
}

/** `rel` read from the child's folder names a file inside `base`, and not `file`. */
function expectCwdReadingDiffers(rel: string, file: string, base: string, cwdTarget: string): void {
    expect(path.isAbsolute(rel)).toBe(false);
    expect(same(cwdTarget, file)).toBe(false);
    const inside = path.relative(base, cwdTarget);
    expect(inside !== '' && !inside.startsWith('..') && !path.isAbsolute(inside)).toBe(true);
}

describe('AUD-DB-007 re-measured: a start from another directory opens the anchored database or refuses, never a fresh one', () => {
    it('relative-db-path-opens-the-anchored-database: from another folder, a relative DB_PATH opens the operator database (paused, one open buy) and creates nothing', { timeout: CHILD_TIMEOUT }, async () => {
        const a = tempFolder('a');
        const file = path.join(a, 'bot.db');
        seedOperatorDatabase(file);
        const rel = path.relative(REAL_ROOT, file);
        const { base, cwd, chain, cwdTarget } = childCwdFor(rel);
        expectCwdReadingDiffers(rel, file, base, cwdTarget);
        expect(tree(base)).toEqual(chain);

        const ledgerRunId = newCaseId('open');
        const run = await runRailedChildToEnd(process.execPath, ['-e', childScript(OPEN_DB)], { cwd, withVitestEnv: false, envOverrides: { DB_PATH: rel }, ledgerRunId, timeoutMs: CHILD_TIMEOUT });
        const res = resultOf(run);
        expect(run.status, JSON.stringify(res)).toBe(0);
        expect(same(String(res.opened), file)).toBe(true);
        expect(res).toMatchObject({ version: CURRENT_SCHEMA_VERSION, paused: 1, openBuys: 1 });
        expect(tree(base)).toEqual(chain);
        expect(fs.existsSync(cwdTarget)).toBe(false);
        expectRailedNoNetwork(ledgerRunId);
    });

    it('missing-database-is-refused-and-nothing-created: from another folder, a relative DB_PATH naming no database is refused with the anchored absolute path, and nothing is created', { timeout: CHILD_TIMEOUT }, async () => {
        const a = tempFolder('a');
        const file = path.join(a, 'missing.db');
        const rel = path.relative(REAL_ROOT, file);
        const { base, cwd, chain, cwdTarget } = childCwdFor(rel);
        expectCwdReadingDiffers(rel, file, base, cwdTarget);
        expect(tree(base)).toEqual(chain);

        const ledgerRunId = newCaseId('missing');
        const run = await runRailedChildToEnd(process.execPath, ['-e', childScript(OPEN_DB)], { cwd, withVitestEnv: false, envOverrides: { DB_PATH: rel }, ledgerRunId, timeoutMs: CHILD_TIMEOUT });
        const res = resultOf(run);
        // Checked first: nothing may be created, whatever the child printed.
        expect(tree(a)).toEqual([]);
        expect(tree(base)).toEqual(chain);
        expect(fs.existsSync(cwdTarget)).toBe(false);
        expect(run.status).toBe(1);
        expect(res.refused).toBe('DB_REFUSED_MISSING');
        expect(String(res.message).toLowerCase()).toContain(file.toLowerCase());
        expect(String(res.message)).toContain('npm run db:init');
        expectRailedNoNetwork(ledgerRunId);
    });

    it('unset-and-shipped-db-path-resolve-under-the-repo-root: from another folder, an unset DB_PATH and ./data/bot.db both resolve to the repo root data folder (text only, nothing opened)', { timeout: CHILD_TIMEOUT }, async () => {
        const b = tempFolder('b');
        const ledgerRunId = newCaseId('resolve');
        const run = await runRailedChildToEnd(process.execPath, ['-e', childScript(RESOLVE)], { cwd: b, withVitestEnv: false, ledgerRunId, timeoutMs: CHILD_TIMEOUT });
        const res = resultOf(run);
        expect(run.status).toBe(0);
        expect(same(String(res.cwd), b)).toBe(true);
        expect(same(String(res.unset), path.join(REAL_ROOT, 'data', 'bot.db'))).toBe(true);
        expect(same(String(res.shipped), path.join(REAL_ROOT, 'data', 'bot.db'))).toBe(true);
        expect(tree(b)).toEqual([]);
        expectRailedNoNetwork(ledgerRunId);
    });
});

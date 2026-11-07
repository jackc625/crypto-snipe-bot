// scripts/verify-prod-untouched.ts
//
// Phase 22 plan 22-08 Task 1 — SAFE-02 / NAC-03 / P3: the prod-untouched wrapper.
//
// Every Vitest run in Phase 22 is wrapped by this script. It proves that the wrapped command
// did not change the live bot data folder, and (optionally) that the rail-ledger evidence it
// is judged on belongs to THIS invocation (review concern L195@e2e59f6).
//
// Usage:
//   node node_modules/ts-node/dist/bin.js scripts/verify-prod-untouched.ts \
//       [--manifest <MANIFEST.json>] [--require-ledger --expect-projects <p1,p2>] -- <command> [args...]
//   node node_modules/ts-node/dist/bin.js scripts/verify-prod-untouched.ts --self-test
//
// What it does:
//   1. Generates a run id  vpu-<YYYYMMDDTHHMMSS>-<pid>-<6 hex>  (UTC).
//   2. Snapshots <repo>/data/: the sorted recursive listing, and for every regular file the
//      raw-byte SHA-256, size and mtimeMs (a superset of bot.db / bot.db-wal / bot.db-shm).
//      Files are read as raw bytes only; data/ is NEVER opened through SQLite.
//   3. Runs the command as a child with CSB_RAIL_RUN_ID=<runId> added to its env, PATH with
//      path.dirname(process.execPath) first, stdio inherited. A `node` command is run as
//      process.execPath itself without a shell (Node 22.16.0 guaranteed, and the argv reaches
//      Node exactly, e.g. `-t "env block"`); any other command runs with shell: true on win32
//      with each argument quoted for cmd.exe.
//   4. Snapshots data/ again and fails on ANY difference in hash, size, mtime or listing.
//   5. --manifest: also fails unless the live data/ file set equals the manifest's data/ set
//      and every entry's sha256, size and mtime equal the manifest (NAC-03).
//   6. --require-ledger: reads <os.tmpdir()>/crypto-snipe-bot-rail-ledger/<runId>/summary.json
//      and fails if it is missing or unparseable, its runId is not this run's, any
//      --expect-projects name is absent from `projects` or has no worker in
//      `workersByProject`, or nonLoopbackAllowed / telegramAllowed is above 0.
//   7. Prints one verdict line naming the run id and the summary path.
//
// Behavior (exit codes):
//   - bad usage / no command                                -> usage to stderr, exit 1
//   - data/ changed, manifest mismatch, or ledger gate fail -> verdict "touched"/"FAIL", exit 1
//   - otherwise the child's exit status is passed through (0 = all good); a child killed by a
//     signal or that failed to start -> exit 1
//   - uncaught crash in this script                         -> exit 2
//   - --self-test                                           -> exit 0 on PASS, 1 on FAIL
//
// It never reads .env, never loads dotenv, never imports src/ (import-time side effects), and
// has no bypass flag (P5): the data folder location is fixed to <repo>/data; only the
// self-test passes a temp folder, through a function parameter.
//
// Zero new npm deps — Node built-ins only.

if (process.versions.modules !== '127') {
    console.error(
        `verify-prod-untouched requires Node 22.16.0 (ABI 127); this is ${process.version} (ABI ${process.versions.modules}). ` +
            'Run it as C:\\Users\\jackc\\AppData\\Local\\nvm\\v22.16.0\\node.exe (D-21).',
    );
    process.exit(1);
}

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash, randomBytes } from 'crypto';
import { spawnSync } from 'child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileFact {
    rel: string; // forward-slash path relative to the data folder
    type: 'file' | 'dir' | 'other';
    size?: number;
    mtimeMs?: number;
    mtimeIso?: string; // Stats.mtime.toISOString() (Node rounds mtimeMs), the backup MANIFEST form
    sha256?: string;
}

interface Snapshot {
    dataDir: string;
    exists: boolean;
    entries: FileFact[]; // sorted by rel
}

interface ManifestEntry {
    path: string;
    status: string;
    size?: number;
    sha256?: string;
    mtime?: string;
}

interface LedgerSummary {
    runId?: unknown;
    projects?: unknown;
    workersByProject?: unknown;
    nonLoopbackAllowed?: unknown;
    telegramAllowed?: unknown;
}

interface GateResult {
    ok: boolean;
    problems: string[];
}

// ---------------------------------------------------------------------------
// Repo root, run id
// ---------------------------------------------------------------------------

function findRepoRoot(start: string): string {
    let dir = start;
    for (;;) {
        const pkg = path.join(dir, 'package.json');
        if (fs.existsSync(pkg)) {
            try {
                if (JSON.parse(fs.readFileSync(pkg, 'utf8')).name === 'crypto-snipe-bot') return dir;
            } catch {
                /* keep walking */
            }
        }
        const parent = path.dirname(dir);
        if (parent === dir) throw new Error(`verify-prod-untouched: no package.json named crypto-snipe-bot above ${start}`);
        dir = parent;
    }
}

function utcStamp(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

export function newRunId(): string {
    return `vpu-${utcStamp(new Date())}-${process.pid}-${randomBytes(3).toString('hex')}`;
}

export const LEDGER_ROOT = path.join(os.tmpdir(), 'crypto-snipe-bot-rail-ledger');

// ---------------------------------------------------------------------------
// Snapshot and comparison
// ---------------------------------------------------------------------------

function sha256File(p: string): string {
    // Raw bytes only — never through SQLite.
    return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

export function snapshot(dataDir: string): Snapshot {
    const entries: FileFact[] = [];
    if (!fs.existsSync(dataDir)) return { dataDir, exists: false, entries };
    const walk = (dir: string, relBase: string) => {
        const names = fs.readdirSync(dir).sort();
        for (const name of names) {
            const full = path.join(dir, name);
            const rel = relBase ? `${relBase}/${name}` : name;
            const st = fs.lstatSync(full);
            if (st.isDirectory()) {
                entries.push({ rel, type: 'dir' });
                walk(full, rel);
            } else if (st.isFile()) {
                entries.push({ rel, type: 'file', size: st.size, mtimeMs: st.mtimeMs, mtimeIso: st.mtime.toISOString(), sha256: sha256File(full) });
            } else {
                entries.push({ rel, type: 'other', mtimeMs: st.mtimeMs });
            }
        }
    };
    walk(dataDir, '');
    entries.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
    return { dataDir, exists: true, entries };
}

export function compareSnapshots(before: Snapshot, after: Snapshot): string[] {
    const diffs: string[] = [];
    if (before.exists !== after.exists) diffs.push(`data folder existence changed: ${before.exists} -> ${after.exists}`);
    const b = new Map(before.entries.map((e) => [e.rel, e]));
    const a = new Map(after.entries.map((e) => [e.rel, e]));
    for (const [rel, e] of b) {
        const x = a.get(rel);
        if (!x) {
            diffs.push(`removed: ${rel}`);
            continue;
        }
        if (x.type !== e.type) diffs.push(`type changed: ${rel} ${e.type} -> ${x.type}`);
        if (x.size !== e.size) diffs.push(`size changed: ${rel} ${e.size} -> ${x.size}`);
        if (x.mtimeMs !== e.mtimeMs) diffs.push(`mtime changed: ${rel} ${e.mtimeMs} -> ${x.mtimeMs}`);
        if (x.sha256 !== e.sha256) diffs.push(`sha256 changed: ${rel} ${e.sha256} -> ${x.sha256}`);
    }
    for (const rel of a.keys()) if (!b.has(rel)) diffs.push(`added: ${rel}`);
    return diffs;
}

export function checkManifest(manifestPath: string, snap: Snapshot): GateResult {
    const problems: string[] = [];
    let manifest: { entries?: ManifestEntry[] };
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
        return { ok: false, problems: [`cannot read manifest ${manifestPath}: ${e instanceof Error ? e.message : String(e)}`] };
    }
    const all = Array.isArray(manifest.entries) ? manifest.entries : [];
    const dataEntries = all.filter((e) => typeof e.path === 'string' && e.path.startsWith('data/'));
    if (dataEntries.length === 0) problems.push('manifest has no data/ entries');
    const live = new Map(snap.entries.filter((e) => e.type === 'file').map((e) => [`data/${e.rel}`, e]));
    for (const m of dataEntries) {
        const l = live.get(m.path);
        if (m.status !== 'PRESENT') {
            if (l) problems.push(`${m.path}: manifest says ${m.status} but the live file exists`);
            continue;
        }
        if (!l) {
            problems.push(`${m.path}: in manifest, missing live`);
            continue;
        }
        if (l.sha256 !== m.sha256) problems.push(`${m.path}: sha256 live ${l.sha256} != manifest ${m.sha256}`);
        if (l.size !== m.size) problems.push(`${m.path}: size live ${l.size} != manifest ${m.size}`);
        const liveIso = l.mtimeIso as string;
        if (typeof m.mtime === 'string' && liveIso !== m.mtime) problems.push(`${m.path}: mtime live ${liveIso} != manifest ${m.mtime}`);
    }
    const manifestPaths = new Set(dataEntries.filter((m) => m.status === 'PRESENT').map((m) => m.path));
    for (const p of live.keys()) if (!manifestPaths.has(p)) problems.push(`${p}: live file not in manifest`);
    return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// Run-bound ledger gate
// ---------------------------------------------------------------------------

export function checkLedger(ledgerRoot: string, runId: string, expectProjects: string[]): GateResult & { summaryPath: string } {
    const summaryPath = path.join(ledgerRoot, runId, 'summary.json');
    const problems: string[] = [];
    let s: LedgerSummary;
    try {
        s = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as LedgerSummary;
    } catch (e) {
        return { ok: false, problems: [`ledger summary missing or unparseable: ${summaryPath} (${e instanceof Error ? e.message : String(e)})`], summaryPath };
    }
    if (s.runId !== runId) problems.push(`ledger summary belongs to run ${JSON.stringify(s.runId)}, not ${runId}`);
    const projectNames = Array.isArray(s.projects)
        ? s.projects.map((p) => (p && typeof p === 'object' ? (p as { project?: unknown }).project : p)).filter((n): n is string => typeof n === 'string')
        : [];
    const workers = s.workersByProject && typeof s.workersByProject === 'object' ? (s.workersByProject as Record<string, unknown>) : {};
    for (const p of expectProjects) {
        if (!projectNames.includes(p)) problems.push(`expected project ${p} is not in summary.projects [${projectNames.join(', ')}]`);
        const w = workers[p];
        if (!Array.isArray(w) || w.length === 0) problems.push(`expected project ${p} has no worker in summary.workersByProject`);
    }
    if (typeof s.nonLoopbackAllowed !== 'number' || s.nonLoopbackAllowed !== 0) problems.push(`nonLoopbackAllowed is ${JSON.stringify(s.nonLoopbackAllowed)} (must be 0)`);
    if (typeof s.telegramAllowed !== 'number' || s.telegramAllowed !== 0) problems.push(`telegramAllowed is ${JSON.stringify(s.telegramAllowed)} (must be 0)`);
    return { ok: problems.length === 0, problems, summaryPath };
}

// ---------------------------------------------------------------------------
// Running the wrapped command
// ---------------------------------------------------------------------------

function quoteForCmd(arg: string): string {
    if (/^[A-Za-z0-9_\-+=.,:/\\@]+$/.test(arg)) return arg;
    return '"' + arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
}

export function runCommand(command: string[], runId: string): { status: number | null; signal: string | null; error?: string } {
    const [cmd, ...args] = command;
    const env: NodeJS.ProcessEnv = { ...process.env, CSB_RAIL_RUN_ID: runId };
    const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
    env[pathKey] = path.dirname(process.execPath) + path.delimiter + (env[pathKey] || '');
    const isNode = cmd === 'node' || cmd === process.execPath;
    const r = isNode
        ? spawnSync(process.execPath, args, { stdio: 'inherit', env, windowsHide: true })
        : process.platform === 'win32'
          ? spawnSync([cmd, ...args].map(quoteForCmd).join(' '), { stdio: 'inherit', env, shell: true, windowsHide: true })
          : spawnSync(cmd, args, { stdio: 'inherit', env });
    return { status: r.status, signal: r.signal, error: r.error ? r.error.message : undefined };
}

export interface WrapOptions {
    dataDir: string;
    command: string[];
    runId: string;
    manifest?: string;
    requireLedger?: boolean;
    expectProjects?: string[];
    ledgerRoot?: string;
    quiet?: boolean;
}

export interface WrapResult {
    exitCode: number;
    untouched: boolean;
    diffs: string[];
    manifest?: GateResult;
    ledger?: GateResult & { summaryPath: string };
    childStatus: number | null;
    verdictLine: string;
    before: Snapshot;
}

export function runWrapped(o: WrapOptions): WrapResult {
    const log = (s: string) => {
        if (!o.quiet) console.log(s);
    };
    const before = snapshot(o.dataDir);
    log(`verify-prod-untouched: run ${o.runId} — snapshot before: ${before.entries.length} entries under ${o.dataDir}`);
    const child = runCommand(o.command, o.runId);
    const after = snapshot(o.dataDir);
    const diffs = compareSnapshots(before, after);
    const untouched = diffs.length === 0;
    let manifest: GateResult | undefined;
    if (o.manifest) manifest = checkManifest(o.manifest, after);
    let ledger: (GateResult & { summaryPath: string }) | undefined;
    const ledgerRoot = o.ledgerRoot || LEDGER_ROOT;
    if (o.requireLedger) ledger = checkLedger(ledgerRoot, o.runId, o.expectProjects || []);

    for (const d of diffs) log(`verify-prod-untouched: DATA CHANGED: ${d}`);
    if (manifest) {
        for (const p of manifest.problems) log(`verify-prod-untouched: MANIFEST MISMATCH: ${p}`);
        if (manifest.ok) {
            for (const e of after.entries.filter((x) => x.type === 'file')) {
                log(`verify-prod-untouched:   data/${e.rel} sha256 ${e.sha256} size ${e.size} == manifest`);
            }
        }
    }
    if (ledger) for (const p of ledger.problems) log(`verify-prod-untouched: LEDGER GATE: ${p}`);

    const childFailed = child.status !== 0;
    let exitCode: number;
    if (!untouched || (manifest && !manifest.ok) || (ledger && !ledger.ok)) exitCode = 1;
    else if (child.status === null) exitCode = 1;
    else exitCode = child.status;

    const summaryPath = ledger ? ledger.summaryPath : path.join(ledgerRoot, o.runId, 'summary.json');
    const parts = [
        `verdict: ${untouched ? 'untouched' : 'TOUCHED'}`,
        `run ${o.runId}`,
        `child exit ${child.status === null ? `null (signal ${child.signal}${child.error ? `, error ${child.error}` : ''})` : child.status}`,
        `manifest: ${manifest ? (manifest.ok ? 'equal' : 'MISMATCH') : 'not checked'}`,
        `ledger: ${ledger ? (ledger.ok ? 'ok' : 'FAIL') : 'not required'}`,
        `summary ${summaryPath}`,
    ];
    const verdictLine = `verify-prod-untouched: ${parts.join(' | ')}`;
    log(verdictLine);
    if (childFailed && untouched) log('verify-prod-untouched: (the wrapped command failed; its exit status is passed through)');
    return { exitCode, untouched, diffs, manifest, ledger, childStatus: child.status, verdictLine, before };
}

// ---------------------------------------------------------------------------
// Self-test (temp fake data folder and fabricated ledger runs only)
// ---------------------------------------------------------------------------

function selfTest(): number {
    const results: Array<[string, boolean, string]> = [];
    const rec = (label: string, ok: boolean, detail = '') => results.push([label, ok, detail]);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-vpu-selftest-'));
    try {
        const fakeData = path.join(tmp, 'data');
        fs.mkdirSync(fakeData);
        fs.writeFileSync(path.join(fakeData, 'bot.db'), Buffer.from('fake-db-bytes'));
        fs.writeFileSync(path.join(fakeData, 'bot.db-wal'), Buffer.from('fake-wal'));
        fs.writeFileSync(path.join(fakeData, 'bot.db-shm'), Buffer.from('fake-shm'));
        const target = path.join(fakeData, 'bot.db').replace(/\\/g, '/');
        const node = process.execPath;

        // (1) no-op command passes
        const noop = runWrapped({ dataDir: fakeData, command: [node, '-e', '0'], runId: newRunId(), quiet: true });
        rec('no-op command -> untouched, exit 0', noop.untouched && noop.exitCode === 0, noop.verdictLine);

        // (2) a mid-run append is detected
        const app = runWrapped({ dataDir: fakeData, command: [node, '-e', `require('fs').appendFileSync(${JSON.stringify(target)}, 'x')`], runId: newRunId(), quiet: true });
        rec('mid-run append -> TOUCHED, exit 1', !app.untouched && app.exitCode === 1 && app.diffs.some((d) => d.startsWith('sha256 changed: bot.db')), app.diffs.join('; '));

        // (3) an mtime-only change is detected
        const mt = runWrapped({ dataDir: fakeData, command: [node, '-e', `const f=${JSON.stringify(target)};require('fs').utimesSync(f, new Date(1e12), new Date(1e12))`], runId: newRunId(), quiet: true });
        rec('mtime-only change -> TOUCHED', !mt.untouched && mt.diffs.some((d) => d.startsWith('mtime changed: bot.db')), mt.diffs.join('; '));

        // (4) a new file (listing change) is detected
        const added = runWrapped({ dataDir: fakeData, command: [node, '-e', `require('fs').writeFileSync(${JSON.stringify(path.join(fakeData, 'new.db').replace(/\\/g, '/'))}, '')`], runId: newRunId(), quiet: true });
        rec('listing change -> TOUCHED', !added.untouched && added.diffs.includes('added: new.db'), added.diffs.join('; '));
        fs.unlinkSync(path.join(fakeData, 'new.db'));

        // (5) a failing child is passed through while data stays untouched
        const fail = runWrapped({ dataDir: fakeData, command: [node, '-e', 'process.exit(3)'], runId: newRunId(), quiet: true });
        rec('child exit 3 passed through, untouched', fail.untouched && fail.exitCode === 3, fail.verdictLine);

        // (6) the child receives this run's CSB_RAIL_RUN_ID
        const rid = newRunId();
        const seen = runWrapped({ dataDir: fakeData, command: [node, '-e', `process.exit(process.env.CSB_RAIL_RUN_ID === ${JSON.stringify(rid)} ? 0 : 4)`], runId: rid, quiet: true });
        rec('child sees CSB_RAIL_RUN_ID = run id', seen.exitCode === 0, seen.verdictLine);

        // (7) manifest equality: matching manifest passes, a wrong hash fails
        const snap = snapshot(fakeData);
        const mk = (mut?: (e: ManifestEntry[]) => void) => {
            const entries: ManifestEntry[] = snap.entries
                .filter((e) => e.type === 'file')
                .map((e) => ({ path: `data/${e.rel}`, status: 'PRESENT', size: e.size, sha256: e.sha256, mtime: e.mtimeIso }));
            if (mut) mut(entries);
            const p = path.join(tmp, `manifest-${randomBytes(3).toString('hex')}.json`);
            fs.writeFileSync(p, JSON.stringify({ meta: {}, entries }));
            return p;
        };
        rec('manifest equal -> ok', checkManifest(mk(), snap).ok);
        rec('manifest wrong sha256 -> mismatch', !checkManifest(mk((e) => (e[0].sha256 = '0'.repeat(64))), snap).ok);
        rec('manifest missing a live file -> mismatch', !checkManifest(mk((e) => e.pop()), snap).ok);

        // (8) ledger gate against fabricated run folders
        const ledgerRoot = path.join(tmp, 'ledger');
        const writeSummary = (runId: string, body: Record<string, unknown>) => {
            fs.mkdirSync(path.join(ledgerRoot, runId), { recursive: true });
            fs.writeFileSync(path.join(ledgerRoot, runId, 'summary.json'), JSON.stringify(body));
        };
        const good = (runId: string) => ({
            runId,
            projects: [{ project: 'unit', startedAt: 'x', mainPid: 1 }, { project: 'integration', startedAt: 'x', mainPid: 1 }],
            workersByProject: { unit: [11], integration: [12] },
            nonLoopbackAllowed: 0,
            telegramAllowed: 0,
        });
        const r1 = newRunId();
        writeSummary(r1, good(r1));
        rec('ledger: correct summary -> ok', checkLedger(ledgerRoot, r1, ['unit', 'integration']).ok);
        const r2 = newRunId();
        writeSummary(r2, good('vpu-19990101T000000-1-abcdef'));
        rec('ledger: foreign run id -> FAIL', !checkLedger(ledgerRoot, r2, ['unit']).ok);
        const r3 = newRunId();
        writeSummary(r3, { ...good(r3), projects: [{ project: 'unit' }], workersByProject: { unit: [11] } });
        rec('ledger: missing expected project -> FAIL', !checkLedger(ledgerRoot, r3, ['unit', 'integration']).ok);
        const r4 = newRunId();
        writeSummary(r4, { ...good(r4), workersByProject: { unit: [11], integration: [] } });
        rec('ledger: project with zero workers -> FAIL', !checkLedger(ledgerRoot, r4, ['unit', 'integration']).ok);
        rec('ledger: missing summary -> FAIL', !checkLedger(ledgerRoot, newRunId(), ['unit']).ok);
        const r5 = newRunId();
        writeSummary(r5, { ...good(r5), nonLoopbackAllowed: 1 });
        rec('ledger: nonLoopbackAllowed 1 -> FAIL', !checkLedger(ledgerRoot, r5, ['unit']).ok);
        const r6 = newRunId();
        writeSummary(r6, { ...good(r6), telegramAllowed: 2 });
        rec('ledger: telegramAllowed 2 -> FAIL', !checkLedger(ledgerRoot, r6, ['unit']).ok);

        // (9) the full wrapped path with --require-ledger: a child that writes the right summary passes,
        //     one that writes nothing fails
        const r7 = newRunId();
        const writer = `const fs=require('fs'),p=require('path');const id=process.env.CSB_RAIL_RUN_ID;const d=p.join(${JSON.stringify(ledgerRoot.replace(/\\/g, '/'))},id);fs.mkdirSync(d,{recursive:true});fs.writeFileSync(p.join(d,'summary.json'),JSON.stringify({runId:id,projects:[{project:'unit'}],workersByProject:{unit:[1]},nonLoopbackAllowed:0,telegramAllowed:0}))`;
        const w1 = runWrapped({ dataDir: fakeData, command: [node, '-e', writer], runId: r7, requireLedger: true, expectProjects: ['unit'], ledgerRoot, quiet: true });
        rec('wrapped run writing its own summary -> ok', w1.exitCode === 0 && !!w1.ledger && w1.ledger.ok, w1.verdictLine);
        const w2 = runWrapped({ dataDir: fakeData, command: [node, '-e', '0'], runId: newRunId(), requireLedger: true, expectProjects: ['unit'], ledgerRoot, quiet: true });
        rec('wrapped run with no summary -> exit 1', w2.exitCode === 1 && !!w2.ledger && !w2.ledger.ok, w2.verdictLine);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
    let pass = true;
    for (const [label, ok, detail] of results) {
        if (!ok) pass = false;
        console.log(`verify-prod-untouched self-test: ${ok ? 'PASS' : 'FAIL'} — ${label}${ok || !detail ? '' : ` (${detail})`}`);
    }
    console.log(`verify-prod-untouched self-test: ${pass ? 'PASS' : 'FAIL'} (${results.filter((r) => r[1]).length}/${results.length})`);
    return pass ? 0 : 1;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage(msg?: string): never {
    if (msg) console.error(`verify-prod-untouched: ${msg}`);
    console.error(
        'Usage: verify-prod-untouched.ts [--manifest <MANIFEST.json>] [--require-ledger --expect-projects <p1,p2>] -- <command> [args...]\n' +
            '       verify-prod-untouched.ts --self-test',
    );
    process.exit(1);
}

function main(): void {
    const argv = process.argv.slice(2);
    if (argv.length === 1 && argv[0] === '--self-test') process.exit(selfTest());
    const dd = argv.indexOf('--');
    if (dd === -1) usage('missing "--" before the command');
    const opts = argv.slice(0, dd);
    const command = argv.slice(dd + 1);
    if (command.length === 0) usage('no command after "--"');
    let manifest: string | undefined;
    let requireLedger = false;
    let expectProjects: string[] = [];
    for (let i = 0; i < opts.length; i++) {
        const a = opts[i];
        if (a === '--manifest') {
            manifest = opts[++i];
            if (!manifest) usage('--manifest needs a path');
        } else if (a === '--require-ledger') {
            requireLedger = true;
        } else if (a === '--expect-projects') {
            const v = opts[++i];
            if (!v) usage('--expect-projects needs a comma-separated list');
            expectProjects = v.split(',').map((s) => s.trim()).filter((s) => s !== '');
        } else {
            usage(`unknown option ${a}`);
        }
    }
    if (expectProjects.length > 0 && !requireLedger) usage('--expect-projects requires --require-ledger');
    if (requireLedger && expectProjects.length === 0) usage('--require-ledger requires --expect-projects');
    const repoRoot = findRepoRoot(__dirname);
    const r = runWrapped({ dataDir: path.join(repoRoot, 'data'), command, runId: newRunId(), manifest, requireLedger, expectProjects });
    process.exit(r.exitCode);
}

try {
    main();
} catch (e) {
    console.error(`verify-prod-untouched: crashed: ${e instanceof Error ? e.stack || e.message : String(e)}`);
    process.exit(2);
}

// test/rails/spawnRailedChild.ts
//
// Phase 22 plan 22-08 Task 1 — SAFE-02 D-03: the ONLY sanctioned way for a test to start a
// child process (review concerns L194@e2e59f6 and L202@e2e59f6).
//
// Every child gets the same setup-layer rails as a Vitest worker: its env is built from
// scratch out of the committed inert sentinels (test/.env.test) plus a fixed list of OS
// essentials (the parent env is never spread into it), and NODE_OPTIONS loads the rails entry
// (test/rails/preload.cjs, or test/rails/setup-fork.cjs for the fork-entry proof) with
// `--require ${JSON.stringify(absPath)}`. NODE_OPTIONS is applied LAST, so no option can
// remove the preload. Node reads NODE_OPTIONS before any user code, so the rails are in
// place before the child's first module-scope import.
//
// Fail-closed limits, all checked BEFORE anything is spawned (each error names its limit):
//   [limit: command]      cmd must be process.execPath, 'node' or 'npx'. Any other program
//                         would not be a Node process and would get no preload at all.
//                         'node' runs as process.execPath (Node 22.16.0, D-21); 'npx' runs as
//                         npx.cmd with shell: true on win32 and always with `--no`, so npx can
//                         never contact the registry (RESEARCH Pattern 4).
//   [limit: envOverrides] keys must be test/.env.test app keys and values strings. The child
//                         re-validates them in core.applyChildOverrides (a generated temp
//                         module loaded by a second --require AFTER the rails entry).
//   [limit: homeOverride] HOME/USERPROFILE may only point at an absolute path under
//                         os.tmpdir() (a fake home can never be the operator's real one).
//   [limit: nodeOptions]  only --expose-gc, --preserve-symlinks, --preserve-symlinks-main,
//                         --no-warnings, --max-old-space-size=<n>, --stack-size=<n>.
//   [limit: env-file]     no argument may be or start with --env-file (covers
//                         --env-file-if-exists): Node reads an env file BEFORE any JS
//                         preload runs, so it would load values the rails never scrub.
//   [limit: require]      -r / --require only for ts-node/register or
//                         ts-node/register/transpile-only; --import / --loader /
//                         --experimental-loader are refused (another module loaded ahead of
//                         or beside the rails could undo them).
//   [limit: path]         no path-like argument (contains / or \ or starts with .), and no
//                         cwd, may canonicalise inside <repo>/data/ or to <repo>/.env /
//                         <repo>/.env.* other than .env.example.
//   [limit: inheritedEnv] inheritedEnv may not name NODE_OPTIONS, PATH/Path, VITEST or any
//                         VITEST_* key, any CSB_RAIL_* key, any NODE_* key, or any OS essential
//                         below. Its values are only the literals the test passes (it is never
//                         filled from process.env); the child's own rails then scrub or
//                         preserve them exactly as a worker's rails would.
//
// Child env, in order: every key of test/.env.test; then inheritedEnv; then only these OS
// essentials copied from process.env: SystemRoot, ComSpec, PATHEXT, APPDATA, LOCALAPPDATA,
// USERPROFILE, HOME, TEMP, TMP, TMPDIR, and PATH with path.dirname(process.execPath) first;
// HOME and USERPROFILE replaced by homeOverride when given; CSB_RAIL_RUN_ID copied from
// process.env when set (ledger location only); VITEST=true unless withVitestEnv === false;
// and last NODE_OPTIONS = --require <rails entry> [--require <overrides module>] [nodeOptions].
//
// killProcessTree(pid) is the only sanctioned force-kill (taskkill /F /T on win32, SIGKILL
// elsewhere); it lives here because the 22-11 spawn gate allows no child_process use in any
// other test file. test/fork/setup.ts is the single exempt spawner: it starts Hardhat and
// needs the network (22-11 sanitises its child env).
//
// No option removes a rail (P5 / NAC-05): options only change the child's app-key values,
// its home folder, an enumerated set of harmless Node flags, and which rails entry preloads.

import { spawn, spawnSync, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse as parseDotenv } from 'dotenv';

export interface CliResult {
    status: number | null;
    stdout: string;
    stderr: string;
}

export interface SpawnRailedOptions {
    cwd?: string;
    envOverrides?: Record<string, string>;
    homeOverride?: string;
    withVitestEnv?: boolean;
    railsEntry?: 'preload' | 'setup-fork';
    nodeOptions?: string[];
    timeoutMs?: number;
    inheritedEnv?: Record<string, string>;
    input?: string;
}

const IS_WIN = process.platform === 'win32';

const OS_ESSENTIAL_KEYS = Object.freeze(['SystemRoot', 'ComSpec', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOME', 'TEMP', 'TMP', 'TMPDIR']);
const ALLOWED_NODE_OPTIONS = Object.freeze(['--expose-gc', '--preserve-symlinks', '--preserve-symlinks-main', '--no-warnings']);
const ALLOWED_NODE_OPTION_RES = Object.freeze([/^--max-old-space-size=\d+$/, /^--stack-size=\d+$/]);
const ALLOWED_REQUIRES = Object.freeze(['ts-node/register', 'ts-node/register/transpile-only']);

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
        if (parent === dir) throw new Error(`spawnRailedChild: no package.json named crypto-snipe-bot above ${start}`);
        dir = parent;
    }
}

export const REPO_ROOT = findRepoRoot(__dirname);
const RAILS_DIR = path.join(REPO_ROOT, 'test', 'rails');
const RAILS_ENTRIES = Object.freeze({
    preload: path.join(RAILS_DIR, 'preload.cjs'),
    'setup-fork': path.join(RAILS_DIR, 'setup-fork.cjs'),
});
const CORE_PATH = path.join(RAILS_DIR, 'core.cjs');

/** The committed inert sentinels (test/.env.test), parsed exactly as core.cjs parses them. */
export function readSentinels(): Record<string, string> {
    return parseDotenv(fs.readFileSync(path.join(REPO_ROOT, 'test', '.env.test')));
}

function refuse(limit: string, detail: string): never {
    throw new Error(`spawnRailedChild refused [limit: ${limit}]: ${detail}`);
}

function keyIs(k: string, name: string): boolean {
    return IS_WIN ? k.toUpperCase() === name.toUpperCase() : k === name;
}

// ---------------------------------------------------------------------------
// Path canonicalisation (directories through realpath; files keep their name, never opened)
// ---------------------------------------------------------------------------

function normalizeWin(p: string): string {
    if (!IS_WIN) return p;
    let s = p;
    if (/^\\\\[?.]\\UNC\\/i.test(s)) s = '\\\\' + s.slice(8);
    else if (/^\\\\[?.]\\[A-Za-z]:/.test(s)) s = s.slice(4);
    const root = path.parse(s).root;
    const segs = s
        .slice(root.length)
        .split(/[\\/]+/)
        .map((x) => x.replace(/:.*$/, '').replace(/[. ]+$/, ''))
        .filter((x) => x !== '');
    return (root + segs.join('\\')).toLowerCase();
}

function canonPath(p: string, base: string): string {
    let cur = path.resolve(base, p);
    const tail: string[] = [];
    for (;;) {
        let isDir = false;
        try {
            isDir = fs.lstatSync(cur).isDirectory();
        } catch {
            isDir = false;
        }
        if (isDir) {
            try {
                cur = fs.realpathSync.native(cur);
            } catch {
                /* keep lexical */
            }
            break;
        }
        const parent = path.dirname(cur);
        if (parent === cur) break;
        tail.unshift(path.basename(cur));
        cur = parent;
    }
    return normalizeWin(path.join(cur, ...tail));
}

const CANON_ROOT = canonPath(REPO_ROOT, REPO_ROOT);
const CANON_DATA = canonPath(path.join(REPO_ROOT, 'data'), REPO_ROOT);
const CANON_TMP = canonPath(os.tmpdir(), REPO_ROOT);

function isInside(child: string, parent: string): boolean {
    return child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
}

function envBasenameBlocked(base: string): boolean {
    const b = IS_WIN ? base.replace(/:.*$/, '').replace(/[. ]+$/, '').toLowerCase() : base;
    return b === '.env' || (b.startsWith('.env.') && b !== '.env.example');
}

function checkPathLike(raw: string, base: string, what: string): void {
    const cands = [raw];
    const eq = raw.indexOf('=');
    if (eq > 0) cands.push(raw.slice(eq + 1));
    for (const c of cands) {
        if (c === '') continue;
        if (!(c.includes('/') || c.includes('\\') || c.startsWith('.'))) continue;
        let s = c;
        if (/^file:/i.test(s)) {
            try {
                s = new URL(s).pathname;
                if (IS_WIN && /^\/[A-Za-z]:/.test(s)) s = s.slice(1);
                s = decodeURIComponent(s);
            } catch {
                continue;
            }
        }
        const can = canonPath(s, base);
        if (can === CANON_DATA || isInside(can, CANON_DATA)) refuse('path', `${what} ${JSON.stringify(raw)} points inside the live data folder (${CANON_DATA})`);
        if (path.dirname(can) === CANON_ROOT && envBasenameBlocked(path.basename(can))) {
            refuse('path', `${what} ${JSON.stringify(raw)} names the repo .env file`);
        }
    }
}

// ---------------------------------------------------------------------------
// Validation (fail closed, before spawning)
// ---------------------------------------------------------------------------

interface Plan {
    file: string;
    args: string[];
    shell: boolean;
    cwd: string;
    env: Record<string, string>;
    timeoutMs: number;
    overridesDir: string | null;
}

function buildPlan(cmd: string, args: string[], opts: SpawnRailedOptions): Plan {
    const o = opts || {};
    // [limit: command]
    if (cmd !== process.execPath && cmd !== 'node' && cmd !== 'npx') {
        refuse('command', `${JSON.stringify(cmd)} is not process.execPath, 'node' or 'npx' (a non-Node program would get no rails preload)`);
    }
    if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) refuse('args', 'args must be an array of strings');
    const cwd = o.cwd === undefined ? REPO_ROOT : o.cwd;
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) refuse('path', `cwd must be an absolute path, got ${JSON.stringify(cwd)}`);
    const canCwd = canonPath(cwd, REPO_ROOT);
    if (canCwd === CANON_DATA || isInside(canCwd, CANON_DATA)) refuse('path', `cwd ${JSON.stringify(cwd)} is inside the live data folder`);

    // [limit: env-file] / [limit: require] / [limit: path]
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a.startsWith('--env-file')) refuse('env-file', `${JSON.stringify(a)} — Node reads an env file before any JS preload runs`);
        if (a === '-r' || a === '--require') {
            const v = args[i + 1];
            if (v === undefined || !ALLOWED_REQUIRES.includes(v)) refuse('require', `${a} ${JSON.stringify(v)} — only ${ALLOWED_REQUIRES.join(' / ')} may be required`);
            i += 1;
            continue;
        }
        const reqEq = a.match(/^(?:-r|--require)=(.*)$/);
        if (reqEq) {
            if (!ALLOWED_REQUIRES.includes(reqEq[1])) refuse('require', `${JSON.stringify(a)} — only ${ALLOWED_REQUIRES.join(' / ')} may be required`);
            continue;
        }
        if (/^(?:--import|--loader|--experimental-loader)(?:=|$)/.test(a)) refuse('require', `${JSON.stringify(a)} — no module may be loaded beside the rails entry`);
        checkPathLike(a, cwd, 'argument');
    }

    // [limit: nodeOptions]
    const nodeOptions = o.nodeOptions || [];
    if (!Array.isArray(nodeOptions)) refuse('nodeOptions', 'nodeOptions must be an array');
    for (const n of nodeOptions) {
        if (typeof n !== 'string' || !(ALLOWED_NODE_OPTIONS.includes(n) || ALLOWED_NODE_OPTION_RES.some((re) => re.test(n)))) {
            refuse('nodeOptions', `${JSON.stringify(n)} is not one of ${ALLOWED_NODE_OPTIONS.join(', ')}, --max-old-space-size=<n>, --stack-size=<n>`);
        }
    }

    const sentinels = readSentinels();
    const sentinelKeys = Object.keys(sentinels);

    // [limit: envOverrides]
    const overrides = o.envOverrides;
    if (overrides !== undefined) {
        if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) refuse('envOverrides', 'envOverrides must be a plain object');
        for (const [k, v] of Object.entries(overrides)) {
            if (!sentinelKeys.includes(k)) refuse('envOverrides', `${k} is not a test/.env.test app key`);
            if (typeof v !== 'string') refuse('envOverrides', `value for ${k} must be a string`);
        }
    }

    // [limit: homeOverride]
    if (o.homeOverride !== undefined) {
        const h = o.homeOverride;
        if (typeof h !== 'string' || !path.isAbsolute(h)) refuse('homeOverride', `${JSON.stringify(h)} is not an absolute path`);
        const canH = canonPath(h, REPO_ROOT);
        if (!isInside(canH, CANON_TMP)) refuse('homeOverride', `${JSON.stringify(h)} is not under os.tmpdir() (${os.tmpdir()})`);
    }

    // [limit: inheritedEnv]
    const inherited = o.inheritedEnv;
    if (inherited !== undefined) {
        if (!inherited || typeof inherited !== 'object' || Array.isArray(inherited)) refuse('inheritedEnv', 'inheritedEnv must be a plain object');
        for (const [k, v] of Object.entries(inherited)) {
            const up = k.toUpperCase();
            const bad =
                keyIs(k, 'NODE_OPTIONS') ||
                keyIs(k, 'PATH') ||
                (IS_WIN ? up : k).startsWith('VITEST') ||
                (IS_WIN ? up : k).startsWith('CSB_RAIL_') ||
                (IS_WIN ? up : k).startsWith('NODE_') ||
                OS_ESSENTIAL_KEYS.some((e) => keyIs(k, e));
            if (bad) refuse('inheritedEnv', `${k} may not be planted (it controls the rails, the preload or the OS environment)`);
            if (typeof v !== 'string') refuse('inheritedEnv', `value for ${k} must be a string literal`);
        }
    }

    // ---- build the child env from scratch (the parent env is never spread in) ----
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(sentinels)) env[k] = v;
    if (inherited) for (const [k, v] of Object.entries(inherited)) env[k] = v;
    const parentKeys = Object.keys(process.env);
    for (const e of OS_ESSENTIAL_KEYS) {
        const pk = parentKeys.find((k) => keyIs(k, e));
        const v = pk === undefined ? undefined : process.env[pk];
        if (typeof v === 'string') env[e] = v;
    }
    const parentPathKey = parentKeys.find((k) => k.toUpperCase() === 'PATH');
    const parentPath = parentPathKey ? process.env[parentPathKey] || '' : '';
    env.PATH = path.dirname(process.execPath) + path.delimiter + parentPath;
    if (o.homeOverride !== undefined) {
        env.HOME = o.homeOverride;
        env.USERPROFILE = o.homeOverride;
    }
    const runId = process.env.CSB_RAIL_RUN_ID;
    if (typeof runId === 'string' && runId !== '') env.CSB_RAIL_RUN_ID = runId;
    if (o.withVitestEnv !== false) env.VITEST = 'true';

    const entry = RAILS_ENTRIES[o.railsEntry || 'preload'];
    if (!entry) refuse('railsEntry', `${JSON.stringify(o.railsEntry)} is not 'preload' or 'setup-fork'`);
    const parts = [`--require ${JSON.stringify(entry)}`];
    let overridesDir: string | null = null;
    if (overrides !== undefined) {
        overridesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-child-overrides-'));
        const mod = path.join(overridesDir, 'overrides.cjs');
        fs.writeFileSync(mod, `'use strict';\nrequire(${JSON.stringify(CORE_PATH)}).applyChildOverrides(${JSON.stringify(overrides)});\n`, 'utf8');
        parts.push(`--require ${JSON.stringify(mod)}`);
    }
    parts.push(...nodeOptions);
    // Applied last: nothing above can remove or reorder the rails preload.
    env.NODE_OPTIONS = parts.join(' ');

    const isNpx = cmd === 'npx';
    const file = isNpx ? (IS_WIN ? 'npx.cmd' : 'npx') : process.execPath;
    const finalArgs = isNpx ? ['--no', ...args] : args.slice();
    const timeoutMs = o.timeoutMs === undefined ? 60_000 : o.timeoutMs;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) refuse('timeoutMs', 'timeoutMs must be a positive integer');
    return { file, args: finalArgs, shell: isNpx && IS_WIN, cwd, env, timeoutMs, overridesDir };
}

function quoteForCmd(arg: string): string {
    if (/^[A-Za-z0-9_\-+=.,:/\\@]+$/.test(arg)) return arg;
    return '"' + arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
}

function cleanup(dir: string | null): void {
    if (!dir) return;
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch {
        /* temp folder; best effort */
    }
}

/** Run a railed child to completion. Throws (before spawning) when any limit is violated. */
export function spawnRailedChild(cmd: string, args: string[], opts: SpawnRailedOptions = {}): CliResult {
    const p = buildPlan(cmd, args, opts);
    try {
        const r = p.shell
            ? spawnSync([p.file, ...p.args].map(quoteForCmd).join(' '), { cwd: p.cwd, env: p.env, shell: true, encoding: 'utf8', timeout: p.timeoutMs, input: opts.input, windowsHide: true })
            : spawnSync(p.file, p.args, { cwd: p.cwd, env: p.env, encoding: 'utf8', timeout: p.timeoutMs, input: opts.input, windowsHide: true });
        const err = r.error ? `\n[spawnRailedChild] spawn error: ${r.error.message}` : '';
        return { status: r.status, stdout: r.stdout ?? '', stderr: (r.stderr ?? '') + err };
    } finally {
        cleanup(p.overridesDir);
    }
}

/** Start a railed child and return it (same limits). The caller owns its lifetime. */
export function spawnRailedChildAsync(cmd: string, args: string[], opts: SpawnRailedOptions = {}): ChildProcess {
    const p = buildPlan(cmd, args, opts);
    let child: ChildProcess;
    try {
        child = p.shell
            ? spawn([p.file, ...p.args].map(quoteForCmd).join(' '), { cwd: p.cwd, env: p.env, shell: true, stdio: 'pipe', windowsHide: true, timeout: p.timeoutMs })
            : spawn(p.file, p.args, { cwd: p.cwd, env: p.env, stdio: 'pipe', windowsHide: true, timeout: p.timeoutMs });
    } catch (e) {
        cleanup(p.overridesDir);
        throw e;
    }
    child.once('close', () => cleanup(p.overridesDir));
    child.once('error', () => cleanup(p.overridesDir));
    if (opts.input !== undefined && child.stdin) child.stdin.end(opts.input);
    return child;
}

/** The only sanctioned force-kill of a child (whole tree on win32). */
export function killProcessTree(pid: number): void {
    if (!Number.isInteger(pid) || pid <= 0) throw new Error(`killProcessTree: invalid pid ${pid}`);
    if (IS_WIN) {
        spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
        return;
    }
    try {
        process.kill(pid, 'SIGKILL');
    } catch {
        /* already gone */
    }
}

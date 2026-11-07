// test/rails/ledgerRun.ts
// Phase 22 plan 22-05 Task 2 — SAFE-02 rail ledger, per-invocation run record (Vitest
// globalSetup for the unit and integration projects; addresses review concern L129@e2e59f6).
//
// Runs in the Vitest MAIN process and touches only the temp ledger folder
//   <os.tmpdir()>/crypto-snipe-bot-rail-ledger/<runId>/
// It never reads .env, data/ or the network, and decides no enforcement: the rails in each
// worker (test/rails/core.cjs) enforce on their own. CSB_RAIL_RUN_ID only chooses the ledger
// location (NAC-05).
//
// setup(project):
//   - adopts process.env.CSB_RAIL_RUN_ID when set (the 22-08 wrapper sets it), otherwise
//     generates run-<YYYYMMDDTHHMMSS>-<pid>-<6 hex> and sets it in process.env BEFORE any
//     worker starts, so both projects of one invocation and every worker share it (Vitest
//     builds each worker env from the main process env: cli-api.BUXBO6jS.js ~3635);
//   - writes <runId>/projects/<project>.json {project, startedAt, mainPid};
//   - returns a teardown closure (Vitest calls teardown without arguments, cli-api ~10733)
//     that adds finishedAt and rewrites <runId>/summary.json from every <pid>.jsonl.
//
// summary.json: runId, projects, workersByProject (pids of worker-start entries grouped by
// project label), countsByKind, nonLoopbackAllowed (net-allow entries whose host is not
// loopback; 0 by construction in full mode, checked here independently of core.cjs),
// telegramAllowed, triggeringTestFiles (test/ paths in stack frames of non-worker-start
// entries), entries, unparseableLines, startedAt (earliest project start), finishedAt
// (latest project finish).

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';

// Must match test/rails/core.cjs (RUN_ID_RE and the ledger root).
const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PROJECT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const LEDGER_ROOT = path.join(os.tmpdir(), 'crypto-snipe-bot-rail-ledger');

// Kinds that are bookkeeping, not a block or an allowance a test triggered.
const NON_TRIGGER_KINDS = new Set(['worker-start', 'fork-shell-key']);

interface ProjectLike {
    name?: string;
    config?: { name?: string };
}

interface ProjectRecord {
    project: string;
    startedAt: string;
    mainPid: number;
    finishedAt?: string;
}

interface LedgerEntry {
    ts?: string;
    runId?: string;
    pid?: number;
    ppid?: number;
    project?: string;
    kind?: string;
    target?: unknown;
    stack?: unknown;
}

function utcStamp(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return (
        `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
        `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
    );
}

function resolveRunId(): string {
    const existing = process.env.CSB_RAIL_RUN_ID;
    if (typeof existing === 'string' && existing !== '') {
        if (!RUN_ID_RE.test(existing) || existing === '.' || existing === '..') {
            // Same rule the worker rails apply: an invalid run id fails the run closed.
            throw new Error('SAFE-02 ledgerRun: CSB_RAIL_RUN_ID is not a valid run id ([A-Za-z0-9._-], max 128)');
        }
        return existing;
    }
    const runId = `run-${utcStamp(new Date())}-${process.pid}-${randomBytes(3).toString('hex')}`;
    process.env.CSB_RAIL_RUN_ID = runId;
    return runId;
}

function projectName(project: ProjectLike | undefined): string {
    const name = (project && (project.name || (project.config && project.config.name))) || '';
    if (!PROJECT_NAME_RE.test(name)) {
        throw new Error(`SAFE-02 ledgerRun: unusable project name ${JSON.stringify(name)}`);
    }
    return name;
}

function writeJsonAtomic(file: string, value: unknown): void {
    const tmp = `${file}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, file);
}

function readJson<T>(file: string): T | null {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    } catch {
        return null;
    }
}

// Independent of core.cjs classifyHost on purpose: a second opinion on the ledger's own
// `class` field, so a mis-classification in core.cjs cannot hide a non-loopback allowance.
function isLoopbackHost(host: unknown): boolean {
    let s = String(host === undefined || host === null ? '' : host).trim().toLowerCase();
    if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
    s = s.replace(/%.*$/, '').replace(/\.+$/, '');
    if (s === 'localhost' || s === '::1' || s === '0:0:0:0:0:0:0:1') return true;
    const v4 = s.startsWith('::ffff:') ? s.slice(7) : s;
    return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

function isTelegramHost(host: unknown): boolean {
    const s = String(host === undefined || host === null ? '' : host).trim().toLowerCase().replace(/\.+$/, '');
    return ['telegram.org', 't.me', 'telegram.me', 'telegram.dog'].some((d) => s === d || s.endsWith('.' + d));
}

// The Vitest main process runs at the repo root; frames are made repo-relative against it so
// a checkout that itself sits under a folder named `test` cannot mislabel the file.
const REPO_ROOT = process.cwd();

function frameFile(frame: string): string | null {
    // "at fn (<file>:L:C)" or "at <file>:L:C"; <file> may be a file:// URL.
    const m = frame.match(/\(([^()]+?)(?::\d+){1,2}\)\s*$/) || frame.match(/^\s*(?:at\s+)?([^()\s][^()]*?)(?::\d+){1,2}\s*$/);
    if (!m) return null;
    let f = m[1].trim();
    if (/^file:\/\//i.test(f)) {
        try {
            f = decodeURIComponent(new URL(f).pathname);
            if (/^\/[A-Za-z]:/.test(f)) f = f.slice(1);
        } catch {
            return null;
        }
    }
    return path.isAbsolute(f) ? f : null;
}

function testFilesFromStack(stack: unknown): string[] {
    if (!Array.isArray(stack)) return [];
    const out: string[] = [];
    for (const frame of stack) {
        if (typeof frame !== 'string') continue;
        const file = frameFile(frame);
        if (!file) continue;
        const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
        if (!rel.startsWith('test/') || rel.startsWith('test/rails/')) continue;
        out.push(rel);
    }
    return out;
}

function readEntries(runDir: string): { entries: LedgerEntry[]; unparseable: number } {
    const entries: LedgerEntry[] = [];
    let unparseable = 0;
    let names: string[] = [];
    try {
        names = fs.readdirSync(runDir);
    } catch {
        names = [];
    }
    for (const name of names.filter((n) => n.endsWith('.jsonl')).sort()) {
        let text = '';
        try {
            text = fs.readFileSync(path.join(runDir, name), 'utf8');
        } catch {
            unparseable += 1;
            continue;
        }
        for (const line of text.split('\n')) {
            if (line.trim() === '') continue;
            try {
                entries.push(JSON.parse(line) as LedgerEntry);
            } catch {
                unparseable += 1;
            }
        }
    }
    return { entries, unparseable };
}

function readProjects(projectsDir: string): ProjectRecord[] {
    let names: string[] = [];
    try {
        names = fs.readdirSync(projectsDir);
    } catch {
        names = [];
    }
    const out: ProjectRecord[] = [];
    for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
        const rec = readJson<ProjectRecord>(path.join(projectsDir, name));
        if (rec) out.push(rec);
    }
    return out;
}

function targetHost(target: unknown): unknown {
    return target && typeof target === 'object' ? (target as { host?: unknown }).host : undefined;
}

function targetClass(target: unknown): unknown {
    return target && typeof target === 'object' ? (target as { class?: unknown }).class : undefined;
}

function writeSummary(runId: string, runDir: string, projectsDir: string): { file: string; counts: Record<string, number> } {
    const { entries, unparseable } = readEntries(runDir);
    const projects = readProjects(projectsDir);

    const countsByKind: Record<string, number> = {};
    const workers: Record<string, Set<number>> = {};
    const triggering = new Set<string>();
    let nonLoopbackAllowed = 0;
    let telegramAllowed = 0;
    for (const e of entries) {
        const kind = typeof e.kind === 'string' ? e.kind : 'unknown';
        countsByKind[kind] = (countsByKind[kind] || 0) + 1;
        if (kind === 'worker-start' && typeof e.pid === 'number') {
            const label = typeof e.project === 'string' ? e.project : 'none';
            (workers[label] ||= new Set<number>()).add(e.pid);
        }
        if (kind === 'net-allow') {
            const host = targetHost(e.target);
            if (targetClass(e.target) !== 'loopback' || !isLoopbackHost(host)) nonLoopbackAllowed += 1;
            if (targetClass(e.target) === 'telegram' || isTelegramHost(host)) telegramAllowed += 1;
        }
        if (!NON_TRIGGER_KINDS.has(kind)) {
            for (const f of testFilesFromStack(e.stack)) triggering.add(f);
        }
    }
    const workersByProject: Record<string, number[]> = {};
    for (const [label, pids] of Object.entries(workers).sort(([a], [b]) => a.localeCompare(b))) {
        workersByProject[label] = [...pids].sort((a, b) => a - b);
    }
    const starts = projects.map((p) => p.startedAt).filter((s): s is string => typeof s === 'string').sort();
    const finishes = projects.map((p) => p.finishedAt).filter((s): s is string => typeof s === 'string').sort();

    const summary = {
        runId,
        projects,
        workersByProject,
        countsByKind,
        nonLoopbackAllowed,
        telegramAllowed,
        triggeringTestFiles: [...triggering].sort(),
        entries: entries.length,
        unparseableLines: unparseable,
        startedAt: starts.length ? starts[0] : null,
        finishedAt: finishes.length ? finishes[finishes.length - 1] : null,
    };
    const file = path.join(runDir, 'summary.json');
    writeJsonAtomic(file, summary);
    return { file, counts: countsByKind };
}

function printCounts(counts: Record<string, number>): void {
    const kinds = Object.keys(counts).sort();
    if (kinds.length === 0) {
        console.log('[SAFE-02 rails]   (no ledger entries)');
        return;
    }
    const w = Math.max(...kinds.map((k) => k.length), 4);
    console.log(`[SAFE-02 rails]   ${'kind'.padEnd(w)}  count`);
    for (const k of kinds) console.log(`[SAFE-02 rails]   ${k.padEnd(w)}  ${counts[k]}`);
}

export function setup(project?: ProjectLike): () => void {
    const runId = resolveRunId();
    const name = projectName(project);
    const runDir = path.join(LEDGER_ROOT, runId);
    const projectsDir = path.join(runDir, 'projects');
    fs.mkdirSync(projectsDir, { recursive: true });
    const projectFile = path.join(projectsDir, `${name}.json`);
    const rec: ProjectRecord = { project: name, startedAt: new Date().toISOString(), mainPid: process.pid };
    writeJsonAtomic(projectFile, rec);
    console.log(`[SAFE-02 rails] run ${runId} — project ${name} — ledger ${runDir}`);

    return function teardown(): void {
        const current = readJson<ProjectRecord>(projectFile) || rec;
        writeJsonAtomic(projectFile, { ...current, finishedAt: new Date().toISOString() });
        const { file, counts } = writeSummary(runId, runDir, projectsDir);
        console.log(`[SAFE-02 rails] run ${runId} — project ${name} finished — summary ${file}`);
        printCounts(counts);
    };
}

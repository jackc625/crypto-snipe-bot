// scripts/check-commit-taxonomy.ts
//
// Phase 23 / Plan 23-25 (AUDIT-06; AC-39 to AC-44, CONTEXT D-17 and D-18, SPEC Amendment A-2) -
// the commit check that protects the golden-master recording. Without it, a re-record could
// launder a behavior change: the recording would simply move to whatever the bot does now.
//
// The protected folder is test/realpath/recordings/: the scenario recordings (*.jsonl), the
// env snapshot (env/<VAR>.json and env/_baseline.json, A-2) and the folder's .gitattributes.
// The rule, for every non-merge commit after the first recording commit:
//   - a commit that only ADDS brand-new paths under the folder passes (AC-40, A-2);
//   - a commit that changes, removes or re-adds an existing path fails unless its subject
//     begins `behavior:` or `behavior(<scope>):` (AC-39). There is no exempt commit type: a
//     recording change that is not a behavior change (a harness fix, a library upgrade that
//     prints a value differently) needs its own register entry, cited by a behavior: commit
//     (D-18);
//   - every behavior: commit must cite at least one ID, and every ID it cites must exist in
//     that commit's own tree as .planning/audit/findings/AUD-<AREA>-<NNN>.json or
//     .planning/audit/decisions/OD-<n>.json (AC-41). The tree of the judged commit is used,
//     never HEAD's, so a register entry added later cannot legitimize an older commit.
//
// How git is read (RESEARCH Pattern 8, measured on a throwaway repo with core.autocrlf=true):
//   - commits to judge: git rev-list --no-merges --reverse --topo-order <first>..HEAD. Merge
//     commits are not judged and the commits inside them are (AC-42, a locked decision);
//   - the first recording commit is found from history, never hard-coded: the topologically
//     earliest non-merge commit whose diff adds a path under the folder (AC-44). The check
//     prints which commit it found;
//   - each commit's changes: git diff-tree -r --no-renames --name-status -z, for all commits in
//     one --stdin call (--root so a parentless commit shows its adds). Rename and copy detection
//     are off, so a rename is a D (which needs behavior:) plus an A, and a new file that
//     resembles an existing one is an A, never a C;
//   - a path keeps its identity across history: an A on a path that any earlier commit (an
//     ancestor) already touched is a re-add, which counts as a change (T-23-41, a delete and a
//     later re-add cannot launder a scenario). An A on a path that another commit adds with
//     different content on a parallel line of history (neither an ancestor nor a descendant, for
//     example a side branch forked before the first recording or an unrelated root merged in)
//     also counts as a change, because the merge that joins the two lines keeps one version.
//     The same content added on two lines (a cherry-picked new scenario) stays a new path;
//   - path identity is case-insensitive and the folder pathspec is :(icase): on the operator's
//     Windows checkout test/realpath/RECORDINGS/x.jsonl is the same file as
//     test/realpath/recordings/x.jsonl;
//   - a merge commit whose result differs from every parent inside the folder
//     (git diff-tree --cc) is reported on a WARN line. It is still not judged and the exit code
//     does not change (AC-42 stands); the line makes the exemption's limit visible;
//   - a shallow clone exits 2: its "first recording commit" would be the fetched commit and the
//     check would judge nothing (T-23-31). CI checks out with fetch-depth: 0.
// Commit messages and paths are untrusted input (T-23-32): git always runs with an argument
// array, messages are read size-delimited through git cat-file --batch, IDs are matched by a
// strict regular expression bounded on both sides and then looked up in the commit's tree, and
// every message or path printed is JSON-quoted. GIT_* variables from the caller are dropped,
// replace objects and lazy fetches are disabled, and only plumbing commands are used, so user
// configuration such as log.follow cannot change what is read.
//
// Usage (Node 22.16.0, D-21):
//   npm run check:commits                                       judge the real history at HEAD
//   node node_modules/ts-node/dist/bin.js scripts/check-commit-taxonomy.ts [--self-test]
//   --self-test   every rule on throwaway repos under the OS temp folder (AC-43); the real
//                 repository is never touched
// Exit codes: 0 pass, 1 a violating commit, 2 usage error, wrong Node, shallow clone, no first
// recording commit, nothing to judge, or a git failure (a broken scan is never a pass).

if (process.versions.modules !== '127') {
    console.error(`check-commit-taxonomy requires Node 22.16.0 (ABI 127); this is ${process.version} (ABI ${process.versions.modules}).`);
    process.exit(2);
}

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';

/** A bad argument, or a history the check cannot judge. Exit 2. */
class UsageError extends Error {}

const REPO_ROOT = path.resolve(__dirname, '..');
/** The protected folder, repo-relative with a trailing slash (lower case is the identity key). */
export const PROTECTED_DIR = 'test/realpath/recordings/';
const PROTECTED_SPEC = `:(icase)${PROTECTED_DIR}`;
const FINDINGS_DIR = '.planning/audit/findings/';
const DECISIONS_DIR = '.planning/audit/decisions/';
const SHA_RE = /^[0-9a-f]{40}$/;
/** `behavior:` or `behavior(<scope>):`, then a space or the end of the subject. */
const BEHAVIOR_SUBJECT_RE = /^behavior(?:\([^()\r\n]+\))?:(?:\s|$)/;
/**
 * A cited ID: AUD-<AREA>-<NNN> (the register's ID_RE.finding) or OD-<n> (ID_RE.card), bounded
 * on both sides so an ID inside a longer token (XAUD-BUY-016, AUD-BUY-0160, AUD-BUY-016-x)
 * is not an ID.
 */
const CITED_ID_RE = /(?<![A-Za-z0-9_-])(AUD-[A-Z][A-Z0-9]*-\d{3}|OD-[1-9]\d*)(?![A-Za-z0-9_-])/g;

// ---------------------------------------------------------------------------
// git access: argument arrays only, plumbing commands only
// ---------------------------------------------------------------------------

/** The caller's environment without any GIT_* variable, plus the settings this check relies on. */
function readGitEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/i.test(k)) env[k] = v;
    env.GIT_TERMINAL_PROMPT = '0';
    env.GIT_OPTIONAL_LOCKS = '0';
    env.GIT_NO_REPLACE_OBJECTS = '1';
    env.GIT_NO_LAZY_FETCH = '1';
    return env;
}

interface GitResult {
    status: number;
    stdout: Buffer;
    stderr: string;
}

function gitRun(root: string, args: string[], env: NodeJS.ProcessEnv, input?: string): GitResult {
    const r = cp.spawnSync('git', ['-C', root, ...args], { env, input, windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
    if (r.error) throw new UsageError(`git ${args[0]} could not run: ${r.error.message}`);
    return { status: r.status ?? -1, stdout: r.stdout ?? Buffer.alloc(0), stderr: (r.stderr ?? Buffer.alloc(0)).toString('utf8') };
}

/** Run git and return stdout; any non-zero exit is a broken scan (exit 2), never a pass. */
function gitText(root: string, args: string[], env: NodeJS.ProcessEnv): string {
    const r = gitRun(root, args, env);
    if (r.status !== 0) throw new UsageError(`git ${args.slice(0, 2).join(' ')} failed (exit ${r.status}): ${r.stderr.trim()}`);
    return r.stdout.toString('utf8');
}

function shaList(text: string, what: string): string[] {
    const out = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    for (const s of out) if (!SHA_RE.test(s)) throw new UsageError(`${what} returned ${JSON.stringify(s.slice(0, 80))}, not a commit SHA`);
    return out;
}

/** Fields split on NUL (the -z output of diff-tree). */
function nulFields(text: string): string[] {
    const f = text.split('\0');
    if (f.length && f[f.length - 1] === '') f.pop();
    return f;
}

interface Entry {
    status: string;
    path: string;
}

/**
 * Each commit's own changes under the folder, from one git diff-tree --stdin call (no rename or
 * copy detection; --root, so a parentless commit shows its adds; --always, so every commit asked
 * for prints its id even with no change, and the output can be checked against the request).
 * Output fields: <sha> NUL, then <status> NUL <path> NUL pairs. A path always starts with the
 * protected folder, so it can never be read as a commit id.
 */
function diffEntries(root: string, shas: string[], env: NodeJS.ProcessEnv): Map<string, Entry[]> {
    const out = new Map<string, Entry[]>();
    if (!shas.length) return out;
    const r = gitRun(root, ['diff-tree', '--stdin', '--always', '--root', '-r', '--no-renames', '--name-status', '-z', '--', PROTECTED_SPEC], env, shas.join('\n') + '\n');
    if (r.status !== 0) throw new UsageError(`git diff-tree --stdin failed (exit ${r.status}): ${r.stderr.trim()}`);
    const f = nulFields(r.stdout.toString('utf8'));
    const order: string[] = [];
    let cur: Entry[] | null = null;
    for (let i = 0; i < f.length; ) {
        const x = f[i].replace(/^\n+/, '');
        if (SHA_RE.test(x)) {
            if (out.has(x)) throw new UsageError(`git diff-tree --stdin printed ${short(x)} twice`);
            cur = [];
            out.set(x, cur);
            order.push(x);
            i += 1;
            continue;
        }
        const p = f[i + 1];
        if (!cur || p === undefined || !/^[A-Z]$/.test(x)) throw new UsageError(`git diff-tree --stdin printed ${quote(x)} where a commit id or a status was expected`);
        if (!p.toLowerCase().startsWith(PROTECTED_DIR)) throw new UsageError(`git diff-tree --stdin printed ${quote(p)}, outside ${PROTECTED_DIR}`);
        cur.push({ status: x, path: p });
        i += 2;
    }
    if (JSON.stringify(order) !== JSON.stringify(shas)) throw new UsageError(`git diff-tree --stdin answered for ${order.length} commit(s), asked for ${shas.length}`);
    return out;
}

/** Every commit's raw message, read size-delimited (git cat-file --batch), so no message can forge a record boundary. */
function readMessages(root: string, shas: string[], env: NodeJS.ProcessEnv): Map<string, string> {
    const out = new Map<string, string>();
    if (!shas.length) return out;
    const r = gitRun(root, ['cat-file', '--batch'], env, shas.join('\n') + '\n');
    if (r.status !== 0) throw new UsageError(`git cat-file --batch failed (exit ${r.status}): ${r.stderr.trim()}`);
    const buf = r.stdout;
    let at = 0;
    for (const sha of shas) {
        const nl = buf.indexOf(0x0a, at);
        if (nl < 0) throw new UsageError('git cat-file --batch output ended early');
        const header = buf.subarray(at, nl).toString('utf8');
        const m = /^([0-9a-f]{40}) commit (\d+)$/.exec(header);
        if (!m || m[1] !== sha) throw new UsageError(`git cat-file --batch printed ${JSON.stringify(header.slice(0, 80))} for ${sha.slice(0, 12)}`);
        const size = Number(m[2]);
        const body = buf.subarray(nl + 1, nl + 1 + size).toString('utf8');
        at = nl + 1 + size + 1;
        const split = body.indexOf('\n\n');
        out.set(sha, split < 0 ? '' : body.slice(split + 2));
    }
    return out;
}

// ---------------------------------------------------------------------------
// The judgement
// ---------------------------------------------------------------------------

export type ViolationCode = 'protected-change-not-behavior' | 'behavior-without-id' | 'behavior-unknown-id';

export interface Violation {
    sha: string;
    subject: string;
    code: ViolationCode;
    message: string;
}

export interface Judgement {
    first: string;
    firstSubject: string;
    judged: string[];
    merges: number;
    touching: number;
    added: number;
    changed: number;
    warnings: string[];
    violations: Violation[];
}

const short = (sha: string) => sha.slice(0, 12);
/** Untrusted text for one output line: JSON-quoted (control characters escaped), capped. */
const quote = (s: string, max = 100) => JSON.stringify(s.length > max ? `${s.slice(0, max)}...` : s);
const subjectOf = (message: string) => message.split('\n')[0].replace(/\r$/, '');
/** Where a cited ID's register record lives (the ID has already matched CITED_ID_RE). */
const idPath = (id: string) => (id.startsWith('OD-') ? `${DECISIONS_DIR}${id}.json` : `${FINDINGS_DIR}${id}.json`);

/** How one protected entry of a judged commit reads. */
type EntryKind = 'new' | 'changed' | 'removed' | 're-added' | 'added-on-two-lines';

function describeEntry(kind: EntryKind, p: string): string {
    switch (kind) {
        case 'changed':
            return `changes ${quote(p)}`;
        case 'removed':
            return `removes ${quote(p)}`;
        case 're-added':
            return `re-adds ${quote(p)}, a path an earlier commit already had (path identity ignores letter case; a delete and re-add is a change)`;
        case 'added-on-two-lines':
            return `adds ${quote(p)}, which another line of history also adds (the merge keeps one version, so this is a change)`;
        default:
            return `adds ${quote(p)}`;
    }
}

/**
 * Judge every non-merge commit after the first recording commit. Throws UsageError (exit 2) on
 * a shallow clone, a history with no recording commit, nothing to judge, or any git failure.
 */
export function judgeHistory(root: string, env: NodeJS.ProcessEnv = readGitEnv()): Judgement {
    const shallow = gitText(root, ['rev-parse', '--is-shallow-repository'], env).trim();
    if (shallow === 'true')
        throw new UsageError(`${root} is a shallow clone: the first recording commit would be the fetched commit and the check would judge nothing (T-23-31). Use the full history (actions/checkout fetch-depth: 0). Refusing to pass.`);
    if (shallow !== 'false') throw new UsageError(`git rev-parse --is-shallow-repository printed ${quote(shallow)}`);

    // The whole commit graph reachable from HEAD.
    const graph = new Map<string, string[]>();
    for (const line of gitText(root, ['rev-list', '--parents', 'HEAD'], env).split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        const parts = t.split(' ');
        for (const s of parts) if (!SHA_RE.test(s)) throw new UsageError(`git rev-list --parents printed ${quote(t)}`);
        graph.set(parts[0], parts.slice(1));
    }
    for (const [c, ps] of graph) for (const p of ps) if (!graph.has(p)) throw new UsageError(`history incomplete: parent ${short(p)} of ${short(c)} is missing`);
    const ancestorsCache = new Map<string, Set<string>>();
    /** Every commit reachable from c's parents (c itself excluded). */
    const ancestors = (c: string): Set<string> => {
        const hit = ancestorsCache.get(c);
        if (hit) return hit;
        const seen = new Set<string>();
        const stack = [...(graph.get(c) ?? [])];
        while (stack.length) {
            const x = stack.pop() as string;
            if (seen.has(x)) continue;
            seen.add(x);
            for (const p of graph.get(x) ?? []) if (!seen.has(p)) stack.push(p);
        }
        ancestorsCache.set(c, seen);
        return seen;
    };

    // Every non-merge commit that touches the folder, anywhere in HEAD's history, oldest first.
    const touching = shaList(gitText(root, ['rev-list', '--full-history', '--no-merges', '--topo-order', '--reverse', 'HEAD', '--', PROTECTED_SPEC], env), 'git rev-list (folder history)');
    const diffs = diffEntries(root, touching, env);

    // The first recording commit: the topologically earliest non-merge commit that adds a path (AC-44).
    const first = touching.find((c) => (diffs.get(c) ?? []).some((e) => e.status === 'A'));
    if (!first) throw new UsageError(`no commit in HEAD's history adds a file under ${PROTECTED_DIR}; there is no recording to protect, so the check judged nothing. Refusing to pass.`);

    const judged = shaList(gitText(root, ['rev-list', '--no-merges', '--reverse', '--topo-order', `${first}..HEAD`], env), 'git rev-list (judged commits)');
    if (!judged.length)
        throw new UsageError(`no non-merge commit follows the first recording commit ${short(first)}; the check judged nothing. Refusing to pass.`);
    // The same range from the graph in memory: HEAD's history minus the first recording commit
    // and its ancestors. Its non-merges must be exactly git's judged list; its merges (two or
    // more parents) are the merge commits that are not judged.
    const before = ancestors(first);
    const inRange = [...graph.keys()].filter((c) => c !== first && !before.has(c));
    const judgedSet = new Set(judged);
    const nonMerges = inRange.filter((c) => (graph.get(c) as string[]).length < 2);
    if (nonMerges.length !== judged.length || nonMerges.some((c) => !judgedSet.has(c)))
        throw new UsageError(`git disagrees with itself: rev-list --no-merges ${short(first)}..HEAD lists ${judged.length} commit(s), the commit graph ${nonMerges.length}`);
    const mergeShas = inRange.filter((c) => (graph.get(c) as string[]).length >= 2).sort();

    // Every judged commit gets its own diff-tree; the folder history listing must agree with it.
    const touchingSet = new Set(touching);
    const others = diffEntries(root, judged.filter((c) => !touchingSet.has(c)), env);
    for (const [c, own] of others) {
        if (own.length) throw new UsageError(`git disagrees with itself: ${short(c)} changes ${PROTECTED_DIR} but the folder history does not list it`);
        diffs.set(c, own);
    }

    // Path identity (lower case) -> every commit that touches it, and every commit that adds it
    // (with the exact path it added, for the blob lookup below).
    const touchedBy = new Map<string, Set<string>>();
    const addedBy = new Map<string, Map<string, string>>();
    for (const c of touching)
        for (const e of diffs.get(c) ?? []) {
            const key = e.path.toLowerCase();
            if (!touchedBy.has(key)) touchedBy.set(key, new Set());
            (touchedBy.get(key) as Set<string>).add(c);
            if (e.status === 'A') {
                if (!addedBy.has(key)) addedBy.set(key, new Map());
                (addedBy.get(key) as Map<string, string>).set(c, e.path);
            }
        }
    const blobAt = (c: string, p: string): string => {
        const oid = gitText(root, ['rev-parse', '--verify', '-q', `${c}:${p}`], env).trim();
        if (!/^[0-9a-f]{40}$/.test(oid)) throw new UsageError(`git rev-parse ${short(c)}:${quote(p)} printed ${quote(oid)}`);
        return oid;
    };

    const messages = readMessages(root, [first, ...judged, ...mergeShas], env);
    // Every ID a behavior: commit cites, looked up in that commit's own tree in one call.
    const lookups = new Map<string, boolean>();
    const want: string[] = [];
    for (const c of judged) {
        const msg = messages.get(c) ?? '';
        if (!BEHAVIOR_SUBJECT_RE.test(subjectOf(msg))) continue;
        for (const m of msg.matchAll(CITED_ID_RE)) want.push(`${c}:${idPath(m[1])}`);
    }
    const uniqueWant = [...new Set(want)];
    if (uniqueWant.length) {
        const r = gitRun(root, ['cat-file', '--batch-check'], env, uniqueWant.join('\n') + '\n');
        if (r.status !== 0) throw new UsageError(`git cat-file --batch-check failed (exit ${r.status}): ${r.stderr.trim()}`);
        const lines = r.stdout.toString('utf8').split('\n').filter((l, i, a) => l !== '' || i < a.length - 1);
        if (lines.length !== uniqueWant.length) throw new UsageError(`git cat-file --batch-check answered ${lines.length} line(s) for ${uniqueWant.length} lookup(s)`);
        uniqueWant.forEach((q, i) => {
            const l = lines[i].replace(/\r$/, '');
            if (l === `${q} missing`) lookups.set(q, false);
            else if (/^[0-9a-f]{40} blob \d+$/.test(l)) lookups.set(q, true);
            else throw new UsageError(`git cat-file --batch-check printed ${quote(l)} for ${quote(q)}`);
        });
    }
    const violations: Violation[] = [];
    let touchingJudged = 0;
    let added = 0;
    let changed = 0;
    for (const c of judged) {
        const msg = messages.get(c) ?? '';
        const subject = subjectOf(msg);
        const entries = diffs.get(c) ?? [];
        const kinds: { kind: EntryKind; path: string }[] = [];
        for (const e of entries) {
            if (e.status === 'D') kinds.push({ kind: 'removed', path: e.path });
            else if (e.status !== 'A') kinds.push({ kind: 'changed', path: e.path });
            else {
                const key = e.path.toLowerCase();
                const anc = ancestors(c);
                const earlier = [...(touchedBy.get(key) ?? [])].some((t) => t !== c && anc.has(t));
                // Another line of history adds the same path with different content: the merge
                // that joins the lines keeps one version. The same content on both lines (a
                // cherry-picked new scenario) replaces nothing, so it stays a new path.
                const parallel =
                    !earlier &&
                    [...(addedBy.get(key) ?? new Map<string, string>())].some(([d, dp]) => d !== c && !anc.has(d) && !ancestors(d).has(c) && blobAt(d, dp) !== blobAt(c, e.path));
                kinds.push({ kind: earlier ? 're-added' : parallel ? 'added-on-two-lines' : 'new', path: e.path });
            }
        }
        if (entries.length) touchingJudged++;
        const changes = kinds.filter((k) => k.kind !== 'new');
        added += kinds.length - changes.length;
        changed += changes.length;
        const isBehavior = BEHAVIOR_SUBJECT_RE.test(subject);
        if (changes.length && !isBehavior)
            violations.push({
                sha: c,
                subject,
                code: 'protected-change-not-behavior',
                message: `${changes.map((k) => describeEntry(k.kind, k.path)).join('; ')}; only a behavior: commit citing a real ID may change the recording (AC-39, D-18)`,
            });
        if (isBehavior) {
            const ids = [...new Set([...msg.matchAll(CITED_ID_RE)].map((m) => m[1]))];
            if (!ids.length)
                violations.push({ sha: c, subject, code: 'behavior-without-id', message: 'a behavior: commit must cite an OD-<n> or AUD-<AREA>-<NNN> ID; its message cites none (AC-41)' });
            for (const id of ids) {
                const rel = idPath(id);
                const found = lookups.get(`${c}:${rel}`);
                if (found === undefined) throw new UsageError(`internal: no tree lookup for ${id} in ${short(c)}`);
                if (!found)
                    violations.push({ sha: c, subject, code: 'behavior-unknown-id', message: `cites ${id}, but ${rel} is not in this commit's own tree (AC-41; an ID registered later does not count)` });
            }
        }
    }

    // AC-42: merges are not judged. A merge whose result differs from every parent inside the
    // folder is named, so the limit of the exemption is visible; the exit code does not change.
    const warnings: string[] = [];
    for (const m of mergeShas) {
        const paths = nulFields(gitText(root, ['diff-tree', '--cc', '--no-commit-id', '-r', '--name-only', '-z', m, '--', PROTECTED_SPEC], env)).filter(Boolean);
        if (paths.length)
            warnings.push(
                `WARN merge ${short(m)} ${quote(subjectOf(messages.get(m) ?? ''))}: its result differs from every parent in ${paths.map((p) => quote(p)).join(', ')}; merge commits are not judged (AC-42), so review this resolution by hand`,
            );
    }

    return {
        first,
        firstSubject: subjectOf(messages.get(first) ?? ''),
        judged,
        merges: mergeShas.length,
        touching: touchingJudged,
        added,
        changed,
        warnings,
        violations,
    };
}

interface Say {
    log: (s: string) => void;
    error: (s: string) => void;
}

/** The gate: exit 0 pass, 1 a violating commit, 2 a history it cannot judge. */
export function gateMain(root: string, env: NodeJS.ProcessEnv = readGitEnv(), say: Say = console): number {
    return gate(root, env, say).code;
}

function gate(root: string, env: NodeJS.ProcessEnv, say: Say): { code: number; judgement: Judgement | null } {
    let j: Judgement;
    try {
        j = judgeHistory(root, env);
    } catch (e) {
        if (!(e instanceof UsageError)) throw e;
        say.error(`check-commit-taxonomy: ${e.message}`);
        return { code: 2, judgement: null };
    }
    for (const v of j.violations) say.error(`VIOLATION ${short(v.sha)} ${quote(v.subject)} [${v.code}] ${v.message}`);
    for (const w of j.warnings) say.error(w);
    say.log(
        `check-commit-taxonomy: first recording commit ${short(j.first)} ${quote(j.firstSubject)}; judged ${j.judged.length} commit(s) after it ` +
            `(${j.merges} merge commit(s) not judged, ${j.warnings.length} merge warning(s)); ${j.touching} of them touch ${PROTECTED_DIR}: ` +
            `${j.added} new path(s) added, ${j.changed} existing path(s) changed, removed or re-added; ${j.violations.length} violation(s)`,
    );
    say.log(j.violations.length ? `RESULT FAIL (${j.violations.length} violation(s))` : 'RESULT PASS');
    return { code: j.violations.length ? 1 : 0, judgement: j };
}

// ---------------------------------------------------------------------------
// Self-test (AC-43): every rule on throwaway repos under the OS temp folder. Each repo has its
// own local user.name / user.email, reads no system or global git config and runs no hooks; the
// real repository is never an input and is never written.
// ---------------------------------------------------------------------------

interface CaseOutcome {
    name: string;
    ok: boolean;
    detail: string;
}

const posix = (p: string) => p.split(path.sep).join('/');

class Fixture {
    readonly dir: string;
    readonly env: NodeJS.ProcessEnv;
    private readonly cfgDir: string;

    constructor(prefix: string, autocrlf: boolean) {
        this.dir = fs.mkdtempSync(path.join(os.tmpdir(), `csb-commit-taxonomy-${prefix}-`));
        this.cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-commit-taxonomy-gitcfg-'));
        const emptyGlobal = path.join(this.cfgDir, 'empty.gitconfig');
        const hooks = path.join(this.cfgDir, 'hooks');
        fs.writeFileSync(emptyGlobal, '');
        fs.mkdirSync(hooks);
        this.env = { ...readGitEnv(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyGlobal };
        this.git('-c', 'init.defaultBranch=main', 'init', '-q');
        this.git('config', '--local', 'user.name', 'commit-taxonomy-selftest');
        this.git('config', '--local', 'user.email', 'commit-taxonomy-selftest@example.invalid');
        this.git('config', '--local', 'commit.gpgsign', 'false');
        this.git('config', '--local', 'core.autocrlf', autocrlf ? 'true' : 'false');
        this.git('config', '--local', 'core.hooksPath', posix(hooks));
    }

    may(args: string[], input?: string): GitResult {
        return gitRun(this.dir, args, this.env, input);
    }

    git(...args: string[]): string {
        const r = this.may(args);
        if (r.status !== 0) throw new Error(`self-test git ${args.join(' ')} failed (exit ${r.status}): ${r.stderr.trim()}`);
        return r.stdout.toString('utf8').trim();
    }

    put(rel: string, text: string): void {
        const p = path.join(this.dir, rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, text);
    }

    read(rel: string): Buffer {
        return fs.readFileSync(path.join(this.dir, rel));
    }

    /** Stage everything and commit; returns the new commit SHA. Extra -m arguments become body paragraphs. */
    commit(subject: string, ...body: string[]): string {
        this.git('add', '-A');
        return this.commitStaged(subject, ...body);
    }

    commitStaged(subject: string, ...body: string[]): string {
        this.git('commit', '-q', '-m', subject, ...body.flatMap((b) => ['-m', b]));
        return this.git('rev-parse', 'HEAD');
    }

    /** Start a case: a fresh branch at `at` with a clean index and working tree. */
    reset(branch: string, at: string): void {
        if (fs.existsSync(path.join(this.dir, '.git', 'MERGE_HEAD'))) this.git('merge', '--abort');
        this.git('checkout', '-q', '-f', '-B', branch, at);
    }

    cleanup(): void {
        fs.rmSync(this.dir, { recursive: true, force: true });
        fs.rmSync(this.cfgDir, { recursive: true, force: true });
    }
}

const REC = PROTECTED_DIR;

/** What a case expects from the judgement. */
interface Expect {
    codes: ViolationCode[];
    /** SHAs the violations must name, in order (optional). */
    shas?: string[];
    judged?: number;
    merges?: number;
    warnings?: number;
    first?: string;
    extra?: (j: Judgement) => string | null;
}

function checkJudgement(name: string, j: Judgement, x: Expect): CaseOutcome {
    const got = j.violations.map((v) => v.code);
    const shown = `violations [${j.violations.map((v) => `${short(v.sha)} ${v.code}: ${v.message}`).join(' | ')}], judged ${j.judged.length}, merges ${j.merges}, warnings ${j.warnings.length}`;
    if (JSON.stringify(got) !== JSON.stringify(x.codes)) return { name, ok: false, detail: `expected codes [${x.codes.join(', ')}], got ${shown}` };
    if (x.shas && JSON.stringify(j.violations.map((v) => v.sha)) !== JSON.stringify(x.shas))
        return { name, ok: false, detail: `expected violations on [${x.shas.map(short).join(', ')}], got ${shown}` };
    if (x.judged !== undefined && j.judged.length !== x.judged) return { name, ok: false, detail: `expected ${x.judged} judged commit(s), got ${shown}` };
    if (x.merges !== undefined && j.merges !== x.merges) return { name, ok: false, detail: `expected ${x.merges} merge(s), got ${shown}` };
    if (x.warnings !== undefined && j.warnings.length !== x.warnings) return { name, ok: false, detail: `expected ${x.warnings} warning(s), got ${shown}: ${j.warnings.join(' | ')}` };
    if (x.first !== undefined && j.first !== x.first) return { name, ok: false, detail: `expected first recording commit ${short(x.first)}, got ${short(j.first)}` };
    const extra = x.extra ? x.extra(j) : null;
    if (extra) return { name, ok: false, detail: `${extra}; ${shown}` };
    return { name, ok: true, detail: shown };
}

/** Run the gate in-process on a fixture and capture what it prints (and the judgement it printed). */
function runGate(dir: string, env: NodeJS.ProcessEnv): { code: number; out: string[]; judgement: Judgement | null } {
    const out: string[] = [];
    const r = gate(dir, env, { log: (s) => out.push(s), error: (s) => out.push(s) });
    return { code: r.code, out, judgement: r.judgement };
}

const AUD_REAL = 'AUD-BUY-016';
const OD_REAL = 'OD-5';

/**
 * The shared fixture: two commits before the recording (the second is an ID-less behavior:
 * commit, which would fail if it were judged), then the first recording commit with two
 * scenarios, the env snapshot and the folder's .gitattributes.
 */
function sharedRepo(): { fx: Fixture; pre: string[]; first: string } {
    const fx = new Fixture('shared', false);
    fx.put(`${FINDINGS_DIR}${AUD_REAL}.json`, `{"id":"${AUD_REAL}"}\n`);
    fx.put(`${DECISIONS_DIR}${OD_REAL}.json`, `{"id":"${OD_REAL}"}\n`);
    fx.put('src/app.ts', 'export const a = 1;\n');
    const c0 = fx.commit('chore: start');
    fx.put('src/app.ts', 'export const a = 2;\n');
    const c1 = fx.commit('behavior: an ID-less behavior commit before the first recording');
    fx.put(`${REC}.gitattributes`, '* text=auto eol=lf\n');
    fx.put(`${REC}a.jsonl`, '{"scenario":"a","tag":"KEEP"}\n{"submitted":[]}\n');
    fx.put(`${REC}b.jsonl`, '{"scenario":"b","tag":"KEEP"}\n{"submitted":[]}\n');
    fx.put(`${REC}env/_baseline.json`, '{\n  "env": {}\n}\n');
    fx.put(`${REC}env/FOO.json`, '{\n  "cases": {"unset": {}}\n}\n');
    const first = fx.commit('test: first recordings');
    return { fx, pre: [c0, c1], first };
}

function selfTestCases(): CaseOutcome[] {
    const out: CaseOutcome[] = [];
    const caseRun = (name: string, fn: () => CaseOutcome) => {
        try {
            out.push(fn());
        } catch (e) {
            out.push({ name, ok: false, detail: `crashed: ${e instanceof Error ? e.message : String(e)}` });
        }
    };

    const { fx, pre, first } = sharedRepo();
    let n = 0;
    const start = (at = first) => fx.reset(`case-${++n}`, at);
    const judge = () => judgeHistory(fx.dir, fx.env);
    const edit = (rel: string, tail: string) => fx.put(rel, `${fx.read(rel).toString('utf8')}${tail}\n`);
    try {
        caseRun('AC-44-clean-history-passes-and-names-the-first-recording-commit', () => {
            start();
            fx.put(`${REC}c.jsonl`, '{"scenario":"c","tag":"KEEP"}\n{"submitted":[]}\n');
            fx.commit('test: add scenario c');
            fx.put('src/app.ts', 'export const a = 3;\n');
            fx.commit('fix: unrelated source change');
            const r = runGate(fx.dir, fx.env);
            if (!r.judgement) return { name: 'AC-44-clean-history-passes-and-names-the-first-recording-commit', ok: false, detail: `the gate could not judge: ${r.out.join(' | ')}` };
            const outcome = checkJudgement('AC-44-clean-history-passes-and-names-the-first-recording-commit', r.judgement, { codes: [], judged: 2, first });
            if (!outcome.ok) return outcome;
            const said = r.out.join(' | ');
            const ok = r.code === 0 && r.out.includes('RESULT PASS') && said.includes(`first recording commit ${short(first)}`) && said.includes('judged 2 commit(s)');
            return { ...outcome, ok, detail: ok ? `exit 0; ${r.out.join(' | ')}` : `expected exit 0 naming ${short(first)} and 2 judged commits, got exit ${r.code}: ${said}` };
        });

        caseRun('AC-44-commits-before-the-first-recording-commit-are-not-judged', () => {
            start();
            fx.put('src/app.ts', 'export const a = 4;\n');
            fx.commit('chore: after the recording');
            return checkJudgement('AC-44-commits-before-the-first-recording-commit-are-not-judged', judge(), {
                codes: [],
                judged: 1,
                first,
                extra: (j) => (pre.some((p) => j.judged.includes(p)) ? 'a commit before the first recording commit was judged' : null),
            });
        });

        caseRun('AC-39-edit-by-any-non-behavior-type-fails', () => {
            start();
            const types = ['feat: retune a', 'fix: retune a', 'test: re-record a', 'chore: re-record a', 'docs: re-record a', 'refactor: re-record a', `Behavior: re-record a (${AUD_REAL})`, `behaviour: re-record a (${AUD_REAL})`, `fix(behavior): re-record a (${AUD_REAL})`];
            const shas = types.map((t, i) => {
                edit(`${REC}a.jsonl`, `{"edit":${i}}`);
                return fx.commit(t);
            });
            return checkJudgement('AC-39-edit-by-any-non-behavior-type-fails', judge(), { codes: types.map(() => 'protected-change-not-behavior' as const), shas });
        });

        caseRun('AC-39-edit-as-behavior-citing-a-real-id-passes', () => {
            start();
            edit(`${REC}a.jsonl`, '{"edit":1}');
            fx.commit(`behavior: re-record a after the fix (${AUD_REAL})`);
            edit(`${REC}b.jsonl`, '{"edit":2}');
            fx.commit('behavior(exit): re-record b', `Operator decision ${OD_REAL}.`);
            return checkJudgement('AC-39-edit-as-behavior-citing-a-real-id-passes', judge(), { codes: [], judged: 2 });
        });

        caseRun('AC-41-behavior-without-an-id-fails', () => {
            start();
            edit(`${REC}a.jsonl`, '{"edit":1}');
            const c = fx.commit('behavior: re-record a');
            return checkJudgement('AC-41-behavior-without-an-id-fails', judge(), { codes: ['behavior-without-id'], shas: [c] });
        });

        caseRun('AC-41-behavior-citing-an-id-absent-from-the-register-fails', () => {
            start();
            edit(`${REC}a.jsonl`, '{"edit":1}');
            const c = fx.commit('behavior: re-record a (AUD-BUY-999)');
            edit(`${REC}b.jsonl`, '{"edit":2}');
            const d = fx.commit(`behavior: re-record b (${AUD_REAL}, OD-77)`);
            return checkJudgement('AC-41-behavior-citing-an-id-absent-from-the-register-fails', judge(), { codes: ['behavior-unknown-id', 'behavior-unknown-id'], shas: [c, d] });
        });

        caseRun('AC-41-an-id-inside-a-longer-token-is-not-an-id', () => {
            start();
            edit(`${REC}a.jsonl`, '{"edit":1}');
            const c = fx.commit(`behavior: re-record a (X${AUD_REAL}, ${AUD_REAL}0, ${AUD_REAL}-era, OD-05, aud-buy-016)`);
            return checkJudgement('AC-41-an-id-inside-a-longer-token-is-not-an-id', judge(), { codes: ['behavior-without-id'], shas: [c] });
        });

        caseRun('AC-41-an-id-that-exists-only-in-a-later-commit-fails', () => {
            start();
            edit(`${REC}a.jsonl`, '{"edit":1}');
            const c = fx.commit('behavior: re-record a (AUD-TX-030)');
            fx.put(`${FINDINGS_DIR}AUD-TX-030.json`, '{"id":"AUD-TX-030"}\n');
            fx.commit('docs: register AUD-TX-030');
            return checkJudgement('AC-41-an-id-that-exists-only-in-a-later-commit-fails', judge(), {
                codes: ['behavior-unknown-id'],
                shas: [c],
                extra: () => (fx.may(['cat-file', '-e', `HEAD:${FINDINGS_DIR}AUD-TX-030.json`]).status === 0 ? null : 'the ID should exist at HEAD (the lookup must use the judged commit)'),
            });
        });

        caseRun('AC-40-a-brand-new-scenario-passes', () => {
            start();
            fx.put(`${REC}new-scenario.jsonl`, '{"scenario":"new","tag":"KEEP"}\n{"submitted":[]}\n');
            fx.commit('test: add a brand-new scenario');
            return checkJudgement('AC-40-a-brand-new-scenario-passes', judge(), { codes: [], extra: (j) => (j.added === 1 && j.changed === 0 ? null : `expected 1 new path, 0 changed (got ${j.added}, ${j.changed})`) });
        });

        caseRun('AC-40-a-near-identical-new-file-passes-as-an-add-not-a-copy', () => {
            start();
            fx.put(`${REC}a-copy.jsonl`, `${fx.read(`${REC}a.jsonl`).toString('utf8')}{"x":1}\n`);
            const c = fx.commit('test: add a scenario close to a');
            const withCopies = fx.git('diff-tree', '--no-commit-id', '-r', '-C', '--find-copies-harder', '--name-status', c);
            return checkJudgement('AC-40-a-near-identical-new-file-passes-as-an-add-not-a-copy', judge(), {
                codes: [],
                extra: (j) => (j.added !== 1 ? `expected 1 new path, got ${j.added}` : /^C\d+/m.test(withCopies) ? null : `copy detection should have read it as a copy (git printed ${quote(withCopies)})`),
            });
        });

        caseRun('A-2-a-new-env-variable-passes', () => {
            start();
            fx.put(`${REC}env/BAR.json`, '{\n  "cases": {"unset": {}}\n}\n');
            fx.commit('test: env snapshot for BAR');
            return checkJudgement('A-2-a-new-env-variable-passes', judge(), { codes: [] });
        });

        caseRun('A-2-changing-an-env-case-needs-a-behavior-commit', () => {
            start();
            fx.put(`${REC}env/FOO.json`, '{\n  "cases": {"unset": {"changed": true}}\n}\n');
            const c = fx.commit('test: re-record FOO');
            fx.put(`${REC}env/_baseline.json`, '{\n  "env": {"X": "1"}\n}\n');
            const d = fx.commit('chore: refresh the env baseline');
            fx.put(`${REC}env/FOO.json`, '{\n  "cases": {"unset": {"changed": 2}}\n}\n');
            fx.commit(`behavior: FOO now parses differently (${AUD_REAL})`);
            return checkJudgement('A-2-changing-an-env-case-needs-a-behavior-commit', judge(), { codes: ['protected-change-not-behavior', 'protected-change-not-behavior'], shas: [c, d] });
        });

        caseRun('AC-39-deleting-a-recording-fails-unless-behavior', () => {
            start();
            fx.git('rm', '-q', '--', `${REC}b.jsonl`);
            const c = fx.commitStaged('chore: drop scenario b');
            return checkJudgement('AC-39-deleting-a-recording-fails-unless-behavior', judge(), { codes: ['protected-change-not-behavior'], shas: [c], extra: (j) => (/removes/.test(j.violations[0].message) ? null : 'the violation should say it removes the file') });
        });

        caseRun('AC-39-deleting-a-recording-as-behavior-citing-a-real-id-passes', () => {
            start();
            fx.git('rm', '-q', '--', `${REC}b.jsonl`);
            fx.commitStaged(`behavior: retire scenario b (${OD_REAL})`);
            return checkJudgement('AC-39-deleting-a-recording-as-behavior-citing-a-real-id-passes', judge(), { codes: [] });
        });

        caseRun('T-23-41-delete-then-a-later-re-add-of-the-same-path-fails', () => {
            start();
            fx.git('rm', '-q', '--', `${REC}a.jsonl`);
            fx.commitStaged(`behavior: retire scenario a (${AUD_REAL})`);
            fx.put('src/app.ts', 'export const a = 9;\n');
            fx.commit('fix: something else');
            fx.put(`${REC}a.jsonl`, '{"scenario":"a","tag":"KEEP"}\n{"laundered":true}\n');
            const c = fx.commit('test: add scenario a');
            return checkJudgement('T-23-41-delete-then-a-later-re-add-of-the-same-path-fails', judge(), {
                codes: ['protected-change-not-behavior'],
                shas: [c],
                extra: (j) => (/re-adds/.test(j.violations[0].message) ? null : 'the violation should say it re-adds the path'),
            });
        });

        caseRun('rename-fails-as-a-delete-plus-an-add', () => {
            start();
            fx.git('mv', '--', `${REC}a.jsonl`, `${REC}renamed.jsonl`);
            const c = fx.commitStaged('refactor: rename scenario a');
            const withRenames = fx.git('diff-tree', '--no-commit-id', '-r', '-M', '--name-status', c);
            return checkJudgement('rename-fails-as-a-delete-plus-an-add', judge(), {
                codes: ['protected-change-not-behavior'],
                shas: [c],
                extra: (j) =>
                    !/removes "test\/realpath\/recordings\/a\.jsonl"/.test(j.violations[0].message)
                        ? 'the violation should name the removed old path'
                        : j.added !== 1
                          ? `the new path should count as one add (got ${j.added})`
                          : /^R\d+/m.test(withRenames)
                            ? null
                            : `rename detection should have read it as a rename (git printed ${quote(withRenames)})`,
            });
        });

        caseRun('AC-42-a-merge-is-not-judged-and-its-inner-commits-are', () => {
            start();
            const base = fx.git('rev-parse', 'HEAD');
            fx.git('checkout', '-q', '-b', `side-${n}`);
            edit(`${REC}a.jsonl`, '{"side":1}');
            const inner = fx.commit('fix: re-record a on a side branch');
            fx.git('checkout', '-q', `case-${n}`);
            fx.put('src/app.ts', 'export const a = 5;\n');
            fx.commit('chore: mainline work');
            fx.git('merge', '-q', '--no-ff', '-m', 'Merge branch side', `side-${n}`);
            return checkJudgement('AC-42-a-merge-is-not-judged-and-its-inner-commits-are', judge(), {
                codes: ['protected-change-not-behavior'],
                shas: [inner],
                judged: 2,
                merges: 1,
                warnings: 0,
                extra: () => (base === first ? null : 'the case did not start at the first recording commit'),
            });
        });

        caseRun('AC-42-a-clean-merge-of-valid-commits-passes', () => {
            start();
            fx.git('checkout', '-q', '-b', `side-${n}`);
            edit(`${REC}a.jsonl`, '{"side":1}');
            fx.commit(`behavior: re-record a (${AUD_REAL})`);
            fx.git('checkout', '-q', `case-${n}`);
            fx.put(`${REC}d.jsonl`, '{"scenario":"d","tag":"KEEP"}\n{"submitted":[]}\n');
            fx.commit('test: add scenario d');
            fx.git('merge', '-q', '--no-ff', '-m', 'Merge branch side', `side-${n}`);
            return checkJudgement('AC-42-a-clean-merge-of-valid-commits-passes', judge(), { codes: [], judged: 2, merges: 1, warnings: 0 });
        });

        caseRun('AC-42-a-merge-whose-conflict-resolution-alone-changes-a-recording-warns-and-exits-0', () => {
            start();
            fx.git('checkout', '-q', '-b', `side-${n}`);
            fx.put(`${REC}a.jsonl`, '{"scenario":"a","tag":"KEEP"}\n{"side":true}\n');
            fx.commit(`behavior: re-record a on the side (${AUD_REAL})`);
            fx.git('checkout', '-q', `case-${n}`);
            fx.put(`${REC}a.jsonl`, '{"scenario":"a","tag":"KEEP"}\n{"main":true}\n');
            fx.commit(`behavior: re-record a on the mainline (${OD_REAL})`);
            const m = fx.may(['merge', '-q', '--no-ff', `side-${n}`]);
            if (m.status === 0) return { name: 'AC-42-a-merge-whose-conflict-resolution-alone-changes-a-recording-warns-and-exits-0', ok: false, detail: 'the merge was expected to conflict' };
            fx.put(`${REC}a.jsonl`, '{"scenario":"a","tag":"KEEP"}\n{"resolved":"neither"}\n');
            fx.git('add', '--', `${REC}a.jsonl`);
            const merge = fx.commitStaged('Merge branch side');
            const r = runGate(fx.dir, fx.env);
            const warn = r.out.filter((s) => s.startsWith('WARN merge '));
            if (!r.judgement) return { name: 'AC-42-a-merge-whose-conflict-resolution-alone-changes-a-recording-warns-and-exits-0', ok: false, detail: `the gate could not judge: ${r.out.join(' | ')}` };
            const outcome = checkJudgement('AC-42-a-merge-whose-conflict-resolution-alone-changes-a-recording-warns-and-exits-0', r.judgement, { codes: [], merges: 1, warnings: 1 });
            if (!outcome.ok) return outcome;
            const ok = r.code === 0 && warn.length === 1 && warn[0].includes(short(merge)) && warn[0].includes(`${REC}a.jsonl`);
            return { ...outcome, ok, detail: ok ? `exit 0; ${warn[0]}` : `expected exit 0 and one WARN line naming ${short(merge)} and a.jsonl, got exit ${r.code}: ${r.out.join(' | ')}` };
        });

        caseRun('T-23-41-a-path-added-on-a-side-line-forked-before-the-recording-fails', () => {
            start();
            fx.git('checkout', '-q', '-b', `side-${n}`, pre[1]);
            fx.put(`${REC}a.jsonl`, '{"scenario":"a","tag":"KEEP"}\n{"other":"version"}\n');
            const side = fx.commit('test: add scenario a on an older line');
            fx.git('checkout', '-q', `case-${n}`);
            const m = fx.may(['merge', '-q', '--no-ff', `side-${n}`]);
            if (m.status === 0) return { name: 'T-23-41-a-path-added-on-a-side-line-forked-before-the-recording-fails', ok: false, detail: 'the add/add merge was expected to conflict' };
            fx.put(`${REC}a.jsonl`, '{"scenario":"a","tag":"KEEP"}\n{"other":"version"}\n');
            fx.git('add', '--', `${REC}a.jsonl`);
            fx.commitStaged('Merge branch side');
            return checkJudgement('T-23-41-a-path-added-on-a-side-line-forked-before-the-recording-fails', judge(), {
                codes: ['protected-change-not-behavior'],
                shas: [side],
                merges: 1,
                warnings: 0,
                extra: (j) => (/another line of history/.test(j.violations[0].message) ? null : 'the violation should say another line adds the path'),
            });
        });

        caseRun('AC-40-the-same-new-scenario-added-on-two-lines-passes', () => {
            start();
            const text = '{"scenario":"e","tag":"KEEP"}\n{"submitted":[]}\n';
            fx.git('checkout', '-q', '-b', `side-${n}`);
            fx.put(`${REC}e.jsonl`, text);
            fx.commit('test: add scenario e');
            fx.git('checkout', '-q', `case-${n}`);
            fx.put(`${REC}e.jsonl`, text);
            fx.commit('test: add scenario e (cherry-picked)');
            fx.git('merge', '-q', '--no-ff', '-m', 'Merge branch side', `side-${n}`);
            return checkJudgement('AC-40-the-same-new-scenario-added-on-two-lines-passes', judge(), { codes: [], judged: 2, merges: 1, warnings: 0, extra: (j) => (j.added === 2 ? null : `expected two new-path adds, got ${j.added}`) });
        });

        caseRun('T-23-41-an-unrelated-root-commit-adding-an-existing-path-fails', () => {
            start();
            fx.git('checkout', '-q', '--orphan', `orphan-${n}`);
            fx.git('rm', '-r', '-q', '--cached', '--', '.');
            for (const f of fs.readdirSync(fx.dir)) if (f !== '.git') fs.rmSync(path.join(fx.dir, f), { recursive: true, force: true });
            fx.put(`${REC}a.jsonl`, '{"scenario":"a","tag":"KEEP"}\n{"orphan":true}\n');
            const root = fx.commit('test: add scenario a');
            fx.git('checkout', '-q', '-f', `case-${n}`);
            const m = fx.may(['merge', '-q', '--no-ff', '--allow-unrelated-histories', `orphan-${n}`]);
            if (m.status === 0) return { name: 'T-23-41-an-unrelated-root-commit-adding-an-existing-path-fails', ok: false, detail: 'the add/add merge was expected to conflict' };
            fx.put(`${REC}a.jsonl`, '{"scenario":"a","tag":"KEEP"}\n{"orphan":true}\n');
            fx.git('add', '--', `${REC}a.jsonl`);
            fx.commitStaged('Merge unrelated history');
            return checkJudgement('T-23-41-an-unrelated-root-commit-adding-an-existing-path-fails', judge(), { codes: ['protected-change-not-behavior'], shas: [root], merges: 1 });
        });

        caseRun('nothing-after-the-first-recording-commit-exits-2', () => {
            start();
            const r = runGate(fx.dir, fx.env);
            const ok = r.code === 2 && r.out.some((s) => /judged nothing/.test(s));
            return { name: 'nothing-after-the-first-recording-commit-exits-2', ok, detail: ok ? `exit 2: ${r.out.join(' | ')}` : `expected exit 2 (judged nothing), got exit ${r.code}: ${r.out.join(' | ')}` };
        });

        caseRun('T-23-31-a-shallow-clone-exits-non-zero', () => {
            start();
            fx.put(`${REC}c.jsonl`, 'c\n');
            fx.commit('test: add scenario c');
            const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-commit-taxonomy-shallow-'));
            try {
                const url = process.platform === 'win32' ? `file:///${posix(fx.dir)}` : `file://${fx.dir}`;
                const c = gitRun(clone, ['clone', '-q', '--depth', '1', '--', url, 'c'], fx.env);
                if (c.status !== 0) return { name: 'T-23-31-a-shallow-clone-exits-non-zero', ok: false, detail: `git clone --depth 1 failed: ${c.stderr.trim()}` };
                const r = runGate(path.join(clone, 'c'), fx.env);
                const ok = r.code === 2 && r.out.some((s) => /is a shallow clone/.test(s));
                return { name: 'T-23-31-a-shallow-clone-exits-non-zero', ok, detail: ok ? 'exit 2 on a --depth 1 clone' : `expected exit 2 with a shallow-clone message, got exit ${r.code}: ${r.out.join(' | ')}` };
            } finally {
                fs.rmSync(clone, { recursive: true, force: true });
            }
        });

        // Last on the shared repo: on a case-insensitive file system the colliding entry would
        // disturb the working tree of a later case.
        caseRun('a-case-variant-path-is-the-same-protected-file', () => {
            start();
            // Keep git from folding the variant into the existing path's case (Windows sets
            // core.ignorecase=true at init); the entry is written to the index only.
            fx.git('config', '--local', 'core.ignorecase', 'false');
            const blob = fx.may(['hash-object', '-w', '--stdin'], '{"scenario":"a","tag":"KEEP"}\n{"case":"variant"}\n');
            if (blob.status !== 0) return { name: 'a-case-variant-path-is-the-same-protected-file', ok: false, detail: `git hash-object failed: ${blob.stderr.trim()}` };
            fx.git('update-index', '--add', '--cacheinfo', `100644,${blob.stdout.toString('utf8').trim()},test/realpath/RECORDINGS/a.jsonl`);
            const c = fx.commitStaged('test: add scenario a');
            return checkJudgement('a-case-variant-path-is-the-same-protected-file', judge(), {
                codes: ['protected-change-not-behavior'],
                shas: [c],
                extra: (j) => (/re-adds "test\/realpath\/RECORDINGS\/a\.jsonl"/.test(j.violations[0].message) ? null : 'the violation should name the variant path as a re-add'),
            });
        });
    } finally {
        fx.cleanup();
    }

    caseRun('no-recording-commit-exits-2', () => {
        const nf = new Fixture('none', false);
        try {
            nf.put('src/app.ts', 'export const a = 1;\n');
            nf.commit('chore: start');
            nf.put('src/app.ts', 'export const a = 2;\n');
            nf.commit('fix: change');
            const r = runGate(nf.dir, nf.env);
            const ok = r.code === 2 && r.out.some((s) => /no commit in HEAD's history adds a file/.test(s));
            return { name: 'no-recording-commit-exits-2', ok, detail: ok ? `exit 2: ${r.out.join(' | ')}` : `expected exit 2 (no recording), got exit ${r.code}: ${r.out.join(' | ')}` };
        } finally {
            nf.cleanup();
        }
    });

    caseRun('LF-under-core.autocrlf=true-no-spurious-change-and-a-real-edit-is-seen', () => {
        const lf = new Fixture('autocrlf', true);
        const name = 'LF-under-core.autocrlf=true-no-spurious-change-and-a-real-edit-is-seen';
        try {
            lf.put(`${FINDINGS_DIR}${AUD_REAL}.json`, '{}\n');
            lf.commit('chore: start');
            lf.put(`${REC}.gitattributes`, '* text=auto eol=lf\n');
            lf.put(`${REC}a.jsonl`, '{"scenario":"a","tag":"KEEP"}\n{"submitted":[]}\n');
            lf.commit('test: first recording');
            // A fresh checkout writes the working copy: LF, not CRLF.
            fs.rmSync(path.join(lf.dir, `${REC}a.jsonl`));
            lf.git('checkout', '--', `${REC}a.jsonl`);
            const working = lf.read(`${REC}a.jsonl`);
            // An editor saving CRLF does not change the blob, so it is not a change.
            lf.put(`${REC}a.jsonl`, '{"scenario":"a","tag":"KEEP"}\r\n{"submitted":[]}\r\n');
            lf.put('src/app.ts', 'export const a = 1;\n');
            lf.commit('chore: unrelated, with a CRLF save of the recording in the working tree');
            const blob = lf.git('cat-file', '-p', `HEAD:${REC}a.jsonl`);
            const clean = judgeHistory(lf.dir, lf.env);
            if (working.includes(0x0d) || blob.includes('\r')) return { name, ok: false, detail: `expected LF only (working copy CR ${working.includes(0x0d)}, blob CR ${blob.includes('\r')})` };
            if (clean.violations.length || clean.touching !== 0) return { name, ok: false, detail: `a line-ending-only save should not touch the folder (touching ${clean.touching}, violations ${clean.violations.length})` };
            lf.put(`${REC}a.jsonl`, '{"scenario":"a","tag":"KEEP"}\n{"edited":true}\n');
            const c = lf.commit('chore: re-record a');
            return checkJudgement(name, judgeHistory(lf.dir, lf.env), { codes: ['protected-change-not-behavior'], shas: [c], judged: 2 });
        } finally {
            lf.cleanup();
        }
    });

    return out;
}

function selfTest(): number {
    const cases = selfTestCases();
    for (const c of cases) (c.ok ? console.log : console.error)(`${c.ok ? 'ok  ' : 'FAIL'} case:${c.name}: ${c.detail}`);
    const failed = cases.filter((c) => !c.ok).length;
    console.log(failed ? `SELF-TEST FAIL ${failed} of ${cases.length} cases` : `SELF-TEST PASS ${cases.length} of ${cases.length} cases`);
    return failed ? 1 : 0;
}

function main(argv: string[]): number {
    const usage = 'usage: check-commit-taxonomy.ts [--self-test]';
    if (argv.length === 0) return gateMain(REPO_ROOT);
    if (argv.length === 1 && argv[0] === '--self-test') return selfTest();
    throw new UsageError(`${usage} (got ${JSON.stringify(argv)})`);
}

if (require.main === module) {
    try {
        process.exitCode = main(process.argv.slice(2));
    } catch (e) {
        console.error(`check-commit-taxonomy: ${e instanceof UsageError ? '' : 'crash: '}${e instanceof Error ? (e instanceof UsageError ? e.message : e.stack ?? e.message) : String(e)}`);
        process.exitCode = 2;
    }
}

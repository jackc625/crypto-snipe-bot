// .planning/audit/tools/slice-files.ts
//
// Phase 22 / Plan 22-04 (D-15, AC-31/AC-32) - the ONLY command-line interface
// for slice file lists, universe checks and base-SHA snapshots. Every audit
// plan, every snapshot and every export uses this tool (through lib.ts
// enumerateSlice), never raw git pathspec globs.
//
// Usage (Node 22.16.0, ABI 127; D-21):
//   N22=/c/Users/jackc/AppData/Local/nvm/v22.16.0
//   PATH="$N22:$PATH" node node_modules/ts-node/dist/bin.js .planning/audit/tools/slice-files.ts <mode>
//
// Modes:
//   --slice <SLICE> [--sha <rev>]
//       Prints the sorted file list (default sha: BASE.json audit_base_sha).
//       Exit 1 if the list is empty or misses an anchor.
//   --check <SLICE>
//       As --slice at audit_base_sha, and additionally requires the list to
//       equal slices.json files_at_base and count_at_base. Exit 1 otherwise.
//   --universe [--sha <rev>]
//       Every tracked file must belong to exactly one slice or one scope.json
//       out-of-scope prefix. Prints unassigned and multiply-assigned files;
//       exit 1 if either list is non-empty.
//   --snapshot <SLICE[,SLICE...]> --out <dir> [--sha <rev>]
//       git archive of the literal include entries, extracted in-process into
//       <dir> (outside the repo; empty or new), excluded paths dropped. Exit 1
//       unless the extracted list equals the enumerator's list for those
//       slices and every file's blob id matches the tree.
//   --materialize
//       Rewrites slices.json files_at_base/count_at_base for every ledger
//       slice from the enumerator at audit_base_sha (atomic write).
//   Common: --root <register dir> (default .planning/audit), --repo <git dir>
//   (default this repository). Exit 0 ok, 1 check failure, 2 crash/usage.

if (process.versions.modules !== '127') {
    process.stderr.write(
        `slice-files: requires Node 22.16.0 (ABI 127); this is Node ${process.version} ` +
            `(ABI ${process.versions.modules}). Run it with ` +
            `/c/Users/jackc/AppData/Local/nvm/v22.16.0/node.exe (D-21).\n`,
    );
    process.exit(2);
}

import * as path from 'path';
import {
    Io,
    consoleIo,
    UsageError,
    parseArgs,
    locations,
    loadConfig,
    resolveSha,
    enumerateSlice,
    checkUniverse,
    snapshot,
    writeAtomic,
    toJson,
    Slice,
} from './lib';

const SPEC = {
    slice: 'string',
    check: 'string',
    universe: 'bool',
    snapshot: 'string',
    materialize: 'bool',
    out: 'string',
    sha: 'string',
    root: 'string',
    repo: 'string',
    help: 'bool',
} as const;

function findSlice(slices: Slice[], name: string): Slice {
    const s = slices.find((x) => x.slice === name);
    if (!s) throw new UsageError(`unknown slice '${name}' (known: ${slices.map((x) => x.slice).join(', ')})`);
    return s;
}

export function run(argv: string[], io: Io = consoleIo): number {
    try {
        const { flags, positional } = parseArgs(argv, SPEC as unknown as Record<string, 'string' | 'bool' | 'multi'>);
        if (flags.help) {
            io.out('usage: slice-files.ts --slice <S> [--sha r] | --check <S> | --universe [--sha r] | --snapshot <S[,S]> --out <dir> [--sha r] | --materialize [--root d] [--repo d]');
            return 0;
        }
        if (positional.length) throw new UsageError(`unexpected argument '${positional[0]}'`);
        const modes = ['slice', 'check', 'universe', 'snapshot', 'materialize'].filter((m) => flags[m] !== undefined);
        if (modes.length !== 1) throw new UsageError('give exactly one of --slice, --check, --universe, --snapshot, --materialize');
        const loc = locations(flags);
        const cfg = loadConfig(loc.root);
        const fatal = cfg.problems.filter((p) => p.file !== 'classes.json');
        if (fatal.length) {
            for (const p of fatal) io.err(`slice-files: ${p.file} ${p.field}: ${p.msg}`);
            return 1;
        }
        const sha = typeof flags.sha === 'string' ? resolveSha(loc.repo, flags.sha) : cfg.baseSha;
        const mode = modes[0];

        if (mode === 'slice' || mode === 'check') {
            const name = String(flags[mode]);
            const s = findSlice(cfg.slices, name);
            if (s.capabilities.findings_only) {
                io.err(`slice-files: ${name} is a findings-only slice; it owns no files`);
                return 1;
            }
            if (mode === 'check' && flags.sha !== undefined) throw new UsageError('--check always runs at audit_base_sha; drop --sha');
            const files = enumerateSlice(sha, s, { repo: loc.repo });
            for (const f of files) io.out(f);
            let ok = true;
            if (files.length === 0) {
                io.err(`slice-files: slice ${name} selects zero files at ${sha}`);
                ok = false;
            }
            const missing = s.anchors.filter((a) => !files.includes(a));
            for (const a of missing) io.err(`slice-files: slice ${name} is missing anchor ${a} at ${sha}`);
            if (missing.length) ok = false;
            if (mode === 'check') {
                if (files.join('\n') !== s.files_at_base.join('\n') || files.length !== s.count_at_base) {
                    const extra = files.filter((f) => !s.files_at_base.includes(f));
                    const gone = s.files_at_base.filter((f) => !files.includes(f));
                    io.err(
                        `slice-files: slice ${name} differs from files_at_base (enumerated ${files.length}, recorded ${s.count_at_base}; ` +
                            `not recorded: ${extra.join(', ') || '-'}; recorded but not enumerated: ${gone.join(', ') || '-'})`,
                    );
                    ok = false;
                }
            }
            return ok ? 0 : 1;
        }

        if (mode === 'universe') {
            const u = checkUniverse(sha, { repo: loc.repo, slices: cfg.slices, scope: cfg.scope });
            for (const p of u.unassigned) io.out(`UNASSIGNED ${p}`);
            for (const m of u.multiply_assigned) io.out(`MULTIPLY-ASSIGNED ${m.path} (${m.owners.join(', ')})`);
            const ok = u.unassigned.length === 0 && u.multiply_assigned.length === 0;
            io.out(`UNIVERSE ${ok ? 'CLEAN' : 'NOT CLEAN'} sha=${sha} tracked=${u.total} unassigned=${u.unassigned.length} multiply_assigned=${u.multiply_assigned.length}`);
            return ok ? 0 : 1;
        }

        if (mode === 'snapshot') {
            if (typeof flags.out !== 'string') throw new UsageError('--snapshot needs --out <dir>');
            const names = String(flags.snapshot).split(',').filter(Boolean);
            if (!names.length) throw new UsageError('--snapshot needs at least one slice name');
            const chosen = names.map((n) => findSlice(cfg.slices, n));
            for (const s of chosen) if (s.capabilities.findings_only) throw new UsageError(`${s.slice} is a findings-only slice; it owns no files`);
            try {
                const r = snapshot(loc.repo, sha, chosen, flags.out);
                io.out(`SNAPSHOT OK sha=${sha} slices=${names.join(',')} files=${r.files.length} out=${r.out.split(path.sep).join('/')}`);
                return 0;
            } catch (e) {
                io.err(`slice-files: snapshot failed: ${e instanceof Error ? e.message : String(e)}`);
                return 1;
            }
        }

        // materialize
        if (flags.sha !== undefined) throw new UsageError('--materialize always runs at audit_base_sha; drop --sha');
        const updated = (cfg.slicesFile.data as Slice[]).map((s) => {
            if (!s.capabilities.ledger) return { ...s, files_at_base: [], count_at_base: 0 };
            const files = enumerateSlice(cfg.baseSha, s, { repo: loc.repo });
            return { ...s, files_at_base: files, count_at_base: files.length };
        });
        writeAtomic(path.join(loc.root, 'slices.json'), toJson(updated));
        for (const s of updated) if (s.capabilities.ledger) io.out(`MATERIALIZED ${s.slice} ${s.count_at_base}`);
        return 0;
    } catch (e) {
        if (e instanceof UsageError) {
            io.err(`slice-files: ${e.message}`);
            return 2;
        }
        io.err(`slice-files: crashed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
        return 2;
    }
}

if (require.main === module) {
    process.exitCode = run(process.argv.slice(2));
}

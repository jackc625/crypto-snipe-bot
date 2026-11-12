// test/integration/fixtures/loadedModulesProbe.ts
//
// Phase 23 plan 23-31 (CHAR-06, SPEC Requirement 8): a railed child that loads one repo module
// and records which repo modules the load pulled in, read from require.cache when the process
// exits. A test reads that record instead of the module's source text, so a check written on it
// keeps working when a file moves and fails when the behavior is gone.
//
// Usage (always through test/rails/spawnRailedChild.ts):
//   node -r ts-node/register/transpile-only test/integration/fixtures/loadedModulesProbe.ts <outFile> <module> [--run]
//     <outFile>  an absolute path under os.tmpdir(); the record is written there as JSON:
//                { loaded: [{ file, exports }] }, file repo-relative with forward slashes, exports
//                the module's own export names (Object.keys of module.exports).
//     <module>   the module to load, repo-relative or absolute.
//     --run      let the loaded module run to its own end (a CLI that calls process.exit itself).
//                Without it the probe exits 0 as soon as the load returns, so a module that leaves
//                a handle open cannot keep the child alive.
//
// The probe imports only Node built-ins, and the record holds only the repo modules that entered
// require.cache after the probe started: <module> and what its load (and, with --run, its run)
// pulled in. The record is written from the 'exit' event, so it is also
// written when the loaded module ends the process. A module whose load threw is removed from
// require.cache by Node and so is absent from the record; a test that relies on the record also
// checks the child's exit status.

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const [outFile, target, ...flags] = process.argv.slice(2);

if (outFile === undefined || target === undefined || flags.some((f) => f !== '--run')) {
    process.stderr.write('loadedModulesProbe: usage <outFile> <module> [--run]\n');
    process.exit(3);
}

function repoRelative(file: string): string | null {
    const rel = path.relative(REPO_ROOT, file);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    const parts = rel.split(path.sep);
    if (parts.includes('node_modules')) return null;
    return parts.join('/');
}

function exportNames(value: unknown): string[] {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return [];
    return Object.keys(value as Record<string, unknown>).sort();
}

// Everything already in require.cache before the load (the probe itself and whatever NODE_OPTIONS
// preloaded: the rails, the env-overrides module, an in-memory mutant's hook) is not "loaded with"
// <module> and is left out of the record.
const preloaded = new Set(Object.keys(require.cache));

process.on('exit', () => {
    const loaded: { file: string; exports: string[] }[] = [];
    for (const [file, mod] of Object.entries(require.cache)) {
        if (preloaded.has(file)) continue;
        const rel = repoRelative(file);
        if (rel === null || mod === undefined) continue;
        loaded.push({ file: rel, exports: exportNames(mod.exports) });
    }
    loaded.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
    fs.writeFileSync(outFile, JSON.stringify({ loaded }), 'utf8');
});

require(path.resolve(REPO_ROOT, target));
if (!flags.includes('--run')) process.exit(0);

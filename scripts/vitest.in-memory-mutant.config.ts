// scripts/vitest.in-memory-mutant.config.ts
//
// Phase 23 plan 23-29 (CHAR-06, SPEC Requirement 8): the Vitest config the RED-proof runner
// (scripts/red-proof-conversions.ts) uses to show a converted test can fail. It is the normal
// vitest.config.ts plus one Vite plugin. A named mutant is applied IN MEMORY as the code is
// loaded, read or run; nothing under src/ or scripts/ is ever written for a proof, so a failure
// partway can leave no production file modified.
//
// Switch: CSB_MUTANT_SPEC, JSON { file, edits: [{ find, replace }], root?, ackDir?, childHook?, workerHook? }.
//   - Unset: the plugin's transform returns null for every module and no setup file is added;
//     the run is the normal suite.
//   - Set: three reach points, each applying the same edits with applyEdits from
//     scripts/in-memory-mutant-overlay.cjs (LF the text, each find exactly once, else throw, so a
//     mutant that did not apply can never pass as a RED):
//       vite    the plugin edits the one module whose id (query removed, backslashes turned into
//               forward slashes) is <root>/<file> when root is given, or ends in /<file>
//               otherwise, and calls ack(spec, 'vite') when ackDir is given.
//       worker  workerHook (a one-line file the runner writes, calling installOverlay(spec,
//               'worker')) is added to root test.setupFiles, which the `extends: true` projects
//               inherit, so a test's own fs read or the TypeScript compiler API sees the edit.
//               Measured (Vitest 4.1.1): root setupFiles run before each project's own, so the
//               rails setup (test/rails/setup.cjs) installs after the overlay and wraps it; the
//               rails therefore still check every path, the target's included, before the read.
//       child   when transforming test/rails/spawnRailedChild.ts, the plugin adds, after the line
//               `parts.push(...nodeOptions);`, one more parts.push carrying --require and the
//               JSON.stringify'd childHook path. The rails preload therefore stays first, every
//               spawn limit still applies, and the file on disk is untouched; a changed line fails
//               loudly because applyEdits throws.
//
// Only the proof runner sets CSB_MUTANT_SPEC, and only in the environment of the Vitest child it
// starts. The normal vitest.config.ts is unchanged and never sees this plugin.
//
// This file creates no file: the proof runner writes the hooks, and the only file the overlay
// creates is a marker inside the runner's temp ackDir.

import path from 'path';
import { createRequire } from 'module';
import { defineConfig, mergeConfig, type Plugin } from 'vitest/config';
import baseConfig from '../vitest.config';

const SPEC_ENV = 'CSB_MUTANT_SPEC';
// A backslash, built at run time so no escaped backslash has to survive in this file.
const BACKSLASH = String.fromCharCode(92);
const IS_WIN = process.platform === 'win32';
const REPO_ROOT = path.resolve(__dirname, '..');
const SPAWNER = path.join(REPO_ROOT, 'test', 'rails', 'spawnRailedChild.ts');
const SPAWNER_ANCHOR = 'parts.push(...nodeOptions);';

interface MutantEdit {
    find: string;
    replace: string;
}

interface MutantSpec {
    file: string;
    edits: MutantEdit[];
    root?: string;
    ackDir?: string;
    childHook?: string;
    workerHook?: string;
}

interface Overlay {
    applyEdits(text: string, edits: MutantEdit[]): string;
    ack(spec: MutantSpec, reach: 'vite' | 'worker' | 'child'): boolean;
}

const overlay = createRequire(path.join(__dirname, 'vitest.in-memory-mutant.config.ts'))('./in-memory-mutant-overlay.cjs') as Overlay;

function fail(msg: string): never {
    throw new Error(`[in-memory mutant] ${msg}`);
}

function optionalAbsolute(o: Record<string, unknown>, key: string): string | undefined {
    const v = o[key];
    if (v === undefined) return undefined;
    if (typeof v !== 'string' || !path.isAbsolute(v)) fail(`${SPEC_ENV}.${key} must be an absolute path`);
    return v;
}

function parseSpec(raw: string | undefined): MutantSpec | null {
    if (raw === undefined || raw === '') return null;
    let v: unknown;
    try {
        v = JSON.parse(raw);
    } catch (e) {
        fail(`${SPEC_ENV} is not JSON: ${(e as Error).message}`);
    }
    if (!v || typeof v !== 'object' || Array.isArray(v)) fail(`${SPEC_ENV} must be a JSON object`);
    const o = v as Record<string, unknown>;
    if (typeof o.file !== 'string' || o.file === '') fail(`${SPEC_ENV}.file must be a non-empty string`);
    if (path.isAbsolute(o.file) || o.file.split(BACKSLASH).join('/').split('/').includes('..')) {
        fail(`${SPEC_ENV}.file must be a repo-relative path without '..': ${JSON.stringify(o.file)}`);
    }
    if (!Array.isArray(o.edits) || o.edits.length === 0) fail(`${SPEC_ENV}.edits must be a non-empty array`);
    for (const e of o.edits) {
        if (!e || typeof e !== 'object' || typeof e.find !== 'string' || e.find === '' || typeof e.replace !== 'string') {
            fail(`${SPEC_ENV}.edits entries must be { find: non-empty string, replace: string }`);
        }
    }
    const known = new Set(['file', 'edits', 'root', 'ackDir', 'childHook', 'workerHook']);
    for (const k of Object.keys(o)) if (!known.has(k)) fail(`${SPEC_ENV} has an unknown field ${JSON.stringify(k)}`);
    return {
        file: o.file,
        edits: o.edits as MutantEdit[],
        root: optionalAbsolute(o, 'root'),
        ackDir: optionalAbsolute(o, 'ackDir'),
        childHook: optionalAbsolute(o, 'childHook'),
        workerHook: optionalAbsolute(o, 'workerHook'),
    };
}

function slashes(p: string): string {
    return p.split(BACKSLASH).join('/');
}

function sameText(a: string, b: string): boolean {
    return IS_WIN ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function bareId(id: string): string | null {
    if (id.startsWith(String.fromCharCode(0))) return null; // a virtual module
    const q = id.indexOf('?');
    return slashes(q === -1 ? id : id.slice(0, q));
}

/** True when the Vite module id names spec.file. */
function isTarget(bare: string, spec: MutantSpec): boolean {
    const rel = slashes(spec.file).replace(/^\.\//, '');
    if (spec.root !== undefined) return sameText(bare, slashes(path.resolve(spec.root, rel)));
    const tail = '/' + rel;
    return bare.length > tail.length && sameText(bare.slice(bare.length - tail.length), tail);
}

function inMemoryMutant(spec: MutantSpec | null): Plugin {
    return {
        name: 'csb-in-memory-mutant',
        enforce: 'pre',
        transform(code: string, id: string) {
            if (spec === null) return null;
            const bare = bareId(id);
            if (bare === null) return null;
            let out: string | null = null;
            if (isTarget(bare, spec)) {
                out = overlay.applyEdits(code, spec.edits);
                overlay.ack(spec, 'vite');
            }
            if (spec.childHook !== undefined && sameText(bare, slashes(SPAWNER))) {
                const hookLine = `parts.push(${JSON.stringify(`--require ${JSON.stringify(spec.childHook)}`)});`;
                out = overlay.applyEdits(out ?? code, [{ find: SPAWNER_ANCHOR, replace: `${SPAWNER_ANCHOR}\n    ${hookLine}` }]);
            }
            return out === null ? null : { code: out, map: null };
        },
    };
}

const spec = parseSpec(process.env[SPEC_ENV]);

export default mergeConfig(
    baseConfig,
    defineConfig({
        plugins: [inMemoryMutant(spec)],
        test: {
            // No module cache on disk: a mutated transform must never outlive its run.
            experimental: { fsModuleCache: false },
            ...(spec?.workerHook !== undefined ? { setupFiles: [spec.workerHook] } : {}),
        },
    }),
);

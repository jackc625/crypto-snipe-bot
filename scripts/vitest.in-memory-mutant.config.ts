// scripts/vitest.in-memory-mutant.config.ts
//
// Phase 23 plan 23-29 (CHAR-06, SPEC Requirement 8): the Vitest config the RED-proof runner
// (scripts/red-proof-conversions.ts) uses to show a converted test can fail. It is the normal
// vitest.config.ts plus one Vite plugin. A named mutant is applied IN MEMORY as Vite loads the
// module; nothing under src/ or scripts/ is ever written for a proof, so a failure partway can
// leave no production file modified.
//
// Switch: CSB_MUTANT_SPEC, JSON { file, edits: [{ find, replace }], root? }.
//   - Unset: the plugin's transform returns null for every module; the run is the normal suite.
//   - Set: the plugin acts on exactly one module, the one whose id (query removed, backslashes
//     turned into forward slashes) is <root>/<file> when root is given, or ends in /<file>
//     otherwise. Its text is converted to LF in memory and each edit is applied in order; an
//     edit whose find does not occur exactly once throws, so a mutant that did not apply can
//     never pass as a RED.
//
// Only the proof runner sets CSB_MUTANT_SPEC, and only in the environment of the Vitest child it
// starts. The normal vitest.config.ts is unchanged and never sees this plugin.
//
// This file creates no file.

import path from 'path';
import { defineConfig, mergeConfig, type Plugin } from 'vitest/config';
import baseConfig from '../vitest.config';

const SPEC_ENV = 'CSB_MUTANT_SPEC';
// A backslash, built at run time so no escaped backslash has to survive in this file.
const BACKSLASH = String.fromCharCode(92);
const IS_WIN = process.platform === 'win32';

interface MutantEdit {
    find: string;
    replace: string;
}

interface MutantSpec {
    file: string;
    edits: MutantEdit[];
    root?: string;
}

function fail(msg: string): never {
    throw new Error(`[in-memory mutant] ${msg}`);
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
    if (o.root !== undefined && (typeof o.root !== 'string' || !path.isAbsolute(o.root))) fail(`${SPEC_ENV}.root must be an absolute path`);
    return { file: o.file, edits: o.edits as MutantEdit[], root: o.root as string | undefined };
}

function slashes(p: string): string {
    return p.split(BACKSLASH).join('/');
}

function sameText(a: string, b: string): boolean {
    return IS_WIN ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** True when the Vite module id names spec.file. */
function isTarget(id: string, spec: MutantSpec): boolean {
    if (id.startsWith(String.fromCharCode(0))) return false; // a virtual module
    const q = id.indexOf('?');
    const bare = slashes(q === -1 ? id : id.slice(0, q));
    const rel = slashes(spec.file).replace(/^\.\//, '');
    if (spec.root !== undefined) return sameText(bare, slashes(path.resolve(spec.root, rel)));
    const tail = '/' + rel;
    return bare.length > tail.length && sameText(bare.slice(bare.length - tail.length), tail);
}

/** LF the text, then apply each edit in order; each find must occur exactly once. */
function applyEdits(text: string, edits: MutantEdit[]): string {
    let out = text.split('\r\n').join('\n');
    for (const e of edits) {
        const find = e.find.split('\r\n').join('\n');
        const first = out.indexOf(find);
        if (first === -1) fail(`find does not occur: ${JSON.stringify(e.find)}`);
        if (out.indexOf(find, first + 1) !== -1) fail(`find occurs more than once: ${JSON.stringify(e.find)}`);
        out = out.slice(0, first) + e.replace + out.slice(first + find.length);
    }
    return out;
}

function inMemoryMutant(spec: MutantSpec | null): Plugin {
    return {
        name: 'csb-in-memory-mutant',
        enforce: 'pre',
        transform(code: string, id: string) {
            if (spec === null) return null;
            if (!isTarget(id, spec)) return null;
            return { code: applyEdits(code, spec.edits), map: null };
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
        },
    }),
);

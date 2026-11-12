'use strict';
// scripts/in-memory-mutant-overlay.cjs
//
// Phase 23 plan 23-29 (CHAR-06, SPEC Requirement 8): the in-memory file-read overlay that lets a
// named mutant reach code Vite does not load itself: a source read through fs (a test's own
// readFileSync, the TypeScript compiler API through ts.sys.readFile) inside a Vitest worker, and
// a railed child that runs the code through ts-node or Node's own loader.
//
// Plain CommonJS so a child can --require it before ts-node. Loaded only through the one-line
// hook files the proof runner (scripts/red-proof-conversions.ts) writes into a temp folder when it
// sets CSB_MUTANT_SPEC; nothing in the normal suite loads it.
//
// Exports:
//   applyEdits(text, edits)   LF the text, apply each { find, replace } in order; throws unless
//                             each find occurs exactly once in the text it is applied to.
//   ack(spec, reach)          create one marker file named for reach ('vite', 'worker' or 'child')
//                             inside spec.ackDir, which must be an existing folder under
//                             os.tmpdir(). That marker is the only file this module ever creates.
//   installOverlay(spec, reach)
//                             wrap fs.readFileSync on Node's fs module object for exactly one path,
//                             spec.root joined with spec.file (compared after path.resolve, with
//                             backslashes as forward slashes, case-insensitively). A read of that
//                             path first goes through the function it wrapped (so a rail's wrapper
//                             underneath still decides it), then returns the edited text, as a
//                             string or a Buffer to match the caller's encoding argument, and calls
//                             ack(spec, reach). Every other path goes straight to the wrapped
//                             function. Then Module.syncBuiltinESMExports(), as the rails do
//                             (test/rails/core.cjs), so an ESM named import of readFileSync sees it.
//                             A second call in the same process with the same spec changes nothing;
//                             with a different spec it throws.
//
// Nothing here writes, renames or removes a file under the repo: the target is only ever read.

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { fileURLToPath } = require('url');

// A backslash, built at run time so no escaped backslash has to survive in this file.
const BACKSLASH = String.fromCharCode(92);
const REACHES = Object.freeze(['vite', 'worker', 'child']);
const STATE_KEY = Symbol.for('crypto-snipe-bot.in-memory-mutant.overlay');

function fail(msg) {
    throw new Error('[in-memory mutant] ' + msg);
}

function toLf(s) {
    return s.split('\r\n').join('\n');
}

function applyEdits(text, edits) {
    if (typeof text !== 'string') fail('applyEdits: text must be a string');
    if (!Array.isArray(edits) || edits.length === 0) fail('applyEdits: edits must be a non-empty array');
    let out = toLf(text);
    for (const e of edits) {
        if (!e || typeof e.find !== 'string' || e.find === '' || typeof e.replace !== 'string') {
            fail('applyEdits: each edit must be { find: non-empty string, replace: string }');
        }
        const find = toLf(e.find);
        const first = out.indexOf(find);
        if (first === -1) fail('find does not occur: ' + JSON.stringify(e.find));
        if (out.indexOf(find, first + 1) !== -1) fail('find occurs more than once: ' + JSON.stringify(e.find));
        out = out.slice(0, first) + e.replace + out.slice(first + find.length);
    }
    return out;
}

function canonKey(p) {
    return path.resolve(p).split(BACKSLASH).join('/').toLowerCase();
}

function realDir(p) {
    try {
        return canonKey(fs.realpathSync.native(p));
    } catch {
        return null;
    }
}

function checkSpec(spec) {
    if (!spec || typeof spec !== 'object') fail('spec must be an object');
    if (typeof spec.file !== 'string' || spec.file === '' || path.isAbsolute(spec.file)) fail('spec.file must be a repo-relative path');
    if (spec.file.split(BACKSLASH).join('/').split('/').includes('..')) fail("spec.file must not contain '..'");
    if (typeof spec.root !== 'string' || !path.isAbsolute(spec.root)) fail('spec.root must be an absolute path');
    if (!Array.isArray(spec.edits) || spec.edits.length === 0) fail('spec.edits must be a non-empty array');
}

function ack(spec, reach) {
    if (!REACHES.includes(reach)) fail('ack: reach must be one of ' + REACHES.join(', ') + ', got ' + JSON.stringify(reach));
    if (!spec || typeof spec.ackDir !== 'string' || spec.ackDir === '') return false;
    if (!path.isAbsolute(spec.ackDir)) fail('ack: spec.ackDir must be an absolute path');
    const dir = realDir(spec.ackDir);
    const tmp = realDir(os.tmpdir());
    if (dir === null) fail('ack: spec.ackDir does not exist: ' + spec.ackDir);
    if (tmp === null || !(dir + '/').startsWith(tmp + '/') || dir === tmp) fail('ack: spec.ackDir must be a folder under os.tmpdir(): ' + spec.ackDir);
    fs.writeFileSync(path.join(spec.ackDir, reach), String(process.pid) + '\n');
    return true;
}

function pathArg(p) {
    if (typeof p === 'string') return p;
    if (Buffer.isBuffer(p)) return p.toString('utf8');
    if (p instanceof URL) return p.protocol === 'file:' ? fileURLToPath(p) : null;
    return null; // a file descriptor or anything else is never the target
}

function encodingOf(options) {
    if (typeof options === 'string') return options;
    if (options && typeof options === 'object' && typeof options.encoding === 'string') return options.encoding;
    return null;
}

function installOverlay(spec, reach) {
    if (reach !== 'worker' && reach !== 'child') fail("installOverlay: reach must be 'worker' or 'child', got " + JSON.stringify(reach));
    checkSpec(spec);
    const specJson = JSON.stringify(spec);
    const target = canonKey(path.join(spec.root, spec.file));
    const prior = globalThis[STATE_KEY];
    if (prior) {
        if (prior.specJson !== specJson || prior.reach !== reach) fail('installOverlay: a different overlay is already installed in this process');
        Module.syncBuiltinESMExports();
        return { installed: false, target };
    }
    const inner = fs.readFileSync;
    const overlayReadFileSync = function overlayReadFileSync(p, options) {
        const s = pathArg(p);
        if (s === null || canonKey(s) !== target) return Reflect.apply(inner, this, arguments);
        const raw = Reflect.apply(inner, this, [p, 'utf8']);
        const text = applyEdits(raw, spec.edits);
        ack(spec, reach);
        const enc = encodingOf(options);
        if (enc === null || enc === 'buffer') return Buffer.from(text, 'utf8');
        return Buffer.from(text, 'utf8').toString(enc);
    };
    fs.readFileSync = overlayReadFileSync;
    if (fs.readFileSync !== overlayReadFileSync) fail('installOverlay: could not replace fs.readFileSync');
    Object.defineProperty(globalThis, STATE_KEY, { value: Object.freeze({ specJson, reach, target }), writable: false, configurable: false, enumerable: false });
    Module.syncBuiltinESMExports();
    return { installed: true, target };
}

module.exports = { applyEdits, ack, installOverlay };

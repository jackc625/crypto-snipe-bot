'use strict';
// test/rails/probes/duplicateLoadProbe.cjs
// Phase 22 plan 22-12 Task 1 — SAFE-03 AC-20 probe. Loads a guarded module a second time in a
// plain Node process and reports what happened. Run ONLY as a railed child through
// test/rails/spawnRailedChild.ts.
//
// argv: <mode> <module path> [more module paths, mode single only]
//   casing    require the module, then a casing alias of the same path (win32 only; elsewhere
//             prints NOALIAS after confirming the alias path does not exist)
//   junction  require the module, then require it through a temp directory junction (win32) or
//             symlink (others) to the module's folder. Run with --preserve-symlinks, otherwise
//             Node resolves the link back to the real path and there is no second identity.
//   cache     require the module, delete its require.cache entry, require it again
//   single    require each listed module once, the normal load, and print LOADED_ONCE
//
// One result line on stdout, whatever else the loaded modules log:
//   THREW SINGLETON_DUPLICATE <secondIdentity>
//                     only when err.code is exactly SINGLETON_DUPLICATE AND err.secondIdentity
//                     equals the alias path just loaded (the alias reached registration)
//   OTHER_ERROR <code> <message first line>
//                     anything else, so an unrelated failure can never pass as a proof
//   LOADED_TWICE | LOADED_ONCE | NOALIAS <path>
//
// Junction mode rewrites how the ALIASED module's OWN imports resolve, mapping them to the real
// folder. Without that, `../guards/epoch` under a temp junction points at a folder that does not
// exist (review concern L283@e2e59f6), and a module that imports another guarded module would
// trip on that import first, naming the wrong file. The module under test still loads through
// the junction, with the junction path as its `__filename`.
//
// The junction points into src/. It is removed with unlinkSync (removes the link only) and its
// parent with a non-recursive rmdirSync. NEVER use a recursive delete here: it could walk
// through the link and delete the real source files.

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const core = require('../core.cjs');

function emit(line) {
    fs.writeSync(1, `${line}\n`);
}

function refuse(why) {
    process.stderr.write(`duplicateLoadProbe: ${why}\n`);
    process.exit(3);
}

// Fail-safe order (P3): the modules below import src/utils/db. Under the rails and VITEST=true
// that resolves to a per-worker temp file; refuse to load anything without both.
if (!core.railsStatus().dbWrapperInstalled) refuse('rails DB tripwire not installed; refusing to load src modules');
if (process.env.VITEST !== 'true') refuse('VITEST is not set; refusing to load src modules');

require('ts-node/register/transpile-only');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const [mode, ...modulePaths] = process.argv.slice(2);
if (!['casing', 'junction', 'cache', 'single'].includes(mode) || modulePaths.length === 0) {
    refuse(`usage: <casing|junction|cache|single> <module path>, got ${JSON.stringify(process.argv.slice(2))}`);
}

const realPaths = modulePaths.map((p) => path.resolve(REPO_ROOT, p));
const realPath = realPaths[0];

function firstLine(message) {
    return String(message).split(/\r?\n/)[0];
}

function reportError(err, aliasPath) {
    if (err && err.code === 'SINGLETON_DUPLICATE' && err.secondIdentity === aliasPath) {
        emit(`THREW SINGLETON_DUPLICATE ${err.secondIdentity}`);
        return;
    }
    emit(`OTHER_ERROR ${err && err.code} ${firstLine(err && err.message)}`);
}

function loadSecond(aliasPath, loadAlias) {
    try {
        require(realPath);
        loadAlias();
    } catch (err) {
        reportError(err, aliasPath);
        return;
    }
    emit('LOADED_TWICE');
}

function swapFirstLetterCase(name) {
    const first = name[0];
    const swapped = first === first.toUpperCase() ? first.toLowerCase() : first.toUpperCase();
    return swapped + name.slice(1);
}

function runCasing() {
    const aliasPath = path.join(path.dirname(realPath), swapFirstLetterCase(path.basename(realPath)));
    if (process.platform !== 'win32') {
        if (fs.existsSync(aliasPath)) refuse(`casing alias exists on this filesystem: ${aliasPath}`);
        emit(`NOALIAS ${aliasPath}`);
        return;
    }
    loadSecond(aliasPath, () => require(aliasPath));
}

function runCache() {
    loadSecond(realPath, () => {
        delete require.cache[require.resolve(realPath)];
        require(realPath);
    });
}

function runJunction() {
    const realDir = path.dirname(realPath);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-dup-probe-'));
    const linkDir = path.join(tempDir, 'alias');
    fs.symlinkSync(realDir, linkDir, process.platform === 'win32' ? 'junction' : 'dir');

    const originalResolve = Module._resolveFilename;
    Module._resolveFilename = function resolveAliasedParentsToReal(request, parent, ...rest) {
        if (parent && typeof parent.filename === 'string' && parent.filename.startsWith(linkDir + path.sep)) {
            const realFilename = path.join(realDir, path.relative(linkDir, parent.filename));
            const realParent = Object.create(parent);
            realParent.id = realFilename;
            realParent.filename = realFilename;
            realParent.paths = Module._nodeModulePaths(path.dirname(realFilename));
            return originalResolve.call(this, request, realParent, ...rest);
        }
        return originalResolve.call(this, request, parent, ...rest);
    };

    try {
        const aliasPath = path.join(linkDir, path.basename(realPath));
        loadSecond(aliasPath, () => require(aliasPath));
    } finally {
        Module._resolveFilename = originalResolve;
        fs.unlinkSync(linkDir);
        fs.rmdirSync(tempDir);
    }
}

function runSingle() {
    try {
        for (const p of realPaths) require(p);
    } catch (err) {
        emit(`OTHER_ERROR ${err && err.code} ${firstLine(err && err.message)}`);
        return;
    }
    emit('LOADED_ONCE');
}

const runners = { casing: runCasing, junction: runJunction, cache: runCache, single: runSingle };
runners[mode]();
// Loaded modules may hold timers or sockets; this probe has already reported.
process.exit(0);

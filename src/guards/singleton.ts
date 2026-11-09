// src/guards/singleton.ts
//
// Phase 22 plan 22-12 (SAFE-03, D-05): refuse a second copy of a lock or registry module.
//
// Modules such as src/utils/nonceAuthority.ts hold per-wallet state in plain module variables.
// If the same file is loaded twice in one process (a Windows path-casing alias, a junction or
// symlink alias, a `?query` re-import, `delete require.cache`), the process silently gets two
// independent copies of that state: two nonce authorities for one wallet.
//
// Each guarded module calls registerSingleton once at load. The registry lives on `globalThis`
// under a `Symbol.for` key, so a second copy of THIS file still sees the same registry. It is
// keyed by `fs.realpathSync.native` of the module's file: the JS `fs.realpathSync` keeps an
// alias's casing, the native call returns the on-disk name.
//
// Rules for a file that is already registered:
//   different raw identity                  -> throw (casing or link alias)
//   same raw identity, same epoch           -> throw (true duplicate, or `?query` re-import)
//   same raw identity, different epoch      -> allow and replace (the whole graph was reset)
//
// There is deliberately no env var, no Vitest import and no reset or disable export (P5,
// NAC-05), and the existing `_reset*ForTesting` hooks are unrelated to this guard.

import * as fs from 'fs';

const REGISTRY_KEY = Symbol.for('crypto-snipe-bot.singletonRegistry');

interface SingletonEntry {
    name: string;
    rawIdentity: string;
    epoch: object;
}

type SingletonRegistry = Map<string, SingletonEntry>;

function getRegistry(): SingletonRegistry {
    const holder = globalThis as unknown as Record<symbol, SingletonRegistry | undefined>;
    let registry = holder[REGISTRY_KEY];
    if (registry === undefined) {
        registry = new Map<string, SingletonEntry>();
        holder[REGISTRY_KEY] = registry;
    }
    return registry;
}

function duplicateError(name: string, canonicalPath: string, firstIdentity: string, secondIdentity: string): Error {
    const message =
        `SINGLETON_DUPLICATE: module '${name}' was loaded a second time in this process and the load was refused. ` +
        `Canonical file: ${canonicalPath}. First loaded as: ${firstIdentity}. Refused load: ${secondIdentity}. ` +
        'A second copy would mean a second nonce authority or lock registry for the same wallet (SAFE-03, D-NONCE-AUTHORITY-ALL).';
    return Object.assign(new Error(message), {
        code: 'SINGLETON_DUPLICATE',
        canonicalPath,
        firstIdentity,
        secondIdentity,
    });
}

/**
 * Registers one load of a guarded module, or throws `SINGLETON_DUPLICATE` if this load would be
 * a second copy. Call it once, at module scope, beside the state it protects.
 *
 * @param name         short module name, used in the error message
 * @param rawIdentity  the module's own un-normalized `__filename`
 * @param epoch        the `EPOCH` object from src/guards/epoch.ts, as this module imported it
 */
export function registerSingleton(name: string, rawIdentity: string, epoch: object): void {
    const registry = getRegistry();
    const canonicalPath = fs.realpathSync.native(rawIdentity);
    const existing = registry.get(canonicalPath);
    if (existing !== undefined && (existing.rawIdentity !== rawIdentity || existing.epoch === epoch)) {
        throw duplicateError(name, canonicalPath, existing.rawIdentity, rawIdentity);
    }
    registry.set(canonicalPath, { name, rawIdentity, epoch });
}

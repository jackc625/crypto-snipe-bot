// test/realpath/ordering/identity.test.ts
// Phase 23 plan 23-24 Task 2 (CHAR-04, AC-30 identity, Flag 5): the duplicate-load guard's
// behavior, through the real src/guards/singleton.ts registerSingleton in a real scenario graph.
//
// The four guarded modules (src/utils/nonceAuthority.ts, src/utils/exitManager.ts,
// src/exitEngine.ts, src/anti-rug/detector.ts) each call registerSingleton(name, __filename, EPOCH)
// once at load. A scenario graph (world.ts loadGraph: vi.resetModules, then the real imports)
// registers each of them in the graph's epoch (src/guards/epoch.ts EPOCH, one object per graph).
//
//   - Same epoch: a second evaluation of a guarded module in the same graph is refused with
//     SINGLETON_DUPLICATE. The second copy is a `?query` re-import, the true-duplicate case the
//     guard names in its own header: the module runner treats the query as a new module and
//     evaluates the file again, with the same __filename, against the same cached EPOCH. Each
//     guarded module's top level before its registerSingleton call only creates a logger child,
//     so the refused copy leaves nothing behind.
//   - Whole-graph reset (Flag 5): restartGraph stops the graph and loads every module again on
//     the same file (vi.resetModules, then the real imports), a new epoch, and is allowed: every
//     guarded module registers again and the restarted graph works. The guard stays armed in the
//     new epoch: a `?query` copy there is refused too.
//
// test/unit/guards/singleton.test.ts covers the casing and junction aliases and plain-Node
// require.cache reloads in railed children; this file pins the guard where the scenarios run.
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything. The query
// specifiers are built at run time (the module runner resolves them against this file), so no
// type declaration is needed for a `?query` path.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createScenario, createTempDbFile, restartGraph } from '../harness/world';

interface GuardedModule {
    name: string;
    /** Import specifier relative to this file. */
    spec: string;
    fileName: string;
}

const GUARDED: GuardedModule[] = [
    { name: 'nonceAuthority', spec: '../../../src/utils/nonceAuthority', fileName: 'nonceAuthority.ts' },
    { name: 'exitManager', spec: '../../../src/utils/exitManager', fileName: 'exitManager.ts' },
    { name: 'exitEngine', spec: '../../../src/exitEngine', fileName: 'exitEngine.ts' },
    { name: 'antiRugDetector', spec: '../../../src/anti-rug/detector', fileName: 'detector.ts' },
];

interface DuplicateError extends Error {
    code?: string;
    canonicalPath?: string;
    firstIdentity?: string;
    secondIdentity?: string;
}

let copies = 0;

/** Evaluate a second copy of the module in the current graph; resolves to what it threw, or null. */
async function loadSecondCopy(mod: GuardedModule): Promise<DuplicateError | null> {
    copies += 1;
    const spec = `${mod.spec}?realpath-second-copy=${copies}`;
    return import(/* @vite-ignore */ spec).then(
        () => null,
        (e: unknown) => e as DuplicateError,
    );
}

/** The graph's epoch object (src/guards/epoch.ts), as the guarded modules of this graph imported it. */
async function graphEpoch(): Promise<object> {
    return (await import('../../../src/guards/epoch')).EPOCH;
}

function expectDuplicate(err: DuplicateError | null, mod: GuardedModule): void {
    expect(err, `a second copy of ${mod.name} in one epoch must be refused`).not.toBeNull();
    expect(err!.code).toBe('SINGLETON_DUPLICATE');
    expect(err!.message).toMatch(new RegExp(`^SINGLETON_DUPLICATE: module '${mod.name}' was loaded a second time in this process and the load was refused\\.`));
    // The same raw identity both times (the same file, not an alias), and the canonical path is
    // the on-disk real path of that file.
    expect(err!.secondIdentity).toBe(err!.firstIdentity);
    expect(path.basename(String(err!.firstIdentity))).toBe(mod.fileName);
    expect(err!.canonicalPath).toBe(fs.realpathSync.native(String(err!.secondIdentity)));
}

describe('duplicate-load guard (the real registerSingleton) in a scenario graph', () => {
    it.each(GUARDED)('$name: a second copy in the same epoch is refused with SINGLETON_DUPLICATE', async (mod) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const epoch = await graphEpoch();
        expectDuplicate(await loadSecondCopy(mod), mod);
        // The refused copy changed nothing: the graph's own module and epoch are the ones it loaded.
        expect(await graphEpoch()).toBe(epoch);
        const loaded = { nonceAuthority: await import('../../../src/utils/nonceAuthority'), exitManager: sc.graph.exitManager, exitEngine: sc.graph.exitEngine, antiRugDetector: sc.graph.detector } as Record<string, unknown>;
        expect(await import(/* @vite-ignore */ mod.spec)).toBe(loaded[mod.name]);
    });

    it('a whole-graph reset (restartGraph, a new epoch) is allowed, every guarded module loads again, and the guard stays armed in the new epoch', async () => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', db: { file: createTempDbFile() } });
        const before = { epoch: await graphEpoch(), exitManager: sc.graph.exitManager, exitEngine: sc.graph.exitEngine, detector: sc.graph.detector, nonceAuthority: await import('../../../src/utils/nonceAuthority') };

        // The reset loads all four guarded modules again; none is refused.
        await restartGraph(sc);
        const after = { epoch: await graphEpoch(), exitManager: sc.graph.exitManager, exitEngine: sc.graph.exitEngine, detector: sc.graph.detector, nonceAuthority: await import('../../../src/utils/nonceAuthority') };
        expect(after.epoch).not.toBe(before.epoch);
        expect(after.exitManager).not.toBe(before.exitManager);
        expect(after.exitEngine).not.toBe(before.exitEngine);
        expect(after.detector).not.toBe(before.detector);
        expect(after.nonceAuthority).not.toBe(before.nonceAuthority);
        // The restarted graph works: its registries answer and its database is the same file.
        expect(sc.graph.exitManager.hasExitMonitorTimer('eth', sc.token)).toBe(false);
        expect(sc.graph.detector.getRegisteredPositions('eth')).toEqual([]);
        expect(sc.graph.db.open).toBe(true);

        // In the new epoch a second copy is still refused, for every guarded module.
        for (const mod of GUARDED) expectDuplicate(await loadSecondCopy(mod), mod);
        expect(await graphEpoch()).toBe(after.epoch);
    });
});

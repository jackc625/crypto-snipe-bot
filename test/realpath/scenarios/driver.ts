// test/realpath/scenarios/driver.ts
// Phase 23 plan 23-20 (CHAR-02, D-12, D-13, D-15): runScenario, one whole-graph scenario that
// produces one golden-master recording.
//
// Order, fixed so an unfinished scenario can never be blessed (review concern: a passing scenario
// does not prove the exit completed):
//   1. createScenario (the whole graph on the fake chain, fixed clock, D-06 entry at the chain);
//   2. steps(scenario): the test drives the real path (listener, buy, polls, exit, mining);
//   3. no stray call (AC-03) and no DB capture violation, so nothing the recording holds was
//      produced on a path a real node would not take, or captured inside a rolled-back write;
//   4. assertComplete(scenario): REQUIRED. The scenario's own proof that it reached its end (the
//      exit reason in the op log, the sell mined, the receipt decoded, the rows written);
//   5. only then: serializeTimeline + compareRecording('<name>.jsonl'). A normal run compares and
//      fails on any difference; only the update command writes (serializer.ts, AC-25).
// The cited finding IDs of the tag are checked against the register before any compare (AC-21).
// If the scenario made no submission, serializeTimeline writes the empty-list line itself (AC-22);
// the driver adds nothing of its own to the recording.
//
// Nothing here mocks anything; the harness mocks of harness/setup.ts are the only ones in use.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoViolations } from '../harness/capture';
import { compareRecording, serializeTimeline, tagIds, type CompareResult } from '../harness/serializer';
import type { Submitted } from '../harness/chain';
import { assertNoStrays, createScenario, stepFor, type Scenario, type ScenarioChain, type ScenarioDexType } from '../harness/world';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FINDINGS_DIR = path.join(REPO_ROOT, '.planning', 'audit', 'findings');

/** Every ID a tag cites must exist as a finding in the register (AC-21). Throws naming a missing one. */
export function assertTagInRegister(tag: string): string[] {
    const ids = tagIds(tag);
    const known = new Set(fs.readdirSync(FINDINGS_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length)));
    for (const id of ids) if (!known.has(id)) throw new Error(`runScenario: tag cites ${id}, which is not a finding in .planning/audit/findings/`);
    return ids;
}

export interface ScenarioSpec<D extends ScenarioDexType> {
    /** Lower-case kebab-case; the recording is test/realpath/recordings/<name>.jsonl. */
    name: string;
    /** KEEP or SUSPECT(<finding-id>[,<finding-id>...]) (AC-21, AC-46). */
    tag: string;
    chain: ScenarioChain;
    dexType: D;
    /** Env values applied before the graph loads (createScenario overrides). */
    overrides?: Record<string, string | undefined>;
    /** Drive the real path to the scenario's end. */
    steps(sc: Scenario<D>): Promise<void>;
    /** Prove the scenario finished. Runs before any recording is compared or written. */
    assertComplete(sc: Scenario<D>): void | Promise<void>;
}

export interface ScenarioRun<D extends ScenarioDexType> {
    scenario: Scenario<D>;
    /** The recording text compared (or written by the update command). */
    text: string;
    result: CompareResult;
}

/** One slot of the chain cadence (Ethereum: a block every 12 s). */
export const SLOT_MS = 12_000;

export interface DriveSlotsOptions {
    /** Stop as soon as this holds (checked after every 50 ms step). */
    until: () => boolean;
    what: string;
    /** Bound of the drive in fake time; the driver throws naming `what` when it is reached. */
    maxVirtualMs?: number;
    /** Fake-clock ms of the last block; the next one is mined SLOT_MS later. Default: now. */
    lastBlockAt?: number;
}

/**
 * Drive the chain at the network's cadence until `until()` holds: every SLOT_MS of fake time one
 * block is mined, holding every public transaction of the bot's wallet then pending and, per
 * nonce, the newest bundle transaction of the wallet that targets that block (a bundle lands only
 * in a block it names, as at a real builder; one whose targets have passed is left out). An empty
 * block is mined when nothing waits, so block-driven code (bundle waits, receipt polls, the
 * anti-rug confirm gate) sees the chain move. Fake time only, 50 ms steps, no real event-loop
 * turn and no held call. Returns the fake-clock ms of the last block mined.
 *
 * Why not mine at once: a block mined within ethers' 250 ms request cache of the bot's last
 * eth_blockNumber read makes the bot target a block that is already sealed, a path the real
 * 12 s cadence does not produce.
 */
export async function driveSlots(sc: Scenario, opts: DriveSlotsOptions): Promise<number> {
    const { node } = sc;
    const wallet = sc.wallet.address.toLowerCase();
    const sender = new WeakMap<Submitted, string>();
    const fromWallet = (s: Submitted): boolean => {
        let f = sender.get(s);
        if (f === undefined) {
            // Transaction.from recovers the sender on every read of `from`: read it once.
            f = (s.tx.from ?? '').toLowerCase();
            sender.set(s, f);
        }
        return f === wallet;
    };
    const maxVirtualMs = opts.maxVirtualMs ?? 600_000;
    const end = Date.now() + maxVirtualMs;
    let lastBlockAt = opts.lastBlockAt ?? Date.now();
    while (!opts.until()) {
        if (Date.now() >= end) throw new Error(`driveSlots: ${opts.what} did not happen within ${maxVirtualMs} virtual ms`);
        await stepFor(50, 50);
        if (Date.now() - lastBlockAt < SLOT_MS) continue;
        const next = node.head + 1;
        const waiting = node.submitted.filter((s) => s.status === 'accepted' && fromWallet(s));
        const include = waiting.filter((s) => s.route === 'public').map((s) => s.hash);
        const byNonce = new Map<number, Submitted>();
        for (const s of waiting) if (s.route === 'bundle' && s.targetBlocks.includes(next)) byNonce.set(s.tx.nonce, s);
        include.push(...[...byNonce.values()].sort((a, b) => a.tx.nonce - b.tx.nonce).map((s) => s.hash));
        node.mine({ include });
        lastBlockAt = Date.now();
    }
    return lastBlockAt;
}

/** See the file header. */
export async function runScenario<D extends ScenarioDexType>(spec: ScenarioSpec<D>): Promise<ScenarioRun<D>> {
    if (typeof spec.assertComplete !== 'function') throw new Error(`runScenario ${spec.name}: assertComplete is required`);
    if (typeof spec.steps !== 'function') throw new Error(`runScenario ${spec.name}: steps is required`);
    assertTagInRegister(spec.tag);
    const sc = await createScenario({ chain: spec.chain, dexType: spec.dexType, overrides: spec.overrides });
    await spec.steps(sc);
    assertNoStrays();
    assertNoViolations();
    await spec.assertComplete(sc);
    // The timeline as it stands at the proven end, in recorded order.
    const text = serializeTimeline(sc.timeline.entries.slice(), { scenario: spec.name, tag: spec.tag });
    const result = compareRecording(`${spec.name}.jsonl`, text);
    return { scenario: sc, text, result };
}

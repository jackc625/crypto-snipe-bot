// test/realpath/triage/AUD-ANTIRUG-025.test.ts
// Phase 23 plan 23-06 (found while proving AUD-BUY-001; AUDIT-02): AUD-ANTIRUG-025. After a
// restart, the anti-rug WebSocket subscription for every resumed position is dropped.
//
// At boot, resumeAntiRugMonitoring (src/bot.ts) re-registers each open position (step 3:
// registerAntiRugPosition, which calls startChainAntiRugListener and installs the address filter)
// and then calls startChainAntiRugListener again for the chain (step 4). The second call finds a
// dispatcher already installed and, in src/anti-rug/detector.ts startChainAntiRugListener, calls
// `ctx.wsProvider.off(oldFilter, oldDispatcher)` and then `ctx.wsProvider.on(newFilter,
// newDispatcher)` without awaiting either. The two filters hold the same addresses and topics, so
// ethers gives them the same subscription tag. Both calls are async inside ethers
// (abstract-provider.js on/off): `on` looks the tag up before `off` has deleted it, gets the old
// subscriber, pushes the new dispatcher onto it and starts nothing; `off` then removes the old
// dispatcher, finds no listener left, stops the subscriber (eth_unsubscribe) and deletes the tag.
// The new dispatcher is left on a stopped subscriber, and no eth_subscribe is ever sent. This is
// ethers' own microtask order, with no network in between, so a real node sees the same thing.
//
// Proof on the real path: a real ETH V2 snipe (the AC-01 path) on a temp-file database is armed;
// an LP-token Transfer of the pair to an allowlisted locker is mined and the bot evaluates it
// (op antirug.allowlist-hit, the cheapest observable verdict); the bot is restarted on the same
// file (restartGraph) and the real resumeMultiChainMonitoring and resumeAntiRugMonitoring run;
// once the restart's own eth_unsubscribe has reached the node, a second LP Transfer to another
// allowlisted locker is mined. Measured: whether the node still holds a subscription covering the
// pair, and whether the restarted bot evaluated that second Transfer. Two destinations keep the
// backfill's replay of the first log (AUD-ANTIRUG-005) apart from live delivery.
//
// Fix signal (D-08): awaiting the off() before the on(), or skipping the re-subscribe when the
// address set is unchanged, both read "looks fixed" (fix-shaped src mutations, restored).
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { Interface, Wallet, ethers, parseEther } from 'ethers';
import { recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, createTempDbFile, restartGraph, stepFor, stepUntil, stepUntilTrue, type Scenario } from '../harness/world';

const DEAD = '0x000000000000000000000000000000000000dead';
/** Runtime code for an allowlisted locker: deployed contracts on mainnet, so getCode is non-empty. */
const LOCKER_CODE = '0x608060405234801561001057600080fd5b50600436106100365760003560e01c8063';
const V2_PAIR = new Interface(['function transfer(address to, uint256 value) returns (bool)', 'event Transfer(address indexed from, address indexed to, uint256 value)']);

function opLogged(op: string, from = 0): boolean {
    return recordedLogs().slice(from).some((l) => l.obj?.op === op);
}

function subscribedTo(sc: Scenario, address: string): boolean {
    return sc.node.subscriptions.some((s) => s.kind === 'logs' && JSON.stringify(s.filter).toLowerCase().includes(address.toLowerCase()));
}

/** The allowlist verdicts the bot logged for this trade and destination since `from`. */
function allowlistHits(tradeId: number, destination: string, from = 0): number {
    return recordedLogs()
        .slice(from)
        .filter((l) => l.obj?.op === 'antirug.allowlist-hit' && l.obj.tradeId === tradeId && String(l.obj.destination).toLowerCase() === destination.toLowerCase()).length;
}

describe('AUD-ANTIRUG-025: a restart drops the anti-rug WebSocket subscription of every resumed position', () => {
    it('resume-drops-ws-subscription: after restart and resume, the node holds no subscription for the pair and the restarted bot never sees an LP transfer on it', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', db: { file: createTempDbFile() } });
        const { node, token, pair } = sc;
        // The anti-rug allowlist lockers are deployed contracts (verifyAllowlistAtStartup reads them).
        const lockers = sc.ctx.chain.antiRug.allowlistV2.map((e) => e.address).filter((a) => a.toLowerCase() !== DEAD);
        for (const e of [...sc.ctx.chain.antiRug.allowlistV2, ...sc.ctx.chain.antiRug.allowlistV3]) if (e.address.toLowerCase() !== DEAD) node.setCode(e.address, LOCKER_CODE);
        expect(lockers.length).toBeGreaterThanOrEqual(2);

        // A real snipe, armed (AC-01 path): trades row, exit monitor, anti-rug subscription, cursor at head.
        await sc.graph.bot.startDexListener(sc.ctx, sc.dex, sc.registry);
        await stepUntilTrue(() => subscribedTo(sc, sc.dex.factoryAddress), { what: 'the listener subscribing to PairCreated on the factory' });
        await sc.fireNewPair();
        await stepUntilTrue(() => node.submitted.length === 1, { what: 'the bot submitting its buy bundle' });
        await stepFor(12_000);
        node.mine({ include: [node.submitted[0].hash] });
        const cursor = (): number | undefined => (sc.graph.db.prepare('SELECT last_seen_block AS b FROM chain_state WHERE chain = ?').get('eth') as { b: number } | undefined)?.b;
        await stepUntilTrue(() => opLogged('exit.monitor.started') && subscribedTo(sc, pair) && cursor() === node.head, { what: 'the position being armed' });
        const trade = sc.graph.db.prepare("SELECT id FROM trades WHERE token = ? AND action = 'buy'").get(token.toLowerCase()) as { id: number };

        // An LP holder moves LP tokens to a locker: a real signed pair.transfer, mined with its Transfer log.
        const holder = new Wallet(ethers.id('realpath.aud-antirug-025.lp-holder'));
        node.setBalance(holder.address, parseEther('1'));
        let holderNonce = 0;
        const lpTransferTo = async (locker: string): Promise<void> => {
            const raw = await holder.signTransaction({
                chainId: 1, nonce: holderNonce++, to: pair, value: 0n, gasLimit: 80_000n, type: 2,
                maxFeePerGas: 60_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n,
                data: V2_PAIR.encodeFunctionData('transfer', [locker, 1_000n]),
            });
            const hash = node.addForeignTransaction(raw);
            const log = V2_PAIR.encodeEventLog('Transfer', [holder.address, locker, 1_000n]);
            node.mine({ include: [hash], logs: [{ address: pair, topics: log.topics, data: log.data, transactionHash: hash }] });
        };

        // Control, before the restart: the bot sees the transfer and evaluates it.
        await lpTransferTo(lockers[0]);
        await stepUntilTrue(() => allowlistHits(trade.id, lockers[0]) === 1, { what: 'the running bot evaluating the LP transfer to the first locker' });

        // Restart on the same file, then the real boot resume paths.
        await restartGraph(sc);
        const fromLog = recordedLogs().length;
        const fromCall = node.callLog.length;
        sc.graph.bot.resumeMultiChainMonitoring([sc.ctx]);
        await stepUntil(sc.graph.bot.resumeAntiRugMonitoring([sc.ctx]));
        await stepUntilTrue(() => opLogged('exit.monitor.resumed', fromLog), { what: 'the restarted bot resuming the exit monitor' });
        // Let every request the resume queued reach the node (ethers drains on 10 ms fake timers;
        // five virtual seconds is far beyond it, and holds for the bug and for either fix).
        await stepFor(5_000);

        // A second transfer, to another locker, after the restart.
        const fromHit = recordedLogs().length;
        await lpTransferTo(lockers[1]);
        await stepFor(30_000);

        knownBug(ctx, 'AUD-ANTIRUG-025', {
            claim: 'resume-drops-ws-subscription',
            correct: { subscribedAfterRestart: true, lpTransferSeenAfterRestart: true },
            observed: { subscribedAfterRestart: false, lpTransferSeenAfterRestart: false },
            actual: { subscribedAfterRestart: subscribedTo(sc, pair), lpTransferSeenAfterRestart: allowlistHits(trade.id, lockers[1], fromHit) > 0 },
            expectedPlain: 'After a restart, every resumed position is watched again: the anti-rug WebSocket subscription covers its pair, so LP removal on it is evaluated.',
            actualPlain: 'The restart re-registers the position and logs the subscription installed twice, but the re-subscribe drops it: the node holds no subscription for the pair and an LP transfer on it is never evaluated, until some later buy changes the watched set.',
        });

        // Bug details, after the marker: the position still looks protected in the bot's own state.
        expect(sc.graph.detector.getRegisteredPositions('eth').some((p) => p.tradeId === trade.id && p.pairOrPoolAddress === pair.toLowerCase())).toBe(true);
        expect(sc.graph.exitManager.hasExitMonitorTimer('eth', token)).toBe(true);
        // Step 3 (register) and step 4 (per-chain start) each logged the filter as installed.
        expect(recordedLogs().slice(fromLog).filter((l) => l.obj?.op === 'antirug.listener.subscribed')).toHaveLength(2);
        // One eth_subscribe for the pair after the restart, then its eth_unsubscribe, and nothing after.
        const afterRestart = node.callLog.slice(fromCall).filter((c) => c.endpoint === 'ws' && (c.method === 'eth_subscribe' || c.method === 'eth_unsubscribe'));
        const pairSubscribes = afterRestart.filter((c) => c.method === 'eth_subscribe' && JSON.stringify(c.params).toLowerCase().includes(pair.toLowerCase()));
        expect(pairSubscribes).toHaveLength(1);
        expect(afterRestart.filter((c) => c.method === 'eth_unsubscribe')).toHaveLength(1);
        expect(afterRestart.indexOf(pairSubscribes[0])).toBeLessThan(afterRestart.findIndex((c) => c.method === 'eth_unsubscribe'));
        expect(node.subscriptions.filter((s) => s.kind === 'logs')).toEqual([]);
    });
});

// test/realpath/triage/AUD-BUY-036.test.ts
// Phase 23 plan 23-10 (new finding under the standing instruction; AUDIT-02): AUD-BUY-036, the
// HTTP DEX poller asks for its whole outstanding range in one eth_getLogs, so after an RPC outage
// longer than the provider's log-range limit every poll is refused and the chain's listener stays
// blind to new pairs until the bot restarts, with an error log line as the only signal.
//
// The site (src/bot.ts startHttpPollingListener, the listener of a chain without a WebSocket URL;
// startHttpPollingV3Listener has the same shape): lastBlock is the head when the poller starts;
// every 2 s it calls getBlockNumber, then dexFactory.queryFilter('PairCreated', lastBlock + 1,
// currentBlock) in one request, unchunked; lastBlock advances only after a successful poll, and a
// failed tick only logs "HTTP polling error". So once a gap wider than the provider limit opens
// (an RPC outage while the bot runs), every later query asks for that whole gap and is refused.
// A restart re-seeds lastBlock at the head (which is why this is not AUD-ANTIRUG-018's restart
// case), losing every launch of the gap.
//
// Found while proving AUD-ANTIRUG-018 (the anti-rug HTTP poller's sibling): the same unchunked
// range on the same provider, read in src/bot.ts at the audit base (:1625-1652, V3 :1654-1677)
// and at HEAD (:1627-1654, V3 :1656-1679).
//
// Proof on the real path, with the provider of fixtures/AUD-ANTIRUG-018-range-limit.ts (eth_getLogs
// refused when wider than 10 blocks, Alchemy's free tier; decided per request from its own range):
// an ETH chain without a WebSocket URL, the real HTTP DEX poller. Control first: a real launch while
// the RPC is healthy is found (and stopped at the risk gate). Then an RPC outage while the bot runs: the node refuses
// eth_blockNumber (FakeNode.failNext, -32603 "internal error", as an overloaded endpoint answers)
// for 12 blocks of 12 s; then the RPC is healthy again and the scenario's real launch is mined.
// Measured over 60 s of fake time after the launch: whether the poller found the new pair (the
// handler logs "New pair detected"). MAX_OPEN_POSITIONS=0 stops a found pair at the risk gate,
// so no buy is left in flight either way. The control (its own test) shows the same provider
// limit answering the healthy poller, and shows the limit is live by sending the node one
// over-range and one in-range query.
//
// Fix signal (D-08): a poller that catches up in provider-sized windows (at most the chain's
// backfillCapBlocks per request) reads "looks fixed" (fix-shaped src mutation, restored).
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { toQuantity } from 'ethers';
import { recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepFor, stepUntilTrue, type Scenario } from '../harness/world';
import { stepUntilOrFor } from './fixtures/AUD-API-001-dashboard-sell';
import { FREE_TIER_LOG_RANGE, limitLogRange, logQueriesFor } from './fixtures/AUD-ANTIRUG-018-range-limit';

function logged(msg: string, from = 0): Array<Record<string, unknown> | undefined> {
    return recordedLogs()
        .slice(from)
        .filter((l) => l.msg === msg)
        .map((l) => l.obj);
}

async function httpListener(sc: Scenario<'v2'>): Promise<void> {
    await sc.graph.bot.startDexListener(sc.ctx, sc.dex, sc.registry);
    await stepUntilTrue(() => logged('Listening for PairCreated events via HTTP polling').length === 1, { what: 'the HTTP DEX poller starting' });
}

describe('AUD-BUY-036: the HTTP DEX poller never recovers from an outage longer than the provider log-range limit', () => {
    it('control: with the RPC healthy, the HTTP poller under the same provider limit finds a new pair', async () => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', overrides: { ETH_WS_URL: '', MAX_OPEN_POSITIONS: '0' } });
        limitLogRange(sc.node);
        await httpListener(sc);
        await sc.fireNewPair();
        await stepUntilOrFor(() => logged('New pair detected').length > 0, 60_000);
        expect(logged('New pair detected').map((o) => String(o?.pair).toLowerCase())).toEqual([sc.pair.toLowerCase()]);
        // MAX_OPEN_POSITIONS=0 stops the handler at the risk gate, so no buy is left in flight.
        expect(logged('Risk check failed, skipping snipe')).toHaveLength(1);
        // The limit is live: a 20-block query is refused, a 10-block one answered.
        const query = (span: number): Promise<unknown> =>
            sc.node.handle({ jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [{ address: sc.dex.factoryAddress, fromBlock: toQuantity(sc.node.head - span + 1), toBlock: toQuantity(sc.node.head) }] });
        expect(((await query(20)) as { error?: { code: number } }).error?.code).toBe(-32600);
        expect(Array.isArray(((await query(FREE_TIER_LOG_RANGE)) as { result?: unknown }).result)).toBe(true);
    });

    it('outage-blinds-http-dex-poller: after a 12-block RPC outage while the bot runs, every factory poll is refused and a new pair is never found', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', overrides: { ETH_WS_URL: '', MAX_OPEN_POSITIONS: '0' } });
        const limit = limitLogRange(sc.node);
        await httpListener(sc);
        const startBlock = sc.node.head;

        // The outage: the endpoint refuses eth_blockNumber while 12 blocks are mined.
        let down = true;
        sc.node.failNext('eth_blockNumber', { times: 1_000_000, after: () => down, error: { code: -32603, message: 'internal error' } });
        for (let i = 0; i < 12; i++) {
            await stepFor(12_000);
            sc.node.mine();
        }
        down = false;
        const fromCall = sc.node.callLog.length;
        const fromLog = recordedLogs().length;
        await stepFor(10_000);

        await sc.fireNewPair();
        await stepUntilOrFor(() => logged('New pair detected', fromLog).length > 0, 60_000);

        knownBug(ctx, 'AUD-BUY-036', {
            claim: 'outage-blinds-http-dex-poller',
            correct: { newPairFound: true },
            observed: { newPairFound: false },
            actual: { newPairFound: logged('New pair detected', fromLog).length > 0 },
            expectedPlain: 'After an RPC outage, the HTTP DEX poller catches up the missed blocks in provider-sized requests and finds every new pair.',
            actualPlain: 'After a 12-block RPC outage the poller asked for the whole gap in one eth_getLogs every 2 seconds; the provider refused each request (10-block limit) and a new pair launched after the outage was never found.',
        });
        // Bug details, after the marker: every factory query since the outage started at the
        // pre-outage block + 1 and was wider than the limit, the provider refused each one, and the
        // bot only logged "HTTP polling error".
        const queries = logQueriesFor(sc.node, sc.dex.factoryAddress, fromCall);
        expect(queries.length).toBeGreaterThanOrEqual(30);
        expect(queries.every((q) => q.from === startBlock + 1 && q.span > FREE_TIER_LOG_RANGE)).toBe(true);
        expect(limit.fired).toBeGreaterThanOrEqual(queries.length);
        const errors = logged('HTTP polling error', fromLog);
        expect(errors.length).toBeGreaterThanOrEqual(queries.length);
        expect(errors.every((o) => String((o?.err as Error | undefined)?.message ?? o?.err).includes(`up to a ${FREE_TIER_LOG_RANGE} block range`))).toBe(true);
    });
});

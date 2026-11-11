// test/realpath/harness.test.ts
// Phase 23 plan 23-01 (CHAR-01): the real-path harness proves itself.
//   - The Phase 22 rails are on for the realpath project.
//   - AC-01: one V2 Flashbots buy runs end to end: a real PairCreated log through the real
//     listener, real ethers signing, the simulated node, the real-migration :memory: database,
//     and a submitted transaction that decodes through real ethers to the expected swap call.
//   - AC-03: anything the fake is asked that it does not know (a JSON-RPC method, a contract
//     read, a URL) fails the test by name, a fault or hold that never fired fails the test, a
//     startup that fails part way leaves nothing behind, and a missed seam throws.
// Only the logger, notifier, broadcaster, axios and the Telegram library are mocked
// (harness/setup.ts); the chain is a transport seam (harness/chain.ts).

import * as net from 'node:net';
import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import axios from 'axios';
import { FetchRequest, Interface, JsonRpcProvider, Network, Transaction, WebSocketProvider, parseEther, getAddress } from 'ethers';
import { FakeNode, FakeWebSocket, encodeResult, harnessState, installSeams, labelAddress } from './harness/chain';
import {
    assertAllFaultsFired,
    assertNoStrays,
    createScenario,
    expectStillPending,
    stepFor,
    stepUntil,
    stepUntilTrue,
    useFixedClock,
    type Scenario,
} from './harness/world';

const req = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = req('../rails/core.cjs') as {
    railsStatus(): { installed: boolean; mode: string; project: string; repoRoot: string; netDenyInstalled: boolean };
};

/** The canonical Uniswap V2 router ABI, independent of src/utils/abis.ts. */
const ROUTER = new Interface(['function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)']);

function opLogged(op: string): boolean {
    return harnessState().logs.some((l) => l.obj?.op === op);
}

const ERC20 = new Interface(['function balanceOf(address) view returns (uint256)', 'function totalSupply() view returns (uint256)']);
const BARE_RPC = 'http://realpath-bare.invalid/rpc';
const BARE_WS = 'ws://realpath-bare.invalid/ws';

/**
 * A node with no bot graph, reached through a real ethers JsonRpcProvider on the fixed clock
 * (its 10 ms batch timer is fake). Torn down by the same afterEach as a scenario.
 */
function bareNode(): { node: FakeNode; provider: JsonRpcProvider } {
    const st = harnessState();
    const installedClock = !vi.isFakeTimers();
    useFixedClock();
    installSeams();
    const node = new FakeNode({ chainId: 1 });
    node.serve({ rpc: [BARE_RPC], ws: [BARE_WS] });
    st.node = node;
    st.nodes.push(node);
    // cacheTimeout -1: ethers otherwise answers a repeated identical call from a 250 ms cache, so a
    // fault aimed at the second call would never reach the node.
    const provider = new JsonRpcProvider(BARE_RPC, 1, { staticNetwork: Network.from(1), cacheTimeout: -1 });
    st.disposers.push(async () => {
        node.releaseAll();
        for (let i = 0; i < 50; i++) await Promise.resolve();
        provider.destroy();
        if (st.node === node) st.node = null;
        if (installedClock && vi.isFakeTimers()) vi.useRealTimers();
    });
    return { node, provider };
}

/** Every message an ethers error carries, including the node's own JSON-RPC error. */
function errorText(e: unknown): string {
    const x = e as { message?: string; info?: { error?: { message?: string; code?: number } }; error?: { message?: string; code?: number } };
    return [x?.message, x?.info?.error?.message, x?.error?.message].filter(Boolean).join(' | ');
}

/** Start the real listener and wait for its PairCreated subscription (as AC-01 does). */
async function listen(sc: Scenario): Promise<void> {
    await sc.graph.bot.startDexListener(sc.ctx, sc.dex, sc.registry);
    await stepUntilTrue(
        () => sc.node.subscriptions.some((s) => s.kind === 'logs' && String((s.filter as { address?: string }).address).toLowerCase() === sc.dex.factoryAddress.toLowerCase()),
        { what: 'the listener subscribing to PairCreated on the factory' },
    );
}

/** Mine the accepted buy at its target and wait until the position is armed (as AC-01 does). */
async function mineAndArm(sc: Scenario, target: number): Promise<void> {
    const { node, graph } = sc;
    await stepFor(12_000);
    expect(node.mine({ include: [node.submitted[0].hash] })).toBe(target);
    await stepUntilTrue(() => graph.db.prepare('SELECT 1 FROM trades').get() !== undefined, { what: 'the trades row for the buy' });
    const cursor = (): number | undefined => (graph.db.prepare('SELECT last_seen_block AS b FROM chain_state WHERE chain = ?').get('eth') as { b: number } | undefined)?.b;
    await stepUntilTrue(
        () =>
            opLogged('exit.monitor.started') &&
            node.subscriptions.some((s) => s.kind === 'logs' && JSON.stringify(s.filter).toLowerCase().includes(sc.pair.toLowerCase())) &&
            cursor() === node.head,
        { what: 'the position being armed (exit monitor, anti-rug subscription, block cursor)' },
    );
}

function listeningServers(): number {
    const handles = (process as unknown as { _getActiveHandles(): unknown[] })._getActiveHandles();
    return handles.filter((h) => h instanceof net.Server && h.listening).length;
}

describe('realpath harness', () => {
    it('rails installed in mode full for the realpath project', () => {
        const st = core.railsStatus();
        expect(st.installed).toBe(true);
        expect(st.mode).toBe('full');
        expect(st.project).toBe('realpath');
        expect(st.netDenyInstalled).toBe(true);
    });

    it('AC-01: one V2 Flashbots buy runs end to end on real ethers, the fake node and the real-migration database', async () => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const { node, graph, ctx, dex, token, weth, wallet } = sc;

        // The real database came from the real migrations.
        expect(graph.db.pragma('user_version', { simple: true })).toBe(7);

        await graph.bot.startDexListener(ctx, dex, sc.registry);
        await stepUntilTrue(
            () => node.subscriptions.some((s) => s.kind === 'logs' && String((s.filter as { address?: string }).address).toLowerCase() === dex.factoryAddress.toLowerCase()),
            { what: 'the listener subscribing to PairCreated on the factory' },
        );

        const launch = await sc.fireNewPair();

        await stepUntilTrue(() => node.submitted.length === 1, { what: 'the bot submitting its buy bundle' });
        const buy = node.submitted[0];
        expect(buy.route).toBe('bundle');
        expect(buy.status).toBe('accepted');
        // A relay acceptance changes no count at latest, and the receipt is a valid null.
        expect(node.minedCount(wallet.address)).toBe(0);
        const target = launch.block + 1;
        expect(buy.targetBlocks).toContain(target);

        // One slot passes, then a builder includes the bundle at its target block.
        await stepFor(12_000);
        const mined = node.mine({ include: [buy.hash] });
        expect(mined).toBe(target);
        expect(node.minedCount(wallet.address)).toBe(1);

        const tradeRow = (): { status: string; action: string; token: string; chain: string; tx_hash: string; amount_in: string } | undefined =>
            graph.db.prepare('SELECT status, action, token, chain, tx_hash, amount_in FROM trades').get() as never;
        await stepUntilTrue(() => tradeRow() !== undefined, { what: 'the trades row for the buy' });
        // Let the handler finish arming the position before teardown: the exit monitor started,
        // the pair's anti-rug subscription is on the node, and the anti-rug block cursor reached
        // the head (true on every backfill branch, so this pins no backfill behavior).
        const cursor = (): number | undefined => (graph.db.prepare('SELECT last_seen_block AS b FROM chain_state WHERE chain = ?').get('eth') as { b: number } | undefined)?.b;
        await stepUntilTrue(
            () =>
                opLogged('exit.monitor.started') &&
                node.subscriptions.some((s) => s.kind === 'logs' && JSON.stringify(s.filter).toLowerCase().includes(sc.pair.toLowerCase())) &&
                cursor() === node.head,
            { what: 'the position being armed (exit monitor, anti-rug subscription, block cursor)' },
        );

        // The submitted transaction, decoded with real ethers.
        const tx = Transaction.from(buy.raw);
        expect(tx.hash).toBe(buy.hash);
        expect(getAddress(tx.to!)).toBe(getAddress(dex.routerAddress));
        expect(tx.value).toBe(parseEther(ctx.chain.snipeAmount));
        expect(tx.chainId).toBe(1n);
        expect(getAddress(tx.from!)).toBe(getAddress(wallet.address));
        const call = ROUTER.parseTransaction({ data: tx.data, value: tx.value });
        expect(call?.name).toBe('swapExactETHForTokens');
        expect((call!.args[1] as string[]).map((a) => getAddress(a))).toEqual([getAddress(weth), getAddress(token)]);
        expect(getAddress(call!.args[2] as string)).toBe(getAddress(wallet.address));

        // The trades row, read from the real connection.
        const row = tradeRow()!;
        expect(row.status).toBe('pending');
        expect(row.action).toBe('buy');
        expect(row.token).toBe(token.toLowerCase());
        expect(row.chain).toBe('eth');
        expect(row.tx_hash).toBe(buy.hash);
    });

    it('AC-03: an unknown JSON-RPC method fails the test by name, even when the caller swallows the error', async () => {
        const { node, provider } = bareNode();
        let swallowed: unknown;
        // A caller with its own catch, as src/ has many (E3c): the returned error alone is not enough.
        await stepUntil(provider.send('eth_frobnicate', ['0x1']).catch((e: unknown) => (swallowed = e)));
        expect((swallowed as { code?: string }).code).toBe('UNSUPPORTED_OPERATION');
        expect((swallowed as { info?: { error?: { code?: number } } }).info?.error?.code).toBe(-32601);
        expect(errorText(swallowed)).toContain('eth_frobnicate');
        expect(node.strays.map((s) => s.kind)).toEqual(['method']);
        expect(() => assertNoStrays()).toThrow(/stray call: unknown JSON-RPC method "eth_frobnicate"/);
        node.strays.length = 0;
    });

    it('AC-03: an unknown contract read fails the test naming its selector and target, and reverts like a real node', async () => {
        const { node, provider } = bareNode();
        const token = labelAddress('ac03.unknown-read');
        const data = ERC20.encodeFunctionData('totalSupply', []);
        const err = await stepUntil(provider.call({ to: token, data })).then(
            () => null,
            (e: unknown) => e,
        );
        expect((err as { code?: string }).code).toBe('CALL_EXCEPTION');
        expect(node.strays).toHaveLength(1);
        expect(() => assertNoStrays()).toThrow(new RegExp(`unknown contract read ${data.slice(0, 10)} on ${token.toLowerCase()}`));
        node.strays.length = 0;
    });

    it('AC-03: an unknown URL fails the test by name on axios, on ethers FetchRequest and on a WebSocket connect', async () => {
        const { node } = bareNode();
        await expect(axios.get('https://api.not-routed.invalid/v1/thing')).rejects.toThrow(/no route for GET https:\/\/api\.not-routed\.invalid\/v1\/thing/);
        expect(() => assertNoStrays()).toThrow(/unknown URL https:\/\/api\.not-routed\.invalid\/v1\/thing \(axios GET\)/);
        node.strays.length = 0;

        const resp = await stepUntil(new FetchRequest('http://unknown-rpc.invalid/').send());
        expect(resp.statusCode).toBe(404);
        expect(() => assertNoStrays()).toThrow(/unknown URL http:\/\/unknown-rpc\.invalid\/ \(FetchRequest/);
        node.strays.length = 0;

        const ws = new FakeWebSocket('ws://unknown-ws.invalid/');
        const closed = new Promise<number>((resolve) => ws.once('close', (code: number) => resolve(code)));
        expect(await closed).toBe(1006);
        expect(() => assertNoStrays()).toThrow(/unknown URL ws:\/\/unknown-ws\.invalid\/ \(WebSocket connect\)/);
        node.strays.length = 0;
    });

    it('AC-03: a fault names its exact operation, does not fire before its stage, and an unfired fault or hold fails the test', async () => {
        const { node, provider } = bareNode();
        const token = labelAddress('ac03.fault.token');
        const other = labelAddress('ac03.fault.other');
        const holder = labelAddress('ac03.fault.holder');
        for (const a of [token, other]) {
            node.setRead(a, 'balanceOf(address)', encodeResult(['uint256'], [123n]));
            node.setRead(a, 'totalSupply()', encodeResult(['uint256'], [1000n]));
        }
        const balanceOf = ERC20.encodeFunctionData('balanceOf', [holder]);
        const totalSupply = ERC20.encodeFunctionData('totalSupply', []);

        // A match that could never fire is refused when it is armed, by name.
        expect(() => node.failNext('eth_blockNumber', { selector: 'balanceOf(address)' })).toThrow(/selector applies only to eth_call, eth_estimateGas/);

        let reached = false;
        const fault = node.failNext('eth_call', { selector: 'balanceOf(address)', to: token, after: () => reached });
        expect(fault.fired).toBe(0);

        // Before the stage: the same call passes, and the fault is reported as never fired.
        expect(await stepUntil(provider.call({ to: token, data: balanceOf }))).toBe(encodeResult(['uint256'], [123n]));
        expect(fault.fired).toBe(0);
        expect(() => assertAllFaultsFired()).toThrow(/a fault never fired: failNext\("eth_call", selector balanceOf\(address\) \(0x70a08231\), to 0x[0-9a-f]{40}, after <predicate>, times 1\): fired 0 of 1/);

        // At the stage: another selector and another target are not hit; the named one is, once.
        reached = true;
        expect(await stepUntil(provider.call({ to: token, data: totalSupply }))).toBe(encodeResult(['uint256'], [1000n]));
        expect(await stepUntil(provider.call({ to: other, data: balanceOf }))).toBe(encodeResult(['uint256'], [123n]));
        expect(fault.fired).toBe(0);
        const err = await stepUntil(provider.call({ to: token, data: balanceOf })).then(
            () => null,
            (e: unknown) => e,
        );
        expect(errorText(err)).toContain('realpath harness: injected fault on eth_call');
        expect(fault.fired).toBe(1);
        expect(await stepUntil(provider.call({ to: token, data: balanceOf }))).toBe(encodeResult(['uint256'], [123n]));
        expect(fault.fired).toBe(1);
        expect(() => assertAllFaultsFired()).not.toThrow();

        // A hold that never parked a call is reported the same way, until it fires.
        const hold = node.hold('eth_getCode', { to: token });
        expect(() => assertAllFaultsFired()).toThrow(/a hold never fired: hold\("eth_getCode", to 0x[0-9a-f]{40}\): held 0 call\(s\)/);
        const code = provider.getCode(token);
        await stepUntilTrue(() => hold.parkedNow === 1, { what: 'eth_getCode being parked' });
        await expectStillPending(code, 5_000, { what: 'the held eth_getCode' });
        hold.release();
        expect(await stepUntil(code)).toBe('0x');
        expect(hold.heldCount).toBe(1);
        expect(() => assertAllFaultsFired()).not.toThrow();
        expect(node.strays).toEqual([]);
    });

    it('AC-03: callLog holds the raw params, calldata, selector, target and block tag of a real read', async () => {
        const { node, provider } = bareNode();
        const token = labelAddress('ac03.calllog.token');
        const holder = labelAddress('ac03.calllog.holder');
        node.setRead(token, 'balanceOf(address)', ({ args }) => encodeResult(['uint256'], [String(args[0]).toLowerCase() === holder.toLowerCase() ? 77n : 0n]));
        const data = ERC20.encodeFunctionData('balanceOf', [holder]);
        expect(await stepUntil(provider.call({ to: token, data, blockTag: 'latest' }))).toBe(encodeResult(['uint256'], [77n]));

        const calls = node.callLog.filter((c) => c.method === 'eth_call');
        expect(calls).toHaveLength(1);
        const entry = calls[0];
        expect(entry.endpoint).toBe('rpc');
        expect(entry.url).toBe(BARE_RPC);
        expect(entry.to).toBe(token.toLowerCase());
        expect(entry.data).toBe(data);
        expect(entry.selector).toBe(data.slice(0, 10));
        expect(entry.blockTag).toBe('latest');
        const params = entry.params as [{ to: string; data: string }, string];
        expect(Array.isArray(params)).toBe(true);
        expect(getAddress(params[0].to)).toBe(getAddress(token));
        expect(params[0].data).toBe(data);
        expect(params[1]).toBe('latest');
        // The calldata is the real encoding: it decodes back to the holder.
        expect(getAddress(ERC20.decodeFunctionData('balanceOf', entry.data!)[0] as string)).toBe(getAddress(holder));
    });

    it('AC-03: hold on eth_sendBundle parks the bot\'s relay call until release, then the buy goes through', async () => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        const { node } = sc;
        const hold = node.hold('eth_sendBundle');
        await listen(sc);
        const launch = await sc.fireNewPair();

        await stepUntilTrue(() => hold.parkedNow === 1, { what: 'the bot\'s first eth_sendBundle being parked' });
        // The call arrived (logged and on the relay record) but the node has not answered it.
        const parkedCall = node.relay.filter((r) => r.method === 'eth_sendBundle');
        expect(parkedCall).toHaveLength(1);
        expect(parkedCall[0].url).toBe(sc.ctx.chain.mevConfig.relayUrl);
        expect(node.submitted).toHaveLength(0);
        // It stays parked while virtual time passes.
        await stepFor(500);
        expect(hold.parkedNow).toBe(1);
        expect(node.submitted).toHaveLength(0);
        expect(node.relay.filter((r) => r.method === 'eth_sendBundle')).toHaveLength(1);

        hold.release();
        await stepUntilTrue(() => node.submitted.length === 1, { what: 'the released bundle being accepted' });
        expect(hold.heldCount).toBe(1);
        // The quote the buy was sized from is in the call log with its real calldata.
        const quote = node.callLog.find((c) => c.method === 'eth_call' && c.to === sc.dex.routerAddress.toLowerCase() && c.selector === '0xd06ca61f');
        expect(quote?.data).toBeDefined();
        await mineAndArm(sc, launch.block + 1);
    });

    it('AC-03: a startup that fails part way leaves no port, no socket, no clock and no environment change behind', async () => {
        const wsModule = createRequire(req.resolve('ethers'))('ws') as { WebSocket: unknown };
        for (const stage of ['graph', 'context'] as const) {
            const envBefore = { ...process.env };
            const serversBefore = listeningServers();
            expect(vi.isFakeTimers()).toBe(false);
            await expect(createScenario({ chain: 'eth', dexType: 'v2', overrides: { REALPATH_STARTUP_PROBE: stage, MEV_BUY_TARGET_BLOCKS: '2' }, failAfter: stage })).rejects.toThrow(
                `createScenario: injected failure after the ${stage === 'graph' ? 'graph loaded' : 'chain context was built'}`,
            );
            const st = harnessState();
            const node = st.nodes[st.nodes.length - 1];
            expect({ ...process.env }).toEqual(envBefore);
            expect(process.env.REALPATH_STARTUP_PROBE).toBeUndefined();
            expect(listeningServers()).toBe(serversBefore);
            expect(vi.isFakeTimers()).toBe(false);
            expect(FakeWebSocket.instances).toHaveLength(0);
            expect(node.openSocketCount).toBe(0);
            expect(st.node).toBeNull();
            expect(st.disposers).toHaveLength(1);
            // The seam is still the one this worker installed.
            expect(wsModule.WebSocket).toBe(FakeWebSocket);
            if (stage === 'context') {
                // The context's real ethers WebSocketProvider had a live socket on the node before failing.
                expect(node.socketsOpened).toBeGreaterThan(0);
            }
            // Disposing again is a no-op: the disposer is idempotent.
            await st.disposers.pop()!();
        }
    });

    it('seam self-check: installSeams throws when its WebSocket swap does not reach ethers', () => {
        installSeams();
        class NotTheEthersWs {}
        const wrong: { WebSocket: unknown } = { WebSocket: NotTheEthersWs };
        expect(() => installSeams({ wsExports: wrong })).toThrow(/did not reach/);
        // The wrong target is left as it was, and the real swap is untouched.
        expect(wrong.WebSocket).toBe(NotTheEthersWs);
        expect((createRequire(req.resolve('ethers'))('ws') as { WebSocket: unknown }).WebSocket).toBe(FakeWebSocket);
        // And ethers still constructs the fake.
        const st = harnessState();
        const node = new FakeNode({ chainId: 1 });
        node.serve({ ws: [BARE_WS] });
        st.node = node;
        st.nodes.push(node);
        const p = new WebSocketProvider(BARE_WS, 1);
        expect(p.websocket).toBeInstanceOf(FakeWebSocket);
        void p.destroy();
        FakeWebSocket.instances.length = 0;
    });

    it('expectStillPending passes on a promise that never settles and fails on one that settles in the window', async () => {
        bareNode();
        await expectStillPending(new Promise(() => {}), 60_000, { what: 'a promise that never settles' });

        const resolves = new Promise<string>((resolve) => setTimeout(() => resolve('done'), 1_500));
        await expect(expectStillPending(resolves, 5_000, { what: 'a timer-resolved promise' })).rejects.toThrow(
            /expectStillPending: a timer-resolved promise settled \(resolved\) after 1500 of 5000 virtual ms: "done"/,
        );
        const rejects = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('boom')), 200));
        await expect(expectStillPending(rejects, 1_000)).rejects.toThrow(/settled \(rejected\) after 200 of 1000 virtual ms: Error: boom/);
        await expect(expectStillPending(Promise.resolve(1), 1_000)).rejects.toThrow(/settled \(resolved\) after 0 of 1000/);
        // A promise that settles only after the window is still pending inside it.
        const late = new Promise((resolve) => setTimeout(resolve, 2_000));
        await expectStillPending(late, 1_000);
        await stepUntil(late);
    });
});

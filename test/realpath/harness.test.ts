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
import { FetchRequest, Interface, JsonRpcProvider, Network, Transaction, WebSocketProvider, Wallet, ethers, parseEther, parseUnits, getAddress, toQuantity } from 'ethers';
import { FlashbotsBundleProvider } from '@flashbots/ethers-provider-bundle';
import { FakeNode, FakeWebSocket, encodeResult, harnessState, installSeams, labelAddress } from './harness/chain';
import { decodeReceipt } from '../../src/utils/receiptDecoder';
import { recordedAlerts } from './harness/capture';
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

// ---------------------------------------------------------------------------------------------
// Plan 23-28 Task 1 (D-03, AC-48): the public route's whole transaction life on the node.
// ---------------------------------------------------------------------------------------------

const GWEI = 1_000_000_000n;
const SENDER = new Wallet(ethers.id('realpath.23-28.sender'));
const RECIPIENT = labelAddress('23-28.recipient');
const RELAY = 'https://relay.realpath.invalid/';

interface SignOpts {
    nonce: number;
    chainId?: number;
    maxFeeGwei?: bigint;
    tipGwei?: bigint;
    /** Sign a type-0 transaction with this gas price instead of EIP-1559 fields. */
    gasPriceGwei?: bigint;
    gasLimit?: bigint;
    value?: bigint;
    data?: string;
}

/** A real signed transaction from SENDER (real ethers signing, real serialization, real hash). */
function signed(o: SignOpts): Promise<string> {
    const base = { chainId: o.chainId ?? 1, nonce: o.nonce, to: RECIPIENT, value: o.value ?? parseEther('0.01'), gasLimit: o.gasLimit ?? 21_000n, data: o.data ?? '0x' };
    if (o.gasPriceGwei !== undefined) return SENDER.signTransaction({ ...base, type: 0, gasPrice: o.gasPriceGwei * GWEI });
    return SENDER.signTransaction({ ...base, type: 2, maxFeePerGas: (o.maxFeeGwei ?? 30n) * GWEI, maxPriorityFeePerGas: (o.tipGwei ?? 2n) * GWEI });
}

/** Broadcast through the real provider; resolves to the hash or to the refusal. */
async function broadcast(provider: JsonRpcProvider, raw: string): Promise<{ hash?: string; err?: unknown }> {
    return stepUntil(provider.broadcastTransaction(raw)).then(
        (r) => ({ hash: r.hash }),
        (err: unknown) => ({ err }),
    );
}

async function counts(provider: JsonRpcProvider, who: string): Promise<{ latest: number; pending: number }> {
    return { latest: await stepUntil(provider.getTransactionCount(who, 'latest')), pending: await stepUntil(provider.getTransactionCount(who, 'pending')) };
}

/** A relay eth_sendBundle as the bot's Flashbots library sends it (via the relay endpoint). */
async function sendBundle(node: FakeNode, raws: string[], target: number): Promise<unknown> {
    node.serve({ relay: [RELAY] });
    return node.handle({ jsonrpc: '2.0', id: 1, method: 'eth_sendBundle', params: [{ txs: raws, blockNumber: toQuantity(target) }] }, undefined, { endpoint: 'relay', url: RELAY });
}

describe('simulated node: the public route (23-28 Task 1, D-03, AC-48)', () => {
    it('tracer: a real signed public transaction is accepted, stays pending, and becomes visible only by being mined, with a real receipt', async () => {
        const { node, provider } = bareNode();
        const wallet = SENDER.connect(provider);
        node.setBalance(wallet.address, parseEther('1'));

        expect(await counts(provider, wallet.address)).toEqual({ latest: 0, pending: 0 });
        // Real ethers populates (pending count, estimate, fee data, chain) and signs.
        const sent = await stepUntil(wallet.sendTransaction({ to: RECIPIENT, value: parseEther('0.1') }));
        expect(sent.hash).toBe(ethers.keccak256(node.submitted[0].raw));
        expect(node.submitted).toHaveLength(1);
        expect(node.submitted[0]).toMatchObject({ route: 'public', status: 'accepted', block: null });

        // Accepted is not mined: latest is unchanged, pending has risen, the receipt is a valid null.
        expect(await counts(provider, wallet.address)).toEqual({ latest: 0, pending: 1 });
        expect(await stepUntil(provider.getTransactionReceipt(sent.hash))).toBeNull();
        const seen = await stepUntil(provider.getTransaction(sent.hash));
        expect(seen?.blockNumber).toBeNull();

        // Virtual time alone mines nothing.
        const waiting = sent.wait();
        await stepFor(30_000);
        expect(node.isMined(sent.hash)).toBe(false);

        const block = node.mine();
        const receipt = await stepUntil(waiting);
        expect(receipt?.status).toBe(1);
        expect(receipt?.hash).toBe(sent.hash);
        expect(receipt?.blockNumber).toBe(block);
        expect(receipt?.from).toBe(wallet.address);
        expect(await counts(provider, wallet.address)).toEqual({ latest: 1, pending: 1 });
        expect(node.submitted[0]).toMatchObject({ status: 'mined', block });
        expect(node.history.filter((h) => h.hash === sent.hash).map((h) => h.event)).toEqual(['accepted', 'mined']);
        // The sender paid for the gas it used and the value it sent.
        const spent = receipt!.gasUsed * receipt!.gasPrice + parseEther('0.1');
        expect(await stepUntil(provider.getBalance(wallet.address))).toBe(parseEther('1') - spent);
    });

    it('refuses a wrong chain ID, a nonce too low, short gas and missing funds with the real node text, and none grows node.submitted', async () => {
        const { node, provider } = bareNode();
        node.setBalance(SENDER.address, parseEther('1'));
        const first = await broadcast(provider, await signed({ nonce: 0 }));
        expect(first.hash).toBeDefined();
        node.mine();
        expect(node.submitted).toHaveLength(1);

        const cases: Array<[SignOpts, RegExp]> = [
            [{ nonce: 1, chainId: 5 }, /invalid sender: invalid chain id for signer: have 5 want 1/],
            [{ nonce: 0 }, /nonce too low: next nonce 1, tx nonce 0/],
            [{ nonce: 1, gasLimit: 20_000n }, /intrinsic gas too low: gas 20000, minimum needed 21000/],
            [{ nonce: 1, value: parseEther('5') }, /insufficient funds for gas \* price \+ value: balance \d+, tx cost \d+, overshot \d+/],
        ];
        for (const [opts, text] of cases) {
            const r = await broadcast(provider, await signed(opts));
            expect(r.hash, `${String(text)} was accepted`).toBeUndefined();
            expect(errorText(r.err)).toMatch(text);
        }
        expect(node.submitted).toHaveLength(1);
        expect(node.history.map((h) => h.event)).toEqual(['accepted', 'mined']);
        expect(await counts(provider, SENDER.address)).toEqual({ latest: 1, pending: 1 });
        // ethers maps the nonce refusal to its own code, as it would on a real node.
        const low = await broadcast(provider, await signed({ nonce: 0 }));
        expect((low.err as { code?: string }).code).toBe('NONCE_EXPIRED');
    });

    it('a same-nonce replacement needs a 10 percent bump on both fees: below it is refused with the real text, at it the old hash becomes replaced', async () => {
        const { node, provider } = bareNode();
        node.setBalance(SENDER.address, parseEther('1'));
        const original = await broadcast(provider, await signed({ nonce: 0, maxFeeGwei: 100n, tipGwei: 10n }));
        expect(original.hash).toBeDefined();
        // Each misses on one field only: the cap up 9 percent (tip up 10), then the tip unchanged (cap up 10).
        for (const fees of [{ maxFeeGwei: 109n, tipGwei: 11n }, { maxFeeGwei: 110n, tipGwei: 10n }]) {
            const r = await broadcast(provider, await signed({ nonce: 0, value: parseEther('0.02'), ...fees }));
            expect(errorText(r.err)).toContain('replacement transaction underpriced');
            expect((r.err as { code?: string }).code).toBe('REPLACEMENT_UNDERPRICED');
        }
        expect(node.submitted).toHaveLength(1);
        // Exactly 10 percent on both: accepted, and the original leaves the pool.
        const replacement = await broadcast(provider, await signed({ nonce: 0, value: parseEther('0.02'), maxFeeGwei: 110n, tipGwei: 11n }));
        expect(replacement.hash).toBeDefined();
        expect(node.statusOf(original.hash!)).toBe('replaced');
        expect(node.history.find((h) => h.event === 'replaced')).toMatchObject({ hash: original.hash, by: replacement.hash });
        expect(await stepUntil(provider.getTransaction(original.hash!))).toBeNull();
        expect(await counts(provider, SENDER.address)).toEqual({ latest: 0, pending: 1 });

        node.mine();
        expect(node.isMined(replacement.hash!)).toBe(true);
        expect(await stepUntil(provider.getTransactionReceipt(original.hash!))).toBeNull();
        expect(node.history.filter((h) => h.hash === original.hash).map((h) => h.event)).toEqual(['accepted', 'replaced']);
    });

    it('a relay acceptance moves neither count, stays invisible, and is never mined by default', async () => {
        const { node, provider } = bareNode();
        node.setBalance(SENDER.address, parseEther('1'));
        const raw = await signed({ nonce: 0 });
        const target = node.head + 1;
        const reply = (await sendBundle(node, [raw], target)) as { result?: { bundleHash?: string } };
        expect(reply.result?.bundleHash).toMatch(/^0x[0-9a-f]{64}$/);
        const hash = ethers.keccak256(raw);
        expect(node.submitted).toMatchObject([{ hash, route: 'bundle', status: 'accepted', targetBlocks: [target] }]);
        const bloxHash = node.acceptRelayTransaction(await signed({ nonce: 1 }), 'bloxroute');
        expect(node.submitted[1]).toMatchObject({ hash: bloxHash, route: 'bloxroute', status: 'accepted', targetBlocks: [] });

        expect(await counts(provider, SENDER.address)).toEqual({ latest: 0, pending: 0 });
        expect(await stepUntil(provider.getTransaction(hash))).toBeNull();
        expect(await stepUntil(provider.getTransactionReceipt(hash))).toBeNull();
        expect(await stepUntil(provider.getTransaction(bloxHash))).toBeNull();
        // A default block takes only the public pool.
        node.mine();
        expect(node.isMined(hash)).toBe(false);
        expect(node.isMined(bloxHash)).toBe(false);
        expect(await counts(provider, SENDER.address)).toEqual({ latest: 0, pending: 0 });
        // A bundle can only go in its target block; the next one is past it.
        expect(() => node.mine({ include: [hash] })).toThrow(/targets blocks \d+, not \d+/);
    });

    it('of two transactions competing for one nonce the one mined wins and the other is dropped, with a receipt only for the winner', async () => {
        const { node, provider } = bareNode();
        node.setBalance(SENDER.address, parseEther('1'));
        const target = node.head + 1;
        const bundleRaw = await signed({ nonce: 0, gasLimit: 21_016n, data: '0x01' });
        await sendBundle(node, [bundleRaw], target);
        const first = ethers.keccak256(bundleRaw);
        const competitor = await broadcast(provider, await signed({ nonce: 0, gasLimit: 21_016n, data: '0x02' }));
        expect(competitor.hash).toBeDefined();
        expect(await counts(provider, SENDER.address)).toEqual({ latest: 0, pending: 1 });

        expect(node.mine({ include: [first] })).toBe(target);
        expect(node.statusOf(first)).toBe('mined');
        expect(node.statusOf(competitor.hash!)).toBe('dropped');
        expect(node.history.find((h) => h.event === 'dropped')).toMatchObject({ hash: competitor.hash, by: first, block: target });
        expect((await stepUntil(provider.getTransactionReceipt(first)))?.status).toBe(1);
        expect(await stepUntil(provider.getTransactionReceipt(competitor.hash!))).toBeNull();
        expect(await stepUntil(provider.getTransaction(competitor.hash!))).toBeNull();
        expect(await counts(provider, SENDER.address)).toEqual({ latest: 1, pending: 1 });
        expect(() => node.mine({ include: [competitor.hash!] })).toThrow(/it is dropped/);
    });

    it('neverMine keeps a hash out of every block while later blocks mine; exclude leaves one out of one block only', async () => {
        const { node, provider } = bareNode();
        node.setBalance(SENDER.address, parseEther('1'));
        const stuck = await broadcast(provider, await signed({ nonce: 0 }));
        node.neverMine(stuck.hash!);
        const head = node.head;
        node.mine();
        node.mine();
        expect(node.head).toBe(head + 2);
        expect(await stepUntil(provider.getTransactionReceipt(stuck.hash!))).toBeNull();
        expect(node.statusOf(stuck.hash!)).toBe('accepted');
        expect(await counts(provider, SENDER.address)).toEqual({ latest: 0, pending: 1 });
        expect(() => node.mine({ include: [stuck.hash!] })).toThrow(/under neverMine/);
        expect(() => node.neverMine('0x' + 'ab'.repeat(32))).toThrow(/never accepted/);

        const other = new Wallet(ethers.id('realpath.23-28.other'), provider);
        node.setBalance(other.address, parseEther('1'));
        const later = await stepUntil(other.sendTransaction({ to: RECIPIENT, value: 1n }));
        node.mine({ exclude: [later.hash] });
        expect(node.isMined(later.hash)).toBe(false);
        node.mine();
        expect(node.isMined(later.hash)).toBe(true);
        expect(node.isMined(stuck.hash!)).toBe(false);
    });

    it("a future nonce stays queued until its gap fills; under setFutureNoncePolicy('reject') it is refused with nonce too high", async () => {
        const { node, provider } = bareNode();
        node.setBalance(SENDER.address, parseEther('1'));
        const ahead = await broadcast(provider, await signed({ nonce: 1 }));
        expect(node.statusOf(ahead.hash!)).toBe('queued');
        expect(await counts(provider, SENDER.address)).toEqual({ latest: 0, pending: 0 });
        node.mine();
        expect(node.isMined(ahead.hash!)).toBe(false);
        expect(() => node.mine({ include: [ahead.hash!] })).toThrow(/it is queued/);

        const gap = await broadcast(provider, await signed({ nonce: 0 }));
        expect(node.statusOf(ahead.hash!)).toBe('accepted');
        expect(await counts(provider, SENDER.address)).toEqual({ latest: 0, pending: 2 });
        const block = node.mine();
        expect((await stepUntil(provider.getTransactionReceipt(gap.hash!)))?.index).toBe(0);
        const aheadReceipt = await stepUntil(provider.getTransactionReceipt(ahead.hash!));
        expect(aheadReceipt?.index).toBe(1);
        expect(aheadReceipt?.blockNumber).toBe(block);
        expect(node.history.filter((h) => h.hash === ahead.hash).map((h) => h.event)).toEqual(['queued', 'promoted', 'mined']);

        node.setFutureNoncePolicy('reject');
        const refused = await broadcast(provider, await signed({ nonce: 5 }));
        expect(errorText(refused.err)).toContain('nonce too high: next nonce 2, tx nonce 5');
        expect(node.submitted).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------------------------
// Plan 23-28 Task 2 (AC-48): fee answers, stored logs, subscription filtering and receipt logs.
// ---------------------------------------------------------------------------------------------

const EMITTER_A = labelAddress('23-28.emitter.a');
const EMITTER_B = labelAddress('23-28.emitter.b');
const EMITTER_C = labelAddress('23-28.emitter.c');
const EVENTS = new Interface(['event Ping(address indexed who, uint256 n)', 'event Pong(address indexed who, uint256 n)', 'event Other(address indexed who, uint256 n)']);

function eventLog(address: string, name: 'Ping' | 'Pong' | 'Other', n: bigint): { address: string; topics: string[]; data: string } {
    const e = EVENTS.encodeEventLog(name, [SENDER.address, n]);
    return { address, topics: e.topics, data: e.data };
}

/** A real WebSocketProvider on the bare node, destroyed by the afterEach disposers. */
function bareWs(): WebSocketProvider {
    const ws = new WebSocketProvider(BARE_WS, 1);
    harnessState().disposers.push(async () => {
        await ws.destroy();
        FakeWebSocket.instances.length = 0;
    });
    return ws;
}

describe('simulated node: fees, logs and receipts (23-28 Task 2, AC-48)', () => {
    it('a legacy fee node: real getFeeData gives a null maxFeePerGas and the set gasPrice, blocks carry no baseFeePerGas, and no stray is recorded', async () => {
        const { node, provider } = bareNode();
        node.setFees({ legacy: true, gasPrice: 7n * GWEI });
        const fee = await stepUntil(provider.getFeeData());
        expect(fee.maxFeePerGas).toBeNull();
        expect(fee.maxPriorityFeePerGas).toBeNull();
        expect(fee.gasPrice).toBe(7n * GWEI);
        expect((await stepUntil(provider.getBlock('latest')))?.baseFeePerGas).toBeNull();
        const rawBlock = (await stepUntil(provider.send('eth_getBlockByNumber', ['latest', false]))) as Record<string, unknown>;
        for (const field of ['baseFeePerGas', 'withdrawalsRoot', 'withdrawals', 'blobGasUsed', 'parentBeaconBlockRoot']) expect(rawBlock).not.toHaveProperty(field);
        // The method a legacy node does not serve: geth's own answer, which is not a stray.
        const tip = await stepUntil(provider.send('eth_maxPriorityFeePerGas', []).then(() => null, (e: unknown) => e));
        expect((tip as { error?: { code?: number } }).error?.code ?? (tip as { info?: { error?: { code?: number } } }).info?.error?.code).toBe(-32601);
        expect(errorText(tip)).toContain('the method eth_maxPriorityFeePerGas does not exist/is not available');
        expect(node.strays).toEqual([]);

        // Settings persist until changed; a type-2 transaction is refused; a type-0 one mines at its gasPrice.
        node.setFees({ estimateGas: 90_000n });
        expect(await stepUntil(provider.estimateGas({ to: RECIPIENT }))).toBe(90_000n);
        expect((await stepUntil(provider.getFeeData())).gasPrice).toBe(7n * GWEI);
        node.setBalance(SENDER.address, parseEther('1'));
        const eip1559 = await broadcast(provider, await signed({ nonce: 0 }));
        expect(errorText(eip1559.err)).toContain('transaction type not supported');
        const legacyTx = await broadcast(provider, await signed({ nonce: 0, gasPriceGwei: 7n }));
        node.mine();
        expect((await stepUntil(provider.getTransactionReceipt(legacyTx.hash!)))?.gasPrice).toBe(7n * GWEI);
        expect(() => node.mine({ baseFeePerGas: 1n })).toThrow(/legacy chain .* has no base fee/);
        expect(() => node.setFees({ gasPrice: -1n })).toThrow(/non-negative bigint/);
    });

    it('a type-0 same-nonce replacement needs the 10 percent bump on gasPrice, on a legacy node and on an EIP-1559 node alike', async () => {
        const { node, provider } = bareNode();
        node.setBalance(SENDER.address, parseEther('1'));
        for (const legacy of [true, false]) {
            node.setFees({ legacy });
            const nonce = node.minedCount(SENDER.address);
            const first = await broadcast(provider, await signed({ nonce, gasPriceGwei: 100n }));
            expect(first.hash).toBeDefined();
            const under = await broadcast(provider, await signed({ nonce, gasPriceGwei: 109n, value: 2n }));
            expect(errorText(under.err)).toContain('replacement transaction underpriced');
            const bumped = await broadcast(provider, await signed({ nonce, gasPriceGwei: 110n, value: 2n }));
            expect(bumped.hash).toBeDefined();
            expect(node.statusOf(first.hash!)).toBe('replaced');
            node.mine();
            expect(node.isMined(bumped.hash!)).toBe(true);
        }
    });

    it('a log placed by mine({ logs }) and one placed by emitLogs each come back from a real queryFilter over their block and not over another', async () => {
        const { node, provider } = bareNode();
        node.setBalance(SENDER.address, parseEther('1'));
        expect(() => node.mine({ logs: [eventLog(EMITTER_A, 'Ping', 0n)] })).toThrow(/names no transactionHash and block \d+ holds 0 transactions/);
        const before = node.head;

        const tx1 = await broadcast(provider, await signed({ nonce: 0 }));
        const b1 = node.mine({ logs: [eventLog(EMITTER_A, 'Ping', 1n)] });
        const tx2 = await broadcast(provider, await signed({ nonce: 1 }));
        const b2 = node.mine();
        node.emitLogs([eventLog(EMITTER_A, 'Ping', 2n)]);
        expect(node.head).toBe(before + 2);

        const contract = new ethers.Contract(EMITTER_A, EVENTS, provider);
        const inB1 = (await stepUntil(contract.queryFilter(contract.filters.Ping(), b1, b1))) as ethers.EventLog[];
        expect(inB1).toHaveLength(1);
        expect(inB1[0].args.n).toBe(1n);
        expect(inB1[0]).toMatchObject({ blockNumber: b1, blockHash: node.blockHash(b1), transactionHash: tx1.hash, transactionIndex: 0, index: 0 });
        const inB2 = (await stepUntil(contract.queryFilter(contract.filters.Ping(), b2, b2))) as ethers.EventLog[];
        expect(inB2.map((e) => e.args.n)).toEqual([2n]);
        expect(inB2[0]).toMatchObject({ blockNumber: b2, transactionHash: tx2.hash });
        // Another block holds neither, a range above the head is empty, and a range covering both returns both in order.
        expect(await stepUntil(contract.queryFilter(contract.filters.Ping(), before, before))).toEqual([]);
        expect(await stepUntil(contract.queryFilter(contract.filters.Ping(), b2 + 1, b2 + 5))).toEqual([]);
        expect(((await stepUntil(contract.queryFilter(contract.filters.Ping(), b1, b2))) as ethers.EventLog[]).map((e) => e.args.n)).toEqual([1n, 2n]);
        // Address and topic filtering: another emitter or another event finds nothing.
        expect(await stepUntil(new ethers.Contract(EMITTER_B, EVENTS, provider).queryFilter('Ping', b1, b2))).toEqual([]);
        expect(await stepUntil(contract.queryFilter(contract.filters.Pong(), b1, b2))).toEqual([]);
        // The log is in its transaction's receipt and the block's bloom is no longer empty.
        expect((await stepUntil(provider.getTransactionReceipt(tx1.hash!)))?.logs).toHaveLength(1);
        const blockRaw = (await stepUntil(provider.send('eth_getBlockByNumber', [toQuantity(b1), false]))) as { logsBloom: string };
        expect(BigInt(blockRaw.logsBloom)).not.toBe(0n);
        // A real node's range rules.
        const bad = await stepUntil(provider.send('eth_getLogs', [{ fromBlock: toQuantity(b2), toBlock: toQuantity(b1) }]).then(() => null, (e: unknown) => e));
        expect(errorText(bad)).toContain('invalid block range params');
    });

    it('a subscription with an address list and an OR topic list receives only the logs that match, after the block head, in order', async () => {
        const { node } = bareNode();
        node.setBalance(SENDER.address, parseEther('1'));
        const ws = bareWs();
        const got: ethers.Log[] = [];
        const filter = { address: [EMITTER_A, EMITTER_B], topics: [[EVENTS.getEvent('Ping')!.topicHash, EVENTS.getEvent('Pong')!.topicHash]] };
        await ws.on(filter, (log: ethers.Log) => got.push(log));
        await stepUntilTrue(() => node.subscriptions.some((s) => s.kind === 'logs'), { what: 'the logs subscription' });

        // A raw connection beside it, to see the order the node pushes in.
        const pushed: Array<{ params: { result: { number?: string; address?: string } } }> = [];
        const conn = { send: (text: string): void => void pushed.push(JSON.parse(text) as (typeof pushed)[number]) };
        await node.handle({ jsonrpc: '2.0', id: 1, method: 'eth_subscribe', params: ['newHeads'] }, conn, { endpoint: 'ws', url: BARE_WS });
        await node.handle({ jsonrpc: '2.0', id: 2, method: 'eth_subscribe', params: ['logs', filter] }, conn, { endpoint: 'ws', url: BARE_WS });

        const raw = await signed({ nonce: 0 });
        const hash = node.addForeignTransaction(raw);
        const block = node.mine({
            logs: [
                eventLog(EMITTER_A, 'Ping', 1n), // matches
                eventLog(EMITTER_C, 'Ping', 2n), // address not in the list
                eventLog(EMITTER_B, 'Other', 3n), // topic not in the OR list
                eventLog(EMITTER_B, 'Pong', 4n), // matches
            ],
        });
        await stepUntilTrue(() => got.length === 2, { what: 'the two matching logs' });
        await stepFor(1_000);
        expect(got).toHaveLength(2);
        expect(got.map((l) => getAddress(l.address))).toEqual([getAddress(EMITTER_A), getAddress(EMITTER_B)]);
        expect(got.map((l) => EVENTS.parseLog(l)?.args.n)).toEqual([1n, 4n]);
        expect(got.every((l) => l.blockNumber === block && l.transactionHash === hash)).toBe(true);
        // The node pushed the head first, then the matching logs in block order (logIndex 0 and 3).
        expect(pushed.map((m) => (m.params.result.number !== undefined ? 'head' : m.params.result.address))).toEqual(['head', EMITTER_A.toLowerCase(), EMITTER_B.toLowerCase()]);
        expect(pushed.slice(1).map((m) => (m.params.result as { logIndex: string }).logIndex)).toEqual(['0x0', '0x3']);
    });

    it('a WETH Withdrawal set through setReceiptLogs is in the sell receipt and the real decodeReceipt reads it', async () => {
        const { node, provider } = bareNode();
        const wallet = SENDER.connect(provider);
        node.setBalance(wallet.address, parseEther('1'));
        const router = labelAddress('23-28.router');
        const weth = labelAddress('23-28.weth');
        const SELL = new Interface(['function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)']);
        const WETH9 = new Interface(['event Withdrawal(address indexed src, uint256 wad)']);
        node.setReceiptLogs({ to: router, selector: 'swapExactTokensForETH(uint256,uint256,address[],address,uint256)' }, (tx) => {
            const wad = (SELL.decodeFunctionData('swapExactTokensForETH', tx.data)[1] as bigint) + 1n;
            const e = WETH9.encodeEventLog('Withdrawal', [router, wad]);
            return [{ address: weth, topics: e.topics, data: e.data }];
        });
        const sellData = SELL.encodeFunctionData('swapExactTokensForETH', [1000n, 41n, [labelAddress('23-28.token'), weth], wallet.address, 9_999_999_999n]);
        const sell = await stepUntil(wallet.sendTransaction({ to: router, data: sellData }));
        const plain = await stepUntil(wallet.sendTransaction({ to: router, value: 1n }));
        node.mine();

        const decoded = await stepUntil(decodeReceipt(sell.hash, provider, weth, wallet.address));
        const receipt = (await stepUntil(provider.getTransactionReceipt(sell.hash)))!;
        expect(decoded).toEqual({ amountOut: '42', gasCost: (receipt.gasUsed * receipt.gasPrice).toString(), blockNumber: receipt.blockNumber });
        expect(receipt.logs).toHaveLength(1);
        expect(receipt.logs[0].transactionHash).toBe(sell.hash);
        // A transaction the rule does not match carries no log.
        expect((await stepUntil(provider.getTransactionReceipt(plain.hash)))?.logs).toEqual([]);
        expect(() => node.setReceiptLogs({ selector: 'nope' }, () => [])).toThrow(/not a 4-byte selector/);
    });
});

// ---------------------------------------------------------------------------------------------
// Plan 23-28 Task 3: every chain and DEX type through createScenario, each on its real route.
// ---------------------------------------------------------------------------------------------

const V2_ROUTER = new Interface(['function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)']);
const V3_ROUTER = new Interface([
    'function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)',
    'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
]);
const CHECKER = new Interface(['function checkV2(address router, address token, uint256 amountIn)', 'function checkV3(address router, address quoter, address token, uint256 amountIn, uint24 fee)']);

type TradeRow = { status: string; action: string; token: string; chain: string; tx_hash: string; pool_type: string; fee_tier: number | null; dex_name: string };

/** Wait until the buy's position is armed: trades row, exit monitor, anti-rug subscription, block cursor. */
async function armed(sc: Scenario): Promise<TradeRow> {
    const { node, graph } = sc;
    const row = (): TradeRow | undefined => graph.db.prepare('SELECT status, action, token, chain, tx_hash, pool_type, fee_tier, dex_name FROM trades').get() as TradeRow | undefined;
    await stepUntilTrue(() => row() !== undefined, { what: `the ${sc.chain} trades row for the buy`, maxSteps: 20_000 });
    const cursor = (): number | undefined => (graph.db.prepare('SELECT last_seen_block AS b FROM chain_state WHERE chain = ?').get(sc.chain) as { b: number } | undefined)?.b;
    await stepUntilTrue(
        () =>
            opLogged('exit.monitor.started') &&
            node.subscriptions.some((s) => s.kind === 'logs' && JSON.stringify(s.filter).toLowerCase().includes(sc.pair.toLowerCase())) &&
            cursor() === node.head,
        { what: `the ${sc.chain} position being armed (exit monitor, anti-rug subscription, block cursor)` },
    );
    return row()!;
}

/** The checker reads the safety path made (proves the honeypot gate actually ran on this chain). */
function checkerReads(sc: Scenario, fn: 'checkV2' | 'checkV3'): Array<{ args: ethers.Result }> {
    const selector = CHECKER.getFunction(fn)!.selector;
    return sc.node.callLog
        .filter((c) => c.method === 'eth_call' && c.to === sc.checker.toLowerCase() && c.selector === selector)
        .map((c) => ({ args: CHECKER.decodeFunctionData(fn, c.data!) }));
}

describe('scenario builder: every chain and DEX type on its real route (23-28 Task 3)', () => {
    it('route bundle: an ETH V3 buy from a real PoolCreated, with the same-block Mint found through eth_getLogs, decodes as SwapRouter02 multicall(exactInputSingle)', async () => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v3' });
        const { node, ctx, dex, token, weth, wallet } = sc;
        await listen(sc);
        const launch = await sc.fireNewPool();
        expect(launch.poolCreated.address).toBe(dex.factoryAddress.toLowerCase());
        expect(launch.mint.address).toBe(sc.pair.toLowerCase());

        await stepUntilTrue(() => node.submitted.length === 1, { what: 'the bot submitting its V3 buy bundle' });
        const buy = node.submitted[0];
        expect(buy.route).toBe('bundle');
        // waitForLiquidity found the Mint in the PoolCreated block through a real eth_getLogs.
        const mintQuery = node.callLog.find((c) => c.method === 'eth_getLogs' && JSON.stringify(c.params).toLowerCase().includes(sc.pair.toLowerCase()));
        expect(mintQuery).toBeDefined();
        expect(harnessState().logs.some((l) => l.msg === 'Mint found in same block as PoolCreated')).toBe(true);
        expect(checkerReads(sc, 'checkV3').length).toBeGreaterThan(0);
        expect(checkerReads(sc, 'checkV3').every((r) => getAddress(r.args.token as string) === getAddress(token) && Number(r.args.fee) === 3000)).toBe(true);

        await stepFor(12_000);
        expect(node.mine({ include: [buy.hash] })).toBe(launch.block + 1);
        const row = await armed(sc);

        const tx = Transaction.from(buy.raw);
        expect(getAddress(tx.to!)).toBe(getAddress(dex.swapRouterAddress));
        expect(tx.chainId).toBe(1n);
        expect(tx.value).toBe(parseEther(ctx.chain.snipeAmount));
        const outer = V3_ROUTER.parseTransaction({ data: tx.data, value: tx.value });
        expect(outer?.name).toBe('multicall');
        const inner = V3_ROUTER.parseTransaction({ data: (outer!.args[1] as string[])[0], value: tx.value });
        expect(inner?.name).toBe('exactInputSingle');
        const p = inner!.args[0] as unknown as { tokenIn: string; tokenOut: string; fee: bigint; recipient: string; amountIn: bigint };
        expect([getAddress(p.tokenIn), getAddress(p.tokenOut), Number(p.fee), getAddress(p.recipient), p.amountIn]).toEqual([getAddress(weth), getAddress(token), 3000, getAddress(wallet.address), parseEther(ctx.chain.snipeAmount)]);
        expect(row).toMatchObject({ status: 'pending', action: 'buy', chain: 'eth', tx_hash: buy.hash, pool_type: 'v3', fee_tier: 3000, dex_name: 'uniswap-v3' });
    });

    it('route bloxroute: a bsc V2 buy goes to bloXroute as a type-0 chain-56 transaction, the scenario checker ran, and only mine() includes it', async () => {
        const sc = await createScenario({ chain: 'bsc', dexType: 'v2' });
        const { node, ctx, dex, token, weth, wallet } = sc;
        expect(process.env.BSC_HONEYPOT_CHECKER_ADDRESS).toBe(sc.checker);
        expect(ctx.chain.honeypotChecker.deployedAddress).toBe(sc.checker);
        await listen(sc);
        const launch = await sc.fireNewPair();

        await stepUntilTrue(() => node.submitted.length === 1, { what: 'the bot relaying its buy to bloXroute' });
        const buy = node.submitted[0];
        expect(buy.route).toBe('bloxroute');
        expect(node.minedCount(wallet.address)).toBe(0);
        const relayed = harnessState().httpLog.filter((h) => h.method === 'post' && h.url === ctx.chain.mevConfig.endpoint);
        expect(relayed.map((h) => (h.data as { method?: string }).method)).toContain('bsc_private_tx');
        const checks = checkerReads(sc, 'checkV2');
        expect(checks.length).toBeGreaterThan(0);
        expect(checks.every((r) => getAddress(r.args.token as string) === getAddress(token) && getAddress(r.args.router as string) === getAddress(dex.routerAddress))).toBe(true);
        // The Mudra lock answer was asked for this pair.
        expect(harnessState().httpLog.some((h) => h.url.toLowerCase() === `https://api.mudra.website/api/v1/locker/pair/${sc.pair.toLowerCase()}`)).toBe(true);

        // Virtual time alone does not land it.
        await stepFor(8_000);
        expect(node.isMined(buy.hash)).toBe(false);
        node.mine({ include: [buy.hash] });
        expect(node.head).toBeGreaterThan(launch.block);
        const row = await armed(sc);

        const tx = Transaction.from(buy.raw);
        expect(tx.type).toBe(0);
        expect(tx.chainId).toBe(56n);
        expect(tx.gasPrice).toBeGreaterThan(0n);
        expect(getAddress(tx.to!)).toBe(getAddress(dex.routerAddress));
        expect(tx.value).toBe(parseEther(ctx.chain.snipeAmount));
        const call = V2_ROUTER.parseTransaction({ data: tx.data, value: tx.value });
        expect(call?.name).toBe('swapExactETHForTokens');
        expect((call!.args[1] as string[]).map((a) => getAddress(a))).toEqual([getAddress(weth), getAddress(token)]);
        expect(row).toMatchObject({ status: 'pending', action: 'buy', chain: 'bsc', tx_hash: buy.hash, pool_type: 'v2', dex_name: 'pancakeswap-v2' });
    });

    for (const [chain, chainId] of [['base', 8453n], ['arb', 42161n]] as const) {
        it(`route public: a ${chain} V3 buy goes through eth_sendRawTransaction, the scenario checker ran, and tx.wait(3) needs three blocks`, async () => {
            const sc = await createScenario({ chain, dexType: 'v3' });
            const { node, ctx, dex, token, weth, wallet } = sc;
            expect(ctx.chain.mevStrategy).toBe('passthrough');
            expect(process.env[`${chain.toUpperCase()}_HONEYPOT_CHECKER_ADDRESS`]).toBe(sc.checker);
            await listen(sc);
            const launch = await sc.fireNewPool();
            await stepUntilTrue(() => node.submitted.length === 1, { what: `the bot sending its ${chain} V3 buy publicly` });
            const buy = node.submitted[0];
            expect(buy.route).toBe('public');
            expect(node.statusOf(buy.hash)).toBe('accepted');
            const checks = checkerReads(sc, 'checkV3');
            expect(checks.length).toBeGreaterThan(0);
            expect(checks.every((r) => getAddress(r.args.token as string) === getAddress(token) && getAddress(r.args.router as string) === getAddress(dex.swapRouterAddress))).toBe(true);
            // Accepted is not mined: no trades row until the receipt has three confirmations.
            expect(node.mine()).toBe(launch.block + 1);
            expect(node.isMined(buy.hash)).toBe(true);
            await stepFor(8_000);
            expect(sc.graph.db.prepare('SELECT 1 FROM trades').get()).toBeUndefined();
            node.mine();
            node.mine();
            const row = await armed(sc);
            const tx = Transaction.from(buy.raw);
            expect(tx.chainId).toBe(chainId);
            expect(tx.type).toBe(2);
            expect(getAddress(tx.to!)).toBe(getAddress(dex.swapRouterAddress));
            expect(tx.value).toBe(parseEther(ctx.chain.snipeAmount));
            const outer = V3_ROUTER.parseTransaction({ data: tx.data, value: tx.value });
            const inner = V3_ROUTER.parseTransaction({ data: (outer!.args[1] as string[])[0], value: tx.value });
            expect(inner?.name).toBe('exactInputSingle');
            const p = inner!.args[0] as unknown as { tokenIn: string; tokenOut: string; recipient: string };
            expect([getAddress(p.tokenIn), getAddress(p.tokenOut), getAddress(p.recipient)]).toEqual([getAddress(weth), getAddress(token), getAddress(wallet.address)]);
            expect(row).toMatchObject({ status: 'pending', action: 'buy', chain, tx_hash: buy.hash, pool_type: 'v3', fee_tier: 3000, dex_name: 'uniswap-v3' });
        });
    }

    // AUD-BUY-016 (S3, card BUY-05). On base and Arbitrum the V2 lock check asks GoPlus
    // token_security about the PAIR address as if it were a token and reads its lp_holders
    // (src/utils/safetyProviders/goplus.ts:57-60). GoPlus returns lp_holders only for a token
    // traded on a DEX ("When is_in_dex: 0, there will be no return", docs.gopluslabs.io response
    // details), so the pair reads "not locked" and every V2 launch on these chains is skipped.
    // Operator ruling at the 23-28 checkpoint ("Test today's skip"): this records today's
    // behavior with a GoPlus fake that answers only what GoPlus documents (AC-48). It FAILS ON
    // PURPOSE when Phase 24 fixes the query (the buy then goes out on the public route); rewrite
    // it then as the base/arb V2 buy on route public.
    for (const [chain, chainId] of [['base', 8453], ['arb', 42161]] as const) {
        it(`AUD-BUY-016 today: a ${chain} V2 launch is skipped before route public, because GoPlus is asked about the pair and reads "not locked" while every other safety check passes`, async () => {
            const sc = await createScenario({ chain, dexType: 'v2' });
            const { node, ctx, dex, token, pair } = sc;
            expect(ctx.chain.mevStrategy).toBe('passthrough');
            expect(ctx.chain.safetyApis.liquidityLock).toBe('goplus');
            expect(process.env[`${chain.toUpperCase()}_HONEYPOT_CHECKER_ADDRESS`]).toBe(sc.checker);
            await listen(sc);
            await sc.fireNewPair();

            type SkipLine = { checks: Record<string, unknown> };
            const skip = (): SkipLine | undefined => harnessState().logs.find((l) => l.msg === 'Safety checks failed, skipping')?.obj as SkipLine | undefined;
            const buying = (): boolean => harnessState().logs.some((l) => l.msg === 'All safety checks passed, buying');
            await stepUntilTrue(() => skip() !== undefined || buying(), { what: `the ${chain} V2 safety bank deciding`, maxSteps: 20_000 });
            // The fix signal (D-08): once the lock query is fixed the bank passes and the bot buys.
            if (buying()) {
                throw new Error(
                    `AUD-BUY-016 looks fixed: the ${chain} V2 launch passed the lock check and the bot is buying. ` +
                        `Take this test off AUD-BUY-016 and rewrite it as the ${chain} V2 buy on route public.`,
                );
            }

            // The safety path ran: the on-chain honeypot roundtrip was served for this token and router.
            const checks = checkerReads(sc, 'checkV2');
            expect(checks.length).toBeGreaterThan(0);
            expect(checks.every((r) => getAddress(r.args.token as string) === getAddress(token) && getAddress(r.args.router as string) === getAddress(dex.routerAddress))).toBe(true);

            // GoPlus was asked about the pair, never the token: the query AUD-BUY-016 names.
            const asked = harnessState()
                .httpLog.filter((h) => h.method === 'get' && h.url === `https://api.gopluslabs.io/api/v1/token_security/${chainId}`)
                .map((h) => String((h.params as { contract_addresses?: unknown } | undefined)?.contract_addresses).toLowerCase());
            expect(asked).toEqual([pair.toLowerCase()]);

            // The lock is the only failed check.
            const result = skip()!.checks;
            expect(result).toMatchObject({ isHoneypot: false, isBlacklisted: false, locked: false, sufficientLiquidity: true, validMetadata: true, canSwap: true, hasLimits: false, mutable: false });
            // The real alert, with its exact text, sent through sendCtxAlert for this chain.
            expect(recordedAlerts().some((a) => a.via === 'ctx' && a.chain === chain && typeof a.message === 'string' && a.message.includes('Locked: `No`'))).toBe(true);

            // No buy: two more slots pass and nothing is sent on any route, no trades row is written.
            await stepFor(24_000);
            expect(harnessState().logs.some((l) => l.msg === 'All safety checks passed, buying')).toBe(false);
            expect(node.submitted).toHaveLength(0);
            expect(node.callLog.some((c) => c.method === 'eth_sendRawTransaction')).toBe(false);
            expect(sc.graph.db.prepare('SELECT 1 FROM trades').get()).toBeUndefined();

            // The same GoPlus fake does report the lock when asked about the token: the real
            // goplusLiquidityLockCheck reads the token's answer as locked and the pair's as not, so
            // the skip comes from the query, not from a fake that refuses every lock.
            const goplus = await import('../../src/utils/safetyProviders/goplus');
            expect(await stepUntil(goplus.goplusLiquidityLockCheck(ctx, token))).toBe(true);
            expect(await stepUntil(goplus.goplusLiquidityLockCheck(ctx, pair))).toBe(false);
        });
    }
});

// ---------------------------------------------------------------------------------------------
// Plan 23-15 harness gap (Harness Gap Procedure, 23-27-PLAN.md): a relay answer with its own HTTP
// status and raw body. A real relay can refuse with a non-2xx status (the one AC-15 request got
// HTTP 403); the Flashbots library throws on any non-2xx (its request() calls assertOk), so a fake
// that can only answer 200 cannot show what production does on that answer.
// ---------------------------------------------------------------------------------------------

const RELAY_HTTP = 'https://relay-http.realpath.invalid/';
/** The body the live relay sent with its 403 (.planning/audit/inputs/aud-tx-006-relay-response.json). */
const NOT_WHITELISTED = '{"jsonrpc":"2.0","error":{"code":-32601,"message":"rpc method is not whitelisted"},"id":1}\n';
const STATS_HASH = '0x' + 'ab'.repeat(32);

/** A real FlashbotsBundleProvider on the bare node's relay URL, signing with a fixed test key. */
async function bareFlashbots(provider: JsonRpcProvider): Promise<FlashbotsBundleProvider> {
    return stepUntil(FlashbotsBundleProvider.create(provider, new Wallet(ethers.id('realpath.relay-http.auth')), RELAY_HTTP));
}

/** One JSON-RPC request through a real ethers FetchRequest, as the library's request() sends it. */
function relayRequest(body: unknown): FetchRequest {
    const r = new FetchRequest(RELAY_HTTP);
    r.setHeader('Content-Type', 'application/json');
    r.body = JSON.stringify(body);
    return r;
}

const STATS_CALL = { jsonrpc: '2.0', id: 7, method: 'flashbots_getBundleStatsV2', params: [{ bundleHash: STATS_HASH, blockNumber: '0x1' }] };

describe('simulated relay: an answer with its own HTTP status and raw body (plan 23-15 harness gap)', () => {
    it('a relay override answering { http: { status, body } } reaches real ethers as that status, status text and exact body, and the real Flashbots library throws on it as on a live 403', async () => {
        const { node, provider } = bareNode();
        node.serve({ relay: [RELAY_HTTP] });
        node.setRelay('flashbots_getBundleStatsV2', () => ({ http: { status: 403, statusMessage: 'Forbidden', body: NOT_WHITELISTED } }));

        const resp = await stepUntil(relayRequest(STATS_CALL).send());
        expect(resp.statusCode).toBe(403);
        expect(resp.statusMessage).toBe('Forbidden');
        expect(resp.bodyText).toBe(NOT_WHITELISTED);
        expect(resp.headers['content-type']).toBe('application/json');
        expect(resp.ok()).toBe(false);

        // The real library: getBundleStatsV2 -> request() -> assertOk() throws with the status and body.
        const fb = await bareFlashbots(provider);
        const err = await stepUntil(fb.getBundleStatsV2(STATS_HASH, 1)).then(
            () => null,
            (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toBe(`Request failed with status 403 (URL: ${RELAY_HTTP}): ${NOT_WHITELISTED}`);

        // Both calls arrived and are on the relay record, as any relay call is.
        expect(node.relay.map((r) => r.method)).toEqual(['flashbots_getBundleStatsV2', 'flashbots_getBundleStatsV2']);
        expect(node.relay.every((r) => r.url === RELAY_HTTP)).toBe(true);
        expect(node.strays).toEqual([]);
    });

    it('headers given with the answer are sent (names lower-cased); content-type stays application/json unless one is given', async () => {
        const { node } = bareNode();
        node.serve({ relay: [RELAY_HTTP] });
        node.setRelay('flashbots_getBundleStatsV2', () => ({ http: { status: 429, body: 'slow down', headers: { 'Content-Type': 'text/plain', 'Retry-After': '1' } } }));
        const req = relayRequest(STATS_CALL);
        // No retry here: real ethers would otherwise retry a 429 (its own throttle rule), which is
        // ethers behavior, not the harness's.
        req.retryFunc = async () => false;
        const resp = await stepUntil(req.send());
        expect(resp.statusCode).toBe(429);
        expect(resp.bodyText).toBe('slow down');
        expect(resp.headers['content-type']).toBe('text/plain');
        expect(resp.headers['retry-after']).toBe('1');
        expect(node.strays).toEqual([]);
    });

    it('control: without an http answer nothing changes: a JSON-RPC error override, the default stats answer and an unknown relay method all go out as HTTP 200, and the library returns the error quietly', async () => {
        const { node, provider } = bareNode();
        node.serve({ relay: [RELAY_HTTP] });
        const fb = await bareFlashbots(provider);

        // Default answer (no override): HTTP 200 with a JSON-RPC result.
        const plain = await stepUntil(relayRequest(STATS_CALL).send());
        expect(plain.statusCode).toBe(200);
        expect(plain.statusMessage).toBe('OK');
        expect(plain.headers['content-type']).toBe('application/json');
        expect(plain.bodyJson).toMatchObject({ jsonrpc: '2.0', id: 7 });
        expect('result' in (plain.bodyJson as object)).toBe(true);

        // The same error text as the live relay's, but as a JSON-RPC error at HTTP 200: the library
        // does not throw; it returns { error } and the caller sees no failure.
        node.setRelay('flashbots_getBundleStatsV2', () => ({ error: { code: -32601, message: 'rpc method is not whitelisted' } }));
        const atOk = await stepUntil(relayRequest(STATS_CALL).send());
        expect(atOk.statusCode).toBe(200);
        expect(atOk.bodyJson).toEqual({ jsonrpc: '2.0', id: 7, error: { code: -32601, message: 'rpc method is not whitelisted' } });
        expect(await stepUntil(fb.getBundleStatsV2(STATS_HASH, 1))).toEqual({ error: { message: 'rpc method is not whitelisted', code: -32601 } });

        // An unknown relay method is still a stray answered at HTTP 200 with -32601.
        const unknown = await stepUntil(relayRequest({ jsonrpc: '2.0', id: 8, method: 'flashbots_frobnicate', params: [] }).send());
        expect(unknown.statusCode).toBe(200);
        expect((unknown.bodyJson as { error?: { code?: number } }).error?.code).toBe(-32601);
        expect(() => assertNoStrays()).toThrow(/flashbots_frobnicate/);
        node.strays.length = 0;
    });

    it('a held relay call answered with an HTTP status is parked until release and then gets that status', async () => {
        const { node, provider } = bareNode();
        node.serve({ relay: [RELAY_HTTP] });
        node.setRelay('flashbots_getBundleStatsV2', () => ({ http: { status: 403, statusMessage: 'Forbidden', body: NOT_WHITELISTED } }));
        const held = node.hold('flashbots_getBundleStatsV2');
        const fb = await bareFlashbots(provider);

        let settled: unknown = 'pending';
        const call = fb.getBundleStatsV2(STATS_HASH, 1).then(
            (v) => (settled = { value: v }),
            (e: unknown) => (settled = e),
        );
        await stepUntilTrue(() => held.parkedNow === 1, { what: 'the stats call being held' });
        await stepFor(30_000, 100);
        expect(settled).toBe('pending');

        held.release();
        await stepUntil(call);
        expect(settled).toBeInstanceOf(Error);
        expect((settled as Error).message).toBe(`Request failed with status 403 (URL: ${RELAY_HTTP}): ${NOT_WHITELISTED}`);
        expect(held.heldCount).toBe(1);
        expect(node.strays).toEqual([]);
    });

    it('an http answer that cannot be sent is a harness error, never a node answer: a status outside 200-599, a body that is not text, one mixed with result, and one inside a JSON-RPC batch each record a stray', async () => {
        const { node } = bareNode();
        node.serve({ relay: [RELAY_HTTP] });
        const bad: unknown[] = [
            { http: { status: 99, body: 'x' } },
            { http: { status: 600, body: 'x' } },
            { http: { status: 403.5, body: 'x' } },
            { http: { status: 403, body: { not: 'text' } } },
            { http: { status: 403, body: 'x' }, result: 1 },
        ];
        for (const answer of bad) {
            node.setRelay('flashbots_getBundleStatsV2', () => answer as never);
            const resp = await stepUntil(relayRequest(STATS_CALL).send());
            // A harness error answers like the harness's other internal errors: -32603 at HTTP 200.
            expect(resp.statusCode).toBe(200);
            expect((resp.bodyJson as { error?: { code?: number } }).error?.code).toBe(-32603);
        }
        expect(node.strays).toHaveLength(bad.length);
        expect(node.strays.every((s) => s.kind === 'method' && /harness error answering flashbots_getBundleStatsV2: .*http answer/.test(s.detail))).toBe(true);
        node.strays.length = 0;

        // One HTTP response carries one status, so an http answer inside a batch cannot be sent.
        node.setRelay('flashbots_getBundleStatsV2', () => ({ http: { status: 403, body: NOT_WHITELISTED } }));
        const batch = await stepUntil(relayRequest([STATS_CALL, { ...STATS_CALL, id: 9 }]).send());
        expect(batch.statusCode).toBe(200);
        expect((batch.bodyJson as Array<{ id: unknown; error?: { code?: number } }>).map((r) => [r.id, r.error?.code])).toEqual([
            [7, -32603],
            [9, -32603],
        ]);
        expect(node.strays).toHaveLength(2);
        expect(node.strays.every((s) => /inside a JSON-RPC batch/.test(s.detail))).toBe(true);
        node.strays.length = 0;
    });
});

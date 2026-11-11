// test/realpath/triage/AUD-BUY-006.test.ts
// Phase 23 plan 23-06 Task 2 (AUDIT-02): AUD-BUY-006, the Telegram allowlist is allow-all unless
// BOTH lists are set. src/telegramListener.ts startTelegramListener parses TELEGRAM_ALLOWED_SENDERS
// and TELEGRAM_ALLOWED_CHANNELS into sets; in its inline handler senderAllowed is true when the
// sender set is empty, channelAllowed is true when the channel set is empty, and a message is
// rejected only when BOTH are false. So with no lists (the default) every visible message is
// accepted, and with only the sender list set every message passes through channelAllowed.
//
// Proof on the real path: a real ETH V2 launch is mined (a real PairCreated, with no DEX listener
// running, so the bot learns of the token only from Telegram), the real startTelegramListener
// registers its inline handler on the harness's Telegram client fake (the only mocked layer,
// AC-02), and a real-shaped message from a sender and chat on no list is delivered to it with
// deliverTelegramMessage (plan 23-27). Measured: whether the message reached the buy pipeline
// (handleNewPairForChain's "New pair detected" for the pair, through the real alphaDrop routing)
// and whether a buy was submitted (a submit entry on the scenario timeline). Correct for an
// untrusted source is neither. Each case is its own claim; a control with both lists set shows
// the same measure reads "ignored" when the handler rejects.
//
// Fix signal (D-08): a fail-closed default (no lists = reject) and AND semantics each read
// "looks fixed" on the claims they change (fix-shaped src mutations, restored).
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { Transaction, getAddress } from 'ethers';
import { encodeResult } from '../harness/chain';
import { recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { deliverTelegramMessage, telegramHandlerCount } from '../harness/telegram';
import { createScenario, stepFor, stepUntil, stepUntilTrue, type Scenario } from '../harness/world';

/** A sender and a chat that are on no allowlist in any case below. */
const STRANGER = { senderId: 987654321, chatId: '-1009876543210' };

function logged(msg: string): Array<Record<string, unknown> | undefined> {
    return recordedLogs()
        .filter((l) => l.msg === msg)
        .map((l) => l.obj);
}

interface Delivery {
    routedToBuyPipeline: boolean;
    buySubmitted: boolean;
}

/**
 * A live V2 pair the bot has not seen, the real Telegram listener, and one message from STRANGER
 * naming the token. Returns what the bot did with it, once it decided (rejected, or a buy sent).
 */
async function deliverFromStranger(sc: Scenario<'v2'>): Promise<Delivery> {
    const { node, dex, token, pair } = sc;
    await sc.fireNewPair();
    // The live pair, as the real factory answers it (alphaDrop asks getPair(token, weth)).
    node.setRead(dex.factoryAddress, 'getPair(address,address)', encodeResult(['address'], [pair]));
    const handle = await sc.graph.telegramListener.startTelegramListener([sc.ctx]);
    expect(handle.connected).toBe(true);
    expect(telegramHandlerCount()).toBe(1);
    const submitsBefore = sc.timeline.entries.filter((e) => e.kind === 'submit').length;

    await stepUntil(deliverTelegramMessage({ text: `next 100x ${token} aping now`, ...STRANGER }));
    const rejected = (): boolean => logged('Rejected message from non-whitelisted source').length > 0;
    await stepUntilTrue(() => rejected() || node.submitted.length > 0, { what: 'the bot deciding on the Telegram message (rejected, or a buy sent)', maxSteps: 20_000 });

    return {
        routedToBuyPipeline: logged('New pair detected').some((o) => String(o?.pair).toLowerCase() === pair.toLowerCase()),
        buySubmitted: sc.timeline.entries.filter((e) => e.kind === 'submit').length > submitsBefore,
    };
}

/** Land the buy a stranger's message started and wait until it is armed, so teardown cancels nothing. */
async function finishBuy(sc: Scenario<'v2'>): Promise<void> {
    const { node, graph } = sc;
    await stepFor(12_000);
    node.mine({ include: [node.submitted[0].hash] });
    await stepUntilTrue(() => graph.db.prepare('SELECT 1 FROM trades').get() !== undefined, { what: 'the trades row for the buy' });
    const cursor = (): number | undefined => (graph.db.prepare('SELECT last_seen_block AS b FROM chain_state WHERE chain = ?').get('eth') as { b: number } | undefined)?.b;
    await stepUntilTrue(
        () =>
            recordedLogs().some((l) => l.obj?.op === 'exit.monitor.started') &&
            node.subscriptions.some((s) => s.kind === 'logs' && JSON.stringify(s.filter).toLowerCase().includes(sc.pair.toLowerCase())) &&
            cursor() === node.head,
        { what: 'the position being armed' },
    );
}

/** The buy pipeline really ran for this token: the decoded swap is the bot's buy of it. */
function expectBuyOf(sc: Scenario<'v2'>): void {
    const tx = Transaction.from(sc.node.submitted[0].raw);
    expect(getAddress(tx.to!)).toBe(getAddress(sc.dex.routerAddress));
    expect(getAddress(tx.from!)).toBe(getAddress(sc.wallet.address));
    expect(tx.data.toLowerCase()).toContain(sc.token.slice(2).toLowerCase());
}

describe('AUD-BUY-006: the Telegram allowlist accepts every source unless both lists are set', () => {
    it('empty-lists-accept-any-source: with neither list set, a message from an unknown sender in an unknown chat routes into the buy pipeline and a buy is sent', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', overrides: { TELEGRAM_ALLOWED_SENDERS: '', TELEGRAM_ALLOWED_CHANNELS: '' } });
        const result = await deliverFromStranger(sc);
        knownBug(ctx, 'AUD-BUY-006', {
            claim: 'empty-lists-accept-any-source',
            correct: { routedToBuyPipeline: false, buySubmitted: false },
            observed: { routedToBuyPipeline: true, buySubmitted: true },
            actual: result,
            expectedPlain: 'With no Telegram allowlist configured, the listener trusts no one: a message from an unknown sender in an unknown chat is ignored.',
            actualPlain: 'With neither list set, a message from a sender and chat on no list was accepted, routed through the real alpha-drop path into the buy pipeline, and the bot sent a buy for the token it named.',
        });
        // Bug details, after the marker.
        expect(logged('Rejected message from non-whitelisted source')).toHaveLength(0);
        expect(logged('Found contract address, routing to matching chains')).toEqual([{ address: sc.token.toLowerCase() }]);
        expectBuyOf(sc);
        await finishBuy(sc);
    });

    it('sender-only-list-accepts-any-sender: with only the sender list set, a message from a sender not on it is still accepted (the empty channel list allows every chat) and a buy is sent', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', overrides: { TELEGRAM_ALLOWED_SENDERS: '111222333', TELEGRAM_ALLOWED_CHANNELS: '' } });
        const result = await deliverFromStranger(sc);
        knownBug(ctx, 'AUD-BUY-006', {
            claim: 'sender-only-list-accepts-any-sender',
            correct: { routedToBuyPipeline: false, buySubmitted: false },
            observed: { routedToBuyPipeline: true, buySubmitted: true },
            actual: result,
            expectedPlain: 'With a sender allowlist set, only those senders are trusted: a message from a sender not on the list is ignored.',
            actualPlain: 'The sender was not on the list, but the empty channel list counts as "every chat allowed" and either test passing is enough, so the message was accepted and the bot sent a buy.',
        });
        expect(logged('Rejected message from non-whitelisted source')).toHaveLength(0);
        expectBuyOf(sc);
        await finishBuy(sc);
    });

    it('control: with both lists set and neither matching, the same message is rejected before any chain call and nothing is bought', async () => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2', overrides: { TELEGRAM_ALLOWED_SENDERS: '111222333', TELEGRAM_ALLOWED_CHANNELS: '-1001112223334' } });
        const result = await deliverFromStranger(sc);
        expect(result).toEqual({ routedToBuyPipeline: false, buySubmitted: false });
        expect(logged('Rejected message from non-whitelisted source')).toEqual([{ senderId: String(STRANGER.senderId), chatId: STRANGER.chatId }]);
        expect(sc.node.callLog.filter((c) => c.method === 'eth_getCode' && String((c.params as unknown[])[0]).toLowerCase() === sc.token.toLowerCase())).toHaveLength(0);
        expect(sc.node.submitted).toHaveLength(0);
    });
});

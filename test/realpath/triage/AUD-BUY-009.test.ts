// test/realpath/triage/AUD-BUY-009.test.ts
// Phase 23 plan 23-06 Task 2 (AUDIT-02): AUD-BUY-009 (S3), the New-Token alert's honeypot field
// is a hard-coded constant. In src/bot.ts both snipe handlers set `const isHoneypot = false`
// (V2 handleNewPairForChain, V3 handleNewV3PoolForChain) after the third-party honeypot check was
// removed, and the alert still prints "Honeypot: `No`" from it; the honeypot check that actually
// gates the buy is the on-chain HoneypotChecker roundtrip, whose verdict and method the field
// never mentions.
//
// Proof on the real path: an ordinary ETH launch (V2: a real PairCreated through the real
// listener; V3: a real PoolCreated) runs to the alert through the real safety bank, with the
// scenario's HoneypotChecker answering a clean roundtrip. The alert text is the exact `message`
// the real sendCtxAlert received (recordedAlerts(), plan 23-02). Measured: whether the roundtrip
// check ran (checker eth_calls on the node), and whether the alert's honeypot field is a bare
// Yes/No tied to no check. Correct: the field reports the check that ran (or is gone). Each
// handler is its own claim.
//
// Fix signal (D-08): printing the roundtrip verdict and method in the field, or removing the
// field, each read "looks fixed" (fix-shaped src mutations, restored).
//
// Only the harness mocks are in use (harness/setup.ts); nothing here mocks anything.

import { describe, expect, it } from 'vitest';
import { recordedAlerts, recordedLogs } from '../harness/capture';
import { knownBug } from '../harness/knownBug';
import { createScenario, stepFor, stepUntilTrue, type Scenario } from '../harness/world';

function opLogged(op: string): boolean {
    return recordedLogs().some((l) => l.obj?.op === op);
}

/** Start the real listener and wait for its factory subscription. */
async function listen(sc: Scenario): Promise<void> {
    await sc.graph.bot.startDexListener(sc.ctx, sc.dex, sc.registry);
    await stepUntilTrue(
        () => sc.node.subscriptions.some((s) => s.kind === 'logs' && String((s.filter as { address?: string }).address).toLowerCase() === sc.dex.factoryAddress.toLowerCase()),
        { what: 'the listener subscribing to the factory' },
    );
}

/** Land the buy and wait until the position is armed, so teardown cancels nothing. */
async function finishBuy(sc: Scenario): Promise<void> {
    const { node, graph } = sc;
    await stepFor(12_000);
    node.mine({ include: [node.submitted[0].hash] });
    await stepUntilTrue(() => graph.db.prepare('SELECT 1 FROM trades').get() !== undefined, { what: 'the trades row for the buy', maxSteps: 20_000 });
    const cursor = (): number | undefined => (graph.db.prepare('SELECT last_seen_block AS b FROM chain_state WHERE chain = ?').get(sc.chain) as { b: number } | undefined)?.b;
    await stepUntilTrue(
        () => opLogged('exit.monitor.started') && node.subscriptions.some((s) => s.kind === 'logs' && JSON.stringify(s.filter).toLowerCase().includes(sc.pair.toLowerCase())) && cursor() === node.head,
        { what: 'the position being armed', maxSteps: 20_000 },
    );
}

interface AlertMeasure {
    roundtripCheckRan: boolean;
    honeypotFieldIsBareConstant: boolean;
}

/** The New-Token alert for this launch, and what its honeypot field says. */
function measure(sc: Scenario, header: string): { m: AlertMeasure; message: string; field: string | undefined } {
    const alerts = recordedAlerts().filter((a) => String(a.message).startsWith(header));
    expect(alerts, `exactly one "${header}" alert`).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ via: 'ctx', chain: sc.chain });
    const message = String(alerts[0].message);
    expect(message).toContain(sc.token);
    const field = message.match(/^Honeypot: `([^`]*)`$/m)?.[1];
    const checkerCalls = sc.node.callLog.filter((c) => c.method === 'eth_call' && c.to === sc.checker.toLowerCase());
    return {
        m: { roundtripCheckRan: checkerCalls.length > 0, honeypotFieldIsBareConstant: field === 'No' || field === 'Yes' },
        message,
        field,
    };
}

describe('AUD-BUY-009: the New-Token alert prints a constant honeypot field', () => {
    it('v2-alert-honeypot-field-is-constant: an ordinary V2 launch passes the on-chain roundtrip, and the alert prints a bare "No" from a constant', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v2' });
        await listen(sc);
        await sc.fireNewPair();
        await stepUntilTrue(() => recordedAlerts().some((a) => String(a.message).startsWith('*New Token Detected!*')), { what: 'the New Token alert', maxSteps: 20_000 });
        // The buy lands and is armed whatever the alert says (holds for the bug and for a fix).
        await stepUntilTrue(() => sc.node.submitted.length === 1, { what: 'the buy being sent', maxSteps: 20_000 });
        await finishBuy(sc);
        const { m, field, message } = measure(sc, '*New Token Detected!*');
        knownBug(ctx, 'AUD-BUY-009', {
            claim: 'v2-alert-honeypot-field-is-constant',
            correct: { roundtripCheckRan: true, honeypotFieldIsBareConstant: false },
            observed: { roundtripCheckRan: true, honeypotFieldIsBareConstant: true },
            actual: m,
            expectedPlain: 'The New Token alert says which honeypot check ran and what it found (the on-chain roundtrip verdict), or does not claim one.',
            actualPlain: 'The on-chain roundtrip ran, but the alert prints "Honeypot: No" from a value hard-coded to false, naming no check.',
        });
        // Bug details, after the marker: the bare "No", while the tax lines do come from the roundtrip.
        expect(field).toBe('No');
        expect(message).toMatch(/^BuyTax: `0bps`$/m);
        expect(message).toMatch(/^SellTax: `0bps`$/m);
    });

    it('v3-alert-honeypot-field-is-constant: an ordinary V3 launch passes the on-chain roundtrip, and the alert prints a bare "No" from a constant', async (ctx) => {
        const sc = await createScenario({ chain: 'eth', dexType: 'v3' });
        await listen(sc);
        await sc.fireNewPool();
        await stepUntilTrue(() => recordedAlerts().some((a) => String(a.message).startsWith('*New V3 Token Detected!*')), { what: 'the New V3 Token alert', maxSteps: 20_000 });
        await stepUntilTrue(() => sc.node.submitted.length === 1, { what: 'the V3 buy being sent', maxSteps: 20_000 });
        await finishBuy(sc);
        const { m, field } = measure(sc, '*New V3 Token Detected!*');
        knownBug(ctx, 'AUD-BUY-009', {
            claim: 'v3-alert-honeypot-field-is-constant',
            correct: { roundtripCheckRan: true, honeypotFieldIsBareConstant: false },
            observed: { roundtripCheckRan: true, honeypotFieldIsBareConstant: true },
            actual: m,
            expectedPlain: 'The New V3 Token alert says which honeypot check ran and what it found (the on-chain roundtrip verdict), or does not claim one.',
            actualPlain: 'The on-chain V3 roundtrip ran, but the alert prints "Honeypot: No" from a value hard-coded to false, naming no check.',
        });
        expect(field).toBe('No');
    });
});

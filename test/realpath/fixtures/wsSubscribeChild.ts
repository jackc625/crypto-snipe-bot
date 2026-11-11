// test/realpath/fixtures/wsSubscribeChild.ts
//
// Phase 23 plan 23-27 (CHAR-01): a real child whose real ethers WebSocketProvider subscribes
// over the harness loopback socket. Not a test file. Started only through runRailedChildToEnd
// (test/realpath/harness/loopback.ts) with `-r ts-node/register/transpile-only`.
//
// It builds a real WebSocketProvider from ETH_WS_URL, awaits provider.getNetwork() first (a log
// pushed before the provider has its network ends ethers' subscriber with "network is not
// available yet", measured in the 23-27 plan context), then subscribes with the filter shape
// src/anti-rug/detector.ts startChainAntiRugListener uses, an address list and an OR list of
// topic0 values, and to new blocks.
//
// Args: <address> <topic0 a> <topic0 b>
// Lines on stdout: CHILD_WS_READY <chainId> once subscribed, CHILD_WS_LOG <address> <topic0> per
// log, CHILD_WS_HEAD <number> per head. It exits 0 after one log and one head. After a 20000 ms
// real-time deadline it prints CHILD_WS_TIMEOUT and exits 3, so an unanswered call is a loud
// failure and never a hang. Any error prints CHILD_WS_ERROR and exits 1.

import * as fs from 'fs';
import { WebSocketProvider, type Log } from 'ethers';

const DEADLINE_MS = 20_000;

function say(line: string): void {
    fs.writeSync(1, `${line}\n`);
}

const timer = setTimeout(() => {
    say('CHILD_WS_TIMEOUT');
    process.exit(3);
}, DEADLINE_MS);

async function main(): Promise<void> {
    const [address, topicA, topicB] = process.argv.slice(2);
    if (![address].every((a) => /^0x[0-9a-fA-F]{40}$/.test(a ?? '')) || ![topicA, topicB].every((t) => /^0x[0-9a-fA-F]{64}$/.test(t ?? ''))) {
        say(`CHILD_WS_ERROR bad arguments ${JSON.stringify(process.argv.slice(2))}`);
        process.exit(2);
    }
    const url = process.env.ETH_WS_URL ?? '';
    if (!/^ws:\/\/127\.0\.0\.1:\d+\/$/.test(url)) {
        say(`CHILD_WS_ERROR ETH_WS_URL is not a harness loopback URL: ${JSON.stringify(url)}`);
        process.exit(2);
    }

    const provider = new WebSocketProvider(url);
    const network = await provider.getNetwork();

    let sawLog = false;
    let sawHead = false;
    const finish = async (): Promise<void> => {
        if (!sawLog || !sawHead) return;
        clearTimeout(timer);
        await provider.destroy();
        process.exit(0);
    };
    await provider.on({ address: [address], topics: [[topicA, topicB]] }, (log: Log) => {
        say(`CHILD_WS_LOG ${log.address.toLowerCase()} ${log.topics[0]}`);
        sawLog = true;
        void finish();
    });
    await provider.on('block', (n: number) => {
        say(`CHILD_WS_HEAD ${n}`);
        sawHead = true;
        void finish();
    });
    say(`CHILD_WS_READY ${network.chainId}`);
}

main().catch((e: unknown) => {
    say(`CHILD_WS_ERROR ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
    process.exit(1);
});

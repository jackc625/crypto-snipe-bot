// test/rails/probes/notifierProdPathProbe.ts
// Phase 22 plan 22-10 Task 2 - proves the production path is unchanged by the VITEST guards.
// Run ONLY as a railed child with VITEST unset, with its cwd in a throwaway folder holding a
// fake .env file (test/unit/rails/dotenvSrcSkip.test.ts). The real .env is never involved, and
// nothing reaches Telegram: axios.post is redirected to a loopback fake here, and the rails
// deny Telegram underneath even if the redirect were removed.
//
// Prints one JSON line last. Exit 3 if VITEST is set or the rails are missing; exit 4 if a
// target module fails to import.

import axios from 'axios';
import * as http from 'http';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = require('../core.cjs') as {
    railsStatus(): { envBlockInstalled: boolean; netDenyInstalled: boolean };
    readLedger(): Array<{ kind: string }>;
};

const FAKE_KEY = 'FAKE_ENV_PROBE_KEY';
const FAKE_VALUE = 'from-fake-env-file';

function loaded(): boolean {
    const hit = process.env[FAKE_KEY] === FAKE_VALUE;
    delete process.env[FAKE_KEY];
    return hit;
}

function load(id: string): unknown {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require(id);
    } catch (err) {
        process.stderr.write(`notifierProdPathProbe: import of ${id} failed: ${String((err as Error).message)}\n`);
        process.exit(4);
    }
}

async function main(): Promise<void> {
    const st = core.railsStatus();
    if (process.env.VITEST || !st.envBlockInstalled || !st.netDenyInstalled) {
        process.stderr.write('notifierProdPathProbe: must run railed with VITEST unset\n');
        process.exit(3);
    }

    // test/rails/probes/ is three levels below the repo root.
    load('../../../src/config');
    const configLoadedEnv = loaded();
    const notifier = load('../../../src/utils/notifier') as {
        sendTelegramAlert(m: string): Promise<void>;
        sendCtxAlert(c: unknown, m: string): Promise<void>;
    };
    const notifierLoadedEnv = loaded();

    const bodies: unknown[] = [];
    let fakeStatus = 200;
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (d) => {
            raw += String(d);
        });
        req.on('end', () => {
            bodies.push(JSON.parse(raw));
            res.statusCode = fakeStatus;
            res.end('{}');
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    const calls: Array<{ host: string; tokenInPath: boolean }> = [];
    const realPost = axios.post.bind(axios);
    (axios as unknown as { post: unknown }).post = (url: string, body: unknown) => {
        const u = new URL(url);
        calls.push({ host: u.hostname, tokenInPath: u.pathname === `/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage` });
        return realPost(`http://127.0.0.1:${port}/sendMessage`, body);
    };

    const ctx = { chain: { displayName: '[ETH]', name: 'eth' } };
    await notifier.sendTelegramAlert('plain');
    await notifier.sendCtxAlert(ctx, 'ctx');
    // A failing send takes the existing catch path and never rejects.
    fakeStatus = 500;
    let failurePathResolved = false;
    await notifier.sendTelegramAlert('failing').then(() => {
        failurePathResolved = true;
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));

    const ledger = core.readLedger();
    process.stdout.write(
        `\n${JSON.stringify({
            vitest: Boolean(process.env.VITEST),
            configLoadedEnv,
            notifierLoadedEnv,
            calls,
            bodies,
            failurePathResolved,
            refused: ledger.filter((e) => e.kind === 'notifier-refused').length,
            telegramDenied: ledger.filter((e) => e.kind === 'telegram-deny').length,
        })}\n`,
    );
}

void main();

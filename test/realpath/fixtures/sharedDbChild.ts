// test/realpath/fixtures/sharedDbChild.ts
//
// Phase 23 plan 23-27 (CHAR-01): a real second process on the test's database and chain. Not a
// test file. Started only through runRailedChildToEnd (test/realpath/harness/loopback.ts) with
// `-r ts-node/register/transpile-only`, so the rails preload is in place before any import.
//
// It loads real ethers and the real src/utils/db, asks the provider at ETH_RPC_URL (the
// harness loopback HTTP port) for the block number, writes one row through the real
// insertTrade, and prints `CHILD_DONE <block> <token>`. It never loads src/bot.ts or
// src/main.ts.
//
// Args: <token address>
// Env (envOverrides): DB_PATH (a file inside the OS temp folder), ETH_RPC_URL (loopback).
// Lines on stdout: CHILD_DONE <block> <token>, or CHILD_ERROR <reason> with a non-zero exit.
// Output goes straight to fd 1 because process.stdout on a Windows pipe is asynchronous and
// would not flush before process.exit.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { JsonRpcProvider } from 'ethers';

function say(line: string): void {
    fs.writeSync(1, `${line}\n`);
}

function fail(code: number, reason: string): never {
    say(`CHILD_ERROR ${reason}`);
    process.exit(code);
}

async function main(): Promise<void> {
    const token = process.argv[2];
    if (!token || !/^0x[0-9a-fA-F]{40}$/.test(token)) fail(2, `bad token argument ${JSON.stringify(token)}`);
    const rpc = process.env.ETH_RPC_URL ?? '';
    if (!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(rpc)) fail(2, `ETH_RPC_URL is not a harness loopback URL: ${JSON.stringify(rpc)}`);
    // Defense in depth beside the rails: the database must be a file inside the temp folder.
    const dbPath = process.env.DB_PATH ?? '';
    const rel = path.relative(fs.realpathSync.native(os.tmpdir()), path.resolve(dbPath));
    if (!path.isAbsolute(dbPath) || rel.startsWith('..') || path.isAbsolute(rel)) fail(2, `DB_PATH is not a file inside the temp folder: ${JSON.stringify(dbPath)}`);

    const provider = new JsonRpcProvider(rpc);
    const block = await provider.getBlockNumber();
    provider.destroy();

    // Imported only after the checks above: db.ts opens and migrates the file at import.
    const db = await import('../../../src/utils/db');
    if (path.resolve(db.getDbFilePath()) !== path.resolve(dbPath)) fail(3, `src/utils/db opened ${db.getDbFilePath()}, not ${dbPath}`);
    db.insertTrade.run({
        token: token.toLowerCase(),
        chain: 'eth',
        action: 'buy',
        txHash: `0x${'c'.repeat(64)}`,
        block,
        timestamp: Math.floor(Date.now() / 1000),
        amountIn: '0.01',
        amountOut: null,
        gasCost: null,
        priceAtAction: null,
        status: 'pending',
        poolType: 'v2',
        feeTier: null,
        dexName: 'uniswap-v2',
    });
    db.closeDb();
    say(`CHILD_DONE ${block} ${token.toLowerCase()}`);
    process.exit(0);
}

main().catch((e: unknown) => fail(1, e instanceof Error ? `${e.name}: ${e.message}` : String(e)));

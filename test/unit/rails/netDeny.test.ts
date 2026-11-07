// test/unit/rails/netDeny.test.ts
// Phase 22 plan 22-08 Task 2 — SAFE-02 setup-layer network deny (AC-15 / E13). Imports only
// test infrastructure and node/npm modules — nothing from src/.
//
// Non-loopback targets are ONLY the TEST-NET-1 documentation address 192.0.2.1 (RFC 5737,
// never routed) and the reserved `.invalid` name (RFC 6761). No real host is ever named.
// Every non-loopback attempt must fail with E_RAIL_NET_DENIED within 3 s; loopback servers
// (HTTP, ws, a raw TCP listener on 127.0.0.1, a UDP socket) must still answer.

import { describe, it, expect } from 'vitest';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as tls from 'node:tls';
import * as dns from 'node:dns';
import * as dgram from 'node:dgram';
import { createRequire } from 'node:module';
import axios from 'axios';
import WebSocket, { WebSocketServer } from 'ws';
import { JsonRpcProvider } from 'ethers';

const req = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = req('../../rails/core.cjs') as {
    railsStatus(): { installed: boolean; mode: string; netDenyInstalled: boolean; udpDenyInstalled: boolean };
    readLedger(): Array<{ kind: string; target: unknown }>;
};

const TEST_NET = '192.0.2.1';
const DENY_MS = 3000;

function findCode(err: unknown, code: string, depth = 0, seen = new Set<unknown>()): boolean {
    if (!err || typeof err !== 'object' || depth > 8 || seen.has(err)) return false;
    seen.add(err);
    const e = err as Record<string, unknown>;
    if (e.code === code) return true;
    if (typeof e.message === 'string' && e.message.startsWith(code)) return true;
    const next: unknown[] = [e.cause, e.error, e.info, e.reason, e.originalError, e.innerError];
    if (Array.isArray(e.errors)) next.push(...e.errors);
    return next.some((x) => findCode(x, code, depth + 1, seen));
}

type Starter = (ok: (err: unknown) => void, bad: (err: unknown) => void) => void;

// Resolves 'denied' when the attempt fails with E_RAIL_NET_DENIED within DENY_MS; otherwise a
// description of what happened instead ('timeout', 'succeeded', or the foreign error code).
function attempt(start: Starter): Promise<string> {
    return new Promise((resolve) => {
        let settled = false;
        const done = (v: string) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(v);
        };
        const timer = setTimeout(() => done(`timeout after ${DENY_MS}ms`), DENY_MS);
        try {
            start(
                (err) => done(findCode(err, 'E_RAIL_NET_DENIED') ? 'denied' : `other error: ${String((err as { code?: unknown })?.code ?? err)}`),
                () => done('succeeded'),
            );
        } catch (err) {
            done(findCode(err, 'E_RAIL_NET_DENIED') ? 'denied' : `threw: ${String((err as { code?: unknown })?.code ?? err)}`);
        }
    });
}

describe('rails mode', () => {
    it('full mode with the general network, DNS and UDP deny installed', () => {
        const st = core.railsStatus();
        expect(st.installed).toBe(true);
        expect(st.mode).toBe('full');
        expect(st.netDenyInstalled).toBe(true);
        expect(st.udpDenyInstalled).toBe(true);
    });
});

describe('non-loopback TCP / TLS deny to 192.0.2.1 (AC-15)', () => {
    const cases: Array<[string, Starter]> = [
        ['http.get to 192.0.2.1', (ok, bad) => http.get(`http://${TEST_NET}/`, bad).on('error', ok)],
        ['https.get to 192.0.2.1', (ok, bad) => https.get(`https://${TEST_NET}/`, bad).on('error', ok)],
        ['fetch http to 192.0.2.1', (ok, bad) => void fetch(`http://${TEST_NET}/`).then(bad, ok)],
        ['fetch https to 192.0.2.1', (ok, bad) => void fetch(`https://${TEST_NET}/`).then(bad, ok)],
        ['net.connect to 192.0.2.1', (ok, bad) => net.connect(80, TEST_NET).on('error', ok).on('connect', bad)],
        ['net.createConnection to 192.0.2.1', (ok, bad) => net.createConnection({ host: TEST_NET, port: 80 }).on('error', ok).on('connect', bad)],
        ['tls.connect to 192.0.2.1', (ok, bad) => tls.connect({ host: TEST_NET, port: 443, servername: 'rail-probe.invalid' }).on('error', ok).on('secureConnect', bad)],
        ['axios to 192.0.2.1', (ok, bad) => void axios.get(`http://${TEST_NET}/`, { timeout: DENY_MS }).then(bad, ok)],
        ['ws wss://192.0.2.1', (ok, bad) => new WebSocket(`wss://${TEST_NET}`).on('error', ok).on('open', bad)],
        [
            'ethers JsonRpcProvider to 192.0.2.1',
            (ok, bad) => {
                const provider = new JsonRpcProvider(`http://${TEST_NET}`, 1, { staticNetwork: true });
                provider
                    .getBlockNumber()
                    .then(bad, ok)
                    .finally(() => provider.destroy());
            },
        ],
    ];
    for (const [label, start] of cases) {
        it(`${label} fails with E_RAIL_NET_DENIED within 3 s`, async () => {
            expect(await attempt(start)).toBe('denied');
        });
    }
});

describe('non-loopback DNS deny', () => {
    it("dns.lookup('rail-probe.invalid') fails with E_RAIL_NET_DENIED", async () => {
        expect(await attempt((ok, bad) => dns.lookup('rail-probe.invalid', (err) => (err ? ok(err) : bad(null))))).toBe('denied');
    });
});

describe('udp deny (dgram)', () => {
    it('a udp4 send to the TEST-NET-1 address fails with E_RAIL_NET_DENIED', async () => {
        const sock = dgram.createSocket('udp4');
        try {
            const r = await attempt((ok, bad) => {
                sock.on('error', ok);
                sock.send(Buffer.from('rail-probe'), 9, TEST_NET, (err) => (err ? ok(err) : bad(null)));
            });
            expect(r).toBe('denied');
        } finally {
            sock.close();
        }
    });

    it('a loopback udp socket receives a datagram', async () => {
        const recv = dgram.createSocket('udp4');
        const sender = dgram.createSocket('udp4');
        try {
            await new Promise<void>((resolve, reject) => recv.bind(0, '127.0.0.1', resolve).on('error', reject));
            const port = recv.address().port;
            const got = new Promise<string>((resolve) => recv.once('message', (m) => resolve(m.toString())));
            sender.send(Buffer.from('rail-loopback-udp'), port, '127.0.0.1');
            const msg = await Promise.race([got, new Promise<string>((r) => setTimeout(() => r('timeout'), DENY_MS))]);
            expect(msg).toBe('rail-loopback-udp');
        } finally {
            recv.close();
            sender.close();
        }
    });
});

describe('loopback stays allowed (AC-15)', () => {
    it('a loopback HTTP server answers http.get and fetch', async () => {
        const server = http.createServer((_req, res) => res.end('rail-loopback-ok'));
        await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', resolve).on('error', reject));
        try {
            const port = (server.address() as net.AddressInfo).port;
            const body = await new Promise<string>((resolve, reject) => {
                http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
                    let d = '';
                    res.on('data', (c) => (d += c));
                    res.on('end', () => resolve(d));
                }).on('error', reject);
            });
            expect(body).toBe('rail-loopback-ok');
            expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe('rail-loopback-ok');
        } finally {
            await new Promise<void>((r) => server.close(() => r()));
        }
    });

    it('a loopback ws server accepts a client', async () => {
        const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
        await new Promise<void>((resolve, reject) => wss.once('listening', resolve).once('error', reject));
        try {
            const port = (wss.address() as net.AddressInfo).port;
            const opened = await new Promise<string>((resolve) => {
                const c = new WebSocket(`ws://127.0.0.1:${port}`);
                c.once('open', () => {
                    c.close();
                    resolve('open');
                });
                c.once('error', (e) => resolve(`error ${String((e as { code?: unknown }).code)}`));
            });
            expect(opened).toBe('open');
        } finally {
            await new Promise<void>((r) => wss.close(() => r()));
        }
    });

    it('a raw TCP listener on 127.0.0.1 accepts a connection', async () => {
        const server = net.createServer((s) => s.end('rail-raw-tcp'));
        await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', resolve).on('error', reject));
        try {
            const port = (server.address() as net.AddressInfo).port;
            const data = await new Promise<string>((resolve, reject) => {
                let d = '';
                const c = net.connect(port, '127.0.0.1');
                c.on('data', (x) => (d += x));
                c.on('end', () => resolve(d));
                c.on('error', reject);
            });
            expect(data).toBe('rail-raw-tcp');
        } finally {
            await new Promise<void>((r) => server.close(() => r()));
        }
    });
});

describe('rail ledger', () => {
    it('holds net-deny, dns-deny, udp-deny and net-allow entries for this worker', async () => {
        // Self-contained: trigger one of each, then read this process's ledger.
        await attempt((ok, bad) => net.connect(80, TEST_NET).on('error', ok).on('connect', bad));
        await attempt((ok, bad) => dns.lookup('rail-probe.invalid', (err) => (err ? ok(err) : bad(null))));
        const sock = dgram.createSocket('udp4');
        await attempt((ok, bad) => {
            sock.on('error', ok);
            sock.send(Buffer.from('x'), 9, TEST_NET, (err) => (err ? ok(err) : bad(null)));
        });
        sock.close();
        const server = net.createServer((s) => s.end());
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const port = (server.address() as net.AddressInfo).port;
        await new Promise<void>((resolve) => net.connect(port, '127.0.0.1').on('close', () => resolve()).on('error', () => resolve()));
        await new Promise<void>((r) => server.close(() => r()));

        const kinds = new Set(core.readLedger().map((e) => e.kind));
        for (const k of ['net-deny', 'dns-deny', 'udp-deny', 'net-allow']) expect(kinds.has(k), k).toBe(true);
        const allows = core.readLedger().filter((e) => e.kind === 'net-allow');
        for (const a of allows) expect((a.target as { class?: string }).class).toBe('loopback');
    });
});

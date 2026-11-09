// scripts/pause.ts
//
// Phase 20 / Plan 20-05 / OPS-LIVE-11 — operator CLI to pause the bot via the
// dashboard endpoint. Two-step flow:
//   1. POST /api/auth/login with DASHBOARD_API_KEY in request body
//   2. POST /api/controls/pause with the session cookie forwarded
//
// Exit codes:
//   0 on success
//   1 on HTTP error / missing env / login or pause endpoint non-200
//   2 on uncaught throw (defensive)
//
// T-20-05 mitigation: DASHBOARD_API_KEY is passed via process.env + axios
// request body. It is NEVER passed as a CLI argument (would leak into
// process arg list / shell history). It is NEVER logged anywhere in this
// script. Tests/grep enforce both of these invariants.
//
// Usage:
//   npm run pause -- --reason "going-live audit"
//   npm run pause                             # defaults reason to "CLI pause"
//
// DASHBOARD_URL is OPTIONAL. When unset it is derived from
// DASHBOARD_HOST:DASHBOARD_PORT (default http://127.0.0.1:8080) — the SAME
// address the API server binds (src/api/server.ts). Set DASHBOARD_URL only for
// a non-default host/port or a remote dashboard; the CLI works out of the box
// on a fresh clone with the server on its default bind.

import * as dotenv from 'dotenv';
import axios from 'axios';
import { logger } from '../src/utils/logger';

// SAFE-02 / D-01 (src layer): skip the .env file under Vitest. The setup layer blocks the read independently.
if (!process.env.VITEST) dotenv.config();

const log = logger.child({ module: 'pause-cli' });

/**
 * 20-09: derive the dashboard URL the CLI dials. When DASHBOARD_URL is set it
 * is honored verbatim (operator override — remote dashboard, custom scheme,
 * etc.). When unset, the default is built from DASHBOARD_HOST/DASHBOARD_PORT,
 * mirroring the server bind in src/api/server.ts:161-162
 * (`host = process.env.DASHBOARD_HOST || '127.0.0.1'`,
 *  `port = process.env.DASHBOARD_PORT || '8080'`). This eliminates the old
 * hardcoded default that dialed the wrong port (the dashboard SPA's :3000 dev
 * server, not the API bind) → ECONNREFUSED. 127.0.0.1 (IPv4) — NOT localhost —
 * to avoid the ::1 IPv6
 * refusal called out in the live UAT. Pure env reads, so it is safe to call
 * again from the crash handler to report the address that failed.
 */
function resolveDashboardUrl(): string {
    const host = process.env.DASHBOARD_HOST || '127.0.0.1';
    const port = process.env.DASHBOARD_PORT || '8080';
    return process.env.DASHBOARD_URL || `http://${host}:${port}`;
}

/**
 * WR-03: parse the operator's --reason argument, supporting BOTH the
 * `--reason value` (space-separated) and `--reason=value` (GNU long-option)
 * forms. Returns 'CLI pause' as the default sentinel when neither form is
 * present. The `=` form is checked first because it is unambiguous (the
 * argv element starts with the literal `--reason=` prefix); the space form
 * falls back to the indexOf-then-peek lookup.
 */
function getReasonArg(): string {
    const argv = process.argv;
    const eqArg = argv.find(a => a.startsWith('--reason='));
    if (eqArg) return eqArg.slice('--reason='.length);
    const idx = argv.indexOf('--reason');
    if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
    return 'CLI pause';
}

async function main(): Promise<void> {
    const apiKey = process.env.DASHBOARD_API_KEY;
    const dashboardUrl = resolveDashboardUrl();

    // WR-03 fix: handle BOTH `--reason value` (space-separated) AND
    // `--reason=value` (GNU long-option form). The previous parser only
    // handled the space-separated form, so an operator running
    // `npm run pause -- --reason=foo` silently fell back to the default
    // 'CLI pause' reason without any warning.
    const reason = getReasonArg();

    if (!apiKey) {
        // T-20-05: the env-var NAME is logged (operator needs to know what to set);
        // the VALUE is never referenced inside any log call in this file.
        log.fatal('DASHBOARD_API_KEY not set in .env');
        process.exit(1);
    }

    // Step 1: login — body carries the apiKey; never log the body.
    const loginRes = await axios.post(
        `${dashboardUrl}/api/auth/login`,
        { apiKey },
        { withCredentials: true, validateStatus: () => true },
    );
    if (loginRes.status !== 200) {
        // Log status + a safe subset of response (apiKey is in the REQUEST body, not
        // the response; the response body is the server's error message + safe to log).
        log.fatal({ status: loginRes.status, body: loginRes.data }, 'Login failed');
        process.exit(1);
    }
    const setCookieHeader = loginRes.headers['set-cookie'];
    const cookie = Array.isArray(setCookieHeader) && setCookieHeader.length > 0 ? setCookieHeader[0] : '';

    // Step 2: POST /api/controls/pause with the forwarded session cookie.
    const pauseRes = await axios.post(
        `${dashboardUrl}/api/controls/pause`,
        { reason, pausedBy: 'cli' },
        { headers: { Cookie: cookie }, validateStatus: () => true },
    );
    if (pauseRes.status !== 200) {
        log.fatal({ status: pauseRes.status, body: pauseRes.data }, 'Pause endpoint failed');
        process.exit(1);
    }

    log.info({ reason, response: pauseRes.data }, 'Bot paused via CLI');
    process.exit(0);
}

/**
 * 20-09: unwrap a connection failure into a clear, non-empty operator message.
 * On ECONNREFUSED axios throws an AggregateError whose own `.message` is '' but
 * whose `.errors[]` holds the underlying Error with `code: 'ECONNREFUSED'` and a
 * populated `.message` (e.g. `connect ECONNREFUSED 127.0.0.1:8080`). The naive
 * `err.message` therefore logged `err:''` — useless. We dig out the real cause:
 * the first `.errors[]` entry with a non-empty `.message`, else the error's own
 * `.code`/`.message`. The payload references only the URL + error code — the
 * apiKey is NEVER included (T-20-05).
 */
function unwrapConnectionCause(err: unknown): { code: string; detail: string } | null {
    const e = err as { code?: string; message?: string; errors?: unknown[] };
    const hasErrors = Array.isArray(e?.errors) && e.errors.length > 0;
    const isRefused = e?.code === 'ECONNREFUSED' || hasErrors;
    if (!isRefused) return null;

    const cause = hasErrors
        ? (e.errors as Array<{ code?: string; message?: string }>).find(c => c && c.message)
        : undefined;
    const code = cause?.code || e.code || 'ECONNREFUSED';
    const detail = cause?.message || e.message || code;
    return { code, detail };
}

main().catch((err) => {
    const conn = unwrapConnectionCause(err);
    if (conn) {
        // Recompute the URL (pure env reads) so the operator sees exactly which
        // address was dialed. apiKey is intentionally absent from this payload.
        const url = resolveDashboardUrl();
        log.fatal(
            { url, code: conn.code, cause: conn.detail },
            `Could not reach the dashboard API at ${url} (${conn.code}). Is the bot running? Check DASHBOARD_URL / DASHBOARD_HOST / DASHBOARD_PORT.`,
        );
        process.exit(2);
    }
    log.fatal({ err: err instanceof Error ? err.message : String(err) }, 'Pause CLI crashed');
    process.exit(2);
});

// scripts/resume.ts
//
// Phase 20 / Plan 20-05 / OPS-LIVE-11 — operator CLI to resume the bot via the
// dashboard endpoint. Sibling to scripts/pause.ts; same two-step flow:
//   1. POST /api/auth/login with DASHBOARD_API_KEY in request body
//   2. POST /api/controls/resume with the session cookie forwarded (no body)
//
// Exit codes:
//   0 on success
//   1 on HTTP error / missing env / login or resume endpoint non-200
//   2 on uncaught throw (defensive)
//
// T-20-05 mitigation: DASHBOARD_API_KEY is passed via process.env + axios
// request body. It is NEVER passed as a CLI argument and NEVER logged.
//
// Usage:
//   npm run resume
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

const log = logger.child({ module: 'resume-cli' });

/**
 * 20-09: derive the dashboard URL the CLI dials. When DASHBOARD_URL is set it
 * is honored verbatim (operator override). When unset, the default is built
 * from DASHBOARD_HOST/DASHBOARD_PORT, mirroring the server bind in
 * src/api/server.ts:161-162. 127.0.0.1 (IPv4) — NOT localhost — to avoid the
 * ::1 IPv6 refusal called out in the live UAT. Pure env reads, so it is safe
 * to call again from the crash handler. (Sibling of scripts/pause.ts.)
 */
function resolveDashboardUrl(): string {
    const host = process.env.DASHBOARD_HOST || '127.0.0.1';
    const port = process.env.DASHBOARD_PORT || '8080';
    return process.env.DASHBOARD_URL || `http://${host}:${port}`;
}

async function main(): Promise<void> {
    const apiKey = process.env.DASHBOARD_API_KEY;
    const dashboardUrl = resolveDashboardUrl();

    if (!apiKey) {
        log.fatal('DASHBOARD_API_KEY not set in .env');
        process.exit(1);
    }

    // Step 1: login.
    const loginRes = await axios.post(
        `${dashboardUrl}/api/auth/login`,
        { apiKey },
        { withCredentials: true, validateStatus: () => true },
    );
    if (loginRes.status !== 200) {
        log.fatal({ status: loginRes.status, body: loginRes.data }, 'Login failed');
        process.exit(1);
    }
    const setCookieHeader = loginRes.headers['set-cookie'];
    const cookie = Array.isArray(setCookieHeader) && setCookieHeader.length > 0 ? setCookieHeader[0] : '';

    // Step 2: POST /api/controls/resume — no body required.
    const resumeRes = await axios.post(
        `${dashboardUrl}/api/controls/resume`,
        {},
        { headers: { Cookie: cookie }, validateStatus: () => true },
    );
    if (resumeRes.status !== 200) {
        log.fatal({ status: resumeRes.status, body: resumeRes.data }, 'Resume endpoint failed');
        process.exit(1);
    }

    log.info({ response: resumeRes.data }, 'Bot resumed via CLI');
    process.exit(0);
}

/**
 * 20-09: unwrap a connection failure into a clear, non-empty operator message.
 * On ECONNREFUSED axios throws an AggregateError whose own `.message` is '' but
 * whose `.errors[]` holds the underlying Error with `code: 'ECONNREFUSED'` and a
 * populated `.message` (e.g. `connect ECONNREFUSED 127.0.0.1:8080`). We dig out
 * the real cause: the first `.errors[]` entry with a non-empty `.message`, else
 * the error's own `.code`/`.message`. The payload references only the URL +
 * error code — the apiKey is NEVER included (T-20-05). Sibling of pause.ts.
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
        const url = resolveDashboardUrl();
        log.fatal(
            { url, code: conn.code, cause: conn.detail },
            `Could not reach the dashboard API at ${url} (${conn.code}). Is the bot running? Check DASHBOARD_URL / DASHBOARD_HOST / DASHBOARD_PORT.`,
        );
        process.exit(2);
    }
    log.fatal({ err: err instanceof Error ? err.message : String(err) }, 'Resume CLI crashed');
    process.exit(2);
});

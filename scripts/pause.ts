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

import * as dotenv from 'dotenv';
import axios from 'axios';
import { logger } from '../src/utils/logger';

dotenv.config();

const log = logger.child({ module: 'pause-cli' });

async function main(): Promise<void> {
    const apiKey = process.env.DASHBOARD_API_KEY;
    const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:3000';

    // Extract --reason "..." arg.
    const reasonArgIdx = process.argv.indexOf('--reason');
    const reason =
        reasonArgIdx >= 0 && reasonArgIdx + 1 < process.argv.length
            ? process.argv[reasonArgIdx + 1]
            : 'CLI pause';

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

main().catch((err) => {
    log.fatal({ err: err instanceof Error ? err.message : String(err) }, 'Pause CLI crashed');
    process.exit(2);
});

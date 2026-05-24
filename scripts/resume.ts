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

import * as dotenv from 'dotenv';
import axios from 'axios';
import { logger } from '../src/utils/logger';

dotenv.config();

const log = logger.child({ module: 'resume-cli' });

async function main(): Promise<void> {
    const apiKey = process.env.DASHBOARD_API_KEY;
    const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:3000';

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

main().catch((err) => {
    log.fatal({ err: err instanceof Error ? err.message : String(err) }, 'Resume CLI crashed');
    process.exit(2);
});

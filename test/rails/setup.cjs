'use strict';
// test/rails/setup.cjs
// Phase 22 plan 22-05 Task 2 — SAFE-02 rails, Vitest `setupFiles` entry for the unit and
// integration projects (D-01: the same core.cjs module the NODE_OPTIONS preload loads).
// Full rails: env scrub + test/.env.test sentinels (D-02), .env block, data/ fs block,
// DB tripwire, non-loopback TCP/DNS/UDP deny, per-run rail ledger. No env var selects the
// mode or disables a rail (NAC-05); re-installing per test file is idempotent.
require('./core.cjs').installRails({ mode: 'full' });

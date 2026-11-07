'use strict';
// test/rails/preload.cjs
// Phase 22 plan 22-05 — SAFE-02 rails, NODE_OPTIONS preload entry (D-03).
// Loaded as `NODE_OPTIONS=--require ${JSON.stringify(absPath)}` by spawnRailedChild (22-08),
// so every railed child process gets the same full rails as a Vitest worker (D-01: one
// module, loaded both ways). No env var selects the mode (NAC-05).
require('./core.cjs').installRails({ mode: 'full' });
